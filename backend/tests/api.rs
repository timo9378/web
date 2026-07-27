//! 端到端整合測試：in-memory SQLite + migrations + `build_router`，tower `oneshot` 直打。
//! Express 對拍 oracle 退役後的接棒安全網——覆蓋核心公開端點、admin 守衛、JWT exp
//! 與 image-proxy 的 SSRF 防護。每個測試自建獨立 DB（互不干擾、可平行）。

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

const TEST_SECRET: &str = "test-secret";

/// 建一個接上獨立 in-memory DB 的完整 app（與正式環境同一條 build_router 路徑）。
async fn test_app() -> (Router, sqlx::SqlitePool) {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:").unwrap().foreign_keys(true);
    // in-memory DB 一條連線就是一份 DB → 鎖在單連線，全部操作共用同一份
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    seed(&pool).await;
    let state = AppState {
        pool: pool.clone(),
        http: reqwest::Client::new(),
        jwt_secret: Arc::from(TEST_SECRET),
        spotify: Arc::new(state::SpotifyState::default()),
        steam: Arc::new(state::SteamState::default()),
        watch: Arc::new(state::WatchState::default()),
        bahamut: handlers::bahamut::build_state("sqlite::memory:"),
    };
    (build_router(state), pool)
}

async fn seed(pool: &sqlx::SqlitePool) {
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

/// 發請求；body 非 JSON 時以字串包回（image-proxy 的 text/html 錯誤用）。
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> (StatusCode, Value) {
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
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, v)
}

async fn get(app: &Router, path: &str) -> (StatusCode, Value) {
    request(app, "GET", path, None, None).await
}

async fn post_json(app: &Router, path: &str, body: Value) -> (StatusCode, Value) {
    request(app, "POST", path, Some(body), None).await
}

/// 簽 legacy OWNER token（authorize 的 username 路徑）。with_exp=false 用來驗 exp 必要性。
fn owner_token(with_exp: bool) -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
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

// ── 基本可用性 ─────────────────────────────────────────────────

#[tokio::test]
async fn health_ok() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, Value::String("OK".into()));
}

#[tokio::test]
async fn unknown_path_is_404() {
    let (app, _pool) = test_app().await;
    let (status, _) = get(&app, "/api/no-such-endpoint").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── posts 公開讀 ───────────────────────────────────────────────

#[tokio::test]
async fn posts_list_returns_published_only() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/posts").await;
    assert_eq!(status, StatusCode::OK);
    let posts = body["posts"].as_array().expect("posts array");
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0]["title"], "公開文章");
    assert!(body.to_string().contains("pagination"));
}

#[tokio::test]
async fn post_detail_and_404() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/posts/1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["title"], "公開文章");
    assert_eq!(body["content"], "這是內文");

    let (status, body) = get(&app, "/api/posts/999").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Post not found");
}

