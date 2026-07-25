//! 第三方 API 代理（github / wakatime / steam / books search）。
//! 共同原則（照抄 Express）：**不看上游狀態碼**（https.get 直接 parse body 回 200），
//! JSON parse 失敗與網路錯誤各有固定錯誤訊息；wakatime（axios）例外——非 2xx 會轉拋。

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::state::AppState;
use crate::util::{encode_uri_component, js_truthy};

// ── 小工具 ────────────────────────────────────────────────────────────────

/// https.get 式代理：抓 URL、parse JSON、原樣回 200；parse 失敗/網路錯誤回指定訊息。
async fn passthrough_json(
    http: &reqwest::Client,
    url: &str,
    ua: Option<&str>,
    parse_err: &str,
    fetch_err: &str,
) -> Response {
    let mut req = http.get(url);
    if let Some(u) = ua {
        req = req.header("User-Agent", u);
    }
    match req.send().await {
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": fetch_err }))).into_response(),
        Ok(resp) => match resp.text().await {
            Err(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": fetch_err }))).into_response()
            }
            Ok(body) => match serde_json::from_str::<Value>(&body) {
                Ok(mut v) => {
                    crate::util::js_normalize_numbers(&mut v);
                    Json(v).into_response()
                }
                Err(_) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": parse_err }))).into_response()
                }
            },
        },
    }
}

/// JS `new Date(ms).toISOString()`（YYYY-MM-DDTHH:MM:SS.mmmZ）。
fn iso_from_millis(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let h = rem / 3_600_000;
    let mi = rem % 3_600_000 / 60_000;
    let s = rem % 60_000 / 1000;
    let mil = rem % 1000;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{mil:03}Z")
}

/// Howard Hinnant civil_from_days（days since 1970-01-01 → (y,m,d)）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 今日 UTC 日期字串（`new Date().toISOString().split('T')[0]`）。
fn today_utc() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(ms.div_euclid(86_400_000));
    format!("{y:04}-{m:02}-{d:02}")
}

// ── GitHub ────────────────────────────────────────────────────────────────

const GH_UA: &str = "Personal-Website-Backend";

/// ghFetch 等價：失敗回 None（Express resolve(null)）。
async fn gh_fetch(http: &reqwest::Client, path: &str, token: Option<&str>) -> Option<Value> {
    let mut req = http.get(format!("https://api.github.com{path}")).header("User-Agent", GH_UA);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let body = req.send().await.ok()?.text().await.ok()?;
    let mut v: Value = serde_json::from_str(&body).ok()?;
    crate::util::js_normalize_numbers(&mut v);
    Some(v)
}

/// `GET /api/github/user/:username` —— 無 token 純代理（原樣回 200，含 GitHub 錯誤物件）。
#[utoipa::path(get, path = "/api/github/user/{username}", tag = "integrations",
    params(("username" = String, Path)),
    responses((status = 200, description = "GitHub 使用者資料（動態 JSON，第三方 proxy）")))]
pub async fn github_user(State(state): State<AppState>, Path(username): Path<String>) -> Response {
    passthrough_json(
        &state.http,
        &format!("https://api.github.com/users/{username}"),
        Some(GH_UA),
        "Failed to parse GitHub API response",
        "Failed to fetch GitHub data",
    )
    .await
}

/// `GET /api/github/events/:username` —— **一律用 /events/public**（只回公開事件）。
/// 有 token 時仍帶（拉高 rate limit + 供下面 enrich 空 commits 的 compare API 用），
/// 但端點固定 public：否則帶自己的 token 打 /events 會連**私有 repo 的 push 也回傳**（隱私外洩）。
#[utoipa::path(get, path = "/api/github/events/{username}", tag = "integrations",
    params(("username" = String, Path)),
    responses((status = 200, description = "GitHub 公開活動事件（動態 JSON，第三方 proxy）")))]
