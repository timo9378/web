//! watch 域：anime/films/tv/stats 公開讀、watch_favorites CRUD（TMDb 在地化）、
//! now-watching（heartbeat push + Trakt 按需輪詢）。
//! ⚠️ bahamut sync / Trakt 歷史同步 cron **留在 Express**（單寫者：history 表寫者=Express cron）；
//! `/admin/bahamut/*` 留 proxy（anigamer 硬骨頭輪）。

use std::sync::atomic::Ordering;

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
use crate::util::{bind_val, js_interp, js_normalize_numbers, js_substring_prefix, js_truthy, row_to_json};

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
    /// "anime"（bahamut）/ "movie" / "tv"（trakt）
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
    /// "bahamut" | "trakt"
    pub source: String,
    #[serde(rename = "externalUrl")]
    pub external_url: Option<String>,
    /// epoch ms；與 endsAt 一起給前端做 client 端進度插值
    #[serde(rename = "startedAt")]
    #[specta(type = specta_typescript::Number)]
    pub started_at: i64,
    /// 只有 Trakt 那條算得出結束時間；bahamut heartbeat 沒有
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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
            for f in films.iter_mut() {
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
        .get(format!("https://api.themoviedb.org/3/{path}/{id_s}?language={lang}"))
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
        .map(|p| Value::from(format!("https://image.tmdb.org/t/p/w342{p}")))
        .unwrap_or(Value::Null);
    // backdrop = 橫式劇照（給「正在看」橫幅 hero 用；poster 是直式、放橫幅會被切到剩中間）。
    let backdrop = j
        .get("backdrop_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|p| Value::from(format!("https://image.tmdb.org/t/p/original{p}")))
        .unwrap_or(Value::Null);
    let date = j
        .get("release_date")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| j.get("first_air_date").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or("");
    let year = crate::util::js_parse_int_opt(&date.chars().take(4).collect::<String>())
        .filter(|&y| y != 0)
        .map(Value::from)
        .unwrap_or(Value::Null);
    // runtime（分鐘）：movie 直接有 runtime；tv 用 episode_run_time[0]。給進度條算穩定 duration。
    let runtime_min = j
        .get("runtime")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            j.get("episode_run_time")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_i64())
        })
        .filter(|&r| r > 0);
    let out = json!({ "title": title, "poster_url": poster, "backdrop_url": backdrop, "year": year, "runtime_min": runtime_min });
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
            id: f.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            kind,
            tmdb_id: tmdb_id.as_i64(),
            rating: f.get("rating").and_then(|v| v.as_i64()),
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
                "https://api.themoviedb.org/3/search/{kind}?query={}&language=zh-TW&include_adult=false",
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
                                tmdb_id: it.get("id").and_then(|v| v.as_i64()),
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
        Value::Bool(b) => *b as i64 as f64,
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
    headers: HeaderMap,
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Err(e) = crate::auth::require_admin(&headers, &state).await {
        return e.into_response();
    }
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
    headers: HeaderMap,
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Err(e) = crate::auth::require_admin(&headers, &state).await {
        return e.into_response();
    }
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

// ── now-watching（heartbeat push + Trakt 按需輪詢）─────────────────────────

const NOW_WATCHING_TTL_MS: i64 = 90 * 1000;
const TRAKT_POLL_MIN_MS: i64 = 25 * 1000;
const TRAKT_UA: &str = "koimsurai/1.0 (+https://koimsurai.com)";

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
async fn bahamut_push_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Response> {
    if let Ok(token) = std::env::var("BAHAMUT_PUSH_TOKEN")
        && !token.is_empty()
    {
        let got = headers.get("X-Bahamut-Token").and_then(|v| v.to_str().ok()).unwrap_or("");
        if timing_safe_eq(got.as_bytes(), token.as_bytes()) {
            return Ok(());
        }
    }
    crate::auth::require_admin(headers, state).await.map(|_| ()).map_err(|e| e.into_response())
}

