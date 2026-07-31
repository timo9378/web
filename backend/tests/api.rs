//! 端到端整合測試：in-memory SQLite + migrations + `build_router`，tower `oneshot` 直打。
//! Express 對拍 oracle 退役後的接棒安全網——覆蓋核心公開端點、admin 守衛、JWT exp
//! 與 image-proxy 的 SSRF 防護。每個測試自建獨立 DB（互不干擾、可平行）。

use std::sync::LazyLock;

use axum::http::StatusCode;
use serde_json::{Value, json};

// 架設（test_app / seed / request / owner_token）抽到 tests/common/mod.rs，
// 因為 tests/snapshots.rs 也要用同一份。Rust 的整合測試一個檔案一個 crate，
// 兩邊看不到彼此，不抽出來就得抄兩份——抄兩份的下場是其中一份會慢慢走樣。
mod common;
use common::{get, owner_token, post_json, request, test_app};

/// GALLERY_MANIFEST_PATH 是 process 全域的，而兩個 gallery 測試各自要指到不同檔案。
/// nextest（CI 的跑法）一個測試一個行程，本來就不會撞；但 `cargo test` 是同一個行程內
/// 平行跑 → 互相蓋掉對方的值 → 隨機失敗。cargo-mutants 預設用 `cargo test`，baseline
/// 一失敗就整個停在「cargo test failed in an unmutated tree」什麼都測不了。
/// 用一把鎖把這兩個測試串起來，兩種跑法都成立。
static GALLERY_ENV_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

// ── 基本可用性 ─────────────────────────────────────────────────

#[tokio::test]
async fn health_ok() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, Value::String("OK".into()));
}

#[tokio::test]
async fn unknown_path_is_404() {
    let (app, _pool) = test_app().await;
    let (status, _) = get(&app, "/api/no-such-endpoint").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── posts 公開讀 ───────────────────────────────────────────────

#[tokio::test]
async fn posts_list_returns_published_only() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/posts").await;
    assert_eq!(status, StatusCode::OK);
    let posts = body["posts"].as_array().expect("posts array");
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0]["title"], "公開文章");
    assert!(body.to_string().contains("pagination"));
}

#[tokio::test]
async fn post_detail_and_404() {
    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/posts/1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["title"], "公開文章");
    assert_eq!(body["content"], "這是內文");

    let (status, body) = get(&app, "/api/posts/999").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Post not found");
}

