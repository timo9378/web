//! watch 域：anime/films/tv/stats 公開讀、watch_favorites CRUD（TMDb 在地化）、
//! now-watching（由動畫瘋擴充的 heartbeat 推進來）。
//!
//! Trakt 相關的一切（token 輪替、即時輪詢、歷史同步 worker）已於 2026-08 移除——
//! Trakt 刪掉了免費帳號的 API app（見 handlers/simkl.rs 檔頭），那些程式從此
//! 不可能成功。留著的代價不只是死碼：`/api/watch/now` 每 25 秒仍會為此付一次
//! 連線成本（實測正式站首發 513ms，移除後 1–2ms）。
//! 觀看紀錄的來源現在是 handlers/simkl.rs。DB 裡 source='trakt' 的歷史列保留不動。
//! ⚠️ bahamut sync **留在 Express**；`/admin/bahamut/*` 留 proxy（anigamer 硬骨頭輪）。

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::FromRow;

use crate::handlers::admin::bind_num;
use crate::state::AppState;
use crate::util::{
    bind_val, js_interp, js_normalize_numbers, js_substring_prefix, js_truthy, now_ms, row_to_json,
};

// ── 公開讀端點的 typed 回應（欄位序 = SELECT 序，對齊舊 row_to_json）─────────────

/// `GET /api/anime/history` 一列。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct AnimeRow {
    #[specta(type = specta_typescript::Number)]
    pub anime_sn: i64,
    #[specta(type = specta_typescript::Number)]
    pub video_sn: i64,
    pub title: Option<String>,
    pub cover_url: Option<String>,
    pub episode: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    pub last_watched_at: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AnimeHistoryResponse {
    pub message: String,
    pub history: Vec<AnimeRow>,
}

/// `GET /api/films/recent` 一列。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct FilmRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub title: String,
    pub watched_date: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub rating: Option<i64>,
    pub source: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    pub poster_url: Option<String>,
    // DB 沒這欄（sqlx default）；films_recent 補圖時順便帶 TMDb 橫式劇照，給「最近看完」hero 用。
    #[sqlx(default)]
    pub backdrop_url: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub release_year: Option<i64>,
    pub genres: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct FilmsResponse {
    pub message: String,
    pub films: Vec<FilmRow>,
}

/// `GET /api/tv/recent` 一列（GROUP BY series_name 聚合）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct TvRow {
    pub series_name: String,
    pub last_watched: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub ep_count: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    pub poster_url: Option<String>,
    pub genres: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct TvResponse {
    pub message: String,
    pub series: Vec<TvRow>,
}

/// `GET /api/watch/stats` —— 5 個 count（key 為 camelCase）。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WatchStatsResponse {
    pub message: String,
    #[serde(rename = "animeCount")]
    #[specta(type = specta_typescript::Number)]
    pub anime_count: i64,
    #[serde(rename = "animeEpisodes")]
    #[specta(type = specta_typescript::Number)]
    pub anime_episodes: i64,
    #[serde(rename = "filmCount")]
    #[specta(type = specta_typescript::Number)]
    pub film_count: i64,
    #[serde(rename = "tvSeriesCount")]
    #[specta(type = specta_typescript::Number)]
    pub tv_series_count: i64,
    #[serde(rename = "tvEpisodes")]
    #[specta(type = specta_typescript::Number)]
    pub tv_episodes: i64,
}

/// `GET /api/watch/now` 的 `watching`。原本是 in-memory 的 serde_json::Value，
/// specta 生不出型別，前端只好手寫一份 LiveNow。
///
/// 兩個寫入點（動畫瘋擴充的 heartbeat、Trakt 輪詢）欄位集合本來就一致，
/// 各欄位的正規型別也是確定的，不是猜的：
///   episode  —— 擴充送的是 `ep ? ep[1] : null`（regex 捕獲組，必為字串）；
///               anime_history.episode 是 TEXT（anigamer SDK 已正規化成 Option<String>）；
///               Trakt 那條是 format!("S{:02}E{:02}")。三個來源都是字串。
///   tmdbId   —— anime_history.tmdb_id 是 INTEGER；Trakt 的 /ids/tmdb 是數字。
///   progressPct —— 兩條路徑都先 round 成整數才存。
///
/// ⚠ expiresAt 不在這裡：那是伺服器記帳（TTL），不是 API 資料。
/// 舊寫法把它塞進同一個 JSON、serve 時再 remove("expiresAt")，靠「記得移除」維持正確；
/// 現在改由 WatchState 以 (NowWatching, expires_at_ms) 分開存，型別上就不可能洩漏。
#[derive(Debug, Clone, Serialize, specta::Type, utoipa::ToSchema)]
pub struct NowWatching {
    /// 目前只會是 "anime"——唯一的產生者是 bahamut 的 heartbeat。
    /// 舊資料裡還有 "movie" / "tv"（Trakt 時期），型別因此保持字串不收窄。
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub cover: Option<String>,
    #[serde(rename = "tmdbId")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    pub episode: Option<String>,
    #[serde(rename = "progressPct")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub progress_pct: Option<i64>,
    /// 目前只會是 "bahamut"（Trakt 輪詢已移除）。歷史列仍可能是 "trakt"。
    pub source: String,
    #[serde(rename = "externalUrl")]
    pub external_url: Option<String>,
    /// epoch ms；與 endsAt 一起給前端做 client 端進度插值
    #[serde(rename = "startedAt")]
    #[specta(type = specta_typescript::Number)]
    pub started_at: i64,
    /// bahamut 的 heartbeat 給不出結束時間，所以目前恆為 None（Trakt 那條已移除）
    #[serde(rename = "endsAt")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub ends_at: Option<i64>,
}