fn current_now_watching(state: &AppState) -> Option<NowWatching> {
    let g = state.watch.now.lock();
    g.as_ref().filter(|(_, expires_at)| now_ms() < *expires_at).map(|(w, _)| w.clone())
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
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Err(resp) = bahamut_push_auth(&headers, &state).await {
        return resp;
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
        .and_then(|v| v.as_f64())
        .map(|p| Value::from(p.clamp(0.0, 100.0).round() as i64))
        .unwrap_or(Value::Null);
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

// ── Trakt token / 輪詢 ────────────────────────────────────────────────────

fn trakt_token_file() -> String {
    if let Ok(p) = std::env::var("TRAKT_TOKEN_FILE")
        && !p.is_empty()
    {
        return p;
    }
    // 預設：與 DATABASE_URL 同目錄（sqlite:///path/db.sqlite → /path/.trakt-token.json）
    let url = std::env::var("DATABASE_URL").unwrap_or_default();
    let path = url.trim_start_matches("sqlite://");
    let dir = std::path::Path::new(path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
    dir.join(".trakt-token.json").to_string_lossy().to_string()
}

async fn load_trakt_token() -> Option<Value> {
    let content = tokio::fs::read_to_string(trakt_token_file()).await.ok()?;
    serde_json::from_str(&content).ok()
}

async fn save_trakt_token(tok: &Value) {
    let file = trakt_token_file();
    if tokio::fs::write(&file, serde_json::to_string_pretty(tok).unwrap_or_default()).await.is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = tokio::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).await {
                tracing::warn!("[Trakt] token 檔 chmod 600 失敗: {e}");
            }
        }
    }
}

