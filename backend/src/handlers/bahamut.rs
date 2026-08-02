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
    let dir = std::path::Path::new(path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
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

pub fn build_state(database_url: &str) -> Arc<BahamutState> {
    let cookie_file = cookie_file_path(database_url);
    let jar = load_cookie(&cookie_file);
    let cf = cookie_file.clone();
    // rotation 守門：BAHARUNE 不見或非 JWT（不含 '.'）→ 不寫（別把好檔掏空成空 jar）。
    let client = AniGamer::new(ClientOptions::new(jar).on_cookies_rotated(Arc::new(move |jar| {
        let ok = jar.get("BAHARUNE").map(|b| b.contains('.')).unwrap_or(false);
        if ok && let Ok(json) = serde_json::to_string_pretty(jar) {
            // callback 為同步簽名（crate 內 async 路徑呼叫）；3.5KB 寫檔亞毫秒，可接受
            if let Err(e) = std::fs::write(&cf, json) {
                tracing::error!("[Bahamut] persist cookie fail: {e}");
            }
        }
    })));
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
use crate::util::{bind_val, iso_from_millis};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// bahamutPushAuth：X-Bahamut-Token（constant-time）或 admin JWT。
async fn push_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Response> {
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
    crate::auth::require_admin(headers, state).await.map(|_| ()).map_err(|e| e.into_response())
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
        return r;
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
        return r;
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
    let is_jwt = baharune.as_deref().map(|b| b != "deleted" && b.contains('.')).unwrap_or(false);
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
            (regex::Regex::new(r"[（(]\s*第[^)）]*[)）]").unwrap(), " "),
            (regex::Regex::new(r"\s*第[一二三四五六七八九十百零\d]+[季期]\s*$").unwrap(), ""),
            (regex::Regex::new(r"\s*[Ss](?:eason)?\s*\d+\s*$").unwrap(), ""),
            (regex::Regex::new(r"\s*\[[^\]]*\]\s*").unwrap(), " "),
        ]
    });
    static WS_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\s+").unwrap());
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
            j.pointer("/results/0/id").and_then(|v| v.as_i64())
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
        std::sync::LazyLock::new(|| regex::Regex::new(r"\[([^\]]+)\]\s*$").unwrap());
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
            let video_sn = ep.get("videoSn").and_then(|v| v.as_i64());
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
    let enabled = std::env::var("ENABLE_BAHAMUT_SYNC")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !enabled {
        tracing::info!("[Bahamut] sync worker disabled (ENABLE_BAHAMUT_SYNC unset) — Express cron 仍為寫者");
        return;
    }
    let delay = std::env::var("BAHAMUT_SYNC_DELAY_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(30u64);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        loop {
            let _ = sync_bahamut_history(&state).await;
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

#[cfg(test)]
mod sync_lock_tests {
    use super::*;

    /// BAHAMUT_COOKIE 是 process 全域的，而 `build_state` 在建 state 時就會讀它。
    static COOKIE_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    /// `validate()` 要求這 7 個 cookie 都在且非空，少一個就會在碰鎖之前 skip。
    const ALL_REQUIRED: &str = "BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; \
                                BAHAFLT=f; BAHAENUR=e; BAHARUNE=a.b.c";

    async fn state_with_cookies(cookie: Option<&str>) -> AppState {
        // SAFETY: 靠 COOKIE_ENV_LOCK 串行化（呼叫端持鎖）；讀完馬上還原。
        unsafe {
            match cookie {
                Some(c) => std::env::set_var("BAHAMUT_COOKIE", c),
                None => std::env::remove_var("BAHAMUT_COOKIE"),
            }
        }
        let st = crate::state::test_state().await;
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
}
