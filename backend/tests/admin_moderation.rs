//! 後台的「留言審核」與兩個沒人碰過的破壞性操作（刪分類、改使用者角色）。
//!
//! `tests/admin.rs` 已經涵蓋了標籤、分類、文章、碎念的往返，但留言審核那一整片
//! ——列表、批次改狀態、回覆、編輯、刪除——一條都沒有。而那正是站長每天真的會用的
//! 那幾顆按鈕：批次核准壞掉的樣子是「按了、回 200、清單沒變」。
//!
//! 另外兩支放在這裡是因為它們的共同點是**破壞性且不可逆**：
//!   · `delete_category` 會順手把所有引用它的文章 `category` 設成 NULL
//!   · `admin_update_user_role` 改的是誰能進後台
//! 這兩支各自有一個「弄錯就出事、但不會有任何症狀」的細節：前者回報的 affected_posts
//! 若算錯，站長不會知道自己剛剛清空了幾篇文章的分類；後者若少了「不能改自己」那一道，
//! 唯一的 OWNER 可以把自己降級，然後再也沒有人能改回來。

mod common;

use common::{owner_token, request, test_app};
use serde_json::{Value, json};

/// 幾則不同狀態的留言，讓列表的過濾與計數測得出東西。
async fn seed_comments(pool: &sqlx::SqlitePool) {
    for (author, content, status, post_id, ip) in [
        ("甲", "第一則", "pending", Some(1), "1.1.1.1"),
        ("乙", "第二則", "approved", Some(1), "2.2.2.2"),
        ("丙", "第三則", "spam", Some(1), "3.3.3.3"),
        ("丁", "關鍵字在這", "pending", Some(2), "4.4.4.4"),
        ("戊", "碎念的留言", "approved", None, "5.5.5.5"),
    ] {
        sqlx::query(
            "INSERT INTO comments (post_id, thought_id, author, content, status, ip) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(post_id)
        .bind(if post_id.is_none() { Some(1_i64) } else { None })
        .bind(author)
        .bind(content)
        .bind(status)
        .bind(ip)
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn admin_get(app: &axum::Router, path: &str) -> (axum::http::StatusCode, Value) {
    request(app, "GET", path, None, Some(&owner_token(true))).await
}

async fn admin_send(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (axum::http::StatusCode, Value) {
    request(app, method, path, body, Some(&owner_token(true))).await
}

// ── 留言列表 ──────────────────────────────────────────────────────────

#[tokio::test]
async fn 留言列表預設不過濾_並附上全站狀態分佈() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, body) = admin_get(&app, "/api/admin/comments").await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], 5);
    assert_eq!(body["comments"].as_array().unwrap().len(), 5);

    // counts 是**全站**分佈，不套用當前過濾——後台側欄的「待審核 (3)」靠它，
    // 若跟著過濾走，點進「待審核」之後那個數字就會變成 3→3 自我循環，永遠看不出還有多少別的
    assert_eq!(body["counts"]["pending"], 2);
    assert_eq!(body["counts"]["approved"], 2);
    assert_eq!(body["counts"]["spam"], 1);
    assert_eq!(body["counts"]["trash"], 0);
}

#[tokio::test]
async fn 依狀態過濾_而_all_等於不過濾() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (_, body) = admin_get(&app, "/api/admin/comments?status=pending").await;
    assert_eq!(body["total"], 2);
    for c in body["comments"].as_array().unwrap() {
        assert_eq!(c["status"], "pending");
    }

    // 'all' 是前端下拉的預設值，被當成一個真的狀態去比對的話清單會全空
    let (_, body) = admin_get(&app, "/api/admin/comments?status=all").await;
    assert_eq!(body["total"], 5);
}

#[tokio::test]
async fn 依文章過濾() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;
    let (_, body) = admin_get(&app, "/api/admin/comments?post_id=1").await;
    assert_eq!(body["total"], 3);
}

