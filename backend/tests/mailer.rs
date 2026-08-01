//! `handlers/mailer.rs` 的整合測試——這個檔在此之前是 **0% 覆蓋**（420 個 region）。
//!
//! ## 為什麼優先補這裡
//!
//! 它的失敗**完全沒有症狀**。站長按下發佈、以為訂閱者收到通知了，實際上一封都沒寄出
//! ——沒有錯誤訊息、沒有紅燈，除非有人主動去問「你有收到嗎」，否則永遠不會發現。
//! 相比之下後台編輯器壞掉當場就知道。
//!
//! 而且這是全站**唯一會把資料送給第三方的路徑**，一個 bug 不只是功能失效：
//! 收件人放錯位置就是把所有訂閱者的 email 洩漏給彼此。
//!
//! 機制又是現成的：`RESEND_BASE_URL` 早就可以用 env 覆寫（模組註解寫著
//! 「兩邊都 RESEND_BASE_URL 指本地 mock、比對實際 wire body（不真寄）」），
//! 只是一直沒有人接上去。
//!
//! ⚠ 用 `std::env::set_var`，**依賴 nextest 的行程隔離**。

mod common;

use common::{owner_token, request, test_app};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

/// 架好假的 Resend，並把三個 env 指過去。
async fn mock_resend(status: u16, body: Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/emails/batch"))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("RESEND_BASE_URL", server.uri());
        std::env::set_var("RESEND_API_KEY", "re_test_key");
        std::env::set_var("PUBLIC_SITE_URL", "https://example.test/");
        std::env::set_var("NEWSLETTER_FROM", "Test <no-reply@example.test>");
    }
    server
}

async fn seed_post(pool: &sqlx::SqlitePool, id: i64, title: &str, excerpt: &str, status: &str) {
    sqlx::query("INSERT INTO posts (id, title, content, excerpt, status) VALUES (?, ?, 'x', ?, ?)")
        .bind(id)
        .bind(title)
        .bind(excerpt)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_sub(
    pool: &sqlx::SqlitePool,
    email: &str,
    name: Option<&str>,
    status: &str,
    token: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO newsletter_subscribers (email, name, status, unsubscribe_token) VALUES (?, ?, ?, ?)",
    )
    .bind(email)
    .bind(name)
    .bind(status)
    .bind(token)
    .execute(pool)
    .await
    .unwrap();
}

/// 把 mock 收到的所有 batch 請求解析成「一封信一個物件」。
async fn sent_emails(server: &MockServer) -> Vec<Value> {
    let reqs: Vec<Request> = server.received_requests().await.unwrap();
    reqs.iter().flat_map(|r| serde_json::from_slice::<Vec<Value>>(&r.body).unwrap_or_default()).collect()
}

async fn send(app: &axum::Router, id: i64) -> (axum::http::StatusCode, Value) {
    request(app, "POST", &format!("/api/admin/posts/{id}/send-newsletter"), None, Some(&owner_token(true)))
        .await
}

// ── 隱私：這一組是整個檔案存在的主因 ─────────────────────────────────────

/// **一人一封，`to` 裡只有自己的 email。**
///
/// Resend 的 batch API 收的是一個陣列，每個元素是一封獨立的信。有人為了「少打幾次
/// API」把它改成一封信、`to` 放所有收件人的話，**每個訂閱者都會看到其他所有人的
/// email 地址**——那不是功能壞掉，是個資外洩。
///
/// 所以這裡不只驗數量，還逐封驗「收件人恰好一個，而且是他自己」。
#[tokio::test]
async fn every_subscriber_gets_their_own_email_and_never_sees_the_others() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 100, "新文章", "摘要", "published").await;
    for (e, t) in [("a@x.test", "tok-a"), ("b@x.test", "tok-b"), ("c@x.test", "tok-c")] {
        seed_sub(&pool, e, None, "active", Some(t)).await;
    }

    let (status, body) = send(&app, 100).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["sent"], 3);

    let emails = sent_emails(&server).await;
    assert_eq!(emails.len(), 3, "三個訂閱者應該是三封獨立的信");
    let mut recipients = Vec::new();
    for m in &emails {
        let to = m["to"].as_array().expect("to 應該是陣列");
        assert_eq!(to.len(), 1, "每封信只能有一個收件人，否則訂閱者會看到彼此的 email：{m}");
        recipients.push(to[0].as_str().unwrap().to_string());
    }
    recipients.sort();
    assert_eq!(recipients, ["a@x.test", "b@x.test", "c@x.test"]);
}

