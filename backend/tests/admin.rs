//! 後台 CRUD 的往返測試。
//!
//! ## 為什麼是「往返」而不是逐個端點各測一次
//!
//! admin.rs 有 2298 個 region、覆蓋率 7.57%——是整個後端最大的單一缺口。
//! 但「每個端點打一次、斷言不是 5xx」那種測試只會把數字沖上去，抓不到真正會發生的錯：
//! **建立成功但欄位沒存進去**、**更新回 200 但資料沒變**、**刪除沒連帶清乾淨**。
//! 那三種都會回 2xx，只有回頭再讀一次才看得見。
//!
//! 所以這裡一律「建 → 讀回來比對 → 改 → 再讀回來比對 → 刪 → 確認真的不見了」。
//! 一條往返走過的程式碼比四條淺測試多，而且每一步的斷言都是真的契約。
//!
//! 授權邊界（沒 token → 401）不在這裡重複驗：tests/e2e/api-contract.spec.ts 已經
//! 從 OpenAPI spec 自動列舉所有 bearer 端點做過了，再寫一次只是多一份要維護的東西。

use axum::http::StatusCode;
use serde_json::json;

mod common;
use common::{owner_token, request, test_app};

/// 帶 OWNER token 發請求。後台端點清一色需要它，包一層省得每次都寫。
async fn admin(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    request(app, method, path, body, Some(&owner_token(true))).await
}

// ── 標籤 ─────────────────────────────────────────────────────────────────

/// 標籤的五語系欄位是最容易「存了但沒讀回來」的地方——它們在 INSERT 與 SELECT
/// 兩份寫死的 SQL 裡各出現一次，改動時很容易只改一邊。
#[tokio::test]
async fn tag_round_trip_keeps_all_locale_fields() {
    let (app, _pool) = test_app().await;

    let (st, created) = admin(
        &app,
        "POST",
        "/api/admin/tags",
        Some(json!({
            "name": "測試標籤", "name_en": "test-tag", "name_ja": "テストタグ",
            "name_ko": "테스트태그", "name_zh_cn": "测试标签"
        })),
    )
    .await;
    assert!(st.is_success(), "建立標籤失敗：{st} {created}");

    let (_, list) = admin(&app, "GET", "/api/admin/tags", None).await;
    let arr = list.as_array().or_else(|| list["tags"].as_array()).expect("標籤清單應該是陣列");
    let mine = arr.iter().find(|t| t["name"] == "測試標籤").expect("剛建立的標籤要出現在清單裡");
    let id = mine["id"].as_i64().expect("標籤要有 id");
    // 五個語系欄位逐一比對——只驗 name 的話，漏存 name_ja 不會有人發現
    for (k, v) in [
        ("name_en", "test-tag"),
        ("name_ja", "テストタグ"),
        ("name_ko", "테스트태그"),
        ("name_zh_cn", "测试标签"),
    ] {
        assert_eq!(mine[k], v, "{k} 沒有存進去（建立時）");
    }

    let (st, _) = admin(
        &app,
        "PUT",
        &format!("/api/admin/tags/{id}"),
        Some(json!({ "name": "改過的標籤", "name_en": "renamed" })),
    )
    .await;
    assert!(st.is_success(), "更新標籤失敗：{st}");

    let (_, list) = admin(&app, "GET", "/api/admin/tags", None).await;
    let arr = list.as_array().or_else(|| list["tags"].as_array()).expect("陣列");
    let after = arr.iter().find(|t| t["id"] == id).expect("更新後標籤還在");
    assert_eq!(after["name"], "改過的標籤", "更新回 2xx 但名稱沒變");
    assert_eq!(after["name_en"], "renamed");
    // 這次沒帶 name_ja → 應該被清成 null（UPDATE 是整列覆寫，不是 patch）
    assert!(after["name_ja"].is_null(), "UPDATE 是整列覆寫，沒帶的欄位該被清掉");

    let (st, _) = admin(&app, "DELETE", &format!("/api/admin/tags/{id}"), None).await;
    assert!(st.is_success(), "刪除標籤失敗：{st}");
    let (_, list) = admin(&app, "GET", "/api/admin/tags", None).await;
    let arr = list.as_array().or_else(|| list["tags"].as_array()).expect("陣列");
    assert!(arr.iter().all(|t| t["id"] != id), "刪除後還在清單裡");
}