/// `GET /api/watch/now`
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WatchNowResponse {
    pub watching: Option<NowWatching>,
}

/// `GET /api/watch/favorites` 的一列：DB 的 watch_favorites + TMDb 即時在地化。
/// year 兩個來源都是整數（TMDb 那條走 js_parse_int_opt、DB 欄位是 INTEGER），
/// 所以不是前端手寫版本猜的 string | number。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WatchFavoriteRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    /// "film" | "tv"
    pub kind: String,
    #[serde(rename = "tmdbId")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub rating: Option<i64>,
    pub quote: Option<String>,
    /// TMDb 在地化標題；查不到時退成 `#<tmdbId>`，所以一定有值
    pub title: String,
    pub poster: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub year: Option<i64>,
    #[serde(rename = "externalUrl")]
    pub external_url: String,
}

/// `GET /api/watch/favorites`
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WatchFavoritesResponse {
    pub message: String,
    pub favorites: Vec<WatchFavoriteRow>,
}

// ── 公開讀 ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LimitQuery {
    limit: Option<String>,
}

/// `parseInt(limit||default)` 後 `Math.min(cap)`。
///
/// 解不出數字時回 **-1**（SQLite：LIMIT 為負＝沒有上限），不是 NULL。
/// 原本綁的是 `Option::<i64>::None`，註解寫「LIMIT NULL=無限制」——那是錯的：
/// SQLite 對 `LIMIT NULL` 直接回 `(code: 20) datatype mismatch`，於是
/// `GET /api/films/recent?limit=abc` 這種**公開、免認證**的請求就是 500。
/// 三支 watch 端點都中。（schemathesis 從 spec 自動生輸入時撞出來的）
fn js_limit(q: &LimitQuery, default: &str, cap: i64) -> i64 {
    let raw = q.limit.as_deref().filter(|s| !s.is_empty()).unwrap_or(default);
    crate::util::js_parse_int_opt(raw).map_or(-1, |n| n.min(cap))
}

/// `GET /api/anime/history`
#[utoipa::path(
    get, path = "/api/anime/history", tag = "watch",
    params(("limit" = Option<String>, Query, description = "筆數上限")),
    responses((status = 200, body = AnimeHistoryResponse)),
)]
pub async fn anime_history(State(state): State<AppState>, Query(q): Query<LimitQuery>) -> Response {
    let mut query = sqlx::query_as::<_, AnimeRow>(
        "SELECT anime_sn, video_sn, title, cover_url, episode, tmdb_id, last_watched_at \
         FROM anime_history ORDER BY last_watched_at DESC LIMIT ?",
    );
    query = query.bind(js_limit(&q, "50", 2000));
    match query.fetch_all(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(history) => Json(AnimeHistoryResponse { message: "success".into(), history }).into_response(),
    }
}

/// `GET /api/films/recent`
#[utoipa::path(
    get, path = "/api/films/recent", tag = "watch",
    params(("limit" = Option<String>, Query, description = "筆數上限")),
    responses((status = 200, body = FilmsResponse)),
)]
pub async fn films_recent(State(state): State<AppState>, Query(q): Query<LimitQuery>) -> Response {
    let mut query = sqlx::query_as::<_, FilmRow>(
        "SELECT id, title, watched_date, rating, source, tmdb_id, poster_url, release_year, genres \
         FROM film_history ORDER BY watched_date DESC NULLS LAST, id DESC LIMIT ?",
    );
    query = query.bind(js_limit(&q, "50", 200));
    match query.fetch_all(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(mut films) => {
            // Trakt 同步進來的 film 沒存 poster_url（sync 只寫 title/date/tmdb_id）→ 用 tmdb_id
            // 從 TMDb 補海報（w342 小卡夠；tmdb_detail 有快取，只有缺圖的才打）。
            for f in &mut films {
                if f.poster_url.as_deref().unwrap_or("").is_empty()
                    && let Some(id) = f.tmdb_id
                    && let Some(dd) = tmdb_detail(&state, "movie", &Value::from(id), "zh-TW").await
                {
                    let get = |k: &str| dd.get(k).and_then(|v| v.as_str().map(String::from));
                    f.poster_url = get("poster_url"); // w342 給小卡
                    f.backdrop_url = get("backdrop_url"); // 橫式原圖給「最近看完」hero
                }
            }
            Json(FilmsResponse { message: "success".into(), films }).into_response()
        }
    }
}