async fn refresh_trakt_token(state: &AppState, tok: &Value) -> Option<Value> {
    let client_id = std::env::var("TRAKT_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("TRAKT_CLIENT_SECRET").unwrap_or_default();
    let body = json!({
        "refresh_token": tok.get("refresh_token").cloned().unwrap_or(Value::Null),
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
    });
    let resp = state
        .http
        .post("https://api.trakt.tv/oauth/token")
        .header("Content-Type", "application/json")
        .header("User-Agent", TRAKT_UA)
        .body(serde_json::to_string(&body).unwrap_or_default())
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let j: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    let created = j.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let expires_in = j.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(0);
    let out = json!({
        "access_token": j.get("access_token").cloned().unwrap_or(Value::Null),
        "refresh_token": j.get("refresh_token").cloned().unwrap_or(Value::Null),
        "scope": j.get("scope").cloned().unwrap_or(Value::Null),
        "expires_at": (created + expires_in) * 1000,
        "created_at": created * 1000,
    });
    save_trakt_token(&out).await;
    Some(out)
}

/// ⚠️ deviation（修 Express bug #5，非照抄）：
/// ① refresh 門檻 = min(7 天, token 壽命的一半)——Express 固定 7 天，但 Trakt 現發 7 天 token，
///    門檻 ≥ 壽命 → 每次呼叫都 refresh（一次性 refresh token 高速輪替，養大 race 面積）。
/// ② refresh 全程持 tokio Mutex 串行 + 進鎖後重讀檔——Express 無鎖，cron 與 /watch/now 併發
///    搶刷同一個一次性 refresh token，race 後 invalid_grant 永久死（live 於 2026-06-29 實際發生）。
async fn get_valid_trakt_token(state: &AppState) -> Option<Value> {
    let tok = load_trakt_token().await?;
    let expires_at = tok.get("expires_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let created_at = tok.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let lifetime = (expires_at - created_at).max(0);
    let threshold = (7 * 86_400_000i64).min(lifetime / 2);
    if now_ms() + threshold < expires_at {
        return Some(tok);
    }
    // 需要 refresh：串行化 + double-check（別的 task 可能剛刷好寫回檔案）
    let _g = state.watch.trakt_refresh_lock.lock().await;
    let tok = load_trakt_token().await?;
    let expires_at = tok.get("expires_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let created_at = tok.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
    let threshold = (7 * 86_400_000i64).min((expires_at - created_at).max(0) / 2);
    if now_ms() + threshold < expires_at {
        return Some(tok);
    }
    refresh_trakt_token(state, &tok).await
}

async fn trakt_get(state: &AppState, tok: &Value, path: &str) -> Option<Value> {
    let access = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let client_id = std::env::var("TRAKT_CLIENT_ID").unwrap_or_default();
    let resp = state
        .http
        .get(format!("https://api.trakt.tv{path}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", TRAKT_UA)
        .header("trakt-api-version", "2")
        .header("trakt-api-key", &client_id)
        .bearer_auth(access)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let mut v: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    js_normalize_numbers(&mut v);
    Some(v)
}

async fn get_trakt_slug(state: &AppState, tok: &Value) -> Option<String> {
    if let Some(s) = state.watch.trakt_slug.lock().clone() {
        return Some(s);
    }
    let data = trakt_get(state, tok, "/users/settings").await?;
    let slug = data.pointer("/user/ids/slug").and_then(|v| v.as_str()).map(String::from)?;
    *state.watch.trakt_slug.lock() = Some(slug.clone());
    Some(slug)
}

async fn poll_trakt_watching(state: &AppState) {
    state.watch.last_trakt_poll.store(now_ms(), Ordering::Relaxed);
    let Some(tok) = get_valid_trakt_token(state).await else { return };
    let Some(slug) = get_trakt_slug(state, &tok).await else { return };
    let clear_trakt = |state: &AppState| {
        let was_watching = {
            let mut g = state.watch.now.lock();
            if g.as_ref().is_some_and(|(w, _)| w.source == "trakt") {
                *g = None;
                true
            } else {
                false
            }
        };
        // 剛從「正在看」→「沒在看」= 看完了 → 立刻同步 Trakt 歷史（否則「最近看完」列表
        // 要等 6h 的 worker）。idempotent（INSERT OR IGNORE）、只在轉換當下觸發一次。
        if was_watching {
            let st = state.clone();
            tokio::spawn(async move {
                sync_trakt_history(&st).await;
            });
        }
    };
    let access = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let client_id = std::env::var("TRAKT_CLIENT_ID").unwrap_or_default();
    let resp = state
        .http
        .get(format!("https://api.trakt.tv/users/{slug}/watching"))
        .header("Content-Type", "application/json")
        .header("User-Agent", TRAKT_UA)
        .header("trakt-api-version", "2")
        .header("trakt-api-key", &client_id)
        .bearer_auth(access)
        .send()
        .await;
    let Ok(resp) = resp else { return };
    let status = resp.status();
    if status == StatusCode::NO_CONTENT || status == StatusCode::NOT_FOUND || !status.is_success() {
        clear_trakt(state);
        return;
    }
    let Ok(text) = resp.text().await else { return };
    let Ok(mut d) = serde_json::from_str::<Value>(&text) else { return };
    js_normalize_numbers(&mut d);

    let (kind, title, tmdb_id, episode): (&str, Value, Value, Value) =
        if d.get("type").and_then(|v| v.as_str()) == Some("movie")
            && d.get("movie").is_some_and(|m| !m.is_null())
        {
            (
                "movie",
                d.pointer("/movie/title").cloned().unwrap_or(Value::Null),
                d.pointer("/movie/ids/tmdb").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(Value::Null),
                Value::Null,
            )
        } else if d.get("type").and_then(|v| v.as_str()) == Some("episode")
            && d.get("show").is_some_and(|m| !m.is_null())
            && d.get("episode").is_some_and(|m| !m.is_null())
        {
            let season = d.pointer("/episode/season").and_then(|v| v.as_i64()).unwrap_or(0);
            let number = d.pointer("/episode/number").and_then(|v| v.as_i64()).unwrap_or(0);
            (
                "tv",
                d.pointer("/show/title").cloned().unwrap_or(Value::Null),
                d.pointer("/show/ids/tmdb").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(Value::Null),
                Value::from(format!("S{season:02}E{number:02}")),
            )
        } else {
            clear_trakt(state);
            return;
        };

    let now = now_ms();
    // Date.parse(ISO8601) — 用簡化 parser（Trakt 回 RFC3339）
    let started = d.get("started_at").and_then(|v| v.as_str()).and_then(parse_rfc3339_ms).unwrap_or(now);
    // tmdb_detail 一次拿 cover + runtime（快取；無 token/失敗 → None）。
    let dd = if js_truthy(Some(&tmdb_id)) { tmdb_detail(state, kind, &tmdb_id, "zh-TW").await } else { None };
    // cover：Trakt 不回海報 → 用 TMDb 圖。「正在看」是橫式 hero → 優先 backdrop（橫式劇照
    // original 解析）；沒 backdrop 才退 poster（換 original）。w342 只留給 favorites 小卡。
    let cover = dd
        .as_ref()
        .and_then(|d| d.get("backdrop_url").filter(|v| !v.is_null()).cloned())
        .or_else(|| {
            dd.as_ref()
                .and_then(|d| d.get("poster_url").and_then(|v| v.as_str()))
                .map(|s| Value::from(s.replace("/t/p/w342/", "/t/p/original/")))
        })
        .unwrap_or(Value::Null);
    // 進度**錨定 Trakt expires_at**（實測比 started_at 穩——started_at 會隨 player 重 scrobble
    // 大跳，導致看到 90% 卻顯示 30%；expires_at ≈ 真實結束時間、漂移小）+ TMDb runtime 反推 start。
    // 都有 → (expires-runtime, expires)；缺 runtime → Trakt started/expires；缺 expires → started+runtime；
    // 都缺 → 無進度。startedAt/endsAt 一起給前端做 client 端插值（本地 timer 平滑推進）。
    let trakt_expires = d.get("expires_at").and_then(|v| v.as_str()).and_then(parse_rfc3339_ms);
    let runtime_ms =
        dd.as_ref().and_then(|d| d.get("runtime_min").and_then(|v| v.as_i64())).map(|m| m * 60_000);
    let (started, ends) = match (trakt_expires, runtime_ms) {
        (Some(e), Some(r)) => (e - r, e),
        (Some(e), None) => (started, e),
        (None, Some(r)) => (started, started + r),
        (None, None) => (started, started),
    };
    let progress = if ends > started {
        let pct = ((now - started) as f64 / (ends - started) as f64 * 100.0).round();
        Value::from(pct.clamp(0.0, 100.0) as i64)
    } else {
        Value::Null
    };
    let entry = NowWatching {
        kind: kind.to_owned(),
        title: js_interp(&title),
        cover: cover.as_str().map(str::to_owned),
        tmdb_id: tmdb_id.as_i64(),
        // movie 分支給 Value::Null；episode 分支給 "S01E02"
        episode: episode.as_str().map(str::to_owned),
        progress_pct: progress.as_i64(),
        source: "trakt".into(),
        external_url: tmdb_url_for(kind, &tmdb_id).as_str().map(str::to_owned),
        started_at: started,
        ends_at: Some(ends),
    };
    *state.watch.now.lock() = Some((entry, now + NOW_WATCHING_TTL_MS));
}

/// RFC3339（`2026-07-03T12:34:56.000Z` / 帶 offset）→ epoch ms。
fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    static RFC3339_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))?$",
        )
        .unwrap()
    });
    let c = RFC3339_RE.captures(s)?;
    let g = |i: usize| c.get(i).map(|m| m.as_str().parse::<i64>().unwrap_or(0)).unwrap_or(0);
    let (y, mo, d, h, mi, sec) = (g(1), g(2), g(3), g(4), g(5), g(6));
    let ms = c.get(7).map(|m| format!("{:0<3}", m.as_str()).parse::<i64>().unwrap_or(0)).unwrap_or(0);
    // days_from_civil（Hinnant）
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let mut t = days * 86_400_000 + h * 3_600_000 + mi * 60_000 + sec * 1000 + ms;
    if let Some(sign) = c.get(8).map(|m| m.as_str()) {
        let off = (g(9) * 60 + g(10)) * 60_000;
        t += if sign == "-" { off } else { -off };
    }
    Some(t)
}

