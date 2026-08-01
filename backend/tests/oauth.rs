//! `handlers/oauth.rs` 的整合測試——這個檔在此之前是 **0% 覆蓋**（544 個 region）。
//!
//! 好消息是不用改正式程式碼：`env_url(key, default)` 早就讓五個上游位址可覆寫
//! （`GOOGLE_TOKEN_URL` / `GOOGLE_USER_URL` / `GITHUB_TOKEN_URL` / `GITHUB_USER_URL`
//! / `GITHUB_EMAILS_URL`），模組註解也寫明「provider URL 可 env 覆寫（僅測試）」。
//! 機制在、只是一直沒有人接上去。這裡用 wiremock 當假的 provider 跑完整條流程。
//!
//! ## 重點在 upsert 而不是覆蓋率
//!
//! 檔頭寫的使用者底線是「**不搞壞現有 user 狀態**」——OAuth 登入是唯一會在使用者
//! 毫無察覺的情況下改動帳號資料的路徑。搞壞的樣子是具體的：
//!   · 既有 ADMIN 再登入一次被降成 USER
//!   · 兩個 provider 的帳號沒有合併，變成兩個人
//!   · 或反過來，兩個沒有 email 的陌生人被合併成同一個人
//! 這幾條測的就是這些。
//!
//! ⚠ 用 `std::env::set_var` 指向 mock server，**依賴 nextest 的行程隔離**。

mod common;

use common::{TEST_SECRET, request, test_app_with_state};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// 架好 google 的兩支上游。`user` 是 `/userinfo` 要回的內容。
async fn mock_google(user: Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at-google" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/userinfo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(user))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("GOOGLE_TOKEN_URL", format!("{}/token", server.uri()));
        std::env::set_var("GOOGLE_USER_URL", format!("{}/userinfo", server.uri()));
    }
    server
}

/// 架好 github 的三支上游。`emails` 給 None 就不掛 `/user/emails`（模擬取不到）。
async fn mock_github(user: Value, emails: Option<Value>) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at-github" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(user))
        .mount(&server)
        .await;
    if let Some(e) = emails {
        Mock::given(method("GET"))
            .and(path("/user/emails"))
            .respond_with(ResponseTemplate::new(200).set_body_json(e))
            .mount(&server)
            .await;
    }
    unsafe {
        std::env::set_var("GITHUB_TOKEN_URL", format!("{}/token", server.uri()));
        std::env::set_var("GITHUB_USER_URL", format!("{}/user", server.uri()));
        std::env::set_var("GITHUB_EMAILS_URL", format!("{}/user/emails", server.uri()));
    }
    server
}

const OWNER_EMAIL: &str = "timo9378@gmail.com";

// ── 完整流程 ──────────────────────────────────────────────────────────────

/// Google 全流程：換 token → 取使用者 → 建帳號 → 簽 JWT，而且**那個 JWT 真的能用**。
///
/// 只斷言「有 token 欄位」是不夠的——拿去打 `/api/auth/me` 才驗得到 claims 的形狀
/// （userId + provider）跟驗章那層對得上。
#[tokio::test]
async fn google_callback_creates_the_user_and_issues_a_working_token() {
    let _g = mock_google(json!({
        "id": 12345, "name": "某人", "email": "someone@example.com",
        "picture": "https://img/g.png",
    }))
    .await;
    let (app, pool, _state) = test_app_with_state().await;

    let (status, body) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "abc" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["user"]["provider"], "google");
    assert_eq!(body["user"]["displayName"], "某人");
    assert_eq!(body["user"]["email"], "someone@example.com");
    assert_eq!(body["user"]["role"], "USER", "一般 email 應該是 USER");

    // 真的寫進 DB 了（provider_id 是字串化的數字——上游給的是 number）
    let row: (String, String) =
        sqlx::query_as("SELECT provider, provider_id FROM oauth_users WHERE display_name = '某人'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("google".into(), "12345".into()));

    // token 拿去恢復 session
    let token = body["token"].as_str().unwrap();
    let (status, me) = request(&app, "GET", "/api/auth/me", None, Some(token)).await;
    assert_eq!(status, 200, "OAuth 簽出來的 token 應該過得了 /me：{me}");
    assert_eq!(me["provider"], "google");
    assert_eq!(me["displayName"], "某人");
}

