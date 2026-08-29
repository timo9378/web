//! 留言的建立（文章與碎念共用同一條路徑）。
//!
//! 原本 54%。沒被走到的正好是**四道守門全部**：captcha、IP 黑名單、關鍵字過濾、
//! 以及「登入的人免審核」。這四道壞掉的樣子都一樣——留言照樣送出、照樣回 201，
//! 差別只在它進了 `comments` 表的哪個 status；沒有 log、沒有告警，
//! 要到有人真的去看後台審核清單才會發現。
//!
//! 這裡刻意連 `status` 欄位一起驗到 DB，不只看回應：回應裡的 status 是另外組出來的
//! 字串，跟真的寫進去的值是兩個東西，只驗前者的話兩邊分岔了也看不出來。

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use common::{TEST_SECRET, test_app};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

/// 帶自訂標頭發 POST。common 的 helper 只支援 Bearer，而這裡要驗的是
/// `X-Forwarded-For`（IP 黑名單的唯一輸入）。
async fn post_with(
    app: &axum::Router,
    path: &str,
    body: Value,
    extra: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut b = Request::builder().method("POST").uri(path).header(header::CONTENT_TYPE, "application/json");
    for (k, v) in extra {
        b = b.header(*k, *v);
    }
    let resp = app.clone().oneshot(b.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, v)
}

/// OAuth 登入者的 token。判定條件是「同時有 userId 與 provider」——
/// 少任何一個都要被當成匿名，底下有測到。
fn oauth_token(user_id: Option<i64>, provider: Option<&str>) -> String {
    let mut claims = json!({ "username": "someone" });
    if let Some(id) = user_id {
        claims["userId"] = json!(id);
    }
    if let Some(p) = provider {
        claims["provider"] = json!(p);
    }
    let now = koimsurai_web_backend::util::now_secs();
    claims["exp"] = json!(now + 3600);
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap()
}

async fn status_in_db(pool: &sqlx::SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM comments WHERE id = ?").bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn 名字或內容缺一不可() {
    let (app, pool) = test_app().await;
    for body in [
        json!({ "content": "只有內容" }),
        json!({ "author": "只有名字" }),
        json!({ "author": "", "content": "" }),
        json!({}),
    ] {
        let (status, resp) = post_with(&app, "/api/posts/1/comments", body.clone(), &[]).await;
        assert_eq!(status, 400, "{body} 應該被拒絕");
        assert_eq!(resp["error"], "Author and content are required");
    }
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "被拒絕的留言不該留下列");
}

#[tokio::test]
async fn 匿名留言預設進待審核() {
    let (app, pool) = test_app().await;
    let (status, resp) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "寫得好" }), &[]).await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "pending");
    // 預設值若哪天變成 approved，匿名留言就會直接出現在文章底下 —— 沒有人審過
    assert_eq!(status_in_db(&pool, resp["id"].as_i64().unwrap()).await, "pending");
}

#[tokio::test]
async fn 帶了_captcha_就要答對() {
    let (app, _pool) = test_app().await;
    let base = json!({ "author": "路人", "content": "內容" });

    let mut wrong = base.clone();
    wrong["captcha"] = json!(7);
    wrong["captchaAnswer"] = json!(3);
    let (status, resp) = post_with(&app, "/api/posts/1/comments", wrong, &[]).await;
    assert_eq!(status, 400);
    assert_eq!(resp["error"], "驗證碼錯誤");

    let mut right = base.clone();
    right["captcha"] = json!(7);
    right["captchaAnswer"] = json!(7);
    let (status, _) = post_with(&app, "/api/posts/1/comments", right, &[]).await;
    assert_eq!(status, 201);
}

#[tokio::test]
async fn captcha_的字串與數字要當成同一個答案() {
    let (app, _pool) = test_app().await;
    // 前端的答案來自 <input>，一定是字串；題目是數字。嚴格相等會讓**每一個人**
    // 都答不對，而錯誤訊息只會說「驗證碼錯誤」——沒有人猜得到問題出在型別。
    for (q, a) in [(json!(7), json!("7")), (json!("7"), json!(7)), (json!(0), json!(""))] {
        let body = json!({ "author": "路人", "content": "內容", "captcha": q, "captchaAnswer": a });
        let (status, _) = post_with(&app, "/api/posts/1/comments", body, &[]).await;
        assert_eq!(status, 201, "{q} 對 {a} 應該視為相等");
    }
    // 但不能寬鬆到什麼都相等
    let body = json!({ "author": "路人", "content": "內容", "captcha": 7, "captchaAnswer": "七" });
    let (status, _) = post_with(&app, "/api/posts/1/comments", body, &[]).await;
    assert_eq!(status, 400);
}