/// `GET /api/tv/recent`
#[utoipa::path(
    get, path = "/api/tv/recent", tag = "watch",
    params(("limit" = Option<String>, Query, description = "筆數上限")),
    responses((status = 200, body = TvResponse)),
)]
pub async fn tv_recent(State(state): State<AppState>, Query(q): Query<LimitQuery>) -> Response {
    let mut query = sqlx::query_as::<_, TvRow>(
        "SELECT series_name, MAX(watched_date) AS last_watched, COUNT(*) AS ep_count, \
                MAX(tmdb_id) AS tmdb_id, MAX(poster_url) AS poster_url, MAX(genres) AS genres, MAX(source) AS source \
         FROM tv_history GROUP BY series_name ORDER BY last_watched DESC NULLS LAST LIMIT ?",
    );
    query = query.bind(js_limit(&q, "50", 200));
    match query.fetch_all(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(series) => Json(TvResponse { message: "success".into(), series }).into_response(),
    }
}

/// `GET /api/watch/stats` —— 5 個 count（單一 count 失敗 → 0，照抄）。
#[utoipa::path(get, path = "/api/watch/stats", tag = "watch", responses((status = 200, body = WatchStatsResponse)))]
pub async fn watch_stats(State(state): State<AppState>) -> Response {
    let count = |sql: &'static str| {
        let pool = state.pool.clone();
        async move { sqlx::query_scalar::<_, i64>(sql).fetch_one(&pool).await.unwrap_or(0) }
    };
    let (anime_count, anime_episodes, film_count, tv_series_count, tv_episodes) = tokio::join!(
        count("SELECT COUNT(DISTINCT anime_sn) AS n FROM anime_history"),
        count("SELECT COUNT(*) AS n FROM anime_history"),
        count("SELECT COUNT(*) AS n FROM film_history"),
        count("SELECT COUNT(DISTINCT series_name) AS n FROM tv_history"),
        count("SELECT COUNT(*) AS n FROM tv_history")
    );
    Json(WatchStatsResponse {
        message: "success".into(),
        anime_count,
        anime_episodes,
        film_count,
        tv_series_count,
        tv_episodes,
    })
    .into_response()
}

// ── TMDb detail（含 in-process 快取，無 TTL＝同 Express）────────────────────

fn tmdb_lang(locale: &str) -> Option<&'static str> {
    match locale {
        "zh-TW" => Some("zh-TW"),
        "zh-CN" => Some("zh-CN"),
        "en" => Some("en-US"),
        "ja" => Some("ja-JP"),
        "ko" => Some("ko-KR"),
        _ => None,
    }
}

async fn tmdb_detail(state: &AppState, kind: &str, id: &Value, locale: &str) -> Option<Value> {
    let lang = tmdb_lang(locale).unwrap_or("zh-TW");
    let id_s = js_interp(id);
    let key = format!("{kind}:{id_s}:{lang}");
    if let Some(v) = state.watch.tmdb_detail.lock().get(&key) {
        return Some(v.clone());
    }
    let token = std::env::var("TMDB_API_TOKEN").ok().filter(|s| !s.is_empty())?;
    let path = if kind == "tv" { "tv" } else { "movie" };
    let resp = state
        .http
        .get(format!("{}/3/{path}/{id_s}?language={lang}", crate::util::tmdb_api()))
        .bearer_auth(&token)
        .header("accept", "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let mut j: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    js_normalize_numbers(&mut j);
    let title = j
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| j.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or("");
    let poster = j
        .get("poster_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map_or(Value::Null, |p| Value::from(format!("https://image.tmdb.org/t/p/w342{p}")));
    // backdrop = 橫式劇照（給「正在看」橫幅 hero 用；poster 是直式、放橫幅會被切到剩中間）。
    let backdrop = j
        .get("backdrop_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map_or(Value::Null, |p| Value::from(format!("https://image.tmdb.org/t/p/original{p}")));
    let date = j
        .get("release_date")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| j.get("first_air_date").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or("");
    let year = crate::util::js_parse_int_opt(&date.chars().take(4).collect::<String>())
        .filter(|&y| y != 0)
        .map_or(Value::Null, Value::from);
    // runtime（分鐘）曾經算在這裡，唯一的讀者是 Trakt 那條「用 duration 推 endsAt」的路徑。
    // Trakt 移除後就沒有人讀它了——`cargo mutants` 是這樣抓到的：把 `r > 0` 改成 `r >= 0`、
    // `r < 0`、`r == 0` 測試全綠，因為那個值根本不會被任何斷言看到。一併刪掉。
    let out = json!({ "title": title, "poster_url": poster, "backdrop_url": backdrop, "year": year });
    state.watch.tmdb_detail.lock().insert(key, out.clone());
    Some(out)
}

// ── watch_favorites ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct FavQuery {
    locale: Option<String>,
}

/// `GET /api/watch/favorites?locale=` —— 公開；TMDb 即時在地化、失敗退 DB 快照；Cache-Control: no-store。
#[utoipa::path(get, path = "/api/watch/favorites", tag = "watch",
    responses((status = 200, description = "收藏影視清單（TMDb 在地化，動態 JSON）")))]
