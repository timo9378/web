//! Spotify 代理（token refresh 快取 + top-*/audio-features 快取與 403/429 熔斷）。
//! 狀態存 `state.spotify`（parking_lot 短臨界區，不跨 await 持鎖）。

use std::collections::HashMap;
use std::sync::atomic::Ordering;

use axum::{
    Json,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::state::AppState;
use crate::util::{js_normalize_numbers, js_truthy};

const TOP_GENRES_TTL: i64 = 6 * 60 * 60 * 1000;
const TOP_TRACKS_TTL: i64 = 60 * 60 * 1000;
const SPOTIFY_TOP_COOLDOWN: i64 = 60 * 60 * 1000;
const AUDIO_FEATURES_TTL: i64 = 24 * 60 * 60 * 1000;
const AUDIO_FEATURES_COOLDOWN: i64 = 60 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// axios 錯誤形狀：HTTP（帶上游狀態與 body）或網路/設定錯（只有 message）。
enum SpErr {
    NotConfigured,
    Http(StatusCode, Value),
    Net(String),
}

impl SpErr {
    fn status(&self) -> Option<StatusCode> {
        match self {
            SpErr::Http(s, _) => Some(*s),
            _ => None,
        }
    }
    /// `error.response?.data || error.message`
    fn details(&self) -> Value {
        match self {
            SpErr::NotConfigured => Value::from("Spotify credentials not configured"),
            SpErr::Http(_, body) => body.clone(),
            SpErr::Net(m) => Value::from(m.clone()),
        }
    }
}

fn redirect_uri() -> String {
    std::env::var("SPOTIFY_REDIRECT_URI")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://koimsurai.com/api/spotify/callback".to_string())
}

/// getSpotifyAccessToken 等價（含 in-process token 快取；併發重刷不去重，同 Express）。
async fn access_token(state: &AppState) -> Result<String, SpErr> {
    {
        let g = state.spotify.token.lock();
        if let Some((t, exp)) = &*g
            && now_ms() < *exp
        {
            return Ok(t.clone());
        }
    }
    let id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_default();
    let secret = std::env::var("SPOTIFY_CLIENT_SECRET").unwrap_or_default();
    let refresh = std::env::var("SPOTIFY_REFRESH_TOKEN").unwrap_or_default();
    if id.is_empty() || secret.is_empty() || refresh.is_empty() {
        return Err(SpErr::NotConfigured);
    }
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{id}:{secret}"));
    let resp = state
        .http
        .post(format!("{}/api/token", state.external.spotify_accounts))
        .header("Authorization", format!("Basic {basic}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("grant_type=refresh_token&refresh_token={refresh}"))
        .send()
        .await
        .map_err(|e| SpErr::Net(e.to_string()))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| SpErr::Net(e.to_string()))?;
    let mut v: Value = serde_json::from_str(&body).unwrap_or(Value::from(body));
    js_normalize_numbers(&mut v);
    if !status.is_success() {
        return Err(SpErr::Http(status, v));
    }
    let token = v.get("access_token").and_then(|t| t.as_str()).unwrap_or("").to_string();
    let expires_in = v.get("expires_in").and_then(|e| e.as_i64()).unwrap_or(0);
    let expiry = now_ms() + expires_in * 1000 - 60_000; // 提前 1 分鐘更新
    *state.spotify.token.lock() = Some((token.clone(), expiry));
    Ok(token)
}

/// axios GET 等價：非 2xx → Err(Http)。回 (status, normalized json)。
///
/// `path` 是**相對於 Spotify API base 的路徑**（例如 `/v1/me`），base 從
/// `state.external.spotify_api` 取。所有呼叫端都走這裡，所以只要改這一個地方
/// 就能讓整支檔案的上游可注入——理由見 `state::ExternalUrls`。
async fn sp_get(
    state: &AppState,
    path: &str,
    token: &str,
    timeout: Option<u64>,
) -> Result<(StatusCode, Value), SpErr> {
    let url = format!("{}{path}", state.external.spotify_api);
    let mut req = state.http.get(&url).header("Authorization", format!("Bearer {token}"));
    if let Some(t) = timeout {
        req = req.timeout(std::time::Duration::from_secs(t));
    }
    let resp = req.send().await.map_err(|e| SpErr::Net(e.to_string()))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| SpErr::Net(e.to_string()))?;
    let mut v: Value =
        if body.is_empty() { Value::Null } else { serde_json::from_str(&body).unwrap_or(Value::from(body)) };
    js_normalize_numbers(&mut v);
    if !status.is_success() {
        return Err(SpErr::Http(status, v));
    }
    Ok((status, v))
}

fn err_json(kind: &str, e: &SpErr) -> Response {
    (
        e.status().unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        Json(json!({ "error": kind, "details": e.details() })),
    )
        .into_response()
}

// ──────────────────────────────────────────────────────────────
// Spotify 回應的「我們自己的形狀」
//
// 這幾個端點原本把 Spotify 的 JSON 原樣轉發（Json<Value>），specta 生不出型別，
// 前端只好照著 Spotify 文件手寫一份 interface。那份手寫型別沒有任何東西保證它
// 跟實際回應一致——Spotify 改結構時前端不會炸在編譯期，而是某天畫面空掉。
//
// 改成先反序列化進這裡的 struct 再送出：
//   1. 型別由 Rust 這邊定義，specta 生成給前端，CI 的 drift gate 擋不同步
//   2. 只取前端真的用得到的欄位，回應體積也小一截
//   3. Spotify 若改了欄位名，錯誤發生在後端這一處，不是前端到處
// 刻意不加欄位層的 #[serde(default)]：它只影響「反序列化時可以缺」，卻會讓 specta 把
// 生成型別標成 `id?: string` —— 前端又得回去猜、又要加防護，正是這次要消滅的東西。
// 解析失敗的保險放在呼叫端的 unwrap_or_default()：Spotify 改結構時整個端點退成空資料，
// 而不是送出半套資料讓前端各自處理。
// ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct SpotifyExternalUrls {
    pub spotify: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct SpotifyImage {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct SpotifyArtist {
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct SpotifyAlbum {
    pub name: String,
    pub images: Vec<SpotifyImage>,
    /// 'YYYY' / 'YYYY-MM' / 'YYYY-MM-DD'（Spotify 依 precision 給不同長度）—— 前端只取年份
    pub release_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct SpotifyTrack {
    pub id: String,
    pub name: String,
    pub artists: Vec<SpotifyArtist>,
    pub album: SpotifyAlbum,
    #[specta(type = specta_typescript::Number)]
    pub duration_ms: i64,
    pub external_urls: SpotifyExternalUrls,
    /// 0–100，前端拿來算平均熱門度
    #[specta(type = specta_typescript::Number)]
    pub popularity: i64,
    pub explicit: bool,
}

/// `GET /api/spotify/now-playing`。沒在播 / 未配置 / 抓取失敗一律回 is_playing:false。
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct NowPlayingResponse {
    pub is_playing: bool,
    // 不用 skip_serializing_if：欄位一律送出（沒在播就是 null）。
    // 「有時候有這個 key、有時候沒有」對前端來說是更難處理的形狀，
    // specta 的 unified mode 也表達不出條件省略。
    pub item: Option<SpotifyTrack>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub progress_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct RecentPlayItem {
    pub track: SpotifyTrack,
    pub played_at: String,
}

/// `GET /api/spotify/recently-played`
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct RecentlyPlayedResponse {
    pub items: Vec<RecentPlayItem>,
}

/// `GET /api/spotify/top-tracks`
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct TopTracksResponse {
    pub items: Vec<SpotifyTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct TopGenre {
    pub genre: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
}

/// `GET /api/spotify/top-genres`
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct TopGenresResponse {
    pub genres: Vec<TopGenre>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct AudioFeature {
    pub id: String,
    // 標 Number：specta 預設把 f64 映成 `number | null`（JSON 表達不了 NaN/Infinity），
    // 但這三個是 Spotify 給的 0–1 比例值，不會是非數。
    #[specta(type = specta_typescript::Number)]
    pub energy: f64,
    #[specta(type = specta_typescript::Number)]
    pub danceability: f64,
    #[specta(type = specta_typescript::Number)]
    pub valence: f64,
}

/// `GET /api/spotify/audio-features`。順序對齊請求的 ids；查不到的位置是 null。
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct AudioFeaturesResponse {
    pub audio_features: Vec<Option<AudioFeature>>,
}

/// `GET /api/spotify/login` —— 302 至 Spotify 授權頁（URLSearchParams 編碼：空白→+）。
#[utoipa::path(get, path = "/api/spotify/login", tag = "integrations",
    responses((status = 200, description = "Spotify 授權導向（302 轉跳授權頁，第三方 proxy）")))]
pub async fn login() -> Response {
    let scope = "user-read-recently-played user-top-read user-read-private user-read-email user-read-currently-playing user-read-playback-state";
    let client_id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_else(|_| "undefined".into());
    let form = |s: &str| crate::util::encode_uri_component(s).replace("%20", "+");
    // 這條**不**走 ExternalUrls：它是回給瀏覽器跳轉的 302 目的地，不是我們發出的請求。
    // 而且要測它也不需要注入——直接呼叫這個函式、驗 Location 標頭就好，全程沒有網路。
    let url = format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}",
        form(&client_id),
        form(scope),
        form(&redirect_uri())
    );
    let mut resp = (StatusCode::FOUND, format!("Found. Redirecting to {url}")).into_response();
    resp.headers_mut()
        .insert(header::LOCATION, url.parse().unwrap_or_else(|_| header::HeaderValue::from_static("/")));
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, header::HeaderValue::from_static("text/plain; charset=utf-8"));
    resp
}

/// `GET /api/spotify/recently-played`
#[utoipa::path(get, path = "/api/spotify/recently-played", tag = "integrations",
    responses((status = 200, description = "最近播放曲目（動態 JSON，第三方 proxy）")))]
