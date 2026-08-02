//! 全站 RSS（`GET /rss`）。動手前 region 覆蓋率是 **0%**。
//!
//! RSS 壞掉是所有端點裡最無聲的一種：閱讀器不會報錯，它只是不再更新，
//! 而站長自己幾乎不會去看自己的 feed。所以這裡驗的不是「有沒有回 200」，
//! 是幾條「錯了訂閱者會默默收到爛東西」的性質：
//!
//!   · 連結要用 **slug** 不是 id —— 檔案裡的註解寫得很清楚：slug 遷移之後
//!     用 id 會讓每一條連結吃一次 301，對搜尋引擎則是整份 feed 都指向非 canonical。
//!   · `?lang=ja` 要**排掉沒有日文譯文的文章** —— 訂了日文卻收到中文全文，
//!     體感就是壞掉。
//!   · pubDate 必須是 RFC 1123 —— 格式錯的話多數閱讀器直接把該筆當成「無日期」，
//!     排序整個亂掉。
//!   · XML 轉義漏掉 `&` 或 `<` 會讓整份 feed 變成 not well-formed，
//!     閱讀器直接丟棄——一篇標題有 `&` 的文章可以毀掉整個 feed。

mod common;

use axum::http::StatusCode;
use common::{request_full, test_app};

/// 取回 feed 的 XML 本文（順便斷言狀態碼與 content-type）。
async fn rss(app: &axum::Router, query: &str) -> String {
    let path = if query.is_empty() { "/rss".to_string() } else { format!("/rss?{query}") };
    let (status, headers, body) = request_full(app, "GET", &path, None, None).await;
    assert_eq!(status, StatusCode::OK, "{path}");
    assert_eq!(
        headers.get("content-type").unwrap(),
        "application/rss+xml; charset=utf-8",
        "content-type 不對的話有些閱讀器會拒收"
    );
    // 非 JSON 的回應會被 request_full 包成 Value::String
    body.as_str().expect("RSS 應該是字串（XML）").to_string()
}