pub async fn github_events(State(state): State<AppState>, Path(username): Path<String>) -> Response {
    let token = std::env::var("GITHUB_TOKEN").ok().filter(|s| !s.is_empty());
    let path = format!("/users/{username}/events/public?per_page=30");
    let events = gh_fetch(&state.http, &path, token.as_deref()).await;

    let Some(Value::Array(mut events)) = events else {
        // 非陣列（GitHub 錯誤物件）→ 原樣；null → []
        return Json(events.unwrap_or_else(|| json!([]))).into_response();
    };

    if let Some(t) = &token {
        for ev in events.iter_mut() {
            let is_push = ev.get("type").and_then(|v| v.as_str()) == Some("PushEvent");
            if !is_push {
                continue;
            }
            let p = ev.get("payload");
            let commits_empty = p
                .and_then(|p| p.get("commits"))
                .and_then(|c| c.as_array())
                .map(|a| a.is_empty())
                .unwrap_or(true);
            let before = p.and_then(|p| p.get("before")).filter(|v| js_truthy(Some(v))).cloned();
            let head = p.and_then(|p| p.get("head")).filter(|v| js_truthy(Some(v))).cloned();
            let repo = ev.pointer("/repo/name").and_then(|v| v.as_str()).map(String::from);
            if !(commits_empty && before.is_some() && head.is_some() && repo.is_some()) {
                continue;
            }
            let cmp_path = format!(
                "/repos/{}/compare/{}...{}",
                repo.unwrap_or_default(),
                before.and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
                head.and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
            );
            let cmp = gh_fetch(&state.http, &cmp_path, Some(t)).await;
            if let Some(commits) = cmp.as_ref().and_then(|c| c.get("commits")).and_then(|c| c.as_array()) {
                let mapped: Vec<Value> = commits
                    .iter()
                    .map(|c| {
                        json!({
                            "sha": c.get("sha").cloned().unwrap_or(Value::Null),
                            "message": c.pointer("/commit/message").cloned().unwrap_or(Value::Null),
                            "author": c.pointer("/commit/author").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect();
                if let Some(payload) = ev.get_mut("payload").and_then(|p| p.as_object_mut()) {
                    payload.insert("size".into(), json!(mapped.len()));
                    payload.insert("commits".into(), Value::Array(mapped));
                }
            }
        }
    }
    Json(Value::Array(events)).into_response()
}

// ── WakaTime ──────────────────────────────────────────────────────────────

use base64::Engine;

fn wakatime_key() -> Option<String> {
    std::env::var("WAKATIME_API_KEY").ok().filter(|s| !s.is_empty())
}

fn waka_auth(key: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(key))
}

fn waka_unconfigured() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(
            json!({ "error": "WakaTime API 未配置", "message": "請在 server/.env 中設置 WAKATIME_API_KEY" }),
        ),
    )
        .into_response()
}

/// axios 式請求：非 2xx → Err((status, parsed body))、網路錯 → Err((500, message 字串))。
async fn waka_get(http: &reqwest::Client, url: &str, key: &str) -> Result<Value, (StatusCode, Value)> {
    let resp = http
        .get(url)
        .header("Authorization", waka_auth(key))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Value::from(e.to_string())))?;
    let status = resp.status();
    let body =
        resp.text().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Value::from(e.to_string())))?;
    let mut v: Value = serde_json::from_str(&body).unwrap_or(Value::from(body));
    crate::util::js_normalize_numbers(&mut v);
    if status.is_success() { Ok(v) } else { Err((status, v)) }
}

fn waka_err(kind: &str, e: (StatusCode, Value)) -> Response {
    (e.0, Json(json!({ "error": kind, "details": e.1 }))).into_response()
}

/// `GET /api/wakatime/today` —— summaries + durations 並行，合併 actualCodingTime。
#[utoipa::path(get, path = "/api/wakatime/today", tag = "integrations",
    responses((status = 200, description = "WakaTime 今日編碼統計（動態 JSON，第三方 proxy）")))]
