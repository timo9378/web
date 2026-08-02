//! 電子報訂閱與 OG 分享圖。兩支都是「讀者會碰到、但站長自己幾乎不會回頭看」的東西。
//!
//! 電子報：重複訂閱與退訂之後再訂閱是同一個 email 的三種狀態流轉，而每一種都回 2xx；
//! 錯了的症狀是「按了訂閱說成功但其實沒進名單」或「退訂之後還是繼續收到信」。
//!
//! OG：ETag 的 cache key 含**標題與更新時間**。少算一個的話，文章改了標題之後
//! 分享到社群還是舊圖——而且因為回的是 200 + 舊 bytes，看起來一切正常。

mod common;

use axum::http::StatusCode;
use serde_json::json;

use common::{get, owner_token, request, request_full, test_app};

// ── 電子報 ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn 訂閱會發一個退訂用的_token_並查得回來() {
    let (app, pool) = test_app().await;
    let (st, v) = request(
        &app,
        "POST",
        "/api/newsletter/subscribe",
        Some(json!({ "email": "a@example.com", "name": "阿甲" })),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "得到 {v}");
    assert!(v["id"].is_i64());

    let token: String =
        sqlx::query_scalar("SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = ?")
            .bind("a@example.com")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(token.len(), 32, "16 bytes 的十六進位＝32 字元");

    // 退訂確認頁靠這個 token 顯示「你確定要退訂 a@example.com 嗎」
    let (st, v) = get(&app, &format!("/api/newsletter/by-token/{token}")).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["email"], "a@example.com");
    assert_eq!(v["name"], "阿甲");
    assert_eq!(v["status"], "active");

    let (st, v) = get(&app, "/api/newsletter/by-token/不存在的token").await;
    assert_eq!(st, StatusCode::NOT_FOUND, "得到 {v}");
}

#[tokio::test]
async fn email_格式不對就擋在寫入之前() {
    let (app, pool) = test_app().await;
    for bad in ["", "沒有小老鼠", "a@b", "a b@c.com", "@example.com", "a@.com"] {
        let (st, v) =
            request(&app, "POST", "/api/newsletter/subscribe", Some(json!({ "email": bad })), None).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "email={bad:?} 應該被擋，得到 {v}");
    }
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM newsletter_subscribers").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "格式不對的一筆都不該進資料庫");
}

/// 同一個 email 的三種狀態流轉：新訂 → 重複訂（400）→ 退訂 → 再訂（重新啟用）。
/// 「退訂之後再訂閱不會生效」是最難發現的一種——使用者按了訂閱、畫面說成功，
/// 但 status 還是 unsubscribed，於是永遠收不到信。
#[tokio::test]
async fn 重複訂閱被擋_但退訂之後可以重新啟用() {
    let (app, pool) = test_app().await;
    let sub = |body: serde_json::Value| {
        let app = app.clone();
        async move { request(&app, "POST", "/api/newsletter/subscribe", Some(body), None).await }
    };

    let (st, _) = sub(json!({ "email": "b@example.com" })).await;
    assert_eq!(st, StatusCode::CREATED);

    // 已經是 active → 400，而且不能重複建一筆
    let (st, v) = sub(json!({ "email": "b@example.com" })).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "得到 {v}");
    assert_eq!(v["error"], "This email is already subscribed");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM newsletter_subscribers WHERE email = ?")
        .bind("b@example.com")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "重複訂閱不該變成兩筆");

    // 退訂
    let (st, v) =
        request(&app, "POST", "/api/newsletter/unsubscribe", Some(json!({ "email": "b@example.com" })), None)
            .await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    let (status, at): (String, Option<String>) =
        sqlx::query_as("SELECT status, unsubscribed_at FROM newsletter_subscribers WHERE email = ?")
            .bind("b@example.com")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "unsubscribed");
    assert!(at.is_some(), "退訂時間要記下來");

    // 再訂 → 重新啟用（不是 400）
    let (st, v) = sub(json!({ "email": "b@example.com" })).await;
    assert_eq!(st, StatusCode::OK, "退訂之後再訂閱應該成功，得到 {st} {v}");
    assert_eq!(v["message"], "Re-subscribed to newsletter");
    let (status, at): (String, Option<String>) =
        sqlx::query_as("SELECT status, unsubscribed_at FROM newsletter_subscribers WHERE email = ?")
            .bind("b@example.com")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "active");
    assert!(at.is_none(), "重新啟用要把退訂時間清掉，不然日後查詢會誤判");
}

