//! `handlers/auth.rs` 的整合測試——這個檔在此之前是 **0% 覆蓋**。
//!
//! 為什麼優先補這裡：它是密碼驗證與 JWT 簽發的入口（`POST /api/auth/login`），
//! 而動手前確認過**全 repo 沒有任何測試打過 `/api/auth/*`**：
//!   · 後端測試：grep 只命中 schema 快照裡的 `oauth_users` 表名
//!   · e2e：只驗「未登入時 /admin/login 會導回」，從來沒有真的登入過
//!   · schemathesis：只證明它不會 500，不證明「密碼錯會拒絕、密碼對會發正確的 token」
//! 也就是說，改壞登入邏輯整條 CI 都不會紅。
//!
//! ⚠ 這個檔用 `std::env::set_var`。**依賴 nextest 的行程隔離**（每個測試各自一個
//! 行程），因為 `providers()` 與 `reset_admin()` 直接讀 env、沒有注入點。
//! 專案的門檻指令是 `cargo llvm-cov nextest`，成立；但用 `cargo test` 跑會互相污染。

mod common;

use common::{TEST_SECRET, request, request_full, test_app};
use serde_json::json;

/// 測試用的密碼雜湊。cost 用 4 不是正式的 10——`bcrypt::verify` 從 hash 字串裡讀 cost，
/// 驗證行為完全相同，但每次建 fixture 從數十毫秒降到幾乎不花時間。
fn hash_for(password: &str) -> String {
    bcrypt::hash(password, 4).unwrap()
}

async fn seed_admin(pool: &sqlx::SqlitePool, username: &str, password: &str, role: &str) {
    sqlx::query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
        .bind(username)
        .bind(hash_for(password))
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

// ── POST /api/auth/login ──────────────────────────────────────────────────

/// 登入成功，而且**簽出來的 token 真的能用**。
///
/// 只斷言「回應裡有 token 欄位」是不夠的——那條在 token 內容全錯時照樣綠。
/// 這裡把它拿去打一個 require_admin 的端點，走完整條驗章＋查角色的路徑。
#[tokio::test]
async fn login_succeeds_and_the_token_actually_authenticates() {
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "correct-horse", "OWNER").await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "correct-horse" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "正確帳密應該登入成功：{body}");
    assert_eq!(body["message"], "登入成功");
    assert_eq!(body["user"]["username"], "admin");
    assert_eq!(body["user"]["role"], "OWNER");

    let token = body["token"].as_str().expect("回應應該帶 token");
    let (status, _) = request(&app, "GET", "/api/admin/tags", None, Some(token)).await;
    assert_eq!(status, 200, "登入拿到的 token 應該通得過 require_admin");
}

/// 簽出來的 token 帶 7 天的 exp 與正確的 role。
///
/// exp 特別要驗：`crate::auth` 那邊刻意拒絕不帶 exp 的 token（避免永不過期），
/// 所以「login 有沒有寫 exp」是兩段程式碼之間的隱性契約，斷了會在別處才炸。
#[tokio::test]
async fn login_token_carries_seven_day_exp_and_role() {
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "pw", "ADMIN").await;

    let (_, body) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "pw" })),
        None,
    )
    .await;
    let token = body["token"].as_str().unwrap();
    let claims = koimsurai_web_backend::auth::verify_jwt(token, TEST_SECRET).expect("token 應該驗得過");

    assert_eq!(claims["role"], "ADMIN");
    assert_eq!(claims["username"], "admin");
    let iat = claims["iat"].as_i64().expect("應該有 iat");
    let exp = claims["exp"].as_i64().expect("應該有 exp——沒有的話 require_admin 會一律拒絕");
    assert_eq!(exp - iat, 7 * 24 * 60 * 60, "exp 應該是簽發後 7 天");
}

/// 密碼錯 → 401。
#[tokio::test]
async fn login_rejects_wrong_password() {
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "right", "OWNER").await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "wrong" })),
        None,
    )
    .await;
    assert_eq!(status, 401);
    assert_eq!(body["message"], "用戶名或密碼錯誤");
    assert!(body.get("token").is_none(), "被拒絕時不該回 token");
}

