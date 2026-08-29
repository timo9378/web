//! 內文連結的 hover 預覽卡資料來源（自架，不外送讀者行為給第三方）。
//!
//! 哲學：不用 microlink/截圖服務——那會把「讀者 hover 了哪個連結」送到外部，且有速率限制。
//! 這裡只做「抓目標頁 HTML → 解 OpenGraph/meta → 存 SQLite 快取」，不需要 headless 瀏覽器。
//!
//! - `GET /api/link-preview?url=…`：回 { title, description, image, site_name, favicon }
//!   抓不到 og:image 時仍回標題/描述/favicon → 前端顯示「降級卡」。
//! - 快取表 `link_previews` 在 migrations（0001 建表）。
//!
//! ⚠️ 這裡回的 `image` / `favicon` 是站外的絕對網址，**前端不可以直接放進 `<img src>`**——
//! 那等於讓讀者的瀏覽器去連對方主機，對方就拿到讀者的 IP／UA／Referer，上面那條
//! 「不外送讀者行為」的哲學會在最後一步破功。前端一律走 `/api/image-proxy`
//! （見 LinkHoverPreview.tsx）。
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
/// 這個端點的 `Cache-Control: max-age`。30 分鐘＝對齊前端 useQuery 的 staleTime，
/// 讓「重新整理後第一次 hover」不必再跑一趟後端（在這之前完全沒有這個標頭）。
const BROWSER_CACHE_SECS: i64 = 30 * 60;
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
    /// favicon 的絕對網址（降級卡用）。優先取站方 `<link rel="icon">` 宣告的那支，
    /// 沒宣告才退回猜 `/favicon.ico`——後者很多站根本沒有（見 `link_icon_href`）。
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
///
/// ⚠️ 這裡**不截斷**。以前它結尾有 `.chars().take(400)`，而 `meta_content` 是 og:image
/// 和標題／摘要共用的，於是那個「顯示用的長度上限」也套到了網址上。GitHub repo 頁的
/// og:image 是 719 個字的預簽章網址，砍到 400 剛好把 `X-Amz-SignedHeaders=ho` 從中間
/// 切斷 → 簽章失效 → 圖一律 401。截斷要留給真正的文字欄位，見 `clamp_text`。
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

/// 顯示用文字的長度上限。只給標題／摘要／站名——**不要用在網址上**。
fn clamp_text(s: &str) -> String {
    s.chars().take(400).collect()
}

/// `<link rel="…icon…" href="…">` 的 href。
///
/// 為什麼需要：預設的 `https://{host}/favicon.ico` 是**猜**的，而很多站沒有那支檔——
/// 實測 zed.dev 回 500，它宣告的是 `/favicon_black_16.png`。猜錯的後果是降級卡上
/// 掛一個破圖示（沒有 og:image 的站才會走到降級卡，所以特別顯眼）。
///
/// `rel` 的寫法很雜（`icon`／`shortcut icon`／`apple-touch-icon`／大小寫混用），
/// 所以用「含 icon 這個字」來認，跟 `meta_content` 一樣走輕量掃描不引入 DOM parser。
/// 取**第一個**符合的：站方通常把主要的那支寫在前面。
fn link_icon_href(html: &str) -> Option<String> {
    let re = regex::Regex::new(
        r#"(?is)<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']"#,
    )
    .ok()?;
    // 屬性順序也可能相反（href 在 rel 前面）
    let re2 = regex::Regex::new(
        r#"(?is)<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*icon[^"']*["']"#,
    )
    .ok()?;
    let pick = |c: regex::Captures<'_>| c.get(1).map(|m| decode_entities(m.as_str().trim()));
    re.captures(html).and_then(pick).or_else(|| re2.captures(html).and_then(pick)).filter(|s| !s.is_empty())
}