/// 退訂時 **token 優先於 email**（信裡的連結帶的是 token）。
#[tokio::test]
async fn 退訂可以用_token_或_email_兩者皆無則_400() {
    let (app, pool) = test_app().await;
    request(&app, "POST", "/api/newsletter/subscribe", Some(json!({ "email": "c@example.com" })), None).await;
    let token: String =
        sqlx::query_scalar("SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = ?")
            .bind("c@example.com")
            .fetch_one(&pool)
            .await
            .unwrap();

    let (st, v) = request(&app, "POST", "/api/newsletter/unsubscribe", Some(json!({})), None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "得到 {v}");
    assert_eq!(v["error"], "Email or token is required");

    let (st, _) =
        request(&app, "POST", "/api/newsletter/unsubscribe", Some(json!({ "token": "沒這個token" })), None)
            .await;
    assert_eq!(st, StatusCode::NOT_FOUND, "找不到訂閱者要 404，不是假裝成功");

    let (st, v) =
        request(&app, "POST", "/api/newsletter/unsubscribe", Some(json!({ "token": token })), None).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    let status: String = sqlx::query_scalar("SELECT status FROM newsletter_subscribers WHERE email = ?")
        .bind("c@example.com")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "unsubscribed");
}

// ── OG 分享圖 ─────────────────────────────────────────────────────────────

/// ETag 的 cache key 是 `id::updated_at::title`。文章改了標題就必須換一張圖——
/// 少算 title 的話分享到社群還是舊標題，而且回的是 200 + 舊 bytes，看起來完全正常。
#[tokio::test]
async fn og_圖會隨標題改變而換掉_etag() {
    let (app, pool) = test_app().await;
    let (st, headers, _) = request_full(&app, "GET", "/api/og/1.png", None, None).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(headers.get("content-type").unwrap(), "image/png");
    let etag1 = headers.get("etag").unwrap().to_str().unwrap().to_string();
    assert!(etag1.starts_with("\"og-1-"), "得到 {etag1}");
    assert_eq!(
        headers.get("cache-control").unwrap(),
        "public, max-age=300, s-maxage=86400",
        "CDN 快取一天、瀏覽器五分鐘"
    );

    // 帶著 If-None-Match 再要一次 → 304（省掉重新光柵化與傳輸）
    let req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/og/1.png")
        .header(axum::http::header::IF_NONE_MATCH, &etag1)
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = tower::ServiceExt::oneshot(app.clone(), req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_MODIFIED, "同一個 ETag 應該回 304");

    // 改標題 → cache key 變 → 必須是新的 ETag
    sqlx::query("UPDATE posts SET title = '改過的標題', updated_at = '2026-02-01 00:00:00' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();
    let (st, headers, _) = request_full(&app, "GET", "/api/og/1.png", None, None).await;
    assert_eq!(st, StatusCode::OK);
    let etag2 = headers.get("etag").unwrap().to_str().unwrap().to_string();
    assert_ne!(etag1, etag2, "標題改了 ETag 卻沒變——分享出去的還會是舊圖");
}

#[tokio::test]
async fn og_對不存在的文章與錯誤後綴都回_404() {
    let (app, _pool) = test_app().await;
    for path in ["/api/og/999999.png", "/api/og/1.jpg", "/api/og/1", "/api/og/沒有後綴"] {
        let (st, _headers, _) = request_full(&app, "GET", path, None, None).await;
        assert_eq!(st, StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn 訂閱者清單要有_admin_token() {
    let (app, _pool) = test_app().await;
    let (st, _) = get(&app, "/api/newsletter/subscribers").await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "訂閱者的 email 不能公開");

    request(&app, "POST", "/api/newsletter/subscribe", Some(json!({ "email": "d@example.com" })), None).await;
    let (st, v) = request(&app, "GET", "/api/newsletter/subscribers", None, Some(&owner_token(true))).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    let list = v["subscribers"].as_array().or_else(|| v.as_array()).expect("應該是清單");
    assert!(list.iter().any(|s| s["email"] == "d@example.com"), "剛訂閱的要出現：{v}");
}