#[tokio::test]
async fn 搜尋同時看內容_作者_與_ip() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    // IP 也在搜尋範圍內是刻意的：處理洗版時第一件事就是拿 IP 反查他還留了什麼
    for (q, want, why) in
        [("關鍵字", 1, "內容"), ("丙", 1, "作者"), ("4.4.4.4", 1, "IP"), ("第", 3, "內容子字串")]
    {
        let (_, body) = admin_get(&app, &format!("/api/admin/comments?search={q}")).await;
        assert_eq!(body["total"], want, "搜尋「{q}」（{why}）的結果數不對");
    }
}

#[tokio::test]
async fn 分頁的_page_與_limit_會反映在回應裡() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (_, body) = admin_get(&app, "/api/admin/comments?page=2&limit=2").await;
    assert_eq!(body["comments"].as_array().unwrap().len(), 2);
    // total 是「符合條件的全部」而不是本頁筆數——搞混的話分頁器會只剩一頁
    assert_eq!(body["total"], 5);
    assert_eq!(body["page"], 2);
    assert_eq!(body["limit"], 2);

    let (_, last) = admin_get(&app, "/api/admin/comments?page=3&limit=2").await;
    assert_eq!(last["comments"].as_array().unwrap().len(), 1);
    let (_, past_end) = admin_get(&app, "/api/admin/comments?page=9&limit=2").await;
    assert_eq!(past_end["comments"].as_array().unwrap().len(), 0, "超出範圍該是空頁不是報錯");
}

#[tokio::test]
async fn 留言列表帶得出文章標題() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;
    let (_, body) = admin_get(&app, "/api/admin/comments?post_id=1").await;
    // LEFT JOIN 掉了的話後台只看得到留言內容、看不出它掛在哪篇文章底下
    assert_eq!(body["comments"][0]["post_title"], "公開文章");

    // 碎念的留言沒有 post_id，LEFT JOIN 要讓它留下來（用 INNER JOIN 會整批消失）
    let (_, all) = admin_get(&app, "/api/admin/comments").await;
    let orphan = all["comments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["author"] == "戊")
        .expect("碎念的留言不該被 JOIN 濾掉");
    assert!(orphan["post_title"].is_null());
}

#[tokio::test]
async fn 留言列表要管理員身分() {
    let (app, _pool) = test_app().await;
    let (status, _) = request(&app, "GET", "/api/admin/comments", None, None).await;
    assert_eq!(status, 401);
}

// ── 批次改狀態 ────────────────────────────────────────────────────────

#[tokio::test]
async fn 批次核准會一次改掉指定的幾則() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, body) = admin_send(
        &app,
        "PATCH",
        "/api/admin/comments/batch/status",
        Some(json!({ "ids": [1, 3], "status": "approved" })),
    )
    .await;
    assert_eq!(status, 200);
    // affected 是站長唯一的回饋。回總數或回 0 都會讓「按了到底有沒有生效」變成靠猜
    assert_eq!(body["affected"], 2);

    let approved: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM comments WHERE status='approved' AND id IN (1,3)")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(approved, 2);
    // 沒被點到的那幾則不能動
    let untouched: String =
        sqlx::query_scalar("SELECT status FROM comments WHERE id = 4").fetch_one(&pool).await.unwrap();
    assert_eq!(untouched, "pending");
}

#[tokio::test]
async fn 批次改狀態擋掉空清單與不認識的狀態() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    for body in [
        json!({ "ids": [], "status": "approved" }),
        json!({ "status": "approved" }),
        json!({ "ids": [1], "status": "亂寫" }),
        json!({ "ids": [1] }),
        // 陣列裡不是數字的會被濾掉 → 等同空清單
        json!({ "ids": ["abc"], "status": "approved" }),
    ] {
        let (status, resp) =
            admin_send(&app, "PATCH", "/api/admin/comments/batch/status", Some(body.clone())).await;
        assert_eq!(status, 400, "{body} 應該被擋");
        assert_eq!(resp["error"], "Invalid request");
    }

    // 擋下來的請求一則都不能改到
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments WHERE status='pending'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pending, 2);
}