pub async fn favorites(State(state): State<AppState>, Query(q): Query<FavQuery>) -> Response {
    let locale = q.locale.as_deref().filter(|l| tmdb_lang(l).is_some()).unwrap_or("zh-TW").to_string();
    let rows = match sqlx::query("SELECT * FROM watch_favorites ORDER BY sort_order ASC, id ASC")
        .fetch_all(&state.pool)
        .await
    {
        Ok(r) => r,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let mut out = Vec::new();
    for row in &rows {
        let f = row_to_json(row);
        let kind = f.get("kind").and_then(|v| v.as_str()).unwrap_or("film").to_string();
        let tmdb_id = f.get("tmdb_id").cloned().unwrap_or(Value::Null);
        let d = tmdb_detail(&state, &kind, &tmdb_id, &locale).await;
        let title = d
            .as_ref()
            .and_then(|x| x.get("title"))
            .filter(|v| js_truthy(Some(v)))
            .cloned()
            .unwrap_or_else(|| Value::from(format!("#{}", js_interp(&tmdb_id))));
        let poster = d
            .as_ref()
            .and_then(|x| x.get("poster_url"))
            .filter(|v| js_truthy(Some(v)))
            .cloned()
            .or_else(|| f.get("poster_url").filter(|v| js_truthy(Some(v))).cloned())
            .unwrap_or(Value::Null);
        let year = d
            .as_ref()
            .and_then(|x| x.get("year"))
            .filter(|v| js_truthy(Some(v)))
            .cloned()
            .or_else(|| f.get("year").filter(|v| js_truthy(Some(v))).cloned())
            .unwrap_or(Value::Null);
        let ext = format!(
            "https://www.themoviedb.org/{}/{}",
            if kind == "tv" { "tv" } else { "movie" },
            js_interp(&tmdb_id)
        );
        out.push(WatchFavoriteRow {
            id: f.get("id").and_then(serde_json::Value::as_i64).unwrap_or(0),
            kind,
            tmdb_id: tmdb_id.as_i64(),
            rating: f.get("rating").and_then(serde_json::Value::as_i64),
            quote: f.get("quote").and_then(|v| v.as_str()).map(str::to_owned),
            title: js_interp(&title),
            poster: poster.as_str().map(str::to_owned),
            year: year.as_i64(),
            external_url: ext,
        });
    }
    let mut resp = Json(WatchFavoritesResponse { message: "success".into(), favorites: out }).into_response();
    resp.headers_mut().insert("Cache-Control", axum::http::HeaderValue::from_static("no-store"));
    resp
}

#[derive(Debug, Deserialize)]
pub struct TmdbSearchQuery {
    q: Option<String>,
    kind: Option<String>,
}

/// `GET /api/watch/tmdb-search` 的一列。TMDb 的搜尋回應在這裡重新塑形成前端真正要的
/// 五個欄位（同 spotify 的做法），不是原樣轉發——所以型別就是我們自己的，不是 TMDb 的。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct TmdbSearchResult {
    #[serde(rename = "tmdbId")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub tmdb_id: Option<i64>,
    /// 回填請求的 kind（"movie" | "tv"）；TMDb 的 search 端點自己不回這欄
    pub kind: &'static str,
    /// movie 走 `title`、tv 走 `name`，兩個都沒有才 null
    pub title: Option<String>,
    /// release_date / first_air_date 的前 4 碼
    #[specta(type = Option<specta_typescript::Number>)]
    pub year: Option<i64>,
    pub poster: Option<String>,
}

/// `GET /api/watch/tmdb-search`
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct TmdbSearchResponse {
    pub message: &'static str,
    pub results: Vec<TmdbSearchResult>,
}

/// `GET /api/watch/tmdb-search`（requireAdmin）。
#[utoipa::path(get, path = "/api/watch/tmdb-search", tag = "watch", security(("bearer" = [])),
    responses((status = 200, body = TmdbSearchResponse), (status = 401, description = "未授權")))]