#[tokio::test]
async fn post_view_and_like_counters() {
    let (app, pool) = test_app().await;
    let (status, _) = post_json(&app, "/api/posts/1/view", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = post_json(&app, "/api/posts/1/view", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let views: i64 =
        sqlx::query_scalar("SELECT view_count FROM posts WHERE id = 1").fetch_one(&pool).await.unwrap();
    assert_eq!(views, 2);

    let (status, body) = post_json(&app, "/api/posts/1/like", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["likes"], 1);
    let (status, body) = post_json(&app, "/api/posts/1/unlike", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["likes"], 0);

    // 不存在的文章：view 回 404
    let (status, _) = post_json(&app, "/api/posts/999/view", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_reactions_upsert() {
    let (app, _pool) = test_app().await;
    let (status, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "👍" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["emoji"], "👍");
    assert_eq!(body["count"], 1);

    let (status, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "💀" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid emoji");
}

// ── 留言 ──────────────────────────────────────────────────────

#[tokio::test]
async fn anonymous_comment_goes_to_pending() {
    let (app, _pool) = test_app().await;
    let (status, body) =
        post_json(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "推一個" })).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["message"], "success");
    assert_eq!(body["status"], "pending");

    // 缺 author/content → 400
    let (status, _) = post_json(&app, "/api/posts/1/comments", json!({ "author": "路人" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ── 其他公開讀 ─────────────────────────────────────────────────

#[tokio::test]
async fn categories_tags_thoughts_books_stats() {
    let (app, _pool) = test_app().await;
    for (path, expect) in [
        ("/api/categories", "技術"),
        ("/api/tags", "rust"),
        ("/api/thoughts", "第一則碎念"),
        ("/api/stats", ""),
    ] {
        let (status, body) = get(&app, path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert!(body.to_string().contains(expect), "{path} 應包含 {expect}");
    }
    let (status, body) = get(&app, "/api/books").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["books"], json!([]));
}

/// 計數必須跟列表算同一套語系規則。
///
/// 回歸：`/api/posts?lang=` 會濾掉沒該語系譯文的文章，但 categories/tags 的 post_count 與
/// pagination.total 原本都沒濾 → 側欄顯示「4 篇」點進去卻是空的，分頁也會多出翻不滿的空白頁。
#[tokio::test]
async fn counts_match_the_locale_filtered_list() {
    let (app, pool) = test_app().await;
    // seed 只有一篇 zh-TW 的「公開文章」（分類技術、標籤 rust）。再加一篇有 ja 譯文的。
    sqlx::query(
        "INSERT INTO posts (id, title, content, category, status, title_ja, content_ja) \
         VALUES (3, '有日文的文章', '中文內文', '技術', 'published', '日本語の記事', '日本語の本文')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // 不帶 lang：兩篇都算。
    let (_, body) = get(&app, "/api/posts").await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 2);
    assert_eq!(body["pagination"]["total"], 2);
    let (_, body) = get(&app, "/api/categories").await;
    assert_eq!(body["categories"][0]["post_count"], 2);

    // lang=ja：只有 id=3 有日文 → 列表、total、分類計數三者都要是 1。
    let (_, body) = get(&app, "/api/posts?lang=ja").await;
    let posts = body["posts"].as_array().unwrap();
    assert_eq!(posts.len(), 1, "ja 只有一篇有譯文");
    assert_eq!(posts[0]["title"], "日本語の記事");
    assert_eq!(body["pagination"]["total"], 1, "total 要跟列表長度一致，否則分頁會開出空白頁");

    let (_, body) = get(&app, "/api/categories?lang=ja").await;
    let tech = body["categories"].as_array().unwrap().iter().find(|c| c["name"] == "技術").expect("技術");
    assert_eq!(tech["post_count"], 1, "分類計數要跟 ja 列表一致");

    // 沒有任何 ja 文章的語系：分類仍要回傳（LEFT JOIN 不能退化成 INNER），只是計數 0，
    // 由前端的 post_count > 0 隱藏。
    let (_, body) = get(&app, "/api/categories?lang=ko").await;
    let tech =
        body["categories"].as_array().unwrap().iter().find(|c| c["name"] == "技術").expect("ko 也要有這列");
    assert_eq!(tech["post_count"], 0);

    // 標籤：rust 只掛在沒有 ja 譯文的 id=1 上 → ja 下計數 0，被 HAVING 收掉。
    let (_, body) = get(&app, "/api/tags").await;
    assert_eq!(body["tags"][0]["post_count"], 1);
    let (_, body) = get(&app, "/api/tags?lang=ja").await;
    assert_eq!(body["tags"].as_array().unwrap().len(), 0, "ja 下沒有文章的標籤不該出現");
}

// ── newsletter 全流程 ──────────────────────────────────────────

#[tokio::test]
async fn newsletter_subscribe_and_unsubscribe_flow() {
    let (app, pool) = test_app().await;
    let (status, _) = post_json(
        &app,
        "/api/newsletter/subscribe",
        json!({ "email": "reader@example.com", "name": "讀者" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let token: String = sqlx::query_scalar(
        "SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = 'reader@example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = get(&app, &format!("/api/newsletter/by-token/{token}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["email"], "reader@example.com");
    assert_eq!(body["status"], "active");

    let (status, _) = post_json(&app, "/api/newsletter/unsubscribe", json!({ "token": token })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = get(&app, &format!("/api/newsletter/by-token/{token}")).await;
    assert_eq!(body["status"], "unsubscribed");

    // 壞 token → 404；壞 email 格式 → 400
    let (status, _) = get(&app, "/api/newsletter/by-token/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post_json(&app, "/api/newsletter/subscribe", json!({ "email": "not-an-email" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ── admin 守衛與 JWT ───────────────────────────────────────────

#[tokio::test]
async fn admin_routes_require_bearer() {
    let (app, _pool) = test_app().await;
    for path in ["/api/admin/posts", "/api/admin/comments", "/api/admin/stats", "/api/admin/users"] {
        let (status, body) = get(&app, path).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert!(body["message"].is_string(), "{path} 401 應帶 message");
    }
}

#[tokio::test]
async fn admin_allows_valid_owner_token() {
    let (app, _pool) = test_app().await;
    let token = owner_token(true);
    let (status, body) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    // admin 列表看得到草稿
    assert!(body.to_string().contains("未發布草稿"));
}

#[tokio::test]
async fn jwt_without_exp_is_rejected() {
    let (app, _pool) = test_app().await;
    let token = owner_token(false);
    let (status, _) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn jwt_wrong_secret_is_rejected() {
    let (app, _pool) = test_app().await;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "username": "admin", "iat": now, "exp": now + 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(b"wrong-secret"),
    )
    .unwrap();
    let (status, _) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── SSRF 防護（image-proxy / link-preview）────────────────────

#[tokio::test]
async fn image_proxy_blocks_internal_targets() {
    let (app, _pool) = test_app().await;
    for target in [
        "http://127.0.0.1/x.png",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.5/a.jpg",
        "http://192.168.1.1/a.jpg",
        "http://localhost:8000/a.jpg",
        "file:///etc/passwd",
        "http://[::1]/a.jpg",
    ] {
        let encoded = urlencode(target);
        let (status, body) = get(&app, &format!("/api/image-proxy?url={encoded}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{target} 應被擋");
        assert_eq!(body, Value::String("Invalid image URL".into()), "{target}");
    }
    // 缺 url → 400（對齊 Express 訊息）
    let (status, body) = get(&app, "/api/image-proxy").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, Value::String("Missing image URL".into()));
}

#[tokio::test]
async fn link_preview_rejects_bad_urls_with_empty_card() {
    let (app, _pool) = test_app().await;
    for target in ["ftp://example.com/x", "http://127.0.0.1/", "not a url"] {
        let encoded = urlencode(target);
        let (status, body) = get(&app, &format!("/api/link-preview?url={encoded}")).await;
        assert_eq!(status, StatusCode::OK, "{target} 降級卡仍回 200");
        assert_eq!(body["title"], Value::Null, "{target}");
        assert_eq!(body["image"], Value::Null, "{target}");
    }
}

/// 極簡 percent-encode（測試用；只處理 query 值需要的字元）
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