#[tokio::test]
async fn 批次改狀態四種狀態都收() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;
    for s in ["pending", "approved", "spam", "trash"] {
        let (status, _) = admin_send(
            &app,
            "PATCH",
            "/api/admin/comments/batch/status",
            Some(json!({ "ids": [1], "status": s })),
        )
        .await;
        assert_eq!(status, 200, "{s} 應該是合法狀態");
        let now: String =
            sqlx::query_scalar("SELECT status FROM comments WHERE id=1").fetch_one(&pool).await.unwrap();
        assert_eq!(now, s);
    }
}

// ── 回覆 / 編輯 / 刪除 ────────────────────────────────────────────────

#[tokio::test]
async fn 站長回覆會掛在原留言底下並直接過審() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, body) =
        admin_send(&app, "POST", "/api/admin/comments/1/reply", Some(json!({ "content": "謝謝" }))).await;
    assert_eq!(status, 201);

    let (post_id, parent_id, is_admin, st, author): (Option<i64>, Option<i64>, i64, String, String) =
        sqlx::query_as("SELECT post_id, parent_id, is_admin, status, author FROM comments WHERE id = ?")
            .bind(body["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    // post_id 要跟著原留言走：拿不到的話回覆會變成孤兒，文章頁上看不到它
    assert_eq!(post_id, Some(1));
    assert_eq!(parent_id, Some(1));
    assert_eq!(is_admin, 1, "站長的回覆要標成 admin，前台才畫得出那個徽章");
    assert_eq!(st, "approved", "站長自己的回覆還要等審核就荒謬了");
    assert_eq!(author, "站長");
}

#[tokio::test]
async fn 回覆不存在的留言是_404_內容空的是_400() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, resp) =
        admin_send(&app, "POST", "/api/admin/comments/9999/reply", Some(json!({ "content": "在嗎" }))).await;
    assert_eq!(status, 404);
    assert_eq!(resp["error"], "Parent comment not found");

    for body in [json!({ "content": "" }), json!({})] {
        let (status, resp) = admin_send(&app, "POST", "/api/admin/comments/1/reply", Some(body)).await;
        assert_eq!(status, 400);
        assert_eq!(resp["error"], "Content is required");
    }
}

#[tokio::test]
async fn 回覆碎念留言時_post_id_是_null_而不是報錯() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;
    // 第 5 則是碎念的留言（post_id 為 NULL）。把「查得到但值是 NULL」誤判成
    // 「查不到」的話，碎念底下的留言就永遠回不了。
    let (status, body) =
        admin_send(&app, "POST", "/api/admin/comments/5/reply", Some(json!({ "content": "收到" }))).await;
    assert_eq!(status, 201);
    let post_id: Option<i64> = sqlx::query_scalar("SELECT post_id FROM comments WHERE id = ?")
        .bind(body["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(post_id, None);
}

#[tokio::test]
async fn 編輯留言內容() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, _) =
        admin_send(&app, "PUT", "/api/admin/comments/1", Some(json!({ "content": "改過的內容" }))).await;
    assert_eq!(status, 200);
    let content: String =
        sqlx::query_scalar("SELECT content FROM comments WHERE id=1").fetch_one(&pool).await.unwrap();
    assert_eq!(content, "改過的內容");

    let (status, resp) =
        admin_send(&app, "PUT", "/api/admin/comments/9999", Some(json!({ "content": "x" }))).await;
    assert_eq!(status, 404);
    assert_eq!(resp["error"], "Comment not found");

    let (status, resp) =
        admin_send(&app, "PUT", "/api/admin/comments/1", Some(json!({ "content": "" }))).await;
    assert_eq!(status, 400);
    assert_eq!(resp["error"], "Content is required");
}

