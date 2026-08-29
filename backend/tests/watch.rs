//! `handlers/watch.rs` 的整合測試。
//!
//! 這個檔在 Trakt 那 600 行被移除之後才寫。移除前 watch.rs 的覆蓋率有一部分是
//! Trakt token 鎖的測試撐起來的，砍掉之後掉到 9.98%——而**剩下的才是真正在跑的**：
//! 三支公開讀端點、TMDb 補圖與在地化、favorites CRUD、動畫瘋 heartbeat。
//!
//! 這裡的重點不是行數，是幾個「壞了也不會有人發現」的地方：
//!
//!   1. `films_recent` 只對**缺圖**的列打 TMDb。這條若破掉（改成每列都打），
//!      功能完全正常、回應也一樣，只是每次請求多打 N 個外部呼叫——正是剛剛
//!      才從 `/api/watch/now` 拆掉的那類問題。用 `received_requests()` 數。
//!   2. `tmdb_detail` 的 in-process 快取沒有 TTL。快取失效同樣是「靜靜地變慢」。
//!   3. `watch_stats` 的五個 count 有 `COUNT(DISTINCT)` 與 `COUNT(*)` 之分。
//!      拿同一部動畫兩集當資料才分得出來——用一集的話兩者都回 1，全部可互換。
//!   4. heartbeat 的 `X-Bahamut-Token` 是 constant-time 比對，且**同一部續播要保留
//!      startedAt**（不然前端的進度插值每次心跳都跳回 0）。
//!
//! ⚠ 用 `std::env::set_var` 指向 mock，依賴 nextest 的行程隔離（同 tests/simkl.rs）。

mod common;