/// 刪不存在的標籤要回 404 而不是 200——回 200 會讓前端以為刪掉了。
#[tokio::test]
async fn deleting_a_missing_tag_is_404() {
    let (app, _pool) = test_app().await;
    let (st, _) = admin(&app, "DELETE", "/api/admin/tags/999999", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn creating_a_tag_without_name_is_400() {
    let (app, _pool) = test_app().await;
    let (st, body) = admin(&app, "POST", "/api/admin/tags", Some(json!({ "name": "" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "空名稱該被擋下");
    assert!(body["error"].is_string(), "要給得出錯誤訊息：{body}");
}

// ── 分類 ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn category_round_trip() {
    let (app, _pool) = test_app().await;

    let (st, _) = admin(
        &app,
        "POST",
        "/api/admin/categories",
        Some(json!({ "name": "新分類", "slug": "new-cat", "description": "說明" })),
    )
    .await;
    assert!(st.is_success(), "建立分類失敗：{st}");

    let (_, list) = admin(&app, "GET", "/api/admin/categories", None).await;
    let arr = list.as_array().or_else(|| list["categories"].as_array()).expect("陣列");
    let mine = arr.iter().find(|c| c["name"] == "新分類").expect("新分類要在清單裡");
    assert_eq!(mine["slug"], "new-cat");
    let id = mine["id"].as_i64().expect("id");

    let (st, _) = admin(
        &app,
        "PUT",
        &format!("/api/admin/categories/{id}"),
        Some(json!({ "name": "改名分類", "slug": "renamed-cat" })),
    )
    .await;
    assert!(st.is_success());
    let (_, list) = admin(&app, "GET", "/api/admin/categories", None).await;
    let arr = list.as_array().or_else(|| list["categories"].as_array()).expect("陣列");
    let after = arr.iter().find(|c| c["id"] == id).expect("還在");
    assert_eq!(after["name"], "改名分類");
    assert_eq!(after["slug"], "renamed-cat");
}

// ── IP 黑名單 / 關鍵字過濾 ─────────────────────────────────────────────────

/// 黑名單用 `INSERT OR IGNORE`：重複加同一個 IP 不該爆，也不該變成兩筆。
#[tokio::test]
async fn blacklist_is_idempotent_on_duplicate_ip() {
    let (app, _pool) = test_app().await;
    for _ in 0..2 {
        let (st, _) = admin(
            &app,
            "POST",
            "/api/admin/blacklist",
            Some(json!({ "ip": "203.0.113.7", "reason": "洗版" })),
        )
        .await;
        assert!(st.is_success(), "重複加同一個 IP 不該失敗");
    }
    let (_, list) = admin(&app, "GET", "/api/admin/blacklist", None).await;
    let arr = list.as_array().or_else(|| list["blacklist"].as_array()).expect("陣列");
    let hits: Vec<_> = arr.iter().filter(|b| b["ip"] == "203.0.113.7").collect();
    assert_eq!(hits.len(), 1, "INSERT OR IGNORE 應該只留一筆，實際 {}", hits.len());

    let id = hits[0]["id"].as_i64().expect("id");
    let (st, _) = admin(&app, "DELETE", &format!("/api/admin/blacklist/{id}"), None).await;
    assert!(st.is_success());
}

/// action 只收 spam / reject，其餘一律落回 spam——落回別的值會讓過濾行為變成未定義。
#[tokio::test]
async fn keyword_filter_action_falls_back_to_spam() {
    let (app, _pool) = test_app().await;
    for (keyword, sent, expect) in
        [("賭博", "spam", "spam"), ("代購", "reject", "reject"), ("亂寫", "not-a-real-action", "spam")]
    {
        let (st, _) = admin(
            &app,
            "POST",
            "/api/admin/keyword-filters",
            Some(json!({ "keyword": keyword, "action": sent })),
        )
        .await;
        assert!(st.is_success(), "建立關鍵字 {keyword} 失敗");

        let (_, list) = admin(&app, "GET", "/api/admin/keyword-filters", None).await;
        let arr = list.as_array().or_else(|| list["filters"].as_array()).expect("陣列");
        let mine = arr.iter().find(|f| f["keyword"] == keyword).expect("剛建的要在");
        assert_eq!(mine["action"], expect, "action={sent} 應該落成 {expect}");
    }
}

// ── 留言審核 ─────────────────────────────────────────────────────────────

/// 留言狀態只收四個值。收到不合法的值時若照樣寫進 DB，那條留言會變成
/// 「既不在待審也不在已核准」的幽靈——列表查不到、但它確實存在。
#[tokio::test]
async fn comment_status_rejects_unknown_values() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO comments (id, post_id, author, content, status) \
         VALUES (500, 1, '讀者', '內容', 'pending')",
    )
    .execute(&pool)
    .await
    .expect("插入留言");

    let (st, _) =
        admin(&app, "PATCH", "/api/admin/comments/500/status", Some(json!({ "status": "banana" }))).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "不合法的狀態該被擋");

    // 確認真的沒被寫進去
    let after: (String,) =
        sqlx::query_as("SELECT status FROM comments WHERE id = 500").fetch_one(&pool).await.expect("查回來");
    assert_eq!(after.0, "pending", "被拒絕的請求不該留下副作用");

    for s in ["approved", "spam", "trash", "pending"] {
        let (st, _) =
            admin(&app, "PATCH", "/api/admin/comments/500/status", Some(json!({ "status": s }))).await;
        assert!(st.is_success(), "{s} 應該是合法狀態");
        let after: (String,) = sqlx::query_as("SELECT status FROM comments WHERE id = 500")
            .fetch_one(&pool)
            .await
            .expect("查回來");
        assert_eq!(after.0, s, "狀態回 2xx 但沒真的改成 {s}");
    }
}

// ── 統計 ─────────────────────────────────────────────────────────────────

/// admin_stats 整份都是算式。種子資料是「1 篇已發布 + 1 篇草稿」，
/// 所以數字是可以逐一核對的——這種端點錯了不會有任何症狀，只是儀表板數字不對。
#[tokio::test]
async fn admin_stats_counts_match_the_seed() {
    let (app, _pool) = test_app().await;
    let (st, v) = admin(&app, "GET", "/api/admin/stats", None).await;
    assert!(st.is_success(), "stats 失敗：{st} {v}");

    let find = |keys: &[&str]| -> Option<i64> {
        for k in keys {
            if let Some(n) = v[*k].as_i64() {
                return Some(n);
            }
            if let Some(n) = v["stats"][*k].as_i64() {
                return Some(n);
            }
        }
        None
    };
    assert_eq!(find(&["totalPosts", "total_posts"]), Some(2), "種子有 2 篇文章（1 發布 1 草稿）：{v}");
    assert_eq!(find(&["publishedPosts", "published"]), Some(1), "已發布應該是 1：{v}");
    assert_eq!(find(&["draftPosts", "draft"]), Some(1), "草稿應該是 1：{v}");
}

// ── 碎念 ─────────────────────────────────────────────────────────────────

/// 碎念的 CRUD。`ref_json` 是那種「存字串、讀出來要是物件」的欄位，
/// 序列化方向錯了前端會拿到一坨轉義過的字串而不是連結卡片。
#[tokio::test]
async fn thought_round_trip_preserves_ref_payload() {
    let (app, _pool) = test_app().await;

    let (st, created) = admin(
        &app,
        "POST",
        "/api/admin/thoughts",
        Some(json!({
            "content": "新碎念",
            "ref_type": "link",
            "ref_url": "https://example.com/a",
            "ref_json": { "title": "範例", "desc": "簡介", "site": "example.com" }
        })),
    )
    .await;
    assert!(st.is_success(), "建立碎念失敗：{st} {created}");

    let (_, list) = admin(&app, "GET", "/api/thoughts", None).await;
    let arr = list["thoughts"].as_array().or_else(|| list.as_array()).expect("碎念清單");
    let mine = arr.iter().find(|t| t["content"] == "新碎念").expect("新碎念要在清單裡");
    let id = mine["id"].as_i64().expect("id");
    // ref 應該是**物件**，不是被轉義的字串
    let r = &mine["ref"];
    if !r.is_null() {
        assert!(r.is_object(), "ref 應該還原成物件，實際是 {r}");
        assert_eq!(r["title"], "範例");
    }

    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/thoughts/{id}"), Some(json!({ "content": "改過的碎念" })))
            .await;
    assert!(st.is_success(), "更新碎念失敗：{st}");

    let (_, one) = admin(&app, "GET", &format!("/api/thoughts/{id}"), None).await;
    let got = if one["thought"].is_object() { &one["thought"] } else { &one };
    assert_eq!(got["content"], "改過的碎念", "更新回 2xx 但內容沒變");

    let (st, _) = admin(&app, "DELETE", &format!("/api/admin/thoughts/{id}"), None).await;
    assert!(st.is_success(), "刪除碎念失敗：{st}");
    let (st, _) = admin(&app, "GET", &format!("/api/thoughts/{id}"), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "刪掉之後該查不到");
}

// ── 文章 ─────────────────────────────────────────────────────────────────

/// 文章的往返。這支是後台最大的端點（i18n 欄位 × 5 語系 × title/content/excerpt），
/// 也是最容易「多加一個欄位卻忘了在 UPDATE 那串裡補上」的地方。
#[tokio::test]
async fn post_round_trip_keeps_i18n_and_status() {
    let (app, _pool) = test_app().await;

    let (st, created) = admin(
        &app,
        "POST",
        "/api/admin/posts",
        Some(json!({
            "title": "新文章", "content": "內文", "excerpt": "摘要",
            "category": "技術", "status": "draft",
            "title_en": "New Post", "content_en": "Body", "excerpt_en": "Summary"
        })),
    )
    .await;
    assert!(st.is_success(), "建立文章失敗：{st} {created}");
    // 建立回應把資料包在 `data` 裡（不是 `post`）——三種都試，回應形狀有變的話
    // 這裡會直接指出實際拿到什麼，而不是給一個沒有上下文的 unwrap panic。
    let id = ["data", "post"]
        .iter()
        .find_map(|k| created[*k]["id"].as_i64())
        .or_else(|| created["id"].as_i64())
        .unwrap_or_else(|| panic!("建立回應要帶 id：{created}"));

    let (_, one) = admin(&app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    let got = if one["post"].is_object() { &one["post"] } else { &one };
    assert_eq!(got["title"], "新文章");
    assert_eq!(got["title_en"], "New Post", "英文標題沒存進去");
    assert_eq!(got["status"], "draft");

    // 草稿不該出現在公開清單
    let (_, public) = request(&app, "GET", "/api/posts", None, None).await;
    let titles: Vec<_> =
        public["posts"].as_array().expect("陣列").iter().map(|p| p["title"].clone()).collect();
    assert!(!titles.contains(&json!("新文章")), "草稿漏到公開清單了");

    // 發布之後才該出現
    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "status": "published" }))).await;
    assert!(st.is_success(), "更新文章失敗：{st}");
    let (_, public) = request(&app, "GET", "/api/posts", None, None).await;
    let titles: Vec<_> =
        public["posts"].as_array().expect("陣列").iter().map(|p| p["title"].clone()).collect();
    assert!(titles.contains(&json!("新文章")), "發布後仍沒出現在公開清單：{titles:?}");

    let (st, _) = admin(&app, "DELETE", &format!("/api/admin/posts/{id}"), None).await;
    assert!(st.is_success(), "刪除文章失敗：{st}");
    let (st, _) = admin(&app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "刪掉之後該查不到");
}