#[tokio::test]
async fn 刪除留言_不存在的回_404() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;

    let (status, _) = admin_send(&app, "DELETE", "/api/admin/comments/2", None).await;
    assert_eq!(status, 200);
    let left: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM comments WHERE id=2").fetch_one(&pool).await.unwrap();
    assert_eq!(left, 0);

    // 404 而不是 200：後台按兩次刪除時，第二次要看得出「它已經不在了」
    let (status, resp) = admin_send(&app, "DELETE", "/api/admin/comments/2", None).await;
    assert_eq!(status, 404);
    assert_eq!(resp["error"], "Comment not found");
}

#[tokio::test]
async fn 留言的編輯與刪除都要管理員身分() {
    let (app, pool) = test_app().await;
    seed_comments(&pool).await;
    for (method, path, body) in [
        ("PUT", "/api/admin/comments/1", Some(json!({ "content": "x" }))),
        ("DELETE", "/api/admin/comments/1", None),
        ("POST", "/api/admin/comments/1/reply", Some(json!({ "content": "x" }))),
        ("PATCH", "/api/admin/comments/batch/status", Some(json!({ "ids": [1], "status": "spam" }))),
    ] {
        let (status, _) = request(&app, method, path, body, None).await;
        assert_eq!(status, 401, "{method} {path} 沒帶 token 卻通過了");
    }
    // 一則都不能被動到
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments WHERE id=1 AND content='第一則'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

// ── 刪分類（連帶效果） ────────────────────────────────────────────────

#[tokio::test]
async fn 刪分類會把引用它的文章分類清空並回報影響筆數() {
    let (app, pool) = test_app().await;
    // 種子裡有「技術」分類與一篇屬於它的文章；再加一篇讓數字不是 1（1 的話
    // 「回報 affected」與「回報 1」分不出來）
    sqlx::query(
        "INSERT INTO posts (title, content, category, status) VALUES ('第二篇', '內文', '技術', 'published')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let id: i64 =
        sqlx::query_scalar("SELECT id FROM categories WHERE name='技術'").fetch_one(&pool).await.unwrap();

    let (status, body) = admin_send(&app, "DELETE", &format!("/api/admin/categories/{id}"), None).await;
    assert_eq!(status, 200);
    // 這個數字是站長唯一會看到的「我剛剛影響了什麼」
    assert_eq!(body["affectedPosts"], 2);

    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE category='技術'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "分類刪了但文章還指著它 → 前台會出現一個點不進去的分類");
    let cat: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories WHERE id=?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cat, 0);
}

#[tokio::test]
async fn 刪不存在的分類是_404_而且沒帶身分是_401() {
    let (app, _pool) = test_app().await;
    let (status, resp) = admin_send(&app, "DELETE", "/api/admin/categories/9999", None).await;
    assert_eq!(status, 404);
    assert_eq!(resp["error"], "分類不存在");

    let (status, _) = request(&app, "DELETE", "/api/admin/categories/1", None, None).await;
    assert_eq!(status, 401);
}

// ── 使用者角色 ────────────────────────────────────────────────────────

/// 建一個 OAuth 使用者，回 id。
async fn add_user(pool: &sqlx::SqlitePool, provider_id: &str, role: &str) -> i64 {
    sqlx::query(
        "INSERT INTO oauth_users (provider, provider_id, display_name, role) VALUES ('github', ?, ?, ?)",
    )
    .bind(provider_id)
    .bind(format!("使用者{provider_id}"))
    .bind(role)
    .execute(pool)
    .await
    .unwrap()
    .last_insert_rowid()
}

/// 以某個 oauth_users 列的身分簽 token（`authorize` 會拿 userId 去查角色）。
fn oauth_owner_token(user_id: i64) -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "userId": user_id, "provider": "github", "iat": now, "exp": now + 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(common::TEST_SECRET.as_bytes()),
    )
    .unwrap()
}