use axum::http::StatusCode;
use common::{TEST_SECRET, get, owner_token, request, request_full, test_app, test_app_with_state};
use serde_json::{Value, json};
use wiremock::matchers::{method, path, path_regex, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── 架設 ──────────────────────────────────────────────────────────────────

/// 掛一台假 TMDb 並把 env 指過去。回傳的 server 要拿著，drop 掉就收攤了。
async fn mock_tmdb() -> MockServer {
    let server = MockServer::start().await;
    unsafe {
        std::env::set_var("TMDB_BASE_URL", server.uri());
        std::env::set_var("TMDB_API_TOKEN", "test-tmdb-token");
    }
    server
}

/// TMDb 的 detail 回應（`/3/movie/{id}` 與 `/3/tv/{id}` 共用形狀）。
fn tmdb_movie_body() -> Value {
    json!({
        "id": 603,
        "title": "駭客任務",
        "poster_path": "/poster.jpg",
        "backdrop_path": "/backdrop.jpg",
        "release_date": "1999-03-30",
        "runtime": 136,
    })
}

async fn seed_watch(pool: &sqlx::SqlitePool) {
    for sql in [
        // 同一部動畫兩集 → 分得出 COUNT(DISTINCT anime_sn)=1 與 COUNT(*)=2
        "INSERT INTO anime_history (anime_sn, video_sn, title, cover_url, episode, tmdb_id, last_watched_at) \
         VALUES (100, 200, '葬送的芙莉蓮', 'https://cover/1.jpg', '[01]', 5566, '2026-01-01 00:00:00')",
        "INSERT INTO anime_history (anime_sn, video_sn, title, episode, last_watched_at) \
         VALUES (100, 201, '葬送的芙莉蓮', '[02]', '2026-01-02 00:00:00')",
        "INSERT INTO anime_history (anime_sn, video_sn, title, episode, last_watched_at) \
         VALUES (101, 202, '搖曳露營', '[01]', '2026-01-03 00:00:00')",
        // 一部有 poster_url、一部沒有 → 驗「只補缺的」
        "INSERT INTO film_history (id, title, watched_date, rating, source, tmdb_id, poster_url, release_year) \
         VALUES (1, '有海報的電影', '2026-01-05', 4, 'simkl', 111, 'https://existing/p.jpg', 2020)",
        "INSERT INTO film_history (id, title, watched_date, rating, source, tmdb_id, release_year) \
         VALUES (2, '沒海報的電影', '2026-01-06', 5, 'simkl', 603, 1999)",
        // 同一影集兩集 → 驗 GROUP BY 聚合
        "INSERT INTO tv_history (series_name, episode_label, watched_date, source, tmdb_id) \
         VALUES ('絕命毒師', 'S01E01', '2026-01-07', 'simkl', 1396)",
        "INSERT INTO tv_history (series_name, episode_label, watched_date, source) \
         VALUES ('絕命毒師', 'S01E02', '2026-01-09', 'simkl')",
        "INSERT INTO tv_history (series_name, episode_label, watched_date, source) \
         VALUES ('黑鏡', 'S01E01', '2026-01-08', 'simkl')",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

// ── 公開讀：三支列表 ───────────────────────────────────────────────────────

#[tokio::test]
async fn anime_history_依最後觀看時間新到舊() {
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (st, body) = get(&app, "/api/anime/history").await;
    assert_eq!(st, StatusCode::OK);
    let h = body["history"].as_array().unwrap();
    assert_eq!(h.len(), 3);
    assert_eq!(h[0]["video_sn"], 202, "最新的 2026-01-03 要在最前面");
    assert_eq!(h[2]["video_sn"], 200, "最舊的在最後");
    // 欄位確實有帶出來（不是只回 id）
    assert_eq!(h[2]["title"], "葬送的芙莉蓮");
    assert_eq!(h[2]["cover_url"], "https://cover/1.jpg");
    assert_eq!(h[2]["tmdb_id"], 5566);
}

#[tokio::test]
async fn limit_參數對三支端點都生效() {
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (_, a) = get(&app, "/api/anime/history?limit=1").await;
    assert_eq!(a["history"].as_array().unwrap().len(), 1);
    let (_, f) = get(&app, "/api/films/recent?limit=1").await;
    assert_eq!(f["films"].as_array().unwrap().len(), 1);
    let (_, t) = get(&app, "/api/tv/recent?limit=1").await;
    assert_eq!(t["series"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn limit_給非數字時是_200_全撈_而不是_500() {
    // 回歸測試：這三支是公開免認證端點，綁 NULL 會讓 SQLite 回 datatype mismatch。
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    for p in ["/api/anime/history", "/api/films/recent", "/api/tv/recent"] {
        let (st, body) = get(&app, &format!("{p}?limit=abc")).await;
        assert_eq!(st, StatusCode::OK, "{p} 應該還是 200");
        let n = body["history"]
            .as_array()
            .or_else(|| body["films"].as_array())
            .or_else(|| body["series"].as_array());
        assert!(n.unwrap().len() >= 2, "{p} 解不出 limit 時等同無上限，不是回 0 筆");
    }
}

#[tokio::test]
async fn tv_recent_以_series_name_聚合_集數與最後觀看日都取自整組() {
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (st, body) = get(&app, "/api/tv/recent").await;
    assert_eq!(st, StatusCode::OK);
    let s = body["series"].as_array().unwrap();
    assert_eq!(s.len(), 2, "三列兩部影集");
    assert_eq!(s[0]["series_name"], "絕命毒師", "MAX(watched_date)=01-09 排最前");
    assert_eq!(s[0]["ep_count"], 2);
    assert_eq!(s[0]["last_watched"], "2026-01-09");
    // tmdb_id 只有第一集有 → MAX() 要把它撈出來，不能因為第二集是 NULL 就沒了
    assert_eq!(s[0]["tmdb_id"], 1396);
    assert_eq!(s[1]["series_name"], "黑鏡");
    assert_eq!(s[1]["ep_count"], 1);
}

#[tokio::test]
async fn watch_stats_分得清楚部數與集數() {
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (st, body) = get(&app, "/api/watch/stats").await;
    assert_eq!(st, StatusCode::OK);
    // 兩部動畫共三集；DISTINCT 與 COUNT(*) 必須是不同的數，否則兩個查詢可以互換
    assert_eq!(body["animeCount"], 2);
    assert_eq!(body["animeEpisodes"], 3);
    assert_eq!(body["filmCount"], 2);
    // 兩部影集共三集
    assert_eq!(body["tvSeriesCount"], 2);
    assert_eq!(body["tvEpisodes"], 3);
}

#[tokio::test]
async fn watch_stats_空資料時五個欄位都是零而不是漏欄位() {
    let (app, _pool) = test_app().await;
    let (st, body) = get(&app, "/api/watch/stats").await;
    assert_eq!(st, StatusCode::OK);
    for k in ["animeCount", "animeEpisodes", "filmCount", "tvSeriesCount", "tvEpisodes"] {
        assert_eq!(body[k], 0, "{k}");
    }
}

// ── TMDb 補圖 ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn films_recent_只對缺海報的列打_tmdb() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tmdb_movie_body()))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;

    let (st, body) = get(&app, "/api/films/recent").await;
    assert_eq!(st, StatusCode::OK);
    let films = body["films"].as_array().unwrap();
    // 01-06 比 01-05 新
    assert_eq!(films[0]["title"], "沒海報的電影");
    assert_eq!(films[0]["poster_url"], "https://image.tmdb.org/t/p/w342/poster.jpg");
    assert_eq!(
        films[0]["backdrop_url"], "https://image.tmdb.org/t/p/original/backdrop.jpg",
        "hero 要橫式原圖"
    );
    // 已有海報的那列**原樣保留**，而且不該去問 TMDb
    assert_eq!(films[1]["poster_url"], "https://existing/p.jpg");
    assert_eq!(films[1]["backdrop_url"], Value::Null);

    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs.len(), 1, "只有缺圖那一列該打，實際打了 {} 次", reqs.len());
    assert!(reqs[0].url.path().ends_with("/603"), "打的是 tmdb_id=603 那部");
}

#[tokio::test]
async fn tmdb_detail_的快取讓同一個_id_只打一次() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tmdb_movie_body()))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;

    for _ in 0..3 {
        let (st, _) = get(&app, "/api/films/recent").await;
        assert_eq!(st, StatusCode::OK);
    }
    assert_eq!(server.received_requests().await.unwrap().len(), 1, "第二、三次要吃 in-process 快取");
}

#[tokio::test]
async fn tmdb_失敗時列表照樣回_200_只是沒有海報() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;

    let (st, body) = get(&app, "/api/films/recent").await;
    assert_eq!(st, StatusCode::OK, "外部服務掛掉不該讓公開列表變 500");
    assert_eq!(body["films"][0]["poster_url"], Value::Null);
    assert_eq!(body["films"][0]["title"], "沒海報的電影", "DB 的資料還在");
}