/// **退訂連結必須是收件人自己的 token。**
///
/// 用錯 token 的後果是 A 點了退訂、被退掉的是 B——而且兩個人都不會知道。
#[tokio::test]
async fn each_email_carries_its_own_unsubscribe_token() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 101, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;
    seed_sub(&pool, "b@x.test", None, "active", Some("tok-b")).await;

    send(&app, 101).await;

    for m in sent_emails(&server).await {
        let to = m["to"][0].as_str().unwrap().to_string();
        let expected = if to == "a@x.test" { "tok-a" } else { "tok-b" };
        let html = m["html"].as_str().unwrap();
        let text = m["text"].as_str().unwrap();
        assert!(html.contains(expected), "{to} 的 HTML 應該帶自己的退訂 token");
        assert!(text.contains(expected), "{to} 的純文字版也要帶自己的 token");
        // 而且**不能**帶到別人的
        let other = if expected == "tok-a" { "tok-b" } else { "tok-a" };
        assert!(!html.contains(other), "{to} 的信裡出現了別人的退訂 token");
    }
}

/// **只寄給 active 的訂閱者。**
///
/// 退訂過的人再收到信，輕則是信任問題、重則是法遵問題（CAN-SPAM / GDPR）。
/// 沒有 token 的那筆同樣不能寄——他收到的信裡退訂連結會是壞的，等於退不掉。
#[tokio::test]
async fn only_active_subscribers_with_a_token_are_mailed() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 102, "標題", "摘要", "published").await;
    seed_sub(&pool, "active@x.test", None, "active", Some("tok-ok")).await;
    seed_sub(&pool, "gone@x.test", None, "unsubscribed", Some("tok-gone")).await;
    seed_sub(&pool, "pending@x.test", None, "pending", Some("tok-pending")).await;
    seed_sub(&pool, "notoken@x.test", None, "active", None).await;

    let (_, body) = send(&app, 102).await;
    assert_eq!(body["sent"], 1, "只有一個人該收到：{body}");

    let emails = sent_emails(&server).await;
    let to: Vec<&str> = emails.iter().map(|m| m["to"][0].as_str().unwrap()).collect();
    assert_eq!(to, ["active@x.test"]);
}

// ── 信件內容 ──────────────────────────────────────────────────────────────

/// `List-Unsubscribe` 標頭。少了它 Gmail 會把整批信丟進垃圾郵件，
/// 而寄件端看到的仍然是「寄送成功」——又是一個沒有症狀的失敗。
#[tokio::test]
async fn emails_carry_the_one_click_unsubscribe_headers() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 103, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;

    send(&app, 103).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let h = &m["headers"];
    assert_eq!(h["List-Unsubscribe"], "<https://example.test/unsubscribe?token=tok-a>");
    assert_eq!(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
}

/// 標題裡的 HTML 要被逸出——文章標題是站長自己打的，但「自己打的」不等於安全：
/// 一個 `<` 就會把後面的版面吃掉，收件人看到的是壞掉的信。
#[tokio::test]
async fn html_in_the_title_is_escaped() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 104, "<script>alert(1)</script> & 'quotes'", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;

    send(&app, 104).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let html = m["html"].as_str().unwrap();
    assert!(!html.contains("<script>"), "標題裡的 <script> 應該被逸出：{html}");
    assert!(html.contains("&lt;script&gt;"));
    assert!(html.contains("&amp;"), "& 要先逸出，否則後面的實體會壞掉");
    // 主旨是純文字欄位，不逸出（逸出反而會讓收件匣顯示 &lt;）
    assert!(m["subject"].as_str().unwrap().starts_with("<script>"));
}