/// 簽出來的 JWT 是 30 天，而且帶 `userId` + `provider`。
///
/// 這兩個欄位是 `/auth/me` 用來分辨「OAuth token」與「legacy admin token」的依據，
/// 少一個就會被當成另一種而走錯分支。
#[tokio::test]
async fn oauth_token_carries_thirty_day_exp_and_the_oauth_shape() {
    let _g = mock_google(json!({ "id": 1, "name": "A", "email": "a@b.c", "picture": "" })).await;
    let (app, _pool, _s) = test_app_with_state().await;

    let (_, body) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
    let claims =
        koimsurai_web_backend::auth::verify_jwt(body["token"].as_str().unwrap(), TEST_SECRET).unwrap();

    assert!(claims["userId"].as_i64().unwrap() > 0, "要有 userId，否則 /me 會走成 legacy 分支");
    assert_eq!(claims["provider"], "google");
    let (iat, exp) = (claims["iat"].as_i64().unwrap(), claims["exp"].as_i64().unwrap());
    assert_eq!(exp - iat, 30 * 24 * 60 * 60, "OAuth token 是 30 天");
}

/// GitHub：`name` 有值就用 `name`。
#[tokio::test]
async fn github_prefers_name_over_login() {
    let _g = mock_github(
        json!({ "id": 7, "login": "octocat", "name": "The Octocat", "email": "o@github.com", "avatar_url": "" }),
        None,
    )
    .await;
    let (app, _pool, _s) = test_app_with_state().await;
    let (status, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["user"]["displayName"], "The Octocat");
}

/// GitHub：`name` 是 null 或空字串 → 退回 `login`（不能顯示成空白）。
#[tokio::test]
async fn github_falls_back_to_login_when_name_is_missing_or_blank() {
    for name in [Value::Null, json!("")] {
        let _g = mock_github(
            json!({ "id": 8, "login": "ghost", "name": name, "email": "g@github.com", "avatar_url": "" }),
            None,
        )
        .await;
        let (app, _pool, _s) = test_app_with_state().await;
        let (_, body) =
            request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(body["user"]["displayName"], "ghost");
    }
}

/// GitHub 的 `/user` 沒有 email → 去 `/user/emails` 取 **primary 那一筆**。
///
/// GitHub 使用者把 email 設成私密時 `/user` 的 email 就是 null，這是常態不是例外。
/// 取錯筆（例如取第一筆）會拿到未驗證的備用信箱，後續的「同 email 關聯」就會連錯人。
#[tokio::test]
async fn github_reads_the_primary_email_when_the_profile_hides_it() {
    let _g = mock_github(
        json!({ "id": 9, "login": "priv", "name": "Priv", "email": Value::Null, "avatar_url": "" }),
        Some(json!([
            { "email": "backup@example.com", "primary": false, "verified": true },
            { "email": "primary@example.com", "primary": true, "verified": true },
        ])),
    )
    .await;
    let (app, _pool, _s) = test_app_with_state().await;

    let (_, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(body["user"]["email"], "primary@example.com", "要取 primary 那一筆，不是第一筆");
}

/// `/user/emails` 取不到 → 吞掉，還是要能登入（只是沒有 email）。
#[tokio::test]
async fn github_login_still_succeeds_when_the_emails_endpoint_is_unavailable() {
    let _g = mock_github(
        json!({ "id": 10, "login": "noemail", "name": Value::Null, "email": Value::Null, "avatar_url": "" }),
        None, // 不掛 /user/emails → 404
    )
    .await;
    let (app, _pool, _s) = test_app_with_state().await;

    let (status, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(status, 200, "拿不到 email 不該讓登入失敗：{body}");
    assert_eq!(body["user"]["displayName"], "noemail");
}

// ── 錯誤路徑 ──────────────────────────────────────────────────────────────

/// 缺 code、或 code 是 JS 的 falsy 值 → 400。
///
/// 判準是 `js_truthy` 而不是 `is_some`，所以空字串 / 0 / false 都算沒給——
/// 這是照抄 Express 的 `if (!code)`，換成 `is_some` 會讓 `code: ""` 一路打到上游。
#[tokio::test]
async fn missing_or_falsy_code_is_rejected_before_touching_the_provider() {
    let (app, _pool, _s) = test_app_with_state().await;
    for body in [
        json!({}),
        json!({ "code": "" }),
        json!({ "code": 0 }),
        json!({ "code": false }),
        json!({ "code": Value::Null }),
    ] {
        for ep in ["/api/auth/google/callback", "/api/auth/github/callback"] {
            let (status, resp) = request(&app, "POST", ep, Some(body.clone()), None).await;
            assert_eq!(status, 400, "{ep} 收到 {body} 應該回 400：{resp}");
            assert_eq!(resp["error"], "Missing code");
        }
    }
}

/// 上游各種壞法都要收斂成 500 `{"error":"登入失敗"}`，不能把上游的錯誤原文吐給前端。
#[tokio::test]
async fn upstream_failures_all_collapse_to_a_generic_500() {
    // (情境, token 端點的回應)
    let cases: Vec<(&str, ResponseTemplate)> = vec![
        ("token 端點 500", ResponseTemplate::new(500).set_body_string("boom")),
        (
            "token 端點 401",
            ResponseTemplate::new(401).set_body_json(json!({ "error": "bad_verification_code" })),
        ),
        ("回應不是 JSON", ResponseTemplate::new(200).set_body_string("<html>not json</html>")),
        ("JSON 但沒有 access_token", ResponseTemplate::new(200).set_body_json(json!({ "error": "nope" }))),
    ];
    for (label, tmpl) in cases {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/token")).respond_with(tmpl).mount(&server).await;
        unsafe {
            std::env::set_var("GOOGLE_TOKEN_URL", format!("{}/token", server.uri()));
            std::env::set_var("GOOGLE_USER_URL", format!("{}/userinfo", server.uri()));
        }
        let (app, _pool, _s) = test_app_with_state().await;
        let (status, body) =
            request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(status, 500, "{label} 應該回 500：{body}");
        assert_eq!(body["error"], "登入失敗", "{label} 不該把上游原文吐出來");
    }
}

/// token 拿到了但 `/userinfo` 失敗 → 一樣 500（而不是建一個空白帳號）。
#[tokio::test]
async fn a_failing_userinfo_endpoint_does_not_create_a_blank_account() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/userinfo"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("GOOGLE_TOKEN_URL", format!("{}/token", server.uri()));
        std::env::set_var("GOOGLE_USER_URL", format!("{}/userinfo", server.uri()));
    }
    let (app, pool, _s) = test_app_with_state().await;

    let (status, _) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(status, 500);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0, "取不到使用者資訊時不該留下任何帳號");
}

