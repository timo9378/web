//! 書櫃 CRUD 與查詢（`/api/books`、`/api/admin/books`）。
//!
//! 這個檔補的是幾個「回 200 但資料不對」的地方：
//!
//!   · `reading_status` 的預設值只在**缺 key** 時觸發，傳 `null` 不觸發
//!     （JS 解構預設值的語意，照抄）。搞錯的話「未分類」的書會全部變成待讀。
//!   · 更新是**全欄 COALESCE**：缺 key 與傳 null 都是「保留舊值」。
//!     這跟 `/api/admin/posts` 的三態語意不同，兩邊別互相參考。
//!   · 公開列表回 `{message, books}`，後台列表回**裸陣列**。形狀不一樣是刻意的，
//!     但也因此改動時很容易只改一邊，而前端只會拿到 undefined 然後畫出空白。

mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

use common::{get, owner_token, request, test_app};

async fn admin(app: &axum::Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    request(app, method, path, body, Some(&owner_token(true))).await
}

/// 這個檔自己的資料集：清空既有的（`seed_extra` 那兩本會干擾排序與統計的斷言）。
async fn seed_books(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM books").execute(pool).await.unwrap();
    for sql in [
        "INSERT INTO books (id, isbn, title, authors, publisher, published_date, page_count, reading_status, rating, date_added, date_updated) \
         VALUES (1, '111', '深入淺出 Rust', '某作者', '甲出版', '2021-05-01', 400, 'read', 5, '2026-01-01 03:00:00', '2026-01-01 03:00:00')",
        "INSERT INTO books (id, isbn, title, authors, publisher, published_date, page_count, reading_status, rating, date_added, date_updated) \
         VALUES (2, '222', 'Axum 實戰', '另一位', '乙出版', '2023-08-01', 300, 'reading', 3, '2026-01-02 03:00:00', '2026-01-02 03:00:00')",
        "INSERT INTO books (id, isbn, title, authors, published_date, page_count, reading_status, date_added, date_updated) \
         VALUES (3, '333', '待讀的書', '某作者', '2023-01-01', 200, 'to-read', '2026-01-03 03:00:00', '2026-01-03 03:00:00')",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

fn titles(v: &Value, key: Option<&str>) -> Vec<String> {
    let arr = match key {
        Some(k) => v[k].as_array().unwrap_or_else(|| panic!("{k} 應該是陣列：{v}")),
        None => v.as_array().unwrap_or_else(|| panic!("應該是裸陣列：{v}")),
    };
    arr.iter().map(|b| b["title"].as_str().unwrap_or("").to_string()).collect()
}

#[tokio::test]
async fn 公開列表回物件_後台列表回裸陣列() {
    // 兩種形狀是刻意的，但改動時很容易只改一邊——而前端只會拿到 undefined
    // 然後畫出一個空書櫃，沒有任何錯誤。
    let (app, pool) = test_app().await;
    seed_books(&pool).await;

    let (st, public) = get(&app, "/api/books").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(public["message"], "success");
    assert_eq!(titles(&public, Some("books")).len(), 3);

    let (st, admin_list) = admin(&app, "GET", "/api/admin/books", None).await;
    assert_eq!(st, StatusCode::OK);
    assert!(admin_list.is_array(), "後台版是裸陣列，不是 {{message, books}}：{admin_list}");
    assert_eq!(titles(&admin_list, None).len(), 3);
}

#[tokio::test]
async fn 四種篩選各自生效() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;

    let (_, v) = get(&app, "/api/books?status=read").await;
    assert_eq!(titles(&v, Some("books")), vec!["深入淺出 Rust"]);

    let (_, v) = get(&app, "/api/books?rating=3").await;
    assert_eq!(titles(&v, Some("books")), vec!["Axum 實戰"]);

    // year 是 `published_date LIKE '2023%'` 的前綴比對
    let (_, v) = get(&app, "/api/books?year=2023").await;
    let mut got = titles(&v, Some("books"));
    got.sort();
    assert_eq!(got, vec!["Axum 實戰", "待讀的書"]);

    // search 同時比對書名與作者
    let (_, v) = get(&app, "/api/books?search=Rust").await;
    assert_eq!(titles(&v, Some("books")), vec!["深入淺出 Rust"], "書名要比對得到");
    let (_, v) = get(&app, "/api/books?search=某作者").await;
    let mut got = titles(&v, Some("books"));
    got.sort();
    assert_eq!(got, vec!["待讀的書", "深入淺出 Rust"], "作者也要比對得到");
}

#[tokio::test]
async fn 評分篩選給非數字時不會爆也不會全撈() {
    // `parseInt` 解不出來 → 綁 NULL → `rating = NULL` 永遠不成立 → 空清單。
    // 如果改成「解不出就不加條件」，`?rating=abc` 會變成把整個書櫃撈出來。
    let (app, pool) = test_app().await;
    seed_books(&pool).await;
    let (st, v) = get(&app, "/api/books?rating=abc").await;
    assert_eq!(st, StatusCode::OK, "不該 500");
    assert_eq!(titles(&v, Some("books")).len(), 0, "解不出評分應該是零筆，不是全部");
}

#[tokio::test]
async fn 五種排序都不一樣_未知值退回預設() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;
    let order = |q: &str| {
        let app = app.clone();
        let q = q.to_string();
        async move {
            let (_, v) = get(&app, &format!("/api/books{q}")).await;
            titles(&v, Some("books"))
        }
    };

    // 預設：date_added DESC（最新加入的在前）
    assert_eq!(order("").await, vec!["待讀的書", "Axum 實戰", "深入淺出 Rust"]);
    assert_eq!(
        order("?sortBy=date_added_asc").await,
        vec!["深入淺出 Rust", "Axum 實戰", "待讀的書"],
        "asc 要真的反過來"
    );
    assert_eq!(order("?sortBy=title_asc").await[0], "Axum 實戰", "書名升冪");
    assert_eq!(order("?sortBy=title_desc").await[0], "深入淺出 Rust", "書名降冪");
    assert_eq!(order("?sortBy=rating_desc").await[0], "深入淺出 Rust", "5 分的在最前");
    assert_eq!(order("?sortBy=published_date_desc").await[0], "Axum 實戰", "2023-08 最新");
    // 未知值不該讓查詢失敗，退回預設排序
    assert_eq!(order("?sortBy=不存在的排序").await, order("").await);
}

