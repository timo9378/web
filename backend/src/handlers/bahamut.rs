//! 動畫瘋（bahamut）client 建構 + rotation 持久化。
//! 端點（/admin/bahamut/{status,cookie}）與 sync worker 見後續。
//! 設計：共享 `Arc<AniGamer>`（內部鎖），cookie 熱抽換走 `set_cookies`，不套外層鎖。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicI64;

use anigamer::{AniGamer, ClientOptions, CookieJar};

use crate::state::BahamutState;

/// cookie 持久化路徑：`BAHAMUT_COOKIE_FILE` env，否則 DATABASE_URL 同目錄 `.bahamut-cookie.json`。
fn cookie_file_path(database_url: &str) -> PathBuf {
    if let Ok(p) = std::env::var("BAHAMUT_COOKIE_FILE")
        && !p.is_empty()
    {
        return PathBuf::from(p);
    }
    let path = database_url.trim_start_matches("sqlite://");
    let dir = std::path::Path::new(path).parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    dir.join(".bahamut-cookie.json")
}

/// 啟動時：先吃檔（最新 rotated），沒有再 fallback env `BAHAMUT_COOKIE`。
fn load_cookie(file: &PathBuf) -> CookieJar {
    if let Ok(content) = std::fs::read_to_string(file)
        && let Ok(jar) = serde_json::from_str::<CookieJar>(&content)
    {
        return jar;
    }
    anigamer::parse_cookie_string(std::env::var("BAHAMUT_COOKIE").ok().as_deref())
}

/// `urls` 只影響上游位址，預設值就是正式位址（見 `state::ExternalUrls`）。
/// 傳整個 `ExternalUrls` 而不是兩個字串，是為了讓「新增一個上游」只動一個地方。
pub fn build_state(database_url: &str, urls: &crate::state::ExternalUrls) -> Arc<BahamutState> {
    let cookie_file = cookie_file_path(database_url);
    let jar = load_cookie(&cookie_file);
    let cf = cookie_file.clone();
    // rotation 守門：BAHARUNE 不見或非 JWT（不含 '.'）→ 不寫（別把好檔掏空成空 jar）。
    let client = AniGamer::new(
        ClientOptions::new(jar).base_urls(&urls.bahamut_api, &urls.bahamut_web).on_cookies_rotated(Arc::new(
            move |jar| {
                let ok = jar.get("BAHARUNE").is_some_and(|b| b.contains('.'));
                if ok && let Ok(json) = serde_json::to_string_pretty(jar) {
                    // callback 為同步簽名（crate 內 async 路徑呼叫）；3.5KB 寫檔亞毫秒，可接受
                    if let Err(e) = std::fs::write(&cf, json) {
                        tracing::error!("[Bahamut] persist cookie fail: {e}");
                    }
                }
            },
        )),
    );
    Arc::new(BahamutState {
        client: Arc::new(client),
        sync_lock: tokio::sync::Mutex::new(()),
        last_jwt_alert_at: AtomicI64::new(0),
        cookie_file,
    })
}

// ── 端點 + sync worker ────────────────────────────────────────────────────
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use std::sync::atomic::Ordering;
use std::time::Duration;

use crate::state::AppState;
use crate::util::{bind_val, iso_from_millis, now_ms};

/// bahamutPushAuth：X-Bahamut-Token（constant-time）或 admin JWT。
///
/// ⚠️ `Err` 裝 `Box<Response>` 而不是裸的 `Response`：rust 1.98 起 clippy 的
/// `result_large_err` 會咬 128 bytes 的 `axum::Response`，而 CI 是 `-D warnings`。
/// 這條路徑一次請求最多走一次，多一層 Box 的代價可以忽略。
async fn push_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Box<Response>> {
    if let Ok(token) = std::env::var("BAHAMUT_PUSH_TOKEN")
        && !token.is_empty()
    {
        let got = headers.get("X-Bahamut-Token").and_then(|v| v.to_str().ok()).unwrap_or("");
        if got.len() == token.len() {
            let mut d = 0u8;
            for (a, b) in got.bytes().zip(token.bytes()) {
                d |= a ^ b;
            }
            if d == 0 {
                return Ok(());
            }
        }
    }
    crate::auth::require_admin(headers, state).await.map(|_| ()).map_err(|e| Box::new(e.into_response()))
}

/// `jwtStatus` → (jwtExpiresAt ISO|null, daysLeft|null)。
fn jwt_fields(state: &AppState) -> (Value, Value) {
    match state.bahamut.client.jwt_status() {
        Some(s) => (
            Value::from(iso_from_millis(s.expires_at_ms)),
            Value::from(s.seconds_until_expiry.div_euclid(86_400)),
        ),
        None => (Value::Null, Value::Null),
    }
}

/// `GET /api/admin/bahamut/status`
#[utoipa::path(get, path = "/api/admin/bahamut/status", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "動畫瘋 cookie/JWT 狀態（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(r) = push_auth(&headers, &state).await {
        return *r;
    }
    let (ok, missing) = state.bahamut.client.validate();
    let (jwt_at, days) = jwt_fields(&state);
    Json(json!({ "ok": ok, "missing": missing, "jwtExpiresAt": jwt_at, "daysLeft": days })).into_response()
}