/// `GET /api/watch/now` —— 公開；bahamut push 優先，否則按需+節流輪詢 Trakt。
#[utoipa::path(get, path = "/api/watch/now", tag = "watch",
    responses((status = 200, description = "目前正在看（動態 JSON）")))]
pub async fn watch_now(State(state): State<AppState>) -> Response {
    let cur = current_now_watching(&state);
    let is_baha = cur.as_ref().is_some_and(|w| w.source == "bahamut");
    if !is_baha && now_ms() - state.watch.last_trakt_poll.load(Ordering::Relaxed) > TRAKT_POLL_MIN_MS {
        poll_trakt_watching(&state).await;
    }
    // 不再需要 remove("expiresAt")：過期時間存在 state 的另一半，本來就不在這個型別裡。
    Json(WatchNowResponse { watching: current_now_watching(&state) }).into_response()
}

// ── Trakt 歷史同步 worker（cron 遷移；ENABLE_TRAKT_SYNC=1 才啟動）─────────
// 單寫者切換：strangler 驗證期 Express cron 是 film/tv_history 寫者（此 flag 關）；
// 切換上線時 Express 設 DISABLE_WATCH_CRON=1、Rust 設 ENABLE_TRAKT_SYNC=1。

async fn trakt_get_paged(state: &AppState, tok: &Value, path: &str) -> Option<(Value, i64)> {
    let access = tok.get("access_token").and_then(|v| v.as_str()).unwrap_or("");
    let client_id = std::env::var("TRAKT_CLIENT_ID").unwrap_or_default();
    let resp = state
        .http
        .get(format!("https://api.trakt.tv{path}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", TRAKT_UA)
        .header("trakt-api-version", "2")
        .header("trakt-api-key", &client_id)
        .bearer_auth(access)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None; // Express traktGet throw → 整包中止
    }
    let pagecount = resp
        .headers()
        .get("x-pagination-page-count")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(1);
    let mut v: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    js_normalize_numbers(&mut v);
    Some((v, pagecount))
}