#[tokio::test]
async fn 沒帶_captcha_欄位就不檢查() {
    let (app, _pool) = test_app().await;
    // captcha 是選配的（站上某些入口沒出題）。缺欄位時若當成「答錯」，那些入口會整個不能留言。
    let (status, _) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "內容" }), &[]).await;
    assert_eq!(status, 201);
}

#[tokio::test]
async fn 登入的人免審核而且不必答_captcha() {
    let (app, pool) = test_app().await;
    let token = format!("Bearer {}", oauth_token(Some(9), Some("github")));
    let body = json!({
        "author": "登入者", "content": "我是登入的",
        "captcha": 7, "captchaAnswer": 3, // 故意答錯：登入者這一段根本不該跑
    });
    let (status, resp) =
        post_with(&app, "/api/posts/1/comments", body, &[(header::AUTHORIZATION.as_str(), &token)]).await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "approved");
    assert_eq!(status_in_db(&pool, resp["id"].as_i64().unwrap()).await, "approved");
}

#[tokio::test]
async fn 少了_userid_或_provider_的_token_一律當匿名() {
    let (app, _pool) = test_app().await;
    // 免審核是拿 token 換來的，所以「怎樣才算登入」必須嚴格。少一個欄位就放行的話，
    // 任何一顆用同一把密鑰簽出來的 token（例如站內其他用途的）都能繞過審核。
    for (uid, provider, why) in
        [(Some(9), None, "只有 userId"), (None, Some("github"), "只有 provider"), (None, None, "兩個都沒有")]
    {
        let token = format!("Bearer {}", oauth_token(uid, provider));
        let (status, resp) = post_with(
            &app,
            "/api/posts/1/comments",
            json!({ "author": "路人", "content": "內容" }),
            &[(header::AUTHORIZATION.as_str(), &token)],
        )
        .await;
        assert_eq!(status, 201);
        assert_eq!(resp["status"], "pending", "{why} 的 token 不該換到免審核");
    }
}

#[tokio::test]
async fn 簽章不對的_token_不算登入() {
    let (app, _pool) = test_app().await;
    let bogus = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "userId": 9, "provider": "github", "exp": 9_999_999_999i64 }),
        &jsonwebtoken::EncodingKey::from_secret(b"another-secret"),
    )
    .unwrap();
    let (status, resp) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "路人", "content": "內容" }),
        &[(header::AUTHORIZATION.as_str(), &format!("Bearer {bogus}"))],
    )
    .await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "pending", "自己簽的 token 換到了免審核");
}

#[tokio::test]
async fn 黑名單_ip_直接擋掉() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO ip_blacklist (ip, reason) VALUES ('1.2.3.4', '洗版')")
        .execute(&pool)
        .await
        .unwrap();

    let (status, resp) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "洗版的人", "content": "內容" }),
        &[("x-forwarded-for", "1.2.3.4")],
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(resp["error"], "您的留言權限已被限制");

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "被封鎖的人不該還是寫得進去");
}

#[tokio::test]
async fn ip_取的是_x_forwarded_for_最左邊那個() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO ip_blacklist (ip) VALUES ('1.2.3.4')").execute(&pool).await.unwrap();

    // nginx 會把整條鏈都放進 XFF。取錯端（拿最右邊）等於永遠比對到代理的 IP，
    // 黑名單就完全失效——而且失效得很安靜。
    let (status, _) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "洗版的人", "content": "內容" }),
        &[("x-forwarded-for", "1.2.3.4, 10.0.0.1, 172.16.0.1")],
    )
    .await;
    assert_eq!(status, 403, "沒有取到最左邊那個 IP");

    // 前後空白要吃掉（XFF 的分隔慣例是 ", "）
    let (status, _) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "洗版的人", "content": "內容" }),
        &[("x-forwarded-for", "  1.2.3.4  , 10.0.0.1")],
    )
    .await;
    assert_eq!(status, 403, "沒有把 IP 前後的空白去掉");
}

#[tokio::test]
async fn 留言會記下來源_ip() {
    let (app, pool) = test_app().await;
    let (_, resp) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "路人", "content": "內容" }),
        &[("x-forwarded-for", "5.6.7.8")],
    )
    .await;
    // 不記 IP 的話「事後把洗版的人加進黑名單」這個流程根本無從下手
    let ip: String = sqlx::query_scalar("SELECT ip FROM comments WHERE id = ?")
        .bind(resp["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ip, "5.6.7.8");
}

#[tokio::test]
async fn 關鍵字_reject_直接退回_spam_則收下但標記() {
    let (app, pool) = test_app().await;
    for (kw, action) in [("賭博", "reject"), ("代購", "spam")] {
        sqlx::query("INSERT INTO keyword_filters (keyword, action) VALUES (?, ?)")
            .bind(kw)
            .bind(action)
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, resp) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "甲", "content": "來玩賭博" }), &[]).await;
    assert_eq!(status, 400);
    assert_eq!(resp["error"], "留言內容包含不允許的詞彙");

    // spam 是「收下但不顯示」——直接退回的話洗版的人會知道自己被擋了、換個詞再來
    let (status, resp) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "乙", "content": "代購便宜" }), &[]).await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "spam");
    assert_eq!(status_in_db(&pool, resp["id"].as_i64().unwrap()).await, "spam");
}

