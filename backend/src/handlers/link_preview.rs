//! 內文連結的 hover 預覽卡資料來源（自架，不外送讀者行為給第三方）。
//!
//! 哲學：不用 microlink/截圖服務——那會把「讀者 hover 了哪個連結」送到外部，且有速率限制。
//! 這裡只做「抓目標頁 HTML → 解 OpenGraph/meta → 存 SQLite 快取」，不需要 headless 瀏覽器。
//!
//! - `GET /api/link-preview?url=…`：回 { title, description, image, site_name, favicon }
//!   抓不到 og:image 時仍回標題/描述/favicon → 前端顯示「降級卡」。
//! - 快取表 `link_previews` 由 main.rs 冪等建表（本 repo 無 migration 框架，沿用既有慣例）。
//!
//! 安全（這支會用使用者提供的 URL 發出站外請求，是 SSRF 的典型面）：
//!   1. 只允許 http/https
//!   2. 解析出的 IP 若落在私網/迴環/link-local/CGNAT → 拒絕
//!   3. 逾時 6s、不跟隨跨站重導超過 3 次、回應體上限 512KB（只需要 <head>）
//!   4. 失敗一律回 200 + 空欄位（前端顯示降級卡），不把上游錯誤細節外露

use std::time::Duration;

use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    net_guard::{is_blocked_ip, validate_url},
    state::AppState,
};

/// 快取存活時間：7 天（站外頁面的 og 很少變）
const CACHE_TTL_SECS: i64 = 7 * 24 * 60 * 60;
/// 只讀前 512KB —— og meta 一定在 <head>，不必把整頁拉回來
const MAX_BODY_BYTES: usize = 512 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Deserialize)]
pub struct LinkPreviewQuery {
    pub url: String,
}

/// 快取列（抽成具名結構而非裸元組——clippy::type_complexity）
#[derive(Debug, sqlx::FromRow)]
struct CachedPreview {
    title: Option<String>,
    description: Option<String>,
    image: Option<String>,
    site_name: Option<String>,
    age_secs: i64,
}

#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct LinkPreviewResponse {
    /// 目標頁標題（og:title → twitter:title → <title>）
    pub title: Option<String>,
    /// 摘要（og:description → twitter:description → meta description）
    pub description: Option<String>,
    /// 預覽圖（og:image → twitter:image）；沒有就是 None → 前端走降級卡
    pub image: Option<String>,
    /// 站名（og:site_name），沒有則退回 host
    pub site_name: Option<String>,
    /// favicon（固定用 /favicon.ico 的絕對路徑，降級卡用）
    pub favicon: Option<String>,
}

/// 從 HTML <head> 擷取一個 meta 內容。用輕量掃描而非完整 DOM parser：
/// og 標籤格式穩定，且我們只讀前 512KB，正則掃描足夠且省一個依賴。
fn meta_content(html: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        // 同時容忍 property="og:x" 與 name="og:x"，屬性順序也可能相反
        for pat in [
            format!(
                r#"(?is)<meta[^>]+(?:property|name)\s*=\s*["']{k}["'][^>]*content\s*=\s*["']([^"']*)["']"#,
                k = regex::escape(key)
            ),
            format!(
                r#"(?is)<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']{k}["']"#,
                k = regex::escape(key)
            ),
        ] {
            if let Ok(re) = regex::Regex::new(&pat)
                && let Some(c) = re.captures(html)
            {
                let v = c.get(1)?.as_str().trim();
                if !v.is_empty() {
                    return Some(decode_entities(v));
                }
            }
        }
    }
    None
}

fn title_tag(html: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    let c = re.captures(html)?;
    let v = c.get(1)?.as_str().trim();
    (!v.is_empty()).then(|| decode_entities(v))
}

/// 只處理最常見的幾個實體（og 內容裡多半是 &amp; &quot; &#39;）
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .chars()
        .take(400)
        .collect()
}