/// `reading_status` 的預設值走 JS 解構預設：**只有缺 key 才觸發，null 不觸發**。
/// 寫成 `??` 的話「刻意不分類」的書會全部被標成待讀。
#[tokio::test]
async fn 閱讀狀態的預設值只在缺欄位時套用() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;

    let (st, v) = admin(&app, "POST", "/api/books", Some(json!({ "title": "沒給狀態的書" }))).await;
    assert_eq!(st, StatusCode::CREATED, "得到 {v}");
    let id = v["book"]["id"].as_i64().unwrap();
    let s: Option<String> = sqlx::query_scalar("SELECT reading_status FROM books WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(s.as_deref(), Some("to-read"), "缺 key 要套預設");

    let (st, v) = admin(
        &app,
        "POST",
        "/api/books",
        Some(json!({ "title": "明確給 null 的書", "reading_status": null })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "得到 {v}");
    let id = v["book"]["id"].as_i64().unwrap();
    let s: Option<String> = sqlx::query_scalar("SELECT reading_status FROM books WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(s, None, "明確傳 null 就是 NULL，不該被預設值蓋掉");
}

#[tokio::test]
async fn 建書沒有書名是_400_回應原樣帶回_body() {
    let (app, _pool) = test_app().await;
    for body in [json!({}), json!({ "title": "" }), json!({ "title": null }), json!({ "isbn": "1" })] {
        let (st, v) = admin(&app, "POST", "/api/books", Some(body.clone())).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(v["error"], "書名為必填欄位");
    }

    // 成功時回應是 `{id, ...req.body}`——原樣把送進來的欄位帶回去
    let (st, v) = admin(
        &app,
        "POST",
        "/api/books",
        Some(json!({ "title": "新書", "isbn": "999", "personal_notes": "隨手記" })),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    assert_eq!(v["book"]["isbn"], "999");
    assert_eq!(v["book"]["personal_notes"], "隨手記");
    assert!(v["book"]["id"].is_i64());
}

/// 更新是**全欄 COALESCE**：缺 key 與傳 null 都保留舊值。
#[tokio::test]
async fn 更新書籍時沒帶的欄位一律保留() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;

    let (st, v) = admin(&app, "PUT", "/api/books/1", Some(json!({ "rating": 4 }))).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    assert_eq!(v["changes"], 1);

    let (_, one) = get(&app, "/api/books/1").await;
    let b = &one["book"];
    assert_eq!(b["rating"], 4);
    assert_eq!(b["title"], "深入淺出 Rust", "沒帶的欄位被動到了");
    assert_eq!(b["publisher"], "甲出版");

    // 明確傳 null 也是保留（COALESCE 的語意）——這跟 admin posts 的三態不同
    let (st, _) = admin(&app, "PUT", "/api/books/1", Some(json!({ "publisher": null }))).await;
    assert_eq!(st, StatusCode::OK);
    let (_, one) = get(&app, "/api/books/1").await;
    assert_eq!(one["book"]["publisher"], "甲出版", "COALESCE 底下 null 是保留不是清空");
}

#[tokio::test]
async fn 讀取更新刪除不存在的書都是_404_且訊息一致() {
    let (app, _pool) = test_app().await;
    let (st, v) = get(&app, "/api/books/999999").await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(v["message"], "Book not found");

    let (st, v) = admin(&app, "PUT", "/api/books/999999", Some(json!({ "title": "改" }))).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(v["message"], "Book not found");

    let (st, v) = admin(&app, "DELETE", "/api/books/999999", None).await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    assert_eq!(v["message"], "Book not found");
}

#[tokio::test]
async fn 刪除之後就查不到了() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;
    let (st, v) = admin(&app, "DELETE", "/api/books/2", None).await;
    assert_eq!(st, StatusCode::OK, "得到 {v}");
    assert_eq!(v["message"], "deleted");
    let (st, _) = get(&app, "/api/books/2").await;
    assert_eq!(st, StatusCode::NOT_FOUND);
    let (_, list) = get(&app, "/api/books").await;
    assert_eq!(titles(&list, Some("books")).len(), 2);
}

/// 平均分是 `toFixed(1)` 之後 parseFloat；**0 分要當成沒有評分**。
#[tokio::test]
async fn 統計的平均分四捨五入到一位_沒有評分時是_null() {
    let (app, pool) = test_app().await;
    seed_books(&pool).await;
    // 5 與 3 → 平均 4.0
    let (st, v) = get(&app, "/api/books/stats/summary").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["stats"]["total_books"], 3);
    assert_eq!(v["stats"]["books_read"], 1);
    assert_eq!(v["stats"]["books_reading"], 1);
    assert_eq!(v["stats"]["books_to_read"], 1);
    assert_eq!(v["stats"]["average_rating"], 4, "整值要輸出整數而不是 4.0");
    assert_eq!(v["stats"]["total_pages"], 900, "沒有頁數的書算 0，不是讓整個總和變 null");

    // 再加一本 4 分 → (5+3+4)/3 = 4.0；改成 5,3,5 → 4.333… → 4.3
    sqlx::query("UPDATE books SET rating = 5 WHERE id = 2").execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO books (id, title, rating, reading_status, date_added, date_updated) \
         VALUES (4, '第四本', 3, 'read', '2026-01-04 03:00:00', '2026-01-04 03:00:00')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (_, v) = get(&app, "/api/books/stats/summary").await;
    assert_eq!(v["stats"]["average_rating"], 4.3, "(5+5+3)/3 = 4.333… → 4.3");

    // 全部沒有評分 → null（不是 0）
    sqlx::query("UPDATE books SET rating = NULL").execute(&pool).await.unwrap();
    let (_, v) = get(&app, "/api/books/stats/summary").await;
    assert!(
        v["stats"]["average_rating"].is_null(),
        "沒有任何評分時要 null，得到 {}",
        v["stats"]["average_rating"]
    );
}