pub async fn tmdb_search(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(qq): Query<TmdbSearchQuery>,
) -> Response {
    if let Err(e) = crate::auth::require_admin(&headers, &state).await {
        return e.into_response();
    }
    let q = qq.q.unwrap_or_default().trim().to_string();
    let kind = if qq.kind.as_deref() == Some("tv") { "tv" } else { "movie" };
    if q.is_empty() {
        return Json(TmdbSearchResponse { message: "success", results: vec![] }).into_response();
    }
    let Some(token) = std::env::var("TMDB_API_TOKEN").ok().filter(|s| !s.is_empty()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "TMDB_API_TOKEN 未設定" })))
            .into_response();
    };
    let r: Result<Value, String> = async {
        let resp = state
            .http
            .get(format!(
                "{}/3/search/{kind}?query={}&language=zh-TW&include_adult=false",
                crate::util::tmdb_api(),
                crate::util::encode_uri_component(&q)
            ))
            .bearer_auth(&token)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        // Express 不看狀態碼、直接 parse（parse 失敗 → catch）
        let mut v: Value = serde_json::from_str(&resp.text().await.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        js_normalize_numbers(&mut v);
        Ok(v)
    }
    .await;
    match r {
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
        Ok(j) => {
            let results: Vec<TmdbSearchResult> = j
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .take(8)
                        .map(|it| {
                            let title = it
                                .get("title")
                                .filter(|v| js_truthy(Some(v)))
                                .or_else(|| it.get("name"))
                                .and_then(|v| v.as_str())
                                .map(String::from);
                            let date = it
                                .get("release_date")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                                .or_else(|| {
                                    it.get("first_air_date")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                })
                                .unwrap_or("");
                            let year =
                                crate::util::js_parse_int_opt(&date.chars().take(4).collect::<String>())
                                    .filter(|&y| y != 0);
                            let poster = it
                                .get("poster_path")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                                .map(|p| format!("https://image.tmdb.org/t/p/w185{p}"));
                            TmdbSearchResult {
                                tmdb_id: it.get("id").and_then(serde_json::Value::as_i64),
                                kind,
                                title,
                                year,
                                poster,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            Json(TmdbSearchResponse { message: "success", results }).into_response()
        }
    }
}

/// JS ToNumber + Math.max(1, Math.min(5, x))（NaN 傳染 → 綁 NULL）。
fn clamp_rating(v: &Value) -> Option<f64> {
    let n = match v {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(x) => x.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) }
        }
        _ => f64::NAN,
    };
    if n.is_nan() { None } else { Some(n.clamp(1.0, 5.0)) }
}

/// `POST /api/watch/favorites`（requireAdmin）。
#[utoipa::path(post, path = "/api/watch/favorites", tag = "watch", security(("bearer" = [])),
    responses((status = 200, description = "新增收藏（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn create_favorite(
    State(state): State<AppState>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(b): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    if !js_truthy(b.get("tmdbId")) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "tmdbId 必填" }))).into_response();
    }
    let tmdb_id = b.get("tmdbId").cloned().unwrap_or(Value::Null);
    let kind = if b.get("kind").and_then(|v| v.as_str()) == Some("tv") { "tv" } else { "film" };
    let rating_v =
        if b.contains_key("rating") { b.get("rating").cloned().unwrap_or(Value::Null) } else { json!(5) };
    let quote_v =
        if b.contains_key("quote") { b.get("quote").cloned().unwrap_or(Value::Null) } else { json!("") };
    let d = tmdb_detail(&state, kind, &tmdb_id, "zh-TW").await;

    let max_order = sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(sort_order) AS m FROM watch_favorites")
        .fetch_one(&state.pool)
        .await
        .ok()
        .flatten();
    let order = max_order.unwrap_or(-1) + 1;

    let mut q = sqlx::query(
        "INSERT INTO watch_favorites (tmdb_id, kind, rating, quote, poster_url, year, sort_order) VALUES (?,?,?,?,?,?,?)",
    );
    q = bind_val(q, Some(&tmdb_id));
    q = q.bind(kind);
    q = bind_num(q, clamp_rating(&rating_v));
    q = q.bind(js_substring_prefix(&js_interp(&quote_v), 280));
    q = bind_val(q, d.as_ref().and_then(|x| x.get("poster_url")).filter(|v| js_truthy(Some(v))));
    q = bind_val(q, d.as_ref().and_then(|x| x.get("year")).filter(|v| js_truthy(Some(v))));
    q = q.bind(order);
    match q.execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(r) => Json(json!({ "message": "success", "id": r.last_insert_rowid() })).into_response(),
    }
}