/// 這個檔案自己的固定資料：seed 那份沒有 i18n 譯文，也沒有需要轉義的字元。
///
/// ⚠ 開頭先清空 posts。`common::seed` 建的兩篇沒有指定 `created_at`，
/// 於是拿到 `datetime('now')` —— 永遠排在最前面，讓「由新到舊」與 `lastBuildDate`
/// 這兩條斷言變成跟執行當下的時鐘比對（第一版就是這樣紅的）。
/// 這個檔要驗的是排序與日期格式，資料集必須完全由自己掌控。
async fn seed_rss(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM post_tags").execute(pool).await.unwrap();
    sqlx::query("DELETE FROM posts").execute(pool).await.unwrap();
    for sql in [
        // 有 slug、有 excerpt、有分類與標籤 —— 一般情況
        "INSERT INTO posts (id, slug, title, content, excerpt, category, status, author, created_at, updated_at) \
         VALUES (20, 'has-slug', '有 slug 的文章', '內文', '這是摘要', '技術', 'published', 'Koi', \
                 '2026-01-20 03:00:00', '2026-01-21 03:00:00')",
        // 沒有 slug → 連結退回 id
        "INSERT INTO posts (id, title, content, excerpt, status, created_at, updated_at) \
         VALUES (21, '沒有 slug 的文章', '內文', '摘要', 'published', '2026-01-19 03:00:00', '2026-01-19 03:00:00')",
        // 標題與摘要含需要轉義的字元
        "INSERT INTO posts (id, slug, title, content, excerpt, status, created_at, updated_at) \
         VALUES (22, 'xml-esc', 'A & B <tag> \"quoted\" it''s', '內文', '摘要 & <b>粗體</b>', 'published', \
                 '2026-01-18 03:00:00', '2026-01-18 03:00:00')",
        // 沒有 excerpt → 要從 content 去 HTML/markdown 生出來
        "INSERT INTO posts (id, slug, title, content, status, created_at, updated_at) \
         VALUES (23, 'no-excerpt', '沒有摘要的文章', \
                 '# 標題\n\n這是 <strong>內文</strong> 的第一段。\n\n- 條列一\n- 條列二', \
                 'published', '2026-01-17 03:00:00', '2026-01-17 03:00:00')",
        // 有日文譯文 —— ?lang=ja 應該只留這一篇
        "INSERT INTO posts (id, slug, title, content, excerpt, status, title_ja, content_ja, excerpt_ja, created_at, updated_at) \
         VALUES (24, 'has-ja', '有日文版的文章', '中文內文', '中文摘要', 'published', \
                 '日本語のタイトル', '日本語の本文', '日本語の要約', '2026-01-16 03:00:00', '2026-01-16 03:00:00')",
        // 草稿：任何語系的 feed 都不該出現
        "INSERT INTO posts (id, slug, title, content, status, created_at, updated_at) \
         VALUES (25, 'a-draft', '這是草稿不該出現', '內文', 'draft', '2026-01-15 03:00:00', '2026-01-15 03:00:00')",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
    // 給 20 掛兩個標籤（tag id 1 = rust 由 seed 建立）
    sqlx::query("INSERT INTO tags (id, name) VALUES (90, 'axum')").execute(pool).await.unwrap();
    for sql in [
        "INSERT INTO post_tags (post_id, tag_id) VALUES (20, 1)",
        "INSERT INTO post_tags (post_id, tag_id) VALUES (20, 90)",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

#[tokio::test]
async fn 連結用_slug_而不是_id_沒有_slug_才退回_id() {
    // 這條是回歸測試。用 id 的話每一條連結都會吃一次 301（slug 遷移之後），
    // 訂閱者多一跳、搜尋引擎看到的是整份指向非 canonical 網址的 feed。
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;

    assert!(xml.contains("<link>https://koimsurai.com/blog/has-slug</link>"), "有 slug 就要用 slug");
    assert!(!xml.contains("/blog/20<"), "不該出現 /blog/20");
    assert!(xml.contains("<link>https://koimsurai.com/blog/21</link>"), "沒有 slug 才退回 id");
    // guid 與 link 一致，且宣告 isPermaLink
    assert!(xml.contains(r#"<guid isPermaLink="true">https://koimsurai.com/blog/has-slug</guid>"#));
}

#[tokio::test]
async fn 草稿不進_feed() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;
    assert!(!xml.contains("這是草稿不該出現"), "草稿外洩到 RSS 等於直接公開");
    assert!(!xml.contains("a-draft"));
}

#[tokio::test]
async fn 標題與摘要的_xml_轉義只做四個字元() {
    // `&` 或 `<` 沒轉的話整份 feed 變成 not well-formed，閱讀器會**整個丟掉**——
    // 一篇標題有 & 的文章可以毀掉所有訂閱者的更新。
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;

    assert!(xml.contains("A &amp; B &lt;tag&gt; &quot;quoted&quot; it's"), "得到的 XML 裡找不到轉義後的標題");
    assert!(xml.contains("摘要 &amp; &lt;b&gt;粗體&lt;/b&gt;"));
    // 單引號**不**轉義（照抄 Express 的 4 字元版；og 那支才是 5 字元版）
    assert!(!xml.contains("&apos;"), "這支刻意不轉單引號，改了就跟 og 那支分岔了");
    // 整份必須是合法 XML：沒有落單的 & （轉義後的 &xxx; 不算）
    let stray = regex_lite_count_stray_amp(&xml);
    assert_eq!(stray, 0, "有 {stray} 個沒轉義的 &，feed 會被閱讀器丟掉");
}

/// 數「不是實體開頭」的 `&`。不引入 regex 相依，手掃即可。
fn regex_lite_count_stray_amp(s: &str) -> usize {
    let b: Vec<char> = s.chars().collect();
    let mut n = 0;
    for (i, c) in b.iter().enumerate() {
        if *c != '&' {
            continue;
        }
        let tail: String = b[i + 1..].iter().take(6).collect();
        let is_entity = ["amp;", "lt;", "gt;", "quot;", "apos;", "#"].iter().any(|e| tail.starts_with(e));
        if !is_entity {
            n += 1;
        }
    }
    n
}

#[tokio::test]
async fn 沒有摘要時從內文生成_去掉_html_與_markdown() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;

    // 找出那一篇的 description
    let item = xml.split("<item>").find(|s| s.contains("沒有摘要的文章")).expect("找得到那篇");
    let desc = item
        .split("<description>")
        .nth(1)
        .and_then(|s| s.split("</description>").next())
        .expect("有 description");
    assert!(!desc.contains('<'), "HTML 標籤要被去掉，得到 {desc}");
    assert!(!desc.contains('#') && !desc.contains('*'), "markdown 記號要被去掉，得到 {desc}");
    assert!(desc.contains("這是"), "內文本身要留著，得到 {desc}");
    assert!(desc.contains("條列一"), "條列的文字要留著（只去掉記號）");
}

#[tokio::test]
async fn pubdate_是_rfc_1123_而不是_sqlite_的原始字串() {
    // 格式不對多數閱讀器會當成「無日期」，整個排序亂掉。
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;

    let pub_date =
        xml.split("<pubDate>").nth(1).and_then(|s| s.split("</pubDate>").next()).expect("至少一筆 pubDate");
    // 2026-01-20 03:00:00 UTC = Tue, 20 Jan 2026 03:00:00 GMT
    assert_eq!(pub_date, "Tue, 20 Jan 2026 03:00:00 GMT");
    assert!(!xml.contains("<pubDate>2026-01-20 03:00:00</pubDate>"), "不能原樣吐 SQLite 的格式");
    // lastBuildDate 取最新一筆的 updated_at（20 那篇是 01-21）
    let last = xml
        .split("<lastBuildDate>")
        .nth(1)
        .and_then(|s| s.split("</lastBuildDate>").next())
        .expect("有 lastBuildDate");
    assert_eq!(last, "Wed, 21 Jan 2026 03:00:00 GMT", "lastBuildDate 用 updated_at 不是 created_at");
}

#[tokio::test]
async fn 日文_feed_只收有日文譯文的文章() {
    // 訂了 ja 卻收到中文全文，訂閱者的體感就是「這個 feed 壞了」。
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "lang=ja").await;

    assert!(xml.contains("日本語のタイトル"), "有日文版的要出現，而且用日文標題");
    assert!(xml.contains("日本語の要約"));
    assert!(!xml.contains("有 slug 的文章"), "沒有日文譯文的不該混進來");
    assert!(!xml.contains("沒有摘要的文章"));
    // 連結要帶語系前綴，頻道語言與 self link 也要跟著
    assert!(xml.contains("<link>https://koimsurai.com/ja/blog/has-ja</link>"), "連結要帶 /ja");
    assert!(xml.contains("<language>ja</language>"));
    assert!(xml.contains(r#"href="https://koimsurai.com/rss?lang=ja""#), "atom:self 要指回帶 lang 的網址");
    assert!(xml.contains("<link>https://koimsurai.com/ja/blog</link>"), "頻道連結也要帶前綴");
}

#[tokio::test]
async fn 認不得的語系退回繁中且不加前綴() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    for q in ["lang=de", "lang=", "lang=zh-TW", ""] {
        let xml = rss(&app, q).await;
        assert!(xml.contains("<language>zh-TW</language>"), "q={q:?}");
        assert!(xml.contains("<link>https://koimsurai.com/blog</link>"), "q={q:?} 不該有語系前綴");
        assert!(xml.contains(r#"href="https://koimsurai.com/rss""#), "q={q:?} self link 不帶 lang");
        assert!(xml.contains("有 slug 的文章"), "q={q:?} 退回繁中就該收得到中文文章");
    }
}

#[tokio::test]
async fn 分類與標籤都變成_category_元素() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;
    let item = xml.split("<item>").find(|s| s.contains("有 slug 的文章")).expect("找得到那篇");
    assert!(item.contains("<category>技術</category>"), "文章分類要出現");
    assert!(item.contains("<category>rust</category>"), "標籤也算 category");
    assert!(item.contains("<category>axum</category>"));
    // 沒有標籤的那篇不該生出空的 <category></category>
    let plain = xml.split("<item>").find(|s| s.contains("沒有 slug 的文章")).unwrap();
    assert!(!plain.contains("<category></category>"), "空標籤不該生出空元素");
}

#[tokio::test]
async fn 沒有作者時用預設值() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    let xml = rss(&app, "").await;
    let item = xml.split("<item>").find(|s| s.contains("沒有 slug 的文章")).unwrap();
    assert!(item.contains("<author>Koimsurai</author>"), "空作者要有預設值，不是空元素");
    let with_author = xml.split("<item>").find(|s| s.contains("有 slug 的文章")).unwrap();
    assert!(with_author.contains("<author>Koi</author>"), "有作者就用它的");
}

#[tokio::test]
async fn 沒有任何文章時仍然回合法的_feed() {
    // 全新站台或某語系一篇譯文都沒有時走這條。回半份 XML 的話閱讀器會直接報錯。
    let (app, _pool) = test_app().await;
    let xml = rss(&app, "lang=ko").await;
    assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    assert!(xml.contains("<channel>") && xml.contains("</channel>"));
    assert!(xml.trim_end().ends_with("</rss>"));
    assert!(!xml.contains("<item>"), "沒有文章就不該有 item");
    assert!(xml.contains("<lastBuildDate>"), "沒有文章時 lastBuildDate 要用現在時間，不能是空的");
}

#[tokio::test]
async fn 最多三十筆且由新到舊() {
    let (app, pool) = test_app().await;
    seed_rss(&pool).await;
    // 再塞 40 篇，驗 LIMIT 30
    for i in 0..40 {
        sqlx::query(
            "INSERT INTO posts (title, content, excerpt, status, created_at, updated_at) VALUES (?, '內文', '摘要', 'published', ?, ?)",
        )
        .bind(format!("批次文章 {i}"))
        .bind(format!("2025-02-{:02} 03:00:00", (i % 28) + 1))
        .bind("2025-02-01 03:00:00")
        .execute(&pool)
        .await
        .unwrap();
    }
    let xml = rss(&app, "").await;
    assert_eq!(xml.matches("<item>").count(), 30, "上限是 30 筆");

    // 第一筆要是最新的（2026-01-20 那篇比所有 2025 的新）
    let first = xml.split("<item>").nth(1).unwrap();
    assert!(first.contains("有 slug 的文章"), "排序要由新到舊");
}
