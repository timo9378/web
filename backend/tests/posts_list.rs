//! `/api/posts` 的**讀取**面：列表的篩選／排序／分頁，以及單篇的網址解析。
//!
//! 寫入面已經有 `posts_crud.rs` 蓋著，但讀取面（也就是站上流量最大的那條路徑）
//! 一條測試都沒有。漏掉的是這幾類「壞了不會有錯誤訊息」的東西：
//!
//!   · **列表與計數是兩條分開組出來的 SQL**。`WHERE` 子句要逐條鏡射，
//!     bind 也要照同樣順序疊上去。少鏡射一條的症狀不是報錯，是分頁器多開空白頁；
//!     bind 錯位的症狀是「篩選出來的內容跟你選的條件無關」。三個篩選條件疊在一起
//!     的組合是唯一驗得出 bind 順序的方式——只測單一條件的話，錯位仍然會巧合地對。
//!   · **`?lang=` 會讓列表 `continue` 掉沒譯文的文章**，所以 `total` 不能用 SQL 的
//!     COUNT，要用過濾後的實際篇數重算。這條在 api.rs 有一半（categories 的 post_count），
//!     但分頁本身的 total/total_pages 沒人驗。
//!   · **單篇的路徑參數同時吃 slug、數字 id、與改名前的舊 slug**。第三條是給
//!     「改過網址的文章不要讓舊連結死掉」用的，而它壞掉的樣子就只是 404——
//!     跟「文章真的不存在」長得一模一樣。
//!   · **卡片上的愛心讀的是 `post_reactions` 的 ❤️，不是 `posts.likes`**。
//!     兩個數字並存是歷史包袱，接錯欄位的結果是列表與文章頁顯示不同的數字。

mod common;

use common::{get, owner_token, post_json, request, test_app};
use serde_json::{Value, json};

/// 一篇測試文章。欄位固定、全部用 bind——組字串塞值會踩到 sqlx 的注入稽核。
#[derive(Default)]
struct P<'a> {
    title: &'a str,
    content: &'a str,
    category: Option<&'a str>,
    created_at: Option<&'a str>,
    view_count: i64,
    title_ja: Option<&'a str>,
    content_ja: Option<&'a str>,
}

/// 建一篇 **published** 文章（草稿另外用 SQL 直接寫，這裡的測試都只關心公開的那些）。
async fn post_row(pool: &sqlx::SqlitePool, id: i64, p: P<'_>) {
    sqlx::query(
        "INSERT INTO posts (id, title, content, status, category, created_at, view_count, title_ja, content_ja) \
         VALUES (?, ?, ?, 'published', ?, COALESCE(?, datetime('now')), ?, ?, ?)",
    )
    .bind(id)
    .bind(p.title)
    .bind(p.content)
    .bind(p.category)
    .bind(p.created_at)
    .bind(p.view_count)
    .bind(p.title_ja)
    .bind(p.content_ja)
    .execute(pool)
    .await
    .unwrap();
}

fn titles(body: &Value) -> Vec<String> {
    body["posts"].as_array().unwrap().iter().map(|p| p["title"].as_str().unwrap().to_string()).collect()
}

// ── 篩選 ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn 預設只回_published_帶_status_才看得到草稿() {
    let (app, _pool) = test_app().await;
    // 種子有一篇 published（id 1）與一篇 draft（id 2）
    let (status, body) = get(&app, "/api/posts").await;
    assert_eq!(status, 200);
    assert_eq!(titles(&body), ["公開文章"], "草稿不該出現在預設列表");
    assert_eq!(body["pagination"]["total"], 1);

    let (_, body) = get(&app, "/api/posts?status=draft").await;
    assert_eq!(titles(&body), ["未發布草稿"]);
}

#[tokio::test]
async fn 搜尋同時比對標題與內文() {
    let (app, pool) = test_app().await;
    post_row(&pool, 10, P { title: "談 Rust 的所有權", content: "無關內容", ..P::default() }).await;
    post_row(&pool, 11, P { title: "無關標題", content: "內文裡才提到 Rust", ..P::default() }).await;

    // 只比對 title 的話第二篇會被漏掉——而使用者搜得到第一篇，
    // 所以會以為搜尋是好的，只是「那篇沒寫到」
    let (_, body) = get(&app, "/api/posts?search=Rust").await;
    let t = titles(&body);
    assert_eq!(t.len(), 2, "標題與內文都要比對，得到 {t:?}");
    assert_eq!(body["pagination"]["total"], 2, "計數查詢的 WHERE 沒鏡射的話這裡會是 3");
}

