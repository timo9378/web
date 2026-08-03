//! 後台儀表板的**讀取**面，加上幾條沒人走過的寫入分支。
//!
//! `tests/admin.rs` 與 `tests/admin_moderation.rs` 蓋掉了大部分的 CRUD，
//! 但有一整批東西一次都沒被呼叫過：
//!
//!   · **五個 GET 列表端點的權限判斷**（tags / categories / users / blacklist /
//!     keyword-filters）。其中 `/api/admin/users` 走的是 **requireOwner** 而不是
//!     requireAdmin——那條線如果鬆掉，任何 ADMIN 都能改別人的角色（含把自己升成 OWNER）。
//!     這是整份檔案裡最貴的一條，而它跟其他四個長得一模一樣，很容易被「順手統一」掉。
//!   · **`/api/admin/posts` 的篩選**。跟公開列表一樣是「列表與計數兩條分開組的 SQL」，
//!     但 WHERE 的內容不同（admin 版是 `1=1` 起手、沒有預設 status），所以不能靠
//!     公開端點的測試順帶保證。
//!   · **後台列表的 excerpt 退路**：沒摘要就用內文前 150 字 + '...'。壞掉的話後台
//!     每一列都是空白，但 API 仍然回 200。
//!   · **slug 自動產生的三段優先序與撞名處理**。`gen_slug` 只留 ASCII 與 CJK 漢字，
//!     所以純假名／純韓文／純符號的標題會被清成空字串——沒有退路的話 slug 是空的，
//!     而 slug 是 UNIQUE，第二篇這種標題的文章就會建不出來。
//!
//! 沒有納入的：各 handler 裡 `.await?` 的 DB 失敗分支。要觸發得把連線弄壞，
//! 那種測試驗的是 sqlx 而不是這份程式碼。

mod common;

use axum::http::StatusCode;
use common::{TEST_SECRET, owner_token, request, test_app};
use serde_json::{Value, json};

async fn adm(app: &axum::Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    request(app, method, path, body, Some(&owner_token(true))).await
}

/// ADMIN 角色的 token。
///
/// ⚠ 角色**不在 token 裡**——OAuth token 只帶 `userId`，角色是拿它去查 `oauth_users`
///   的。所以要造一個 ADMIN 得先在資料庫建一個 ADMIN 帳號。
///   （帶 `username` 而不帶 `userId` 的是 legacy 管理 token，那條路徑一律當 OWNER，
///   `common::owner_token` 走的就是它。）
async fn admin_role_token(pool: &sqlx::SqlitePool) -> String {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO oauth_users (provider, provider_id, display_name, role) \
         VALUES ('github', 'editor-1', '編輯', 'ADMIN') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "userId": id, "iat": now, "exp": now + 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap()
}

// ── 權限 ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn 五個列表端點沒帶身分一律_401() {
    let (app, _pool) = test_app().await;
    for path in [
        "/api/admin/tags",
        "/api/admin/categories",
        "/api/admin/users",
        "/api/admin/blacklist",
        "/api/admin/keyword-filters",
    ] {
        let (status, _) = request(&app, "GET", path, None, None).await;
        assert_eq!(status, 401, "{path} 沒擋");
    }
}

#[tokio::test]
async fn 使用者清單是_owner_限定_admin_不夠() {
    let (app, pool) = test_app().await;
    let editor = admin_role_token(&pool).await;

    // ADMIN 進得去其他四個
    for path in
        ["/api/admin/tags", "/api/admin/categories", "/api/admin/blacklist", "/api/admin/keyword-filters"]
    {
        let (status, _) = request(&app, "GET", path, None, Some(&editor)).await;
        assert_eq!(status, 200, "{path} 應該讓 ADMIN 進");
    }

    // 但看不到使用者清單。這條線鬆掉的話，任何 ADMIN 都能看到全站帳號、
    // 接著（同樣是 requireOwner 的）改角色端點就是下一步
    let (status, _) = request(&app, "GET", "/api/admin/users", None, Some(&editor)).await;
    assert_eq!(status, 403, "使用者清單只有 OWNER 看得到");

    let (status, body) = adm(&app, "GET", "/api/admin/users", None).await;
    assert_eq!(status, 200);
    assert!(body["users"].is_array(), "得到 {body}");
}