/// **帳號不存在與密碼錯誤的回應必須完全一樣**（狀態碼、body、以及沒有 token）。
///
/// 這條不是為了覆蓋率——是使用者列舉的防線。只要兩者可區分（訊息不同、狀態碼不同、
/// 甚至只是耗時差很多），攻擊者就能一個一個試出哪些帳號存在，再對那些帳號集中爆破。
#[tokio::test]
async fn unknown_user_is_indistinguishable_from_wrong_password() {
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "right", "OWNER").await;

    let (s1, h1, b1) = request_full(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "wrong" })),
        None,
    )
    .await;
    let (s2, h2, b2) = request_full(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "no-such-user", "password": "wrong" })),
        None,
    )
    .await;

    assert_eq!(s1, s2, "帳號不存在與密碼錯誤的狀態碼必須相同");
    assert_eq!(b1, b2, "兩者的 body 必須逐字相同，否則可以用來列舉帳號");
    assert_eq!(h1.get("content-type"), h2.get("content-type"));
}

/// 上一條的**全稱版**：對任意錯誤憑證，回應都必須跟「已知帳號 + 錯密碼」逐字相同。
///
/// 手寫版只驗一組 `no-such-user`，而這是個「對所有錯誤憑證都成立」的性質——
/// 差別在於：如果哪天有人加了「帳號含特殊字元時提早回不同的錯誤」這種分支，
/// 單組斷言抓不到，這條會。
///
/// 不用 `proptest!` 巨集是因為它的 closure 是同步的，而這裡要 await HTTP。
/// 改成自己從 strategy 取值：`deterministic()` 讓失敗可重現（同一組 seed 同一批輸入），
/// 代價是沒有自動收斂（shrink）——但這個性質一旦失敗，把那組輸入直接印出來就夠了。
#[tokio::test]
async fn any_bad_credentials_produce_a_byte_identical_rejection() {
    use proptest::strategy::{Strategy, ValueTree};
    use proptest::test_runner::TestRunner;

    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "the-real-password", "OWNER").await;

    // 基準：帳號存在、密碼錯
    let (ref_status, ref_headers, ref_body) = request_full(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "definitely-wrong" })),
        None,
    )
    .await;
    assert_eq!(ref_status, 401, "基準本身就該是 401");

    let strategy = ("[\\PC]{1,24}", "[\\PC]{1,32}");
    let mut runner = TestRunner::deterministic();
    for _ in 0..64 {
        let (user, pass) = strategy.new_tree(&mut runner).unwrap().current();
        // 唯一該放行的那組不算數
        if user == "admin" && pass == "the-real-password" {
            continue;
        }
        let (status, headers, body) = request_full(
            &app,
            "POST",
            "/api/auth/login",
            Some(json!({ "username": user, "password": pass })),
            None,
        )
        .await;
        assert_eq!(status, ref_status, "({user:?}, {pass:?}) 的狀態碼與基準不同");
        assert_eq!(body, ref_body, "({user:?}, {pass:?}) 的 body 與基準不同——可用來探測帳號是否存在");
        assert_eq!(headers.get("content-type"), ref_headers.get("content-type"));
    }
}

/// 缺欄位／空字串一律 400（Express 的 `if (!username || !password)`，空字串也算缺）。
#[tokio::test]
async fn login_requires_both_fields_and_treats_empty_string_as_missing() {
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "pw", "OWNER").await;

    for body in [
        json!({}),
        json!({ "username": "admin" }),
        json!({ "password": "pw" }),
        json!({ "username": "", "password": "pw" }),
        json!({ "username": "admin", "password": "" }),
    ] {
        let (status, resp) = request(&app, "POST", "/api/auth/login", Some(body.clone()), None).await;
        assert_eq!(status, 400, "{body} 應該回 400，實際 {status}：{resp}");
        assert_eq!(resp["message"], "請提供用戶名和密碼");
    }
}