// ── 文章更新：三態欄位、slug 歷史、標籤 ──────────────────────────────────
//
// `admin_update_post` 是後台最大的一支（58 行未覆蓋），也是 PostEditor 每次按儲存
// 都會打的那支。它的語意全部是「靜靜地錯」那一類：欄位該清的沒清、不該動的被動了、
// 改了 slug 之後舊網址全部 404。回應一律 200，從外面完全看不出來。

/// 建一篇文章，回它的 id。
async fn create_post(app: &axum::Router, body: serde_json::Value) -> i64 {
    let (st, created) = admin(app, "POST", "/api/admin/posts", Some(body)).await;
    assert!(st.is_success(), "建立文章失敗：{st} {created}");
    ["data", "post"]
        .iter()
        .find_map(|k| created[*k]["id"].as_i64())
        .or_else(|| created["id"].as_i64())
        .unwrap_or_else(|| panic!("建立回應要帶 id：{created}"))
}

async fn get_post(app: &axum::Router, id: i64) -> serde_json::Value {
    let (_, one) = admin(app, "GET", &format!("/api/admin/posts/{id}"), None).await;
    if one["post"].is_object() { one["post"].clone() } else { one }
}

/// **三態**：缺 key → 不動；`""` → 清成 NULL；有值 → 設定。
///
/// 這三種都回 200，差別只在資料庫裡。搞錯的後果很具體：
///   · 「缺 key = 清空」→ PostEditor 只送了改動的欄位，其他語系的譯文全部被抹掉
///   · 「空字串 = 不動」→ 站長想刪掉某個語系的舊譯文，怎麼刪都刪不掉
#[tokio::test]
async fn 更新文章時缺欄位不動_空字串才清空() {
    let (app, _pool) = test_app().await;
    let id = create_post(
        &app,
        json!({
            "title": "原標題", "content": "原內文", "excerpt": "原摘要", "category": "技術",
            "title_en": "EN title", "content_en": "EN body", "excerpt_en": "EN summary",
            "title_ja": "JA タイトル", "content_ja": "JA 本文",
        }),
    )
    .await;

    // 只送 title —— 其餘一律不該被動到
    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "title": "新標題" }))).await;
    assert!(st.is_success());
    let p = get_post(&app, id).await;
    assert_eq!(p["title"], "新標題");
    assert_eq!(p["content"], "原內文", "沒送的欄位被動到了");
    assert_eq!(p["title_en"], "EN title", "沒送的語系欄位被抹掉了——這會吃掉整份譯文");
    assert_eq!(p["title_ja"], "JA タイトル");
    assert_eq!(p["category"], "技術");

    // 空字串 → 真的清成 NULL（站長要刪掉舊譯文的唯一方式）
    let (st, _) = admin(
        &app,
        "PUT",
        &format!("/api/admin/posts/{id}"),
        Some(json!({ "title_en": "", "content_en": "", "excerpt_en": "" })),
    )
    .await;
    assert!(st.is_success());
    let p = get_post(&app, id).await;
    assert!(p["title_en"].is_null(), "空字串應該清成 null，得到 {}", p["title_en"]);
    assert!(p["content_en"].is_null());
    assert_eq!(p["title_ja"], "JA タイトル", "只清 en 不該波及 ja");
    assert_eq!(p["title"], "新標題", "更不該波及主語系");
}

