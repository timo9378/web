//! `handlers/simkl.rs` 的整合測試。
//!
//! 檔內已經有 6 條純函式的單元測試（`iso_to_date` / `as_i64` / `poster_for` 等，
//! 那就是原本 30% 覆蓋率的來源）。這裡補的是 `sync_once` 整條流程——而那裡放的
//! 不只是「會不會壞」，是**違反就會被 Simkl 停權**的三條官方規則：
//!
//!   1. "DO NOT use without fetching the Activity endpoint first."
//!   2. "Never run unconditional background polling timers…"（→ 游標沒變就不准拉）
//!   3. "Ensure you always use `date_from` … your client_id will be suspended."
//!
//! 這種規則的可怕之處在於**違反了也照樣會動**：資料同步得好好的，直到某天
//! client_id 被停用，然後整個「在看什麼」靜靜地不再更新。單元測試看不到這些，
//! 因為它們不是「回傳值對不對」而是「有沒有發出不該發的請求」。
//!
//! ⚠ 用 `std::env::set_var` 指向 mock，**依賴 nextest 的行程隔離**。

mod common;

use common::test_app_with_state;
use koimsurai_web_backend::handlers::simkl::sync_once;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

/// 架好 mock 並把 env 指過去。`activities` 是 `/sync/activities` 的回應，
/// `items` 給 None 表示**不掛** all-items——那樣一旦程式違規去打它就會 404，
/// 而 404 → `simkl_get` 回 None，測試看得出來。
async fn mock_simkl(activities: Value, items: Option<Value>) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/sync/activities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(activities))
        .mount(&server)
        .await;
    if let Some(i) = items {
        Mock::given(method("GET"))
            .and(path("/sync/all-items/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(i))
            .mount(&server)
            .await;
    }
    unsafe {
        std::env::set_var("SIMKL_BASE_URL", server.uri());
        std::env::set_var("SIMKL_CLIENT_ID", "test-client");
        std::env::set_var("SIMKL_ACCESS_TOKEN", "test-token");
    }
    server
}

/// mock 收到的所有請求路徑（含 query）。
async fn paths(server: &MockServer) -> Vec<String> {
    let reqs: Vec<Request> = server.received_requests().await.unwrap();
    reqs.iter()
        .map(|r| {
            let u = &r.url;
            format!("{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default())
        })
        .collect()
}

async fn set_cursor(pool: &sqlx::SqlitePool, value: &str) {
    sqlx::query("INSERT INTO sync_state (key, value) VALUES ('simkl.activities_all', ?)")
        .bind(value)
        .execute(pool)
        .await
        .unwrap();
}

async fn cursor(pool: &sqlx::SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>("SELECT value FROM sync_state WHERE key = 'simkl.activities_all'")
        .fetch_optional(pool)
        .await
        .unwrap()
        .flatten()
}

// ── 三條停權規則 ──────────────────────────────────────────────────────────

/// **規則 1：一定先問 activities。**
///
/// 官方原文是 "For continuous sync, DO NOT use without fetching the Activity
/// endpoint first."——順序寫反不會有任何錯誤訊息，直到被停權。
#[tokio::test]
async fn activities_is_always_the_first_request() {
    let server = mock_simkl(json!({ "all": "2026-08-01T00:00:00Z" }), Some(json!({}))).await;
    let (_app, _pool, state) = test_app_with_state().await;

    sync_once(&state).await;

    let p = paths(&server).await;
    assert!(!p.is_empty(), "應該有發出請求");
    assert!(p[0].starts_with("/sync/activities"), "第一個請求必須是 activities，實際是 {}", p[0]);
}

/// **規則 2：游標沒變就一個 all-items 都不能打。**
///
/// 這是「Never run unconditional background polling timers」的實作。
/// 少了這道比對，worker 每 6 小時就會拉一次全量——那正是會被停權的行為。
///
/// mock 刻意**不掛** all-items：真的去打就會 404，而不是靜靜地通過。
#[tokio::test]
async fn an_unchanged_cursor_fetches_nothing_else() {
    let server = mock_simkl(json!({ "all": "2026-08-01T00:00:00Z" }), None).await;
    let (_app, pool, state) = test_app_with_state().await;
    set_cursor(&pool, "2026-08-01T00:00:00Z").await;

    let (films, eps) = sync_once(&state).await;
    assert_eq!((films, eps), (0, 0));

    let p = paths(&server).await;
    assert_eq!(p.len(), 1, "游標沒變時只該打一次 activities，實際打了 {p:?}");
    assert!(!p.iter().any(|x| x.contains("all-items")), "游標沒變卻去拉 all-items：{p:?}");
}

/// **規則 3：有游標時一定要帶 `date_from`。**
///
/// 官方原文直接寫了 "If you don't follow these rules, your client_id will be
/// suspended."。少了 date_from 就是每次拉全量——資料看起來一樣正確。
#[tokio::test]
async fn an_incremental_sync_always_sends_date_from() {
    let server = mock_simkl(json!({ "all": "2026-08-02T00:00:00Z" }), Some(json!({}))).await;
    let (_app, pool, state) = test_app_with_state().await;
    set_cursor(&pool, "2026-08-01T00:00:00Z").await;

    sync_once(&state).await;

    let p = paths(&server).await;
    let items = p.iter().find(|x| x.contains("all-items")).expect("游標變了就該拉 all-items");
    assert!(
        items.contains("date_from=2026-08-01T00%3A00%3A00Z")
            || items.contains("date_from=2026-08-01T00:00:00Z"),
        "增量同步必須帶上游標當 date_from，實際是 {items}"
    );
    assert!(items.contains("episode_watched_at=yes"), "增量才拿得到逐集時間：{items}");
}

/// 首次同步（沒有游標）→ 拉完整清單，而且**不帶** `date_from`。
///
/// 帶一個空的 date_from 會讓 Simkl 回空集合，而程式會把它當成「沒有新東西」
/// 然後把游標推進——之後就再也拉不到那批舊資料了。
#[tokio::test]
async fn the_first_sync_pulls_everything_without_a_date_from() {
    let server = mock_simkl(json!({ "all": "2026-08-02T00:00:00Z" }), Some(json!({}))).await;
    let (_app, _pool, state) = test_app_with_state().await;

    sync_once(&state).await;

    let p = paths(&server).await;
    let items = p.iter().find(|x| x.contains("all-items")).expect("首次應該拉 all-items");
    assert!(!items.contains("date_from"), "首次同步不該帶 date_from：{items}");
    assert!(items.contains("extended=full"), "{items}");
}

/// 每個請求都要帶 `client_id` / `app-name` / `app-version`——同樣是官方硬性要求。
#[tokio::test]
async fn every_request_carries_the_required_identification() {
    let server = mock_simkl(json!({ "all": "2026-08-02T00:00:00Z" }), Some(json!({}))).await;
    let (_app, _pool, state) = test_app_with_state().await;

    sync_once(&state).await;

    for p in paths(&server).await {
        assert!(p.contains("client_id=test-client"), "{p} 少了 client_id");
        assert!(p.contains("app-name=koimsurai"), "{p} 少了 app-name");
        assert!(p.contains("app-version="), "{p} 少了 app-version");
    }
}

// ── 游標的推進與保留 ──────────────────────────────────────────────────────

/// 成功之後游標推進到 activities 給的值。
#[tokio::test]
async fn a_successful_sync_advances_the_cursor() {
    let _s = mock_simkl(json!({ "all": "2026-08-02T12:00:00Z" }), Some(json!({}))).await;
    let (_app, pool, state) = test_app_with_state().await;

    sync_once(&state).await;

    assert_eq!(cursor(&pool).await.as_deref(), Some("2026-08-02T12:00:00Z"));
}

/// **all-items 失敗時游標不能推進。**
///
/// 推進了就等於宣告「這段已經處理完」，而實際上一筆都沒拿到——那段觀看紀錄
/// 就永遠不會再被拉一次。這是資料靜靜遺失的典型形狀。
#[tokio::test]
async fn a_failed_fetch_keeps_the_cursor_so_the_next_run_retries() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/sync/activities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "all": "2026-08-02T00:00:00Z" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/sync/all-items/"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("SIMKL_BASE_URL", server.uri());
        std::env::set_var("SIMKL_CLIENT_ID", "c");
        std::env::set_var("SIMKL_ACCESS_TOKEN", "t");
    }
    let (_app, pool, state) = test_app_with_state().await;
    set_cursor(&pool, "2026-08-01T00:00:00Z").await;

    let (f, e) = sync_once(&state).await;
    assert_eq!((f, e), (0, 0));
    assert_eq!(
        cursor(&pool).await.as_deref(),
        Some("2026-08-01T00:00:00Z"),
        "拉失敗時游標必須留在原地，否則那段紀錄永遠補不回來"
    );
}