/// `POST /api/admin/bahamut/cookie` —— 熱更新 cookie（jar 或 cookie 字串）+ 觸發同步。
#[utoipa::path(post, path = "/api/admin/bahamut/cookie", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "熱更新 cookie + 觸發同步（動態 JSON）"), (status = 400, description = "缺少或無效 cookie"), (status = 401, description = "未授權")))]
pub async fn cookie(
    State(state): State<AppState>,
    headers: HeaderMap,
    crate::error::JsonBody(body): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    if let Err(r) = push_auth(&headers, &state).await {
        return *r;
    }
    // input：body.jar（object）或 body.cookie（string）
    let jar = if let Some(obj) = body.get("jar").and_then(|v| v.as_object()) {
        let mut j = anigamer::CookieJar::new();
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                j.insert(k.clone(), s.to_string());
            }
        }
        j
    } else if let Some(s) = body.get("cookie").and_then(|v| v.as_str()) {
        anigamer::parse_cookie_string(Some(s))
    } else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "message": "缺少 cookie 或 jar" })))
            .into_response();
    };

    let (ok, missing) = anigamer::validate_bahamut_cookies(&jar);
    if !ok {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "message": "缺少必要 cookie", "missing": missing })),
        )
            .into_response();
    }
    // jwtStatus 用新 jar：先算再換（避免順序歧義）
    let js = jar.get("BAHARUNE").and_then(|b| anigamer::check_jwt_expiry_default(b));
    // 寫檔 + 熱抽換（內部短鎖，非換整個 client）
    if let Ok(json) = serde_json::to_string_pretty(&jar)
        && let Err(e) = tokio::fs::write(&state.bahamut.cookie_file, json).await
    {
        tracing::error!("[Bahamut] persist cookie fail: {e}");
    }
    state.bahamut.client.set_cookies(jar);
    state.bahamut.last_jwt_alert_at.store(0, Ordering::Relaxed); // 換新 cookie → 重置告警節流
    tracing::info!("[Bahamut] cookie 經 endpoint 熱更新，觸發同步");

    let sync = sync_bahamut_history(&state).await;
    let (jwt_at, days) = match js {
        Some(s) => (
            Value::from(iso_from_millis(s.expires_at_ms)),
            Value::from(s.seconds_until_expiry.div_euclid(86_400)),
        ),
        None => (Value::Null, Value::Null),
    };
    Json(json!({ "ok": true, "jwtExpiresAt": jwt_at, "daysLeft": days, "sync": sync })).into_response()
}

// ── Discord 告警 ──────────────────────────────────────────────────────────

const JWT_WARN_THRESHOLD_SEC: i64 = 3 * 24 * 60 * 60;

async fn notify_discord(state: &AppState, content: &str) {
    let Ok(url) = std::env::var("DISCORD_WEBHOOK_URL") else { return };
    if url.is_empty() {
        return;
    }
    let _ = state
        .http
        .post(&url)
        .header("content-type", "application/json")
        .body(serde_json::to_string(&json!({ "content": content })).unwrap_or_default())
        .timeout(Duration::from_secs(8))
        .send()
        .await;
}

/// 24h 節流告警（對齊 TS `maybeAlertDiscord`）。
async fn maybe_alert_discord(state: &AppState, msg: &str) {
    let now = now_ms();
    if now - state.bahamut.last_jwt_alert_at.load(Ordering::Relaxed) <= 24 * 60 * 60 * 1000 {
        return;
    }
    state.bahamut.last_jwt_alert_at.store(now, Ordering::Relaxed);
    notify_discord(state, msg).await;
}

async fn check_bahamut_jwt_expiry(state: &AppState) {
    let baharune = state.bahamut.client.cookies().get("BAHARUNE").cloned();
    let is_jwt = baharune.as_deref().is_some_and(|b| b != "deleted" && b.contains('.'));
    if !is_jwt {
        let shown: String = baharune.clone().unwrap_or_else(|| "undefined".into()).chars().take(24).collect();
        maybe_alert_discord(
            state,
            &format!("⚠️ **動畫瘋 BAHARUNE 不是有效 JWT**（值：`{shown}`）— 觀看歷史同步停擺，請登入 ani.gamer.com.tw 重抓 cookie"),
        )
        .await;
        return;
    }
    let Some(s) = state.bahamut.client.jwt_status() else { return };
    tracing::info!(
        "[Bahamut] JWT exp {} ({}d left)",
        iso_from_millis(s.expires_at_ms),
        s.seconds_until_expiry / 86400
    );
    if s.is_expired || s.seconds_until_expiry < JWT_WARN_THRESHOLD_SEC {
        let days = (s.seconds_until_expiry / 86400).max(0);
        let msg = if s.is_expired {
            "⚠️ **動畫瘋 cookie 已過期** — 觀看歷史同步停擺，請登入 ani.gamer.com.tw 重抓 cookie 更新 BAHAMUT_COOKIE".to_string()
        } else {
            format!(
                "⏳ **動畫瘋 cookie 剩 {days} 天到期**（{}）— 找時間登入 ani.gamer.com.tw 重抓 cookie",
                iso_from_millis(s.expires_at_ms)
            )
        };
        maybe_alert_discord(state, &msg).await;
    }
}

// ── 動畫 TMDb 補值 ────────────────────────────────────────────────────────

fn simplify_anime_title(t: &str) -> String {
    static SUBS: std::sync::LazyLock<[(regex::Regex, &'static str); 4]> = std::sync::LazyLock::new(|| {
        [
            (regex::Regex::new(r"[（(]\s*第[^)）]*[)）]").expect("字面 regex"), " "),
            (regex::Regex::new(r"\s*第[一二三四五六七八九十百零\d]+[季期]\s*$").expect("字面 regex"), ""),
            (regex::Regex::new(r"\s*[Ss](?:eason)?\s*\d+\s*$").expect("字面 regex"), ""),
            (regex::Regex::new(r"\s*\[[^\]]*\]\s*").expect("字面 regex"), " "),
        ]
    });
    static WS_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\s+").expect("字面 regex"));
    let mut s = t.to_string();
    for (re, rep) in SUBS.iter() {
        s = re.replace_all(&s, *rep).into_owned();
    }
    s = s.replace('：', ":");
    s = WS_RE.replace_all(&s, " ").into_owned();
    s.trim().to_string()
}