/// 改 slug 要把舊的存進 `post_slug_history`，舊網址才不會斷。
/// 這條壞掉的症狀是：站長改了網址，之前所有分享出去的連結全部 404，
/// 而後台看起來一切正常。
#[tokio::test]
async fn 改_slug_會保留舊網址的轉址() {
    let (app, pool) = test_app().await;
    let id =
        create_post(&app, json!({ "title": "會改網址的文章", "content": "內文", "slug": "old-slug" })).await;
    assert_eq!(get_post(&app, id).await["slug"], "old-slug");

    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "slug": "new-slug" }))).await;
    assert!(st.is_success());
    assert_eq!(get_post(&app, id).await["slug"], "new-slug");

    let history = sqlx::query_scalar::<_, String>("SELECT old_slug FROM post_slug_history WHERE post_id = ?")
        .bind(id)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(history, vec!["old-slug"], "舊 slug 沒進 history，之前分享出去的連結會全部 404");

    // 沒帶 slug 的更新不該動到它（也不該多寫一筆歷史）
    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "title": "改標題" }))).await;
    assert!(st.is_success());
    assert_eq!(get_post(&app, id).await["slug"], "new-slug");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM post_slug_history WHERE post_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "沒改 slug 卻多了一筆歷史");
}

/// `tags` 帶空陣列＝清空關聯，缺 key＝不動。兩者都回 200。
#[tokio::test]
async fn 標籤帶空陣列是清空_不帶則不動() {
    let (app, pool) = test_app().await;
    let id = create_post(&app, json!({ "title": "有標籤的文章", "content": "內文", "tags": ["rust"] })).await;
    let count = |pool: sqlx::SqlitePool, id: i64| async move {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM post_tags WHERE post_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    assert_eq!(count(pool.clone(), id).await, 1, "建立時的標籤沒掛上");

    // 不帶 tags → 關聯不動
    let (st, _) =
        admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "title": "改個標題" }))).await;
    assert!(st.is_success());
    assert_eq!(count(pool.clone(), id).await, 1, "沒帶 tags 卻把關聯清掉了");

    // 帶空陣列 → 真的清空
    let (st, _) = admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "tags": [] }))).await;
    assert!(st.is_success());
    assert_eq!(count(pool, id).await, 0, "帶空陣列應該清空關聯");
}