/// Trakt watched_at 清理：epoch 假日期（<=1970-01-02）當無日期存 NULL。
fn clean_watched_date(raw: Option<&str>) -> Option<String> {
    let d: String = raw.unwrap_or("").chars().take(10).collect();
    if d.is_empty() || d.as_str() <= "1970-01-02" { None } else { Some(d) }
}

async fn sync_trakt_history(state: &AppState) {
    let Some(tok) = get_valid_trakt_token(state).await else {
        tracing::info!("[Trakt] no token — skip sync");
        return;
    };
    tracing::info!("[Trakt] sync start");
    let mut films = 0u32;
    let mut episodes = 0u32;

    // movies
    let mut page = 1i64;
    loop {
        let Some((data, pagecount)) =
            trakt_get_paged(state, &tok, &format!("/sync/history/movies?page={page}&limit=100")).await
        else {
            tracing::error!("[Trakt] sync error (movies page {page})");
            return;
        };
        for item in data.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            let Some(m) = item.get("movie").filter(|v| !v.is_null()) else { continue };
            let watched = clean_watched_date(item.get("watched_at").and_then(|v| v.as_str()));
            let mut q = sqlx::query(
                "INSERT OR IGNORE INTO film_history (title, watched_date, source, tmdb_id, release_year) VALUES (?, ?, 'trakt', ?, ?)",
            );
            q = bind_val(q, m.get("title"));
            q = q.bind(&watched);
            q = bind_val(q, m.pointer("/ids/tmdb").filter(|v| js_truthy(Some(v))));
            q = bind_val(q, m.get("year").filter(|v| js_truthy(Some(v))));
            if let Err(e) = q.execute(&state.pool).await {
                tracing::warn!("[Trakt] upsert film_history fail: {e}");
            }
            films += 1;
        }
        if page >= pagecount {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        page += 1;
    }

    // tv episodes
    let mut page = 1i64;
    loop {
        let Some((data, pagecount)) =
            trakt_get_paged(state, &tok, &format!("/sync/history/episodes?page={page}&limit=100")).await
        else {
            tracing::error!("[Trakt] sync error (episodes page {page})");
            return;
        };
        for item in data.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            let (Some(ep), Some(show)) =
                (item.get("episode").filter(|v| !v.is_null()), item.get("show").filter(|v| !v.is_null()))
            else {
                continue;
            };
            let watched = clean_watched_date(item.get("watched_at").and_then(|v| v.as_str()));
            let season = ep.get("season").and_then(|v| v.as_i64()).unwrap_or(0);
            let number = ep.get("number").and_then(|v| v.as_i64()).unwrap_or(0);
            let label = format!("S{season:02}E{number:02}");
            let mut q = sqlx::query(
                "INSERT OR IGNORE INTO tv_history (series_name, episode_label, watched_date, source, tmdb_id) VALUES (?, ?, ?, 'trakt', ?)",
            );
            q = bind_val(q, show.get("title"));
            q = q.bind(&label);
            q = q.bind(&watched);
            q = bind_val(q, show.pointer("/ids/tmdb").filter(|v| js_truthy(Some(v))));
            if let Err(e) = q.execute(&state.pool).await {
                tracing::warn!("[Trakt] upsert tv_history fail: {e}");
            }
            episodes += 1;
        }
        if page >= pagecount {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        page += 1;
    }
    tracing::info!("[Trakt] sync done: {films} film rows, {episodes} tv ep rows scanned");
}

