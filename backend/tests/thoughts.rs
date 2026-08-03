//! 碎念（thoughts）——公開讀取、讚/倒讚、以及 admin 的 CRUD。
//!
//! 原本 74%，而漏掉的那 328 個 region 幾乎全是「壞了不會有錯誤訊息」的那種：
//!
//!   · **讚/倒讚是差值運算**（`likes + Δ`，clamp 0）。算錯的症狀是數字慢慢飄掉，
//!     沒有任何一次操作看起來是壞的。而它信任 client 傳來的 `prev`，
//!     所以「同一個人連按兩次」與「切換」走的是不同的差值，兩條都得驗。
//!   · **`refUrl` 會即時 unfurl**（抓對方網頁的 og:*）。對方沒有 og 標籤、
//!     編碼是實體字元、或整個抓不到，都要有合理的退路——否則碎念會存進半殘的 ref。
//!   · **編輯時的 ref 分支有四條**（clearRef / ref 物件 / refUrl 變了 / 都沒有），
//!     選錯分支的結果是「編輯完 ref 不見了」或「舊的 ref 黏著不放」。
//!
//! ⚠ `unfurl_url` 不走 net_guard（直接用 `state.http` 抓），所以 wiremock 接得上；
//!   `enrich_media_ref` 走 `TMDB_BASE_URL`，也可以指到 wiremock。整支檔案不需要
//!   動任何生產程式碼就測得到。

mod common;

use common::{get, owner_token, post_json, request, test_app};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn seed(pool: &sqlx::SqlitePool, rows: &[(&str, &str)]) {
    for (content, created) in rows {
        sqlx::query("INSERT INTO thoughts (content, created_at) VALUES (?, ?)")
            .bind(content)
            .bind(created)
            .execute(pool)
            .await
            .unwrap();
    }
}

fn admin() -> String {
    owner_token(true)
}

// ── 公開列表 ──────────────────────────────────────────────────────────

#[tokio::test]
async fn 列表依時間新到舊_同時間再用_id_決勝() {
    let (app, pool) = test_app().await;
    // common::seed 已經放了一則；這裡再加三則，其中兩則同一個時間戳
    seed(
        &pool,
        &[
            ("舊的", "2026-01-01 00:00:00"),
            ("同時間 A", "2026-02-01 00:00:00"),
            ("同時間 B", "2026-02-01 00:00:00"),
        ],
    )
    .await;

    let (status, body) = get(&app, "/api/thoughts").await;
    assert_eq!(status, 200);
    let items = body["thoughts"].as_array().unwrap();
    let texts: Vec<&str> = items.iter().map(|t| t["content"].as_str().unwrap()).collect();

    // 同時間的兩則要用 id 決勝（新的在前）。沒有這個決勝規則的話順序會飄，
    // 讀者每次重新整理看到的排列都不一樣。
    let a = texts.iter().position(|t| *t == "同時間 A").unwrap();
    let b = texts.iter().position(|t| *t == "同時間 B").unwrap();
    assert!(b < a, "同一個時間戳時，後建立的（id 較大）要排前面");
    assert!(texts.iter().position(|t| *t == "舊的").unwrap() > a, "舊的要在最後");
}

#[tokio::test]
async fn limit_與_offset_照_js_parseint_的語義() {
    let (app, pool) = test_app().await;
    for i in 0..5 {
        seed(&pool, &[(&format!("第 {i} 則"), &format!("2026-01-0{} 00:00:00", i + 1))]).await;
    }
    let n = |b: &Value| b["thoughts"].as_array().unwrap().len();

    // JS 的 parseInt 是「能吃多少吃多少」：'3abc' → 3。這裡照抄了那個語義，
    // 所以拿它當測試點——若哪天改成嚴格解析，帶單位的舊網址就會整個失效。
    let (_, b) = get(&app, "/api/thoughts?limit=3abc").await;
    assert_eq!(n(&b), 3);

    // 完全解不出數字 → 用預設（30）
    let (_, b) = get(&app, "/api/thoughts?limit=abc").await;
    assert_eq!(n(&b), 6, "解不出來要退回預設，而不是回 0 筆");

    // offset 夾在 0 以上——負數會讓 SQL 的 OFFSET 語義變得不可預期
    let (_, b) = get(&app, "/api/thoughts?offset=-5").await;
    assert_eq!(n(&b), 6);

    let (_, b) = get(&app, "/api/thoughts?limit=2&offset=2").await;
    assert_eq!(n(&b), 2);
}