#[tokio::test]
async fn 關鍵字比對不分大小寫而且也看名字() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO keyword_filters (keyword, action) VALUES ('viagra', 'reject')")
        .execute(&pool)
        .await
        .unwrap();

    // 只比對內容、或只比對原樣大小寫的話，這兩種最常見的變形都會漏
    for body in [
        json!({ "author": "路人", "content": "buy VIAGRA now" }),
        json!({ "author": "Viagra 專賣", "content": "正常的內容" }),
    ] {
        let (status, _) = post_with(&app, "/api/posts/1/comments", body.clone(), &[]).await;
        assert_eq!(status, 400, "{body} 應該被關鍵字擋下");
    }
}

#[tokio::test]
async fn 關鍵字_spam_勝過登入者的免審核() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO keyword_filters (keyword, action) VALUES ('代購', 'spam')")
        .execute(&pool)
        .await
        .unwrap();

    // 免審核不是通行證。登入者發廣告時若因為 is_oauth 就直接 approved，
    // 那條關鍵字規則等於只擋得住沒登入的人。
    let token = format!("Bearer {}", oauth_token(Some(9), Some("github")));
    let (status, resp) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "登入者", "content": "代購便宜" }),
        &[(header::AUTHORIZATION.as_str(), &token)],
    )
    .await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "spam", "登入者的廣告被直接放行了");
}

#[tokio::test]
async fn 沒有關鍵字命中時不受影響() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO keyword_filters (keyword, action) VALUES ('賭博', 'reject')")
        .execute(&pool)
        .await
        .unwrap();
    let (status, resp) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "正常留言" }), &[])
            .await;
    assert_eq!(status, 201);
    assert_eq!(resp["status"], "pending");
}

#[tokio::test]
async fn parent_id_是_0_或缺席都存成_null() {
    let (app, pool) = test_app().await;
    for body in [
        json!({ "author": "甲", "content": "頂層留言", "parent_id": 0 }),
        json!({ "author": "乙", "content": "也是頂層" }),
    ] {
        let (_, resp) = post_with(&app, "/api/posts/1/comments", body, &[]).await;
        // 存成 0 的話前端組樹時會去找 id=0 的父留言，整串就掛在一個不存在的節點底下
        let parent: Option<i64> = sqlx::query_scalar("SELECT parent_id FROM comments WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(parent, None);
    }
}

#[tokio::test]
async fn 有指定_parent_id_時要留住() {
    let (app, pool) = test_app().await;
    let (_, top) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "甲", "content": "頂層" }), &[]).await;
    let top_id = top["id"].as_i64().unwrap();

    let (_, reply) = post_with(
        &app,
        "/api/posts/1/comments",
        json!({ "author": "乙", "content": "回覆", "parent_id": top_id }),
        &[],
    )
    .await;
    let parent: Option<i64> = sqlx::query_scalar("SELECT parent_id FROM comments WHERE id = ?")
        .bind(reply["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(parent, Some(top_id));
}

#[tokio::test]
async fn 碎念的留言寫進_thought_id_而不是_post_id() {
    let (app, pool) = test_app().await;
    let (status, resp) =
        post_with(&app, "/api/thoughts/1/comments", json!({ "author": "路人", "content": "推" }), &[]).await;
    assert_eq!(status, 201);

    // 兩條路徑共用同一個 create_comment，差別只在傳進去的欄位名。傳錯的話留言會
    // 掛到同編號的**文章**底下 —— 碎念看不到它，而那篇文章底下多一則沒頭沒尾的留言。
    let (post_id, thought_id): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT post_id, thought_id FROM comments WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(thought_id, Some(1));
    assert_eq!(post_id, None);
}

#[tokio::test]
async fn 選填欄位缺席時存成空字串而不是_null() {
    let (app, pool) = test_app().await;
    let (_, resp) =
        post_with(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "內容" }), &[]).await;
    // 欄位在 schema 上是 DEFAULT ''，回應端也照 '' 處理；存成 NULL 的話後台列表
    // 會出現 null 字樣（而不是空白）
    let (email, website, avatar): (String, String, String) =
        sqlx::query_as("SELECT email, website, avatar_url FROM comments WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((email.as_str(), website.as_str(), avatar.as_str()), ("", "", ""));
}

#[tokio::test]
async fn body_不是合法_json_時回_json_錯誤而不是空白() {
    let (app, _pool) = test_app().await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/posts/1/comments")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{ 這不是 json"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&bytes).expect("錯誤回應本身也要是 JSON");
    assert!(v.get("error").is_some(), "沒有 error 欄位：{v}");
}