/// 有名字就打招呼、沒名字用通用的——不能出現「Hi ，」這種缺字的問候。
#[tokio::test]
async fn the_greeting_falls_back_when_the_subscriber_has_no_name() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 105, "標題", "摘要", "published").await;
    seed_sub(&pool, "named@x.test", Some("小明"), "active", Some("t1")).await;
    seed_sub(&pool, "anon@x.test", None, "active", Some("t2")).await;
    seed_sub(&pool, "empty@x.test", Some(""), "active", Some("t3")).await;

    send(&app, 105).await;

    for m in sent_emails(&server).await {
        let to = m["to"][0].as_str().unwrap();
        let html = m["html"].as_str().unwrap();
        if to == "named@x.test" {
            assert!(html.contains("Hi 小明，"), "有名字就該用名字");
        } else {
            assert!(html.contains("Hi，"), "{to} 沒有名字時要用通用問候，不能是「Hi ，」");
            assert!(!html.contains("Hi ，"));
        }
    }
}

// ── 分批與錯誤 ────────────────────────────────────────────────────────────

/// 超過一批（100）要分成多次請求，而且**一封都不能漏**。
#[tokio::test]
async fn subscribers_beyond_one_batch_are_split_and_none_are_dropped() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 106, "標題", "摘要", "published").await;
    for i in 0..101 {
        seed_sub(&pool, &format!("u{i}@x.test"), None, "active", Some(&format!("tok-{i}"))).await;
    }

    let (_, body) = send(&app, 106).await;
    assert_eq!(body["sent"], 101, "{body}");

    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs.len(), 2, "101 個訂閱者應該分成兩批（BATCH_SIZE = 100）");
    let emails = sent_emails(&server).await;
    assert_eq!(emails.len(), 101, "分批不能漏人");
    let mut tos: Vec<&str> = emails.iter().map(|m| m["to"][0].as_str().unwrap()).collect();
    tos.sort_unstable();
    tos.dedup();
    assert_eq!(tos.len(), 101, "也不能重複寄");
}

/// 上游失敗 → 算進 `failed`，而且錯誤訊息取 body 的 `.message`（不是整包 JSON）。
#[tokio::test]
async fn an_upstream_failure_is_counted_and_the_message_is_surfaced() {
    let _server =
        mock_resend(422, json!({ "message": "Invalid `from` field", "name": "validation_error" })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 107, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t1")).await;
    seed_sub(&pool, "b@x.test", None, "active", Some("t2")).await;

    let (status, body) = send(&app, 107).await;
    assert_eq!(status, 200, "上游失敗不該讓這支端點自己爆掉：{body}");
    assert_eq!(body["sent"], 0);
    assert_eq!(body["failed"], 2, "整批算失敗");
    assert_eq!(body["errors"][0], "Invalid `from` field", "要把上游說的原因帶出來");
}

// ── route 層的守衛 ────────────────────────────────────────────────────────

#[tokio::test]
async fn sending_requires_admin() {
    let _s = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 108, "標題", "摘要", "published").await;
    let (status, _) = request(&app, "POST", "/api/admin/posts/108/send-newsletter", None, None).await;
    assert_eq!(status, 401);
}

/// 沒設 RESEND_API_KEY → 500，而且**訊息要說清楚是設定問題**。
///
/// 這條是給未來的自己看的：真的發生時最需要知道的就是「不是程式壞了，是 env 沒設」。
#[tokio::test]
async fn a_missing_api_key_says_so_instead_of_failing_silently() {
    let _s = mock_resend(200, json!({ "data": [] })).await;
    unsafe { std::env::remove_var("RESEND_API_KEY") };
    let (app, pool) = test_app().await;
    seed_post(&pool, 109, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t1")).await;

    let (status, body) = send(&app, 109).await;
    assert_eq!(status, 500);
    assert!(
        body["error"].as_str().unwrap().contains("RESEND_API_KEY"),
        "錯誤訊息要指名是哪個設定沒設：{body}"
    );
}

/// 只有已發佈的文章可以寄——草稿寄出去就收不回來了。
#[tokio::test]
async fn drafts_cannot_be_mailed() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 110, "還沒寫完", "摘要", "draft").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t1")).await;

    let (status, body) = send(&app, 110).await;
    assert_eq!(status, 400, "{body}");
    assert!(server.received_requests().await.unwrap().is_empty(), "草稿一封都不該寄出去");
}

#[tokio::test]
async fn a_missing_post_is_a_404() {
    let _s = mock_resend(200, json!({ "data": [] })).await;
    let (app, _pool) = test_app().await;
    let (status, body) = send(&app, 99999).await;
    assert_eq!(status, 404, "{body}");
}