/// activities 本身失敗 → 什麼都不做（不拉、不動游標）。
#[tokio::test]
async fn a_failing_activities_endpoint_stops_the_run() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/sync/activities"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("SIMKL_BASE_URL", server.uri());
        std::env::set_var("SIMKL_CLIENT_ID", "c");
        std::env::set_var("SIMKL_ACCESS_TOKEN", "t");
    }
    let (_app, pool, state) = test_app_with_state().await;

    assert_eq!(sync_once(&state).await, (0, 0));
    assert_eq!(paths(&server).await.len(), 1, "activities 掛了就不該再打別的");
    assert_eq!(cursor(&pool).await, None);
}

/// 帳號還沒有任何紀錄時 `all` 是 null——那是正常狀態，不是錯誤，也不該去拉。
#[tokio::test]
async fn an_empty_account_is_not_treated_as_an_error() {
    let server = mock_simkl(json!({ "all": Value::Null }), None).await;
    let (_app, pool, state) = test_app_with_state().await;

    assert_eq!(sync_once(&state).await, (0, 0));
    assert_eq!(paths(&server).await.len(), 1, "沒有紀錄時不該拉 all-items");
    assert_eq!(cursor(&pool).await, None, "也不該亂推游標");
}

/// 沒有設定憑證 → 一個請求都不發（而不是帶著空的 client_id 打上去被記一筆違規）。
#[tokio::test]
async fn missing_credentials_send_no_requests_at_all() {
    let server = mock_simkl(json!({ "all": "x" }), Some(json!({}))).await;
    for (id, token) in [("", "t"), ("c", ""), ("", "")] {
        unsafe {
            std::env::set_var("SIMKL_CLIENT_ID", id);
            std::env::set_var("SIMKL_ACCESS_TOKEN", token);
        }
        let (_app, _pool, state) = test_app_with_state().await;
        assert_eq!(sync_once(&state).await, (0, 0));
    }
    assert!(server.received_requests().await.unwrap().is_empty(), "缺憑證時不該對 Simkl 發出任何請求");
}