#[tokio::test]
async fn 沒有_tmdb_token_就完全不對外發請求() {
    let server = MockServer::start().await;
    unsafe {
        std::env::set_var("TMDB_BASE_URL", server.uri());
        std::env::remove_var("TMDB_API_TOKEN");
    }
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (st, _) = get(&app, "/api/films/recent").await;
    assert_eq!(st, StatusCode::OK);
    assert!(server.received_requests().await.unwrap().is_empty(), "沒 token 應該在送出前就放棄");
}

// ── favorites 讀 ──────────────────────────────────────────────────────────

async fn seed_favorites(pool: &sqlx::SqlitePool) {
    for sql in [
        "INSERT INTO watch_favorites (id, tmdb_id, kind, rating, quote, poster_url, year, sort_order) \
         VALUES (1, 603, 'film', 5, '很喜歡', 'https://db-snapshot/p.jpg', 1999, 0)",
        "INSERT INTO watch_favorites (id, tmdb_id, kind, rating, quote, sort_order) \
         VALUES (2, 1396, 'tv', 4, '第二部', 1)",
    ] {
        sqlx::query(sql).execute(pool).await.unwrap();
    }
}

#[tokio::test]
async fn favorites_用_tmdb_的在地化標題並帶_no_store() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tmdb_movie_body()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/3/tv/1396"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 1396, "name": "絕命毒師", "poster_path": "/bb.jpg", "first_air_date": "2008-01-20",
            "episode_run_time": [49],
        })))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;

    let (st, headers, body) = request_full(&app, "GET", "/api/watch/favorites", None, None).await;
    assert_eq!(st, StatusCode::OK);
    // 這支會即時打 TMDb，快取住就等於在地化失效——所以刻意 no-store
    assert_eq!(headers.get("Cache-Control").unwrap(), "no-store");
    let f = body["favorites"].as_array().unwrap();
    assert_eq!(f.len(), 2);
    assert_eq!(f[0]["title"], "駭客任務", "movie 走 title 欄");
    assert_eq!(f[0]["poster"], "https://image.tmdb.org/t/p/w342/poster.jpg", "TMDb 的優先於 DB 快照");
    assert_eq!(f[0]["year"], 1999);
    assert_eq!(f[0]["externalUrl"], "https://www.themoviedb.org/movie/603");
    assert_eq!(f[1]["title"], "絕命毒師", "tv 沒有 title、要 fallback 到 name");
    assert_eq!(f[1]["year"], 2008, "tv 沒有 release_date、year 要走 first_air_date");
    assert_eq!(f[1]["externalUrl"], "https://www.themoviedb.org/tv/1396");
}