pub async fn recently_played(State(state): State<AppState>) -> Response {
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let (_, v) = sp_get(&state, "/v1/me/player/recently-played?limit=10", &token, None).await?;
        Ok(v)
    }
    .await;
    match r {
        // 反序列化成自己的形狀再送出：只留前端用得到的欄位，且型別由這裡定義。
        // 解析失敗（Spotify 改結構）退成空清單，不要讓整頁掛掉。
        Ok(v) => {
            Json(serde_json::from_value::<RecentlyPlayedResponse>(v).unwrap_or_default()).into_response()
        }
        Err(e) => err_json("Failed to fetch Spotify recently played", &e),
    }
}

/// `GET /api/spotify/now-playing` —— 錯誤一律優雅回 `{is_playing:false}`（200）。
#[utoipa::path(get, path = "/api/spotify/now-playing", tag = "integrations",
    responses((status = 200, description = "目前播放中曲目（動態 JSON，第三方 proxy）")))]
pub async fn now_playing(State(state): State<AppState>) -> Response {
    let token = match access_token(&state).await {
        Ok(t) => t,
        Err(SpErr::NotConfigured) | Err(_) => {
            return Json(NowPlayingResponse::default()).into_response();
        }
    };
    match sp_get(&state, "/v1/me/player/currently-playing", &token, None).await {
        Ok((status, v)) => {
            // 204 或空 body = 沒在播
            if status == StatusCode::NO_CONTENT || !js_truthy(Some(&v)) {
                return Json(NowPlayingResponse::default()).into_response();
            }
            Json(serde_json::from_value::<NowPlayingResponse>(v).unwrap_or_default()).into_response()
        }
        Err(_) => Json(NowPlayingResponse::default()).into_response(),
    }
}