// ── 資料寫入 ──────────────────────────────────────────────────────────────

fn movie(title: &str, watched: &str, tmdb: Option<&str>, poster: Option<&str>, year: i64) -> Value {
    let mut ids = json!({});
    if let Some(t) = tmdb {
        ids["tmdb"] = json!(t);
    }
    json!({
        "last_watched_at": watched,
        "movie": { "title": title, "year": year, "ids": ids, "poster": poster },
    })
}

/// 電影寫進 film_history，欄位逐一對上。
#[tokio::test]
async fn films_are_written_with_their_fields() {
    let _s = mock_simkl(
        json!({ "all": "2026-08-02T00:00:00Z" }),
        Some(json!({ "movies": [movie("功夫熊貓 4", "2026-07-15T10:00:00Z", Some("1011985"), Some("15/abc"), 2024)] })),
    )
    .await;
    let (_app, pool, state) = test_app_with_state().await;

    let (films, _) = sync_once(&state).await;
    assert_eq!(films, 1);

    let row: (String, Option<String>, String, Option<i64>, Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT title, watched_date, source, tmdb_id, poster_url, release_year FROM film_history WHERE title = '功夫熊貓 4'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.1.as_deref(), Some("2026-07-15"), "ISO 時間要截成日期");
    assert_eq!(row.2, "simkl");
    assert_eq!(row.3, Some(1_011_985), "ids.tmdb 是字串，要轉成數字");
    assert_eq!(row.4, None, "**有 tmdb_id 就不能寫 Simkl 海報**——那會把 TMDb 補圖擋掉");
    assert_eq!(row.5, Some(2024));
}

