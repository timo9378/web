//! `/api/posts` 這一套 CRUD（**不是** `/api/admin/posts`）。
//!
//! 站上同時存在兩套寫入端點：`/api/admin/posts`（PostEditor 在用、有 i18n 與三態欄位）
//! 與這一套簡版。它們的語意**刻意不同**，而不同之處只寫在註解裡沒有測試釘住：
//!
//!   · 這裡的 `category` 走 `COALESCE` —— 傳 null 是「不動」，admin 那套傳空字串是「清空」
//!   · 這裡的錯誤碼是 **400**（照抄 Express 這支），admin 那套是 500
//!   · `POST /api/posts/legacy` 走的是 **Basic Auth** 不是 JWT
//!
//! 兩套哪天被人「順手統一」而沒發現差異，症狀會是：舊的匯入腳本開始 401、
//! 或是某個呼叫端本來靠 COALESCE 保留欄位、改完之後每次更新都把分類清掉。

mod common;

use axum::http::StatusCode;
use base64::Engine;
use serde_json::json;

use common::{owner_token, request, request_full, test_app};

async fn admin(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    request(app, method, path, body, Some(&owner_token(true))).await
}

/// 這一套建立成功回 **201**，而且 body 包在 `data` 裡。
#[tokio::test]
async fn 建立文章回_201_並帶預設的_draft_與_record() {
    let (app, pool) = test_app().await;
    let (st, body) =
        admin(&app, "POST", "/api/posts", Some(json!({ "title": "簡版建文", "content": "內文" }))).await;
    assert_eq!(st, StatusCode::CREATED, "得到 {body}");
    assert_eq!(body["message"], "success");
    let id = body["data"]["id"].as_i64().expect("要帶 id");
    assert_eq!(body["data"]["status"], "draft", "沒給 status 時回應要顯示預設值");

    // 預設值要真的進 DB，不是只出現在回應裡
    let (status, layout, author): (String, String, String) =
        sqlx::query_as("SELECT status, layout_type, author FROM posts WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "draft", "預設不是 draft 的話新文章會直接見客");
    assert_eq!(layout, "record");
    assert_eq!(author, "Koimsurai");
}

#[tokio::test]
async fn 缺標題或內容時回_400_而不是_500() {
    // 這支的錯誤碼刻意是 400（照抄 Express）。變成 500 的話前端的錯誤處理會
    // 把「使用者少填欄位」當成「伺服器壞了」。
    let (app, _pool) = test_app().await;
    for body in [
        json!({ "content": "只有內文" }),
        json!({ "title": "只有標題" }),
        json!({ "title": "", "content": "空標題" }),
        json!({}),
    ] {
        let (st, v) = admin(&app, "POST", "/api/posts", Some(body.clone())).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(v["error"], "Missing required fields: title, content");
    }
}

/// 這一套的 `category` 走 `COALESCE`：**傳 null 是「不動」**，跟 admin 那套不一樣。
#[tokio::test]
async fn 更新時傳_null_的欄位不會被清掉() {
    let (app, _pool) = test_app().await;
    let (_, created) = admin(
        &app,
        "POST",
        "/api/posts",
        Some(json!({ "title": "原標題", "content": "原內文", "excerpt": "原摘要", "category": "技術" })),
    )
    .await;
    let id = created["data"]["id"].as_i64().unwrap();

    // 只送 title，其餘都不帶 → COALESCE 全部保留
    let (st, v) = admin(&app, "PUT", &format!("/api/posts/{id}"), Some(json!({ "title": "新標題" }))).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    assert_eq!(v["changes"], 1);

    let (_, one) = admin(&app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    let got = if one["post"].is_object() { one["post"].clone() } else { one };
    assert_eq!(got["title"], "新標題");
    assert_eq!(got["content"], "原內文");
    assert_eq!(got["category"], "技術", "這一套的 category 是 COALESCE——不帶就是不動");

    // 明確傳 null 也是「不動」（COALESCE 的語意），這正是與 admin 那套的差別
    let (st, _) = admin(&app, "PUT", &format!("/api/posts/{id}"), Some(json!({ "category": null }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, one) = admin(&app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    let got = if one["post"].is_object() { one["post"].clone() } else { one };
    assert_eq!(got["category"], "技術", "傳 null 在 COALESCE 底下是保留，不是清空");
}

#[tokio::test]
async fn 更新與刪除不存在的文章都是_404() {
    let (app, _pool) = test_app().await;
    let (st, v) = admin(&app, "PUT", "/api/posts/999999", Some(json!({ "title": "改" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "得到 {v}");
    assert_eq!(v["message"], "Post not found");

    let (st, v) = admin(&app, "DELETE", "/api/posts/999999", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "得到 {v}");
}

#[tokio::test]
async fn 刪除文章會連帶清掉標籤關聯() {
    // 只刪 posts 不刪 post_tags 的話會留下孤兒列，而 SQLite 沒有 FK cascade 時
    // 那些列會一直累積，下一篇拿到同一個 id 就會莫名其妙帶著別人的標籤。
    let (app, pool) = test_app().await;
    let (_, created) = admin(
        &app,
        "POST",
        "/api/posts",
        Some(json!({ "title": "有標籤", "content": "內文", "tags": ["rust"] })),
    )
    .await;
    let id = created["data"]["id"].as_i64().unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_tags WHERE post_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "建立時的標籤沒掛上");

    let (st, v) = admin(&app, "DELETE", &format!("/api/posts/{id}"), None).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    assert_eq!(v["message"], "deleted");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_tags WHERE post_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "標籤關聯沒被清掉，會變成孤兒列");
}

/// `PATCH /api/posts/:id/status` 只收 published / draft。
/// 收了別的值會讓那篇變成「既不在草稿也不在已發布」的幽靈——後台列表看不到、
/// 公開清單也看不到，但它確實存在。
#[tokio::test]
async fn 狀態只收_published_與_draft() {
    let (app, pool) = test_app().await;
    let (_, created) =
        admin(&app, "POST", "/api/posts", Some(json!({ "title": "改狀態", "content": "內文" }))).await;
    let id = created["data"]["id"].as_i64().unwrap();

    for bad in [json!("archived"), json!("banana"), json!(""), json!(null)] {
        let (st, v) =
            admin(&app, "PATCH", &format!("/api/posts/{id}/status"), Some(json!({ "status": bad }))).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "status={bad} 應該被擋");
        assert!(v["error"].as_str().unwrap().contains("published"), "錯誤訊息要說得出合法值");
    }
    // 擋下來之後 DB 不該被動到
    let s: String =
        sqlx::query_scalar("SELECT status FROM posts WHERE id = ?").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(s, "draft");

    let (st, v) =
        admin(&app, "PATCH", &format!("/api/posts/{id}/status"), Some(json!({ "status": "published" })))
            .await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    assert_eq!(v["status"], "published");
    let s: String =
        sqlx::query_scalar("SELECT status FROM posts WHERE id = ?").bind(id).fetch_one(&pool).await.unwrap();
    assert_eq!(s, "published");

    let (st, _) = admin(&app, "PATCH", "/api/posts/999999/status", Some(json!({ "status": "draft" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "改不存在的文章要 404");
}

/// legacy 匯入端點走 **Basic Auth** 不是 JWT。舊的匯入腳本靠這個，
/// 換成 JWT 的話那些腳本會全部 401 而且沒有人會馬上發現。
#[tokio::test]
async fn legacy_端點走_basic_auth_並直接發布() {
    // SAFETY: env 是 process 全域；nextest 一個測試一個行程。
    unsafe {
        std::env::set_var("ADMIN_USERNAME", "importer");
        std::env::set_var("ADMIN_PASSWORD", "s3cret");
    }
    let (app, pool) = test_app().await;
    let basic = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode("importer:s3cret"));

    // 帶 JWT 反而不行——這支只認 Basic
    let (st, _) =
        admin(&app, "POST", "/api/posts/legacy", Some(json!({ "title": "用 JWT 試", "content": "內文" })))
            .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "legacy 只認 Basic Auth");

    let (st, _headers, v) = request_full(
        &app,
        "POST",
        "/api/posts/legacy",
        Some(json!({ "title": "匯入的文章", "content": "內文", "author": "舊系統" })),
        None,
    )
    .await;
    assert_eq!(st, StatusCode::UNAUTHORIZED, "沒帶認證也是 401");
    assert!(v.is_string() || v.is_object());

    // 正確的 Basic Auth
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/posts/legacy")
        .header(axum::http::header::AUTHORIZATION, &basic)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({ "title": "匯入的文章", "content": "內文", "author": "舊系統" }).to_string(),
        ))
        .unwrap();
    let resp = tower::ServiceExt::oneshot(app.clone(), req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let id = v["data"]["id"].as_i64().expect("要帶 id");
    // 回應是 `{id, ...req.body}` —— 原樣把 body 的欄位帶回去
    assert_eq!(v["data"]["author"], "舊系統");

    let (status, author): (String, String) = sqlx::query_as("SELECT status, author FROM posts WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "published", "legacy 匯入的文章直接發布（不經草稿）");
    assert_eq!(author, "舊系統", "有給 author 就用它的");

    // SAFETY: 見上。
    unsafe {
        std::env::remove_var("ADMIN_USERNAME");
        std::env::remove_var("ADMIN_PASSWORD");
    }
}