// ── 列表內容 ──────────────────────────────────────────────────────────

#[tokio::test]
async fn 標籤清單帶得出使用篇數並依名稱排序() {
    let (app, pool) = test_app().await;
    // 種子有 'rust'（掛在文章 1 上）。再加兩個，其中一個沒被任何文章用
    for name in ["axum", "沒人用的"] {
        sqlx::query("INSERT INTO tags (name) VALUES (?)").bind(name).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO post_tags (post_id, tag_id) VALUES (1, 2)").execute(&pool).await.unwrap();

    let (status, body) = adm(&app, "GET", "/api/admin/tags", None).await;
    assert_eq!(status, 200);
    let rows = body.as_array().unwrap();
    let names: Vec<&str> = rows.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["axum", "rust", "沒人用的"], "要依名稱排序");

    let by: std::collections::HashMap<&str, i64> =
        rows.iter().map(|t| (t["name"].as_str().unwrap(), t["post_count"].as_i64().unwrap())).collect();
    assert_eq!(by["rust"], 1);
    assert_eq!(by["axum"], 1);
    // LEFT JOIN 寫成 INNER JOIN 的話，沒人用的標籤會整個從後台消失——
    // 於是永遠沒辦法把它刪掉
    assert_eq!(by["沒人用的"], 0, "沒被使用的標籤還是要列出來，數字是 0");
}

#[tokio::test]
async fn 分類清單的篇數把草稿也算進去() {
    let (app, pool) = test_app().await;
    // 種子：文章 1（published, 技術）、文章 2（draft, 無分類）。把草稿也歸到技術
    sqlx::query("UPDATE posts SET category = '技術' WHERE id = 2").execute(&pool).await.unwrap();

    let (status, body) = adm(&app, "GET", "/api/admin/categories", None).await;
    assert_eq!(status, 200);
    let tech = body.as_array().unwrap().iter().find(|c| c["name"] == "技術").unwrap();
    // 後台的數字要含草稿——這裡跟公開端點的 post_count 刻意不同。
    // 兩邊哪天被統一，後台就會顯示「這個分類 1 篇」但編輯器裡明明有 2 篇
    assert_eq!(tech["post_count"], 2, "後台的篇數含草稿");
}

// ── /api/admin/posts 的篩選與分頁 ─────────────────────────────────────

#[tokio::test]
async fn 後台文章列表的篩選與計數要一致() {
    let (app, pool) = test_app().await;
    for (id, title, content, status) in [
        (10, "Rust 筆記", "內文", "published"),
        (11, "隨手記", "裡面提到 Rust", "draft"),
        (12, "無關", "無關", "published"),
    ] {
        sqlx::query("INSERT INTO posts (id, title, content, status) VALUES (?, ?, ?, ?)")
            .bind(id)
            .bind(title)
            .bind(content)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
    }

    // 不帶 status → 草稿也在（跟公開端點相反，後台要看得到全部）
    let (status, body) = adm(&app, "GET", "/api/admin/posts", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], 5, "種子 2 篇 + 這裡 3 篇");

    let (_, body) = adm(&app, "GET", "/api/admin/posts?status=draft", None).await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 2);
    assert_eq!(body["total"], 2, "計數查詢要跟著套 status");

    // search 同時比對標題與內文，而且要跟 status 疊得起來——
    // 兩個條件的 bind 順序在列表與計數是分開寫的，錯位只會在疊起來時顯形
    let (_, body) = adm(&app, "GET", "/api/admin/posts?search=Rust", None).await;
    assert_eq!(body["total"], 2);
    let (_, body) = adm(&app, "GET", "/api/admin/posts?status=draft&search=Rust", None).await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 1);
    assert_eq!(body["total"], 1);
    assert_eq!(body["posts"][0]["title"], "隨手記");
}