pub async fn wakatime_today(State(state): State<AppState>) -> Response {
    let Some(key) = wakatime_key() else { return waka_unconfigured() };
    let date = today_utc();
    let url_summary = format!("https://wakatime.com/api/v1/users/current/summaries?start={date}&end={date}");
    let url_durations = format!("https://wakatime.com/api/v1/users/current/durations?date={date}");
    let (summary, durations) =
        tokio::join!(waka_get(&state.http, &url_summary, &key), waka_get(&state.http, &url_durations, &key));
    let summary = match summary {
        Ok(v) => v,
        Err(e) => return waka_err("Failed to fetch WakaTime today data", e),
    };
    let durations = match durations {
        Ok(v) => v,
        Err(e) => return waka_err("Failed to fetch WakaTime today data", e),
    };

    let dur_list: Vec<&Value> =
        durations.get("data").and_then(|d| d.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
    let mut actual_start: Option<f64> = None;
    let mut actual_end: Option<f64> = None;
    for d in &dur_list {
        if let Some(t) = d.get("time").and_then(|v| v.as_f64()) {
            actual_start = Some(actual_start.map_or(t, |e| e.min(t)));
            let end = t + d.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
            actual_end = Some(actual_end.map_or(end, |e| e.max(end)));
        }
    }
    let summary_data = summary.pointer("/data/0").cloned().unwrap_or_else(|| json!({}));

    Json(json!({
        "data": [summary_data],
        "start": summary.get("start").cloned().unwrap_or(Value::Null),
        "end": summary.get("end").cloned().unwrap_or(Value::Null),
        "actualCodingTime": {
            // JS new Date(x*1000)：ms 取整（ToInteger 截斷）
            "start": actual_start.map(|t| iso_from_millis((t * 1000.0) as i64)),
            "end": actual_end.map(|t| iso_from_millis((t * 1000.0) as i64)),
            "hasData": !dur_list.is_empty(),
        }
    }))
    .into_response()
}

/// week / projects 共用（同一支 stats API，只差錯誤字串）。
async fn wakatime_stats(state: &AppState, err_kind: &str) -> Response {
    let Some(key) = wakatime_key() else { return waka_unconfigured() };
    match waka_get(&state.http, "https://wakatime.com/api/v1/users/current/stats/last_7_days", &key).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => waka_err(err_kind, e),
    }
}

#[utoipa::path(get, path = "/api/wakatime/week", tag = "integrations",
    responses((status = 200, description = "WakaTime 近 7 日統計（動態 JSON，第三方 proxy）")))]
pub async fn wakatime_week(State(state): State<AppState>) -> Response {
    wakatime_stats(&state, "Failed to fetch WakaTime week data").await
}

#[utoipa::path(get, path = "/api/wakatime/projects", tag = "integrations",
    responses((status = 200, description = "WakaTime 專案統計（動態 JSON，第三方 proxy）")))]
pub async fn wakatime_projects(State(state): State<AppState>) -> Response {
    wakatime_stats(&state, "Failed to fetch WakaTime projects data").await
}

// ── Steam（純代理 4 支；/steam/profile 有 SWR 快取留 proxy）────────────────

fn steam_env() -> Option<(String, String)> {
    let key = std::env::var("STEAM_API_KEY").ok().filter(|s| !s.is_empty())?;
    let id = std::env::var("STEAM_ID").ok().filter(|s| !s.is_empty())?;
    Some((key, id))
}

fn steam_unconfigured() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Steam API 未配置", "message": "請在 server/.env 中設置 STEAM_API_KEY 和 STEAM_ID" })),
    )
        .into_response()
}

#[utoipa::path(get, path = "/api/steam/player", tag = "integrations",
    responses((status = 200, description = "Steam 玩家摘要（動態 JSON，第三方 proxy）")))]
pub async fn steam_player(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_unconfigured() };
    passthrough_json(
        &state.http,
        &format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key={key}&steamids={id}"),
        None,
        "Failed to parse Steam API response",
        "Failed to fetch Steam data",
    )
    .await
}

#[utoipa::path(get, path = "/api/steam/recent-games", tag = "integrations",
    responses((status = 200, description = "Steam 近期遊玩遊戲（動態 JSON，第三方 proxy）")))]
pub async fn steam_recent_games(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_unconfigured() };
    passthrough_json(
        &state.http,
        &format!("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key={key}&steamid={id}&format=json"),
        None,
        "Failed to parse Steam API response",
        "Failed to fetch Steam data",
    )
    .await
}

#[utoipa::path(get, path = "/api/steam/owned-games", tag = "integrations",
    responses((status = 200, description = "Steam 擁有遊戲清單（動態 JSON，第三方 proxy）")))]