/// 沒有訂閱者 → 明確說出來，而不是回一個看起來像成功的空結果。
#[tokio::test]
async fn no_subscribers_is_reported_explicitly() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 111, "標題", "摘要", "published").await;

    let (status, body) = send(&app, 111).await;
    assert_eq!(status, 200);
    assert_eq!(body["sent"], 0);
    assert_eq!(body["message"], "no active subscribers");
    assert!(server.received_requests().await.unwrap().is_empty(), "沒有人可寄時不該打上游");
}

/// `PUBLIC_SITE_URL` 尾端的斜線要被去掉——否則連結會變成 `https://x//blog/1`。
#[tokio::test]
async fn a_trailing_slash_in_the_site_url_does_not_produce_double_slashes() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    // mock_resend 設的就是帶尾斜線的 'https://example.test/'
    let (app, pool) = test_app().await;
    seed_post(&pool, 112, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t1")).await;

    send(&app, 112).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let html = m["html"].as_str().unwrap();
    assert!(html.contains("https://example.test/blog/112"), "文章連結不該有雙斜線：{html}");
    assert!(!html.contains("example.test//"));
}

// ── 「發佈即推送」：建/改文時順便寄 ────────────────────────────────────────
//
// `POST /api/admin/posts` 帶 `send_newsletter: true` + `status: "published"` 時，
// admin 那邊會呼叫 `dispatch_newsletter`。這是實際上比手動那支更常走的路徑
// （站長按「發佈」就寄了），而它的結果只是附在回應的 `data.newsletter` 裡——
// 沒有人主動去看的話，寄失敗跟寄成功長得一樣。

async fn create_post(app: &axum::Router, body: Value) -> (axum::http::StatusCode, Value) {
    request(app, "POST", "/api/admin/posts", Some(body), Some(&owner_token(true))).await
}

/// 發佈時勾了推送 → 真的寄出去，而且結果回在 `data.newsletter`。
#[tokio::test]
async fn publishing_with_the_newsletter_flag_actually_sends() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;
    seed_sub(&pool, "b@x.test", None, "active", Some("tok-b")).await;

    let (status, body) = create_post(
        &app,
        json!({ "title": "新文章", "content": "內文", "excerpt": "摘要",
                "status": "published", "send_newsletter": true }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["data"]["newsletter"]["sent"], 2, "發佈即推送應該真的寄出去：{body}");

    let emails = sent_emails(&server).await;
    assert_eq!(emails.len(), 2);
    // 信裡的文章連結要指向剛建的那一篇，不是別篇
    let new_id = body["data"]["id"].as_i64().expect("回應應該帶新文章 id");
    for m in &emails {
        assert!(
            m["html"].as_str().unwrap().contains(&format!("/blog/{new_id}")),
            "信裡的連結應該指向剛發佈的文章"
        );
    }
}

/// **沒勾就不寄。** 這條看起來理所當然，但它守的是「不小心把草稿的通知寄出去」——
/// 寄出去的信收不回來。
#[tokio::test]
async fn publishing_without_the_flag_sends_nothing() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;

    let (status, body) =
        create_post(&app, json!({ "title": "t", "content": "c", "status": "published" })).await;
    assert_eq!(status, 201, "{body}");
    assert!(body["data"].get("newsletter").is_none(), "沒勾就不該有 newsletter 結果");
    assert!(server.received_requests().await.unwrap().is_empty(), "沒勾就一封都不該寄");
}