#[tokio::test]
async fn 後台列表沒摘要時用內文前_150_字補() {
    let (app, pool) = test_app().await;
    let long = "字".repeat(300);
    sqlx::query(
        "INSERT INTO posts (id, title, content, excerpt, status) VALUES (10, '沒摘要', ?, NULL, 'draft')",
    )
    .bind(&long)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO posts (id, title, content, excerpt, status) VALUES (11, '空摘要', ?, '', 'draft')",
    )
    .bind(&long)
    .execute(&pool)
    .await
    .unwrap();

    let (_, body) = adm(&app, "GET", "/api/admin/posts", None).await;
    let by: std::collections::HashMap<&str, &Value> =
        body["posts"].as_array().unwrap().iter().map(|p| (p["title"].as_str().unwrap(), p)).collect();

    for title in ["沒摘要", "空摘要"] {
        let e = by[title]["excerpt"].as_str().unwrap();
        // NULL 與空字串要走同一條退路。只判 NULL 的話，被清空過摘要的文章
        // 在後台列表就是一片空白——而 API 照樣回 200
        assert!(e.ends_with("..."), "{title}: {e}");
        assert_eq!(e.chars().count(), 153, "{title}：150 字加三個點");
    }
    // 有摘要的照原樣，不要被補的內容蓋掉
    assert_eq!(by["公開文章"]["excerpt"], "摘要");
}

#[tokio::test]
async fn 後台列表的分頁欄位是_totalpages_與_currentpage() {
    let (app, pool) = test_app().await;
    for i in 0..8 {
        sqlx::query("INSERT INTO posts (id, title, content, status) VALUES (?, ?, 'x', 'draft')")
            .bind(20 + i)
            .bind(format!("第 {i} 篇"))
            .execute(&pool)
            .await
            .unwrap();
    }

    let (_, body) = adm(&app, "GET", "/api/admin/posts?limit=3&page=2", None).await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 3);
    assert_eq!(body["currentPage"], 2);
    assert_eq!(body["total"], 10);
    // 10 / 3 → 4 頁（無條件進位）
    assert_eq!(body["totalPages"], 4);
}

// ── slug 自動產生 ─────────────────────────────────────────────────────

async fn create_post(app: &axum::Router, body: Value) -> Value {
    let (status, v) = adm(app, "POST", "/api/admin/posts", Some(body)).await;
    assert_eq!(status, 201, "建文失敗：{v}");
    v["data"].clone()
}

#[tokio::test]
async fn slug_的優先序是_指定的_英文標題_原標題() {
    let (app, _pool) = test_app().await;

    let d = create_post(&app, json!({ "title": "標題", "content": "x", "slug": "  My Slug  " })).await;
    assert_eq!(d["slug"], "my-slug", "指定的 slug 優先，而且會正規化");

    let d =
        create_post(&app, json!({ "title": "中文標題", "content": "x", "title_en": "English Title" })).await;
    assert_eq!(d["slug"], "english-title", "沒指定就用英文標題");

    let d = create_post(&app, json!({ "title": "Plain Title", "content": "x" })).await;
    assert_eq!(d["slug"], "plain-title", "都沒有就用原標題");
}