/// `source_language` 只接受五個語系。它會決定編輯器把內容寫進哪一組欄位，
/// 收了亂值等於資料寫到不存在的語系去。
#[tokio::test]
async fn 無效的_source_language_會被擋下() {
    let (app, _pool) = test_app().await;
    let id = create_post(&app, json!({ "title": "文章", "content": "內文" })).await;

    for bad in [json!("de"), json!("zh"), json!(""), json!(123), json!(null)] {
        let (st, body) =
            admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "source_language": bad })))
                .await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "source_language={bad} 應該被擋，得到 {body}");
        assert!(body["error"].as_str().unwrap().contains("source_language"));
    }
    for ok in ["zh-TW", "zh-CN", "en", "ja", "ko"] {
        let (st, _) =
            admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "source_language": ok })))
                .await;
        assert!(st.is_success(), "{ok} 應該放行");
    }
}

/// `series_order` 是數字欄位但表單送過來的是字串；三態同其他欄位。
#[tokio::test]
async fn 系列順序接受字串數字_空字串則清空() {
    let (app, _pool) = test_app().await;
    let id = create_post(&app, json!({ "title": "系列文", "content": "內文" })).await;

    let put = |body: serde_json::Value| {
        let app = app.clone();
        async move { admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(body)).await }
    };

    let (st, _) = put(json!({ "series_name": "測試系列", "series_order": "3" })).await;
    assert!(st.is_success());
    let p = get_post(&app, id).await;
    assert_eq!(p["series_name"], "測試系列");
    assert_eq!(p["series_order"], 3, "字串的 \"3\" 要存成數字 3");

    // 空字串 → 清空（站長把文章移出系列）
    let (st, _) = put(json!({ "series_name": "", "series_order": "" })).await;
    assert!(st.is_success());
    let p = get_post(&app, id).await;
    assert!(p["series_name"].is_null(), "得到 {}", p["series_name"]);
    assert!(p["series_order"].is_null());

    // 不是數字的字串不該存成 0（那會讓它排到系列最前面）
    let (st, _) = put(json!({ "series_order": "不是數字" })).await;
    assert!(st.is_success());
    assert!(get_post(&app, id).await["series_order"].is_null(), "解不出數字要留 null，不是 0");
}