pub async fn steam_owned_games(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_unconfigured() };
    passthrough_json(
        &state.http,
        &format!("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key={key}&steamid={id}&include_appinfo=true&include_played_free_games=true&format=json"),
        None,
        "Failed to parse Steam API response",
        "Failed to fetch Steam data",
    )
    .await
}

#[utoipa::path(get, path = "/api/steam/achievements/{appid}", tag = "integrations",
    params(("appid" = String, Path)),
    responses((status = 200, description = "Steam 遊戲成就（動態 JSON，第三方 proxy）")))]
pub async fn steam_achievements(State(state): State<AppState>, Path(appid): Path<String>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_unconfigured() };
    passthrough_json(
        &state.http,
        &format!("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid={appid}&key={key}&steamid={id}"),
        None,
        "Failed to parse Steam API response",
        "Failed to fetch Steam achievements data",
    )
    .await
}

// ── Books 外部搜尋（Google Books + OpenLibrary fallback）──────────────────

/// Google Books 高解析度封面 URL 處理（JS .replace = 只換第一次出現）。
fn upgrade_google_cover(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    let mut cover = url.replacen("&zoom=1", "&zoom=0", 1).replacen("&edge=curl", "", 1).replacen(
        "&img=1",
        "&img=1&w=500&h=800",
        1,
    );
    if !cover.contains("zoom=") {
        cover.push_str("&zoom=0");
    }
    if !cover.contains("&w=") {
        cover.push_str("&w=500&h=800");
    }
    cover
}

fn s_or_empty(v: Option<&Value>) -> String {
    v.and_then(|x| x.as_str()).unwrap_or("").to_string()
}

async fn search_google_books(http: &reqwest::Client, q: &str) -> Vec<Value> {
    let url =
        format!("https://www.googleapis.com/books/v1/volumes?q={}&maxResults=10", encode_uri_component(q));
    let Some(data) = fetch_json(http, &url).await else { return vec![] };
    let Some(items) = data.get("items").and_then(|i| i.as_array()) else { return vec![] };
    items
        .iter()
        .map(|item| {
            let v = item.get("volumeInfo").cloned().unwrap_or_else(|| json!({}));
            let find_isbn = |t: &str| -> Option<String> {
                v.get("industryIdentifiers")?.as_array()?.iter().find_map(|id| {
                    (id.get("type").and_then(|x| x.as_str()) == Some(t))
                        .then(|| id.get("identifier").and_then(|x| x.as_str()).map(String::from))
                        .flatten()
                })
            };
            let isbn = find_isbn("ISBN_13").or_else(|| find_isbn("ISBN_10")).unwrap_or_default();
            let img = v.get("imageLinks");
            let cover_raw = ["large", "medium", "thumbnail", "smallThumbnail"]
                .iter()
                .find_map(|k| img.and_then(|i| i.get(*k)).and_then(|x| x.as_str()).filter(|s| !s.is_empty()))
                .unwrap_or("");
            let authors = v
                .get("authors")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let categories = v
                .get("categories")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default();
            let page_count =
                v.get("pageCount").filter(|x| js_truthy(Some(x))).cloned().unwrap_or(Value::Null);
            json!({
                "isbn": isbn,
                "title": s_or_empty(v.get("title")),
                "authors": authors,
                "publisher": s_or_empty(v.get("publisher")),
                "published_date": s_or_empty(v.get("publishedDate")),
                "description": s_or_empty(v.get("description")),
                "cover_url": upgrade_google_cover(cover_raw),
                "page_count": page_count,
                "language": s_or_empty(v.get("language")),
                "categories": categories,
                "source": "google",
            })
        })
        .collect()
}

async fn fetch_json(http: &reqwest::Client, url: &str) -> Option<Value> {
    let body = http.get(url).send().await.ok()?.text().await.ok()?;
    let mut v: Value = serde_json::from_str(&body).ok()?;
    crate::util::js_normalize_numbers(&mut v);
    Some(v)
}