/// 啟動 Trakt 同步 worker（90 秒後首跑、每 6 小時一次；`TRAKT_SYNC_DELAY_SECS` 可調首跑延遲）。
pub fn spawn_trakt_sync(state: AppState) {
    let enabled = std::env::var("ENABLE_TRAKT_SYNC")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !enabled {
        tracing::info!("[Trakt] sync worker disabled (ENABLE_TRAKT_SYNC unset) — Express cron 仍為寫者");
        return;
    }
    let delay = std::env::var("TRAKT_SYNC_DELAY_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(90u64);
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        loop {
            sync_trakt_history(&state).await;
            tokio::time::sleep(std::time::Duration::from_secs(6 * 3600)).await;
        }
    });
}

#[cfg(test)]
mod trakt_refresh_lock_tests {
    use super::*;

    /// TRAKT_TOKEN_FILE 是 process 全域的。
    static TOKEN_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    /// 建一個只屬於這個測試的 token 檔，回傳 (暫存目錄, 檔案路徑)。
    fn temp_token_file(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("trakt-lock-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("token.json");
        // SAFETY: 靠 TOKEN_ENV_LOCK 串行化（呼叫端持鎖）。
        unsafe { std::env::set_var("TRAKT_TOKEN_FILE", &file) };
        (dir, file)
    }

    fn token(created_ago_ms: i64, expires_in_ms: i64, access: &str) -> Value {
        let now = now_ms();
        json!({
            "access_token": access,
            "refresh_token": format!("refresh-for-{access}"),
            "created_at": now - created_ago_ms,
            "expires_at": now + expires_in_ms,
        })
    }

    /// 這把鎖是為了一個**真的發生過**的線上事故存在的（2026-06-29）：Trakt 的
    /// refresh token 是一次性的，兩個 task 同時拿同一個去換，慢的那個換到
    /// `invalid_grant`，然後就永久死了。
    ///
    /// 修法是「串行化 + double-check」——等到鎖之後要**重讀一次檔案**，因為在排隊
    /// 期間別人可能已經刷好寫回去了。這個測試就驗那個重讀：
    /// 佔住鎖 → 放 16 個呼叫者進來排隊 → 排隊期間把新 token 寫進檔案 → 放開鎖。
    /// 每個醒來的人都應該看到新 token，而不是拿手上那份過期的去打 api.trakt.tv。
    ///
    /// 把 double-check 拿掉，這 16 個會各自呼叫 `refresh_trakt_token`——正是事故現場。
    #[tokio::test]
    async fn refresh_rereads_token_after_waiting_for_the_lock() {
        let _env = TOKEN_ENV_LOCK.lock().await;
        let (dir, file) = temp_token_file("double-check");

        // 快到期：threshold = min(7d, lifetime/2) = 50s，而只剩 1s → 必須 refresh → 會去搶鎖
        std::fs::write(&file, token(100_000, 1_000, "stale").to_string()).expect("write stale token");

        let state = crate::state::test_state().await;
        let guard = state.watch.trakt_refresh_lock.lock().await;

        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..16 {
            let st = state.clone();
            tasks.spawn(async move { get_valid_trakt_token(&st).await });
        }
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }

        // 模擬「持鎖的那一個刷好了、寫回檔案」：90 天有效 → 重讀後不需要再 refresh
        std::fs::write(&file, token(0, 90 * 86_400_000, "fresh").to_string()).expect("write fresh token");
        drop(guard);

        let mut woke = 0;
        while let Some(joined) = tasks.join_next().await {
            let tok = joined.expect("task panicked").expect("等到鎖之後應該讀得到 token");
            assert_eq!(
                tok["access_token"], "fresh",
                "沒有重讀檔案 → 拿著已經被換掉的 refresh token 去打 Trakt（invalid_grant 事故重演）"
            );
            woke += 1;
        }
        assert_eq!(woke, 16);

        // SAFETY: 見上。
        unsafe { std::env::remove_var("TRAKT_TOKEN_FILE") };
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 反向：token 還很新時要在**碰鎖之前**就回傳。
    /// 少了這個斷言，「每次都進鎖」的實作也會讓上面那個測試綠——但那會把每一次
    /// Trakt 讀取都串行化。這裡佔著鎖，所以真去搶鎖就會超時。
    #[tokio::test]
    async fn fresh_token_short_circuits_without_taking_the_lock() {
        let _env = TOKEN_ENV_LOCK.lock().await;
        let (dir, file) = temp_token_file("short-circuit");
        std::fs::write(&file, token(0, 90 * 86_400_000, "fresh").to_string()).expect("write token");

        let state = crate::state::test_state().await;
        let _guard = state.watch.trakt_refresh_lock.lock().await;

        let tok = tokio::time::timeout(std::time::Duration::from_secs(5), get_valid_trakt_token(&state))
            .await
            .expect("token 還新的時候不該去等鎖")
            .expect("應該直接回傳現有 token");
        assert_eq!(tok["access_token"], "fresh");

        // SAFETY: 見上。
        unsafe { std::env::remove_var("TRAKT_TOKEN_FILE") };
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 沒有 token 檔就是 None——不該 panic，也不該去搶鎖。
    #[tokio::test]
    async fn missing_token_file_returns_none() {
        let _env = TOKEN_ENV_LOCK.lock().await;
        let (dir, file) = temp_token_file("missing");
        let _ = std::fs::remove_file(&file);

        let state = crate::state::test_state().await;
        let _guard = state.watch.trakt_refresh_lock.lock().await;

        let got = tokio::time::timeout(std::time::Duration::from_secs(5), get_valid_trakt_token(&state))
            .await
            .expect("沒有 token 檔時不該去等鎖");
        assert!(got.is_none());

        // SAFETY: 見上。
        unsafe { std::env::remove_var("TRAKT_TOKEN_FILE") };
        let _ = std::fs::remove_dir_all(&dir);
    }
}