#[tokio::test]
async fn limit_夾在_100_以內() {
    let (app, _pool) = test_app().await;
    // 上限是防止有人用 ?limit=999999 把整張表撈出來。回應本身看不出被夾過，
    // 所以這裡驗的是「請求沒有被拒絕，而且沒有炸掉」。
    let (status, body) = get(&app, "/api/thoughts?limit=999999").await;
    assert_eq!(status, 200);
    assert!(body["thoughts"].as_array().unwrap().len() <= 100);
}

#[tokio::test]
async fn 單則取得_不存在的回_404() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/thoughts/1").await;
    assert_eq!(status, 200);
    assert_eq!(body["thought"]["id"], 1);

    let (status, body) = get(&app, "/api/thoughts/9999").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "not found");
}

#[tokio::test]
async fn 碎念的留言只回過審的_而且依時間由舊到新() {
    let (app, pool) = test_app().await;
    for (author, status, at) in [
        ("乙", "approved", "2026-01-02 00:00:00"),
        ("甲", "approved", "2026-01-01 00:00:00"),
        ("待審", "pending", "2026-01-03 00:00:00"),
        ("垃圾", "spam", "2026-01-04 00:00:00"),
    ] {
        sqlx::query(
            "INSERT INTO comments (thought_id, author, content, status, created_at) VALUES (1, ?, 'x', ?, ?)",
        )
        .bind(author)
        .bind(status)
        .bind(at)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (status, body) = get(&app, "/api/thoughts/1/comments").await;
    assert_eq!(status, 200);
    let authors: Vec<&str> =
        body["comments"].as_array().unwrap().iter().map(|c| c["author"].as_str().unwrap()).collect();
    // 未審核與 spam 洩漏到公開端點是這支最貴的失誤
    assert_eq!(authors, ["甲", "乙"], "只該有過審的，而且對話要由舊到新");
}

// ── 讚 / 倒讚 ─────────────────────────────────────────────────────────

async fn react(app: &axum::Router, id: i64, prev: Value, next: Value) -> (i64, i64) {
    let (status, body) =
        post_json(app, &format!("/api/thoughts/{id}/react"), json!({ "prev": prev, "next": next })).await;
    assert_eq!(status, 200, "{body}");
    (body["likes"].as_i64().unwrap(), body["dislikes"].as_i64().unwrap())
}

#[tokio::test]
async fn 讚與倒讚是差值運算_切換時兩邊同時動() {
    let (app, pool) = test_app().await;
    // 刻意從非零起跳：從 0 開始的話「-1 讚」會被 clamp 0 蓋掉，
    // 看起來一樣綠，但真正驗到的只有 clamp
    sqlx::query("UPDATE thoughts SET likes = 3, dislikes = 0 WHERE id = 1").execute(&pool).await.unwrap();

    // 從無到有
    assert_eq!(react(&app, 1, Value::Null, json!("like")).await, (4, 0));
    // like → dislike：**同一次**要 -1 讚 +1 倒讚。只加不減的話兩邊會一起長大，
    // 而畫面上看起來只是「數字有點多」
    assert_eq!(react(&app, 1, json!("like"), json!("dislike")).await, (3, 1));
    // 取消（next 為空字串，前端清除時送的就是這個）
    assert_eq!(react(&app, 1, json!("dislike"), json!("")).await, (3, 0));
}

#[tokio::test]
async fn 重複送同一個值不會累加() {
    let (app, _pool) = test_app().await;
    // prev 與 next 相同 → Δ 為 0。這是連點兩下會發生的事，
    // 若沒有用差值而是無腦 +1，數字就會被點幾下就加幾下。
    let before = react(&app, 1, Value::Null, json!("like")).await;
    let after = react(&app, 1, json!("like"), json!("like")).await;
    assert_eq!(before, after);
}

#[tokio::test]
async fn 數字不會被扣成負數() {
    let (app, pool) = test_app().await;
    sqlx::query("UPDATE thoughts SET likes = 0, dislikes = 0 WHERE id = 1").execute(&pool).await.unwrap();

    // client 的 prev 是可以偽造的（這支刻意信任它，個人站的取捨）。
    // 所以「宣稱自己之前按過讚」在 0 的狀態下不能把數字扣成負數。
    assert_eq!(react(&app, 1, json!("like"), Value::Null).await, (0, 0));
    assert_eq!(react(&app, 1, json!("dislike"), Value::Null).await, (0, 0));
}

#[tokio::test]
async fn 不認識的反應值一律被擋下而且不動資料() {
    let (app, pool) = test_app().await;
    sqlx::query("UPDATE thoughts SET likes = 3 WHERE id = 1").execute(&pool).await.unwrap();
    // 兩種擋法，狀態碼不同而且都要保持這樣：
    //   · 是字串但不認識（'love'）→ 400，這是 handler 自己的 `react_ok` 判的
    //   · 型別就不對（數字）→ 422，這是 axum 的 Json extractor 判的，還沒進 handler
    // 寫死兩個碼是為了鎖住「型別錯誤沒有被某層 catch 成 200」——那會讓髒資料悄悄寫進去。
    for (prev, next, want) in
        [(json!("love"), Value::Null, 400), (Value::Null, json!("angry"), 400), (json!(1), Value::Null, 422)]
    {
        let (status, _) =
            post_json(&app, "/api/thoughts/1/react", json!({ "prev": prev, "next": next })).await;
        assert_eq!(status, want, "prev={prev} next={next} 應該被擋");
    }
    let (_, body) = get(&app, "/api/thoughts/1").await;
    assert_eq!(body["thought"]["likes"], 3, "被擋下的請求不該改到數字");
}

#[tokio::test]
async fn 對不存在的碎念按讚回成功加零_不是_404() {
    let (app, _pool) = test_app().await;
    // 這是刻意的行為（對齊舊版）：讀者手上的頁面可能停在一則已被刪掉的碎念上，
    // 回 404 會讓前端跳錯誤，而使用者其實什麼也沒做錯。
    assert_eq!(react(&app, 9999, Value::Null, json!("like")).await, (0, 0));
}

// ── admin CRUD ────────────────────────────────────────────────────────

async fn create(app: &axum::Router, body: Value) -> (axum::http::StatusCode, Value) {
    request(app, "POST", "/api/admin/thoughts", Some(body), Some(&admin())).await
}

#[tokio::test]
async fn 建立碎念_內容必填且會_trim() {
    let (app, pool) = test_app().await;

    for body in [json!({}), json!({ "content": "" }), json!({ "content": "   \n  " })] {
        let (status, resp) = create(&app, body.clone()).await;
        assert_eq!(status, 400, "{body} 應該被擋");
        assert_eq!(resp["error"], "content required");
    }

    let (status, resp) = create(&app, json!({ "content": "  有內容  " })).await;
    assert_eq!(status, 200);
    let content: String = sqlx::query_scalar("SELECT content FROM thoughts WHERE id = ?")
        .bind(resp["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(content, "有內容", "前後空白要吃掉，不然列表上會出現莫名的縮排");
}

#[tokio::test]
async fn 帶_ref_物件時直接存下來_不打網路() {
    let (app, pool) = test_app().await;
    // ref 物件（非 media）走的是「照單全收」那條——不 unfurl、不 enrich。
    // 這正是前端已經把資料準備好時該有的行為；若這裡誤走了 unfurl，
    // 每次建立都會多一次對外請求，而且可能把準備好的資料蓋掉。
    let (status, resp) = create(
        &app,
        json!({
            "content": "貼一篇文章",
            "ref": { "type": "post", "url": "/blog/1", "json": { "title": "自家文章" } },
        }),
    )
    .await;
    assert_eq!(status, 200);

    let (t, u, j): (Option<String>, Option<String>, Option<String>) =
        sqlx::query_as("SELECT ref_type, ref_url, ref_json FROM thoughts WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(t.as_deref(), Some("post"));
    assert_eq!(u.as_deref(), Some("/blog/1"));
    assert!(j.unwrap().contains("自家文章"));
}

#[tokio::test]
async fn 帶_refurl_會去抓對方的_og_標籤() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"<html><head>
                 <title>標題標籤</title>
                 <meta property="og:title" content="OG 標題">
                 <meta name="description" content="OG 說明">
                 <meta property="og:image" content="https://example.com/a.png">
               </head><body>x</body></html>"#,
        ))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;

    let (status, resp) =
        create(&app, json!({ "content": "看到一篇好文", "refUrl": format!("{}/page", server.uri()) })).await;
    assert_eq!(status, 200);

    let (t, j): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT ref_type, ref_json FROM thoughts WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(t.as_deref(), Some("link"));
    let meta: Value = serde_json::from_str(&j.unwrap()).unwrap();
    // og:title 要贏過 <title>——後者常常帶著站名後綴，當卡片標題很醜
    assert_eq!(meta["title"], "OG 標題");
    assert_eq!(meta["desc"], "OG 說明");
    assert_eq!(meta["image"], "https://example.com/a.png");
}

#[tokio::test]
async fn 對方沒有_og_時退回_title_與網域() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/plain"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("<html><head><title>  只有 title  </title></head><body>x</body></html>"),
        )
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;

    let (_, resp) =
        create(&app, json!({ "content": "x", "refUrl": format!("{}/plain", server.uri()) })).await;
    let j: Option<String> = sqlx::query_scalar("SELECT ref_json FROM thoughts WHERE id = ?")
        .bind(resp["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    let meta: Value = serde_json::from_str(&j.unwrap()).unwrap();
    // 沒有 og 的站很多。退不回去的話卡片就是一片空白，比不做卡片還糟。
    assert_eq!(meta["title"], "只有 title", "要 trim");
    assert!(meta["desc"].is_null());
    assert!(meta["site"].as_str().unwrap().contains("127.0.0.1"), "site 退回網域");
}

#[tokio::test]
async fn 對方回錯誤時仍然存得起來_只是沒有卡片資料() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gone"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;

    // 對方掛掉不該讓「發碎念」這件事失敗——內容是我自己的，ref 只是附加物
    let (status, resp) =
        create(&app, json!({ "content": "連結掛了", "refUrl": format!("{}/gone", server.uri()) })).await;
    assert_eq!(status, 200);
    let (t, j): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT ref_type, ref_json FROM thoughts WHERE id = ?")
            .bind(resp["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(t.as_deref(), Some("link"), "網址還是要留著");
    assert_eq!(j.as_deref(), Some("{}"), "抓不到就給空物件，不要塞半殘的資料");
}

#[tokio::test]
async fn 非_http_的_refurl_不會發出請求() {
    let (app, pool) = test_app().await;
    // javascript:/file: 這種 scheme 要在發請求之前就擋掉
    let (status, resp) = create(&app, json!({ "content": "x", "refUrl": "javascript:alert(1)" })).await;
    assert_eq!(status, 200);
    let j: Option<String> = sqlx::query_scalar("SELECT ref_json FROM thoughts WHERE id = ?")
        .bind(resp["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(j.as_deref(), Some("{}"));
}

// ── 編輯：ref 的四條分支 ──────────────────────────────────────────────

async fn update(app: &axum::Router, id: i64, body: Value) -> (axum::http::StatusCode, Value) {
    request(app, "PUT", &format!("/api/admin/thoughts/{id}"), Some(body), Some(&admin())).await
}

async fn ref_of(pool: &sqlx::SqlitePool, id: i64) -> (Option<String>, Option<String>, Option<String>) {
    sqlx::query_as("SELECT ref_type, ref_url, ref_json FROM thoughts WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn 編輯_clearref_會把三個欄位一起清掉() {
    let (app, pool) = test_app().await;
    let (_, r) = create(
        &app,
        json!({ "content": "x", "ref": { "type": "post", "url": "/blog/1", "json": { "a": 1 } } }),
    )
    .await;
    let id = r["id"].as_i64().unwrap();

    let (status, _) = update(&app, id, json!({ "clearRef": true })).await;
    assert_eq!(status, 200);
    // 只清 type 不清 url/json 的話，前端會拿殘留的資料畫出半張卡片
    assert_eq!(ref_of(&pool, id).await, (None, None, None));
}

#[tokio::test]
async fn 編輯時給_ref_物件會直接覆寫_而且不重新_unfurl() {
    let (app, pool) = test_app().await;
    let (_, r) = create(&app, json!({ "content": "x", "ref": { "type": "post", "json": { "a": 1 } } })).await;
    let id = r["id"].as_i64().unwrap();

    let (status, _) =
        update(&app, id, json!({ "ref": { "type": "media", "url": "u", "json": { "tmdbId": 1 } } })).await;
    assert_eq!(status, 200);
    let (t, u, j) = ref_of(&pool, id).await;
    assert_eq!(t.as_deref(), Some("media"));
    assert_eq!(u.as_deref(), Some("u"));
    // ⚠ 編輯路徑刻意**不** enrich（建立時才 enrich）。會 enrich 的話，
    //   使用者手動改過的卡片資料會在下一次編輯時被 TMDb 的回應蓋掉。
    assert_eq!(serde_json::from_str::<Value>(&j.unwrap()).unwrap()["tmdbId"], 1);
}

#[tokio::test]
async fn 編輯時_refurl_沒變就不重抓() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/p"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string(r#"<html><head><meta property="og:title" content="第一次"></head></html>"#),
        )
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    let url = format!("{}/p", server.uri());

    let (_, r) = create(&app, json!({ "content": "x", "refUrl": url })).await;
    let id = r["id"].as_i64().unwrap();
    let before = server.received_requests().await.unwrap().len();

    // 同一個網址再送一次 → 不該再打對方一次。每次編輯都重抓的話，
    // 改個錯字就對別人的站發一次請求。
    update(&app, id, json!({ "content": "改了內容", "refUrl": url })).await;
    assert_eq!(server.received_requests().await.unwrap().len(), before, "網址沒變不該重抓");

    let (_, _, j) = ref_of(&pool, id).await;
    assert!(j.unwrap().contains("第一次"), "原本的卡片資料要留著");
}

#[tokio::test]
async fn 編輯時省略_content_會保留原文_並標記_edited() {
    let (app, pool) = test_app().await;
    let (_, r) = create(&app, json!({ "content": "原本的內容" })).await;
    let id = r["id"].as_i64().unwrap();

    let (status, _) = update(&app, id, json!({})).await;
    assert_eq!(status, 200);

    let (content, edited): (String, i64) =
        sqlx::query_as("SELECT content, edited FROM thoughts WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    // 沒帶 content 就把它清空是最容易寫錯的一種——前端只想改 ref 的時候會發生
    assert_eq!(content, "原本的內容");
    assert_eq!(edited, 1, "編輯過要標記，前台會顯示「已編輯」");
}

#[tokio::test]
async fn 編輯不存在的碎念是_404() {
    let (app, _pool) = test_app().await;
    let (status, body) = update(&app, 9999, json!({ "content": "x" })).await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "not found");
}

#[tokio::test]
async fn 刪碎念會連它的留言一起刪() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO comments (thought_id, author, content, status) VALUES (1, '甲', 'x', 'approved')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = request(&app, "DELETE", "/api/admin/thoughts/1", None, Some(&admin())).await;
    assert_eq!(status, 200);

    let thoughts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM thoughts WHERE id = 1").fetch_one(&pool).await.unwrap();
    let comments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments WHERE thought_id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(thoughts, 0);
    // 留言沒跟著刪的話會變成永遠查不到的孤兒列，而且後台留言清單裡點不進去
    assert_eq!(comments, 0, "留言要一起刪");
}

#[tokio::test]
async fn 刪不存在的碎念也回成功_這是刻意的() {
    let (app, _pool) = test_app().await;
    // 後台重複按刪除時，第二次不該跳錯誤——東西已經不在了，目的已經達成
    let (status, _) = request(&app, "DELETE", "/api/admin/thoughts/9999", None, Some(&admin())).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn 三個_admin_端點都要身分() {
    let (app, pool) = test_app().await;
    for (m, p, b) in [
        ("POST", "/api/admin/thoughts", Some(json!({ "content": "x" }))),
        ("PUT", "/api/admin/thoughts/1", Some(json!({ "content": "x" }))),
        ("DELETE", "/api/admin/thoughts/1", None),
    ] {
        let (status, _) = request(&app, m, p, b, None).await;
        assert_eq!(status, 401, "{m} {p} 沒帶 token 卻通過了");
    }
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM thoughts").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 1, "沒有任何一則被建立或刪除");
}

// ── RSS ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn rss_是合法的_xml_而且帶得出內容() {
    let (app, pool) = test_app().await;
    seed(&pool, &[("帶 <角括號> 與 & 的內容", "2026-03-01 00:00:00")]).await;

    let (status, headers, body) = common::request_full(&app, "GET", "/api/thoughts/rss", None, None).await;
    assert_eq!(status, 200);
    let ct = headers.get("content-type").unwrap().to_str().unwrap();
    assert!(ct.contains("xml"), "content-type 要是 XML，否則瀏覽器會當純文字顯示：{ct}");

    let xml = body.as_str().unwrap();
    assert!(xml.starts_with("<?xml"));
    assert!(xml.contains("<rss"));
    // 跳脫沒做的話，內容裡出現一個 < 就會讓整份 feed 解析失敗——
    // 而 feed 閱讀器不會告訴你是哪一則壞的
    assert!(xml.contains("&lt;角括號&gt;"), "角括號要跳脫");
    assert!(xml.contains("&amp;"), "& 要跳脫");
    assert!(!xml.contains("帶 <角括號>"), "不該有沒跳脫的原文");
}