#[tokio::test]
async fn tmdb_的日期欄位是空字串時要退到另一個欄位而不是當成有值() {
    // `cargo mutants` 指出來的洞：`first_air_date` 那條的 `!s.is_empty()` 拿掉之後
    // 測試全綠。空字串在 TMDb 是「未定檔」的常見表示，不是缺欄位。
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/tv/1396"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 1396, "name": "有片名沒日期", "release_date": "", "first_air_date": "",
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 603, "title": "", "name": "退到 name 的片名", "release_date": "", "first_air_date": "2011-06-02",
        })))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;

    let (st, body) = get(&app, "/api/watch/favorites").await;
    assert_eq!(st, StatusCode::OK);
    let f = body["favorites"].as_array().unwrap();
    // movie：title 是空字串 → 要退到 name；release_date 空 → 退到 first_air_date
    assert_eq!(f[0]["title"], "退到 name 的片名", "空字串的 title 不算有值");
    assert_eq!(f[0]["year"], 2011);
    // tv：兩個日期都空 → year 為 null，但 DB 快照也沒有 → null（不是 0）
    assert_eq!(f[1]["title"], "有片名沒日期");
    assert_eq!(f[1]["year"], Value::Null, "兩個日期都空要回 null，不是 0");
}

#[tokio::test]
async fn favorites_在_tmdb_查不到時退回_db_快照() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/3/(movie|tv)/\d+$"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;

    let (st, body) = get(&app, "/api/watch/favorites").await;
    assert_eq!(st, StatusCode::OK);
    let f = body["favorites"].as_array().unwrap();
    // 第一列 DB 有存 poster_url / year → 用得上
    assert_eq!(f[0]["poster"], "https://db-snapshot/p.jpg");
    assert_eq!(f[0]["year"], 1999);
    assert_eq!(f[0]["title"], "#603", "連標題都沒有時退成 #<tmdbId>，不是空字串");
    // 第二列 DB 也沒有快照 → 全空，但列還在
    assert_eq!(f[1]["poster"], Value::Null);
    assert_eq!(f[1]["title"], "#1396");
    assert_eq!(f[1]["quote"], "第二部", "DB 自己的欄位不受 TMDb 影響");
}

#[tokio::test]
async fn favorites_的_locale_只接受五個合法值_其餘退回_zh_tw() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tmdb_movie_body()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/3/tv/1396"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;

    let (st, _) = get(&app, "/api/watch/favorites?locale=ja").await;
    assert_eq!(st, StatusCode::OK);
    let (st, _) = get(&app, "/api/watch/favorites?locale=de").await;
    assert_eq!(st, StatusCode::OK);

    let reqs = server.received_requests().await.unwrap();
    let langs: Vec<String> = reqs
        .iter()
        .filter(|r| r.url.path() == "/3/movie/603")
        .map(|r| r.url.query_pairs().find(|(k, _)| k == "language").unwrap().1.into_owned())
        .collect();
    assert_eq!(langs, vec!["ja-JP", "zh-TW"], "ja 要映射成 ja-JP；de 不合法 → 退 zh-TW，不能原樣送出去");
}

// ── favorites 寫（requireAdmin）────────────────────────────────────────────

#[tokio::test]
async fn favorites_的三支寫入端點沒帶_token_一律_401() {
    let (app, _pool) = test_app().await;
    let cases = [
        ("POST", "/api/watch/favorites", Some(json!({ "tmdbId": 1 }))),
        ("PUT", "/api/watch/favorites/1", Some(json!({ "rating": 3 }))),
        ("DELETE", "/api/watch/favorites/1", None),
    ];
    for (m, p, b) in cases {
        let (st, _) = request(&app, m, p, b, None).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "{m} {p}");
    }
}

#[tokio::test]
async fn create_favorite_沒有_tmdbid_就_400() {
    let (app, _pool) = test_app().await;
    let t = owner_token(true);
    for body in [json!({}), json!({ "tmdbId": null }), json!({ "tmdbId": 0 }), json!({ "tmdbId": "" })] {
        let (st, v) = request(&app, "POST", "/api/watch/favorites", Some(body.clone()), Some(&t)).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(v["error"], "tmdbId 必填");
    }
}

