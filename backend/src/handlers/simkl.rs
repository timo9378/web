//! Simkl 觀看紀錄同步（取代已停用的 Trakt 同步，見 docker-compose.yml 的 ENABLE_TRAKT_SYNC）。
//!
//! 背景：Trakt 在 2026-07-30 把「建立 API application」改成 VIP-only，並未預告刪除了免費
//! 帳號的既有 app（trakt/trakt-web PR #3057；症狀是 refresh 回 "session not found"、
//! device/code 回 "client not found"）。Simkl 是替代的資料來源。
//!
//! ⚠️ Simkl 的 API 規則跟 Trakt 很不一樣，照抄 Trakt 那套會被停權。官方原文：
//! - "For continuous sync, DO NOT use without fetching the Activity endpoint first."
//! - "Never run unconditional background polling timers without active user interaction."
//! - "Ensure you always use `date_from` … If you don't follow these rules, your client_id
//!   will be suspended."
//!
//! 所以這裡的流程是：
//!   1. GET /sync/activities            很輕，只回各類別的時間戳
//!   2. 跟 sync_state 存的游標比對        一樣就直接結束，不打任何 all-items
//!   3. GET /sync/all-items/?date_from=  只有時間戳變了才拉，而且只拉增量
//!
//! 相對 Trakt 少掉的東西：Simkl 的 token 不過期、沒有 refresh_token（回應只有
//! access_token / token_type / scope），所以 watch.rs 裡那整套 refresh 輪替 + mutex +
//! 原子寫檔 + double-check 完全不需要——那套機制本身就是 Trakt 授權被燒掉的原因之一。

use serde_json::Value;

use crate::state::AppState;

const SIMKL_API: &str = "https://api.simkl.com";
/// 官方要求帶「描述性」的 User-Agent（文件範例：`PlexMediaServer/1.43.1.10540`）。
const SIMKL_UA: &str = "koimsurai/1.0 (+https://koimsurai.com)";
/// 游標的 key。值是 /sync/activities 的 `all` 欄位，原樣存、原樣送回去當 date_from。
const CURSOR_KEY: &str = "simkl.activities_all";

fn client_id() -> String {
    std::env::var("SIMKL_CLIENT_ID").unwrap_or_default()
}

fn access_token() -> String {
    std::env::var("SIMKL_ACCESS_TOKEN").unwrap_or_default()
}

/// 官方要求每個請求都帶 client_id / app-name / app-version 這三個 query 參數。
fn with_required_params(path: &str) -> String {
    let sep = if path.contains('?') { '&' } else { '?' };
    format!("{SIMKL_API}{path}{sep}client_id={}&app-name=koimsurai&app-version=1.0", client_id())
}

async fn simkl_get(state: &AppState, path: &str) -> Option<Value> {
    let resp = state
        .http
        .get(with_required_params(path))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", access_token()))
        .header("simkl-api-key", client_id())
        .header("User-Agent", SIMKL_UA)
        .send()
        .await
        .ok()?;
    let status = resp.status();
    let body = resp.text().await.ok()?;
    if !status.is_success() {
        // 401/403 多半是 token 或 client_id 出事；印出來才不會像 Trakt 那次一路猜到底
        tracing::warn!("[Simkl] GET {path} → {status}: {}", body.chars().take(200).collect::<String>());
        return None;
    }
    serde_json::from_str(&body).ok()
}

async fn load_cursor(state: &AppState) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>("SELECT value FROM sync_state WHERE key = ?")
        .bind(CURSOR_KEY)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .flatten()
}