/// 相對路徑 → 絕對 URL（og:image 常給相對路徑）
fn absolutize(base: &str, maybe_relative: &str) -> Option<String> {
    let b = reqwest::Url::parse(base).ok()?;
    b.join(maybe_relative).ok().map(|u| u.to_string())
}

/// 預簽章網址的到期時刻（Unix 秒）；不是預簽章就回 None。
///
/// 為什麼需要這個：有些站的 og:image 指到帶簽章、會自己失效的網址。GitHub 的 repo 頁
/// 就是——`repository-images.githubusercontent.com/…?X-Amz-Expires=300`，五分鐘後回 401。
/// 這張表的 TTL 是 7 天，所以不看期限的話，存進去五分鐘後就開始供應死連結，供應七天。
///
/// 認得兩種寫法：
///   - SigV4（AWS S3／GCS）：`X-Amz-Date=20260803T110407Z` + `X-Amz-Expires=300`
///     （Google 是同樣格式的 `X-Goog-` 前綴）
///   - 舊式 CloudFront／GCS 簽章：`Expires=<unix 秒>`
///
/// 認不出來就回 None＝當作不會過期，行為與加這個函式之前相同。寧可漏判也不要誤判：
/// 誤判成「會過期」只會讓穩定的站白白重抓。
fn signed_image_expiry(url: &str) -> Option<i64> {
    let u = reqwest::Url::parse(url).ok()?;
    let q: std::collections::HashMap<_, _> = u.query_pairs().collect();

    // SigV4：簽章時刻 + 有效秒數
    for (date_key, exp_key) in [("X-Amz-Date", "X-Amz-Expires"), ("X-Goog-Date", "X-Goog-Expires")] {
        if let (Some(date), Some(exp)) = (q.get(date_key), q.get(exp_key))
            && let (Some(signed_at), Ok(secs)) = (parse_sigv4_date(date), exp.parse::<i64>())
        {
            return Some(signed_at + secs);
        }
    }

    // 舊式：Expires 直接就是 unix 秒。只認「看起來像近代時間戳」的值，避免把
    // `?Expires=0`（有些站用來表示不快取）或短數字誤當成期限。
    if let Some(v) = q.get("Expires")
        && let Ok(epoch) = v.parse::<i64>()
        && epoch > 1_000_000_000
    {
        return Some(epoch);
    }

    None
}