/// `PUT /api/watch/favorites/:id`（requireAdmin）—— rating/quote/sort_order 選擇性更新；無 404。
#[utoipa::path(put, path = "/api/watch/favorites/{id}", tag = "watch", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "更新收藏（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn update_favorite(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(b): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    // `x != null`：排除 null 與缺 key
    let has = |k: &str| b.get(k).is_some_and(|v| !v.is_null());
    let mut sets: Vec<&str> = Vec::new();
    if has("rating") {
        sets.push("rating = ?");
    }
    if has("quote") {
        sets.push("quote = ?");
    }
    if has("sort_order") {
        sets.push("sort_order = ?");
    }
    if sets.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "無可更新欄位" }))).into_response();
    }
    let sql = format!("UPDATE watch_favorites SET {} WHERE id = ?", sets.join(", "));
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()));
    if has("rating") {
        q = bind_num(q, clamp_rating(b.get("rating").unwrap_or(&Value::Null)));
    }
    if has("quote") {
        q = q.bind(js_substring_prefix(&js_interp(b.get("quote").unwrap_or(&Value::Null)), 280));
    }
    if has("sort_order") {
        q = bind_val(q, b.get("sort_order"));
    }
    q = q.bind(&id);
    match q.execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
    }
}

/// `DELETE /api/watch/favorites/:id`（requireAdmin）—— 無 404。
#[utoipa::path(delete, path = "/api/watch/favorites/{id}", tag = "watch", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "刪除收藏（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn delete_favorite(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = crate::auth::require_admin(&headers, &state).await {
        return e.into_response();
    }
    match sqlx::query("DELETE FROM watch_favorites WHERE id = ?").bind(&id).execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
    }
}

// ── now-watching（唯一來源＝bahamut heartbeat push）────────────────────────

const NOW_WATCHING_TTL_MS: i64 = 90 * 1000;

/// timingSafeEqual（長度不同直接 false，同 Express 先比長度）。
fn timing_safe_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut d = 0u8;
    for (x, y) in a.iter().zip(b) {
        d |= x ^ y;
    }
    d == 0
}

/// bahamutPushAuth：X-Bahamut-Token（constant-time）或 admin JWT。
///
/// ⚠️ `Err` 裝 `Box<Response>`，理由同 `handlers/bahamut.rs` 的 `push_auth`：
/// rust 1.98 起 clippy 的 `result_large_err` 會咬 128 bytes 的 `axum::Response`。
async fn bahamut_push_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Box<Response>> {
    if let Ok(token) = std::env::var("BAHAMUT_PUSH_TOKEN")
        && !token.is_empty()
    {
        let got = headers.get("X-Bahamut-Token").and_then(|v| v.to_str().ok()).unwrap_or("");
        if timing_safe_eq(got.as_bytes(), token.as_bytes()) {
            return Ok(());
        }
    }
    crate::auth::require_admin(headers, state).await.map(|_| ()).map_err(|e| Box::new(e.into_response()))
}

/// TTL 的邊界判定，抽出來只為了讓它可測：夾在 `now_ms()` 裡面的話，`<` 與 `<=` 的差別
/// 是「剛好那一毫秒」，任何測試都碰不到，於是這個比較符號可以隨便改而沒有人會知道。
/// 語意是半開區間 `[started, expires)`——`expires_at` 當下那一刻已經算過期。
const fn is_live(now: i64, expires_at: i64) -> bool {
    now < expires_at
}

fn current_now_watching(state: &AppState) -> Option<NowWatching> {
    let g = state.watch.now.lock();
    g.as_ref().filter(|(_, expires_at)| is_live(now_ms(), *expires_at)).map(|(w, _)| w.clone())
}

fn tmdb_url_for(kind: &str, id: &Value) -> Value {
    if !js_truthy(Some(id)) {
        return Value::Null;
    }
    Value::from(format!(
        "https://www.themoviedb.org/{}/{}",
        if kind == "movie" { "movie" } else { "tv" },
        js_interp(id)
    ))
}