#[tokio::test]
async fn 標題產不出_slug_時退回_post_並依序接編號() {
    let (app, _pool) = test_app().await;
    // gen_slug 保留 ASCII 與 CJK 漢字，其餘一律濾掉。所以純假名／純韓文／純符號的
    // 標題會被清成空字串——沒有退路的話 slug 就是空的，而 slug 是 UNIQUE，
    // 第二篇這種標題的文章會直接建不出來。
    let a = create_post(&app, json!({ "title": "テスト", "content": "x" })).await;
    let b = create_post(&app, json!({ "title": "테스트", "content": "x" })).await;
    let c = create_post(&app, json!({ "title": "！？…", "content": "x" })).await;
    assert_eq!(a["slug"], "post");
    assert_eq!(b["slug"], "post-2", "撞名要接編號，不是覆蓋也不是失敗");
    assert_eq!(c["slug"], "post-3");
}

#[tokio::test]
async fn 指定的_slug_撞到別人時也會接編號() {
    let (app, _pool) = test_app().await;
    create_post(&app, json!({ "title": "A", "content": "x", "slug": "shared" })).await;
    let b = create_post(&app, json!({ "title": "B", "content": "x", "slug": "shared" })).await;
    assert_eq!(b["slug"], "shared-2");

    // 改文時把自己的 slug 設成原本的值，不該把自己算成「撞名」而變成 shared-3
    let id = b["id"].as_i64().unwrap();
    let (status, _) =
        adm(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "slug": "shared-2" }))).await;
    assert_eq!(status, 200);
    let (_, got) = adm(&app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    assert_eq!(got["slug"], "shared-2", "排除自己之後不算撞名");
}

// ── 重複名稱 ──────────────────────────────────────────────────────────

#[tokio::test]
async fn 標籤與分類重複時回_409_不是_500() {
    let (app, _pool) = test_app().await;
    // 500 會讓後台顯示「伺服器錯誤」，使用者不知道其實只是名字被用過了
    let (status, body) = adm(&app, "POST", "/api/admin/tags", Some(json!({ "name": "rust" }))).await;
    assert_eq!(status, 409, "得到 {body}");
    assert!(body["error"].as_str().unwrap().contains("已存在"));

    let (status, _) = adm(&app, "POST", "/api/admin/tags", Some(json!({ "name": "另一個" }))).await;
    assert_eq!(status, 201);
    // 改名撞到既有的也是 409
    let (_, list) = adm(&app, "GET", "/api/admin/tags", None).await;
    let id = list.as_array().unwrap().iter().find(|t| t["name"] == "另一個").unwrap()["id"].as_i64().unwrap();
    let (status, _) =
        adm(&app, "PUT", &format!("/api/admin/tags/{id}"), Some(json!({ "name": "rust" }))).await;
    assert_eq!(status, 409);

    let (status, _) = adm(&app, "POST", "/api/admin/categories", Some(json!({ "name": "技術" }))).await;
    assert_eq!(status, 409);
}

#[tokio::test]
async fn 改不存在的標籤是_404_名稱空的是_400() {
    let (app, _pool) = test_app().await;
    let (status, _) = adm(&app, "PUT", "/api/admin/tags/999999", Some(json!({ "name": "新名字" }))).await;
    assert_eq!(status, 404);
    let (status, _) = adm(&app, "PUT", "/api/admin/tags/1", Some(json!({ "name": "" }))).await;
    assert_eq!(status, 400);
}

// ── 分類的多語欄位 ────────────────────────────────────────────────────