#[tokio::test]
async fn 三個篩選條件疊在一起時_bind_不會錯位() {
    let (app, pool) = test_app().await;
    // 四篇，只有一篇同時滿足 search + tag + category。
    // 只測單一條件的話，bind 錯位仍然會巧合地給出正確答案——要三條疊起來才驗得出來。
    for (id, title, cat) in [
        (10, "命中 目標", "技術"),
        (11, "命中 目標", "生活"),
        (12, "沒命中", "技術"),
        (13, "命中 目標", "技術"),
    ] {
        post_row(&pool, id, P { title, content: "內文", category: Some(cat), ..P::default() }).await;
    }
    // tag 'rust' 只掛在 10 與 12 上（種子已把它掛在 1 上，這裡再掛兩篇）
    for id in [10, 12] {
        sqlx::query("INSERT INTO post_tags (post_id, tag_id) VALUES (?, 1)")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, body) = get(&app, "/api/posts?search=目標&tag=rust&category=技術").await;
    assert_eq!(status, 200);
    let ids: Vec<i64> = body["posts"].as_array().unwrap().iter().map(|p| p["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, [10], "三條件的交集只有一篇");
    assert_eq!(body["pagination"]["total"], 1, "計數查詢也要疊到同樣的三個條件");
}

#[tokio::test]
async fn 分類與標籤各自能單獨篩() {
    let (app, pool) = test_app().await;
    post_row(&pool, 10, P { title: "生活文", content: "x", category: Some("生活"), ..P::default() }).await;

    let (_, body) = get(&app, "/api/posts?category=生活").await;
    assert_eq!(titles(&body), ["生活文"]);
    assert_eq!(body["pagination"]["total"], 1);

    let (_, body) = get(&app, "/api/posts?tag=rust").await;
    assert_eq!(titles(&body), ["公開文章"]);
    assert_eq!(body["pagination"]["total"], 1);

    // 不存在的標籤要回空陣列而不是全部
    let (_, body) = get(&app, "/api/posts?tag=沒有這個標籤").await;
    assert!(body["posts"].as_array().unwrap().is_empty());
    assert_eq!(body["pagination"]["total"], 0);
}

// ── 排序與分頁 ────────────────────────────────────────────────────────

#[tokio::test]
async fn 排序有三種_預設是新到舊() {
    let (app, pool) = test_app().await;
    sqlx::query("DELETE FROM posts").execute(&pool).await.unwrap();
    for (id, title, at, views) in [
        (10, "最舊", "2026-01-01 00:00:00", 100),
        (11, "中間", "2026-02-01 00:00:00", 5),
        (12, "最新", "2026-03-01 00:00:00", 50),
    ] {
        post_row(
            &pool,
            id,
            P { title, content: "x", created_at: Some(at), view_count: views, ..P::default() },
        )
        .await;
    }

    assert_eq!(titles(&get(&app, "/api/posts").await.1), ["最新", "中間", "最舊"], "預設");
    assert_eq!(titles(&get(&app, "/api/posts?sortBy=oldest").await.1), ["最舊", "中間", "最新"]);
    // popular 是「瀏覽數優先、同數再用時間」，不是單純的時間倒序
    assert_eq!(titles(&get(&app, "/api/posts?sortBy=popular").await.1), ["最舊", "最新", "中間"]);
    // 不認識的值要退回預設，而不是讓 SQL 帶著垃圾字串出去
    assert_eq!(titles(&get(&app, "/api/posts?sortBy=banana").await.1), ["最新", "中間", "最舊"]);
}

#[tokio::test]
async fn 分頁的_total_pages_是無條件進位_而且非數字退回預設() {
    let (app, pool) = test_app().await;
    sqlx::query("DELETE FROM posts").execute(&pool).await.unwrap();
    for i in 0..7 {
        post_row(
            &pool,
            10 + i,
            P {
                title: &format!("第 {i} 篇"),
                content: "x",
                created_at: Some(&format!("2026-01-0{} 00:00:00", i + 1)),
                ..P::default()
            },
        )
        .await;
    }

    let (_, body) = get(&app, "/api/posts?limit=3&page=1").await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 3);
    assert_eq!(body["pagination"]["total"], 7);
    // 7 / 3 = 2.33 → 3 頁。無條件捨去的話最後一篇會永遠翻不到
    assert_eq!(body["pagination"]["totalPages"], 3);

    // 最後一頁只剩一篇
    let (_, body) = get(&app, "/api/posts?limit=3&page=3").await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 1);

    // 超出範圍是空陣列，不是 404 也不是回到第一頁
    let (status, body) = get(&app, "/api/posts?limit=3&page=99").await;
    assert_eq!(status, 200);
    assert!(body["posts"].as_array().unwrap().is_empty());

    // 非數字的 page/limit 退回預設（1 / 10），不是 0 也不是錯誤
    let (_, body) = get(&app, "/api/posts?limit=abc&page=xyz").await;
    assert_eq!(body["pagination"]["page"], 1);
    assert_eq!(body["pagination"]["limit"], 10);
    assert_eq!(body["posts"].as_array().unwrap().len(), 7);
}