// ── upsert 的分支語意（「不搞壞現有 user 狀態」）─────────────────────────

/// 同一個帳號再登入一次：資料更新，但 **role 不被覆蓋**。
///
/// 這是整個檔案最重要的一條。手動把某人升成 ADMIN 之後，他下次用 OAuth 登入
/// 就會被降回 USER——權限靜默消失，而且沒有任何錯誤訊息。
#[tokio::test]
async fn logging_in_again_updates_the_profile_but_never_downgrades_the_role() {
    let _g = mock_google(json!({
        "id": 42, "name": "新名字", "email": "admin@example.com", "picture": "https://img/new.png",
    }))
    .await;
    let (app, pool, _s) = test_app_with_state().await;
    sqlx::query(
        "INSERT INTO oauth_users (provider, provider_id, display_name, email, avatar_url, role) \
         VALUES ('google', '42', '舊名字', 'admin@example.com', 'https://img/old.png', 'ADMIN')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["user"]["role"], "ADMIN", "既有的 ADMIN 不該被降成 USER");
    assert_eq!(body["user"]["displayName"], "新名字", "顯示名稱應該更新");

    let (role, avatar): (String, String) =
        sqlx::query_as("SELECT role, avatar_url FROM oauth_users WHERE provider_id = '42'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role, "ADMIN");
    assert_eq!(avatar, "https://img/new.png");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 1, "同一個 (provider, provider_id) 不該再開一列");
}

/// OWNER 的 email 登入 → role 升級成 OWNER（**這是唯一會覆蓋 role 的情況**）。
#[tokio::test]
async fn the_owner_email_is_promoted_even_over_an_existing_role() {
    let _g = mock_google(json!({ "id": 1, "name": "站長", "email": OWNER_EMAIL, "picture": "" })).await;
    let (app, pool, _s) = test_app_with_state().await;
    sqlx::query(
        "INSERT INTO oauth_users (provider, provider_id, display_name, email, role) \
         VALUES ('google', '1', '站長', ?, 'USER')",
    )
    .bind(OWNER_EMAIL)
    .execute(&pool)
    .await
    .unwrap();

    let (_, body) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(body["user"]["role"], "OWNER");
}

/// OWNER 的判定**不分大小寫**——email 在各家 provider 的大小寫並不一致。
#[tokio::test]
async fn the_owner_email_match_is_case_insensitive() {
    let _g = mock_google(json!({
        "id": 2, "name": "站長", "email": OWNER_EMAIL.to_uppercase(), "picture": "",
    }))
    .await;
    let (app, _pool, _s) = test_app_with_state().await;
    let (_, body) =
        request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(body["user"]["role"], "OWNER", "大寫的 OWNER email 也該被認出來");
}

/// 用**另一個 provider**、但同一個 email 登入 → 連到既有帳號，回**主帳號**的身分。
///
/// 這是「同一個人用 Google 和 GitHub 各登入一次」的合併路徑。沒連起來的話，
/// 同一個人在站上會變成兩個身分，留言與權限各自獨立。
#[tokio::test]
async fn a_second_provider_with_the_same_email_links_to_the_existing_account() {
    let _g = mock_github(
        json!({ "id": 99, "login": "same", "name": "同一人", "email": "same@example.com", "avatar_url": "" }),
        None,
    )
    .await;
    let (app, pool, _s) = test_app_with_state().await;
    sqlx::query(
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, email, role) \
         VALUES (5, 'google', 'g-5', '主帳號', 'same@example.com', 'ADMIN')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["user"]["id"], 5, "應該回主帳號的 id");
    assert_eq!(body["user"]["displayName"], "主帳號");
    assert_eq!(body["user"]["role"], "ADMIN", "權限跟著主帳號");

    // 新的那一列存在，而且 linked_to 指向主帳號
    let linked: Option<i64> =
        sqlx::query_scalar("SELECT linked_to FROM oauth_users WHERE provider = 'github'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked, Some(5));
}

/// 同 email 關聯時，如果來的是 OWNER email → **主帳號**跟著升級。
#[tokio::test]
async fn linking_with_the_owner_email_promotes_the_primary_account() {
    let _g = mock_github(
        json!({ "id": 100, "login": "owner", "name": "站長", "email": OWNER_EMAIL, "avatar_url": "" }),
        None,
    )
    .await;
    let (app, pool, _s) = test_app_with_state().await;
    sqlx::query("INSERT INTO oauth_users (id, provider, provider_id, display_name, email, role) VALUES (6, 'google', 'g-6', '站長', ?, 'USER')")
        .bind(OWNER_EMAIL)
        .execute(&pool)
        .await
        .unwrap();

    let (_, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(body["user"]["role"], "OWNER");
    let role: String =
        sqlx::query_scalar("SELECT role FROM oauth_users WHERE id = 6").fetch_one(&pool).await.unwrap();
    assert_eq!(role, "OWNER", "主帳號本身也要被升級，不是只有回應寫 OWNER");
}

/// **沒有 email 的帳號不該被合併。**
///
/// 「同 email 關聯」那條的 SQL 有 `email != ""` 的守衛。少了它，兩個各自把 email
/// 設成私密的陌生人（email 都是空字串）會被當成同一個人連在一起——那是把 A 的
/// 帳號交給 B。
#[tokio::test]
async fn accounts_without_an_email_are_never_linked_together() {
    let _g = mock_github(
        json!({ "id": 200, "login": "anon-b", "name": Value::Null, "email": Value::Null, "avatar_url": "" }),
        None,
    )
    .await;
    let (app, pool, _s) = test_app_with_state().await;
    sqlx::query(
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, email, role) \
         VALUES (7, 'google', 'g-7', '另一個沒有 email 的人', '', 'USER')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (_, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_ne!(body["user"]["id"], 7, "沒有 email 的兩個帳號絕不能被合併");
    assert_eq!(body["user"]["displayName"], "anon-b");

    let linked: Option<i64> =
        sqlx::query_scalar("SELECT linked_to FROM oauth_users WHERE provider = 'github'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked, None, "不該連到任何主帳號");
}

/// 已經是關聯帳號的人再登入 → 仍然回**主帳號**（而不是自己那一列）。
#[tokio::test]
async fn an_already_linked_account_keeps_returning_the_primary() {
    let _g = mock_github(
        json!({ "id": 300, "login": "sub", "name": "副帳號", "email": "sub@example.com", "avatar_url": "" }),
        None,
    )
    .await;
    let (app, pool, _s) = test_app_with_state().await;
    for sql in [
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, email, role) VALUES (8, 'google', 'g-8', '主帳號', 'main@example.com', 'OWNER')",
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, email, role, linked_to) VALUES (9, 'github', '300', '副帳號', 'sub@example.com', 'USER', 8)",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }

    let (_, body) =
        request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
    assert_eq!(body["user"]["id"], 8, "應該回主帳號");
    assert_eq!(body["user"]["role"], "OWNER");
}

/// **非 2xx 但 body 長得像成功時，仍然不能放行。**
///
/// 這四條是 `cargo mutants` 逼出來的。上面那些錯誤路徑測試**通過的理由是錯的**：
/// 回 500 時 body 是 `"boom"`（JSON parse 失敗）、回 401 時 body 沒有 `access_token`，
/// 兩種都會在**後面**的分支被擋下——把 `r.status().is_success()` 這個守衛整個拿掉，
/// 那些測試照樣綠。
///
/// 守衛真正擋的是這種：provider 回 401/403，但 body 裡剛好有 `access_token`
/// 或一份看起來正常的使用者資料。少了它就等於「上游說不行、我們還是讓他登入」。
#[tokio::test]
async fn a_non_2xx_token_response_is_rejected_even_if_it_contains_an_access_token() {
    for status in [400u16, 401, 403, 500] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(json!({ "access_token": "看起來很像真的" })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/userinfo"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 1, "name": "不該進來的人", "email": "x@y.z", "picture": ""
            })))
            .mount(&server)
            .await;
        unsafe {
            std::env::set_var("GOOGLE_TOKEN_URL", format!("{}/token", server.uri()));
            std::env::set_var("GOOGLE_USER_URL", format!("{}/userinfo", server.uri()));
        }
        let (app, pool, _s) = test_app_with_state().await;

        let (code, body) =
            request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(code, 500, "token 端點回 {status} 就不該放行，即使 body 有 access_token：{body}");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "token 端點回 {status} 卻建了帳號");
    }
}