/// **草稿即使勾了也不寄。**
///
/// 判斷是 `send_newsletter && status == "published"`。少了後半，
/// 存個草稿就會把通知發給所有訂閱者——而那篇文章根本還沒公開，
/// 讀者點進去會看到 404。
#[tokio::test]
async fn a_draft_never_sends_even_with_the_flag_on() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;

    let (status, body) = create_post(
        &app,
        json!({ "title": "還沒寫完", "content": "c", "status": "draft", "send_newsletter": true }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert!(body["data"].get("newsletter").is_none());
    assert!(server.received_requests().await.unwrap().is_empty(), "草稿勾了推送也不該寄——寄出去的信收不回來");
}

/// 寄信失敗**不能**讓建文本身失敗——文章已經寫進 DB 了，
/// 這時候回 500 會讓站長以為沒建成而再建一次，變成兩篇。
#[tokio::test]
async fn a_mail_failure_does_not_fail_the_post_creation() {
    let _s = mock_resend(500, json!({ "message": "resend is down" })).await;
    let (app, pool) = test_app().await;
    seed_sub(&pool, "a@x.test", None, "active", Some("tok-a")).await;

    let (status, body) = create_post(
        &app,
        json!({ "title": "文章", "content": "c", "status": "published", "send_newsletter": true }),
    )
    .await;
    assert_eq!(status, 201, "寄信失敗不該讓建文失敗：{body}");
    assert_eq!(body["data"]["newsletter"]["failed"], 1, "但失敗要被回報出來");

    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM posts WHERE title = '文章'").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 1, "文章應該只有一篇（而且真的建起來了）");
}

// ── 摘要的截斷與省略號 ────────────────────────────────────────────────────
//
// 這一組是 `cargo mutants` 逼出來的：`> 320` 換成 `<` 或 `>=`、以及
// `!excerpt.is_empty()` 拿掉驚嘆號，三個變異原本都沒人抓。
// 上面那些測試的摘要都是「摘要」兩個字，短到不管條件怎麼改都看不出差別。

/// 取信裡的摘要段落（沒有就回 None）。
fn excerpt_block(html: &str) -> Option<&str> {
    let start = html.find("line-height:1.75")?;
    let from = html[start..].find('>')? + start + 1;
    let to = html[from..].find("</p>")? + from;
    Some(html[from..to].trim())
}

/// 短摘要**不該**有省略號。
#[tokio::test]
async fn a_short_excerpt_gets_no_ellipsis() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 120, "標題", "很短的摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 120).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let block = excerpt_block(m["html"].as_str().unwrap()).expect("應該有摘要段落");
    assert_eq!(block, "很短的摘要");
    assert!(!block.contains('…'), "沒被截斷就不該有省略號：{block}");
}

/// **剛好 320 不加省略號**——判斷是 `> 320` 而不是 `>= 320`。
///
/// 差一個等號的後果是每一封「摘要剛好滿版」的信都會多一個沒有意義的「…」，
/// 暗示後面還有內容但其實沒有。
#[tokio::test]
async fn an_excerpt_of_exactly_320_is_not_marked_as_truncated() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    let exact = "a".repeat(320);
    seed_post(&pool, 121, "標題", &exact, "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 121).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let block = excerpt_block(m["html"].as_str().unwrap()).unwrap();
    assert_eq!(block.chars().count(), 320);
    assert!(!block.ends_with('…'), "剛好 320 不算被截斷");
}

/// 超過 320 → 截到 320 並補省略號。
#[tokio::test]
async fn a_long_excerpt_is_truncated_and_marked() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    let long = "b".repeat(400);
    seed_post(&pool, 122, "標題", &long, "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 122).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let block = excerpt_block(m["html"].as_str().unwrap()).unwrap();
    assert!(block.ends_with('…'), "超過 320 要補省略號：{}", &block[block.len().saturating_sub(40)..]);
    assert_eq!(block.trim_end_matches('…').chars().count(), 320, "本體要剛好截到 320");
}

/// **沒有摘要 → 整個段落不出現**（而不是留一個空的 `<p>`）。
#[tokio::test]
async fn a_post_without_an_excerpt_omits_the_block_entirely() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO posts (id, title, content, excerpt, status) VALUES (123, '標題', 'x', NULL, 'published')")
        .execute(&pool)
        .await
        .unwrap();
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 123).await;

    let m = sent_emails(&server).await.pop().unwrap();
    assert!(excerpt_block(m["html"].as_str().unwrap()).is_none(), "沒有摘要時不該留一個空段落在信裡");
}