#[tokio::test]
async fn 改使用者角色() {
    let (app, pool) = test_app().await;
    let target = add_user(&pool, "u1", "USER").await;

    let (status, body) =
        admin_send(&app, "PUT", &format!("/api/admin/users/{target}/role"), Some(json!({ "role": "ADMIN" })))
            .await;
    assert_eq!(status, 200);
    assert_eq!(body["role"], "ADMIN");

    let role: String = sqlx::query_scalar("SELECT role FROM oauth_users WHERE id=?")
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, "ADMIN");
}

#[tokio::test]
async fn 只收三種角色_其餘一律_400() {
    let (app, pool) = test_app().await;
    let target = add_user(&pool, "u1", "USER").await;

    for role in [json!("SUPERUSER"), json!(""), json!("admin"), json!(1)] {
        let (status, resp) = admin_send(
            &app,
            "PUT",
            &format!("/api/admin/users/{target}/role"),
            Some(json!({ "role": role })),
        )
        .await;
        assert_eq!(status, 400, "{role} 不該被接受");
        assert!(resp["error"].as_str().unwrap().contains("無效的角色"));
    }
    // 三種合法的都要收（少收一種的話那個角色就永遠指派不出去）
    for role in ["USER", "ADMIN", "OWNER"] {
        let (status, _) = admin_send(
            &app,
            "PUT",
            &format!("/api/admin/users/{target}/role"),
            Some(json!({ "role": role })),
        )
        .await;
        assert_eq!(status, 200, "{role} 應該是合法角色");
    }
}

#[tokio::test]
async fn 不能改自己的角色() {
    let (app, pool) = test_app().await;
    let me = add_user(&pool, "me", "OWNER").await;
    let token = oauth_owner_token(me);

    // ⚠ 這一道少了的話，唯一的 OWNER 可以把自己降成 USER，然後**再也沒有人**
    //   能把任何人升回 OWNER——後台等於從此鎖死，只能進 DB 手動改。
    let (status, resp) = request(
        &app,
        "PUT",
        &format!("/api/admin/users/{me}/role"),
        Some(json!({ "role": "USER" })),
        Some(&token),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(resp["error"], "不能修改自己的角色");

    let role: String = sqlx::query_scalar("SELECT role FROM oauth_users WHERE id=?")
        .bind(me)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, "OWNER");
}

#[tokio::test]
async fn 改別人的角色不受那道自我保護影響() {
    let (app, pool) = test_app().await;
    let me = add_user(&pool, "me", "OWNER").await;
    let other = add_user(&pool, "other", "USER").await;

    // 「不能改自己」寫成「不能改任何人」的話這條會紅——而症狀是後台完全不能指派角色
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/admin/users/{other}/role"),
        Some(json!({ "role": "ADMIN" })),
        Some(&oauth_owner_token(me)),
    )
    .await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn 改不存在的使用者是_404() {
    let (app, _pool) = test_app().await;
    let (status, resp) =
        admin_send(&app, "PUT", "/api/admin/users/9999/role", Some(json!({ "role": "ADMIN" }))).await;
    assert_eq!(status, 404);
    assert_eq!(resp["error"], "用戶不存在");
}

#[tokio::test]
async fn 改角色需要_owner_不是_admin() {
    let (app, pool) = test_app().await;
    let target = add_user(&pool, "u1", "USER").await;
    let admin = add_user(&pool, "adm", "ADMIN").await;

    // 角色指派是提權操作，門檻必須高於一般管理。ADMIN 也能改的話，
    // 任何一個 ADMIN 都可以把自己升成 OWNER。
    let (status, _) = request(
        &app,
        "PUT",
        &format!("/api/admin/users/{target}/role"),
        Some(json!({ "role": "OWNER" })),
        Some(&oauth_owner_token(admin)),
    )
    .await;
    assert_eq!(status, 403);

    let role: String = sqlx::query_scalar("SELECT role FROM oauth_users WHERE id=?")
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, "USER");
}