// ── 列表項目的欄位 ────────────────────────────────────────────────────

#[tokio::test]
async fn 列表送的是內文前_260_字而不是整篇() {
    let (app, pool) = test_app().await;
    sqlx::query("DELETE FROM posts").execute(&pool).await.unwrap();
    // 整篇進列表會多送 ~188KB。截斷長度改動了不會有人發現，但流量會默默長回去。
    let long = "字".repeat(400);
    post_row(&pool, 10, P { title: "長文", content: &long, ..P::default() }).await;

    let (_, body) = get(&app, "/api/posts").await;
    let preview = body["posts"][0]["content_preview"].as_str().unwrap();
    assert_eq!(preview.chars().count(), 260);
    assert!(body["posts"][0].get("content").is_none(), "列表不該帶整篇 content");
}

#[tokio::test]
async fn 標籤是_group_concat_拆開的_沒標籤要是空陣列() {
    let (app, pool) = test_app().await;
    sqlx::query("INSERT INTO tags (name) VALUES ('axum')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO post_tags (post_id, tag_id) VALUES (1, 2)").execute(&pool).await.unwrap();
    post_row(&pool, 10, P { title: "沒標籤", content: "x", ..P::default() }).await;

    let (_, body) = get(&app, "/api/posts").await;
    let by_title: std::collections::HashMap<&str, &Value> =
        body["posts"].as_array().unwrap().iter().map(|p| (p["title"].as_str().unwrap(), p)).collect();
    let mut tags: Vec<&str> =
        by_title["公開文章"]["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
    tags.sort_unstable();
    assert_eq!(tags, ["axum", "rust"], "GROUP_CONCAT 的逗號字串要拆成陣列");
    // NULL 要變成 []，不是 [""]——後者會讓前端渲染出一顆空白標籤
    assert_eq!(by_title["沒標籤"]["tags"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn 卡片的愛心讀的是_reactions_不是_posts_likes() {
    let (app, pool) = test_app().await;
    // 兩個數字並存是歷史包袱：posts.likes 是舊的按讚計數器，卡片與文章頁的愛心
    // 都以 post_reactions 的 ❤️ 為準。接錯欄位的話兩處會顯示不同的數字。
    sqlx::query("UPDATE posts SET likes = 99 WHERE id = 1").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO post_reactions (post_id, emoji, count) VALUES (1, '❤️', 7)")
        .execute(&pool)
        .await
        .unwrap();

    let (_, body) = get(&app, "/api/posts").await;
    assert_eq!(body["posts"][0]["heart_count"], 7);
    assert_eq!(body["posts"][0]["likes"], 99, "舊欄位照樣帶出去（前端還在讀）");

    // 沒有 ❤️ 那列的文章要是 0，不是 null
    post_row(&pool, 10, P { title: "沒愛心", content: "x", ..P::default() }).await;
    let (_, body) = get(&app, "/api/posts").await;
    let zero = body["posts"].as_array().unwrap().iter().find(|p| p["title"] == "沒愛心").unwrap();
    assert_eq!(zero["heart_count"], 0);
}

// ── ?lang= ────────────────────────────────────────────────────────────

#[tokio::test]
async fn 帶_lang_時_total_用過濾後的篇數重算() {
    let (app, pool) = test_app().await;
    sqlx::query("DELETE FROM posts").execute(&pool).await.unwrap();
    // 三篇，只有兩篇有日文譯文
    for (id, title, ja, at) in [
        (10, "有日文 A", "日本語 A", "2026-02-01 00:00:00"),
        (11, "有日文 B", "日本語 B", "2026-01-01 00:00:00"),
    ] {
        post_row(
            &pool,
            id,
            P {
                title,
                content: "x",
                created_at: Some(at),
                title_ja: Some(ja),
                content_ja: Some("本文"),
                ..P::default()
            },
        )
        .await;
    }
    // 沒譯文的那篇是**最新的**——這樣才驗得到下面那條「整頁被濾空」的行為
    post_row(
        &pool,
        12,
        P { title: "只有中文", content: "x", created_at: Some("2026-03-01 00:00:00"), ..P::default() },
    )
    .await;

    let (_, body) = get(&app, "/api/posts?lang=ja&limit=1&page=2").await;
    // total 若用 SQL 的 COUNT（3 篇）算，分頁器會開出第三頁而那頁永遠是空的
    assert_eq!(body["pagination"]["total"], 1, "帶 lang 時 total 是這一頁實際留下的篇數");
    assert_eq!(body["locale"], "ja");
    assert_eq!(body["posts"][0]["title"], "日本語 A", "標題要換成該語系的");

    // ⚠ 已知的取捨，不是 bug：分頁是**先切頁再濾語系**的。第一頁抓到的那篇剛好
    //   沒有日文譯文，整頁就是空的——但列表其實還沒完（第二頁有兩篇）。
    //   前端因此不能用「這頁空的」判斷「沒有更多了」，要看 total。
    //   哪天有人把它改成先濾再切頁，這條會紅，那是好事；但要記得 total 的算法也得跟著改。
    let (_, body) = get(&app, "/api/posts?lang=ja&limit=1&page=1").await;
    assert!(body["posts"].as_array().unwrap().is_empty(), "第一頁那篇沒有日文譯文，被濾掉之後整頁是空的");

    let (_, body) = get(&app, "/api/posts?lang=ja").await;
    assert_eq!(titles(&body).len(), 2, "沒有日文譯文的那篇要被濾掉");

    // 標題有、內文空 → 不算「有譯文」（對齊 JS 的 truthy 檢查）
    sqlx::query("UPDATE posts SET title_ja = '標題有', content_ja = '' WHERE id = 12")
        .execute(&pool)
        .await
        .unwrap();
    let (_, body) = get(&app, "/api/posts?lang=ja").await;
    assert_eq!(titles(&body).len(), 2, "空字串的內文等於沒有譯文");

    // 認不出來的 lang 當成沒帶——不是回 400，也不是濾成空的
    let (_, body) = get(&app, "/api/posts?lang=克林貢語").await;
    assert_eq!(titles(&body).len(), 3);
    assert!(body["locale"].is_null());
}

// ── 單篇：網址解析 ────────────────────────────────────────────────────

#[tokio::test]
async fn 單篇同時吃_slug_數字_id_與改名前的舊_slug() {
    let (app, pool) = test_app().await;
    sqlx::query("UPDATE posts SET slug = 'new-slug' WHERE id = 1").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO post_slug_history (post_id, old_slug) VALUES (1, 'old-slug')")
        .execute(&pool)
        .await
        .unwrap();

    for path in ["new-slug", "1", "old-slug"] {
        let (status, body) = get(&app, &format!("/api/posts/{path}")).await;
        assert_eq!(status, 200, "用 {path} 進不去");
        assert_eq!(body["id"], 1);
        // 三條路徑都要回 canonical slug——前端靠它把非 canonical 的網址 301 過去。
        // 少了這個欄位，舊連結雖然打得開但會一直停在舊網址上（SEO 分散）
        assert_eq!(body["slug"], "new-slug", "{path} 沒回 canonical slug");
    }

    let (status, body) = get(&app, "/api/posts/根本沒有這篇").await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Post not found");
}

#[tokio::test]
async fn 單篇的語系欄位_不存在的語系回_404_並列出有哪些() {
    let (app, pool) = test_app().await;
    sqlx::query("UPDATE posts SET title_en = 'English', content_en = 'body' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();

    let (_, body) = get(&app, "/api/posts/1").await;
    assert_eq!(body["locale"], "zh-TW");
    assert_eq!(body["source_language"], "zh-TW");
    assert_eq!(body["is_source"], true);
    let locales: Vec<&str> =
        body["available_locales"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(locales, ["zh-TW", "en"], "來源語永遠排第一");

    let (_, body) = get(&app, "/api/posts/1?lang=en").await;
    assert_eq!(body["title"], "English");
    assert_eq!(body["is_source"], false);

    // 沒有該語系的內容時要 404 **而且**告訴前端有哪些可選，
    // 否則語言切換器只能讓使用者一個一個試
    let (status, body) = get(&app, "/api/posts/1?lang=ko").await;
    assert_eq!(status, 404);
    assert_eq!(body["locale"], "ko");
    let locales: Vec<&str> =
        body["available_locales"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(locales, ["zh-TW", "en"]);
}

// ── 單篇的附屬讀取端點 ────────────────────────────────────────────────

#[tokio::test]
async fn 反應列只回還有數量的_而且由多到少() {
    let (app, pool) = test_app().await;
    for (emoji, count) in [("👍", 2), ("🎉", 9), ("🤔", 0)] {
        sqlx::query("INSERT INTO post_reactions (post_id, emoji, count) VALUES (1, ?, ?)")
            .bind(emoji)
            .bind(count)
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, body) = get(&app, "/api/posts/1/reactions").await;
    assert_eq!(status, 200);
    let got: Vec<(&str, i64)> = body["reactions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["emoji"].as_str().unwrap(), r["count"].as_i64().unwrap()))
        .collect();
    // 歸零的那顆要消失而不是顯示 0——按過又收回的 emoji 不該一直掛在那裡
    assert_eq!(got, [("🎉", 9), ("👍", 2)]);
}

#[tokio::test]
async fn 文章留言只回過審的_而且由舊到新() {
    let (app, pool) = test_app().await;
    for (author, status, at) in [
        ("乙", "approved", "2026-01-02 00:00:00"),
        ("甲", "approved", "2026-01-01 00:00:00"),
        ("待審", "pending", "2026-01-03 00:00:00"),
    ] {
        sqlx::query(
            "INSERT INTO comments (post_id, author, content, status, created_at) VALUES (1, ?, 'x', ?, ?)",
        )
        .bind(author)
        .bind(status)
        .bind(at)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (status, body) = get(&app, "/api/posts/1/comments").await;
    assert_eq!(status, 200);
    let authors: Vec<&str> =
        body["comments"].as_array().unwrap().iter().map(|c| c["author"].as_str().unwrap()).collect();
    assert_eq!(authors, ["甲", "乙"], "未審核的洩漏到公開端點是這支最貴的失誤");
}

// ── 計數寫入 ──────────────────────────────────────────────────────────

#[tokio::test]
async fn emoji_反應的白名單與_delta_不會扣成負數() {
    let (app, _pool) = test_app().await;
    // 白名單是為了不讓任何人往資料庫塞任意字串（那會直接被渲染在文章頁上）
    for bad in ["💀", "", "<script>"] {
        let (status, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": bad })).await;
        assert_eq!(status, 400, "emoji={bad:?} 應該被擋");
        assert_eq!(body["error"], "invalid emoji");
    }

    let (_, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "🚀" })).await;
    assert_eq!(body["count"], 1);
    let (_, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "🚀" })).await;
    assert_eq!(body["count"], 2, "第二次要走 ON CONFLICT 的 UPDATE 分支");

    // 收回：delta -1。連按三次收回不能把數字扣成負數——負數會讓排序與顯示都變怪
    for want in [1, 0, 0] {
        let (_, body) =
            post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "🚀", "delta": -1 })).await;
        assert_eq!(body["count"], want);
    }

    // 沒按過就先收回：INSERT 那一側也要 clamp 0
    let (_, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "😂", "delta": -1 })).await;
    assert_eq!(body["count"], 0);
}

#[tokio::test]
async fn 留言按讚會加一_對不存在的留言回_404() {
    let (app, pool) = test_app().await;
    sqlx::query(
        "INSERT INTO comments (id, post_id, author, content, status) VALUES (5, 1, '甲', 'x', 'approved')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = post_json(&app, "/api/comments/5/like", json!({})).await;
    assert_eq!(status, 200, "得到 {body}");
    assert_eq!(body["likes"], 1);
    let (_, body) = post_json(&app, "/api/comments/5/like", json!({})).await;
    assert_eq!(body["likes"], 2);

    // 這支跟碎念的按讚不一樣：留言是實際存在的物件，按到不存在的就是壞連結，
    // 靜靜回成功會讓前端顯示一個永遠不會變的數字
    let (status, body) = post_json(&app, "/api/comments/9999/like", json!({})).await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Comment not found");
}

#[tokio::test]
async fn 刪文章要走管理員身分() {
    let (app, _pool) = test_app().await;
    let (status, _) = request(&app, "DELETE", "/api/posts/1", None, None).await;
    assert_eq!(status, 401, "沒帶身分不能刪文");

    let (status, _) = request(&app, "DELETE", "/api/posts/1", None, Some("Bearer 亂打的")).await;
    assert_eq!(status, 401);

    let (status, body) = request(&app, "DELETE", "/api/posts/1", None, Some(&owner_token(true))).await;
    assert_eq!(status, 200, "得到 {body}");
    assert_eq!(body["message"], "deleted");
}