#[tokio::test]
async fn create_favorite_寫入時順便存下_tmdb_快照並遞增排序() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/movie/603"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tmdb_movie_body()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/3/tv/1396"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let (app, pool) = test_app().await;
    let t = owner_token(true);

    let (st, v) =
        request(&app, "POST", "/api/watch/favorites", Some(json!({ "tmdbId": 603 })), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let id1 = v["id"].as_i64().unwrap();
    let (st, v) = request(
        &app,
        "POST",
        "/api/watch/favorites",
        Some(json!({ "tmdbId": 1396, "kind": "tv" })),
        Some(&t),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    let id2 = v["id"].as_i64().unwrap();

    let rows = sqlx::query_as::<_, (i64, String, Option<i64>, Option<String>, Option<i64>, i64)>(
        "SELECT id, kind, rating, poster_url, year, sort_order FROM watch_favorites ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, id1);
    assert_eq!(rows[0].1, "film", "沒給 kind 預設 film");
    assert_eq!(rows[0].2, Some(5), "沒給 rating 預設 5");
    assert_eq!(
        rows[0].3.as_deref(),
        Some("https://image.tmdb.org/t/p/w342/poster.jpg"),
        "存 TMDb 快照當 fallback"
    );
    assert_eq!(rows[0].4, Some(1999));
    assert_eq!(rows[0].5, 0, "第一筆 sort_order 從 0 起算");
    assert_eq!(rows[1].0, id2);
    assert_eq!(rows[1].1, "tv");
    assert_eq!(rows[1].5, 1, "第二筆要 +1，不是也放 0");
    assert_eq!(rows[1].3, None, "TMDb 查不到就不寫快照");
}

#[tokio::test]
async fn create_favorite_的_rating_夾在一到五_quote_截到_280() {
    let _server = mock_tmdb().await; // 不掛任何 route → TMDb 一律 404，專心看 DB 寫了什麼
    let (app, pool) = test_app().await;
    let t = owner_token(true);
    let long = "字".repeat(400);

    let body = json!({ "tmdbId": 1, "rating": 99, "quote": long });
    let (st, _) = request(&app, "POST", "/api/watch/favorites", Some(body), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    // rating 欄位是 INTEGER affinity：clamp_rating 給的 5.0 進 SQLite 會落成整數
    let (rating, quote) =
        sqlx::query_as::<_, (Option<i64>, String)>("SELECT rating, quote FROM watch_favorites WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rating, Some(5));
    assert_eq!(quote.chars().count(), 280, "超過 280 要截斷（且是按字元不是按 byte）");

    let body = json!({ "tmdbId": 2, "rating": "not-a-number" });
    let (st, _) = request(&app, "POST", "/api/watch/favorites", Some(body), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let rating = sqlx::query_scalar::<_, Option<i64>>("SELECT rating FROM watch_favorites WHERE id = 2")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rating, None, "算不出數字要綁 NULL，不是夾成 1");
}

#[tokio::test]
async fn update_favorite_沒有可更新欄位時_400_且不動到資料() {
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;
    let t = owner_token(true);
    // null 等同沒給（`x != null`）
    for body in [json!({}), json!({ "rating": null, "quote": null }), json!({ "title": "不在白名單" })] {
        let (st, v) = request(&app, "PUT", "/api/watch/favorites/1", Some(body.clone()), Some(&t)).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(v["error"], "無可更新欄位");
    }
    let r = sqlx::query_scalar::<_, i64>("SELECT rating FROM watch_favorites WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(r, 5, "原值不該被動到");
}

#[tokio::test]
async fn update_favorite_只更新有給的欄位() {
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;
    let t = owner_token(true);

    let (st, _) =
        request(&app, "PUT", "/api/watch/favorites/1", Some(json!({ "quote": "改過的" })), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let (rating, quote, order) = sqlx::query_as::<_, (i64, String, i64)>(
        "SELECT rating, quote, sort_order FROM watch_favorites WHERE id = 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(quote, "改過的");
    assert_eq!(rating, 5, "沒給的欄位不能被清成 NULL");
    assert_eq!(order, 0);

    // rating 同樣走 clamp
    let (st, _) =
        request(&app, "PUT", "/api/watch/favorites/1", Some(json!({ "rating": -8 })), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let r = sqlx::query_scalar::<_, i64>("SELECT rating FROM watch_favorites WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(r, 1);

    // sort_order 可以單獨調（拖曳排序用）
    let (st, _) =
        request(&app, "PUT", "/api/watch/favorites/2", Some(json!({ "sort_order": 99 })), Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let o = sqlx::query_scalar::<_, i64>("SELECT sort_order FROM watch_favorites WHERE id = 2")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(o, 99);
}

#[tokio::test]
async fn delete_favorite_刪掉指定那筆_打不存在的_id_也回_200() {
    let (app, pool) = test_app().await;
    seed_favorites(&pool).await;
    let t = owner_token(true);

    let (st, _) = request(&app, "DELETE", "/api/watch/favorites/1", None, Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let ids = sqlx::query_scalar::<_, i64>("SELECT id FROM watch_favorites ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(ids, vec![2], "只刪掉指定那筆");

    // 這支刻意沒有 404（同 Express）；記在測試裡免得日後有人以為是漏寫
    let (st, _) = request(&app, "DELETE", "/api/watch/favorites/9999", None, Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
}

// ── tmdb-search（requireAdmin）─────────────────────────────────────────────

#[tokio::test]
async fn tmdb_search_沒帶_token_是_401() {
    let (app, _pool) = test_app().await;
    let (st, _) = get(&app, "/api/watch/tmdb-search?q=matrix").await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn tmdb_search_空字串直接回空陣列_不打外部() {
    let server = mock_tmdb().await;
    let (app, _pool) = test_app().await;
    let t = owner_token(true);
    for q in ["", "?q=", "?q=%20%20"] {
        let url = if q.is_empty() {
            "/api/watch/tmdb-search".to_string()
        } else {
            format!("/api/watch/tmdb-search{q}")
        };
        let (st, v) = request(&app, "GET", &url, None, Some(&t)).await;
        assert_eq!(st, StatusCode::OK, "{url}");
        assert_eq!(v["results"], json!([]));
    }
    assert!(server.received_requests().await.unwrap().is_empty(), "空查詢不該打 TMDb");
}

#[tokio::test]
async fn tmdb_search_重新塑形成前端要的五個欄位並最多回八筆() {
    let server = mock_tmdb().await;
    let mut results: Vec<Value> = (0..12)
        .map(|i| json!({ "id": 1000 + i, "title": format!("片 {i}"), "release_date": "2021-05-01", "poster_path": "/p.jpg" }))
        .collect();
    // 混一筆沒有 poster、日期為空的 → 驗 null 而不是空字串
    results[0] = json!({ "id": 999, "title": "無圖", "release_date": "", "poster_path": null });
    Mock::given(method("GET"))
        .and(path("/3/search/movie"))
        .and(query_param("query", "matrix"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "results": results })))
        .mount(&server)
        .await;
    let (app, _pool) = test_app().await;
    let t = owner_token(true);

    let (st, v) = request(&app, "GET", "/api/watch/tmdb-search?q=matrix", None, Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    let r = v["results"].as_array().unwrap();
    assert_eq!(r.len(), 8, "TMDb 回 12 筆，只取前 8");
    assert_eq!(r[0]["tmdbId"], 999);
    assert_eq!(r[0]["kind"], "movie", "kind 是回填請求的，TMDb 自己不回這欄");
    assert_eq!(r[0]["title"], "無圖");
    assert_eq!(r[0]["year"], Value::Null, "日期空字串 → year 是 null 不是 0");
    assert_eq!(r[0]["poster"], Value::Null);
    assert_eq!(r[1]["year"], 2021);
    assert_eq!(r[1]["poster"], "https://image.tmdb.org/t/p/w185/p.jpg", "搜尋清單用 w185 小圖");
}

#[tokio::test]
async fn tmdb_search_的_kind_為_tv_時打_tv_端點並讀_name() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/search/tv"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [{ "id": 1396, "name": "絕命毒師", "first_air_date": "2008-01-20" }]
        })))
        .mount(&server)
        .await;
    let (app, _pool) = test_app().await;
    let t = owner_token(true);

    let (st, v) = request(&app, "GET", "/api/watch/tmdb-search?q=breaking&kind=tv", None, Some(&t)).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["results"][0]["kind"], "tv");
    assert_eq!(v["results"][0]["title"], "絕命毒師", "tv 走 name");
    assert_eq!(v["results"][0]["year"], 2008, "tv 走 first_air_date");
}

#[tokio::test]
async fn tmdb_search_遇到非_json_回應時給_500_附錯誤訊息() {
    let server = mock_tmdb().await;
    Mock::given(method("GET"))
        .and(path("/3/search/movie"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>gateway</html>"))
        .mount(&server)
        .await;
    let (app, _pool) = test_app().await;
    let t = owner_token(true);
    let (st, v) = request(&app, "GET", "/api/watch/tmdb-search?q=x", None, Some(&t)).await;
    assert_eq!(st, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(v["error"].is_string(), "要帶得出原因，不是空 body");
}

// ── heartbeat / watch_now ─────────────────────────────────────────────────

fn hb_token() -> &'static str {
    unsafe {
        std::env::set_var("BAHAMUT_PUSH_TOKEN", "push-secret");
    }
    "push-secret"
}

/// 帶 `X-Bahamut-Token` 發 heartbeat。
async fn heartbeat(app: &axum::Router, token: &str, body: Value) -> (StatusCode, Value) {
    use axum::body::Body;
    use axum::http::{Request, header};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let req = Request::builder()
        .method("POST")
        .uri("/api/admin/watch/now")
        .header("X-Bahamut-Token", token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let st = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (st, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn heartbeat_接受推送_token_也接受_admin_jwt() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    let (st, v) = heartbeat(&app, t, json!({ "title": "測試動畫" })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["ok"], true);

    // 換成 admin JWT（不帶 X-Bahamut-Token）也要能推
    let (st, _) = request(
        &app,
        "POST",
        "/api/admin/watch/now",
        Some(json!({ "title": "A" })),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn heartbeat_的_token_錯了就退到_jwt_檢查_最後_401() {
    hb_token();
    let (app, _pool) = test_app().await;
    for bad in ["push-secre", "push-secrets", "push-secrey", ""] {
        let (st, _) = heartbeat(&app, bad, json!({ "title": "X" })).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED, "token={bad:?} 不該通過");
    }
}

#[tokio::test]
async fn heartbeat_推上去之後_watch_now_讀得到() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    let (st, _) = heartbeat(
        &app,
        t,
        json!({ "title": "葬送的芙莉蓮", "episode": "[05]", "progressPct": 42.6, "videoSn": 777 }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    let (st, v) = get(&app, "/api/watch/now").await;
    assert_eq!(st, StatusCode::OK);
    let w = &v["watching"];
    assert_eq!(w["type"], "anime");
    assert_eq!(w["title"], "葬送的芙莉蓮");
    assert_eq!(w["episode"], "[05]");
    assert_eq!(w["progressPct"], 43, "小數要 round");
    assert_eq!(w["source"], "bahamut");
    assert_eq!(w["endsAt"], Value::Null, "heartbeat 給不出結束時間");
    assert_eq!(
        w["externalUrl"], "https://ani.gamer.com.tw/animeVideo.php?sn=777",
        "沒有 tmdbId 時退回動畫瘋的網址"
    );
}

#[tokio::test]
async fn heartbeat_用_videosn_從_anime_history_補標題與封面() {
    let t = hb_token();
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    // 只給 videoSn，其餘全靠查表
    let (st, _) = heartbeat(&app, t, json!({ "videoSn": 200 })).await;
    assert_eq!(st, StatusCode::OK);

    let (_, v) = get(&app, "/api/watch/now").await;
    let w = &v["watching"];
    assert_eq!(w["title"], "葬送的芙莉蓮");
    assert_eq!(w["cover"], "https://cover/1.jpg");
    assert_eq!(w["tmdbId"], 5566);
    assert_eq!(w["episode"], "[01]", "body 沒給 episode 才用 DB 的");
    assert_eq!(w["externalUrl"], "https://www.themoviedb.org/tv/5566", "有 tmdbId 時優先給 TMDb 連結");
}

#[tokio::test]
async fn heartbeat_的_body_優先於_db_查到的_episode() {
    let t = hb_token();
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    let (st, _) = heartbeat(&app, t, json!({ "videoSn": 200, "episode": "[99]" })).await;
    assert_eq!(st, StatusCode::OK);
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"]["episode"], "[99]");
}

#[tokio::test]
async fn heartbeat_既沒標題又查不到_videosn_時_400() {
    let t = hb_token();
    let (app, pool) = test_app().await;
    seed_watch(&pool).await;
    for body in [json!({}), json!({ "videoSn": 999999 }), json!({ "title": "" }), json!({ "title": null })] {
        let (st, v) = heartbeat(&app, t, body.clone()).await;
        assert_eq!(st, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(v["ok"], false);
    }
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"], Value::Null, "失敗的 heartbeat 不該留下狀態");
}

#[tokio::test]
async fn heartbeat_同一部續播要保留_started_at() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    heartbeat(&app, t, json!({ "title": "同一部", "progressPct": 10 })).await;
    let (_, v1) = get(&app, "/api/watch/now").await;
    let started1 = v1["watching"]["startedAt"].as_i64().unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    heartbeat(&app, t, json!({ "title": "同一部", "progressPct": 20 })).await;
    let (_, v2) = get(&app, "/api/watch/now").await;
    assert_eq!(v2["watching"]["startedAt"].as_i64().unwrap(), started1, "續播不能重置 startedAt");
    assert_eq!(v2["watching"]["progressPct"], 20, "進度要更新");

    // 換一部就該重來
    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    heartbeat(&app, t, json!({ "title": "換一部" })).await;
    let (_, v3) = get(&app, "/api/watch/now").await;
    assert!(v3["watching"]["startedAt"].as_i64().unwrap() > started1, "換節目要重新計時");
}

#[tokio::test]
async fn heartbeat_的_progress_夾在零到一百() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    for (given, want) in [(json!(-5), 0), (json!(150), 100), (json!(0), 0), (json!(100), 100)] {
        heartbeat(&app, t, json!({ "title": "夾值", "progressPct": given })).await;
        let (_, v) = get(&app, "/api/watch/now").await;
        assert_eq!(v["watching"]["progressPct"], want, "given={given}");
    }
    // 非數字 → null，不是 0
    heartbeat(&app, t, json!({ "title": "夾值", "progressPct": "abc" })).await;
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"]["progressPct"], Value::Null);
}

#[tokio::test]
async fn heartbeat_的_playing_false_會清掉狀態() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    heartbeat(&app, t, json!({ "title": "播放中" })).await;
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"]["title"], "播放中");

    let (st, v) = heartbeat(&app, t, json!({ "playing": false })).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["cleared"], true);
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"], Value::Null);
}

#[tokio::test]
async fn heartbeat_的_playing_必須是嚴格_false_才算停止() {
    let t = hb_token();
    let (app, _pool) = test_app().await;
    heartbeat(&app, t, json!({ "title": "播放中" })).await;
    // JS 的 `=== false`：0 / "" / "false" 都不算
    for falsy in [json!(0), json!(""), json!("false"), json!(null)] {
        let (st, v) = heartbeat(&app, t, json!({ "playing": falsy, "title": "播放中" })).await;
        assert_eq!(st, StatusCode::OK);
        assert_eq!(v.get("cleared"), None, "playing={falsy} 不該當成停止");
    }
    let (_, v) = get(&app, "/api/watch/now").await;
    assert_eq!(v["watching"]["title"], "播放中");
}

#[tokio::test]
async fn heartbeat_設定的存活時間是九十秒() {
    // `cargo mutants` 指出來的洞：`90 * 1000` 改成 `90 + 1000`、`now + TTL` 改成 `now * TTL`
    // 都測不出來——因為所有測試都在同一瞬間讀回來，TTL 是 1 秒還是一萬年都沒差。
    // TTL 錯了的症狀是「離開播放器之後首頁一直顯示正在看」，不會有任何錯誤。
    let t = hb_token();
    let (app, _pool, state) = test_app_with_state().await;
    let before = now_ms();
    heartbeat(&app, t, json!({ "title": "計時用" })).await;
    let after = now_ms();

    let expires = state.watch.now.lock().as_ref().map(|(_, e)| *e).expect("心跳之後 state 應該有值");
    assert!(
        expires >= before + 90_000 && expires <= after + 90_000,
        "TTL 應為 90 秒；實際 expires - now = {} ms",
        expires - before
    );
}

use koimsurai_web_backend::util::now_ms;

#[tokio::test]
async fn watch_now_在沒有心跳時回_null_而不是_404() {
    let (app, _pool) = test_app().await;
    let (st, v) = get(&app, "/api/watch/now").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["watching"], Value::Null);
}

#[tokio::test]
async fn watch_now_過了_ttl_就當作沒在看() {
    use koimsurai_web_backend::handlers::watch::NowWatching;
    let (app, _pool, state) = test_app_with_state().await;
    let now = now_ms();
    let entry = NowWatching {
        kind: "anime".into(),
        title: "早就看完了".into(),
        cover: None,
        tmdb_id: None,
        episode: None,
        progress_pct: None,
        source: "bahamut".into(),
        external_url: None,
        started_at: now - 600_000,
        ends_at: None,
    };
    // 直接把過期時間塞成過去式——TTL 是 90 秒，等它自然過期的測試沒人會想跑
    *state.watch.now.lock() = Some((entry, now - 1));
    let (st, v) = get(&app, "/api/watch/now").await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["watching"], Value::Null, "過期的紀錄不該回給前端");
}

#[tokio::test]
async fn 沒設定推送_token_時只認_admin_jwt() {
    unsafe {
        std::env::remove_var("BAHAMUT_PUSH_TOKEN");
    }
    let (app, _pool) = test_app().await;
    // 任意 X-Bahamut-Token 都不該有效
    let (st, _) = heartbeat(&app, "anything", json!({ "title": "X" })).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    let (st, _) = request(
        &app,
        "POST",
        "/api/admin/watch/now",
        Some(json!({ "title": "X" })),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
}

#[tokio::test]
async fn 過期的_jwt_不能推送心跳() {
    unsafe {
        std::env::remove_var("BAHAMUT_PUSH_TOKEN");
    }
    let (app, _pool) = test_app().await;
    let now = koimsurai_web_backend::util::now_secs();
    let expired = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({ "id": 1, "username": "admin", "role": "OWNER", "iat": now - 7200, "exp": now - 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap();
    let (st, _) =
        request(&app, "POST", "/api/admin/watch/now", Some(json!({ "title": "X" })), Some(&expired)).await;
    assert_eq!(st, StatusCode::UNAUTHORIZED);
}