async fn search_open_library(http: &reqwest::Client, input: &str, is_isbn: bool) -> Vec<Value> {
    if is_isbn {
        let clean: String = input.chars().filter(|c| *c != '-' && !c.is_whitespace()).collect();
        let url = format!("https://openlibrary.org/api/books?bibkeys=ISBN:{clean}&format=json&jscmd=data");
        let Some(data) = fetch_json(http, &url).await else { return vec![] };
        let key = format!("ISBN:{clean}");
        let Some(b) = data.get(&key) else { return vec![] };
        let names = |k: &str| -> String {
            b.get(k)
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default()
        };
        let description = b
            .get("notes")
            .and_then(|n| n.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| b.pointer("/excerpts/0/text").and_then(|t| t.as_str()).map(String::from))
            .unwrap_or_default();
        let cover = ["large", "medium", "small"]
            .iter()
            .find_map(|k| {
                b.pointer(&format!("/cover/{k}")).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
            })
            .unwrap_or("");
        let categories = b
            .get("subjects")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .take(5)
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        vec![json!({
            "isbn": clean,
            "title": s_or_empty(b.get("title")),
            "authors": names("authors"),
            "publisher": names("publishers"),
            "published_date": s_or_empty(b.get("publish_date")),
            "description": description,
            "cover_url": cover,
            "page_count": b.get("number_of_pages").filter(|x| js_truthy(Some(x))).cloned().unwrap_or(Value::Null),
            "language": "",
            "categories": categories,
            "source": "openlibrary",
        })]
    } else {
        let url = format!("https://openlibrary.org/search.json?q={}&limit=10", encode_uri_component(input));
        let Some(data) = fetch_json(http, &url).await else { return vec![] };
        let Some(docs) = data.get("docs").and_then(|d| d.as_array()) else { return vec![] };
        docs.iter()
            .take(10)
            .map(|d| {
                let year = d
                    .get("first_publish_year")
                    .filter(|x| js_truthy(Some(x)))
                    .map(crate::util::js_interp)
                    .unwrap_or_default();
                let cover = d
                    .get("cover_i")
                    .filter(|x| js_truthy(Some(x)))
                    .map(|c| format!("https://covers.openlibrary.org/b/id/{}-L.jpg", crate::util::js_interp(c)))
                    .unwrap_or_default();
                let subjects = d
                    .get("subject")
                    .and_then(|a| a.as_array())
                    .map(|a| a.iter().take(3).filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
                    .unwrap_or_default();
                json!({
                    "isbn": d.pointer("/isbn/0").and_then(|x| x.as_str()).unwrap_or(""),
                    "title": s_or_empty(d.get("title")),
                    "authors": d.get("author_name").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default(),
                    "publisher": d.pointer("/publisher/0").and_then(|x| x.as_str()).unwrap_or(""),
                    "published_date": year,
                    "description": "",
                    "cover_url": cover,
                    "page_count": d.get("number_of_pages_median").filter(|x| js_truthy(Some(x))).cloned().unwrap_or(Value::Null),
                    "language": d.pointer("/language/0").and_then(|x| x.as_str()).unwrap_or(""),
                    "categories": subjects,
                    "source": "openlibrary",
                })
            })
            .collect()
    }
}

#[derive(Debug, Deserialize)]
pub struct BookSearchQuery {
    query: Option<String>,
    isbn: Option<String>,
}

/// `GET /api/books/search/external` —— Google Books 為主、OpenLibrary 補位。
#[utoipa::path(get, path = "/api/books/search/external", tag = "integrations",
    responses((status = 200, description = "書籍外部搜尋（Google Books + OpenLibrary，動態 JSON，第三方 proxy）")))]
pub async fn books_search_external(
    State(state): State<AppState>,
    Query(q): Query<BookSearchQuery>,
) -> Response {
    let query = q.query.filter(|s| !s.is_empty());
    let isbn = q.isbn.filter(|s| !s.is_empty());
    let Some(input) = isbn.clone().or(query) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "請提供書名或 ISBN" }))).into_response();
    };
    let no_space: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    static ISBN_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"^[\d-]{10,17}$").unwrap());
    let is_isbn = ISBN_RE.is_match(&no_space);
    let search_query = if is_isbn {
        format!("isbn:{}", input.chars().filter(|c| *c != '-' && !c.is_whitespace()).collect::<String>())
    } else {
        input.clone()
    };

    let mut books = search_google_books(&state.http, &search_query).await;
    if books.is_empty() {
        books = search_open_library(&state.http, &input, is_isbn).await;
    }
    Json(json!({ "message": "success", "books": books })).into_response()
}