/// 相對路徑 → 絕對 URL（og:image 常給相對路徑）
fn absolutize(base: &str, maybe_relative: &str) -> Option<String> {
    let b = reqwest::Url::parse(base).ok()?;
    b.join(maybe_relative).ok().map(|u| u.to_string())
}

/// `GET /api/link-preview?url=…` —— 站內外連結的 hover 預覽資料。
/// 一律回 200：抓不到就回空欄位讓前端顯示降級卡（不讓上游錯誤變成前端的錯誤狀態）。
#[utoipa::path(
    get, path = "/api/link-preview", tag = "misc",
    params(("url" = String, Query, description = "要預覽的目標連結（http/https）")),
    responses((status = 200, body = LinkPreviewResponse, description = "預覽資料；抓不到時欄位為 null（前端顯示降級卡）"))
)]
pub async fn link_preview(
    State(state): State<AppState>,
    Query(q): Query<LinkPreviewQuery>,
) -> Result<Json<LinkPreviewResponse>, AppError> {
    let Some((url, host)) = validate_url(&q.url) else {
        return Ok(Json(LinkPreviewResponse::default()));
    };

    // ── 快取命中就直接回 ──
    let cached: Option<CachedPreview> = sqlx::query_as(
        "SELECT title, description, image, site_name, \
         CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s', fetched_at) AS INTEGER) AS age_secs \
         FROM link_previews WHERE url = ?",
    )
    .bind(&url)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(c) = cached
        && c.age_secs < CACHE_TTL_SECS
    {
        return Ok(Json(LinkPreviewResponse {
            title: c.title,
            description: c.description,
            image: c.image,
            site_name: c.site_name.or_else(|| Some(host.clone())),
            favicon: Some(format!("https://{host}/favicon.ico")),
        }));
    }

    // ── 抓取（失敗一律降級，不回錯誤）──
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Mozilla/5.0 (compatible; koimsurai-linkpreview/1.0; +https://koimsurai.com)")
        .build()
        .map_err(AppError::Upstream)?;

    let fetched = async {
        let resp = client.get(&url).send().await.ok()?;
        // 解析後的 peer IP 再擋一次（DNS rebinding / 域名指向私網）
        if let Some(addr) = resp.remote_addr()
            && is_blocked_ip(&addr.ip())
        {
            return None;
        }
        if !resp.status().is_success() {
            return None;
        }
        let ct =
            resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
        if !ct.contains("text/html") && !ct.contains("application/xhtml") {
            return None;
        }
        let bytes = resp.bytes().await.ok()?;
        let slice = &bytes[..bytes.len().min(MAX_BODY_BYTES)];
        Some(String::from_utf8_lossy(slice).to_string())
    }
    .await;

    let mut out = LinkPreviewResponse {
        site_name: Some(host.clone()),
        favicon: Some(format!("https://{host}/favicon.ico")),
        ..Default::default()
    };

    if let Some(html) = fetched {
        out.title = meta_content(&html, &["og:title", "twitter:title"]).or_else(|| title_tag(&html));
        out.description = meta_content(&html, &["og:description", "twitter:description", "description"]);
        out.image = meta_content(&html, &["og:image", "og:image:url", "twitter:image"])
            .and_then(|img| absolutize(&url, &img));
        if let Some(sn) = meta_content(&html, &["og:site_name"]) {
            out.site_name = Some(sn);
        }

        // 寫回快取（UPSERT；失敗不影響回應）
        let _ = sqlx::query(
            "INSERT INTO link_previews (url, title, description, image, site_name, fetched_at) \
             VALUES (?, ?, ?, ?, ?, datetime('now')) \
             ON CONFLICT(url) DO UPDATE SET \
               title = excluded.title, description = excluded.description, \
               image = excluded.image, site_name = excluded.site_name, \
               fetched_at = excluded.fetched_at",
        )
        .bind(&url)
        .bind(&out.title)
        .bind(&out.description)
        .bind(&out.image)
        .bind(&out.site_name)
        .execute(&state.pool)
        .await;
    }

    Ok(Json(out))
}