async fn save_cursor(state: &AppState, value: &str) {
    if let Err(e) = sqlx::query(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(CURSOR_KEY)
    .bind(value)
    .execute(&state.pool)
    .await
    {
        tracing::warn!("[Simkl] 游標寫入失敗（下次會重拉同一段）: {e}");
    }
}

/// `last_watched_at` → `YYYY-MM-DD`。Simkl 給的是 ISO8601，資料表存的是 DATE。
/// 拿不到日期時回 None 存 NULL——比塞一個假日期好，Trakt 那批 tv_history 的
/// watched_date 全是 NULL 就是因為來源真的沒給。
fn iso_to_date(raw: Option<&str>) -> Option<String> {
    let s = raw?;
    let d: String = s.chars().take(10).collect();
    if d.len() == 10 && d.as_bytes()[4] == b'-' { Some(d) } else { None }
}

/// Simkl 的 poster 是相對路徑（例 "15/15189563adfbde5fe9"），要自己組 CDN 網址。
///
/// ⚠️ **有 tmdb_id 就不要用這個**，見 `poster_for()`。
fn poster_url(raw: Option<&str>) -> Option<String> {
    let p = raw?;
    if p.is_empty() {
        return None;
    }
    Some(format!("https://wsrv.nl/?url=https://simkl.in/posters/{p}_m.webp"))
}

/// 決定要不要把 Simkl 的海報寫進 DB。**有 tmdb_id 就回 None。**
///
/// `films_recent` / `tv_recent` 會對「poster_url 是空的」那些列去 TMDb 補圖，補的是
/// w342 海報 **加上 original 的橫式 backdrop**（見 watch.rs 的 tmdb_detail）。填了 Simkl
/// 海報反而把那段補圖擋掉——結果 backdrop 永遠是 NULL，而「在看什麼」的橫幅 hero 沒有
/// backdrop 就退回拉寬海報，Simkl 的 `_m` 只有中等尺寸，拉寬就糊掉了。
///
/// 這是實際發生過的：Kung Fu Panda 4 同步進來之後橫幅明顯比 Trakt 那批模糊，
/// 因為 Trakt 的同步只寫 title/date/tmdb_id，把補圖的路留著。
///
/// 所以只有「Simkl 沒給 tmdb_id」時才用它的圖——那種情況 TMDb 補不了，有圖總比沒有好。
fn poster_for(tmdb_id: Option<i64>, raw: Option<&str>) -> Option<String> {
    if tmdb_id.is_some() {
        return None;
    }
    poster_url(raw)
}

fn as_i64(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_i64(),
        // ids.tmdb 在回應裡是字串（"1011985"），不是數字
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// 寫入一部電影。UNIQUE(title, watched_date) 讓重跑是冪等的。
async fn upsert_film(state: &AppState, item: &Value) -> bool {
    let Some(movie) = item.get("movie").filter(|v| !v.is_null()) else { return false };
    let Some(title) = movie.get("title").and_then(|v| v.as_str()) else { return false };
    let watched = iso_to_date(item.get("last_watched_at").and_then(|v| v.as_str()));

    let tmdb = as_i64(movie.pointer("/ids/tmdb"));

    let r = sqlx::query(
        "INSERT OR IGNORE INTO film_history \
           (title, watched_date, source, tmdb_id, poster_url, release_year) \
         VALUES (?, ?, 'simkl', ?, ?, ?)",
    )
    .bind(title)
    .bind(&watched)
    .bind(tmdb)
    .bind(poster_for(tmdb, movie.get("poster").and_then(|v| v.as_str())))
    .bind(as_i64(movie.get("year")))
    .execute(&state.pool)
    .await;

    match r {
        Ok(res) => res.rows_affected() > 0,
        Err(e) => {
            tracing::warn!("[Simkl] film_history 寫入失敗 ({title}): {e}");
            false
        }
    }
}

/// 寫入影集的每一集。
///
/// 需要 `extended=full&episode_watched_at=yes` 才有逐集的 watched_at——這是 Simkl 比
/// Trakt 好的地方（Trakt 同步進來的 151 筆 tv_history，watched_date 全是 NULL）。
/// 文件警告這個參數會讓回應「exponentially larger」，所以只在增量（有 date_from）時用。
async fn upsert_show_episodes(state: &AppState, item: &Value) -> u32 {
    let Some(show) = item.get("show").filter(|v| !v.is_null()) else { return 0 };
    let Some(series) = show.get("title").and_then(|v| v.as_str()) else { return 0 };
    let tmdb = as_i64(show.pointer("/ids/tmdb"));
    let poster = poster_for(tmdb, show.get("poster").and_then(|v| v.as_str()));

    let mut n = 0u32;
    for season in show.get("seasons").and_then(|v| v.as_array()).map(|a| a.as_slice()).unwrap_or(&[]) {
        let s_num = as_i64(season.get("number")).unwrap_or(0);
        for ep in season.get("episodes").and_then(|v| v.as_array()).map(|a| a.as_slice()).unwrap_or(&[]) {
            let e_num = as_i64(ep.get("number")).unwrap_or(0);
            let label = format!("S{s_num:02}E{e_num:02}");
            // 逐集的 watched_at；沒有就退回整部劇的 last_watched_at
            let watched = iso_to_date(ep.get("watched_at").and_then(|v| v.as_str()))
                .or_else(|| iso_to_date(item.get("last_watched_at").and_then(|v| v.as_str())));

            let r = sqlx::query(
                "INSERT OR IGNORE INTO tv_history \
                   (series_name, episode_label, watched_date, source, tmdb_id, poster_url) \
                 VALUES (?, ?, ?, 'simkl', ?, ?)",
            )
            .bind(series)
            .bind(&label)
            .bind(&watched)
            .bind(tmdb)
            .bind(&poster)
            .execute(&state.pool)
            .await;

            match r {
                Ok(res) if res.rows_affected() > 0 => n += 1,
                Ok(_) => {}
                Err(e) => tracing::warn!("[Simkl] tv_history 寫入失敗 ({series} {label}): {e}"),
            }
        }
    }
    n
}

/// 跑一次同步。回傳 (新增電影數, 新增集數)；沒有變動時回 (0, 0) 且不打 all-items。
pub async fn sync_once(state: &AppState) -> (u32, u32) {
    if client_id().is_empty() || access_token().is_empty() {
        tracing::warn!("[Simkl] 缺 SIMKL_CLIENT_ID / SIMKL_ACCESS_TOKEN — 跳過");
        return (0, 0);
    }

    // 步驟 1：先問 activities（官方規則的第一步）
    let Some(act) = simkl_get(state, "/sync/activities").await else {
        tracing::warn!("[Simkl] /sync/activities 失敗 — 跳過這次");
        return (0, 0);
    };
    let Some(latest) = act.get("all").and_then(|v| v.as_str()) else {
        // 帳號還沒有任何紀錄時 `all` 是 null，這是正常狀態不是錯誤
        tracing::info!("[Simkl] 帳號目前沒有任何觀看紀錄");
        return (0, 0);
    };

    // 步驟 2：比對游標。相同就結束——大部分的輪詢都會停在這裡。
    let cursor = load_cursor(state).await;
    if cursor.as_deref() == Some(latest) {
        tracing::debug!("[Simkl] 沒有變動（游標 {latest}）");
        return (0, 0);
    }

    // 步驟 3：有變才拉。有游標就走增量；沒有就是首次同步（Phase 1）。
    let path = match cursor.as_deref() {
        Some(from) => format!("/sync/all-items/?extended=full&episode_watched_at=yes&date_from={from}"),
        None => {
            tracing::info!("[Simkl] 首次同步（無游標）— 拉完整清單");
            "/sync/all-items/?extended=full".to_string()
        }
    };

    let Some(data) = simkl_get(state, &path).await else {
        // 沒拿到就不要動游標，下次重試同一段
        tracing::warn!("[Simkl] all-items 失敗 — 保留游標下次重試");
        return (0, 0);
    };

    let mut films = 0u32;
    let mut episodes = 0u32;
    for item in data.get("movies").and_then(|v| v.as_array()).map(|a| a.as_slice()).unwrap_or(&[]) {
        if upsert_film(state, item).await {
            films += 1;
        }
    }
    // shows 與 anime 的結構相同（都用 `show` 鍵），分開回傳而已
    for key in ["shows", "anime"] {
        for item in data.get(key).and_then(|v| v.as_array()).map(|a| a.as_slice()).unwrap_or(&[]) {
            episodes += upsert_show_episodes(state, item).await;
        }
    }

    // 只有真的處理完才推進游標——中途失敗時寧可下次重拉，也不要漏資料
    save_cursor(state, latest).await;
    tracing::info!("[Simkl] 同步完成：+{films} 部電影、+{episodes} 集（游標 → {latest}）");
    (films, episodes)
}

/// 啟動 Simkl 同步 worker（`ENABLE_SIMKL_SYNC=1` 才啟動）。
///
/// 週期預設 6 小時，但每次只會打一個很輕的 /sync/activities；只有時間戳變了才拉資料。
/// 這是官方 "Never run unconditional background polling timers" 那條規則的做法——
/// 被禁止的是無條件全量輪詢，不是定期檢查有沒有變動。
pub fn spawn_sync(state: AppState) {
    let enabled = std::env::var("ENABLE_SIMKL_SYNC")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !enabled {
        tracing::info!("[Simkl] sync worker disabled (ENABLE_SIMKL_SYNC unset)");
        return;
    }
    let delay = std::env::var("SIMKL_SYNC_DELAY_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(45u64);
    let period =
        std::env::var("SIMKL_SYNC_PERIOD_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(6 * 3600u64);
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        loop {
            let _ = sync_once(&state).await;
            tokio::time::sleep(std::time::Duration::from_secs(period)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_to_date_只取日期部分() {
        assert_eq!(iso_to_date(Some("2026-08-01T17:32:03Z")).as_deref(), Some("2026-08-01"));
        assert_eq!(iso_to_date(Some("2026-08-01")).as_deref(), Some("2026-08-01"));
    }

    #[test]
    fn iso_to_date_壞資料回_none_而不是假日期() {
        // 來源沒給日期時要存 NULL，不要塞一個看起來像真的的值
        assert_eq!(iso_to_date(None), None);
        assert_eq!(iso_to_date(Some("")), None);
        assert_eq!(iso_to_date(Some("not-a-date")), None);
        assert_eq!(iso_to_date(Some("2026/08/01")), None);
    }

    #[test]
    fn as_i64_同時吃數字與字串() {
        // Simkl 的 ids.tmdb 是字串（"1011985"），year 是數字——同一支程式要兩種都收
        assert_eq!(as_i64(Some(&serde_json::json!(2024))), Some(2024));
        assert_eq!(as_i64(Some(&serde_json::json!("1011985"))), Some(1_011_985));
        assert_eq!(as_i64(Some(&serde_json::json!(null))), None);
        assert_eq!(as_i64(Some(&serde_json::json!("abc"))), None);
        assert_eq!(as_i64(None), None);
    }

    #[test]
    fn poster_url_組出完整網址_空值回_none() {
        let u = poster_url(Some("15/15189563adfbde5fe9")).unwrap();
        assert!(u.contains("simkl.in/posters/15/15189563adfbde5fe9"), "{u}");
        assert_eq!(poster_url(Some("")), None);
        assert_eq!(poster_url(None), None);
    }

    #[test]
    fn 有_tmdb_id_就不寫_simkl_海報_留給_tmdb_補圖() {
        // 這是重點：填了 Simkl 海報會讓 films_recent 的補圖被跳過，連帶 backdrop 永遠是
        // NULL，橫幅只好拿直式海報拉寬 → 糊。有 tmdb_id 就一定要讓路。
        assert_eq!(poster_for(Some(1011985), Some("15/15189563adfbde5fe9")), None);
        // 沒有 tmdb_id 時 TMDb 補不了，這時 Simkl 的圖有總比沒有好
        let u = poster_for(None, Some("15/15189563adfbde5fe9")).unwrap();
        assert!(u.contains("simkl.in"), "{u}");
        // 兩邊都沒有就是沒有
        assert_eq!(poster_for(None, None), None);
        assert_eq!(poster_for(None, Some("")), None);
    }

    #[test]
    fn 必要參數一定會被帶上() {
        // 官方要求每個請求都要有 client_id / app-name / app-version，漏了會被視為違規
        unsafe { std::env::set_var("SIMKL_CLIENT_ID", "TESTID") };
        let a = with_required_params("/sync/activities");
        assert!(a.contains("?client_id=TESTID"), "{a}");
        assert!(a.contains("&app-name=koimsurai") && a.contains("&app-version="), "{a}");
        // 已經有 query string 時要用 & 接，不能再來一個 ?
        let b = with_required_params("/sync/all-items/?extended=full");
        assert!(b.contains("?extended=full&client_id=TESTID"), "{b}");
        assert_eq!(b.matches('?').count(), 1, "只能有一個問號: {b}");
    }
}