// ── steam/profile（SWR 快取 + miniprofile 客製解析）───────────────────────

const STEAM_PROFILE_REFRESH_AFTER: i64 = 30 * 60 * 1000;
const STEAM_PROFILE_RETRY_BACKOFF: i64 = 5 * 60 * 1000;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// _fetchHttps 等價（瀏覽器 UA；json 版套 number 正規化）。
async fn steam_fetch_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    let body = steam_fetch_text(http, url).await?;
    let mut v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    crate::util::js_normalize_numbers(&mut v);
    Ok(v)
}

async fn steam_fetch_text(http: &reqwest::Client, url: &str) -> Result<String, String> {
    http.get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// _parseMiniProfile 等價（4 條 regex；lookahead `(?!_frame)` 因後接 `\s+` 恆真，等價移除）。
fn parse_mini_profile(html: &str) -> Value {
    let mut out = Map::new();
    if html.is_empty() {
        return Value::Object(out);
    }
    let re = |p: &str| regex::RegexBuilder::new(p).case_insensitive(true).build().ok();
    if let Some(block) = re(r#"<video class=["']miniprofile_nameplate[^>]*>((?s:.*?))</video>"#)
        .and_then(|r| r.captures(html).map(|c| c.get(1).map(|m| m.as_str().to_string())))
        .flatten()
    {
        if let Some(w) = re(r#"src=["']([^"']+\.webm)["']"#)
            .and_then(|r| r.captures(&block).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
        {
            out.insert("nameplateWebm".into(), Value::from(w));
        }
        if let Some(m4) = re(r#"src=["']([^"']+\.mp4)["']"#)
            .and_then(|r| r.captures(&block).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
        {
            out.insert("nameplateMp4".into(), Value::from(m4));
        }
    }
    if let Some(f) = re(r#"playersection_avatar_frame[^>]*>\s*<img\s+src=["']([^"']+)["']"#)
        .and_then(|r| r.captures(html).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
    {
        out.insert("avatarFrame".into(), Value::from(f));
    }
    if let Some(a) = re(r#"playersection_avatar\s+[^"']*["'][^>]*>\s*<img\s+src=["']([^"']+)["']"#)
        .and_then(|r| r.captures(html).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
    {
        out.insert("animatedAvatar".into(), Value::from(a));
    }
    if let Some(c) = re(r#"<div class=["']miniprofile_featuredcontainer["']>\s*<img src=["']([^"']+)["'][^>]*class=["']badge_icon["']>\s*<div class=["']description["']>\s*<div class=["']name["']>([^<]+)</div>\s*<div class=["']xp["']>([^<]+)</div>"#)
        .and_then(|r| r.captures(html))
    {
        out.insert(
            "featuredBadge".into(),
            json!({
                "icon": c.get(1).map(|m| m.as_str()).unwrap_or(""),
                "name": c.get(2).map(|m| m.as_str().trim()).unwrap_or(""),
                "xp": c.get(3).map(|m| m.as_str().trim()).unwrap_or(""),
            }),
        );
    }
    Value::Object(out)
}

/// _refreshSteamProfile 等價（呼叫端負責 inflight dedup）。成功寫快取、失敗只更新 lastTriedAt。
async fn refresh_steam_profile(state: &AppState, key: &str, id: &str) -> Result<Value, String> {
    let account_id = match id.parse::<i64>() {
        Ok(n) => (n - 76_561_197_960_265_728i64).to_string(),
        Err(_) => {
            // invalid STEAM_ID：同樣走失敗路徑
            if let Some(c) = state.steam.cache.lock().as_mut() {
                c.last_tried_at = now_ms();
            }
            return Err("invalid STEAM_ID".to_string());
        }
    };
    let u1 =
        format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key={key}&steamids={id}");
    let u2 = format!("https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key={key}&steamid={id}");
    let u3 = format!("https://api.steampowered.com/IPlayerService/GetBadges/v1/?key={key}&steamid={id}");
    let u4 = format!("https://steamcommunity.com/miniprofile/{account_id}");
    let (player, level, badges, mini_html) = tokio::join!(
        steam_fetch_json(&state.http, &u1),
        steam_fetch_json(&state.http, &u2),
        steam_fetch_json(&state.http, &u3),
        steam_fetch_text(&state.http, &u4)
    );
    let result: Result<Value, String> = (|| {
        let player = player?;
        let level = level?;
        let badges = badges.unwrap_or(Value::Null);
        let player_obj = player.pointer("/response/players/0").cloned();
        let lvl = level.pointer("/response/player_level").cloned().filter(|v| !v.is_null());
        let (Some(player_obj), Some(lvl)) = (player_obj, lvl) else {
            return Err("incomplete response from Steam".to_string());
        };
        let customization = parse_mini_profile(&mini_html.unwrap_or_default());
        let badge_count =
            badges.pointer("/response/badges").and_then(|b| b.as_array()).map(|a| a.len()).unwrap_or(0);
        Ok(json!({
            "player": player_obj,
            "level": lvl,
            "xp": badges.pointer("/response/player_xp").cloned().filter(|v| !v.is_null()).unwrap_or(json!(0)),
            "xpToNext": badges.pointer("/response/player_xp_needed_to_level_up").cloned().filter(|v| !v.is_null()).unwrap_or(json!(0)),
            "badgeCount": badge_count,
            "customization": customization,
            "profileUrl": format!("https://steamcommunity.com/profiles/{id}"),
        }))
    })();
    match result {
        Ok(data) => {
            let now = now_ms();
            *state.steam.cache.lock() = Some(crate::state::SteamProfileCache {
                data: data.clone(),
                fetched_at: now,
                last_tried_at: now,
            });
            Ok(data)
        }
        Err(e) => {
            if let Some(c) = state.steam.cache.lock().as_mut() {
                c.last_tried_at = now_ms();
            }
            Err(e)
        }
    }
}

/// `GET /api/steam/profile` —— stale-while-revalidate：有快取直接回、過期背景重抓；
/// 首抓需等待（tokio Mutex dedup 併發重抓）。
#[utoipa::path(get, path = "/api/steam/profile", tag = "integrations",
    responses((status = 200, description = "Steam 個人檔案（含等級/徽章/客製，動態 JSON，第三方 proxy）")))]
pub async fn steam_profile(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Steam API 未配置" })))
            .into_response();
    };
    let now = now_ms();
    let cached = state.steam.cache.lock().clone();
    if let Some(c) = cached {
        let since_fetch = now - c.fetched_at;
        let since_try = now - c.last_tried_at;
        if since_fetch >= STEAM_PROFILE_REFRESH_AFTER && since_try >= STEAM_PROFILE_RETRY_BACKOFF {
            // 背景重抓（不 await；try_lock dedup）
            let st = state.clone();
            tokio::spawn(async move {
                if let Ok(_g) = st.steam.refresh_lock.try_lock() {
                    let _ = refresh_steam_profile(&st, &key, &id).await;
                }
            });
        }
        let mut out = c.data.as_object().cloned().unwrap_or_default();
        out.insert("_cachedAt".into(), json!(c.fetched_at));
        return Json(Value::Object(out)).into_response();
    }
    // 首抓：持鎖去重；等鎖期間別人可能已抓好 → 再查一次快取
    let _g = state.steam.refresh_lock.lock().await;
    if let Some(c) = state.steam.cache.lock().clone() {
        let mut out = c.data.as_object().cloned().unwrap_or_default();
        out.insert("_cachedAt".into(), json!(c.fetched_at));
        return Json(Value::Object(out)).into_response();
    }
    match refresh_steam_profile(&state, &key, &id).await {
        Ok(data) => {
            let fetched_at = state.steam.cache.lock().as_ref().map(|c| c.fetched_at).unwrap_or(now_ms());
            let mut out = data.as_object().cloned().unwrap_or_default();
            out.insert("_cachedAt".into(), json!(fetched_at));
            Json(Value::Object(out)).into_response()
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "steam fetch failed, no cache yet", "message": e })),
        )
            .into_response(),
    }
}