/// 同上，但壞在 `/userinfo`：狀態碼是 401、body 卻是一份正常的使用者資料。
#[tokio::test]
async fn a_non_2xx_userinfo_response_is_rejected_even_if_the_body_looks_valid() {
    for status in [401u16, 403, 500] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at" })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/userinfo"))
            .respond_with(ResponseTemplate::new(status).set_body_json(json!({
                "id": 999, "name": "不該進來的人", "email": "evil@example.com", "picture": ""
            })))
            .mount(&server)
            .await;
        unsafe {
            std::env::set_var("GOOGLE_TOKEN_URL", format!("{}/token", server.uri()));
            std::env::set_var("GOOGLE_USER_URL", format!("{}/userinfo", server.uri()));
        }
        let (app, pool, _s) = test_app_with_state().await;

        let (code, body) =
            request(&app, "POST", "/api/auth/google/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(code, 500, "/userinfo 回 {status} 就不該放行：{body}");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "/userinfo 回 {status} 卻建了帳號");
    }
}

/// GitHub 的兩支端點同樣要守。
#[tokio::test]
async fn github_also_rejects_non_2xx_responses_with_plausible_bodies() {
    // token 端點壞
    {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "access_token": "假的" })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": 1, "login": "evil", "name": "Evil", "email": "e@x.y", "avatar_url": ""
            })))
            .mount(&server)
            .await;
        unsafe {
            std::env::set_var("GITHUB_TOKEN_URL", format!("{}/token", server.uri()));
            std::env::set_var("GITHUB_USER_URL", format!("{}/user", server.uri()));
            std::env::set_var("GITHUB_EMAILS_URL", format!("{}/user/emails", server.uri()));
        }
        let (app, pool, _s) = test_app_with_state().await;
        let (code, _) =
            request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(code, 500, "token 端點 401 不該放行");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0);
    }
    // /user 壞
    {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at" })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "id": 2, "login": "evil2", "name": "Evil2", "email": "e2@x.y", "avatar_url": ""
            })))
            .mount(&server)
            .await;
        unsafe {
            std::env::set_var("GITHUB_TOKEN_URL", format!("{}/token", server.uri()));
            std::env::set_var("GITHUB_USER_URL", format!("{}/user", server.uri()));
            std::env::set_var("GITHUB_EMAILS_URL", format!("{}/user/emails", server.uri()));
        }
        let (app, pool, _s) = test_app_with_state().await;
        let (code, _) =
            request(&app, "POST", "/api/auth/github/callback", Some(json!({ "code": "x" })), None).await;
        assert_eq!(code, 500, "/user 回 403 不該放行");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_users").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0);
    }
}