/// `GET /api/spotify/top-genres` —— 6h 快取 + 403/429 熔斷 1h。
#[utoipa::path(get, path = "/api/spotify/top-genres", tag = "integrations",
    responses((status = 200, description = "最常聽曲風 Top（動態 JSON，第三方 proxy）")))]
pub async fn top_genres(State(state): State<AppState>) -> Response {
    let now = now_ms();
    if let Some((data, exp)) = state.spotify.top_genres.lock().clone()
        && exp > now
    {
        return Json(data).into_response();
    }
    if state.spotify.top_disabled_until.load(Ordering::Relaxed) > now {
        if let Some((data, _)) = state.spotify.top_genres.lock().clone() {
            return Json(data).into_response();
        }
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Spotify rate limited, try later" })))
            .into_response();
    }
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let (_, v) =
            sp_get(&state, "/v1/me/top/artists?limit=50&time_range=medium_term", &token, Some(10)).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => {
            // genre 計數（插入序）→ 穩定排序 desc → 前 5
            let mut counts: Vec<(String, i64)> = Vec::new();
            if let Some(items) = v.get("items").and_then(|i| i.as_array()) {
                for artist in items {
                    if let Some(genres) = artist.get("genres").and_then(|g| g.as_array()) {
                        for g in genres.iter().filter_map(|x| x.as_str()) {
                            match counts.iter_mut().find(|(k, _)| k == g) {
                                Some((_, c)) => *c += 1,
                                None => counts.push((g.to_string(), 1)),
                            }
                        }
                    }
                }
            }
            counts.sort_by_key(|&(_, c)| std::cmp::Reverse(c)); // stable：同數保插入序（同 V8）
            let payload = TopGenresResponse {
                genres: counts
                    .iter()
                    .take(5)
                    .map(|(g, c)| TopGenre { genre: g.clone(), count: *c })
                    .collect(),
            };
            *state.spotify.top_genres.lock() = Some((payload.clone(), now + TOP_GENRES_TTL));
            Json(payload).into_response()
        }
        Err(e) => {
            if matches!(e.status(), Some(StatusCode::FORBIDDEN) | Some(StatusCode::TOO_MANY_REQUESTS)) {
                state.spotify.top_disabled_until.store(now + SPOTIFY_TOP_COOLDOWN, Ordering::Relaxed);
                if let Some((data, _)) = state.spotify.top_genres.lock().clone() {
                    return Json(data).into_response();
                }
            }
            err_json("Failed to fetch Spotify top genres", &e)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TopTracksQuery {
    time_range: Option<String>,
    limit: Option<String>,
}

/// `GET /api/spotify/top-tracks` —— 1h 快取（per time_range:limit）+ 熔斷。
#[utoipa::path(get, path = "/api/spotify/top-tracks", tag = "integrations",
    responses((status = 200, description = "最常聽曲目 Top（動態 JSON，第三方 proxy）")))]