#[tokio::test]
async fn post_view_and_like_counters() {
    let (app, pool) = test_app().await;
    let (status, _) = post_json(&app, "/api/posts/1/view", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = post_json(&app, "/api/posts/1/view", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let views: i64 =
        sqlx::query_scalar("SELECT view_count FROM posts WHERE id = 1").fetch_one(&pool).await.unwrap();
    assert_eq!(views, 2);

    let (status, body) = post_json(&app, "/api/posts/1/like", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["likes"], 1);
    let (status, body) = post_json(&app, "/api/posts/1/unlike", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["likes"], 0);

    // 不存在的文章：view 回 404
    let (status, _) = post_json(&app, "/api/posts/999/view", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_reactions_upsert() {
    let (app, _pool) = test_app().await;
    let (status, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "👍" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["emoji"], "👍");
    assert_eq!(body["count"], 1);

    let (status, body) = post_json(&app, "/api/posts/1/reactions", json!({ "emoji": "💀" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid emoji");
}

// ── 留言 ──────────────────────────────────────────────────────

#[tokio::test]
async fn anonymous_comment_goes_to_pending() {
    let (app, _pool) = test_app().await;
    let (status, body) =
        post_json(&app, "/api/posts/1/comments", json!({ "author": "路人", "content": "推一個" })).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["message"], "success");
    assert_eq!(body["status"], "pending");

    // 缺 author/content → 400
    let (status, _) = post_json(&app, "/api/posts/1/comments", json!({ "author": "路人" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ── 其他公開讀 ─────────────────────────────────────────────────

#[tokio::test]
async fn categories_tags_thoughts_books_stats() {
    let (app, _pool) = test_app().await;
    for (path, expect) in [
        ("/api/categories", "技術"),
        ("/api/tags", "rust"),
        ("/api/thoughts", "第一則碎念"),
        ("/api/stats", ""),
    ] {
        let (status, body) = get(&app, path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert!(body.to_string().contains(expect), "{path} 應包含 {expect}");
    }
    let (status, body) = get(&app, "/api/books").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["books"], json!([]));
}

/// 計數必須跟列表算同一套語系規則。
///
/// 回歸：`/api/posts?lang=` 會濾掉沒該語系譯文的文章，但 categories/tags 的 post_count 與
/// pagination.total 原本都沒濾 → 側欄顯示「4 篇」點進去卻是空的，分頁也會多出翻不滿的空白頁。
#[tokio::test]
async fn counts_match_the_locale_filtered_list() {
    let (app, pool) = test_app().await;
    // seed 只有一篇 zh-TW 的「公開文章」（分類技術、標籤 rust）。再加一篇有 ja 譯文的。
    sqlx::query(
        "INSERT INTO posts (id, title, content, category, status, title_ja, content_ja) \
         VALUES (3, '有日文的文章', '中文內文', '技術', 'published', '日本語の記事', '日本語の本文')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // 不帶 lang：兩篇都算。
    let (_, body) = get(&app, "/api/posts").await;
    assert_eq!(body["posts"].as_array().unwrap().len(), 2);
    assert_eq!(body["pagination"]["total"], 2);
    let (_, body) = get(&app, "/api/categories").await;
    assert_eq!(body["categories"][0]["post_count"], 2);

    // lang=ja：只有 id=3 有日文 → 列表、total、分類計數三者都要是 1。
    let (_, body) = get(&app, "/api/posts?lang=ja").await;
    let posts = body["posts"].as_array().unwrap();
    assert_eq!(posts.len(), 1, "ja 只有一篇有譯文");
    assert_eq!(posts[0]["title"], "日本語の記事");
    assert_eq!(body["pagination"]["total"], 1, "total 要跟列表長度一致，否則分頁會開出空白頁");

    let (_, body) = get(&app, "/api/categories?lang=ja").await;
    let tech = body["categories"].as_array().unwrap().iter().find(|c| c["name"] == "技術").expect("技術");
    assert_eq!(tech["post_count"], 1, "分類計數要跟 ja 列表一致");

    // 沒有任何 ja 文章的語系：分類仍要回傳（LEFT JOIN 不能退化成 INNER），只是計數 0，
    // 由前端的 post_count > 0 隱藏。
    let (_, body) = get(&app, "/api/categories?lang=ko").await;
    let tech =
        body["categories"].as_array().unwrap().iter().find(|c| c["name"] == "技術").expect("ko 也要有這列");
    assert_eq!(tech["post_count"], 0);

    // 標籤：rust 只掛在沒有 ja 譯文的 id=1 上 → ja 下計數 0，被 HAVING 收掉。
    let (_, body) = get(&app, "/api/tags").await;
    assert_eq!(body["tags"][0]["post_count"], 1);
    let (_, body) = get(&app, "/api/tags?lang=ja").await;
    assert_eq!(body["tags"].as_array().unwrap().len(), 0, "ja 下沒有文章的標籤不該出現");
}

// ── newsletter 全流程 ──────────────────────────────────────────

#[tokio::test]
async fn newsletter_subscribe_and_unsubscribe_flow() {
    let (app, pool) = test_app().await;
    let (status, _) = post_json(
        &app,
        "/api/newsletter/subscribe",
        json!({ "email": "reader@example.com", "name": "讀者" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let token: String = sqlx::query_scalar(
        "SELECT unsubscribe_token FROM newsletter_subscribers WHERE email = 'reader@example.com'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = get(&app, &format!("/api/newsletter/by-token/{token}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["email"], "reader@example.com");
    assert_eq!(body["status"], "active");

    let (status, _) = post_json(&app, "/api/newsletter/unsubscribe", json!({ "token": token })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = get(&app, &format!("/api/newsletter/by-token/{token}")).await;
    assert_eq!(body["status"], "unsubscribed");

    // 壞 token → 404；壞 email 格式 → 400
    let (status, _) = get(&app, "/api/newsletter/by-token/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post_json(&app, "/api/newsletter/subscribe", json!({ "email": "not-an-email" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ── admin 守衛與 JWT ───────────────────────────────────────────

#[tokio::test]
async fn admin_routes_require_bearer() {
    let (app, _pool) = test_app().await;
    for path in ["/api/admin/posts", "/api/admin/comments", "/api/admin/stats", "/api/admin/users"] {
        let (status, body) = get(&app, path).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{path}");
        assert!(body["message"].is_string(), "{path} 401 應帶 message");
    }
}

#[tokio::test]
async fn admin_allows_valid_owner_token() {
    let (app, _pool) = test_app().await;
    let token = owner_token(true);
    let (status, body) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    // admin 列表看得到草稿
    assert!(body.to_string().contains("未發布草稿"));
}

#[tokio::test]
async fn jwt_without_exp_is_rejected() {
    let (app, _pool) = test_app().await;
    let token = owner_token(false);
    let (status, _) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn jwt_wrong_secret_is_rejected() {
    let (app, _pool) = test_app().await;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "username": "admin", "iat": now, "exp": now + 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(b"wrong-secret"),
    )
    .unwrap();
    let (status, _) = request(&app, "GET", "/api/admin/posts", None, Some(&token)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── SSRF 防護（image-proxy / link-preview）────────────────────

#[tokio::test]
async fn image_proxy_blocks_internal_targets() {
    let (app, _pool) = test_app().await;
    for target in [
        "http://127.0.0.1/x.png",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.5/a.jpg",
        "http://192.168.1.1/a.jpg",
        "http://localhost:8000/a.jpg",
        "file:///etc/passwd",
        "http://[::1]/a.jpg",
    ] {
        let encoded = urlencode(target);
        let (status, body) = get(&app, &format!("/api/image-proxy?url={encoded}")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{target} 應被擋");
        assert_eq!(body, Value::String("Invalid image URL".into()), "{target}");
    }
    // 缺 url → 400（對齊 Express 訊息）
    let (status, body) = get(&app, "/api/image-proxy").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, Value::String("Missing image URL".into()));
}

#[tokio::test]
async fn link_preview_rejects_bad_urls_with_empty_card() {
    let (app, _pool) = test_app().await;
    for target in ["ftp://example.com/x", "http://127.0.0.1/", "not a url"] {
        let encoded = urlencode(target);
        let (status, body) = get(&app, &format!("/api/link-preview?url={encoded}")).await;
        assert_eq!(status, StatusCode::OK, "{target} 降級卡仍回 200");
        assert_eq!(body["title"], Value::Null, "{target}");
        assert_eq!(body["image"], Value::Null, "{target}");
    }
}

/// Trakt 同步每 6 小時把整份觀看歷史重插一次，靠 `INSERT OR IGNORE` 去重。
/// 這個測試釘住「OR IGNORE 真的有東西可 ignore」——0001 的 inline UNIQUE 有兩個洞
/// （見 migrations/0009 的說明），其中 NULL 日期那個在純 SQL 層就能重現。
#[tokio::test]
async fn watch_history_sync_is_idempotent() {
    let (_app, pool) = test_app().await;

    // 同一批資料插三次，模擬三輪同步
    for _ in 0..3 {
        for (title, date) in
            [("沙丘", Some("2026-07-01")), ("異星入境", None::<&str>), ("沙丘", Some("2026-07-02"))]
        {
            sqlx::query(
                "INSERT OR IGNORE INTO film_history (title, watched_date, source) VALUES (?, ?, 'trakt')",
            )
            .bind(title)
            .bind(date)
            .execute(&pool)
            .await
            .unwrap();
        }
        for (show, ep, date) in [
            ("影集A", Some("S01E01"), Some("2026-07-01")),
            ("影集A", Some("S01E02"), None::<&str>),
            ("影集B", None::<&str>, None::<&str>),
        ] {
            sqlx::query(
                "INSERT OR IGNORE INTO tv_history (series_name, episode_label, watched_date, source) \
                 VALUES (?, ?, ?, 'trakt')",
            )
            .bind(show)
            .bind(ep)
            .bind(date)
            .execute(&pool)
            .await
            .unwrap();
        }
    }

    let films: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM film_history").fetch_one(&pool).await.unwrap();
    let tv: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tv_history").fetch_one(&pool).await.unwrap();
    assert_eq!(films, 3, "三輪同步後 film_history 應該只有 3 筆（含一筆 NULL 日期）");
    assert_eq!(tv, 3, "三輪同步後 tv_history 應該只有 3 筆（含 NULL 集數／日期）");

    // 同片名不同日期要視為兩筆（重看），不能被誤併
    let dune: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM film_history WHERE title = '沙丘'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(dune, 2, "同片名不同觀看日是兩筆，不該被去重掉");
}

/// 解不出數字的 limit 不能讓公開端點 500。
///
/// 原本綁的是 `Option::<i64>::None`，註解寫「LIMIT NULL=無限制」——那是錯的：
/// SQLite 對 `LIMIT NULL` 回 `(code: 20) datatype mismatch`，於是
/// `GET /api/films/recent?limit=abc` 這種免認證請求就 500。三支 watch 端點都中。
///
/// 這是 schemathesis 從 OpenAPI spec 自動生輸入撞出來的——手寫測試不會想到去試
/// `limit=%F0%97%99%8C`，而且真正的觸發條件比那還寬：任何非數字都會。
#[tokio::test]
async fn watch_limit_never_500s_on_garbage() {
    let (app, _pool) = test_app().await;
    // 空字串與缺省走「用預設值」那條；其餘都該解不出數字 → 無上限，而不是 500
    let garbage = ["abc", "%F0%97%99%8C", "99999999999999999999", "-", "+", "1e5", "NaN", "null"];
    for path in ["/api/anime/history", "/api/films/recent", "/api/tv/recent"] {
        for v in garbage {
            let (status, body) = get(&app, &format!("{path}?limit={v}")).await;
            assert_eq!(status, StatusCode::OK, "{path}?limit={v} 不該 500（回應：{body}）");
        }
        // 正常值仍要生效
        let (status, _) = get(&app, &format!("{path}?limit=1")).await;
        assert_eq!(status, StatusCode::OK, "{path} 正常 limit 也要能用");
    }
}

/// `ref` 從自由格式的 Value 改成 `ThoughtRef` 之後的回歸網：link 形狀取自線上那兩則
/// 碎念，media 形狀照 `enrich_media_ref` 實際會寫出的 key。壞掉的 ref_json 要落回
/// `ref: null` 但 `ref_json` 原字串仍在——不能靜靜掉資料。
#[tokio::test]
async fn thoughts_ref_keeps_link_and_media_shapes() {
    let (app, pool) = test_app().await;
    for (content, ref_type, ref_url, ref_json) in [
        (
            "帶連結的碎念",
            "link",
            "https://example.com/a",
            r#"{"title":"100 METERS","desc":"某段簡介","image":"https://img/x.jpg","site":"The Movie Database"}"#,
        ),
        (
            "帶 TMDb 卡片的碎念",
            "media",
            "https://www.themoviedb.org/movie/123",
            r#"{"tmdbId":123,"mediaType":"movie","kind":"電影","source":"www.themoviedb.org",
                "url":"https://www.themoviedb.org/movie/123","title":"沙丘","overview":"簡介",
                "rating":"8.1","genres":"科幻, 冒險","year":"2021","poster":"https://img/p.jpg"}"#,
        ),
        ("ref_json 壞掉的碎念", "link", "https://example.com/b", r#"{"title":12345}"#),
    ] {
        sqlx::query("INSERT INTO thoughts (content, ref_type, ref_url, ref_json) VALUES (?, ?, ?, ?)")
            .bind(content)
            .bind(ref_type)
            .bind(ref_url)
            .bind(ref_json)
            .execute(&pool)
            .await
            .unwrap();
    }

    let (status, body) = get(&app, "/api/thoughts").await;
    assert_eq!(status, StatusCode::OK);
    let by_content = |c: &str| -> Value {
        body["thoughts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["content"] == c)
            .unwrap_or_else(|| panic!("找不到「{c}」"))
            .clone()
    };

    let link = by_content("帶連結的碎念");
    assert_eq!(link["ref"]["title"], "100 METERS");
    assert_eq!(link["ref"]["site"], "The Movie Database");
    assert_eq!(link["ref"]["image"], "https://img/x.jpg");
    // link 沒有 media 那組欄位 → 補成 null，而不是整筆解析失敗
    assert_eq!(link["ref"]["poster"], Value::Null);

    let media = by_content("帶 TMDb 卡片的碎念");
    assert_eq!(media["ref"]["kind"], "電影");
    assert_eq!(media["ref"]["genres"], "科幻, 冒險");
    assert_eq!(media["ref"]["poster"], "https://img/p.jpg");
    // rating / year 是 enrich 寫的字串；tmdbId 是呼叫端帶進來的數字——同一個 union 兩邊都要活著
    assert_eq!(media["ref"]["rating"], "8.1");
    assert_eq!(media["ref"]["year"], "2021");
    assert_eq!(media["ref"]["tmdbId"], 123);

    let broken = by_content("ref_json 壞掉的碎念");
    assert_eq!(broken["ref"], Value::Null, "形狀不符要落回 null");
    assert_eq!(broken["ref_json"], r#"{"title":12345}"#, "原字串仍要原封不動回去");
}

/// fixture 的每個 key/value 都要在回應裡原封不動出現——型別化不能吃掉資料。
/// 反過來允許回應多出 key：Rust 的 `Option` 序列化成 null，把缺的欄位補齊是預期行為。
fn assert_no_data_loss(orig: &Value, got: &Value, path: &str) {
    match orig {
        Value::Object(o) => {
            let g = got.as_object().unwrap_or_else(|| panic!("{path} 不是物件：{got}"));
            for (k, v) in o {
                let gv = g.get(k).unwrap_or_else(|| panic!("{path}.{k} 不見了"));
                assert_no_data_loss(v, gv, &format!("{path}.{k}"));
            }
        }
        Value::Array(a) => {
            let g = got.as_array().unwrap_or_else(|| panic!("{path} 不是陣列：{got}"));
            assert_eq!(a.len(), g.len(), "{path} 長度不同");
            for (i, v) in a.iter().enumerate() {
                assert_no_data_loss(v, &g[i], &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(orig, got, "{path} 的值被改掉了"),
    }
}

fn photo_by_id<'a>(body: &'a Value, id: &str) -> &'a Value {
    body["photos"]
        .as_array()
        .unwrap_or_else(|| panic!("photos 不是陣列：{body}"))
        .iter()
        .find(|p| p["id"] == id)
        .unwrap_or_else(|| panic!("找不到 {id}"))
}

/// manifest 型別化的回歸網：拿線上那份 manifest 的真實形狀（去識別化後）餵進端點，
/// 驗「一個 key 都沒掉」。舊 Node builder 寫的 exif 是 exiftool 的格式化字串、Rust
/// sync 寫的是數字，同一份檔案裡兩種混著——這正是最容易被一個過嚴的 struct 吃掉的地方。
#[tokio::test]
async fn gallery_photos_preserves_legacy_manifest_shape() {
    // env var 是 process 全域的 → 跟另一個 gallery 測試互斥（見 GALLERY_ENV_LOCK）
    let _env = GALLERY_ENV_LOCK.lock().await;
    let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/gallery_manifest.json");
    unsafe { std::env::set_var("GALLERY_MANIFEST_PATH", fixture) };

    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/gallery/photos").await;
    assert_eq!(status, StatusCode::OK);

    let raw: Value = serde_json::from_str(&std::fs::read_to_string(fixture).unwrap()).unwrap();
    assert_no_data_loss(&raw, &body, "manifest");

    // 混型別的 exif 兩種都要活著
    assert!(photo_by_id(&body, "fixture-1-legacy-string-exif")["exif"]["FNumber"].is_string());
    assert!(photo_by_id(&body, "fixture-2-numeric-exif")["exif"]["FNumber"].is_number());

    // 整數不能變成 100.0：manifest 會被反覆讀寫，序列化不該順手改掉數字寫法
    let legacy = photo_by_id(&body, "fixture-1-legacy-string-exif");
    assert!(legacy["exif"]["ISO"].is_i64(), "ISO 應維持整數：{}", legacy["exif"]["ISO"]);
    assert!(legacy["shootTime"].is_i64(), "shootTime 應維持整數：{}", legacy["shootTime"]);

    // 缺 description/tags/tagsEn 的舊資料不該讓整張照片被丟掉
    let bare = photo_by_id(&body, "fixture-6-no-tags-no-description");
    assert_eq!(bare["description"], "");
    assert_eq!(bare["tags"], json!([]));
    assert_eq!(bare["tagsEn"], json!([]));
    assert_eq!(bare["exif"], Value::Null);
}

/// 一張形狀壞掉的照片只丟那一張，不該讓整個相簿 500——manifest 是外部檔案，
/// 沒有任何東西保證每一列都齊。
#[tokio::test]
async fn gallery_photos_skips_broken_photo_instead_of_failing() {
    // 同上：env var 全域 → 與另一個 gallery 測試互斥
    let _env = GALLERY_ENV_LOCK.lock().await;
    let path = std::env::temp_dir().join(format!("koimsurai-manifest-{}.json", std::process::id()));
    let good = json!({
        "id": "ok", "title": "ok.jpg",
        "urls": { "full": "/a.webp", "regular": "/a.webp", "small": "/t.webp", "thumb": "/t.webp" },
        "originalUrl": "/a.webp", "thumbnailUrl": "/t.webp",
        "width": 1920, "height": 1080, "aspectRatio": 1.7777777777777777,
        "size": 123456, "format": "jpeg"
    });
    // 缺 id/urls/width…：serde 會在這一列失敗
    let broken = json!({ "title": "壞掉.jpg", "format": "jpeg" });
    std::fs::write(
        &path,
        json!({ "version": "1.0", "generatedAt": "2026-07-28T00:00:00.000Z",
                "totalPhotos": 2, "photos": [good, broken] })
        .to_string(),
    )
    .unwrap();
    unsafe { std::env::set_var("GALLERY_MANIFEST_PATH", &path) };

    let (app, _pool) = test_app().await;
    let (status, body) = get(&app, "/api/gallery/photos").await;
    let _ = std::fs::remove_file(&path);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["photos"].as_array().unwrap().len(), 1, "壞掉的那張要被跳過");
    assert_eq!(body["photos"][0]["id"], "ok");
    // totalPhotos 取實際回傳的張數，不是檔案裡寫的 2
    assert_eq!(body["totalPhotos"], 1);
}

/// 後台頁面不進 vitals 統計。
///
/// 排除發生在**讀取端**而不是寫入端：beacon 照收（歷史資料留著、將來想單獨看後台也還在），
/// 但 /api/vitals/stats 要濾掉——編輯器天生會位移，實測混進來會把全站 CLS p75 從 0.031
/// 拉到 0.129，讓文章頁的真實數字整個被蓋掉。
///
/// count 與 poor 分開斷言：p75 是用 count 算 OFFSET 的，兩句 SQL 只要有一句漏了條件，
/// 母體就會不一致——那種錯不會編譯失敗，只會靜靜地算出錯的百分位。
#[tokio::test]
async fn vitals_stats_excludes_admin_pages() {
    let (app, pool) = test_app().await;

    for (path, value, rating) in [
        ("/blog/1", 0.01, "good"),
        ("/admin", 0.4, "poor"),
        ("/admin/posts", 0.5, "poor"),
        ("/admin/posts/edit/1", 0.6, "poor"),
    ] {
        let beacon =
            json!({ "metric": "CLS", "value": value, "rating": rating, "path": path, "isMobile": false });
        let (status, _) = post_json(&app, "/api/vitals", beacon).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{path} 應該照收");
    }

    let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_vitals").fetch_one(&pool).await.unwrap();
    assert_eq!(stored, 4, "四筆都要真的寫進資料表");

    let (status, body) = get(&app, "/api/vitals/stats").await;
    assert_eq!(status, StatusCode::OK);
    let cls =
        body["metrics"].as_array().unwrap().iter().find(|m| m["metric"] == "CLS").expect("stats 要有 CLS");
    assert_eq!(cls["count"], 1, "只算 /blog/1 那筆");
    assert_eq!(cls["poor"], 0, "三筆後台的 poor 不該算進來");
    assert_eq!(cls["good"], 1);
    assert_eq!(cls["p75"], 0.01, "p75 要落在同一個（已排除後台的）母體上");
}

/// CLS 歸因欄位（target / loadState）存得進、太長會截斷、沒帶就是 NULL。
///
/// 這兩欄是診斷 CLS 的唯一手段：Lighthouse 在無節流的本機跑文章頁是 CLS 0，實地卻是 0.129，
/// 所以「哪個元素在動」只能靠真實讀者的瀏覽器回報 largestShiftTarget。
#[tokio::test]
async fn vitals_beacon_stores_cls_attribution() {
    let (app, pool) = test_app().await;

    let long_target = format!("html>body>{}", "div.wrap>".repeat(60));
    assert!(long_target.chars().count() > 200, "這個測試要靠它超過上限才有意義");

    for (path, target, load_state, shift_path) in [
        // 讀者停在文章頁，但最大位移其實發生在列表頁——這正是實測到的錯誤歸因情境
        ("/blog/1", Some("aside.blog-sidebar>div.sidebar-section"), Some("loading"), Some("/blog?page=2")),
        ("/blog/2", Some(long_target.as_str()), Some("complete"), None),
        ("/blog/3", None, None, None),
    ] {
        let mut b = json!({ "metric": "CLS", "value": 0.2, "rating": "needs-improvement", "path": path });
        if let Some(t) = target {
            b["target"] = json!(t);
        }
        if let Some(l) = load_state {
            b["loadState"] = json!(l);
        }
        if let Some(s) = shift_path {
            b["shiftPath"] = json!(s);
        }
        let (status, _) = post_json(&app, "/api/vitals", b).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }

    /// (path, target, load_state, shift_path)
    type VitalRow = (String, Option<String>, Option<String>, Option<String>);
    let rows: Vec<VitalRow> =
        sqlx::query_as("SELECT path, target, load_state, shift_path FROM web_vitals ORDER BY path")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(rows.len(), 3);

    assert_eq!(rows[0].1.as_deref(), Some("aside.blog-sidebar>div.sidebar-section"));
    assert_eq!(rows[0].2.as_deref(), Some("loading"));
    assert_eq!(rows[0].3.as_deref(), Some("/blog"), "shift_path 要去掉 query");
    assert_ne!(rows[0].0, "/blog", "path 仍是讀者離開時的位置，兩欄本來就會不同");

    let stored = rows[1].1.as_deref().expect("過長的 target 要截斷保留，不是丟掉");
    assert_eq!(stored.chars().count(), 200, "截到 200 字元");
    assert!(long_target.starts_with(stored), "截斷要留前綴——前綴才認得出是哪個元件");

    assert_eq!(rows[2].1, None, "沒帶歸因就是 NULL");
    assert_eq!(rows[2].2, None);
    assert_eq!(rows[2].3, None);
}

/// 非法 beacon 一律不進資料表。
///
/// 補這個測試是 cargo-mutants 指出來的：原本 vitals.rs 覆蓋率 98.67%，但把 `report_vital`
/// 驗證鏈裡的 `&&` 全部換成 `||`，測試照樣全綠——因為我只送過**合法**的 beacon，從來沒驗過
/// 非法的被擋掉。那條白名單等於沒被測。端點對驗證失敗一律回 204（不給探測者回饋面），
/// 所以只能查資料表。
#[tokio::test]
async fn vitals_beacon_rejects_invalid_payloads() {
    let (app, pool) = test_app().await;

    let too_long_path = format!("/{}", "a".repeat(250));
    let cases: Vec<(&str, Value)> = vec![
        ("未知 metric", json!({ "metric": "FOO", "value": 1.0, "rating": "good", "path": "/" })),
        ("未知 rating", json!({ "metric": "CLS", "value": 1.0, "rating": "great", "path": "/" })),
        ("負值", json!({ "metric": "CLS", "value": -0.1, "rating": "good", "path": "/" })),
        ("超過上限", json!({ "metric": "LCP", "value": 120_001.0, "rating": "poor", "path": "/" })),
        ("path 沒有開頭斜線", json!({ "metric": "CLS", "value": 1.0, "rating": "good", "path": "blog/1" })),
        ("path 過長", json!({ "metric": "CLS", "value": 1.0, "rating": "good", "path": too_long_path })),
    ];

    for (label, body) in cases {
        let (status, _) = post_json(&app, "/api/vitals", body).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{label}：驗證失敗也回 204");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_vitals").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "{label}：不該寫進資料表");
    }

    // 對照組：完全合法的那筆要進得去，證明上面不是因為端點整個壞掉才沒寫
    let (status, _) = post_json(
        &app,
        "/api/vitals",
        json!({ "metric": "CLS", "value": 0.05, "rating": "good", "path": "/blog/1" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_vitals").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 1, "合法 beacon 要寫得進去");
}

/// p75 要挑到正確的那一筆樣本。
///
/// 同樣是 cargo-mutants 指出來的：`(count * 75 / 100).min(count - 1)` 這個 offset 算式
/// 可以把 `*` 換成 `+`、`/` 換成 `%` 或 `*`，測試都不會失敗——因為原本只塞了一筆資料，
/// 任何算式得出的 offset 都是 0，結果一樣。而算錯不會 crash，只會永遠回錯的百分位數。
///
/// 這裡塞 20 筆 0.01…0.20：offset = 20*75/100 = 15 → 升冪第 16 筆 = 0.16。
/// 上面那些變異會分別得到 0.01 / 0.01 / 0.20，都跟 0.16 不同。
///
/// 註：`.min(count - 1)` 的 `-` 換成 `+` 是**等價變異**、殺不掉——因為對所有 count >= 1
/// 都有 count*75/100 <= count-1，這個夾制永遠不會生效（它是純防禦性的）。
#[tokio::test]
async fn vitals_stats_p75_picks_the_right_sample() {
    let (app, _pool) = test_app().await;

    // 故意打亂送出順序：p75 必須靠 SQL 的 ORDER BY，不能依賴插入順序
    let mut values: Vec<i32> = (1..=20).collect();
    values.rotate_left(7);
    for i in values {
        let v = f64::from(i) / 100.0;
        let (status, _) = post_json(
            &app,
            "/api/vitals",
            json!({ "metric": "CLS", "value": v, "rating": "good", "path": "/blog/1" }),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }

    let (status, body) = get(&app, "/api/vitals/stats").await;
    assert_eq!(status, StatusCode::OK);
    let cls =
        body["metrics"].as_array().unwrap().iter().find(|m| m["metric"] == "CLS").expect("stats 要有 CLS");

    assert_eq!(cls["count"], 20);
    let p75 = cls["p75"].as_f64().expect("p75 應為數字");
    assert!((p75 - 0.16).abs() < 1e-9, "p75 應為 0.16（升冪第 16 筆），實際 {p75}");

    // 沒有樣本的 metric：count=0、p75=null，且不能 500
    let inp = body["metrics"].as_array().unwrap().iter().find(|m| m["metric"] == "INP").unwrap();
    assert_eq!(inp["count"], 0);
    assert!(inp["p75"].is_null(), "沒有樣本時 p75 要是 null");
}

/// 極簡 percent-encode（測試用；只處理 query 值需要的字元）
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