#[tokio::test]
async fn 分類的譯名空字串會存成_null_而不是空字串() {
    let (app, _pool) = test_app().await;
    let (status, _) = adm(
        &app,
        "POST",
        "/api/admin/categories",
        Some(json!({
            "name": "多語分類",
            "name_en": "Multi", "name_ja": "", "name_ko": "다국어", "name_zh_cn": "多语分类",
            "description": "說明", "description_en": "Desc", "description_ja": "",
            "short_description": "短", "short_description_en": "Short", "short_description_ko": "",
        })),
    )
    .await;
    assert_eq!(status, 201);

    let (_, list) = adm(&app, "GET", "/api/admin/categories", None).await;
    let c = list.as_array().unwrap().iter().find(|c| c["name"] == "多語分類").unwrap();
    assert_eq!(c["name_en"], "Multi");
    assert_eq!(c["name_ko"], "다국어");
    assert_eq!(c["description_en"], "Desc");
    assert_eq!(c["short_description_en"], "Short");
    // 空字串要落成 null。存成 '' 的話前端的「有沒有這個語系」判斷（truthy）仍然對，
    // 但 `COALESCE(x, '') <> ''` 那類 SQL 判斷就會分岔——同一份資料兩種答案
    assert!(c["name_ja"].is_null(), "空字串要存成 NULL，得到 {}", c["name_ja"]);
    assert!(c["description_ja"].is_null());
    assert!(c["short_description_ko"].is_null());

    // 改的時候也是同一套規則
    let id = c["id"].as_i64().unwrap();
    let (status, _) = adm(
        &app,
        "PUT",
        &format!("/api/admin/categories/{id}"),
        Some(json!({ "name": "多語分類", "name_en": "", "name_ja": "多言語" })),
    )
    .await;
    assert_eq!(status, 200);
    let (_, list) = adm(&app, "GET", "/api/admin/categories", None).await;
    let c = list.as_array().unwrap().iter().find(|c| c["id"] == id).unwrap();
    assert!(c["name_en"].is_null(), "改成空字串等於清掉");
    assert_eq!(c["name_ja"], "多言語");
}

#[tokio::test]
async fn 分類改名會同步改掉文章上的分類字串() {
    let (app, pool) = test_app().await;
    // posts.category 存的是分類**名稱**而不是 id，所以改名一定要跟著改文章，
    // 否則那些文章會掛在一個不存在的分類底下——前台分類頁點進去是空的
    let (_, list) = adm(&app, "GET", "/api/admin/categories", None).await;
    let id = list.as_array().unwrap().iter().find(|c| c["name"] == "技術").unwrap()["id"].as_i64().unwrap();

    let (status, _) =
        adm(&app, "PUT", &format!("/api/admin/categories/{id}"), Some(json!({ "name": "技術筆記" }))).await;
    assert_eq!(status, 200);

    let cat: Option<String> =
        sqlx::query_scalar("SELECT category FROM posts WHERE id = 1").fetch_one(&pool).await.unwrap();
    assert_eq!(cat.as_deref(), Some("技術筆記"));
}

// ── 建文的型別強制轉換 ────────────────────────────────────────────────