/// `POST /api/admin/watch/now`（bahamutPushAuth）—— 動畫瘋擴充 heartbeat。
#[utoipa::path(post, path = "/api/admin/watch/now", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "動畫瘋 heartbeat（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    crate::error::JsonBody(b): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    if let Err(resp) = bahamut_push_auth(&headers, &state).await {
        return *resp;
    }
    // playing === false（嚴格 boolean）→ 只清 bahamut 那條
    if b.get("playing") == Some(&Value::Bool(false)) {
        {
            let mut g = state.watch.now.lock();
            if g.as_ref().is_some_and(|(w, _)| w.source == "bahamut") {
                *g = None;
            }
        }
        return Json(json!({ "ok": true, "cleared": true })).into_response();
    }
    let mut title = b.get("title").filter(|v| js_truthy(Some(v))).cloned();
    let mut cover: Value = Value::Null;
    let mut tmdb_id: Value = Value::Null;
    let mut episode = b.get("episode").filter(|v| js_truthy(Some(v))).cloned();

    let video_sn = b.get("videoSn").filter(|v| js_truthy(Some(v))).cloned();
    if let Some(sn) = &video_sn {
        let row = {
            let mut q = sqlx::query(
                "SELECT anime_sn, title, cover_url, tmdb_id, episode FROM anime_history WHERE video_sn = ? LIMIT 1",
            );
            q = bind_val(q, Some(sn));
            q.fetch_optional(&state.pool).await.ok().flatten()
        };
        if let Some(r) = row {
            let m = row_to_json(&r);
            if let Some(t) = m.get("title").filter(|v| js_truthy(Some(v))) {
                title = Some(t.clone());
            }
            cover = m.get("cover_url").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(Value::Null);
            tmdb_id = m.get("tmdb_id").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(Value::Null);
            if episode.is_none() {
                episode = m.get("episode").filter(|v| js_truthy(Some(v))).cloned();
            }
        }
    }
    let Some(title) = title else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "message": "need title or known videoSn" })),
        )
            .into_response();
    };
    let now = now_ms();
    let progress = b
        .get("progressPct")
        .and_then(serde_json::Value::as_f64)
        // clamp 到 0..=100 之後再 round，值域是 0..=100，i64 裝得下
        .map_or(Value::Null, |p| {
            #[allow(clippy::cast_possible_truncation, reason = "前面已 clamp 到 0..=100")]
            Value::from(p.clamp(0.0, 100.0).round() as i64)
        });
    let external = if tmdb_url_for("tv", &tmdb_id) != Value::Null {
        tmdb_url_for("tv", &tmdb_id)
    } else if let Some(sn) = &video_sn {
        Value::from(format!("https://ani.gamer.com.tw/animeVideo.php?sn={}", js_interp(sn)))
    } else {
        Value::Null
    };
    let title_s = js_interp(&title);
    // 同一部持續播放 → 保留 startedAt
    let started = {
        let g = state.watch.now.lock();
        match g.as_ref() {
            Some((w, _)) if w.source == "bahamut" && w.title == title_s => w.started_at,
            _ => now,
        }
    };
    let entry = NowWatching {
        kind: "anime".into(),
        title: title_s,
        cover: cover.as_str().map(str::to_owned),
        tmdb_id: tmdb_id.as_i64(),
        // 擴充送的 episode 必為字串（regex 捕獲組），anime_history.episode 是 TEXT；
        // 用 js_interp 保險：若哪天有數字進來也折成字串，型別不會分岔。
        episode: episode.filter(|v| js_truthy(Some(v))).map(|v| js_interp(&v)),
        progress_pct: progress.as_i64(),
        source: "bahamut".into(),
        external_url: external.as_str().map(str::to_owned),
        started_at: started,
        ends_at: None,
    };
    *state.watch.now.lock() = Some((entry, now + NOW_WATCHING_TTL_MS));
    Json(json!({ "ok": true })).into_response()
}

/// `GET /api/watch/now` —— 公開，純讀 state（由 bahamut 的 heartbeat 推進來）。
///
/// 這支原本還會「按需 + 節流輪詢 Trakt」。Trakt 在 2026-07-30 刪掉了免費帳號的
/// app（見 simkl.rs 檔頭），那支呼叫從此必定失敗——但它仍然掛在這條公開路徑上，
/// 每 25 秒就讓一位訪客付一次連線成本。實測正式站：
///
///     /api/watch/now    513, 2, 1, 1, 2, 1 ms   ← 第一次是那支死呼叫
///     /api/watch/stats  2, 1, 1, 1 ms           ← 同樣是公開讀，沒有上游
///
/// 整段移除之後這裡只剩讀記憶體。
#[utoipa::path(get, path = "/api/watch/now", tag = "watch",
    responses((status = 200, description = "目前正在看（動態 JSON）")))]