/// `allow_comments` 走 JS truthy：表單可能送 boolean、0/1、"true"。
#[tokio::test]
async fn 留言開關照_js_truthy_解讀() {
    let (app, _pool) = test_app().await;
    let id = create_post(&app, json!({ "title": "文章", "content": "內文" })).await;

    // 回應是 typed struct（bool），不是 row_to_json 的 0/1
    for (given, want) in [
        (json!(false), false),
        (json!(true), true),
        (json!(0), false),
        (json!(1), true),
        (json!(""), false),
        (json!("false"), true), // 非空字串在 JS 是 truthy——照抄，不是筆誤
    ] {
        let (st, _) =
            admin(&app, "PUT", &format!("/api/admin/posts/{id}"), Some(json!({ "allow_comments": given })))
                .await;
        assert!(st.is_success());
        assert_eq!(get_post(&app, id).await["allow_comments"], want, "allow_comments={given}");
    }
}

/// 更新不存在的文章要 404，而不是「成功但什麼都沒改」。
#[tokio::test]
async fn 更新不存在的文章是_404() {
    let (app, _pool) = test_app().await;
    let (st, body) =
        admin(&app, "PUT", "/api/admin/posts/999999", Some(json!({ "title": "改一個不存在的" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "得到 {body}");
    assert_eq!(body["error"], "文章不存在");
}

// ── 繁→簡自動轉換（generate-zh-cn）─────────────────────────────────────────
//
// 轉換函式本身（含「日文原樣保留」）在 handlers/opencc.rs 內有單元測試；
// 這裡補的是那支端點的守衛與副作用：轉錯對象、把空摘要寫成空字串、
// 或是轉完沒存回 DB——三種都回 200，只有回頭讀一次才看得見。

#[tokio::test]
async fn 自動轉簡體會把結果寫回文章() {
    let (app, _pool) = test_app().await;
    let id = create_post(
        &app,
        json!({
            "title": "這是繁體標題", "content": "鞋帶鬆了開來", "excerpt": "簡短的摘要",
            "source_language": "zh-TW",
        }),
    )
    .await;

    let (st, v) = admin(&app, "POST", &format!("/api/admin/posts/{id}/generate-zh-cn"), None).await;
    assert!(st.is_success(), "得到 {st} {v}");
    assert_eq!(v["title_zh_cn"], "这是繁体标题");
    assert_eq!(v["content_zh_cn"], "鞋带松了开来");
    assert_eq!(v["excerpt_zh_cn"], "简短的摘要");

    // 回應對了不代表存進去了——回頭讀一次
    let p = get_post(&app, id).await;
    assert_eq!(p["title_zh_cn"], "这是繁体标题", "轉換結果沒寫回 DB");
    assert_eq!(p["content_zh_cn"], "鞋带松了开来");
    assert_eq!(p["excerpt_zh_cn"], "简短的摘要");
    assert_eq!(p["title"], "這是繁體標題", "原文不該被動到");
}

#[tokio::test]
async fn 沒有摘要時轉出來的是_null_不是空字串() {
    // 空字串會讓前端的「有沒有簡體版摘要」判斷（truthy）誤判成有，
    // 然後在簡中版顯示一段空白的摘要區塊。
    let (app, _pool) = test_app().await;
    let id = create_post(&app, json!({ "title": "沒有摘要", "content": "內文" })).await;
    let (st, v) = admin(&app, "POST", &format!("/api/admin/posts/{id}/generate-zh-cn"), None).await;
    assert!(st.is_success(), "得到 {v}");
    assert!(v["excerpt_zh_cn"].is_null(), "得到 {}", v["excerpt_zh_cn"]);
}

#[tokio::test]
async fn 只能從_zh_tw_原文轉_其餘一律_400() {
    // 拿日文原文去跑繁簡轉換會把日文漢字改掉——而那是不可逆的（原文已被覆寫）。
    let (app, _pool) = test_app().await;
    for lang in ["ja", "en", "ko", "zh-CN"] {
        let id =
            create_post(&app, json!({ "title": "標題", "content": "內文", "source_language": lang })).await;
        let (st, v) = admin(&app, "POST", &format!("/api/admin/posts/{id}/generate-zh-cn"), None).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "source_language={lang} 應該被擋，得到 {v}");
    }
}

#[tokio::test]
async fn 原文缺標題或內容時_400_不存在的文章_404() {
    let (app, pool) = test_app().await;
    // 直接插一筆內容為空的（正常路徑建不出來）
    sqlx::query(
        "INSERT INTO posts (id, title, content, status, source_language) VALUES (700, '有標題', '', 'draft', 'zh-TW')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (st, v) = admin(&app, "POST", "/api/admin/posts/700/generate-zh-cn", None).await;
    assert_eq!(st, StatusCode::BAD_REQUEST, "得到 {v}");

    let (st, v) = admin(&app, "POST", "/api/admin/posts/999999/generate-zh-cn", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND, "得到 {v}");
}