/// `20260803T110407Z` → Unix 秒。這個格式是 SigV4 固定的，不必拉進日期函式庫。
fn parse_sigv4_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 16 || b[8] != b'T' || b[15] != b'Z' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(4, 6)?, num(6, 8)?);
    let (h, mi, sec) = (num(9, 11)?, num(11, 13)?, num(13, 15)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    // civil date → 天數（Howard Hinnant 的 days_from_civil，UTC 無時區問題）
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + sec)
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
) -> Result<PreviewResponse, AppError> {
    let Some((url, host)) = validate_url(&q.url) else {
        return Ok(with_cache_headers(LinkPreviewResponse::default(), 0));
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

    let now = now_epoch();
    if let Some(c) = cached
        && c.age_secs < CACHE_TTL_SECS
    {
        // 到期時刻是從存下來的網址現算的，不另存一欄。這樣寫的好處是「改這段程式之前就
        // 存進去的列」也一起適用——不必為了回填而動 schema，而且期限本來就是網址的
        // 函數，存起來只是同一件事的第二份真相。
        let image_expiry = c.image.as_deref().and_then(signed_image_expiry);
        // 圖是預簽章而且已經過期 → 往下走當作 miss 重抓。不這樣做的話，這一列會在剩下
        // 的 TTL 內一直供應一個回 401 的網址（GitHub repo 的 og:image 五分鐘就到期）。
        if image_expiry.is_none_or(|exp| exp > now) {
            return Ok(with_cache_headers(
                LinkPreviewResponse {
                    title: c.title,
                    description: c.description,
                    image: c.image,
                    site_name: c.site_name.or_else(|| Some(host.clone())),
                    favicon: Some(format!("https://{host}/favicon.ico")),
                },
                response_max_age(image_expiry, now),
            ));
        }
    }

    // ── 抓取（失敗一律降級，不回錯誤）──
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(AppError::Upstream)?;

    let fetch_with = |ua: &'static str| {
        let client = client.clone();
        let url = url.clone();
        async move {
            let resp = client.get(&url).header(reqwest::header::USER_AGENT, ua).send().await.ok()?;
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
    };

    // 先用**誠實的** UA（表明自己是誰、附聯絡網址）。這是對站方有禮貌的做法，
    // 而且多數站接受。
    //
    // ⚠️ 但有一批站對非瀏覽器 UA 直接擋——實測 zed.dev 回 **404**（同一個網址用
    //   瀏覽器 UA 是 200）。那種情況下 title/description/image 全是 None，
    //   前台只剩一張空的降級卡，看起來就是「這個站的預覽壞了」。
    //   所以失敗時退回瀏覽器 UA 再試一次。這是 link unfurler 的常規做法
    //   （Slack/Discord 同樣行為），抓的也只是讀者自己 hover 的那個公開頁面。
    const HONEST_UA: &str = "Mozilla/5.0 (compatible; koimsurai-linkpreview/1.0; +https://koimsurai.com)";
    const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                              (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    let fetched = match fetch_with(HONEST_UA).await {
        Some(html) => Some(html),
        None => fetch_with(BROWSER_UA).await,
    };

    let mut out = LinkPreviewResponse {
        site_name: Some(host.clone()),
        favicon: Some(format!("https://{host}/favicon.ico")),
        ..Default::default()
    };

    if let Some(html) = fetched {
        // 文字欄位才套長度上限；image 是網址，截斷會直接讓預簽章失效（見 decode_entities）
        out.title = meta_content(&html, &["og:title", "twitter:title"])
            .or_else(|| title_tag(&html))
            .as_deref()
            .map(clamp_text);
        out.description = meta_content(&html, &["og:description", "twitter:description", "description"])
            .as_deref()
            .map(clamp_text);
        out.image = meta_content(&html, &["og:image", "og:image:url", "twitter:image"])
            .and_then(|img| absolutize(&url, &img));
        if let Some(sn) = meta_content(&html, &["og:site_name"]) {
            out.site_name = Some(clamp_text(&sn));
        }
        // 站方自己宣告的 icon 優先於猜的 /favicon.ico——很多站根本沒有那支檔。
        // 實測 zed.dev/favicon.ico 是 500，它宣告的是 /favicon_black_16.png，
        // 於是沒有 og:image 的降級卡上就掛著一個破圖示。
        if let Some(icon) = link_icon_href(&html).and_then(|href| absolutize(&url, &href)) {
            out.favicon = Some(icon);
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

    let image_expiry = out.image.as_deref().and_then(signed_image_expiry);
    Ok(with_cache_headers(out, response_max_age(image_expiry, now)))
}

use crate::util::now_secs as now_epoch;

/// 這次回應可以讓瀏覽器／CDN 留多久。
///
/// 平常是 `BROWSER_CACHE_SECS`（對齊前端 useQuery 的 staleTime）。但如果圖是預簽章、
/// 而且比那個還早到期，就縮到剩餘壽命——否則瀏覽器會拿著一份「圖已經死掉」的 JSON
/// 繼續用到 max-age 結束，等於把後端剛修好的問題原封搬到讀者的快取裡。
fn response_max_age(image_expires_at: Option<i64>, now: i64) -> i64 {
    match image_expires_at {
        Some(exp) => (exp - now).clamp(0, BROWSER_CACHE_SECS),
        None => BROWSER_CACHE_SECS,
    }
}

/// 回應型別：JSON 加上一個 `Cache-Control`。兩個 return 點都走這裡，型別才一致。
type PreviewResponse = ([(axum::http::HeaderName, String); 1], Json<LinkPreviewResponse>);

fn with_cache_headers(body: LinkPreviewResponse, max_age: i64) -> PreviewResponse {
    ([(axum::http::header::CACHE_CONTROL, format!("public, max-age={max_age}"))], Json(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sigv4_日期換算成_unix_秒() {
        // 2026-08-03T11:04:07Z（實測 GitHub og:image 的簽章時刻）
        assert_eq!(parse_sigv4_date("20260803T110407Z"), Some(1_785_755_047));
        // 紀元起點，驗證換算沒有偏移
        assert_eq!(parse_sigv4_date("19700101T000000Z"), Some(0));
        // 閏日：2024 是閏年，2/29 必須算得出來
        assert_eq!(parse_sigv4_date("20240229T000000Z"), Some(1_709_164_800));
    }

    #[test]
    fn 格式不對就回_none_而不是猜一個時間() {
        for bad in [
            "20260803110407Z",  // 少了 T
            "20260803T110407",  // 少了 Z
            "20261303T110407Z", // 13 月
            "20260832T110407Z", // 32 日
            "20260803T250407Z", // 25 時
            "",
            "not-a-date",
        ] {
            assert_eq!(parse_sigv4_date(bad), None, "{bad} 應該判定為無效");
        }
    }

    #[test]
    fn 認得出預簽章網址的到期時刻() {
        // GitHub 的 og:image：SigV4，簽章當下 + 300 秒
        let gh = "https://repository-images.githubusercontent.com/x/y?X-Amz-Algorithm=AWS4-HMAC-SHA256\
                  &X-Amz-Date=20260803T110407Z&X-Amz-Expires=300&X-Amz-Signature=deadbeef";
        assert_eq!(signed_image_expiry(gh), Some(1_785_755_047 + 300));

        // Google 用同樣的格式、不同前綴
        let gcs = "https://storage.googleapis.com/b/o?X-Goog-Date=20260803T110407Z&X-Goog-Expires=600";
        assert_eq!(signed_image_expiry(gcs), Some(1_785_755_047 + 600));

        // 舊式：Expires 直接是 unix 秒
        assert_eq!(
            signed_image_expiry("https://cdn.example.com/a.jpg?Expires=1785755047"),
            Some(1_785_755_047)
        );
    }

    #[test]
    fn 一般圖片網址不該被判定成會過期() {
        // 這些是實測過的穩定網址，誤判只會讓它們白白每次重抓
        for stable in [
            "https://opengraph.githubassets.com/abc/owner/repo",
            "https://eu.simkl.in/posters/97/978264e8bbc2303_m.webp",
            "https://developer.mozilla.org/mdn-social-share.png",
            // Expires=0 是「不要快取」的慣用寫法，不是期限
            "https://cdn.example.com/a.jpg?Expires=0",
            // 短數字不可能是近代時間戳
            "https://cdn.example.com/a.jpg?Expires=300",
            // 有簽章但沒給期限 → 判不出來就別猜
            "https://cdn.example.com/a.jpg?X-Amz-Signature=deadbeef",
        ] {
            assert_eq!(signed_image_expiry(stable), None, "{stable} 不該被判定成會過期");
        }
    }

    #[test]
    fn og_image_的長網址不可以被截斷() {
        // 這條守的是實際發生過的事：decode_entities 以前結尾有 .chars().take(400)，
        // 而 meta_content 是文字欄位與 og:image 共用的，於是 719 個字的 GitHub 預簽章
        // 網址被砍成 400，X-Amz-SignedHeaders 從中間斷掉 → 圖一律 401。
        let long_url = format!(
            "https://repository-images.githubusercontent.com/{}?X-Amz-Algorithm=AWS4-HMAC-SHA256\
             &X-Amz-Credential={}&X-Amz-Date=20260803T110407Z&X-Amz-Expires=300\
             &X-Amz-Signature={}&X-Amz-SignedHeaders=host",
            "a".repeat(120),
            "b".repeat(120),
            "c".repeat(64),
        );
        assert!(long_url.len() > 400, "測試樣本要比舊上限長才有意義（{}）", long_url.len());

        let html = format!(r#"<meta property="og:image" content="{}">"#, long_url.replace('&', "&amp;"));
        let got = meta_content(&html, &["og:image"]).expect("該抓得到 og:image");
        assert_eq!(got, long_url, "網址被動過了");
        assert!(got.ends_with("SignedHeaders=host"), "結尾被截掉：{}", &got[got.len() - 40..]);
    }

    #[test]
    fn 文字欄位仍然有長度上限() {
        // 截斷本身是對的，只是不該套在網址上
        assert_eq!(clamp_text(&"字".repeat(500)).chars().count(), 400);
        assert_eq!(clamp_text("短"), "短");
        // 以字元計，不是位元組——切在多位元組字元中間會 panic
        assert_eq!(clamp_text(&"é".repeat(500)).chars().count(), 400);
    }

    #[test]
    fn max_age_會被圖片的剩餘壽命壓下來() {
        let now = 1_785_755_047;
        // 沒有期限 → 用預設值
        assert_eq!(response_max_age(None, now), BROWSER_CACHE_SECS);
        // 圖比預設值晚到期 → 還是預設值（不會超過）
        assert_eq!(response_max_age(Some(now + 99_999), now), BROWSER_CACHE_SECS);
        // 圖 5 分鐘後到期 → 只能讓瀏覽器留 5 分鐘，否則它會拿著死連結用滿 30 分
        assert_eq!(response_max_age(Some(now + 300), now), 300);
        // 已經過期 → 0，不是負數（負數會產生無效的標頭值）
        assert_eq!(response_max_age(Some(now - 1), now), 0);
    }

    #[test]
    fn 相對路徑的_og_image_會補成絕對網址() {
        // og:image 給相對路徑很常見。不補的話前端拿到 "/img/a.png" 丟給
        // image-proxy，proxy 解不出 host 就整張圖不見——而卡片其他欄位都正常，
        // 看起來只像「這個站沒有預覽圖」
        let base = "https://example.com/blog/post-1?x=1";
        assert_eq!(absolutize(base, "/img/a.png").as_deref(), Some("https://example.com/img/a.png"));
        assert_eq!(absolutize(base, "cover.png").as_deref(), Some("https://example.com/blog/cover.png"));
        assert_eq!(
            absolutize(base, "//cdn.example.com/a.png").as_deref(),
            Some("https://cdn.example.com/a.png")
        );
        // 已經是絕對網址就原樣返回（join 的語義）
        assert_eq!(absolutize(base, "https://other.test/a.png").as_deref(), Some("https://other.test/a.png"));
        // base 壞掉就回 None，不要拼出一個怪東西
        assert_eq!(absolutize("не-url", "/a.png"), None);
    }

    #[test]
    fn meta_容忍屬性順序顛倒_也吃得到_title_標籤() {
        // 這兩條走的是 meta_content 的第二個樣式與 title_tag 的退路。
        // 少了它們，某些站的卡片會只剩網域名——而不會有任何錯誤
        let reversed = r#"<meta content="倒著寫的標題" property="og:title">"#;
        assert_eq!(meta_content(reversed, &["og:title"]).as_deref(), Some("倒著寫的標題"));

        // 完全沒有 og:title 時退回 <title>
        let only_title = "<html><head><title>  純 title 標籤  </title></head></html>";
        assert_eq!(meta_content(only_title, &["og:title"]), None);
        assert_eq!(title_tag(only_title).as_deref(), Some("純 title 標籤"), "要 trim");

        // 空的 content 不算數，要繼續找下一個 key
        let empty_first =
            r#"<meta property="og:title" content="  "><meta name="twitter:title" content="備用">"#;
        assert_eq!(meta_content(empty_first, &["og:title", "twitter:title"]).as_deref(), Some("備用"));
        // 空的 <title> 也一樣不算
        assert_eq!(title_tag("<title>   </title>"), None);
    }

    // ── 端點本體（快取那一側）─────────────────────────────────────────
    //
    // 抓取那一段測不到——net_guard 會擋掉任何 loopback 位址，而本機跑得起來的
    // mock server 位址依定義就落在被擋的網段裡（127.0.0.2 還是 loopback，
    // docker bridge 的 172.17.x 是私網）。要測就得在 SSRF 守衛上開一個全域關閉
    // 開關，而那正是 cargo-mutants 證明過「壞了會安靜地壞」的那個函式，不划算。
    //
    // 但快取那一側完全不需要網路，而且它壞掉的症狀同樣是安靜的：
    // hover 卡永遠是舊的、或每次 hover 都重抓。以下都走 DB。

    use crate::state::AppState;
    use axum::extract::{Query, State};

    /// 直接呼叫 handler（不經 router），回 (Cache-Control 的秒數, body)。
    async fn preview(state: &AppState, url: &str) -> (i64, LinkPreviewResponse) {
        let ([(_, cc)], Json(body)) =
            link_preview(State(state.clone()), Query(LinkPreviewQuery { url: url.into() }))
                .await
                .expect("這支永遠回 200");
        let secs = cc.rsplit_once('=').expect("max-age=N").1.parse().expect("秒數是數字");
        (secs, body)
    }

    /// 塞一列快取。`age_secs` 是「幾秒前抓的」。
    async fn cache_row(state: &AppState, url: &str, image: Option<&str>, age_secs: i64) {
        sqlx::query(
            "INSERT INTO link_previews (url, title, description, image, site_name, fetched_at) \
             VALUES (?, '快取標題', '快取描述', ?, ?, datetime('now', ?))",
        )
        .bind(url)
        .bind(image)
        .bind(Option::<&str>::None) // site_name 留空，驗它會退回 host
        .bind(format!("-{age_secs} seconds"))
        .execute(&state.pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn 快取命中就直接回_不碰網路() {
        let state = crate::state::test_state().await;
        let url = "https://example.com/a";
        cache_row(&state, url, Some("https://cdn.example.com/a.png"), 60).await;

        let (max_age, body) = preview(&state, url).await;
        assert_eq!(body.title.as_deref(), Some("快取標題"));
        assert_eq!(body.description.as_deref(), Some("快取描述"));
        assert_eq!(body.image.as_deref(), Some("https://cdn.example.com/a.png"));
        // 存的時候 site_name 是 NULL → 回應要退回 host，而不是給前端一個 null
        assert_eq!(body.site_name.as_deref(), Some("example.com"));
        assert_eq!(body.favicon.as_deref(), Some("https://example.com/favicon.ico"));
        // 一般圖片沒有期限 → 用預設的 30 分鐘
        assert_eq!(max_age, BROWSER_CACHE_SECS);
    }

    #[tokio::test]
    async fn 快取過期就當作沒有() {
        let state = crate::state::test_state().await;
        // TTL 是 7 天。超過就要重抓，而這裡的重抓必定失敗，所以驗的是
        // 「沒有拿舊的那列來回」。
        //
        // ⚠ 網域刻意用 `.invalid`：那是 RFC 2606 保留的頂級網域，保證不會被註冊，
        //   DNS 查詢立刻 NXDOMAIN。用 example.com 之類的話這條測試會**真的對外
        //   發一個請求**——CI 上可能成功、可能因為對方改版而改變行為，那種測試
        //   的結果取決於別人的服務今天怎麼樣。
        let url = "https://expired.invalid/a";
        cache_row(&state, url, None, CACHE_TTL_SECS + 60).await;

        let (_, body) = preview(&state, url).await;
        assert!(body.title.is_none(), "過期的那列不該被拿來用：{:?}", body.title);
        // 抓不到也要給降級卡的兩個欄位，前端才有東西可以顯示
        assert_eq!(body.site_name.as_deref(), Some("expired.invalid"));
        assert_eq!(body.favicon.as_deref(), Some("https://expired.invalid/favicon.ico"));
    }

    #[tokio::test]
    async fn 預簽章的圖過期時_整列當作_miss_重抓() {
        let state = crate::state::test_state().await;
        // 這是 GitHub repo 卡片踩過的：og:image 五分鐘就到期，但這張表的 TTL 是 7 天。
        // 不看圖的期限的話，這一列會在剩下的 TTL 內一直供應一個回 401 的網址——
        // 讀者看到的是破圖，而後端每次都「快取命中」，log 上完全正常
        let now = now_epoch();
        let dead = format!(
            "https://repository-images.githubusercontent.com/x?X-Amz-Date={}&X-Amz-Expires=1",
            sigv4_at(now - 3600)
        );
        let url = "https://github.invalid/owner/repo";
        cache_row(&state, url, Some(&dead), 60).await; // 列本身還很新

        let (_, body) = preview(&state, url).await;
        assert!(body.title.is_none(), "圖死掉時整列要當 miss，不能只回舊資料");
    }

    #[tokio::test]
    async fn 預簽章的圖還活著時_max_age_縮到剩餘壽命() {
        let state = crate::state::test_state().await;
        let now = now_epoch();
        // 還有約 120 秒可活
        let alive = format!(
            "https://repository-images.githubusercontent.com/x?X-Amz-Date={}&X-Amz-Expires=300",
            sigv4_at(now - 180)
        );
        let url = "https://example.com/live";
        cache_row(&state, url, Some(&alive), 60).await;

        let (max_age, body) = preview(&state, url).await;
        assert_eq!(body.title.as_deref(), Some("快取標題"), "圖還活著就該命中快取");
        // 讓瀏覽器留滿 30 分鐘的話，它會拿著一份「圖已經死掉」的 JSON 用到最後
        assert!((100..=120).contains(&max_age), "max-age 應該貼著圖的剩餘壽命，得到 {max_age}");
    }

    #[tokio::test]
    async fn 擋下來的網址回空卡而且不給快取() {
        let state = crate::state::test_state().await;
        for bad in [
            "http://127.0.0.1/x",
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost/x",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "не-url",
        ] {
            let (max_age, body) = preview(&state, bad).await;
            // 回 200 + 空欄位是刻意的：前端顯示降級卡，不要因為一個 hover 就跳錯誤
            assert!(body.title.is_none(), "{bad} 不該有內容");
            assert!(body.site_name.is_none(), "{bad} 連 host 都不該回——那會洩漏被擋的目標");
            // max-age=0：被擋的判斷結果不值得快取
            assert_eq!(max_age, 0, "{bad} 不該讓瀏覽器記住");
        }
    }

    /// Unix 秒 → SigV4 的 `YYYYMMDDThhmmssZ`（`parse_sigv4_date` 的反函式，測試用）。
    fn sigv4_at(epoch: i64) -> String {
        let (days, rem) = (epoch.div_euclid(86_400), epoch.rem_euclid(86_400));
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
    }

    #[test]
    fn sigv4_at_與_parse_互為反函式() {
        // 上面三條測試都靠 sigv4_at 造資料。它自己錯了的話，那三條會用一個
        // 錯誤的時間戳去驗「圖有沒有過期」——測試照樣綠，但驗的是別的東西
        for epoch in [0, 1_785_755_047, 1_709_164_800, 946_684_800] {
            assert_eq!(parse_sigv4_date(&sigv4_at(epoch)), Some(epoch), "epoch={epoch}");
        }
    }
}