async fn tmdb_search_tv_id(state: &AppState, token: &str, title: &str) -> Option<i64> {
    let q = |query: String| {
        let http = state.http.clone();
        let token = token.to_string();
        async move {
            let resp = http
                .get(format!(
                    "{}/3/search/tv?query={}&language=zh-TW&include_adult=false",
                    crate::util::tmdb_api(),
                    crate::util::encode_uri_component(&query)
                ))
                .bearer_auth(&token)
                .header("accept", "application/json")
                .send()
                .await
                .ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let j: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
            j.pointer("/results/0/id").and_then(serde_json::Value::as_i64)
        }
    };
    if let Some(id) = q(title.to_string()).await {
        return Some(id);
    }
    let s = simplify_anime_title(title);
    if !s.is_empty() && s != title {
        return q(s).await;
    }
    None
}

async fn enrich_null_anime(state: &AppState) {
    let Some(token) = std::env::var("TMDB_API_TOKEN").ok().filter(|s| !s.is_empty()) else { return };
    let rows = sqlx::query_as::<_, (i64, Option<String>)>(
        "SELECT anime_sn, MAX(title) AS title FROM anime_history WHERE tmdb_id IS NULL GROUP BY anime_sn",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    if rows.is_empty() {
        return;
    }
    let mut ok = 0;
    for (sn, title) in &rows {
        let Some(title) = title else { continue };
        if let Some(id) = tmdb_search_tv_id(state, &token, title).await {
            let _ = sqlx::query("UPDATE anime_history SET tmdb_id = ? WHERE anime_sn = ?")
                .bind(id)
                .bind(sn)
                .execute(&state.pool)
                .await;
            ok += 1;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    tracing::info!("[Bahamut] anime TMDb enrich: {ok}/{} matched", rows.len());
}

/// 動畫瘋歷史同步（移植 `syncBahamutHistory`）。回傳結果 JSON（對齊 Express 回應物件）。
pub async fn sync_bahamut_history(state: &AppState) -> Value {
    let (ok, missing) = state.bahamut.client.validate();
    if !ok {
        tracing::info!("[Bahamut] cookie missing {} — skip sync", missing.join(","));
        return json!({ "ok": false, "skipped": "missing-cookie", "missing": missing });
    }
    // 防重入：拿不到鎖＝已在跑
    let Ok(_guard) = state.bahamut.sync_lock.try_lock() else {
        tracing::info!("[Bahamut] sync already in progress, skip");
        return json!({ "ok": false, "busy": true });
    };
    tracing::info!("[Bahamut] sync start");
    check_bahamut_jwt_expiry(state).await;

    let all = match state.bahamut.client.history_all(None).await {
        Ok(h) => h,
        Err(e) => {
            tracing::error!("[Bahamut] sync error: {e}");
            let auth = matches!(&e, anigamer::Error::Api(a) if a.is_auth_error());
            if auth {
                maybe_alert_discord(
                    state,
                    "⚠️ **動畫瘋 session 失效（NO_LOGIN）** — 請在動畫瘋分頁點瀏覽器擴充推一次新 cookie。",
                )
                .await;
                return json!({ "ok": false, "deadSession": true, "error": e.to_string() });
            }
            return json!({ "ok": false, "error": e.to_string() });
        }
    };
    if all.is_empty() {
        tracing::warn!("[Bahamut] historyAll 回 0 筆 — session 多半已失效（NO_LOGIN）");
        maybe_alert_discord(state, "⚠️ **動畫瘋同步抓到 0 筆**，session 多半已失效。請在動畫瘋分頁點瀏覽器擴充推一次新 cookie（或後台更新）。").await;
        return json!({ "ok": false, "deadSession": true, "totalEntries": 0, "newEntries": 0 });
    }

    let mut total = 0i64;
    let mut new_entries = 0i64;
    let mut covers_fetched = 0i64;

    // unique anime_sn（保序去重）
    let mut unique: Vec<i64> = Vec::new();
    for e in &all {
        if e.anime_sn != 0 && !unique.contains(&e.anime_sn) {
            unique.push(e.anime_sn);
        }
    }
    // 現有 cover（行為清理：原 per-sn N+1 → 一次 GROUP BY 撈全部，結果等價）
    let mut covers: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if !unique.is_empty() {
        let placeholders = vec!["?"; unique.len()].join(",");
        let sql = format!(
            "SELECT anime_sn, MAX(cover_url) FROM anime_history              WHERE anime_sn IN ({placeholders}) AND cover_url IS NOT NULL AND cover_url != ''              GROUP BY anime_sn"
        );
        let mut q = sqlx::query_as::<_, (i64, String)>(sqlx::AssertSqlSafe(sql.as_str()));
        for sn in &unique {
            q = q.bind(sn);
        }
        if let Ok(rows) = q.fetch_all(&state.pool).await {
            covers.extend(rows);
        }
    }
    // 沒 cover 的抓（og:image）
    for sn in &unique {
        if covers.contains_key(sn) {
            continue;
        }
        if let Ok(Some(cover)) = state.bahamut.client.cover(*sn).await {
            covers.insert(*sn, cover);
            covers_fetched += 1;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    // upsert 每集（展開 raw.history）
    static EP_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\[([^\]]+)\]\s*$").expect("字面 regex"));
    let ep_re = &*EP_RE;
    for entry in &all {
        if entry.anime_sn == 0 {
            continue;
        }
        let cover_url = covers.get(&entry.anime_sn).cloned().unwrap_or_default();
        // raw.history[] 或退回單筆
        let eps: Vec<Value> = entry
            .raw
            .pointer("/history")
            .and_then(|h| h.as_array())
            .filter(|a| !a.is_empty())
            .cloned()
            .unwrap_or_else(|| {
                vec![json!({
                    "videoSn": entry.video_sn,
                    "title": entry.title,
                    "watchTime": entry.watched_at,
                })]
            });
        for ep in &eps {
            let video_sn = ep.get("videoSn").and_then(serde_json::Value::as_i64);
            let Some(video_sn) = video_sn.filter(|&v| v != 0) else { continue };
            let ep_title = ep.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let ep_label = ep_re.captures(ep_title).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
            let watch_at = ep.get("watchTime").and_then(|v| v.as_str()).map(String::from);

            let is_new = sqlx::query_scalar::<_, i64>(
                "SELECT 1 FROM anime_history WHERE anime_sn = ? AND video_sn = ?",
            )
            .bind(entry.anime_sn)
            .bind(video_sn)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .is_none();
            if is_new {
                new_entries += 1;
            }
            let mut q = sqlx::query(
                "INSERT INTO anime_history (anime_sn, video_sn, title, cover_url, episode, last_watched_at, synced_at) \
                 VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) \
                 ON CONFLICT(anime_sn, video_sn) DO UPDATE SET \
                   title = excluded.title, \
                   cover_url = COALESCE(NULLIF(excluded.cover_url, ''), anime_history.cover_url), \
                   episode = COALESCE(excluded.episode, anime_history.episode), \
                   last_watched_at = COALESCE(excluded.last_watched_at, anime_history.last_watched_at), \
                   synced_at = CURRENT_TIMESTAMP",
            );
            q = q.bind(entry.anime_sn).bind(video_sn).bind(&entry.title).bind(&cover_url);
            let ep_label_v = ep_label.clone().map(Value::String);
            let watch_at_v = watch_at.clone().map(Value::String);
            q = bind_val(q, ep_label_v.as_ref());
            q = bind_val(q, watch_at_v.as_ref());
            if let Err(e) = q.execute(&state.pool).await {
                tracing::warn!(
                    "[Bahamut] upsert anime_history fail (sn={} ep={video_sn}): {e}",
                    entry.anime_sn
                );
            }
            total += 1;
        }
    }

    enrich_null_anime(state).await;
    tracing::info!(
        "[Bahamut] sync done: {total} entries, {new_entries} new, {covers_fetched} covers ({} unique)",
        unique.len()
    );
    json!({ "ok": true, "totalEntries": total, "newEntries": new_entries, "coversFetched": covers_fetched })
}

/// 啟動 bahamut 同步 worker（`ENABLE_BAHAMUT_SYNC=1` 才啟動；30s 首跑 + 6h 週期）。
pub fn spawn_sync(state: AppState) {
    let enabled =
        std::env::var("ENABLE_BAHAMUT_SYNC").is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    if !enabled {
        tracing::info!("[Bahamut] sync worker disabled (ENABLE_BAHAMUT_SYNC unset) — Express cron 仍為寫者");
        return;
    }
    let delay = std::env::var("BAHAMUT_SYNC_DELAY_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(30u64);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        loop {
            let _ = sync_bahamut_history(&state).await;
            tokio::time::sleep(Duration::from_hours(6)).await;
        }
    });
}

#[cfg(test)]
mod sync_lock_tests {
    use super::*;

    /// 動畫瘋的標題帶季數／中括號標記，拿去查 TMDb 之前要正規化。
    ///
    /// 這支錯了不會有錯誤訊息：TMDb 查不到 → tmdb_id 是 null → 那部動畫在
    /// 「正在看」與影集牆上就是**沒有封面的一格灰底**。而它出錯的方式很細，
    /// 例如把「第一季」的規則寫成不錨定行尾，會連片名裡的「第一次」都吃掉。
    #[test]
    fn simplify_anime_title_只去掉季數標記不動片名() {
        // 括號裡的「第 N 季」
        assert_eq!(simplify_anime_title("葬送的芙莉蓮（第二季）"), "葬送的芙莉蓮");
        assert_eq!(simplify_anime_title("孤獨搖滾 (第 2 季)"), "孤獨搖滾");
        // 行尾的「第 N 季／期」（中文數字與阿拉伯數字都要）
        assert_eq!(simplify_anime_title("進擊的巨人 第三季"), "進擊的巨人");
        assert_eq!(simplify_anime_title("咒術迴戰 第2期"), "咒術迴戰");
        assert_eq!(simplify_anime_title("鬼滅之刃 第十二季"), "鬼滅之刃");
        // 行尾的 S2 / Season 2
        assert_eq!(simplify_anime_title("SPY×FAMILY S2"), "SPY×FAMILY");
        assert_eq!(simplify_anime_title("Vinland Saga Season 2"), "Vinland Saga");
        // 中括號標記
        assert_eq!(simplify_anime_title("[中文字幕] 電鋸人"), "電鋸人");
        assert_eq!(simplify_anime_title("轉生史萊姆[劇場版]"), "轉生史萊姆");
        // 全形冒號換半形（TMDb 的資料用半形）
        assert_eq!(simplify_anime_title("刀劍神域：序列爭戰"), "刀劍神域:序列爭戰");
        // 多餘空白收成一個並 trim
        assert_eq!(simplify_anime_title("  空白   很多   的片名  "), "空白 很多 的片名");

        // ⚠ 不該被誤傷的：季數規則錨定行尾，片名中間的「第…」要留著
        assert_eq!(simplify_anime_title("我的第一次戀愛"), "我的第一次戀愛");
        assert_eq!(simplify_anime_title("第五人格"), "第五人格");
        assert_eq!(simplify_anime_title("三月的獅子"), "三月的獅子");
        // 沒有任何標記的原樣返回
        assert_eq!(simplify_anime_title("戀愛可以持續到天長地久"), "戀愛可以持續到天長地久");
        assert_eq!(simplify_anime_title(""), "");
    }

    /// BAHAMUT_COOKIE 是 process 全域的，而 `build_state` 在建 state 時就會讀它。
    static COOKIE_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    /// `validate()` 要求這 7 個 cookie 都在且非空，少一個就會在碰鎖之前 skip。
    const ALL_REQUIRED: &str = "BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; \
                                BAHAFLT=f; BAHAENUR=e; BAHARUNE=a.b.c";

    async fn state_with_cookies(cookie: Option<&str>) -> AppState {
        state_with_cookies_at(cookie, None).await
    }

    /// 同上，但 `base` 有給時把兩個動畫瘋上游指過去（`ExternalUrls::all_pointing_at`）。
    async fn state_with_cookies_at(cookie: Option<&str>, base: Option<&str>) -> AppState {
        // SAFETY: 靠 COOKIE_ENV_LOCK 串行化（呼叫端持鎖）；讀完馬上還原。
        unsafe {
            match cookie {
                Some(c) => std::env::set_var("BAHAMUT_COOKIE", c),
                None => std::env::remove_var("BAHAMUT_COOKIE"),
            }
        }
        let urls = match base {
            Some(b) => crate::state::ExternalUrls::all_pointing_at(b),
            None => crate::state::ExternalUrls::default(),
        };
        let st = crate::state::test_state_with(urls).await;
        // SAFETY: 見上。
        unsafe { std::env::remove_var("BAHAMUT_COOKIE") };
        st
    }

    /// 防重入：已經有一個 sync 在跑時，第二個要直接 skip，**不是**排隊等它。
    ///
    /// 這裡不需要網路——`try_lock` 失敗的分支在 `history_all()` 之前就 return 了。
    /// 反過來說，如果哪天有人把 try_lock 改成 lock().await，這個測試會直接卡死超時，
    /// 那正是要擋的退化：sync 一次跑好幾分鐘，排隊等於把呼叫端全部掛住。
    #[tokio::test]
    async fn sync_skips_when_another_one_holds_the_lock() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let state = state_with_cookies(Some(ALL_REQUIRED)).await;

        let guard = state.bahamut.sync_lock.lock().await;
        let out = tokio::time::timeout(std::time::Duration::from_secs(5), sync_bahamut_history(&state))
            .await
            .expect("拿不到鎖時應該立刻 skip，不是等下去");

        assert_eq!(out["busy"], json!(true), "第二個 sync 要回報 busy");
        assert_eq!(out["ok"], json!(false));
        drop(guard);
    }

    /// cookie 不齊時在碰鎖之前就 skip——順序反過來的話，沒設定的部署會白佔鎖。
    /// 這個測試同時也擋住「無條件回 busy」那種讓上面測試綠掉的假實作。
    #[tokio::test]
    async fn sync_reports_missing_cookies_before_taking_the_lock() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let state = state_with_cookies(None).await;

        // 鎖佔著也不影響：這條路徑根本走不到鎖
        let _guard = state.bahamut.sync_lock.lock().await;
        let out = tokio::time::timeout(std::time::Duration::from_secs(5), sync_bahamut_history(&state))
            .await
            .expect("cookie 不齊時不該去等鎖");

        assert_eq!(out["skipped"], json!("missing-cookie"));
        assert_ne!(out["busy"], json!(true), "缺 cookie 被誤報成 busy 會讓人以為只是撞到並發");
        let missing = out["missing"].as_array().expect("missing 是陣列");
        assert_eq!(missing.len(), 7, "7 個必要 cookie 應該全部列出來");
    }

    // ── JWT 到期告警 ───────────────────────────────────────────────────
    //
    // 這一段是整支檔案裡「壞了最貴」的：cookie 到期是**必然**會發生的（動畫瘋的
    // BAHARUNE 有效期固定），而唯一的通知管道就是這裡發的那則 Discord 訊息。
    // 它不發，症狀是觀看紀錄某天起就不再更新——而站上沒有任何地方會顯示異常，
    // 通常是幾週後偶然點進「在看」才發現最新一集停在很久以前。
    //
    // 放在檔內而不是 tests/ 的理由：`check_bahamut_jwt_expiry` 是私有函式。
    // 直接呼叫它可以完全避開 `history_all()`，也就不必碰任何外部網站。

    /// 造一個 payload 帶 `exp` 的 BAHARUNE（簽章不驗，只解 payload）。
    /// `secs` 為負數＝已過期。
    fn baharune_expiring_in(secs: i64) -> String {
        use base64::Engine as _;
        let now = now_ms() / 1000;
        let payload = json!({ "exp": now + secs }).to_string();
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
        format!("eyJhbGciOiJIUzI1NiJ9.{b64}.sig")
    }

    fn cookies_with(baharune: &str) -> String {
        format!("BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; BAHAFLT=f; BAHAENUR=e; BAHARUNE={baharune}")
    }

    /// 架一台假的 Discord webhook，回 (server, 已設好的 state)。
    async fn with_discord(baharune: &str) -> (wiremock::MockServer, AppState) {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, ResponseTemplate};
        let server = wiremock::MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/hook"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;
        // SAFETY: 同本模組其他測試——靠 COOKIE_ENV_LOCK 串行化（呼叫端持鎖）。
        unsafe { std::env::set_var("DISCORD_WEBHOOK_URL", format!("{}/hook", server.uri())) };
        let state = state_with_cookies(Some(&cookies_with(baharune))).await;
        (server, state)
    }

    /// 假 webhook 收到的訊息內容（沒收到就是空陣列）。
    async fn alerts(server: &wiremock::MockServer) -> Vec<String> {
        server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter_map(|r| serde_json::from_slice::<Value>(&r.body).ok())
            .filter_map(|v| v.get("content").and_then(|c| c.as_str()).map(str::to_owned))
            .collect()
    }

    #[tokio::test]
    async fn baharune_不是_jwt_時發告警並帶上實際的值() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        // "deleted" 是動畫瘋登出時真的會塞進來的值——不是假想案例
        let (server, state) = with_discord("deleted").await;

        check_bahamut_jwt_expiry(&state).await;

        let msgs = alerts(&server).await;
        assert_eq!(msgs.len(), 1, "BAHARUNE 不是 JWT 時應該發一則告警");
        // 訊息裡要帶「實際看到什麼」。只說「cookie 有問題」的話，收到的人不知道
        // 是被登出（deleted）還是擴充推錯了東西，處理方式完全不同。
        assert!(msgs[0].contains("deleted"), "訊息沒帶上實際的值：{}", msgs[0]);
        assert!(msgs[0].contains("不是有效 JWT"));
    }

    #[tokio::test]
    async fn 已過期時發的是_已過期_那一則() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let (server, state) = with_discord(&baharune_expiring_in(-3600)).await;

        check_bahamut_jwt_expiry(&state).await;

        let msgs = alerts(&server).await;
        assert_eq!(msgs.len(), 1);
        // 「已過期」與「快到期」要分得開：前者是現在就壞了，後者還有時間慢慢處理
        assert!(msgs[0].contains("已過期"), "{}", msgs[0]);
        assert!(!msgs[0].contains("剩"), "已經過期了不該說還剩幾天：{}", msgs[0]);
    }

    #[tokio::test]
    async fn 三天內到期時發的是倒數那一則() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        // 門檻是 3 天；抓 2 天半，離門檻與離 0 都有距離
        let (server, state) = with_discord(&baharune_expiring_in(2 * 86_400 + 43_200)).await;

        check_bahamut_jwt_expiry(&state).await;

        let msgs = alerts(&server).await;
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].contains("剩 2 天到期"), "{}", msgs[0]);
    }

    #[tokio::test]
    async fn 還很久才到期時不吵人() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let (server, state) = with_discord(&baharune_expiring_in(30 * 86_400)).await;

        check_bahamut_jwt_expiry(&state).await;

        // 每次同步都發一則的話，這個頻道會變成沒有人在看的雜訊——
        // 然後真的到期那天那則也一樣不會有人看到。
        assert_eq!(alerts(&server).await.len(), 0, "還有 30 天不該告警");
    }

    #[tokio::test]
    async fn 二十四小時內只發一則() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let (server, state) = with_discord("deleted").await;

        // sync 預設每 6 小時跑一次，過期狀態會一直持續。沒有節流的話一天四則、
        // 一週二十八則，全是同一件事。
        for _ in 0..3 {
            check_bahamut_jwt_expiry(&state).await;
        }
        assert_eq!(alerts(&server).await.len(), 1, "24 小時內重複呼叫只該發一則");

        // 節流時間到了要能再發（否則第一則被漏看之後就再也不會提醒）
        state
            .bahamut
            .last_jwt_alert_at
            .store(now_ms() - 25 * 60 * 60 * 1000, std::sync::atomic::Ordering::Relaxed);
        check_bahamut_jwt_expiry(&state).await;
        assert_eq!(alerts(&server).await.len(), 2, "超過 24 小時應該可以再發一則");
    }

    #[tokio::test]
    async fn 沒設_webhook_時安靜略過而不是報錯() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        // SAFETY: 同上，靠 COOKIE_ENV_LOCK 串行化。
        unsafe { std::env::set_var("DISCORD_WEBHOOK_URL", "") };
        let state = state_with_cookies(Some(&cookies_with("deleted"))).await;

        // 沒設 webhook 是完全合法的部署方式（本機開發）。這條路徑若 panic 或
        // 阻塞，整個 sync 會被一個「選配的通知功能」拖垮。
        tokio::time::timeout(Duration::from_secs(5), check_bahamut_jwt_expiry(&state))
            .await
            .expect("沒設 webhook 不該卡住");
        // SAFETY: 同上。
        unsafe { std::env::remove_var("DISCORD_WEBHOOK_URL") };
    }

    // ── 同步本體 ───────────────────────────────────────────────────────
    //
    // 這一段一直測不到，因為 anigamer SDK 0.1.0 把上游位址寫死在 `format!` 裡，
    // 任何 mock server 都攔不下來（連 reqwest 的 `.resolve()` 都不行——那兩個是
    // https，TCP 導過去了但憑證對不上）。0.1.1 加了 `ClientOptions::base_urls`，
    // 這裡才走得進來。
    //
    // 為什麼值得測：這支的失敗模式全部是**安靜的**。去重的 key 寫錯 → 觀看紀錄
    // 重複；集數的正則錨點寫錯 → 每一集都叫同樣的名字；封面的 `NULLIF(...,'')`
    // 拿掉 → 重跑一次就把所有封面洗成空字串。三者都不會有錯誤訊息，站上看起來
    // 只是「資料怪怪的」。

    use wiremock::matchers::{method as wm_method, path as wm_path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// 掛一頁歷史紀錄。`entries` 是 Bahamut 的原始格式（含 `history` 陣列時會被展開）。
    async fn mount_history(server: &MockServer, entries: Value) {
        Mock::given(wm_method("GET"))
            .and(wm_path("/bahamut-api/anime/v3/history.php"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "data": { "history": entries, "totalPage": 1 } })),
            )
            .mount(server)
            .await;
    }

    /// 掛某個 sn 的 animeRef 頁（封面來自 og:image）。
    async fn mount_cover(server: &MockServer, sn: i64, image: &str) {
        Mock::given(wm_path("/bahamut-web/animeRef.php"))
            .and(query_param("sn", sn.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_string(format!(
                r#"<html><head><meta property="og:image" content="{image}"></head></html>"#
            )))
            .mount(server)
            .await;
    }

    async fn rows(state: &AppState) -> Vec<(i64, i64, String, Option<String>, Option<String>)> {
        sqlx::query_as(
            "SELECT anime_sn, video_sn, title, episode, cover_url FROM anime_history \
             ORDER BY anime_sn, video_sn",
        )
        .fetch_all(&state.pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn 同步會展開每集並抓封面() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // 一筆歷史 = 一部動畫，底下的 `history` 陣列才是各集。只存最外層那筆的話，
        // 一部動畫永遠只會有一集紀錄——而畫面上看起來只是「進度沒更新」
        mount_history(
            &server,
            json!([{
                "animeSn": 100, "videoSn": 900, "title": "測試動畫",
                "history": [
                    { "videoSn": 901, "title": "測試動畫 [01]", "watchTime": "2026-01-01 10:00:00" },
                    { "videoSn": 902, "title": "測試動畫 [02]", "watchTime": "2026-01-02 10:00:00" },
                ],
            }]),
        )
        .await;
        mount_cover(&server, 100, "https://p2.bahamut.com.tw/100.jpg").await;

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;

        assert_eq!(out["ok"], json!(true), "得到 {out}");
        assert_eq!(out["totalEntries"], json!(2), "兩集都要進去");
        assert_eq!(out["newEntries"], json!(2));
        assert_eq!(out["coversFetched"], json!(1), "同一部只該抓一次封面");

        let got = rows(&state).await;
        assert_eq!(got.len(), 2);
        // 集數是從標題結尾的 [..] 抓出來的。正則沒錨定行尾的話，片名裡的中括號
        // 會被當成集數（例如「轉生史萊姆[劇場版] [01]」會抓到「劇場版」）
        assert_eq!(got[0].3.as_deref(), Some("01"));
        assert_eq!(got[1].3.as_deref(), Some("02"));
        assert_eq!(got[0].4.as_deref(), Some("https://p2.bahamut.com.tw/100.jpg"));
    }

    #[tokio::test]
    async fn 沒有_history_陣列時退回外層那一筆() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // 舊資料或單集動畫沒有 history 陣列。沒有這條退路的話那些紀錄會整個消失，
        // 而回應的 totalEntries 會是 0——看起來像「同步成功但你沒看過東西」
        mount_history(
            &server,
            json!([
                { "animeSn": 200, "videoSn": 800, "title": "劇場版 [完]", "watchTime": "2026-02-01 10:00:00" },
                { "animeSn": 201, "videoSn": 801, "title": "空陣列", "history": [] },
            ]),
        )
        .await;
        mount_cover(&server, 200, "https://p2.bahamut.com.tw/200.jpg").await;
        mount_cover(&server, 201, "https://p2.bahamut.com.tw/201.jpg").await;

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;

        assert_eq!(out["totalEntries"], json!(2), "兩筆都要用外層資料補上");
        let got = rows(&state).await;
        assert_eq!(got[0].1, 800);
        assert_eq!(got[0].3.as_deref(), Some("完"));
        assert_eq!(got[1].1, 801);
    }

    #[tokio::test]
    async fn 重跑一次不會重複計新_也不會把封面洗掉() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        mount_history(
            &server,
            json!([{ "animeSn": 300, "videoSn": 700, "title": "重跑 [03]", "watchTime": "2026-03-01 10:00:00" }]),
        )
        .await;
        mount_cover(&server, 300, "https://p2.bahamut.com.tw/300.jpg").await;

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let first = sync_bahamut_history(&state).await;
        assert_eq!(first["newEntries"], json!(1));
        assert_eq!(first["coversFetched"], json!(1));

        let second = sync_bahamut_history(&state).await;
        assert_eq!(second["totalEntries"], json!(1));
        // newEntries 沒歸零的話，「這次同步抓到幾集新的」永遠等於總數
        assert_eq!(second["newEntries"], json!(0), "第二次沒有新的");
        // 已經有封面就不該再打 animeRef——那是一部動畫一次請求，抓過還抓等於
        // 每 6 小時對動畫瘋發一輪沒必要的流量
        assert_eq!(second["coversFetched"], json!(0), "已有封面就別再抓");

        let got = rows(&state).await;
        assert_eq!(got.len(), 1, "ON CONFLICT 應該是更新不是插入");
        // upsert 的 cover_url 用 COALESCE(NULLIF(excluded.cover_url,''), 舊值)。
        // 拿掉 NULLIF 的話，第二次同步（沒重抓封面 → 空字串）會把封面洗成空的
        assert_eq!(got[0].4.as_deref(), Some("https://p2.bahamut.com.tw/300.jpg"));
    }

    #[tokio::test]
    async fn 同一部動畫的多筆歷史只抓一次封面() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // unique 的去重若失效，一部有 24 集的動畫就會打 24 次 animeRef，
        // 每次之間還 sleep 400ms——同步時間從幾秒變成十幾秒，而且沒人會發現
        mount_history(
            &server,
            json!([
                { "animeSn": 400, "videoSn": 601, "title": "同部 [01]" },
                { "animeSn": 400, "videoSn": 602, "title": "同部 [02]" },
                { "animeSn": 400, "videoSn": 603, "title": "同部 [03]" },
            ]),
        )
        .await;
        Mock::given(wm_path("/bahamut-web/animeRef.php"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"<html><head><meta property="og:image" content="https://p2.bahamut.com.tw/400.jpg"></head></html>"#,
            ))
            .expect(1)
            .mount(&server)
            .await;

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;
        assert_eq!(out["totalEntries"], json!(3));
        assert_eq!(out["coversFetched"], json!(1));
        // expect(1) 在 server drop 時驗——真的只打了一次
    }

    #[tokio::test]
    async fn 沒有_anime_sn_或_video_sn_的紀錄要跳過() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // sn 為 0 的列進了 DB 之後是刪不掉的髒資料（主鍵是 anime_sn+video_sn），
        // 而且會在「在看」列表上顯示成一格無法點擊的空白卡
        mount_history(
            &server,
            json!([
                { "animeSn": 0, "videoSn": 500, "title": "沒有 animeSn" },
                { "animeSn": 500, "videoSn": 0, "title": "沒有 videoSn" },
                { "animeSn": 501, "title": "連 videoSn 欄位都沒有" },
                { "animeSn": 502, "videoSn": 502, "title": "正常的 [01]" },
            ]),
        )
        .await;
        Mock::given(wm_path("/bahamut-web/animeRef.php"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html></html>"))
            .mount(&server)
            .await;

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;
        assert_eq!(out["totalEntries"], json!(1), "只有最後那筆該進去");
        let got = rows(&state).await;
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, 502);
    }

    #[tokio::test]
    async fn 抓到零筆時判定為_session_失效並發告警() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // 動畫瘋的 session 失效不會回錯誤，是回 HTTP 200 + 空陣列。
        // 不特別判這個的話，同步會「成功」地把 0 筆寫進去，然後每 6 小時再成功一次，
        // 而沒有任何地方會顯示異常
        mount_history(&server, json!([])).await;
        Mock::given(wm_path("/discord"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
        // SAFETY: 靠 COOKIE_ENV_LOCK 串行化。
        unsafe { std::env::set_var("DISCORD_WEBHOOK_URL", format!("{}/discord", server.uri())) };

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;

        // SAFETY: 見上。
        unsafe { std::env::remove_var("DISCORD_WEBHOOK_URL") };
        assert_eq!(out["ok"], json!(false));
        assert_eq!(out["deadSession"], json!(true), "0 筆要當成 session 死掉，不是同步成功");
        assert_eq!(out["totalEntries"], json!(0));
    }

    #[tokio::test]
    async fn 上游回_no_login_時發告警並標記_deadsession() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // Bahamut 的錯誤是包在 HTTP 200 的信封裡（`{error:{status:"NO_LOGIN"}}`）。
        // 只看狀態碼的話這會被當成成功
        Mock::given(wm_path("/bahamut-api/anime/v3/history.php"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({ "error": { "code": 100, "status": "NO_LOGIN", "message": "請先登入" } }),
            ))
            .mount(&server)
            .await;
        Mock::given(wm_path("/discord"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
        // SAFETY: 靠 COOKIE_ENV_LOCK 串行化。
        unsafe { std::env::set_var("DISCORD_WEBHOOK_URL", format!("{}/discord", server.uri())) };

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;

        // SAFETY: 見上。
        unsafe { std::env::remove_var("DISCORD_WEBHOOK_URL") };
        assert_eq!(out["deadSession"], json!(true));
        assert!(out["error"].is_string(), "要把上游訊息帶回來，得到 {out}");
    }

    #[tokio::test]
    async fn 一般的上游錯誤不發告警也不標_deadsession() {
        let _env = COOKIE_ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        // 500 是對方暫時掛了，不是 cookie 過期。混在一起的話每次動畫瘋維護
        // 都會收到一則「請更新 cookie」——幾次之後那則通知就沒人看了
        Mock::given(wm_path("/bahamut-api/anime/v3/history.php"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        Mock::given(wm_path("/discord"))
            .respond_with(ResponseTemplate::new(204))
            .expect(0)
            .mount(&server)
            .await;
        // SAFETY: 靠 COOKIE_ENV_LOCK 串行化。
        unsafe { std::env::set_var("DISCORD_WEBHOOK_URL", format!("{}/discord", server.uri())) };

        let state = state_with_cookies_at(Some(ALL_REQUIRED), Some(&server.uri())).await;
        let out = sync_bahamut_history(&state).await;

        // SAFETY: 見上。
        unsafe { std::env::remove_var("DISCORD_WEBHOOK_URL") };
        assert_eq!(out["ok"], json!(false));
        assert!(out.get("deadSession").is_none(), "暫時性錯誤不該叫人去換 cookie：{out}");
    }
}