#[tokio::test]
async fn series_order_照_js_的_number_語義() {
    let (app, pool) = test_app().await;
    // 後台送過來的是表單值，型別很雜（字串數字、空字串、null、布林）。
    // 這裡照抄 JS 的 Number() 語義，所以每一種都要有明確的落點——
    // 落錯的症狀是系列文的排序悄悄跑掉，而不是報錯。
    for (given, want) in [
        (json!("3"), Some(3.0)),
        (json!(4), Some(4.0)),
        (json!(2.5), Some(2.5)),
        (json!(""), Some(0.0)),
        (json!(null), Some(0.0)),
        (json!(true), Some(1.0)),
        (json!("abc"), None), // NaN → NULL
    ] {
        let d = create_post(
            &app,
            json!({ "title": "系列", "content": "x", "series_name": "S", "series_order": given }),
        )
        .await;
        let id = d["id"].as_i64().unwrap();
        // ⚠ 一定要 CAST。整數值是用 i64 綁進去的（見 bind_num），SQLite 的欄位親和性
        //   讓它就存成 INTEGER；直接讀 Option<f64> 會 decode 失敗
        let got: Option<f64> =
            sqlx::query_scalar("SELECT CAST(series_order AS REAL) FROM posts WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(got, want, "series_order={given} 應該存成 {want:?}");
    }
}

#[tokio::test]
async fn 建文時_body_不是_json_物件回_400() {
    let (app, _pool) = test_app().await;
    // 這支自己讀 body（不是用 JsonBody extractor），所以錯誤碼是自己判的。
    // 陣列與純量都是合法 JSON 但不是物件，一樣要擋
    for body in [json!([1, 2]), json!("字串"), json!(42)] {
        let (status, v) = adm(&app, "POST", "/api/admin/posts", Some(body.clone())).await;
        assert_eq!(status, 400, "body={body} 應該被擋，得到 {v}");
        assert_eq!(v["error"], "invalid JSON body");
    }
}

// ── 後台單篇與統計 ────────────────────────────────────────────────────

#[tokio::test]
async fn 後台單篇的_source_language_空字串要退回_zh_tw() {
    let (app, pool) = test_app().await;
    // admin 端點的規則跟公開端點不同：空字串也視為缺。舊資料裡真的有空字串，
    // 照原樣送出去的話編輯器的語言下拉會選不到任何一項
    sqlx::query(
        "UPDATE posts SET source_language = '', title_ja = '日本語', content_ja = '本文' WHERE id = 1",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = adm(&app, "GET", "/api/admin/posts/1", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["source_language"], "zh-TW");
    let locales: Vec<&str> =
        body["available_locales"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(locales, ["zh-TW", "ja"]);

    let (status, body) = adm(&app, "GET", "/api/admin/posts/999999", None).await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Post not found");
}

#[tokio::test]
async fn 統計的訪客數是累計瀏覽數_不是亂數() {
    let (app, pool) = test_app().await;
    // 原本的 Express 版這裡是 Math.random()。改成真實數字之後，
    // 「這個欄位有沒有意義」就靠這條測試釘著——退回亂數的話這裡會紅
    sqlx::query("UPDATE posts SET view_count = 12 WHERE id = 1").execute(&pool).await.unwrap();
    sqlx::query("UPDATE posts SET view_count = 30 WHERE id = 2").execute(&pool).await.unwrap();

    let (status, body) = adm(&app, "GET", "/api/admin/stats", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["visitors"], 42);
    assert_eq!(body["totalPosts"], 2);
    assert_eq!(body["publishedPosts"], 1);
    assert_eq!(body["draftPosts"], 1);
}

// ── 黑名單 / 關鍵字過濾的刪除 ─────────────────────────────────────────

#[tokio::test]
async fn 黑名單與關鍵字的刪除是冪等的() {
    let (app, _pool) = test_app().await;
    // DELETE 不存在的 id 回 200 是刻意的（冪等）。改成 404 的話，
    // 後台重複按刪除就會跳錯誤——而那次操作其實達成了使用者要的結果
    for path in ["/api/admin/blacklist/999999", "/api/admin/keyword-filters/999999"] {
        let (status, body) = adm(&app, "DELETE", path, None).await;
        assert_eq!(status, 200, "{path} 得到 {body}");
        assert_eq!(body["message"], "success");
    }

    let (_, created) = adm(
        &app,
        "POST",
        "/api/admin/keyword-filters",
        Some(json!({ "keyword": "洗版", "action": "reject" })),
    )
    .await;
    let id = created["id"].as_i64().unwrap();
    let (_, list) = adm(&app, "GET", "/api/admin/keyword-filters", None).await;
    assert_eq!(list["filters"][0]["action"], "reject");

    let (status, _) = adm(&app, "DELETE", &format!("/api/admin/keyword-filters/{id}"), None).await;
    assert_eq!(status, 200);
    let (_, list) = adm(&app, "GET", "/api/admin/keyword-filters", None).await;
    assert!(list["filters"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn 黑名單缺_ip_與關鍵字缺_keyword_都是_400() {
    let (app, _pool) = test_app().await;
    let (status, body) =
        adm(&app, "POST", "/api/admin/blacklist", Some(json!({ "reason": "沒給 IP" }))).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "IP is required");

    let (status, body) =
        adm(&app, "POST", "/api/admin/keyword-filters", Some(json!({ "action": "spam" }))).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "Keyword is required");
}