/// DB 裡的 hash 壞掉 → 當成密碼錯（401），不是 500。
///
/// `bcrypt::verify` 對非法 hash 回 `Err`，而 handler 用 `unwrap_or(false)` 吃掉。
/// 把那個 `false` 改成 `true` 的話，**任何密碼都能登入壞掉的帳號**——所以這條要有。
#[tokio::test]
async fn corrupt_password_hash_is_a_rejection_not_a_server_error() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO users (username, password_hash, role) VALUES ('broken', 'not-a-bcrypt-hash', 'OWNER')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "broken", "password": "anything" })),
        None,
    )
    .await;
    assert_eq!(status, 401, "hash 壞掉應該當成密碼錯，而不是放行或 500：{body}");
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────

#[tokio::test]
async fn me_without_token_is_not_authenticated() {
    let (app, _pool) = test_app().await;
    let (status, body) = request(&app, "GET", "/api/auth/me", None, None).await;
    assert_eq!(status, 401);
    // 注意 key 是 error 不是 message——這支與 login 的錯誤形狀刻意不同（對齊 Express）
    assert_eq!(body["error"], "Not authenticated");
}

#[tokio::test]
async fn me_with_garbage_token_is_invalid() {
    let (app, _pool) = test_app().await;
    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some("not.a.jwt")).await;
    assert_eq!(status, 401);
    assert_eq!(body["error"], "Invalid token");
}

/// legacy admin token（只有 username，沒有 userId）→ 回固定的 OWNER 身分。
#[tokio::test]
async fn me_accepts_legacy_admin_token() {
    let (app, _pool) = test_app().await;
    let token = common::owner_token(true);

    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some(&token)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["provider"], "admin");
    assert_eq!(body["role"], "OWNER");
    assert_eq!(body["isAdmin"], true);
    assert_eq!(body["displayName"], "admin");
}

/// OAuth token → 從 oauth_users 撈資料。
#[tokio::test]
async fn me_returns_oauth_user_from_db() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, email, avatar_url, role) \
         VALUES (7, 'github', 'gh-1', '某人', 'a@b.c', 'https://img/1.png', 'ADMIN')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some(&oauth_token(7, "github"))).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["id"], 7);
    assert_eq!(body["displayName"], "某人");
    assert_eq!(body["email"], "a@b.c");
    assert_eq!(body["avatar"], "https://img/1.png");
    assert_eq!(body["provider"], "github");
    assert_eq!(body["role"], "ADMIN");
}

/// `linked_to` → 回**主帳號**的資料而不是自己的。
///
/// 這是「同一個人用 Google 和 GitHub 各登入一次」的合併路徑：關聯帳號登入時，
/// 前端拿到的身分（含 role）必須是主帳號的。錯了會變成權限降級或越權。
#[tokio::test]
async fn me_follows_linked_to_and_returns_the_primary_account() {
    let (app, pool) = test_app().await;
    for sql in [
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, role) VALUES (1, 'google', 'g-1', '主帳號', 'OWNER')",
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, role, linked_to) VALUES (2, 'github', 'gh-2', '副帳號', 'USER', 1)",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }

    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some(&oauth_token(2, "github"))).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["id"], 1, "應該回主帳號的 id");
    assert_eq!(body["displayName"], "主帳號");
    assert_eq!(body["role"], "OWNER", "role 要跟著主帳號，不是副帳號的 USER");
}

/// `linked_to` 指向不存在的 id → 退回自身資料（而不是 401 或 500）。
#[tokio::test]
async fn me_falls_back_to_self_when_the_linked_account_is_gone() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, role, linked_to) \
         VALUES (3, 'github', 'gh-3', '孤兒帳號', 'USER', 999)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some(&oauth_token(3, "github"))).await;
    assert_eq!(status, 200, "主帳號不見了不該讓使用者登不進來：{body}");
    assert_eq!(body["id"], 3);
    assert_eq!(body["displayName"], "孤兒帳號");
}