pub async fn top_tracks(State(state): State<AppState>, Query(q): Query<TopTracksQuery>) -> Response {
    let time_range = q.time_range.unwrap_or_else(|| "medium_term".into());
    let limit = q.limit.unwrap_or_else(|| "20".into());
    let key = format!("{time_range}:{limit}");
    let now = now_ms();
    let cached = state.spotify.top_tracks.lock().get(&key).cloned();
    if let Some((data, exp)) = &cached
        && *exp > now
    {
        return Json(data.clone()).into_response();
    }
    if state.spotify.top_disabled_until.load(Ordering::Relaxed) > now {
        if let Some((data, _)) = &cached {
            return Json(data.clone()).into_response();
        }
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Spotify rate limited, try later" })))
            .into_response();
    }
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let url = format!(
            "/v1/me/top/tracks?limit={}&time_range={}",
            crate::util::encode_uri_component(&limit),
            crate::util::encode_uri_component(&time_range)
        );
        let (_, v) = sp_get(&state, &url, &token, Some(10)).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => {
            let payload = serde_json::from_value::<TopTracksResponse>(v).unwrap_or_default();
            state.spotify.top_tracks.lock().insert(key, (payload.clone(), now + TOP_TRACKS_TTL));
            Json(payload).into_response()
        }
        Err(e) => {
            if matches!(e.status(), Some(StatusCode::FORBIDDEN) | Some(StatusCode::TOO_MANY_REQUESTS)) {
                state.spotify.top_disabled_until.store(now + SPOTIFY_TOP_COOLDOWN, Ordering::Relaxed);
                if let Some((data, _)) = &cached {
                    return Json(data.clone()).into_response();
                }
            }
            err_json("Failed to fetch Spotify top tracks", &e)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AudioFeaturesQuery {
    ids: Option<String>,
}

/// `GET /api/spotify/audio-features` —— per-track 24h 快取 + 熔斷；一律優雅降級（cached+null）。
#[utoipa::path(get, path = "/api/spotify/audio-features", tag = "integrations",
    responses((status = 200, description = "曲目音訊特徵（動態 JSON，第三方 proxy）")))]
pub async fn audio_features(State(state): State<AppState>, Query(q): Query<AudioFeaturesQuery>) -> Response {
    let Some(ids) = q.ids.filter(|s| !s.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Missing track IDs" }))).into_response();
    };
    let id_list: Vec<String> = ids.split(',').filter(|s| !s.is_empty()).map(String::from).collect();
    let now = now_ms();

    let mut cached: HashMap<String, AudioFeature> = HashMap::new();
    let mut missing: Vec<String> = Vec::new();
    {
        let g = state.spotify.audio_features.lock();
        for id in &id_list {
            match g.get(id) {
                Some((data, exp)) if *exp > now => {
                    cached.insert(id.clone(), data.clone());
                }
                _ => missing.push(id.clone()),
            }
        }
    }
    // 回應順序對齊請求的 ids，查不到的位置給 null（前端據此建 id → feature 的 map）
    let respond = |cached: &HashMap<String, AudioFeature>| -> Response {
        Json(AudioFeaturesResponse {
            audio_features: id_list.iter().map(|id| cached.get(id).cloned()).collect(),
        })
        .into_response()
    };
    if state.spotify.af_disabled_until.load(Ordering::Relaxed) > now {
        return respond(&cached);
    }
    if missing.is_empty() {
        return respond(&cached);
    }
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let url = format!("/v1/audio-features?ids={}", crate::util::encode_uri_component(&missing.join(",")));
        let (_, v) = sp_get(&state, &url, &token, Some(10)).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => {
            let expires = now + AUDIO_FEATURES_TTL;
            if let Ok(parsed) = serde_json::from_value::<AudioFeaturesResponse>(v) {
                let mut g = state.spotify.audio_features.lock();
                for f in parsed.audio_features.into_iter().flatten() {
                    if f.id.is_empty() {
                        continue;
                    }
                    g.insert(f.id.clone(), (f.clone(), expires));
                    cached.insert(f.id.clone(), f);
                }
            }
            respond(&cached)
        }
        Err(e) => {
            if matches!(e.status(), Some(StatusCode::FORBIDDEN) | Some(StatusCode::TOO_MANY_REQUESTS)) {
                state.spotify.af_disabled_until.store(now + AUDIO_FEATURES_COOLDOWN, Ordering::Relaxed);
            }
            respond(&cached)
        }
    }
}

