//! 整合測試共用的架設。
//!
//! Rust 的整合測試是「一個檔案一個 crate」，所以 tests/api.rs 與 tests/snapshots.rs
//! 看不到彼此。這個模組用 `mod common;` 被兩邊 include，避免同一份 test_app 抄兩次
//! ——抄兩次的下場是其中一份會慢慢跟另一份不一樣，而沒有人會發現。
//!
//! `mod common;` 的代價是它會**在每個測試檔各編譯一次**，於是「這個檔沒用到的項目」
//! 就會逐檔報 dead_code。那是 include 模式的固有現象不是真的死碼，所以整個模組關掉。

#![allow(dead_code)]

use std::str::FromStr;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tower::ServiceExt;

use koimsurai_web_backend::{handlers, router::build_router, state, state::AppState};

pub const TEST_SECRET: &str = "test-secret";

/// 建一個接上獨立 in-memory DB 的完整 app（與正式環境同一條 build_router 路徑）。
pub async fn test_app() -> (Router, sqlx::SqlitePool) {
    let (router, pool, _state) = test_app_with_state().await;
    (router, pool)
}

/// 同上，但也把 `AppState` 交出來——需要直接摸狀態（快取、鎖）的測試用得到。
pub async fn test_app_with_state() -> (Router, sqlx::SqlitePool, AppState) {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:").unwrap().foreign_keys(true);
    // in-memory DB 一條連線就是一份 DB → 鎖在單連線，全部操作共用同一份
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    seed(&pool).await;
    let external = state::ExternalUrls::default();
    let state = AppState {
        pool: pool.clone(),
        http: reqwest::Client::new(),
        jwt_secret: Arc::from(TEST_SECRET),
        spotify: Arc::new(state::SpotifyState::default()),
        steam: Arc::new(state::SteamState::default()),
        watch: Arc::new(state::WatchState::default()),
        bahamut: handlers::bahamut::build_state("sqlite::memory:", &external),
        external: Arc::new(external),
    };
    (build_router(state.clone()), pool, state)
}

/// 基本種子資料。
///
/// 內容與 tests/api.rs 原本自帶的那份**逐字相同**——這個模組是從那裡抽出來的，
/// 抽的時候刻意不順手改，不然既有那三十幾個斷言會跟著動，而那不是這次要做的事。
/// 快照測試需要的額外資料走下面的 `seed_extra`。
pub async fn seed(pool: &sqlx::SqlitePool) {
    for sql in [
        "INSERT INTO categories (name, slug, description) VALUES ('技術', 'tech', '技術文')",
        "INSERT INTO tags (name) VALUES ('rust')",
        "INSERT INTO posts (id, title, content, excerpt, category, status) \
         VALUES (1, '公開文章', '這是內文', '摘要', '技術', 'published')",
        "INSERT INTO posts (id, title, content, status) VALUES (2, '未發布草稿', '草稿內文', 'draft')",
        "INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1)",
        "INSERT INTO thoughts (content) VALUES ('第一則碎念')",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

/// 快照測試用的額外資料：系列、書、投票、觀看紀錄、站台計數器。
///
/// 為什麼要多這一份：目前 rss / series / books / polls / watch 那批端點覆蓋率是 0%，
/// 而它們在空資料下都回空陣列——對空陣列拍快照等於沒測到渲染邏輯。
///
/// 日期一律寫死。回應裡帶 created_at，用 `datetime('now')` 的話快照每跑一次就不一樣，
/// 那種測試只會訓練人反射性按 `--accept`，擋不到任何東西。
pub async fn seed_extra(pool: &sqlx::SqlitePool) {
    for sql in [
        // 系列文（兩篇同系列，驗排序）
        "INSERT INTO posts (id, title, content, excerpt, category, status, series_name, series_order, created_at, updated_at) \
         VALUES (10, '系列第一篇', '內文十', '摘要十', '技術', 'published', '測試系列', 1, '2026-01-05 03:00:00', '2026-01-05 03:00:00')",
        "INSERT INTO posts (id, title, content, excerpt, category, status, series_name, series_order, created_at, updated_at) \
         VALUES (11, '系列第二篇', '內文十一', '摘要十一', '技術', 'published', '測試系列', 2, '2026-01-06 03:00:00', '2026-01-06 03:00:00')",
        // 書櫃
        "INSERT INTO books (isbn, title, authors, publisher, description, page_count, reading_status, rating, date_added, date_updated) \
         VALUES ('9781234567890', '測試書名', '某作者', '某出版社', '書籍簡介', 320, 'read', 5, '2026-01-01 03:00:00', '2026-01-01 03:00:00')",
        "INSERT INTO books (isbn, title, authors, reading_status, date_added, date_updated) \
         VALUES ('9780987654321', '在讀的書', '另一位作者', 'reading', '2026-01-02 03:00:00', '2026-01-02 03:00:00')",
        // 投票 / 站台計數器
        "INSERT INTO poll_votes (poll_id, option_key, count) VALUES ('demo', 'a', 3), ('demo', 'b', 1)",
        "INSERT INTO site_counters (key, count) VALUES ('site_likes', 42)",
        // 觀看紀錄
        "INSERT INTO anime_history (anime_sn, video_sn, title, episode, last_watched_at, synced_at) \
         VALUES (1001, 2001, '測試動畫', '[01]', '2026-01-08 03:00:00', '2026-01-08 03:00:00')",
        "INSERT INTO film_history (title, watched_date, rating, source, release_year, genres, synced_at) \
         VALUES ('測試電影', '2026-01-10', 8, 'trakt', 2024, '劇情, 科幻', '2026-01-10 03:00:00')",
        "INSERT INTO tv_history (series_name, episode_label, watched_date, source, synced_at) \
         VALUES ('測試影集', 'S01E01', '2026-01-12', 'trakt', '2026-01-12 03:00:00')",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

/// 發請求；body 非 JSON 時以字串包回（image-proxy 的 text/html 錯誤用）。
pub async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> (StatusCode, Value) {
    let (status, _headers, v) = request_full(app, method, path, body, bearer).await;
    (status, v)
}

/// 連標頭一起交出來——content-type 這種「回的是不是 XML」的斷言需要它。
pub async fn request_full(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut b = Request::builder().method(method).uri(path);
    if let Some(t) = bearer {
        b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let req = match body {
        Some(v) => {
            b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap()
        }
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, headers, v)
}

pub async fn get(app: &Router, path: &str) -> (StatusCode, Value) {
    request(app, "GET", path, None, None).await
}

pub async fn post_json(app: &Router, path: &str, body: Value) -> (StatusCode, Value) {
    request(app, "POST", path, Some(body), None).await
}

/// OWNER 角色的 JWT。`with_exp=false` 用來驗「沒有 exp 的 token 要被拒」。
pub fn owner_token(with_exp: bool) -> String {
    let now = koimsurai_web_backend::util::now_secs();
    let mut claims = json!({ "id": 1, "username": "admin", "role": "OWNER", "iat": now });
    if with_exp {
        claims["exp"] = json!(now + 3600);
    }
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap()
}