/// role 是空字串 → 退回 "USER"（Express 的 `user.role || 'USER'`）。
///
/// 空字串在 SQL 層是合法值、在 Rust 是 `Some("")`，只有 `filter(|r| !r.is_empty())`
/// 那一段擋得住。少了它前端會拿到 `role: ""`，而權限判斷多半寫成 `role === 'ADMIN'`——
/// 不會爆，但會靜默降權。
#[tokio::test]
async fn me_defaults_empty_role_to_user() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO oauth_users (id, provider, provider_id, display_name, role) VALUES (4, 'google', 'g-4', '無角色', '')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (_, body) = request(&app, "GET", "/api/auth/me", None, Some(&oauth_token(4, "google"))).await;
    assert_eq!(body["role"], "USER");
}

/// 帶 userId 但查不到人 → 401（不是 500，也不是回一個空使用者）。
#[tokio::test]
async fn me_rejects_token_for_a_deleted_user() {
    let (app, _pool) = test_app().await;
    let (status, body) = request(&app, "GET", "/api/auth/me", None, Some(&oauth_token(404, "github"))).await;
    assert_eq!(status, 401);
    assert_eq!(body["error"], "User not found");
}

/// 簽一個 OAuth 形狀的 token（帶 userId + provider）。
fn oauth_token(user_id: i64, provider: &str) -> String {
    let now = koimsurai_web_backend::util::now_secs();
    let claims = json!({ "userId": user_id, "provider": provider, "iat": now, "exp": now + 3600 });
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap()
}

// ── GET /api/auth/providers、POST /api/auth/logout ────────────────────────

/// 沒設 env → 兩個 provider 都在，但 enabled=false、clientId 是空字串。
///
/// 「都在但 enabled=false」是刻意的契約：前端靠 enabled 決定要不要畫按鈕，
/// 如果改成缺欄位，前端的 `providers.google.enabled` 會讀到 undefined 而不是 false。
#[tokio::test]
async fn providers_reports_disabled_when_env_is_unset() {
    unsafe {
        std::env::remove_var("GOOGLE_CLIENT_ID");
        std::env::remove_var("GITHUB_CLIENT_ID");
    }
    let (app, _pool) = test_app().await;
    let (status, body) = request(&app, "GET", "/api/auth/providers", None, None).await;
    assert_eq!(status, 200);
    for p in ["google", "github"] {
        assert_eq!(body[p]["enabled"], false, "{p} 沒設 env 應該是 disabled");
        assert_eq!(body[p]["clientId"], "", "{p} 的 clientId 應該是空字串而不是缺欄位");
    }
}

#[tokio::test]
async fn providers_reports_enabled_when_client_id_is_set() {
    unsafe {
        std::env::set_var("GOOGLE_CLIENT_ID", "goog-123");
        std::env::remove_var("GITHUB_CLIENT_ID");
    }
    let (app, _pool) = test_app().await;
    let (_, body) = request(&app, "GET", "/api/auth/providers", None, None).await;
    assert_eq!(body["google"]["enabled"], true);
    assert_eq!(body["google"]["clientId"], "goog-123", "clientId 是公開值，前端組授權 URL 要用");
    assert_eq!(body["github"]["enabled"], false, "只設了一個時，另一個不該被連帶打開");
}

#[tokio::test]
async fn logout_is_stateless_ok() {
    let (app, _pool) = test_app().await;
    let (status, body) = request(&app, "POST", "/api/auth/logout", None, None).await;
    assert_eq!(status, 200);
    assert_eq!(body["message"], "ok");
}

// ── POST /api/auth/reset-admin ────────────────────────────────────────────

