//! Spotify 代理（token refresh 快取 + top-*/audio-features 快取與 403/429 熔斷）。
//! 狀態存 `state.spotify`（parking_lot 短臨界區，不跨 await 持鎖）。

use std::sync::atomic::Ordering;

use axum::{
    Json,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Map, Value, json};

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
        .post("https://accounts.spotify.com/api/token")
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
async fn sp_get(
    state: &AppState,
    url: &str,
    token: &str,
    timeout: Option<u64>,
) -> Result<(StatusCode, Value), SpErr> {
    let mut req = state.http.get(url).header("Authorization", format!("Bearer {token}"));
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

/// `GET /api/spotify/login` —— 302 至 Spotify 授權頁（URLSearchParams 編碼：空白→+）。
#[utoipa::path(get, path = "/api/spotify/login", tag = "integrations",
    responses((status = 200, description = "Spotify 授權導向（302 轉跳授權頁，第三方 proxy）")))]
pub async fn login() -> Response {
    let scope = "user-read-recently-played user-top-read user-read-private user-read-email user-read-currently-playing user-read-playback-state";
    let client_id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_else(|_| "undefined".into());
    let form = |s: &str| crate::util::encode_uri_component(s).replace("%20", "+");
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
        let (_, v) =
            sp_get(&state, "https://api.spotify.com/v1/me/player/recently-played?limit=10", &token, None)
                .await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_json("Failed to fetch Spotify recently played", &e),
    }
}

/// `GET /api/spotify/now-playing` —— 錯誤一律優雅回 `{is_playing:false}`（200）。
#[utoipa::path(get, path = "/api/spotify/now-playing", tag = "integrations",
    responses((status = 200, description = "目前播放中曲目（動態 JSON，第三方 proxy）")))]
pub async fn now_playing(State(state): State<AppState>) -> Response {
    let token = match access_token(&state).await {
        Ok(t) => t,
        Err(SpErr::NotConfigured) => {
            return Json(json!({ "is_playing": false, "error": "Spotify 未配置" })).into_response();
        }
        Err(_) => return Json(json!({ "is_playing": false })).into_response(),
    };
    match sp_get(&state, "https://api.spotify.com/v1/me/player/currently-playing", &token, None).await {
        Ok((status, v)) => {
            // 204 或空 body = 沒在播
            if status == StatusCode::NO_CONTENT || !js_truthy(Some(&v)) {
                return Json(json!({ "is_playing": false })).into_response();
            }
            Json(json!({
                "is_playing": v.get("is_playing").cloned().unwrap_or(Value::Null),
                "item": v.get("item").cloned().unwrap_or(Value::Null),
                "progress_ms": v.get("progress_ms").cloned().unwrap_or(Value::Null),
                "currently_playing_type": v.get("currently_playing_type").cloned().unwrap_or(Value::Null),
            }))
            .into_response()
        }
        Err(_) => Json(json!({ "is_playing": false })).into_response(),
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
        let (_, v) = sp_get(
            &state,
            "https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term",
            &token,
            Some(10),
        )
        .await?;
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
            let top: Vec<Value> =
                counts.iter().take(5).map(|(g, c)| json!({ "genre": g, "count": c })).collect();
            let payload = json!({ "genres": top });
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
            "https://api.spotify.com/v1/me/top/tracks?limit={}&time_range={}",
            crate::util::encode_uri_component(&limit),
            crate::util::encode_uri_component(&time_range)
        );
        let (_, v) = sp_get(&state, &url, &token, Some(10)).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => {
            state.spotify.top_tracks.lock().insert(key, (v.clone(), now + TOP_TRACKS_TTL));
            Json(v).into_response()
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

    let mut cached: Map<String, Value> = Map::new();
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
    let respond = |cached: &Map<String, Value>| -> Response {
        let list: Vec<Value> =
            id_list.iter().map(|id| cached.get(id).cloned().unwrap_or(Value::Null)).collect();
        Json(json!({ "audio_features": list })).into_response()
    };
    if state.spotify.af_disabled_until.load(Ordering::Relaxed) > now {
        return respond(&cached);
    }
    if missing.is_empty() {
        return respond(&cached);
    }
    let r: Result<Value, SpErr> = async {
        let token = access_token(&state).await?;
        let url = format!(
            "https://api.spotify.com/v1/audio-features?ids={}",
            crate::util::encode_uri_component(&missing.join(","))
        );
        let (_, v) = sp_get(&state, &url, &token, Some(10)).await?;
        Ok(v)
    }
    .await;
    match r {
        Ok(v) => {
            let expires = now + AUDIO_FEATURES_TTL;
            if let Some(features) = v.get("audio_features").and_then(|f| f.as_array()) {
                let mut g = state.spotify.audio_features.lock();
                for f in features {
                    if let Some(id) = f.get("id").and_then(|i| i.as_str()).filter(|s| !s.is_empty()) {
                        g.insert(id.to_string(), (f.clone(), expires));
                        cached.insert(id.to_string(), f.clone());
                    }
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
        let (_, v) = sp_get(&state, "https://api.spotify.com/v1/me", &token, None).await?;
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
        .post("https://accounts.spotify.com/api/token")
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