pub async fn watch_now(State(state): State<AppState>) -> Response {
    // 不再需要 remove("expiresAt")：過期時間存在 state 的另一半，本來就不在這個型別裡。
    Json(WatchNowResponse { watching: current_now_watching(&state) }).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lq(v: Option<&str>) -> LimitQuery {
        LimitQuery { limit: v.map(str::to_owned) }
    }

    #[test]
    fn js_limit_無值或空字串都走預設() {
        assert_eq!(js_limit(&lq(None), "50", 200), 50);
        // 空字串在 JS 是 `limit || default` 的 falsy 側，不是「parseInt('') → NaN」
        assert_eq!(js_limit(&lq(Some("")), "50", 200), 50);
    }

    #[test]
    fn js_limit_解不出數字時回負一而不是_null() {
        // 這條是回歸測試：綁 NULL 會讓 SQLite 回 `datatype mismatch`，
        // 於是 `/api/films/recent?limit=abc` 這種公開免認證請求變成 500。
        assert_eq!(js_limit(&lq(Some("abc")), "50", 200), -1);
        assert_eq!(js_limit(&lq(Some("  ")), "50", 200), -1);
    }

    #[test]
    fn js_limit_照抄_parse_int_的前綴語意並套上限() {
        assert_eq!(js_limit(&lq(Some("12abc")), "50", 200), 12);
        assert_eq!(js_limit(&lq(Some("999")), "50", 200), 200, "超過 cap 要被夾");
        assert_eq!(js_limit(&lq(Some("199")), "50", 200), 199, "cap 邊界內不動");
        assert_eq!(js_limit(&lq(Some("-5")), "50", 200), -5, "負數是 SQLite 的「無上限」，不夾");
    }

    #[test]
    fn tmdb_lang_五個語系各自對應_其餘回_none() {
        assert_eq!(tmdb_lang("zh-TW"), Some("zh-TW"));
        assert_eq!(tmdb_lang("zh-CN"), Some("zh-CN"));
        assert_eq!(tmdb_lang("en"), Some("en-US"));
        assert_eq!(tmdb_lang("ja"), Some("ja-JP"));
        assert_eq!(tmdb_lang("ko"), Some("ko-KR"));
        // None 這一側有意義：favorites 用它判斷 locale 合不合法，回 Some 就會把亂值送去 TMDb
        assert_eq!(tmdb_lang("de"), None);
        assert_eq!(tmdb_lang("zh"), None);
        assert_eq!(tmdb_lang(""), None);
    }

    #[test]
    fn clamp_rating_照抄_js_的_to_number_再夾到一到五() {
        assert_eq!(clamp_rating(&json!(3)), Some(3.0));
        assert_eq!(clamp_rating(&json!(7)), Some(5.0));
        assert_eq!(clamp_rating(&json!(-3)), Some(1.0));
        assert_eq!(clamp_rating(&json!(1)), Some(1.0), "下界含本身");
        assert_eq!(clamp_rating(&json!(5)), Some(5.0), "上界含本身");
        assert_eq!(clamp_rating(&Value::Null), Some(1.0), "Number(null) === 0 → 夾成 1");
        assert_eq!(clamp_rating(&json!("3.5")), Some(3.5));
        assert_eq!(clamp_rating(&json!("  4  ")), Some(4.0), "前後空白 JS 會忽略");
        assert_eq!(clamp_rating(&json!("")), Some(1.0), "Number('') === 0");
        // bool 這條分支容易被當成不可能發生而刪掉，但 JSON body 是使用者送的，
        // `{"rating": true}` 完全合法：JS 的 Number(true)===1、Number(false)===0
        assert_eq!(clamp_rating(&json!(true)), Some(1.0));
        assert_eq!(clamp_rating(&json!(false)), Some(1.0), "0 夾上來也是 1，但不能變成 NULL");
    }

    #[test]
    fn clamp_rating_算不出數字時回_none_以便綁_null() {
        // NaN 在 JS 會一路傳染到 SQL 綁值，這裡改成 None → 綁 NULL，不是夾成 1
        assert_eq!(clamp_rating(&json!("abc")), None);
        assert_eq!(clamp_rating(&json!([1, 2])), None);
        assert_eq!(clamp_rating(&json!({"a": 1})), None);
    }

    #[test]
    fn is_live_的邊界是半開區間() {
        assert!(is_live(0, 1));
        assert!(is_live(89_999, 90_000));
        assert!(!is_live(90_000, 90_000), "剛好到期那一刻算過期，不是還活著");
        assert!(!is_live(90_001, 90_000));
    }

    #[test]
    fn timing_safe_eq_長度不同直接否_同長逐位元比() {
        assert!(timing_safe_eq(b"secret", b"secret"));
        assert!(!timing_safe_eq(b"secret", b"secrets"), "長度不同");
        assert!(!timing_safe_eq(b"secret", b"secreT"), "同長但差一位元");
        assert!(!timing_safe_eq(b"", b"x"));
        assert!(timing_safe_eq(b"", b""));
    }

    #[test]
    fn tmdb_url_for_依_kind_分流_falsy_的_id_回_null() {
        assert_eq!(tmdb_url_for("movie", &json!(603)), json!("https://www.themoviedb.org/movie/603"));
        assert_eq!(tmdb_url_for("tv", &json!(1396)), json!("https://www.themoviedb.org/tv/1396"));
        // 只有 "movie" 走 movie，其餘一律 tv（含空字串這種非預期值）
        assert_eq!(tmdb_url_for("anime", &json!(7)), json!("https://www.themoviedb.org/tv/7"));
        // js_truthy：0 與 null 都是 falsy → 不要組出 /movie/0 這種連不到的網址
        assert_eq!(tmdb_url_for("movie", &Value::Null), Value::Null);
        assert_eq!(tmdb_url_for("movie", &json!(0)), Value::Null);
        assert_eq!(tmdb_url_for("movie", &json!("")), Value::Null);
    }
}