/// 截斷用的是**逸出後**的字串，省略號判斷用的是**原始**長度。
///
/// 這個不對稱是照抄 Express 的（`escapeHtml(excerpt).slice(0,320)` 搭配
/// `excerpt.length > 320`）。`&` 逸出成 `&amp;` 會變成 5 個字元，所以
/// 200 個 `&` 逸出後是 1000 字元、會被截到 320，但原始長度只有 200 → 不加省略號。
///
/// 看起來像 bug，實際上兩邊行為一致才是這次移植的目標；釘住它是為了讓「哪天要修」
/// 是一個明確的決定，而不是某次重構順手改掉、然後兩邊悄悄不一樣。
#[tokio::test]
async fn truncation_uses_the_escaped_text_while_the_ellipsis_uses_the_original_length() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 124, "標題", &"&".repeat(200), "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 124).await;

    let m = sent_emails(&server).await.pop().unwrap();
    let block = excerpt_block(m["html"].as_str().unwrap()).unwrap();
    assert_eq!(block.chars().count(), 320, "逸出後被截到 320");
    assert!(!block.ends_with('…'), "原始長度只有 200，所以不加省略號（與 Express 一致）");
}

// ── mutants 補的最後三塊 ──────────────────────────────────────────────────

/// `from` 必須是設定的寄件人。
///
/// 沒有人驗過這個欄位——mutants 把 `newsletter_from()` 換成空字串或 "xyzzy"
/// 都沒被抓到。實際後果不是「顯示怪」而是**整批寄不出去**：Resend 會擋掉未驗證的
/// 網域，而錯誤只出現在 API 回應裡，站長那邊看到的仍然是一次「已送出」。
#[tokio::test]
async fn the_from_address_is_the_configured_sender() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    let (app, pool) = test_app().await;
    seed_post(&pool, 130, "標題", "摘要", "published").await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;
    send(&app, 130).await;

    let m = sent_emails(&server).await.pop().unwrap();
    assert_eq!(m["from"], "Test <no-reply@example.test>", "from 要用 NEWSLETTER_FROM 設的值");
}

/// `RESEND_API_KEY` 是**空字串**時也算沒設定。
///
/// route 那層會先擋（回 500），所以這條走的是「發佈即推送」的路徑——
/// 它不預先檢查，倚賴 `send_newsletter` 自己的守衛。少了那道守衛會帶著
/// `Authorization: Bearer ` 打上去，然後把上游的 401 當成寄送失敗記下來。
#[tokio::test]
async fn an_empty_api_key_counts_as_unconfigured_on_the_publish_path() {
    let server = mock_resend(200, json!({ "data": [] })).await;
    unsafe { std::env::set_var("RESEND_API_KEY", "") };
    let (app, pool) = test_app().await;
    seed_sub(&pool, "a@x.test", None, "active", Some("t")).await;

    let (status, body) = create_post(
        &app,
        json!({ "title": "文章", "content": "c", "status": "published", "send_newsletter": true }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    let errors = body["data"]["newsletter"]["errors"].as_array().expect("應該有 errors");
    assert!(
        errors.iter().any(|e| e.as_str().unwrap_or("").contains("RESEND_API_KEY")),
        "空字串的 key 應該被當成未設定並說明白：{body}"
    );
    assert!(server.received_requests().await.unwrap().is_empty(), "沒有 key 時一封都不該送出");
}

/// **連不上上游**也要算 failed，而不是靜靜地當成成功。
///
/// 先前只測了「上游回非 2xx」，那走的是另一條分支。連線層失敗（Resend 掛了、
/// DNS 壞了、網路斷了）走的是 `Err(e)`——而那條分支的 `failed += n` 一直沒人守，
/// mutants 把它換成 `-=` 或 `*=` 都照樣綠。
#[tokio::test]
async fn a_connection_failure_is_counted_as_failed_not_silently_ignored() {
    let _s = mock_resend(200, json!({ "data": [] })).await;
    // 指向一個沒有人在聽的埠 → reqwest 在連線階段就失敗
    unsafe { std::env::set_var("RESEND_BASE_URL", "http://127.0.0.1:1") };
    let (app, pool) = test_app().await;
    seed_post(&pool, 131, "標題", "摘要", "published").await;
    for (e, t) in [("a@x.test", "t1"), ("b@x.test", "t2"), ("c@x.test", "t3")] {
        seed_sub(&pool, e, None, "active", Some(t)).await;
    }

    let (status, body) = send(&app, 131).await;
    assert_eq!(status, 200, "上游連不上不該讓端點自己爆掉：{body}");
    assert_eq!(body["sent"], 0);
    assert_eq!(body["failed"], 3, "整批三個人都要算失敗：{body}");
    assert!(!body["errors"].as_array().unwrap().is_empty(), "要留下錯誤原因");
}