/// 沒有 tmdb_id 時才用 Simkl 的海報（TMDb 補不了，有圖總比沒有好）。
#[tokio::test]
async fn a_film_without_a_tmdb_id_keeps_the_simkl_poster() {
    let _s = mock_simkl(
        json!({ "all": "2026-08-02T00:00:00Z" }),
        Some(json!({ "movies": [movie("冷門片", "2026-07-15T10:00:00Z", None, Some("15/abc"), 2024)] })),
    )
    .await;
    let (_app, pool, state) = test_app_with_state().await;
    sync_once(&state).await;

    let poster: Option<String> =
        sqlx::query_scalar("SELECT poster_url FROM film_history WHERE title = '冷門片'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(poster.unwrap().contains("simkl.in/posters/15/abc"));
}

/// 影集逐集寫入，標籤是 `S01E02` 的零填充格式。
#[tokio::test]
async fn shows_are_written_one_row_per_episode() {
    let _s = mock_simkl(
        json!({ "all": "2026-08-02T00:00:00Z" }),
        Some(json!({ "shows": [{
            "last_watched_at": "2026-07-20T10:00:00Z",
            "show": {
                "title": "某影集", "ids": { "tmdb": "555" },
                "seasons": [{ "number": 1, "episodes": [
                    { "number": 1, "watched_at": "2026-07-18T10:00:00Z" },
                    { "number": 2 },
                ]}],
            },
        }] })),
    )
    .await;
    let (_app, pool, state) = test_app_with_state().await;

    let (_, eps) = sync_once(&state).await;
    assert_eq!(eps, 2);

    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT episode_label, watched_date FROM tv_history WHERE series_name = '某影集' ORDER BY episode_label",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows[0].0, "S01E01");
    assert_eq!(rows[0].1.as_deref(), Some("2026-07-18"), "有逐集時間就用逐集的");
    assert_eq!(rows[1].0, "S01E02");
    assert_eq!(rows[1].1.as_deref(), Some("2026-07-20"), "沒有逐集時間才退回整部的 last_watched_at");
}

/// `anime` 跟 `shows` 結構相同，也要被處理——漏掉的話動畫就再也不會出現在「在看什麼」。
#[tokio::test]
async fn anime_is_processed_the_same_way_as_shows() {
    let _s = mock_simkl(
        json!({ "all": "2026-08-02T00:00:00Z" }),
        Some(json!({ "anime": [{
            "last_watched_at": "2026-07-20T10:00:00Z",
            "show": { "title": "某動畫", "ids": {}, "seasons": [{ "number": 1, "episodes": [{ "number": 3 }] }] },
        }] })),
    )
    .await;
    let (_app, pool, state) = test_app_with_state().await;

    let (_, eps) = sync_once(&state).await;
    assert_eq!(eps, 1, "anime 也要算進集數");

    let label: String =
        sqlx::query_scalar("SELECT episode_label FROM tv_history WHERE series_name = '某動畫'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(label, "S01E03");
}

/// **重跑是冪等的**——同一批資料再同步一次不會產生重複列，也不會重複計數。
///
/// 靠的是 `INSERT OR IGNORE` 加上表上的 UNIQUE。少了任何一半，每次同步都會
/// 把同樣的紀錄再寫一遍，「看過的電影」數字就會自己長大。
#[tokio::test]
async fn re_syncing_the_same_items_is_idempotent() {
    let payload = json!({
        "movies": [movie("重複片", "2026-07-15T10:00:00Z", Some("1"), None, 2024)],
        "shows": [{
            "last_watched_at": "2026-07-20T10:00:00Z",
            "show": { "title": "重複劇", "ids": {}, "seasons": [{ "number": 1, "episodes": [{ "number": 1 }] }] },
        }],
    });
    let _s = mock_simkl(json!({ "all": "2026-08-02T00:00:00Z" }), Some(payload)).await;
    let (_app, pool, state) = test_app_with_state().await;

    let first = sync_once(&state).await;
    assert_eq!(first, (1, 1));

    // 把游標清掉，強迫再跑一次同一批
    sqlx::query("DELETE FROM sync_state WHERE key = 'simkl.activities_all'").execute(&pool).await.unwrap();
    let second = sync_once(&state).await;
    assert_eq!(second, (0, 0), "同一批再同步一次不該再計入新增");

    let films: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM film_history WHERE title = '重複片'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let eps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tv_history WHERE series_name = '重複劇'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((films, eps), (1, 1), "不能有重複列");
}

/// 結構不完整的項目要被跳過，而不是讓整批同步中止。
///
/// 上游偶爾會給 `movie: null`（已被刪除的條目）或缺 title。一個壞掉的項目
/// 不該讓後面幾百筆都同步不進來。
#[tokio::test]
async fn malformed_items_are_skipped_without_aborting_the_batch() {
    let _s = mock_simkl(
        json!({ "all": "2026-08-02T00:00:00Z" }),
        Some(json!({
            "movies": [
                { "last_watched_at": "2026-07-15T10:00:00Z", "movie": Value::Null },
                { "last_watched_at": "2026-07-15T10:00:00Z", "movie": { "ids": {} } }, // 沒有 title
                movie("好的片", "2026-07-16T10:00:00Z", Some("2"), None, 2024),
            ],
            "shows": [
                { "last_watched_at": "x", "show": Value::Null },
                { "last_watched_at": "2026-07-20T10:00:00Z",
                  "show": { "title": "好的劇", "ids": {}, "seasons": [{ "number": 2, "episodes": [{ "number": 5 }] }] } },
            ],
        })),
    )
    .await;
    let (_app, pool, state) = test_app_with_state().await;

    let (films, eps) = sync_once(&state).await;
    assert_eq!((films, eps), (1, 1), "壞掉的項目跳過，好的仍要寫進去");

    let ok: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM film_history WHERE title = '好的片'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ok, 1);
    let label: String =
        sqlx::query_scalar("SELECT episode_label FROM tv_history WHERE series_name = '好的劇'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(label, "S02E05");
}

// ── worker 的啟動 ─────────────────────────────────────────────────────────

/// **沒設 `ENABLE_SIMKL_SYNC` 就不該啟動 worker。**
///
/// 這條與下一條是 `cargo mutants` 逼出來的：`spawn_sync` 原本沒有回傳值，
/// 而它 spawn 的 task 先睡 45 秒——從外面完全看不出有沒有啟動。於是把整個函式
/// 換成 no-op、或把 `!sync_enabled(...)` 的驚嘆號刪掉，都沒有任何測試會紅。
///
/// 後果分別是「同步永遠不跑」（在看什麼靜靜停止更新）與「沒設定卻自己開始
/// 打上游」（而 Simkl 對未經同意的輪詢是直接停權）。
#[tokio::test]
async fn the_worker_does_not_start_unless_explicitly_enabled() {
    let (_app, _pool, state) = test_app_with_state().await;
    for raw in ["", "0", "no", "yes"] {
        unsafe { std::env::set_var("ENABLE_SIMKL_SYNC", raw) };
        assert!(
            koimsurai_web_backend::handlers::simkl::spawn_sync(state.clone()).is_none(),
            "ENABLE_SIMKL_SYNC={raw:?} 不該啟動 worker"
        );
    }
    unsafe { std::env::remove_var("ENABLE_SIMKL_SYNC") };
    assert!(koimsurai_web_backend::handlers::simkl::spawn_sync(state).is_none(), "沒設 env 時預設就是不跑");
}

/// 明確啟用時才真的 spawn。
#[tokio::test]
async fn the_worker_starts_when_enabled() {
    let (_app, _pool, state) = test_app_with_state().await;
    unsafe {
        std::env::set_var("ENABLE_SIMKL_SYNC", "1");
        // 讓它睡很久，測試不會真的跑到 sync_once
        std::env::set_var("SIMKL_SYNC_DELAY_SECS", "3600");
    }
    let handle = koimsurai_web_backend::handlers::simkl::spawn_sync(state);
    assert!(handle.is_some(), "ENABLE_SIMKL_SYNC=1 就該啟動");
    handle.unwrap().abort();
}