/// `GET /api/spotify/me`
#[utoipa::path(get, path = "/api/spotify/me", tag = "integrations",
    responses((status = 200, description = "Spotify 使用者資料（動態 JSON，第三方 proxy）")))]
pub async fn me(State(state): State<AppState>) -> Response {
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let (_, v) = sp_get(&state, "/v1/me", &token, None).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_json("Failed to fetch Spotify user data", &e),
    }
}

/// `GET /api/spotify/callback` —— 一次性 setup：授權碼換 refresh_token 顯示（存 .env 用）。
/// 簡版 HTML（原 Express 版有整頁 CSS；此頁僅 admin 重新授權時用一次）。
#[utoipa::path(get, path = "/api/spotify/callback", tag = "integrations",
    responses((status = 200, description = "Spotify OAuth 回呼：授權碼換 refresh token（HTML 頁，一次性 setup）")))]
pub async fn spotify_callback(
    State(state): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Response {
    use axum::http::header;
    if let Some(e) = q.get("error") {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            format!("授權失敗: {e}"),
        )
            .into_response();
    }
    let Some(code) = q.get("code") else {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            "缺少授權碼".to_string(),
        )
            .into_response();
    };
    let cid = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_default();
    let secret = std::env::var("SPOTIFY_CLIENT_SECRET").unwrap_or_default();
    let redirect = std::env::var("SPOTIFY_REDIRECT_URI").unwrap_or_default();
    let body = format!(
        "grant_type=authorization_code&code={}&redirect_uri={}",
        crate::util::encode_uri_component(code),
        crate::util::encode_uri_component(&redirect)
    );
    let resp = state
        .http
        .post(format!("{}/api/token", state.external.spotify_accounts))
        .basic_auth(&cid, Some(&secret))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await;
    let data: serde_json::Value = match resp {
        Ok(r) if r.status().is_success() => match serde_json::from_str(&r.text().await.unwrap_or_default()) {
            Ok(v) => v,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    "token 交換失敗".to_string(),
                )
                    .into_response();
            }
        },
        _ => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                "token 交換失敗".to_string(),
            )
                .into_response();
        }
    };
    let refresh = data.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("(無)");
    let html = format!(
        "<html><head><title>Spotify 授權成功</title></head><body style=\"font-family:sans-serif;max-width:640px;margin:40px auto\">\
         <h2>✅ Spotify 授權成功</h2><p>把下面的 refresh token 存進 <code>server/.env</code> 的 <code>SPOTIFY_REFRESH_TOKEN</code>：</p>\
         <pre style=\"background:#f4f4f4;padding:12px;border-radius:8px;word-break:break-all;white-space:pre-wrap\">{refresh}</pre>\
         <p>此頁僅 setup 用，token 不會被儲存。</p></body></html>"
    );
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ExternalUrls;
    use axum::extract::State as AxState;
    use wiremock::matchers::{method, path as mock_path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // SPOTIFY_* 是 process 全域的；nextest 一個測試一個行程不會撞，
    // 但 `cargo test`（cargo-mutants 用它）同行程平行跑 → 要串起來。
    static ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    const REFRESH_BODY: &str = r#"{"access_token":"tok","expires_in":3600}"#;

    async fn state_with_mock(server: &MockServer) -> AppState {
        let mut st = crate::state::test_state().await;
        st.external = std::sync::Arc::new(ExternalUrls::all_pointing_at(&server.uri()));
        st
    }

    /// 讓 access_token() 拿得到 token：三個環境變數都要有值，且 mock 要回 refresh 結果。
    async fn mount_token(server: &MockServer) {
        Mock::given(method("POST"))
            .and(mock_path("/spotify-accounts/api/token"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(REFRESH_BODY, "application/json"))
            .mount(server)
            .await;
    }

    /// SAFETY: 呼叫端持有 ENV_LOCK。
    unsafe fn set_creds(on: bool) {
        unsafe {
            for k in ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"] {
                if on {
                    std::env::set_var(k, "x");
                } else {
                    std::env::remove_var(k);
                }
            }
        }
    }

    async fn body_of(resp: Response) -> Value {
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.expect("collect").to_bytes();
        serde_json::from_slice(&bytes).expect("回應應該是 JSON")
    }

    // ── top-genres / top-tracks / audio-features / me / callback ──────────
    //
    // 這幾支的共同點是「快取 + 熔斷 + 優雅降級」。三者都是壞了不會有錯誤訊息的東西：
    // 快取失效 → 每次載入首頁都打 Spotify（很快被限流）；熔斷沒生效 → 被限流之後
    // 繼續猛打；降級寫錯 → 前端拿到 undefined 畫出一片空白。

    #[tokio::test]
    async fn top_genres_計數後取前五_同數保持插入序() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me/top/artists"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [
                { "genres": ["shoegaze", "dream pop"] },
                { "genres": ["shoegaze", "post-rock"] },
                { "genres": ["shoegaze"] },
                { "genres": ["dream pop"] },
                { "genres": ["city pop"] },
                { "genres": ["jazz"] },
                { "genres": ["ambient"] },
            ]})))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(top_genres(AxState(st.clone())).await).await;
        let g = v["genres"].as_array().expect("genres 應該是陣列");
        assert_eq!(g.len(), 5, "只取前五");
        assert_eq!(g[0]["genre"], "shoegaze");
        assert_eq!(g[0]["count"], 3);
        assert_eq!(g[1]["genre"], "dream pop");
        assert_eq!(g[1]["count"], 2);
        // 以下三個都是 1 —— 排序必須**穩定**，同數保持插入序（對齊 V8 的 sort）
        assert_eq!(
            [g[2]["genre"].as_str(), g[3]["genre"].as_str(), g[4]["genre"].as_str()],
            [Some("post-rock"), Some("city pop"), Some("jazz")],
            "同票數要保持出現順序，否則同一份資料每次刷新排序都不一樣"
        );

        // 第二次要吃快取（6 小時），不該再打上游
        let before = server.received_requests().await.unwrap().len();
        let _ = top_genres(AxState(st)).await;
        assert_eq!(server.received_requests().await.unwrap().len(), before, "第二次應該吃快取");
        unsafe { set_creds(false) };
    }

    #[tokio::test]
    async fn top_genres_被限流時熔斷_沒有快取才回_429() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me/top/artists"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let resp = top_genres(AxState(st.clone())).await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS, "沒有快取可回退時要說明被限流");
        assert!(
            st.spotify.top_disabled_until.load(Ordering::Relaxed) > now_ms(),
            "429 之後要熔斷一小時，不然會繼續猛打"
        );

        // 熔斷期間不該再打上游
        let before = server.received_requests().await.unwrap().len();
        let _ = top_genres(AxState(st)).await;
        assert_eq!(server.received_requests().await.unwrap().len(), before, "熔斷期間不該再打");
        unsafe { set_creds(false) };
    }

    #[tokio::test]
    async fn top_tracks_的快取以_time_range_與_limit_分開() {
        // 共用一個 key 的話，切「最近一個月／半年」會拿到同一份資料而沒有人會發現。
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me/top/tracks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let q = |tr: &str, lim: &str| TopTracksQuery {
            time_range: Some(tr.to_string()),
            limit: Some(lim.to_string()),
        };
        let _ = top_tracks(AxState(st.clone()), axum::extract::Query(q("short_term", "20"))).await;
        let after_first = server.received_requests().await.unwrap().len();
        // 同一組 → 吃快取
        let _ = top_tracks(AxState(st.clone()), axum::extract::Query(q("short_term", "20"))).await;
        assert_eq!(server.received_requests().await.unwrap().len(), after_first, "同一組要吃快取");
        // 換 time_range → 另一個 key，要重打
        let _ = top_tracks(AxState(st.clone()), axum::extract::Query(q("long_term", "20"))).await;
        assert!(server.received_requests().await.unwrap().len() > after_first, "換 time_range 要重新抓");
        let after_second = server.received_requests().await.unwrap().len();
        // 換 limit → 又是另一個 key
        let _ = top_tracks(AxState(st), axum::extract::Query(q("long_term", "5"))).await;
        assert!(server.received_requests().await.unwrap().len() > after_second, "換 limit 也要重新抓");
        unsafe { set_creds(false) };
    }

    /// 回應順序必須對齊請求的 ids，查不到的位置給 **null**。
    /// 前端是依位置建 id → feature 的 map，順序錯或少一格就會整個對錯。
    #[tokio::test]
    async fn audio_features_的順序對齊請求_查不到的給_null() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        // 上游只回得出 b 與 a（順序還跟請求相反），c 完全沒有
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/audio-features"))
            // 三個數值欄位都是必填——少一個整份 parse 就失敗，於是**全部**變成 null。
            // 第一版只給了 energy，測試因此紅在「a 是 null」，而症狀完全指不到「解析失敗」。
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "audio_features": [
                { "id": "b", "energy": 0.5, "danceability": 0.4, "valence": 0.3 },
                { "id": "a", "energy": 0.9, "danceability": 0.8, "valence": 0.7 },
                null,
            ]})))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            audio_features(
                AxState(st.clone()),
                axum::extract::Query(AudioFeaturesQuery { ids: Some("a,b,c".into()) }),
            )
            .await,
        )
        .await;
        let af = v["audio_features"].as_array().expect("陣列");
        assert_eq!(af.len(), 3, "有幾個 id 就要回幾格");
        assert_eq!(af[0]["id"], "a", "順序要對齊請求，不是上游回的順序");
        assert_eq!(af[1]["id"], "b");
        assert!(af[2].is_null(), "查不到的位置要留 null 佔位");

        // 第二次全部命中快取，不再打上游
        let before = server.received_requests().await.unwrap().len();
        let v = body_of(
            audio_features(AxState(st), axum::extract::Query(AudioFeaturesQuery { ids: Some("a,b".into()) }))
                .await,
        )
        .await;
        assert_eq!(server.received_requests().await.unwrap().len(), before, "已快取的不該再打");
        assert_eq!(v["audio_features"].as_array().unwrap().len(), 2);
        unsafe { set_creds(false) };
    }

    #[tokio::test]
    async fn audio_features_缺_ids_是_400_上游失敗則優雅降級() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/audio-features"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        for ids in [None, Some(String::new())] {
            let resp =
                audio_features(AxState(st.clone()), axum::extract::Query(AudioFeaturesQuery { ids })).await;
            assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        }

        // 上游 403 → 這支**不回錯誤**，回一整排 null（前端照樣畫得出來，只是沒有特徵值）
        let resp = audio_features(
            AxState(st.clone()),
            axum::extract::Query(AudioFeaturesQuery { ids: Some("x,y".into()) }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK, "這支一律優雅降級，不把上游錯誤丟給前端");
        let v = body_of(resp).await;
        let af = v["audio_features"].as_array().unwrap();
        assert_eq!(af.len(), 2);
        assert!(af.iter().all(|x| x.is_null()));
        assert!(st.spotify.af_disabled_until.load(Ordering::Relaxed) > now_ms(), "403 也要熔斷");
        unsafe { set_creds(false) };
    }

    #[tokio::test]
    async fn me_原樣轉發使用者資料() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "display_name": "Koi", "id": "koi", "followers": { "total": 3 }
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let v = body_of(me(AxState(st)).await).await;
        assert_eq!(v["display_name"], "Koi");
        assert_eq!(v["followers"]["total"], 3, "巢狀結構原樣帶過去");
        unsafe { set_creds(false) };
    }

    /// callback 是一次性的 setup 頁：把 refresh token 顯示出來給人複製進 .env。
    /// 三條錯誤路徑都要是 HTML（這是給瀏覽器看的頁面，不是 API）。
    #[tokio::test]
    async fn callback_的三條錯誤路徑都回_html() {
        let _env = ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let q = |pairs: &[(&str, &str)]| {
            axum::extract::Query(
                pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>(),
            )
        };
        let html_of = |resp: Response| async move {
            let ct = resp
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let status = resp.status();
            let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.unwrap().to_bytes();
            (status, ct, String::from_utf8_lossy(&bytes).into_owned())
        };

        // 使用者按了「拒絕」
        let (status, ct, body) =
            html_of(spotify_callback(AxState(st.clone()), q(&[("error", "access_denied")])).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(ct.starts_with("text/html"), "得到 {ct}");
        assert!(body.contains("access_denied"), "要說得出上游給的原因");

        // 什麼都沒帶
        let (status, ct, _) = html_of(spotify_callback(AxState(st.clone()), q(&[])).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(ct.starts_with("text/html"));

        // 有 code 但 token 交換失敗（mock 沒掛 /api/token → 404）
        let (status, ct, body) = html_of(spotify_callback(AxState(st), q(&[("code", "abc")])).await).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(ct.starts_with("text/html"));
        assert!(body.contains("token 交換失敗"));
    }

    #[tokio::test]
    async fn callback_成功時把_refresh_token_顯示出來() {
        let _env = ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(mock_path("/spotify-accounts/api/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "at", "refresh_token": "這是要複製進 env 的值"
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let resp = spotify_callback(
            AxState(st),
            axum::extract::Query(
                [("code".to_string(), "abc".to_string())].into_iter().collect::<HashMap<_, _>>(),
            ),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.unwrap().to_bytes();
        let html = String::from_utf8_lossy(&bytes);
        assert!(html.contains("這是要複製進 env 的值"), "整個頁面的用途就是顯示這個值");
        assert!(html.contains("SPOTIFY_REFRESH_TOKEN"), "要告訴人這個值要放哪裡");
    }

    /// 上游回 204（沒在播）時，這支要回一個「沒在播」的正常回應。
    ///
    /// ⚠ 這條**驗的是對外契約，不是那個提前返回的分支**。實測把
    /// `if status == NO_CONTENT || !js_truthy(..)` 改成 `if false`，測試照樣通過——
    /// 因為底下的 `unwrap_or_default()` 對 Null 也會產出同一個結果。那個提前返回是
    /// 防禦性的、行為上冗餘。寫在這裡是因為「測試名字宣稱保護 X、實際上 X 拿掉也不會紅」
    /// 是最容易累積的假保障，下一個人不該再花時間重新發現一次。
    #[tokio::test]
    async fn now_playing_on_204_returns_a_not_playing_response() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me/player/currently-playing"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(now_playing(AxState(st)).await).await;
        assert_eq!(v["is_playing"], false, "204 該被當成「沒在播」");
        unsafe { set_creds(false) };
    }

    /// 上游回 429（限流）時要**開熔斷**，不是每次請求都再打一次。
    /// 沒有熔斷的話 Spotify 一限流，這個站每個訪客都會替它多打一次，只會被鎖更久。
    #[tokio::test]
    async fn top_genres_opens_the_circuit_after_429() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(true) };
        let server = MockServer::start().await;
        mount_token(&server).await;
        Mock::given(method("GET"))
            .and(mock_path("/spotify-api/v1/me/top/artists"))
            .respond_with(ResponseTemplate::new(429))
            // 期望**剛好一次**：第二次請求要被熔斷擋下，不該再打到上游
            .expect(1)
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let _ = top_genres(AxState(st.clone())).await;
        assert!(st.spotify.top_disabled_until.load(Ordering::Relaxed) > now_ms(), "429 之後熔斷應該是開的");

        // 第二次：熔斷開著，不該再碰上游（由 server 的 .expect(1) 在 drop 時驗證）
        let _ = top_genres(AxState(st)).await;
        drop(server);
        unsafe { set_creds(false) };
    }

    /// 沒設定環境變數時要優雅降級成空回應，而不是 500。
    /// 這條在部署到還沒接 Spotify 的環境時就會走到。
    #[tokio::test]
    async fn now_playing_without_credentials_degrades_quietly() {
        let _env = ENV_LOCK.lock().await;
        unsafe { set_creds(false) };
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let resp = now_playing(AxState(st)).await;
        assert_eq!(resp.status(), StatusCode::OK, "未配置不該變成錯誤狀態碼");
        let v = body_of(resp).await;
        assert_eq!(v["is_playing"], false);
    }

    /// login() 只組字串回 302，全程沒有網路——所以不需要注入也測得了。
    /// 驗的是「授權網址帶對參數」：scope 或 redirect_uri 錯了，使用者會在 Spotify 那邊
    /// 看到一個看不懂的錯誤，而我們這邊完全沒有訊號。
    #[tokio::test]
    async fn login_redirect_carries_scope_and_redirect_uri() {
        let _env = ENV_LOCK.lock().await;
        // SAFETY: 持有 ENV_LOCK。
        unsafe { std::env::set_var("SPOTIFY_CLIENT_ID", "cid-123") };
        let resp = login().await;
        assert_eq!(resp.status(), StatusCode::FOUND);
        let loc = resp.headers().get(header::LOCATION).expect("要有 Location").to_str().unwrap().to_string();
        assert!(loc.starts_with("https://accounts.spotify.com/authorize"), "應該導向 Spotify：{loc}");
        assert!(loc.contains("client_id=cid-123"), "client_id 沒帶上：{loc}");
        assert!(loc.contains("user-read-currently-playing"), "scope 少了正在播放的權限：{loc}");
        assert!(loc.contains("redirect_uri="), "redirect_uri 沒帶上：{loc}");
        // SAFETY: 見上。
        unsafe { std::env::remove_var("SPOTIFY_CLIENT_ID") };
    }
}