/// 預設關閉 → 404。
///
/// 這是安全發現 #3 的修正：原本 Express 靠 `NODE_ENV==='production'` 擋，而容器沒設
/// NODE_ENV，等於在正式環境是活的。改成 fail-safe——沒有顯式 `ENABLE_RESET_ADMIN=1`
/// 就一律 404。這條測試守的就是那個預設值。
#[tokio::test]
async fn reset_admin_is_closed_by_default() {
    unsafe { std::env::remove_var("ENABLE_RESET_ADMIN") };
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "old-password", "OWNER").await;

    let (status, _) =
        request(&app, "POST", "/api/auth/reset-admin", Some(json!({ "password": "hijacked" })), None).await;
    assert_eq!(status, 404, "沒開 ENABLE_RESET_ADMIN 時必須是 404");

    // 而且密碼真的沒被改掉——只斷言狀態碼的話，「回 404 但還是改了」會漏掉
    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "old-password" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "舊密碼應該還能用");
}

/// 開啟後重置既有帳號的密碼——並且**用新密碼真的登入一次**。
#[tokio::test]
async fn reset_admin_updates_the_password_and_the_new_one_works() {
    unsafe {
        std::env::set_var("ENABLE_RESET_ADMIN", "1");
        std::env::remove_var("ADMIN_USERNAME");
        std::env::remove_var("ADMIN_PASSWORD");
    }
    let (app, pool) = test_app().await;
    seed_admin(&pool, "admin", "old-password", "OWNER").await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/reset-admin",
        Some(json!({ "username": "admin", "password": "brand-new" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["username"], "admin");

    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "brand-new" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "新密碼應該能登入");

    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "admin", "password": "old-password" })),
        None,
    )
    .await;
    assert_eq!(status, 401, "舊密碼應該失效");
}

/// 帳號不存在 → 建立（走 INSERT 那條分支），一樣要能登入。
#[tokio::test]
async fn reset_admin_creates_the_user_when_absent() {
    unsafe {
        std::env::set_var("ENABLE_RESET_ADMIN", "1");
        std::env::remove_var("ADMIN_USERNAME");
        std::env::remove_var("ADMIN_PASSWORD");
    }
    let (app, pool) = test_app().await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/reset-admin",
        Some(json!({ "username": "fresh", "password": "pw-fresh" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(body["message"].as_str().unwrap().contains("已創建"), "訊息應該說是創建而不是重置：{body}");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE username = 'fresh'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "fresh", "password": "pw-fresh" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "新建的帳號應該能登入");
}

/// env 的 ADMIN_USERNAME / ADMIN_PASSWORD 優先於 request body。
///
/// 順序寫反的話，任何人只要打得到這支就能指定自己的密碼——所以是安全相關而不只是行為。
#[tokio::test]
async fn reset_admin_prefers_env_over_request_body() {
    unsafe {
        std::env::set_var("ENABLE_RESET_ADMIN", "1");
        std::env::set_var("ADMIN_USERNAME", "env-user");
        std::env::set_var("ADMIN_PASSWORD", "env-password");
    }
    let (app, _pool) = test_app().await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/auth/reset-admin",
        Some(json!({ "username": "body-user", "password": "body-password" })),
        None,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["username"], "env-user", "帳號應該取 env 的");

    // env 的密碼能登入
    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "env-user", "password": "env-password" })),
        None,
    )
    .await;
    assert_eq!(status, 200);

    // body 帶的密碼不能
    let (status, _) = request(
        &app,
        "POST",
        "/api/auth/login",
        Some(json!({ "username": "env-user", "password": "body-password" })),
        None,
    )
    .await;
    assert_eq!(status, 401, "body 帶的密碼不該生效");
}

/// 開了但完全沒有密碼可用（env 沒設、body 也沒帶）→ 400，而不是用預設值建帳號。
#[tokio::test]
async fn reset_admin_refuses_when_no_password_is_available() {
    unsafe {
        std::env::set_var("ENABLE_RESET_ADMIN", "1");
        std::env::remove_var("ADMIN_USERNAME");
        std::env::remove_var("ADMIN_PASSWORD");
    }
    let (app, _pool) = test_app().await;

    let (status, body) = request(&app, "POST", "/api/auth/reset-admin", Some(json!({})), None).await;
    assert_eq!(status, 400, "沒有任何密碼來源時應該拒絕：{body}");
    assert!(body["message"].as_str().unwrap().contains("ADMIN_PASSWORD"));
}
