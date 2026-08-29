//! 第三方 API 代理（github / wakatime / steam / books search）。
//! 共同原則（照抄 Express）：**不看上游狀態碼**（https.get 直接 parse body 回 200），
//! JSON parse 失敗與網路錯誤各有固定錯誤訊息；wakatime（axios）例外——非 2xx 會轉拋。

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::state::AppState;
use crate::util::{encode_uri_component, js_truthy, ser_js_number};

// ── 命名原則 ──────────────────────────────────────────────────────────────
// 這批端點把上游回應重新塑形成前端真正用得到的欄位（同 spotify 的做法）。
// 沿用上游欄位名（`playtime_forever`、`avatarfull`、`grand_total`…）——它們是
// Steam / WakaTime 的識別字，改名只會讓人對不上文件；我們自己發明的欄位
// （`gameCount`、`actualCodingTime`）用 camelCase，同站上其他端點。
//
// error 欄位是回應的一部分而非另一個型別：這批端點刻意**不看上游狀態碼**
// （照抄 Express），錯誤是放進同一個 JSON 讓前端讀 `.error` 的。

// ── 小工具 ────────────────────────────────────────────────────────────────

/// https.get 式代理：抓 URL、parse JSON、原樣回 200；parse 失敗/網路錯誤回指定訊息。
async fn passthrough_json(
    http: &reqwest::Client,
    url: &str,
    ua: Option<&str>,
    parse_err: &str,
    fetch_err: &str,
) -> Response {
    match fetch_json_lenient(http, url, ua, parse_err, fetch_err).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
    }
}

/// 抓 URL、parse JSON，**不看上游狀態碼**（照抄 Express）。網路錯誤／parse 失敗
/// 回固定訊息字串，讓呼叫端塞進自己回應的 `error` 欄位。
async fn fetch_json_lenient(
    http: &reqwest::Client,
    url: &str,
    ua: Option<&str>,
    parse_err: &str,
    fetch_err: &str,
) -> Result<Value, String> {
    let mut req = http.get(url);
    if let Some(u) = ua {
        req = req.header("User-Agent", u);
    }
    let resp = req.send().await.map_err(|_| fetch_err.to_string())?;
    let body = resp.text().await.map_err(|_| fetch_err.to_string())?;
    let mut v: Value = serde_json::from_str(&body).map_err(|_| parse_err.to_string())?;
    crate::util::js_normalize_numbers(&mut v);
    Ok(v)
}

// ⚠️ `iso_from_millis` 與 `civil_from_days` 原本在這裡也有一份，跟 util.rs 那份
// 逐字相同。手刻的曆法算式最怕兩份各自演化——錯了不會爆，只會讓某個日期差一天。
// 已經合併到 util.rs，那邊有「逐日對照 chrono 走完 1900–2200」的測試罩著。
use crate::util::{civil_from_days, iso_from_millis, now_ms};

/// 今日 UTC 日期字串（`new Date().toISOString().split('T')[0]`）。
fn today_utc() -> String {
    let (y, m, d) = civil_from_days(now_ms().div_euclid(86_400_000));
    format!("{y:04}-{m:02}-{d:02}")
}

// ── GitHub ────────────────────────────────────────────────────────────────

const GH_UA: &str = "Personal-Website-Backend";

/// ghFetch 等價：失敗回 None（Express resolve(null)）。
///
/// `base` 是 GitHub API 的 base URL（`state.external.github_api`）。傳進來而不是寫死，
/// 測試才攔得到——理由見 `state::ExternalUrls`。
async fn gh_fetch(http: &reqwest::Client, base: &str, path: &str, token: Option<&str>) -> Option<Value> {
    let mut req = http.get(format!("{base}{path}")).header("User-Agent", GH_UA);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let body = req.send().await.ok()?.text().await.ok()?;
    let mut v: Value = serde_json::from_str(&body).ok()?;
    crate::util::js_normalize_numbers(&mut v);
    Some(v)
}

const GH_PARSE_ERR: &str = "Failed to parse GitHub API response";
const GH_FETCH_ERR: &str = "Failed to fetch GitHub data";

/// `GET /api/github/user/:username`
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubUserResponse {
    pub login: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub public_repos: Option<i64>,
    pub error: Option<String>,
}

/// `GET /api/github/user/:username` —— 原本是原樣代理 GitHub 回應，改成只回上面五欄。
///
/// 順手修掉一個 bug：GitHub 的錯誤物件是 `{message, documentation_url}`，沒有 `error`，
/// 而前端一直在檢查 `.error`——所以 404 / rate limit 以前是「一個所有欄位都 undefined
/// 的使用者物件」悄悄穿過去。現在把 GitHub 的 message 收進 error 欄位。
#[utoipa::path(get, path = "/api/github/user/{username}", tag = "integrations",
    params(("username" = String, Path)),
    responses((status = 200, body = GithubUserResponse)))]
pub async fn github_user(State(state): State<AppState>, Path(username): Path<String>) -> Response {
    let url = format!("{}/users/{username}", state.external.github_api);
    let v = match fetch_json_lenient(&state.http, &url, Some(GH_UA), GH_PARSE_ERR, GH_FETCH_ERR).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(GithubUserResponse { error: Some(e), ..Default::default() }),
            )
                .into_response();
        }
    };
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    // 上游狀態碼一律不看（維持既有契約），錯誤走 error 欄位
    Json(GithubUserResponse {
        login: s("login"),
        name: s("name"),
        avatar_url: s("avatar_url"),
        html_url: s("html_url"),
        public_repos: v.get("public_repos").and_then(serde_json::Value::as_i64),
        error: s("message"),
    })
    .into_response()
}

/// `GET /api/github/repos/:username` 的一列。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubRepo {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub name: String,
    pub html_url: String,
    pub description: Option<String>,
    pub language: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub stargazers_count: i64,
}

/// `GET /api/github/repos/:username`
///
/// 這支以前不存在——前端直接從瀏覽器打 `api.github.com/users/:u/repos`。那條路是
/// **未認證**的，額度 60 req/hr 且是算在**讀者的 IP** 上；共用出口（公司 NAT、CGNAT、
/// VPN）額滿時這一區會靜默空白。收進後端就吃得到 GITHUB_TOKEN 的 5000/hr。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubReposResponse {
    pub repos: Vec<GithubRepo>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReposQuery {
    limit: Option<u32>,
}

/// `GET /api/github/repos/:username` —— 依最後更新排序取前 N（預設 5）。
#[utoipa::path(get, path = "/api/github/repos/{username}", tag = "integrations",
    params(("username" = String, Path), ("limit" = Option<u32>, Query)),
    responses((status = 200, body = GithubReposResponse)))]
pub async fn github_repos(
    State(state): State<AppState>,
    Path(username): Path<String>,
    Query(q): Query<ReposQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(5).clamp(1, 100);
    let token = std::env::var("GITHUB_TOKEN").ok().filter(|s| !s.is_empty());
    let path = format!("/users/{username}/repos?sort=updated&per_page={limit}");
    let Some(v) = gh_fetch(&state.http, &state.external.github_api, &path, token.as_deref()).await else {
        return Json(GithubReposResponse { repos: vec![], error: Some(GH_FETCH_ERR.to_string()) })
            .into_response();
    };
    let Some(arr) = v.as_array() else {
        // GitHub 錯誤物件（{message,…}）→ error 欄位，維持「不看上游狀態碼」的既有契約
        let error = v.get("message").and_then(|m| m.as_str()).map(String::from);
        return Json(GithubReposResponse { repos: vec![], error }).into_response();
    };
    let repos = arr
        .iter()
        .filter_map(|r| {
            // id / name / html_url 缺任一就整筆不收：那三個是 render 一張卡片的必需品
            Some(GithubRepo {
                id: r.get("id").and_then(serde_json::Value::as_i64)?,
                name: r.get("name").and_then(|x| x.as_str())?.to_string(),
                html_url: r.get("html_url").and_then(|x| x.as_str())?.to_string(),
                description: r.get("description").and_then(|x| x.as_str()).map(String::from),
                language: r.get("language").and_then(|x| x.as_str()).map(String::from),
                stargazers_count: r.get("stargazers_count").and_then(serde_json::Value::as_i64).unwrap_or(0),
            })
        })
        .collect();
    Json(GithubReposResponse { repos, error: None }).into_response()
}

/// 貢獻熱圖的一天。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubContributionDay {
    /// `YYYY-MM-DD`
    pub date: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
}

/// `GET /api/github/contributions/:username`
///
/// 以前是前端直接打第三方的 `github-contributions-api.jogruber.de`——那是一個**爬
/// GitHub 個人頁 HTML** 的服務。GitHub 的 REST API 沒有貢獻資料，但 GraphQL 有官方的
/// `contributionsCollection.contributionCalendar`，而我們本來就有 token，所以不是把
/// jogruber 代理起來，是直接不需要它了。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubContributionsResponse {
    pub contributions: Vec<GithubContributionDay>,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContributionsQuery {
    /// 西元年；省略或 "last" 都代表「最近一年」
    year: Option<String>,
}

/// `GET /api/github/contributions/:username?year=2025`
#[utoipa::path(get, path = "/api/github/contributions/{username}", tag = "integrations",
    params(("username" = String, Path), ("year" = Option<String>, Query)),
    responses((status = 200, body = GithubContributionsResponse)))]
pub async fn github_contributions(
    State(state): State<AppState>,
    Path(username): Path<String>,
    Query(q): Query<ContributionsQuery>,
) -> Response {
    let err = |m: String| {
        Json(GithubContributionsResponse { error: Some(m), ..Default::default() }).into_response()
    };
    let Some(token) = std::env::var("GITHUB_TOKEN").ok().filter(|s| !s.is_empty()) else {
        return err("GITHUB_TOKEN 未設定（GraphQL 一定要認證）".into());
    };
    // year 只接受四位數字：它會被拼進 GraphQL 的 ISO 時間字串
    let range = match q.year.as_deref().filter(|y| *y != "last") {
        Some(y) if y.len() == 4 && y.bytes().all(|b| b.is_ascii_digit()) => {
            Some((format!("{y}-01-01T00:00:00Z"), format!("{y}-12-31T23:59:59Z")))
        }
        Some(_) => return err("year 格式不正確".into()),
        // 不帶 from/to：GraphQL 預設就是最近一年
        None => None,
    };
    // 不帶 from/to 時 GraphQL 預設就是「最近一年」，所以整組引數直接省略
    let args = match &range {
        Some((f, t)) => format!(r#"(from: "{f}", to: "{t}")"#),
        None => String::new(),
    };
    // login 走 GraphQL variable（不拼字串）；from/to 上面已經驗過只有四位數字組成
    let query = format!(
        r"query($login: String!) {{
             user(login: $login) {{
               contributionsCollection{args} {{
                 contributionCalendar {{
                   totalContributions
                   weeks {{ contributionDays {{ date contributionCount }} }}
                 }}
               }}
             }}
           }}"
    );
    let body = json!({ "query": query, "variables": { "login": username } }).to_string();
    let resp = state
        .http
        .post(format!("{}/graphql", state.external.github_api))
        .header("User-Agent", GH_UA)
        .bearer_auth(&token)
        .header("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .body(body)
        .send()
        .await;
    let Ok(resp) = resp else { return err(GH_FETCH_ERR.into()) };
    let Ok(text) = resp.text().await else { return err(GH_FETCH_ERR.into()) };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return err(GH_PARSE_ERR.into()) };
    // GraphQL 的錯誤是 200 + {errors:[…]}，不是狀態碼
    if let Some(msg) = v.pointer("/errors/0/message").and_then(|m| m.as_str()) {
        return err(msg.to_string());
    }
    let cal = v.pointer("/data/user/contributionsCollection/contributionCalendar");
    let contributions: Vec<GithubContributionDay> = cal
        .and_then(|c| c.get("weeks"))
        .and_then(|w| w.as_array())
        .map(|weeks| {
            weeks
                .iter()
                .filter_map(|w| w.get("contributionDays").and_then(|d| d.as_array()))
                .flatten()
                .filter_map(|d| {
                    Some(GithubContributionDay {
                        date: d.get("date").and_then(|x| x.as_str())?.to_string(),
                        count: d.get("contributionCount").and_then(serde_json::Value::as_i64).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let total =
        cal.and_then(|c| c.get("totalContributions")).and_then(serde_json::Value::as_i64).unwrap_or(0);
    Json(GithubContributionsResponse { contributions, total, error: None }).into_response()
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubCommitAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// PushEvent 的一個 commit。sha 缺的 commit 直接不收——沒有 sha 就連不出 commit 連結，
/// 收進來只是把「可能是 null」傳染給前端。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubCommit {
    pub sha: String,
    pub message: String,
    pub author: Option<GithubCommitAuthor>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubEventRepo {
    /// `owner/repo`
    pub name: String,
}

/// 只保留 PushEvent 用得到的欄位。其他事件型別的 payload 會是空 commits + null
/// ——前端只 render PushEvent，這裡不為沒人看的事件型別各建一份形狀。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubEventPayload {
    pub commits: Vec<GithubCommit>,
    pub before: Option<String>,
    pub head: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub size: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub repo: GithubEventRepo,
    pub created_at: String,
    pub payload: GithubEventPayload,
}

/// `GET /api/github/events/:username`
///
/// 原本直接回一個 JSON 陣列（GitHub 錯誤時回 GitHub 的錯誤物件），而前端的型別寫成
/// `GithubEvent[] & { error?: string }` —— 陣列身上不會有 `.error`，那個交集型別是假的。
/// 改成包一層讓 error 成為真的欄位。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct GithubEventsResponse {
    pub events: Vec<GithubEvent>,
    pub error: Option<String>,
}

/// `GET /api/github/events/:username` —— **一律用 /events/public**（只回公開事件）。
/// 有 token 時仍帶（拉高 rate limit + 供下面 enrich 空 commits 的 compare API 用），
/// 但端點固定 public：否則帶自己的 token 打 /events 會連**私有 repo 的 push 也回傳**（隱私外洩）。
#[utoipa::path(get, path = "/api/github/events/{username}", tag = "integrations",
    params(("username" = String, Path)),
    responses((status = 200, body = GithubEventsResponse)))]
pub async fn github_events(State(state): State<AppState>, Path(username): Path<String>) -> Response {
    let token = std::env::var("GITHUB_TOKEN").ok().filter(|s| !s.is_empty());
    let path = format!("/users/{username}/events/public?per_page=30");
    let events = gh_fetch(&state.http, &state.external.github_api, &path, token.as_deref()).await;

    let Some(Value::Array(mut events)) = events else {
        // GitHub 錯誤物件（{message,…}）→ error 欄位；抓不到 / null → 空清單
        let error = events
            .as_ref()
            .and_then(|v| v.get("message"))
            .and_then(|m| m.as_str())
            .map(String::from)
            .or_else(|| events.is_none().then(|| GH_FETCH_ERR.to_string()));
        return Json(GithubEventsResponse { events: vec![], error }).into_response();
    };

    if let Some(t) = &token {
        for ev in &mut events {
            let is_push = ev.get("type").and_then(|v| v.as_str()) == Some("PushEvent");
            if !is_push {
                continue;
            }
            let p = ev.get("payload");
            let commits_empty = p
                .and_then(|p| p.get("commits"))
                .and_then(|c| c.as_array())
                .is_none_or(std::vec::Vec::is_empty);
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
            let cmp = gh_fetch(&state.http, &state.external.github_api, &cmp_path, Some(t)).await;
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
    Json(GithubEventsResponse { events: events.iter().filter_map(github_event_from).collect(), error: None })
        .into_response()
}

/// GitHub 事件 → 我們的形狀。id / type / repo.name / created_at 任一缺就整筆不收：
/// 那四個欄位是前端 render 一列必需的，缺了也沒東西可顯示。
fn github_event_from(ev: &Value) -> Option<GithubEvent> {
    let s = |k: &str| ev.get(k).and_then(|v| v.as_str()).map(String::from);
    let repo = ev.pointer("/repo/name").and_then(|v| v.as_str()).map(String::from);
    let (Some(id), Some(kind), Some(repo), Some(created_at)) = (s("id"), s("type"), repo, s("created_at"))
    else {
        tracing::warn!("[github] 跳過缺 id/type/repo.name/created_at 的事件");
        return None;
    };
    let p = ev.get("payload");
    let ps = |k: &str| p.and_then(|p| p.get(k)).and_then(|v| v.as_str()).map(String::from);
    let commits = p
        .and_then(|p| p.get("commits"))
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let sha = c.get("sha").and_then(|v| v.as_str())?.to_string();
                    let author = c.get("author").and_then(|a| a.as_object()).map(|a| GithubCommitAuthor {
                        name: a.get("name").and_then(|v| v.as_str()).map(String::from),
                        email: a.get("email").and_then(|v| v.as_str()).map(String::from),
                    });
                    let message = c.get("message").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    Some(GithubCommit { sha, message, author })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(GithubEvent {
        id,
        kind,
        repo: GithubEventRepo { name: repo },
        created_at,
        payload: GithubEventPayload {
            commits,
            before: ps("before"),
            head: ps("head"),
            size: p.and_then(|p| p.get("size")).and_then(serde_json::Value::as_i64),
        },
    })
}

// ── WakaTime ──────────────────────────────────────────────────────────────

use base64::Engine;

fn wakatime_key() -> Option<String> {
    std::env::var("WAKATIME_API_KEY").ok().filter(|s| !s.is_empty())
}

fn waka_auth(key: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(key))
}

const WAKA_UNCONFIGURED: &str = "WakaTime API 未配置（請在 server/.env 設置 WAKATIME_API_KEY）";

/// WakaTime 的 `grand_total`（前端只用 text，total_seconds 一起帶著方便日後算）。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WakatimeGrandTotal {
    pub text: Option<String>,
    #[serde(serialize_with = "crate::util::ser_js_number_opt")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub total_seconds: Option<f64>,
}

/// durations 端點算出來的「實際編碼區間」——第一筆的開始到最後一筆的結束。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WakatimeActualCodingTime {
    pub start: Option<String>,
    pub end: Option<String>,
    #[serde(rename = "hasData")]
    pub has_data: bool,
}

/// `GET /api/wakatime/today`
///
/// 原本回 WakaTime 的 `{data:[summary], start, end}` 加上 actualCodingTime，
/// summary 是一整包（categories / editors / machines / …）而前端只讀
/// `data[0].grand_total.text`。這裡把那個只有一個元素的陣列攤掉。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WakatimeTodayResponse {
    pub grand_total: Option<WakatimeGrandTotal>,
    /// WakaTime 回的查詢區間（非「實際編碼」區間）
    pub start: Option<String>,
    pub end: Option<String>,
    #[serde(rename = "actualCodingTime")]
    pub actual_coding_time: WakatimeActualCodingTime,
    pub error: Option<String>,
    /// 上游的錯誤內容（原本叫 details，是 parse 過的 body；這裡轉字串好進型別）
    pub details: Option<String>,
}

/// stats 端點的一列（語言 / 專案共用同一個形狀）。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WakatimeStat {
    pub name: String,
    pub text: String,
    #[serde(serialize_with = "ser_js_number")]
    #[specta(type = specta_typescript::Number)]
    pub percent: f64,
}

/// `GET /api/wakatime/week`、`GET /api/wakatime/projects`
///
/// 原本回 WakaTime 的 `{data:{languages, projects, editors, …}}` 原樣，前端讀 `.data`。
/// 這裡把 data 攤掉、只留前端會 render 的兩組。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct WakatimeStatsResponse {
    pub languages: Vec<WakatimeStat>,
    pub projects: Vec<WakatimeStat>,
    pub error: Option<String>,
    pub details: Option<String>,
}

fn waka_stats_from(data: &Value) -> Vec<WakatimeStat> {
    data.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some(WakatimeStat {
                        name: x.get("name").and_then(|v| v.as_str())?.to_string(),
                        text: x.get("text").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        percent: x.get("percent").and_then(serde_json::Value::as_f64).unwrap_or(0.0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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
    let mut v: Value = serde_json::from_str(&body).unwrap_or_else(|_| Value::from(body));
    crate::util::js_normalize_numbers(&mut v);
    if status.is_success() { Ok(v) } else { Err((status, v)) }
}

/// 上游錯誤 → (狀態碼, error, details)。details 原本是 parse 過的 body，轉字串好進型別。
fn waka_err_parts(kind: &str, e: (StatusCode, Value)) -> (StatusCode, Option<String>, Option<String>) {
    let details = match e.1 {
        Value::String(s) => Some(s),
        Value::Null => None,
        v => Some(v.to_string()),
    };
    (e.0, Some(kind.to_string()), details)
}

/// `GET /api/wakatime/today` —— summaries + durations 並行，合併 actualCodingTime。
#[utoipa::path(get, path = "/api/wakatime/today", tag = "integrations",
    responses((status = 200, body = WakatimeTodayResponse)))]
pub async fn wakatime_today(State(state): State<AppState>) -> Response {
    let Some(key) = wakatime_key() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WakatimeTodayResponse { error: Some(WAKA_UNCONFIGURED.to_string()), ..Default::default() }),
        )
            .into_response();
    };
    let date = today_utc();
    let base = &state.external.wakatime;
    let url_summary = format!("{base}/api/v1/users/current/summaries?start={date}&end={date}");
    let url_durations = format!("{base}/api/v1/users/current/durations?date={date}");
    let (summary, durations) =
        tokio::join!(waka_get(&state.http, &url_summary, &key), waka_get(&state.http, &url_durations, &key));
    let today_err = |e| {
        let (status, error, details) = waka_err_parts("Failed to fetch WakaTime today data", e);
        (status, Json(WakatimeTodayResponse { error, details, ..Default::default() })).into_response()
    };
    let summary = match summary {
        Ok(v) => v,
        Err(e) => return today_err(e),
    };
    let durations = match durations {
        Ok(v) => v,
        Err(e) => return today_err(e),
    };

    let dur_list: Vec<&Value> =
        durations.get("data").and_then(|d| d.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
    let mut actual_start: Option<f64> = None;
    let mut actual_end: Option<f64> = None;
    for d in &dur_list {
        if let Some(t) = d.get("time").and_then(serde_json::Value::as_f64) {
            actual_start = Some(actual_start.map_or(t, |e| e.min(t)));
            let end = t + d.get("duration").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
            actual_end = Some(actual_end.map_or(end, |e| e.max(end)));
        }
    }
    let gt = summary.pointer("/data/0/grand_total");

    Json(WakatimeTodayResponse {
        grand_total: gt.map(|g| WakatimeGrandTotal {
            text: g.get("text").and_then(|v| v.as_str()).map(String::from),
            total_seconds: g.get("total_seconds").and_then(serde_json::Value::as_f64),
        }),
        start: summary.get("start").and_then(|v| v.as_str()).map(String::from),
        end: summary.get("end").and_then(|v| v.as_str()).map(String::from),
        actual_coding_time: WakatimeActualCodingTime {
            // JS new Date(x*1000)：ms 取整（ToInteger 截斷）。Rust 的 f64→i64 是飽和轉換，
            // 這裡要的就是 JS 那個截斷語意，不是「可能出錯的轉換」。
            #[allow(clippy::cast_possible_truncation, reason = "刻意複製 JS ToInteger 的截斷語意")]
            start: actual_start.map(|t| iso_from_millis((t * 1000.0) as i64)),
            #[allow(clippy::cast_possible_truncation, reason = "刻意複製 JS ToInteger 的截斷語意")]
            end: actual_end.map(|t| iso_from_millis((t * 1000.0) as i64)),
            has_data: !dur_list.is_empty(),
        },
        error: None,
        details: None,
    })
    .into_response()
}

/// week / projects 共用（同一支 stats API，只差錯誤字串）。
async fn wakatime_stats(state: &AppState, err_kind: &str) -> Response {
    let Some(key) = wakatime_key() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(WakatimeStatsResponse { error: Some(WAKA_UNCONFIGURED.to_string()), ..Default::default() }),
        )
            .into_response();
    };
    let stats_url = format!("{}/api/v1/users/current/stats/last_7_days", state.external.wakatime);
    match waka_get(&state.http, &stats_url, &key).await {
        Ok(v) => Json(WakatimeStatsResponse {
            languages: waka_stats_from(v.pointer("/data/languages").unwrap_or(&Value::Null)),
            projects: waka_stats_from(v.pointer("/data/projects").unwrap_or(&Value::Null)),
            error: None,
            details: None,
        })
        .into_response(),
        Err(e) => {
            let (status, error, details) = waka_err_parts(err_kind, e);
            (status, Json(WakatimeStatsResponse { error, details, ..Default::default() })).into_response()
        }
    }
}

#[utoipa::path(get, path = "/api/wakatime/week", tag = "integrations",
    responses((status = 200, body = WakatimeStatsResponse)))]
pub async fn wakatime_week(State(state): State<AppState>) -> Response {
    wakatime_stats(&state, "Failed to fetch WakaTime week data").await
}

/// ⚠️ 與 `/week` 打同一支上游 API、回同一份資料，差別只有錯誤字串（Express 就這樣，照抄）。
/// 前端只用 `/week`。
#[utoipa::path(get, path = "/api/wakatime/projects", tag = "integrations",
    responses((status = 200, body = WakatimeStatsResponse)))]
pub async fn wakatime_projects(State(state): State<AppState>) -> Response {
    wakatime_stats(&state, "Failed to fetch WakaTime projects data").await
}

// ── Steam（純代理 4 支；/steam/profile 有 SWR 快取留 proxy）────────────────

fn steam_env() -> Option<(String, String)> {
    let key = std::env::var("STEAM_API_KEY").ok().filter(|s| !s.is_empty())?;
    let id = std::env::var("STEAM_ID").ok().filter(|s| !s.is_empty())?;
    Some((key, id))
}

const STEAM_UNCONFIGURED: &str = "Steam API 未配置（請在 server/.env 設置 STEAM_API_KEY 和 STEAM_ID）";
const STEAM_PARSE_ERR: &str = "Failed to parse Steam API response";
const STEAM_FETCH_ERR: &str = "Failed to fetch Steam data";

/// GetPlayerSummaries 的 `players[0]` 裡我們用得到的欄位（欄位名沿用 Steam 的）。
#[derive(Debug, Clone, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamPlayer {
    pub personaname: Option<String>,
    pub avatarfull: Option<String>,
    pub profileurl: Option<String>,
    /// Steam 的狀態 enum（1 = 上線）
    #[specta(type = Option<specta_typescript::Number>)]
    pub personastate: Option<i64>,
    /// 正在玩的 appid。Steam 這欄回**字串**不是數字（有值就代表在遊戲中）
    pub gameid: Option<String>,
}

/// `GET /api/steam/player`
///
/// 原本原樣回 Steam 的 `{response:{players:[…]}}`，前端自己挖 `response.players[0]`。
/// 這裡把那層挖掉——一個 steamid 就只會有一個 player。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamPlayerResponse {
    pub player: Option<SteamPlayer>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamGame {
    #[specta(type = Option<specta_typescript::Number>)]
    pub appid: Option<i64>,
    pub name: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub playtime_2weeks: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub playtime_forever: Option<i64>,
}

/// `GET /api/steam/recent-games` 與 `GET /api/steam/owned-games`
/// （`gameCount` 只有 owned-games 會有；那是我們自己的欄位名，故 camelCase）。
#[derive(Debug, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamGamesResponse {
    pub games: Vec<SteamGame>,
    #[serde(rename = "gameCount")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub game_count: Option<i64>,
    pub error: Option<String>,
}

fn steam_games_from(v: &Value) -> Vec<SteamGame> {
    v.pointer("/response/games")
        .and_then(|g| g.as_array())
        .map(|a| {
            a.iter()
                .map(|g| SteamGame {
                    appid: g.get("appid").and_then(serde_json::Value::as_i64),
                    name: g.get("name").and_then(|x| x.as_str()).map(String::from),
                    playtime_2weeks: g.get("playtime_2weeks").and_then(serde_json::Value::as_i64),
                    playtime_forever: g.get("playtime_forever").and_then(serde_json::Value::as_i64),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[utoipa::path(get, path = "/api/steam/player", tag = "integrations",
    responses((status = 200, body = SteamPlayerResponse)))]
pub async fn steam_player(State(state): State<AppState>) -> Response {
    let unconf = || {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SteamPlayerResponse { error: Some(STEAM_UNCONFIGURED.to_string()), ..Default::default() }),
        )
            .into_response()
    };
    let Some((key, id)) = steam_env() else { return unconf() };
    let url =
        format!("{}/ISteamUser/GetPlayerSummaries/v0002/?key={key}&steamids={id}", state.external.steam_api);
    match fetch_json_lenient(&state.http, &url, None, STEAM_PARSE_ERR, STEAM_FETCH_ERR).await {
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SteamPlayerResponse { error: Some(e), ..Default::default() }),
        )
            .into_response(),
        Ok(v) => Json(SteamPlayerResponse {
            player: v.pointer("/response/players/0").map(steam_player_from),
            error: None,
        })
        .into_response(),
    }
}

fn steam_player_from(p: &Value) -> SteamPlayer {
    let s = |k: &str| p.get(k).and_then(|v| v.as_str()).map(String::from);
    SteamPlayer {
        personaname: s("personaname"),
        avatarfull: s("avatarfull"),
        profileurl: s("profileurl"),
        personastate: p.get("personastate").and_then(serde_json::Value::as_i64),
        gameid: s("gameid"),
    }
}

/// recent-games / owned-games 共用（只差 URL 與要不要帶 gameCount）。
async fn steam_games(state: &AppState, url: &str, with_count: bool) -> Response {
    match fetch_json_lenient(&state.http, url, None, STEAM_PARSE_ERR, STEAM_FETCH_ERR).await {
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(SteamGamesResponse { error: Some(e), ..Default::default() }),
        )
            .into_response(),
        Ok(v) => Json(SteamGamesResponse {
            games: steam_games_from(&v),
            game_count: with_count
                .then(|| v.pointer("/response/game_count").and_then(serde_json::Value::as_i64))
                .flatten(),
            error: None,
        })
        .into_response(),
    }
}

fn steam_games_unconfigured() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(SteamGamesResponse { error: Some(STEAM_UNCONFIGURED.to_string()), ..Default::default() }),
    )
        .into_response()
}

#[utoipa::path(get, path = "/api/steam/recent-games", tag = "integrations",
    responses((status = 200, body = SteamGamesResponse)))]
pub async fn steam_recent_games(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_games_unconfigured() };
    let url = format!(
        "{}/IPlayerService/GetRecentlyPlayedGames/v0001/?key={key}&steamid={id}&format=json",
        state.external.steam_api
    );
    steam_games(&state, &url, false).await
}

#[utoipa::path(get, path = "/api/steam/owned-games", tag = "integrations",
    responses((status = 200, body = SteamGamesResponse)))]
pub async fn steam_owned_games(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_games_unconfigured() };
    let url = format!(
        "{}/IPlayerService/GetOwnedGames/v0001/?key={key}&steamid={id}&include_appinfo=true&include_played_free_games=true&format=json",
        state.external.steam_api
    );
    steam_games(&state, &url, true).await
}

fn steam_unconfigured() -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": STEAM_UNCONFIGURED }))).into_response()
}

/// ⚠️ 這支**刻意留原樣代理**：站上沒有任何地方消費它，要 typed 就得替一份沒人看的
/// Steam 成就形狀憑空造型別。等真的有人用再收。
#[utoipa::path(get, path = "/api/steam/achievements/{appid}", tag = "integrations",
    params(("appid" = String, Path)),
    responses((status = 200, description = "Steam 遊戲成就（動態 JSON，唯一保留的原樣代理）")))]
pub async fn steam_achievements(State(state): State<AppState>, Path(appid): Path<String>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_unconfigured() };
    passthrough_json(
        &state.http,
        &format!(
            "{}/ISteamUserStats/GetPlayerAchievements/v0001/?appid={appid}&key={key}&steamid={id}",
            state.external.steam_api
        ),
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

/// `base` 是 Google Books 的 base URL（`state.external.google_books`）。
async fn search_google_books(http: &reqwest::Client, base: &str, q: &str) -> Vec<Value> {
    let url = format!("{base}/books/v1/volumes?q={}&maxResults=10", encode_uri_component(q));
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

/// `base` 是 Open Library 的 base URL（`state.external.openlibrary`）。
async fn search_open_library(http: &reqwest::Client, base: &str, input: &str, is_isbn: bool) -> Vec<Value> {
    if is_isbn {
        let clean: String = input.chars().filter(|c| *c != '-' && !c.is_whitespace()).collect();
        let url = format!("{base}/api/books?bibkeys=ISBN:{clean}&format=json&jscmd=data");
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
        let url = format!("{base}/search.json?q={}&limit=10", encode_uri_component(input));
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
        std::sync::LazyLock::new(|| regex::Regex::new(r"^[\d-]{10,17}$").expect("字面 regex"));
    let is_isbn = ISBN_RE.is_match(&no_space);
    let search_query = if is_isbn {
        format!("isbn:{}", input.chars().filter(|c| *c != '-' && !c.is_whitespace()).collect::<String>())
    } else {
        input.clone()
    };

    let mut books = search_google_books(&state.http, &state.external.google_books, &search_query).await;
    if books.is_empty() {
        books = search_open_library(&state.http, &state.external.openlibrary, &input, is_isbn).await;
    }
    Json(json!({ "message": "success", "books": books })).into_response()
}

// ── steam/profile（SWR 快取 + miniprofile 客製解析）───────────────────────

const STEAM_PROFILE_REFRESH_AFTER: i64 = 30 * 60 * 1000;
const STEAM_PROFILE_RETRY_BACKOFF: i64 = 5 * 60 * 1000;

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
fn parse_mini_profile(html: &str) -> SteamCustomization {
    let mut out = SteamCustomization::default();
    if html.is_empty() {
        return out;
    }
    let re = |p: &str| regex::RegexBuilder::new(p).case_insensitive(true).build().ok();
    if let Some(block) = re(r#"<video class=["']miniprofile_nameplate[^>]*>((?s:.*?))</video>"#)
        .and_then(|r| r.captures(html).map(|c| c.get(1).map(|m| m.as_str().to_string())))
        .flatten()
    {
        out.nameplate_webm = re(r#"src=["']([^"']+\.webm)["']"#)
            .and_then(|r| r.captures(&block).and_then(|c| c.get(1).map(|m| m.as_str().to_string())));
        out.nameplate_mp4 = re(r#"src=["']([^"']+\.mp4)["']"#)
            .and_then(|r| r.captures(&block).and_then(|c| c.get(1).map(|m| m.as_str().to_string())));
    }
    out.avatar_frame = re(r#"playersection_avatar_frame[^>]*>\s*<img\s+src=["']([^"']+)["']"#)
        .and_then(|r| r.captures(html).and_then(|c| c.get(1).map(|m| m.as_str().to_string())));
    out.animated_avatar = re(r#"playersection_avatar\s+[^"']*["'][^>]*>\s*<img\s+src=["']([^"']+)["']"#)
        .and_then(|r| r.captures(html).and_then(|c| c.get(1).map(|m| m.as_str().to_string())));
    if let Some(c) = re(r#"<div class=["']miniprofile_featuredcontainer["']>\s*<img src=["']([^"']+)["'][^>]*class=["']badge_icon["']>\s*<div class=["']description["']>\s*<div class=["']name["']>([^<]+)</div>\s*<div class=["']xp["']>([^<]+)</div>"#)
        .and_then(|r| r.captures(html))
    {
        out.featured_badge = Some(SteamFeaturedBadge {
            icon: c.get(1).map_or("", |m| m.as_str()).to_string(),
            name: c.get(2).map_or("", |m| m.as_str().trim()).to_string(),
            xp: c.get(3).map_or("", |m| m.as_str().trim()).to_string(),
        });
    }
    out
}

/// miniprofile 頁面刮下來的展示徽章（三個都是 regex 捕獲組，必為字串）。
#[derive(Debug, Clone, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamFeaturedBadge {
    pub icon: String,
    pub name: String,
    /// Steam 頁面上是 "1,234 XP" 這種已格式化的字串，不是數字
    pub xp: String,
}

/// miniprofile 客製（動態頭像 / 頭像框 / 名牌動畫）。抓不到的就是 None。
#[derive(Debug, Clone, Default, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamCustomization {
    #[serde(rename = "animatedAvatar")]
    pub animated_avatar: Option<String>,
    #[serde(rename = "avatarFrame")]
    pub avatar_frame: Option<String>,
    #[serde(rename = "nameplateWebm")]
    pub nameplate_webm: Option<String>,
    #[serde(rename = "nameplateMp4")]
    pub nameplate_mp4: Option<String>,
    #[serde(rename = "featuredBadge")]
    pub featured_badge: Option<SteamFeaturedBadge>,
}

/// `/api/steam/profile` 的資料本體（＝快取內容）。
#[derive(Debug, Clone, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamProfile {
    pub player: SteamPlayer,
    #[specta(type = specta_typescript::Number)]
    pub level: i64,
    #[specta(type = specta_typescript::Number)]
    pub xp: i64,
    #[serde(rename = "xpToNext")]
    #[specta(type = specta_typescript::Number)]
    pub xp_to_next: i64,
    #[serde(rename = "badgeCount")]
    #[specta(type = specta_typescript::Number)]
    pub badge_count: i64,
    pub customization: SteamCustomization,
    #[serde(rename = "profileUrl")]
    pub profile_url: String,
}

/// `GET /api/steam/profile`
///
/// `_cachedAt` 是伺服器記帳（SWR 的抓取時間），不是 profile 的一部分——所以它在
/// 回應型別上，而快取只存 profile 本體（同 watch/now 把 expiresAt 移出 wire type）。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SteamProfileResponse {
    #[serde(flatten)]
    pub profile: SteamProfile,
    /// epoch ms
    #[serde(rename = "_cachedAt")]
    #[specta(type = specta_typescript::Number)]
    pub cached_at: i64,
}

/// _refreshSteamProfile 等價（呼叫端負責 inflight dedup）。成功寫快取、失敗只更新 lastTriedAt。
async fn refresh_steam_profile(state: &AppState, key: &str, id: &str) -> Result<SteamProfile, String> {
    let account_id = if let Ok(n) = id.parse::<i64>() {
        (n - 76_561_197_960_265_728i64).to_string()
    } else {
        // invalid STEAM_ID：同樣走失敗路徑
        if let Some(c) = state.steam.cache.lock().as_mut() {
            c.last_tried_at = now_ms();
        }
        return Err("invalid STEAM_ID".to_string());
    };
    let u1 =
        format!("{}/ISteamUser/GetPlayerSummaries/v0002/?key={key}&steamids={id}", state.external.steam_api);
    let u2 = format!("{}/IPlayerService/GetSteamLevel/v1/?key={key}&steamid={id}", state.external.steam_api);
    let u3 = format!("{}/IPlayerService/GetBadges/v1/?key={key}&steamid={id}", state.external.steam_api);
    let u4 = format!("{}/miniprofile/{account_id}", state.external.steam_community);
    let (player, level, badges, mini_html) = tokio::join!(
        steam_fetch_json(&state.http, &u1),
        steam_fetch_json(&state.http, &u2),
        steam_fetch_json(&state.http, &u3),
        steam_fetch_text(&state.http, &u4)
    );
    let result: Result<SteamProfile, String> = (|| {
        let player = player?;
        let level = level?;
        let badges = badges.unwrap_or(Value::Null);
        let player_obj = player.pointer("/response/players/0");
        let lvl = level.pointer("/response/player_level").and_then(serde_json::Value::as_i64);
        let (Some(player_obj), Some(level)) = (player_obj, lvl) else {
            return Err("incomplete response from Steam".to_string());
        };
        let badge_count =
            badges.pointer("/response/badges").and_then(|b| b.as_array()).map_or(0, std::vec::Vec::len);
        Ok(SteamProfile {
            player: steam_player_from(player_obj),
            level,
            xp: badges.pointer("/response/player_xp").and_then(serde_json::Value::as_i64).unwrap_or(0),
            xp_to_next: badges
                .pointer("/response/player_xp_needed_to_level_up")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0),
            badge_count: i64::try_from(badge_count).unwrap_or(i64::MAX),
            customization: parse_mini_profile(&mini_html.unwrap_or_default()),
            profile_url: format!("https://steamcommunity.com/profiles/{id}"),
        })
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
    responses((status = 200, body = SteamProfileResponse),
              (status = 503, description = "首抓失敗且無快取")))]
pub async fn steam_profile(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": STEAM_UNCONFIGURED })))
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
        return Json(SteamProfileResponse { profile: c.data, cached_at: c.fetched_at }).into_response();
    }
    // 首抓：持鎖去重；等鎖期間別人可能已抓好 → 再查一次快取
    let _g = state.steam.refresh_lock.lock().await;
    let cached = state.steam.cache.lock().clone();
    if let Some(c) = cached {
        return Json(SteamProfileResponse { profile: c.data, cached_at: c.fetched_at }).into_response();
    }
    match refresh_steam_profile(&state, &key, &id).await {
        Ok(profile) => {
            let cached_at = state.steam.cache.lock().as_ref().map_or_else(now_ms, |c| c.fetched_at);
            Json(SteamProfileResponse { profile, cached_at }).into_response()
        }
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "steam fetch failed, no cache yet", "message": e })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// STEAM_API_KEY / STEAM_ID 是 process 全域的。nextest 一個測試一個行程不會撞，
    /// 但 `cargo test`（cargo-mutants 預設用它）是同行程平行跑 → 需要串起來。
    static STEAM_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    fn fake_profile(persona: &str) -> SteamProfile {
        SteamProfile {
            player: SteamPlayer {
                personaname: Some(persona.to_string()),
                avatarfull: None,
                profileurl: None,
                personastate: Some(1),
                gameid: None,
            },
            level: 42,
            xp: 100,
            xp_to_next: 200,
            badge_count: 3,
            customization: SteamCustomization::default(),
            profile_url: "https://steamcommunity.com/profiles/1".to_string(),
        }
    }

    /// **stampede**：64 個請求同時打「首抓」路徑。
    ///
    /// 契約是「同一時間只有一個去打上游，其餘的等；等到之後**重查快取**」——
    /// `steam_profile` 裡拿到鎖之後的那次 `state.steam.cache.lock()` 就是這個 double-check。
    ///
    /// 這個測試把那條路徑逼出來的方式是：測試自己先佔住 `refresh_lock`，讓 64 個
    /// handler 全部卡在鎖上，然後在牠們排隊期間把快取填好、再放開鎖。
    /// 每一個醒來的人都應該讀到快取回 200。
    ///
    /// 把 double-check 拿掉的話，這 64 個會各自去打 api.steampowered.com（帶著
    /// 測試用的假 key）→ 全部 503，測試就紅了。也就是說它擋的是真的會發生的退化，
    /// 不是「有呼叫到 lock()」這種形式檢查。
    #[tokio::test]
    async fn steam_profile_stampede_rechecks_cache_instead_of_all_refetching() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 同上，靠 STEAM_ENV_LOCK 串行化；測試結束前還原。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "test-key-never-actually-used");
            std::env::set_var("STEAM_ID", "76561197960265729");
        }
        let state = crate::state::test_state().await;

        // 佔住鎖：後面每個 handler 走到首抓路徑都會停在這裡
        let guard = state.steam.refresh_lock.lock().await;

        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..64 {
            let st = state.clone();
            tasks.spawn(async move { steam_profile(axum::extract::State(st)).await });
        }
        // 讓那 64 個 task 有機會被排程、走到鎖前面
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }

        // 模擬「持鎖的那一個抓好了」。fetched_at 用當下時間——放舊的會讓後到的請求
        // 判定快取過期而 spawn 背景重抓，那才是真的會打網路。
        let now = now_ms();
        *state.steam.cache.lock() = Some(crate::state::SteamProfileCache {
            data: fake_profile("stampede-sentinel"),
            fetched_at: now,
            last_tried_at: now,
        });
        drop(guard);

        let mut served = 0;
        while let Some(joined) = tasks.join_next().await {
            let resp = joined.expect("handler task panicked");
            assert_eq!(
                resp.status(),
                StatusCode::OK,
                "有人沒重查快取，跑去打上游了（503 = 假 key 被真的送出去）"
            );
            let bytes =
                http_body_util::BodyExt::collect(resp.into_body()).await.expect("collect body").to_bytes();
            let v: Value = serde_json::from_slice(&bytes).expect("response is JSON");
            assert_eq!(v["player"]["personaname"], "stampede-sentinel", "回的不是快取那份");
            assert_eq!(v["_cachedAt"], json!(now));
            served += 1;
        }
        assert_eq!(served, 64);

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    /// 沒設 key/id 時要在碰鎖之前就回 500——否則未配置的部署會把所有請求排到鎖上。
    #[tokio::test]
    async fn steam_profile_without_env_fails_before_taking_the_lock() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
        let state = crate::state::test_state().await;

        // 鎖被佔著；若 handler 會去搶鎖，這個呼叫就會卡住而不是回 500
        let _guard = state.steam.refresh_lock.lock().await;
        let resp = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            steam_profile(axum::extract::State(state.clone())),
        )
        .await
        .expect("未配置時不該去等鎖");
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    /// 塑形這一步是這批改動唯一會出錯的地方（抓取本身走網路，測不到）。
    /// 樣本照 GitHub `/users/:u/events/public` 的實際形狀寫。
    #[test]
    fn github_event_keeps_push_fields_and_drops_shaless_commits() {
        let ev = json!({
            "id": "12345", "type": "PushEvent", "created_at": "2026-07-28T10:00:00Z",
            "repo": { "id": 1, "name": "timo9378/sora-to-ki" },
            "actor": { "login": "timo9378" },
            "payload": {
                "before": "aaa", "head": "bbb", "size": 2,
                "commits": [
                    { "sha": "c1", "message": "feat: 一", "author": { "name": "T", "email": "t@e" } },
                    { "message": "沒有 sha，不該收" },
                    { "sha": "c2", "message": "feat: 二" }
                ]
            }
        });
        let e = github_event_from(&ev).expect("應該收得下");
        assert_eq!(e.id, "12345");
        assert_eq!(e.kind, "PushEvent");
        assert_eq!(e.repo.name, "timo9378/sora-to-ki");
        assert_eq!(e.payload.size, Some(2));
        assert_eq!(e.payload.commits.len(), 2, "缺 sha 的那筆要被丟掉");
        assert_eq!(e.payload.commits[0].sha, "c1");
        assert_eq!(e.payload.commits[0].author.as_ref().unwrap().name.as_deref(), Some("T"));
        assert!(e.payload.commits[1].author.is_none());
    }

    #[test]
    fn github_event_without_repo_is_dropped() {
        let ev = json!({ "id": "1", "type": "WatchEvent", "created_at": "2026-07-28T10:00:00Z" });
        assert!(github_event_from(&ev).is_none());
    }

    /// 非 PushEvent 仍收得下（前端自己 filter），payload 就是空 commits。
    #[test]
    fn github_non_push_event_has_empty_payload() {
        let ev = json!({
            "id": "2", "type": "WatchEvent", "created_at": "2026-07-28T10:00:00Z",
            "repo": { "name": "a/b" }, "payload": { "action": "started" }
        });
        let e = github_event_from(&ev).unwrap();
        assert!(e.payload.commits.is_empty());
        assert_eq!(e.payload.before, None);
    }

    #[test]
    fn steam_games_unwraps_response_envelope() {
        let v = json!({ "response": { "total_count": 2, "games": [
            { "appid": 730, "name": "CS2", "playtime_2weeks": 120, "playtime_forever": 9999 },
            { "appid": 440, "name": "TF2" }
        ] } });
        let games = steam_games_from(&v);
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].appid, Some(730));
        assert_eq!(games[0].playtime_2weeks, Some(120));
        assert_eq!(games[1].playtime_2weeks, None, "沒玩過就是 None，不是 0");
    }

    #[test]
    fn steam_games_on_missing_envelope_is_empty_not_panic() {
        assert!(steam_games_from(&json!({ "response": {} })).is_empty());
        assert!(steam_games_from(&json!({})).is_empty());
    }

    #[test]
    fn steam_player_gameid_stays_string() {
        let p = json!({
            "personaname": "koi", "avatarfull": "https://a/f.jpg",
            "profileurl": "https://s/p/1", "personastate": 1, "gameid": "730"
        });
        let sp = steam_player_from(&p);
        assert_eq!(sp.gameid.as_deref(), Some("730"), "Steam 這欄是字串不是數字");
        assert_eq!(sp.personastate, Some(1));
    }

    #[test]
    fn wakatime_stats_skips_entries_without_name() {
        let v = json!([
            { "name": "Rust", "text": "3 hrs", "percent": 62.5 },
            { "text": "沒名字，不該收", "percent": 10.0 },
            { "name": "TypeScript" }
        ]);
        let stats = waka_stats_from(&v);
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].name, "Rust");
        assert!((stats[0].percent - 62.5).abs() < f64::EPSILON);
        assert_eq!(stats[1].text, "", "缺 text 退成空字串而不是整筆丟掉");
    }

    // ── 打 mock 上游的整合測試 ────────────────────────────────────────────
    //
    // 這一整組在 `state::ExternalUrls` 之前是**寫不出來**的：上游位址寫死在字串裡，
    // 任何 mock 都攔不到，所以 thirdparty.rs 2248 個 region 有八成從來沒被執行過。
    //
    // 驗的是「上游回什麼 → 我們吐什麼」這層轉換。那正是最容易在改動時默默壞掉、
    // 而且壞了只有讀者會看到的地方（前端拿到形狀不符的 JSON 就是空白區塊）。

    use crate::state::ExternalUrls;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// 建一個 state，並把全部外部位址指到這台 mock。
    async fn state_with_mock(server: &MockServer) -> AppState {
        let mut st = crate::state::test_state().await;
        st.external = std::sync::Arc::new(ExternalUrls::all_pointing_at(&server.uri()));
        st
    }

    async fn body_of(resp: Response) -> Value {
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.expect("collect").to_bytes();
        serde_json::from_slice(&bytes).expect("回應應該是 JSON")
    }

    /// GitHub 的錯誤物件是 `{message, documentation_url}`，沒有 `error` 欄位。
    /// 這支端點的存在理由之一就是把 message 收進 `error`——在此之前 404 / rate limit
    /// 會變成「所有欄位都是 null 的使用者物件」悄悄穿過去，前端檢查 `.error` 檢查不到。
    #[tokio::test]
    async fn github_user_surfaces_upstream_error_message() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/ghost"))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "message": "Not Found",
                "documentation_url": "https://docs.github.com/rest"
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v =
            body_of(github_user(axum::extract::State(st), axum::extract::Path("ghost".into())).await).await;
        assert_eq!(v["error"], "Not Found", "GitHub 的 message 要被收進 error 欄位");
        assert!(v["login"].is_null(), "失敗時不該有半個看起來正常的欄位");
    }

    /// 上游回的**根本不是 JSON**（Cloudflare 擋頁、502 的 HTML…）走的是另一條分支：
    /// 前一條測的是「合法 JSON 但內容是錯誤物件」。兩條都要有訊息，
    /// 否則前端拿到的是一個所有欄位都是 null 又沒有 error 的使用者物件。
    #[tokio::test]
    async fn github_user_回應不是_json_時也要有錯誤訊息() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>502 Bad Gateway</html>"))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let resp = github_user(axum::extract::State(st), axum::extract::Path("u".into())).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let v = body_of(resp).await;
        assert_eq!(v["error"], GH_PARSE_ERR);
        assert!(v["login"].is_null());
    }

    #[tokio::test]
    async fn steam_player_回應不是_json_時也要有錯誤訊息() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 靠 STEAM_ENV_LOCK 串行化。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "1");
        }
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUser/GetPlayerSummaries/v0002/"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json at all"))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let resp = steam_player(axum::extract::State(st)).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_of(resp).await["error"], STEAM_PARSE_ERR);

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    /// 正常路徑：只回我們宣告的那五欄，上游多給的欄位不轉發。
    #[tokio::test]
    async fn github_user_returns_only_the_declared_fields() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/timo9378"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "login": "timo9378",
                "name": "Koi",
                "avatar_url": "https://avatars.githubusercontent.com/u/1",
                "html_url": "https://github.com/timo9378",
                "public_repos": 42,
                // 上游還會給幾十個欄位，這裡放一個代表：不該出現在回應裡
                "gravatar_id": "should-not-be-forwarded"
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(github_user(axum::extract::State(st), axum::extract::Path("timo9378".into())).await)
            .await;
        assert_eq!(v["login"], "timo9378");
        assert_eq!(v["public_repos"], 42);
        assert!(v["error"].is_null());
        assert!(v.get("gravatar_id").is_none(), "上游多給的欄位不該原樣轉發出去");
    }

    /// steam/player：上游把玩家包在 `{response:{players:[…]}}` 裡，這支要把那層挖掉。
    /// 挖錯層前端就是拿到 undefined，而且不會有任何錯誤訊息。
    #[tokio::test]
    async fn steam_player_unwraps_the_response_envelope() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 靠 STEAM_ENV_LOCK 串行化；結束前還原。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "76561197960265729");
        }
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUser/GetPlayerSummaries/v0002/"))
            .and(query_param("key", "k"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "response": { "players": [{
                    "personaname": "koi",
                    "avatarfull": "https://avatars.steamstatic.com/x.jpg",
                    "personastate": 1,
                    "gameid": "730"
                }]}
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(steam_player(axum::extract::State(st)).await).await;
        assert_eq!(v["player"]["personaname"], "koi");
        // gameid 上游回的是**字串**不是數字，轉成數字會讓「在遊戲中」的判斷壞掉
        assert_eq!(v["player"]["gameid"], "730");
        assert!(v["error"].is_null());

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    /// 上游回了但形狀不對（players 是空陣列）時不該 panic，也不該回一個假的玩家。
    #[tokio::test]
    async fn steam_player_handles_empty_players_without_panicking() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 見上。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "76561197960265729");
        }
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUser/GetPlayerSummaries/v0002/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "response": { "players": [] } })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(steam_player(axum::extract::State(st)).await).await;
        assert!(v["player"].is_null(), "沒有玩家就該是 null，不是一個空殼物件");

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    // ── WakaTime ──────────────────────────────────────────────────────────
    //
    // 這一整塊在補之前是 0 覆蓋。它全部是「重新塑形上游回應」的程式：塑錯了不會
    // crash，前端只會拿到 undefined 然後畫出一片空白，而且沒有任何錯誤訊息。

    /// WAKATIME_API_KEY 同樣是 process 全域，理由同 STEAM_ENV_LOCK。
    static WAKA_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    /// 設好 key、跑完自動還原。回傳的 guard 一 drop 就清掉。
    // 這個欄位不會被讀，只是把鎖握到 guard 被 drop 為止（env 是 process 全域的）。
    struct WakaKey(#[allow(dead_code)] tokio::sync::MutexGuard<'static, ()>);
    impl Drop for WakaKey {
        fn drop(&mut self) {
            // SAFETY: 靠 WAKA_ENV_LOCK 串行化（guard 還握在手上）。
            unsafe { std::env::remove_var("WAKATIME_API_KEY") };
        }
    }
    async fn with_waka_key() -> WakaKey {
        let g = WAKA_ENV_LOCK.lock().await;
        // SAFETY: 同上。
        unsafe { std::env::set_var("WAKATIME_API_KEY", "test-waka-key") };
        WakaKey(g)
    }

    #[test]
    fn waka_auth_是_base64_的_basic() {
        // 打錯就是每一次請求都 401，而 handler 會把它包成 error 欄位回 200 給前端——
        // 看起來像「今天沒寫程式」而不是「認證壞了」。
        assert_eq!(waka_auth("abc"), "Basic YWJj");
        assert_eq!(waka_auth(""), "Basic ");
    }

    // 這裡的 percent 是從 JSON 原樣讀進來、沒有經過任何運算就寫進欄位，
    // 驗的就是「原封不動」，所以要的正是精確相等而不是 epsilon 比較。
    #[allow(clippy::float_cmp, reason = "驗的是 JSON 原值有沒有被改動，不是計算結果")]
    #[test]
    fn waka_stats_from_跳過沒有名字的列並補預設值() {
        let v = json!([
            { "name": "Rust", "text": "10 hrs", "percent": 62.5 },
            { "name": "TypeScript" },                      // 缺 text/percent → 補預設
            { "text": "沒有名字", "percent": 100 },          // 缺 name → 整列不收
        ]);
        let out = waka_stats_from(&v);
        assert_eq!(out.len(), 2, "缺 name 的那列要被丟掉");
        assert_eq!(out[0].name, "Rust");
        assert_eq!(out[0].percent, 62.5);
        assert_eq!(out[1].name, "TypeScript");
        assert_eq!(out[1].text, "", "缺 text 補空字串，不是 null");
        assert_eq!(out[1].percent, 0.0);
        // 不是陣列時回空陣列而不是 panic——前端直接 .map，給 null 會炸
        assert!(waka_stats_from(&Value::Null).is_empty());
        assert!(waka_stats_from(&json!({ "languages": [] })).is_empty());
    }

    #[test]
    fn waka_err_parts_把上游的_body_轉成_details_字串() {
        let (st, err, det) = waka_err_parts("kind", (StatusCode::UNAUTHORIZED, Value::from("Unauthorized")));
        assert_eq!(st, StatusCode::UNAUTHORIZED, "上游的狀態碼要原樣帶出來");
        assert_eq!(err.as_deref(), Some("kind"));
        assert_eq!(det.as_deref(), Some("Unauthorized"), "字串就原樣放，不要再包一層引號");

        let (_, _, det) = waka_err_parts("kind", (StatusCode::BAD_GATEWAY, json!({ "error": "nope" })));
        assert_eq!(det.as_deref(), Some(r#"{"error":"nope"}"#), "物件轉成 JSON 字串");

        let (_, _, det) = waka_err_parts("kind", (StatusCode::BAD_GATEWAY, Value::Null));
        assert_eq!(det, None, "沒有 body 就不要生一個 \"null\" 字串出來");
    }

    #[tokio::test]
    async fn wakatime_today_把只有一個元素的_data_陣列攤平並算出實際編碼區間() {
        let _key = with_waka_key().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/summaries"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [{ "grand_total": { "text": "3 hrs 12 mins", "total_seconds": 11520.0 } }],
                "start": "2026-08-02T00:00:00Z",
                "end": "2026-08-02T23:59:59Z",
            })))
            .mount(&server)
            .await;
        // 刻意亂序：actualCodingTime 要取 min(time) 與 max(time+duration)，不是第一筆與最後一筆
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/durations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [
                    { "time": 1_770_000_600.0, "duration": 600.0 },
                    { "time": 1_770_000_000.0, "duration": 120.0 },
                ]
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(wakatime_today(axum::extract::State(st)).await).await;

        // 查的日期必須真的是「今天」。這條看起來瑣碎，但 today_utc 回空字串或亂值時
        // WakaTime 會回一片空白，而畫面上就是「今天沒寫程式」——沒有任何錯誤。
        let (y, m, d) = crate::util::civil_from_days(crate::util::now_ms() / 86_400_000);
        let today = format!("{y:04}-{m:02}-{d:02}");
        let reqs = server.received_requests().await.unwrap();
        let summ = reqs.iter().find(|r| r.url.path().ends_with("/summaries")).unwrap();
        let qp = |r: &wiremock::Request, k: &str| {
            r.url.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.into_owned())
        };
        assert_eq!(qp(summ, "start").as_deref(), Some(today.as_str()), "start 要是今天");
        assert_eq!(qp(summ, "end").as_deref(), Some(today.as_str()), "end 也是今天（單日查詢）");
        let dur = reqs.iter().find(|r| r.url.path().ends_with("/durations")).unwrap();
        assert_eq!(qp(dur, "date").as_deref(), Some(today.as_str()));

        assert_eq!(v["grand_total"]["text"], "3 hrs 12 mins", "data[0] 那層要被攤掉");
        assert_eq!(v["grand_total"]["total_seconds"], 11520);
        assert_eq!(v["start"], "2026-08-02T00:00:00Z");
        assert_eq!(v["actualCodingTime"]["hasData"], true);
        assert_eq!(
            v["actualCodingTime"]["start"],
            crate::util::iso_from_millis(1_770_000_000_000),
            "start 取的是最小的 time，不是陣列第一筆"
        );
        assert_eq!(
            v["actualCodingTime"]["end"],
            crate::util::iso_from_millis(1_770_001_200_000),
            "end 取的是最大的 time+duration"
        );
        assert!(v["error"].is_null());
    }

    #[tokio::test]
    async fn wakatime_today_沒有_durations_時_hasdata_是_false() {
        let _key = with_waka_key().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/summaries"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/durations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [] })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(wakatime_today(axum::extract::State(st)).await).await;
        assert_eq!(v["actualCodingTime"]["hasData"], false);
        assert!(v["actualCodingTime"]["start"].is_null(), "沒資料時不該生出 1970-01-01");
        assert!(v["grand_total"].is_null(), "data 是空陣列 → 沒有 grand_total");
    }

    #[tokio::test]
    async fn wakatime_today_把上游的錯誤狀態碼與內容帶出來() {
        let _key = with_waka_key().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/summaries"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized" })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/durations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [] })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let resp = wakatime_today(axum::extract::State(st)).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "401 不該被吞成 200");
        let v = body_of(resp).await;
        assert_eq!(v["error"], "Failed to fetch WakaTime today data");
        assert!(v["details"].as_str().unwrap().contains("Unauthorized"), "要看得出上游說了什麼");
    }

    #[tokio::test]
    async fn wakatime_沒設定_key_時三支都回_500_並說明原因() {
        let _g = WAKA_ENV_LOCK.lock().await;
        // SAFETY: 靠 WAKA_ENV_LOCK 串行化。
        unsafe { std::env::remove_var("WAKATIME_API_KEY") };
        let server = MockServer::start().await; // 不掛任何 route：一旦有人送請求就會 404
        let st = state_with_mock(&server).await;

        for resp in [
            wakatime_today(axum::extract::State(st.clone())).await,
            wakatime_week(axum::extract::State(st.clone())).await,
            wakatime_projects(axum::extract::State(st.clone())).await,
        ] {
            assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
            let v = body_of(resp).await;
            assert_eq!(v["error"], WAKA_UNCONFIGURED, "要說得出是「沒設定」而不是「壞了」");
        }
        assert!(server.received_requests().await.unwrap().is_empty(), "沒有 key 就不該對外發請求");
    }

    #[tokio::test]
    async fn wakatime_week_與_projects_打同一支上游_只有錯誤字串不同() {
        let _key = with_waka_key().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/stats/last_7_days"))
            .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "boom" })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let w = body_of(wakatime_week(axum::extract::State(st.clone())).await).await;
        let p = body_of(wakatime_projects(axum::extract::State(st)).await).await;
        assert_eq!(w["error"], "Failed to fetch WakaTime week data");
        assert_eq!(p["error"], "Failed to fetch WakaTime projects data");
        // details 是「上游到底說了什麼」——只有 error 的話查起來完全沒有線索
        assert!(w["details"].as_str().unwrap().contains("boom"), "得到 {}", w["details"]);
        assert!(w["languages"].is_array(), "出錯時陣列欄位也要在（前端直接 .map）");
        // 兩支打的是同一個路徑（Express 就這樣，照抄）——這條把那件事釘住
        let paths: Vec<String> =
            server.received_requests().await.unwrap().iter().map(|r| r.url.path().to_string()).collect();
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], paths[1], "week 與 projects 是同一支上游 API");
    }

    #[tokio::test]
    async fn wakatime_week_把_data_攤成_languages_與_projects() {
        let _key = with_waka_key().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/wakatime/api/v1/users/current/stats/last_7_days"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": {
                    "languages": [{ "name": "Rust", "text": "9 hrs", "percent": 70.0 }],
                    "projects": [{ "name": "web", "text": "5 hrs", "percent": 40.0 }],
                    // 上游還會給 editors / machines / …，不該轉發
                    "editors": [{ "name": "VS Code", "text": "9 hrs", "percent": 100.0 }],
                }
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(wakatime_week(axum::extract::State(st)).await).await;
        assert_eq!(v["languages"][0]["name"], "Rust");
        assert_eq!(v["projects"][0]["name"], "web");
        assert!(v.get("editors").is_none(), "只留前端會 render 的兩組");
        assert!(v.get("data").is_none(), "data 那層要被攤掉");
    }

    // ── GitHub ────────────────────────────────────────────────────────────

    #[test]
    fn github_event_from_缺必要欄位就整筆不收() {
        // 這四欄是 render 一列的必需品，缺了留著只會是一列空白
        let full = json!({
            "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
            "repo": { "name": "timo9378/web" },
        });
        assert!(github_event_from(&full).is_some());
        for missing in ["id", "type", "created_at"] {
            let mut ev = full.clone();
            ev.as_object_mut().unwrap().remove(missing);
            assert!(github_event_from(&ev).is_none(), "缺 {missing} 應該整筆不收");
        }
        let mut no_repo = full;
        no_repo["repo"] = json!({});
        assert!(github_event_from(&no_repo).is_none(), "缺 repo.name 也一樣");
    }

    #[test]
    fn github_event_from_的_commits_缺_sha_就跳過該筆() {
        let ev = json!({
            "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
            "repo": { "name": "timo9378/web" },
            "payload": {
                "before": "aaa", "head": "bbb", "size": 2,
                "commits": [
                    { "sha": "c1", "message": "第一筆", "author": { "name": "Koi", "email": "k@example.com" } },
                    { "message": "沒有 sha 的不收" },
                    { "sha": "c3" },
                ],
            },
        });
        let e = github_event_from(&ev).expect("完整事件");
        assert_eq!(e.kind, "PushEvent");
        assert_eq!(e.repo.name, "timo9378/web");
        assert_eq!(e.payload.before.as_deref(), Some("aaa"));
        assert_eq!(e.payload.size, Some(2));
        assert_eq!(e.payload.commits.len(), 2, "缺 sha 的那筆要跳過");
        assert_eq!(e.payload.commits[0].message, "第一筆");
        assert_eq!(e.payload.commits[0].author.as_ref().unwrap().name.as_deref(), Some("Koi"));
        assert_eq!(e.payload.commits[1].message, "", "缺 message 補空字串");
        assert!(e.payload.commits[1].author.is_none());
    }

    #[test]
    fn github_event_from_沒有_payload_也不會炸() {
        let ev = json!({
            "id": "1", "type": "WatchEvent", "created_at": "2026-08-02T00:00:00Z",
            "repo": { "name": "a/b" },
        });
        let e = github_event_from(&ev).expect("沒有 payload 的事件仍然有效");
        assert!(e.payload.commits.is_empty());
        assert!(e.payload.before.is_none());
        assert!(e.payload.size.is_none());
    }

    #[tokio::test]
    async fn github_repos_丟掉缺必要欄位的列並補齊選填欄位() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/timo9378/repos"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                { "id": 1, "name": "web", "html_url": "https://github.com/timo9378/web",
                  "description": null, "language": "Rust", "stargazers_count": 7 },
                { "id": 2, "name": "沒有網址的" },                 // 缺 html_url → 不收
                { "name": "沒有 id 的", "html_url": "https://x/" }, // 缺 id → 不收
            ])))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            github_repos(
                axum::extract::State(st),
                axum::extract::Path("timo9378".into()),
                axum::extract::Query(ReposQuery { limit: None }),
            )
            .await,
        )
        .await;
        let repos = v["repos"].as_array().unwrap();
        assert_eq!(repos.len(), 1, "兩筆殘缺的要被丟掉");
        assert_eq!(repos[0]["name"], "web");
        assert!(repos[0]["description"].is_null());
        assert_eq!(repos[0]["stargazers_count"], 7);
        assert!(v["error"].is_null());
    }

    #[tokio::test]
    async fn github_repos_的_limit_夾在一到一百() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/repos"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        for (given, want) in [(None, "5"), (Some(0), "1"), (Some(999), "100"), (Some(20), "20")] {
            let _ = github_repos(
                axum::extract::State(st.clone()),
                axum::extract::Path("u".into()),
                axum::extract::Query(ReposQuery { limit: given }),
            )
            .await;
            let last = server.received_requests().await.unwrap().pop().unwrap();
            let per_page = last.url.query_pairs().find(|(k, _)| k == "per_page").unwrap().1.into_owned();
            assert_eq!(per_page, want, "limit={given:?} 應該送出 per_page={want}");
        }
    }

    /// 有設 GITHUB_TOKEN 就要真的帶上去。沒帶的話 REST 只剩每小時 60 次的匿名額度，
    /// 撞到之後 GitHub 回錯誤物件 → 前端顯示「這個人沒有任何 repo」。
    #[tokio::test]
    async fn github_repos_有_token_時會帶上_authorization() {
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/repos"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let _ = github_repos(
            axum::extract::State(st),
            axum::extract::Path("u".into()),
            axum::extract::Query(ReposQuery { limit: None }),
        )
        .await;
        let req = server.received_requests().await.unwrap().pop().unwrap();
        let auth = req.headers.get("authorization").map(|v| v.to_str().unwrap().to_string());
        assert_eq!(auth.as_deref(), Some("Bearer test-gh-token"));
    }

    #[tokio::test]
    async fn github_repos_遇到錯誤物件時把_message_放進_error() {
        // GitHub 的錯誤是物件不是陣列；不處理的話 `as_array()` 失敗會變成空清單 + 沒有錯誤，
        // 前端顯示「這個人沒有任何 repo」——把 rate limit 說成事實。
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/repos"))
            .respond_with(
                ResponseTemplate::new(403).set_body_json(json!({ "message": "API rate limit exceeded" })),
            )
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let v = body_of(
            github_repos(
                axum::extract::State(st),
                axum::extract::Path("u".into()),
                axum::extract::Query(ReposQuery { limit: None }),
            )
            .await,
        )
        .await;
        assert_eq!(v["error"], "API rate limit exceeded");
        assert_eq!(v["repos"].as_array().unwrap().len(), 0);
    }

    /// GITHUB_TOKEN 同樣是 process 全域。
    static GH_ENV_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
        std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

    // 這個欄位不會被讀，只是把鎖握到 guard 被 drop 為止（env 是 process 全域的）。
    struct GhToken(#[allow(dead_code)] tokio::sync::MutexGuard<'static, ()>);
    impl Drop for GhToken {
        fn drop(&mut self) {
            // SAFETY: 靠 GH_ENV_LOCK 串行化。
            unsafe { std::env::remove_var("GITHUB_TOKEN") };
        }
    }
    async fn with_gh_token() -> GhToken {
        let g = GH_ENV_LOCK.lock().await;
        // SAFETY: 同上。
        unsafe { std::env::set_var("GITHUB_TOKEN", "test-gh-token") };
        GhToken(g)
    }

    #[tokio::test]
    async fn github_contributions_把週攤平成日並帶出總數() {
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/github/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "user": { "contributionsCollection": { "contributionCalendar": {
                    "totalContributions": 123,
                    "weeks": [
                        { "contributionDays": [
                            { "date": "2026-01-01", "contributionCount": 3 },
                            { "date": "2026-01-02", "contributionCount": 0 },
                        ]},
                        { "contributionDays": [{ "date": "2026-01-03", "contributionCount": 5 }]},
                    ],
                }}}}
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            github_contributions(
                axum::extract::State(st),
                axum::extract::Path("u".into()),
                axum::extract::Query(ContributionsQuery { year: None }),
            )
            .await,
        )
        .await;
        let days = v["contributions"].as_array().unwrap();
        assert_eq!(days.len(), 3, "兩週共三天要被攤成一個平陣列");
        assert_eq!(days[0]["date"], "2026-01-01");
        assert_eq!(days[2]["count"], 5);
        assert_eq!(v["total"], 123);
        assert!(v["error"].is_null());
    }

    #[tokio::test]
    async fn github_contributions_的_graphql_錯誤是_200_加_errors_不是狀態碼() {
        // 這是 GraphQL 的特性：查詢失敗照樣回 200。只看狀態碼的話會把錯誤當成
        // 「這個人今年一次貢獻都沒有」畫出一張全白的熱圖。
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/github/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "errors": [{ "message": "Could not resolve to a User with the login of 'nobody'." }]
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            github_contributions(
                axum::extract::State(st),
                axum::extract::Path("nobody".into()),
                axum::extract::Query(ContributionsQuery { year: None }),
            )
            .await,
        )
        .await;
        assert!(v["error"].as_str().unwrap().contains("Could not resolve"));
        assert_eq!(v["total"], 0);
        assert_eq!(v["contributions"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn github_contributions_的_year_只接受四位數字() {
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/github/graphql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {} })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        // year 會被拼進 GraphQL 的時間字串，所以它是注入面——擋在送出之前
        for bad in ["20xx", "12345", "2026'", "", "1"] {
            let v = body_of(
                github_contributions(
                    axum::extract::State(st.clone()),
                    axum::extract::Path("u".into()),
                    axum::extract::Query(ContributionsQuery { year: Some(bad.to_string()) }),
                )
                .await,
            )
            .await;
            assert_eq!(v["error"], "year 格式不正確", "year={bad:?} 應該被擋下");
        }
        assert!(server.received_requests().await.unwrap().is_empty(), "格式不對就不該送出查詢");

        // 合法的四位數字與 "last" 都要放行
        for ok in ["2026", "last"] {
            let v = body_of(
                github_contributions(
                    axum::extract::State(st.clone()),
                    axum::extract::Path("u".into()),
                    axum::extract::Query(ContributionsQuery { year: Some(ok.to_string()) }),
                )
                .await,
            )
            .await;
            assert!(v["error"].is_null(), "year={ok} 應該放行");
        }
    }

    #[tokio::test]
    async fn github_contributions_沒有_token_就不送出查詢() {
        let _g = GH_ENV_LOCK.lock().await;
        // SAFETY: 靠 GH_ENV_LOCK 串行化。
        unsafe { std::env::remove_var("GITHUB_TOKEN") };
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let v = body_of(
            github_contributions(
                axum::extract::State(st),
                axum::extract::Path("u".into()),
                axum::extract::Query(ContributionsQuery { year: None }),
            )
            .await,
        )
        .await;
        assert!(v["error"].as_str().unwrap().contains("GITHUB_TOKEN"));
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn github_events_套用_github_event_from_的過濾() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/events/public"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                { "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
                  "repo": { "name": "a/b" }, "payload": { "size": 1 } },
                { "id": "2", "type": "PushEvent" },  // 殘缺 → 丟掉
            ])))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(github_events(axum::extract::State(st), axum::extract::Path("u".into())).await).await;
        let events = v["events"].as_array().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "PushEvent", "序列化欄位名是 type 不是 kind");
        assert_eq!(events[0]["repo"]["name"], "a/b");
    }

    /// GitHub 的 events API 會把 PushEvent 的 commits 截斷（常常是空陣列），
    /// 所以有 before/head 時要再去打 compare API 補回來。
    /// 這段壞掉的話動態牆會顯示「推了 N 個 commit」卻一條訊息都沒有。
    #[tokio::test]
    async fn github_events_用_compare_api_補回被截斷的_commits() {
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/events/public"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
                "repo": { "name": "timo9378/web" },
                "payload": { "commits": [], "before": "aaa", "head": "bbb", "size": 0 },
            }])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/github/repos/timo9378/web/compare/aaa...bbb"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "commits": [
                    { "sha": "c1", "commit": { "message": "第一個 commit", "author": { "name": "Koi" } } },
                    { "sha": "c2", "commit": { "message": "第二個 commit", "author": { "name": "Koi" } } },
                ]
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(github_events(axum::extract::State(st), axum::extract::Path("u".into())).await).await;
        let commits = v["events"][0]["payload"]["commits"].as_array().unwrap();
        assert_eq!(commits.len(), 2, "compare 回來的 commits 要被填進去");
        assert_eq!(commits[0]["message"], "第一個 commit", "訊息在 commit.message 那層，要挖出來");
        assert_eq!(commits[0]["author"]["name"], "Koi");
        assert_eq!(v["events"][0]["payload"]["size"], 2, "size 要跟著補正，不是留著上游的 0");
    }

    #[tokio::test]
    async fn github_events_沒有_token_時不打_compare_api() {
        // compare 需要認證；沒 token 就不該白跑一趟（也不該因此整筆失敗）
        let _g = GH_ENV_LOCK.lock().await;
        // SAFETY: 靠 GH_ENV_LOCK 串行化。
        unsafe { std::env::remove_var("GITHUB_TOKEN") };
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/events/public"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
                "repo": { "name": "a/b" },
                "payload": { "commits": [], "before": "aaa", "head": "bbb" },
            }])))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(github_events(axum::extract::State(st), axum::extract::Path("u".into())).await).await;
        assert_eq!(v["events"].as_array().unwrap().len(), 1, "沒有 commits 也還是要顯示這筆");
        let paths: Vec<String> =
            server.received_requests().await.unwrap().iter().map(|r| r.url.path().to_string()).collect();
        assert!(!paths.iter().any(|p| p.contains("/compare/")), "沒有 token 就不該打 compare");
    }

    /// 只有「commits 是空的」才需要去補；已經有 commits 的不能再打一次 compare。
    ///
    /// `cargo mutants` 指出來的：把那串條件的 `&&` 換成 `||` 測試照樣全綠。
    /// 後果是每一筆 PushEvent 都多打一次 GitHub API（很快就撞到 rate limit），
    /// 而且會用 compare 的結果**覆蓋掉原本就正確的 commits**。
    #[tokio::test]
    async fn github_events_已經有_commits_時不再打_compare() {
        let _t = with_gh_token().await;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/events/public"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "1", "type": "PushEvent", "created_at": "2026-08-02T00:00:00Z",
                "repo": { "name": "a/b" },
                // commits 非空，但 before/head 也在——這正是 `||` 會誤判的組合
                "payload": {
                    "commits": [{ "sha": "已有的", "message": "原本就抓得到" }],
                    "before": "aaa", "head": "bbb", "size": 1,
                },
            }])))
            .mount(&server)
            .await;
        // 刻意不掛 compare：真的去打就會 404，下面的斷言會看到 commits 被清空
        let st = state_with_mock(&server).await;
        let v = body_of(github_events(axum::extract::State(st), axum::extract::Path("u".into())).await).await;

        let commits = v["events"][0]["payload"]["commits"].as_array().unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0]["sha"], "已有的", "原本就有的 commits 不該被覆蓋");
        let paths: Vec<String> =
            server.received_requests().await.unwrap().iter().map(|r| r.url.path().to_string()).collect();
        assert!(
            !paths.iter().any(|p| p.contains("/compare/")),
            "已經有 commits 就不必補，實際打了 {paths:?}"
        );
    }

    #[tokio::test]
    async fn github_events_遇到錯誤物件時把_message_放進_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/github/users/u/events/public"))
            .respond_with(
                ResponseTemplate::new(403).set_body_json(json!({ "message": "API rate limit exceeded" })),
            )
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let v = body_of(github_events(axum::extract::State(st), axum::extract::Path("u".into())).await).await;
        assert_eq!(v["error"], "API rate limit exceeded", "不然前端會以為這個人真的沒有動態");
        assert_eq!(v["events"].as_array().unwrap().len(), 0);
    }

    // ── Steam 的未配置降級路徑 ────────────────────────────────────────────
    //
    // 這條路只有在「金鑰沒設好」時才會走到，平常沒有人經過——正因如此它壞掉了
    // 也不會有人發現，直到某次換機器忘了帶 env。形狀由 e2e 的 api-contract 也驗一次，
    // 這裡驗的是狀態碼與訊息。

    #[tokio::test]
    async fn steam_沒設定金鑰時回_500_且陣列欄位仍然存在() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 靠 STEAM_ENV_LOCK 串行化。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;

        for resp in [
            steam_recent_games(axum::extract::State(st.clone())).await,
            steam_owned_games(axum::extract::State(st.clone())).await,
        ] {
            assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
            let v = body_of(resp).await;
            assert_eq!(v["error"], STEAM_UNCONFIGURED);
            assert!(v["games"].is_array(), "前端直接 .map，games 一定要是陣列不能是 undefined");
        }

        let resp = steam_player(axum::extract::State(st.clone())).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_of(resp).await["error"], STEAM_UNCONFIGURED);

        let resp = steam_achievements(axum::extract::State(st), axum::extract::Path("440".into())).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_of(resp).await["error"], STEAM_UNCONFIGURED);

        assert!(server.received_requests().await.unwrap().is_empty(), "沒金鑰就不該對外發請求");
    }

    /// `steam_games` 這個共用 helper 原本只有它裡面的純函式（`steam_games_from`）被測過，
    /// 整條 HTTP 路徑沒走過——包含「只有 owned-games 才帶 gameCount」這個差別。
    #[tokio::test]
    async fn steam_的兩支遊戲清單只有_owned_帶_gamecount() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 靠 STEAM_ENV_LOCK 串行化。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "1");
        }
        let server = MockServer::start().await;
        let body = json!({ "response": {
            "game_count": 87,
            "games": [{ "appid": 730, "name": "CS2", "playtime_forever": 9999 }],
        }});
        for p in [
            "/steam-api/IPlayerService/GetRecentlyPlayedGames/v0001/",
            "/steam-api/IPlayerService/GetOwnedGames/v0001/",
        ] {
            Mock::given(method("GET"))
                .and(path(p))
                .respond_with(ResponseTemplate::new(200).set_body_json(body.clone()))
                .mount(&server)
                .await;
        }
        let st = state_with_mock(&server).await;

        let recent = body_of(steam_recent_games(axum::extract::State(st.clone())).await).await;
        assert_eq!(recent["games"][0]["name"], "CS2");
        assert!(recent["gameCount"].is_null(), "recent-games 不帶 gameCount（上游有給也不轉發）");

        let owned = body_of(steam_owned_games(axum::extract::State(st.clone())).await).await;
        assert_eq!(owned["games"][0]["appid"], 730);
        assert_eq!(owned["gameCount"], 87, "owned-games 才帶 gameCount");

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    #[tokio::test]
    async fn steam_遊戲清單遇到非_json_回應時仍然給得出陣列() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 見上。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "1");
        }
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/steam-api/IPlayerService/GetRecentlyPlayedGames/v0001/"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>Steam is down</html>"))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let resp = steam_recent_games(axum::extract::State(st)).await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let v = body_of(resp).await;
        assert_eq!(v["error"], STEAM_PARSE_ERR);
        assert!(v["games"].is_array(), "前端直接 .map，錯誤時 games 也不能是 undefined");

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    #[tokio::test]
    async fn steam_achievements_是唯一保留原樣轉發的一支() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 見上。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", "1");
        }
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUserStats/GetPlayerAchievements/v0001/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "playerstats": { "achievements": [{ "apiname": "A", "achieved": 1 }] }
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v =
            body_of(steam_achievements(axum::extract::State(st), axum::extract::Path("440".into())).await)
                .await;
        // 這支刻意不塑形（註解說明了理由），所以上游的巢狀結構要原樣出現
        assert_eq!(v["playerstats"]["achievements"][0]["apiname"], "A");

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    // ── steam/profile 的 SWR 與 refresh ───────────────────────────────────
    //
    // `cargo mutants` 指出來的一整片洞。這裡每一個判斷壞掉都是**沒有症狀**的：
    // 要嘛個人檔案永遠停在舊資料，要嘛每一次請求都去打 Steam（而 Steam 會限流）。

    /// 用真的 Steam ID 算出 miniprofile 的 accountid。這個減法寫錯的話 miniprofile
    /// 會抓到別人的頁面或 404 —— 客製全部消失，但個人檔案其他欄位都正常。
    const STEAM_ID64: &str = "76561198000000000";
    const ACCOUNT_ID: &str = "39734272"; // 76561198000000000 - 76561197960265728

    /// 掛好 refresh 需要的四支上游。`mini` 是 miniprofile 的 HTML。
    async fn mount_steam_profile_upstreams(server: &MockServer, mini: &str) {
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUser/GetPlayerSummaries/v0002/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "response": { "players": [{ "personaname": "Koi", "personastate": 1 }] }
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/steam-api/IPlayerService/GetSteamLevel/v1/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "response": { "player_level": 42 }
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/steam-api/IPlayerService/GetBadges/v1/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "response": { "badges": [{}, {}, {}], "player_xp": 100, "player_xp_needed_to_level_up": 200 }
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/steam-community/miniprofile/{ACCOUNT_ID}")))
            .respond_with(ResponseTemplate::new(200).set_body_string(mini))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn refresh_steam_profile_合併四支上游並算對_miniprofile_的_accountid() {
        let server = MockServer::start().await;
        mount_steam_profile_upstreams(&server, MINI_PROFILE_HTML).await;
        let st = state_with_mock(&server).await;

        let p = refresh_steam_profile(&st, "k", STEAM_ID64).await.expect("四支都成功");
        assert_eq!(p.player.personaname.as_deref(), Some("Koi"));
        assert_eq!(p.level, 42);
        assert_eq!(p.xp, 100);
        assert_eq!(p.xp_to_next, 200);
        assert_eq!(p.badge_count, 3, "badge_count 是 badges 陣列的長度");
        assert_eq!(p.profile_url, format!("https://steamcommunity.com/profiles/{STEAM_ID64}"));
        // miniprofile 的 HTML 真的有被解析（不是拿到空字串就算了）
        assert_eq!(p.customization.avatar_frame.as_deref(), Some("https://cdn/frame.png"));
        // accountid 算錯就會 404 → 上面那條會是 None。這裡再直接確認打的是哪個路徑。
        let paths: Vec<String> =
            server.received_requests().await.unwrap().iter().map(|r| r.url.path().to_string()).collect();
        assert!(
            paths.iter().any(|p| p.ends_with(&format!("/miniprofile/{ACCOUNT_ID}"))),
            "SteamID64 要減掉 76561197960265728 才是 accountid，實際打了 {paths:?}"
        );

        // 成功要寫進快取，且兩個時間戳一致
        let c = st.steam.cache.lock().clone().expect("成功後應該有快取");
        assert_eq!(c.fetched_at, c.last_tried_at);
        assert_eq!(c.data.level, 42);
    }

    #[tokio::test]
    async fn refresh_steam_profile_失敗時只更新_last_tried_at_不動舊資料() {
        let server = MockServer::start().await;
        // level 那支掛掉 → 整次 refresh 失敗
        Mock::given(method("GET"))
            .and(path("/steam-api/ISteamUser/GetPlayerSummaries/v0002/"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({ "response": { "players": [{}] } })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/steam-api/IPlayerService/GetSteamLevel/v1/"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        *st.steam.cache.lock() = Some(crate::state::SteamProfileCache {
            data: fake_profile("舊資料"),
            fetched_at: 1_000,
            last_tried_at: 1_000,
        });

        assert!(refresh_steam_profile(&st, "k", STEAM_ID64).await.is_err());
        let c = st.steam.cache.lock().clone().unwrap();
        assert_eq!(c.data.player.personaname.as_deref(), Some("舊資料"), "失敗不該清掉能用的舊資料");
        assert_eq!(c.fetched_at, 1_000, "fetched_at 不動——不然會被當成剛抓過而不再重試");
        assert!(c.last_tried_at > 1_000, "只有 last_tried_at 前進，退避才有依據");
    }

    #[tokio::test]
    async fn refresh_steam_profile_的_steam_id_不是數字時直接失敗() {
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let e = refresh_steam_profile(&st, "k", "not-a-number").await.unwrap_err();
        assert_eq!(e, "invalid STEAM_ID");
        assert!(server.received_requests().await.unwrap().is_empty(), "算不出 accountid 就不該送出請求");
    }

    /// SWR 的重抓判斷：`距上次成功 >= 30 分鐘` **且** `距上次嘗試 >= 5 分鐘`。
    ///
    /// 三種寫壞的方式各有各的無聲後果：
    ///   · `>=` 反向 → 新鮮時狂抓、過期時反而不抓
    ///   · `&&` 換 `||` → 上游掛掉之後每一次請求都重試，退避形同虛設（Steam 會限流）
    ///   · 常數乘號寫成加號 → 30*60*1000 變 1090ms，等於每次請求都重抓
    /// 全部都不會有錯誤訊息，只會在 Steam 那端變成一個很吵的客戶端。
    #[tokio::test]
    async fn steam_profile_的_swr_只在夠舊且過了退避期才背景重抓() {
        let _env = STEAM_ENV_LOCK.lock().await;
        // SAFETY: 靠 STEAM_ENV_LOCK 串行化。
        unsafe {
            std::env::set_var("STEAM_API_KEY", "k");
            std::env::set_var("STEAM_ID", STEAM_ID64);
        }

        // (距上次成功, 距上次嘗試, 是否該重抓)
        //
        // ⚠ 「十分鐘」那一組是刻意的：它落在 30 分鐘門檻之內，但**超過**把常數的
        // `30 * 60 * 1000` 誤寫成 `30 + 60 * 1000`（＝60030ms）之後的門檻。
        // 第一版只放了 60 秒，兩種寫法都判定為新鮮，於是那個變異活了下來。
        let cases = [
            (1_000i64, 1_000i64, false, "剛抓完"),
            (600_000, 600_000, false, "十分鐘——還沒到 30 分鐘的重抓門檻"),
            // ⚠ 這裡的 120 秒也是刻意挑的，理由同上：它在 5 分鐘退避之內，但**超過**
            // 把 `5 * 60 * 1000` 誤寫成 `5 + 60 * 1000`（＝60005ms）之後的門檻。
            // 第一版寫 60 秒，兩種寫法都判定為「還在退避中」，那個變異因此活了下來。
            (STEAM_PROFILE_REFRESH_AFTER + 1, 120_000, false, "夠舊了但兩分鐘前才試過 → 要等退避"),
            (600_000, STEAM_PROFILE_RETRY_BACKOFF + 1, false, "退避過了但資料還新鮮"),
            (STEAM_PROFILE_REFRESH_AFTER + 1, STEAM_PROFILE_RETRY_BACKOFF + 1, true, "兩個條件都成立"),
        ];
        for (since_fetch, since_try, should_refetch, why) in cases {
            let server = MockServer::start().await;
            mount_steam_profile_upstreams(&server, "").await;
            let st = state_with_mock(&server).await;
            let now = now_ms();
            *st.steam.cache.lock() = Some(crate::state::SteamProfileCache {
                data: fake_profile("快取裡的"),
                fetched_at: now - since_fetch,
                last_tried_at: now - since_try,
            });

            let v = body_of(steam_profile(axum::extract::State(st.clone())).await).await;
            assert_eq!(v["player"]["personaname"], "快取裡的", "{why}：不管重不重抓，這一次都該直接回快取");

            // 背景重抓是 tokio::spawn，給它一點時間跑完
            for _ in 0..50 {
                if !server.received_requests().await.unwrap().is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            let hit = !server.received_requests().await.unwrap().is_empty();
            assert_eq!(hit, should_refetch, "{why}：預期重抓={should_refetch}，實際={hit}");
        }

        // SAFETY: 見上。
        unsafe {
            std::env::remove_var("STEAM_API_KEY");
            std::env::remove_var("STEAM_ID");
        }
    }

    // ── Books 外部搜尋 ────────────────────────────────────────────────────

    #[test]
    fn upgrade_google_cover_照抄_js_replace_只換第一次出現() {
        // 空字串直接回空——不要生出一個 "&zoom=0&w=500&h=800" 這種連不到的網址
        assert_eq!(upgrade_google_cover(""), "");

        let got = upgrade_google_cover("https://books.google.com/x?id=1&zoom=1&edge=curl&img=1");
        assert!(got.contains("&zoom=0"), "zoom=1 要換成 zoom=0（要高解析度）");
        assert!(!got.contains("edge=curl"), "捲角效果要拿掉");
        assert!(got.contains("&img=1&w=500&h=800"));

        // 本來就沒有 zoom / w 的要補上
        let got = upgrade_google_cover("https://books.google.com/x?id=1");
        assert!(got.ends_with("&zoom=0&w=500&h=800"), "得到 {got}");

        // 只換第一次出現（JS 的 String.replace 語意）
        let got = upgrade_google_cover("https://x/?a&zoom=1&b&zoom=1");
        assert_eq!(got.matches("zoom=1").count(), 1, "第二個 zoom=1 不該被換掉");
    }

    #[tokio::test]
    async fn books_search_external_沒給關鍵字就_400() {
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let resp = books_search_external(
            axum::extract::State(st),
            axum::extract::Query(BookSearchQuery { query: None, isbn: Some(String::new()) }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_of(resp).await["error"], "請提供書名或 ISBN");
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn books_search_external_認得出_isbn_並改用_isbn_查詢() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/openlibrary/search.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "docs": [] })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        // 帶連字號的 ISBN：查詢字串要變成 isbn:<去掉連字號>
        let _ = books_search_external(
            axum::extract::State(st),
            axum::extract::Query(BookSearchQuery { query: None, isbn: Some("978-1-234-56789-0".into()) }),
        )
        .await;
        let reqs = server.received_requests().await.unwrap();
        let google = reqs.iter().find(|r| r.url.path().contains("volumes")).expect("該打 Google Books");
        let q = google.url.query_pairs().find(|(k, _)| k == "q").unwrap().1.into_owned();
        assert_eq!(q, "isbn:9781234567890", "連字號要去掉，而且加上 isbn: 前綴");
    }

    #[tokio::test]
    async fn books_search_external_google_有結果就不打_openlibrary() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "items": [{ "volumeInfo": {
                    "title": "測試書名",
                    "authors": ["作者一", "作者二"],
                    "publisher": "某出版社",
                    "industryIdentifiers": [
                        { "type": "ISBN_10", "identifier": "1234567890" },
                        { "type": "ISBN_13", "identifier": "9781234567890" },
                    ],
                    "imageLinks": { "thumbnail": "https://books.google.com/x?img=1&zoom=1" },
                    "pageCount": 320,
                    "categories": ["Computers", "Programming"],
                }}]
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let v = body_of(
            books_search_external(
                axum::extract::State(st),
                axum::extract::Query(BookSearchQuery { query: Some("測試".into()), isbn: None }),
            )
            .await,
        )
        .await;
        let books = v["books"].as_array().unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0]["isbn"], "9781234567890", "ISBN_13 優先於 ISBN_10");
        assert_eq!(books[0]["authors"], "作者一, 作者二", "多位作者用逗號串起來");
        assert_eq!(books[0]["categories"], "Computers, Programming");
        assert_eq!(books[0]["page_count"], 320);
        assert_eq!(books[0]["source"], "google");
        assert!(books[0]["cover_url"].as_str().unwrap().contains("zoom=0"));
        // 有結果就不該再打補位的那支
        let paths: Vec<String> =
            server.received_requests().await.unwrap().iter().map(|r| r.url.path().to_string()).collect();
        assert!(!paths.iter().any(|p| p.contains("openlibrary")), "Google 有結果就不必補位");
    }

    // ── Steam miniprofile 的 HTML 爬取 ────────────────────────────────────
    //
    // 五條 regex 在刮 Steam 的頁面。Steam 改版或 regex 寫歪的話，個人檔案只會靜靜地
    // 少掉頭像框／名牌／徽章——沒有錯誤、沒有 log，而且沒有人會注意到。

    /// 形狀取自實際的 miniprofile 頁面（屬性順序與換行都照原樣）。
    const MINI_PROFILE_HTML: &str = r#"
<div class="miniprofile_nameplate_container">
  <video class="miniprofile_nameplate" autoplay loop muted playsinline poster="https://cdn/poster.png">
    <source src="https://cdn/nameplate.webm" type="video/webm">
    <source src="https://cdn/nameplate.mp4" type="video/mp4">
  </video>
</div>
<div class="playersection_avatar_frame">
  <img src="https://cdn/frame.png">
</div>
<div class="playersection_avatar has_frame">
  <img src="https://cdn/avatar.gif">
</div>
<div class="miniprofile_featuredcontainer">
  <img src="https://cdn/badge.png" class="badge_icon">
  <div class="description">
    <div class="name">  Steam 十週年  </div>
    <div class="xp">1,234 XP</div>
  </div>
</div>
"#;

    #[test]
    fn parse_mini_profile_刮得出五種客製() {
        let c = parse_mini_profile(MINI_PROFILE_HTML);
        assert_eq!(c.nameplate_webm.as_deref(), Some("https://cdn/nameplate.webm"));
        assert_eq!(c.nameplate_mp4.as_deref(), Some("https://cdn/nameplate.mp4"));
        assert_eq!(c.avatar_frame.as_deref(), Some("https://cdn/frame.png"));
        assert_eq!(
            c.animated_avatar.as_deref(),
            Some("https://cdn/avatar.gif"),
            "動態頭像不能抓到頭像框那張——兩個 class 名字只差一個底線"
        );
        let b = c.featured_badge.expect("展示徽章");
        assert_eq!(b.icon, "https://cdn/badge.png");
        assert_eq!(b.name, "Steam 十週年", "name 與 xp 都要 trim");
        assert_eq!(b.xp, "1,234 XP", "XP 是已格式化的字串不是數字");
    }

    #[test]
    fn parse_mini_profile_沒有客製時全部是_none() {
        // 大多數帳號長這樣。這條擋的是「regex 太寬鬆而抓到不相干的東西」。
        let plain = r#"<div class="miniprofile_container"><img src="https://cdn/plain.jpg"></div>"#;
        let c = parse_mini_profile(plain);
        assert!(c.nameplate_webm.is_none());
        assert!(c.nameplate_mp4.is_none());
        assert!(c.avatar_frame.is_none());
        assert!(c.animated_avatar.is_none());
        assert!(c.featured_badge.is_none());

        let c = parse_mini_profile("");
        assert!(c.animated_avatar.is_none(), "空字串要早退，不是丟給 regex");
    }

    #[test]
    fn parse_mini_profile_只有部分客製時其餘保持_none() {
        // 只有頭像框沒有名牌——很常見的組合。全有或全無的實作會在這裡露餡。
        let only_frame = r#"<div class="playersection_avatar_frame">
  <img src="https://cdn/only-frame.png">
</div>"#;
        let c = parse_mini_profile(only_frame);
        assert_eq!(c.avatar_frame.as_deref(), Some("https://cdn/only-frame.png"));
        assert!(c.nameplate_webm.is_none());
        assert!(c.featured_badge.is_none());

        // 名牌只有 webm 沒有 mp4（Steam 上真的有這種）
        let webm_only = r#"<video class="miniprofile_nameplate" autoplay>
  <source src="https://cdn/a.webm" type="video/webm">
</video>"#;
        let c = parse_mini_profile(webm_only);
        assert_eq!(c.nameplate_webm.as_deref(), Some("https://cdn/a.webm"));
        assert!(c.nameplate_mp4.is_none(), "沒有 mp4 就是 None，不要退回 webm 那條");
    }

    #[test]
    fn parse_mini_profile_的名牌來源只從_video_區塊內找() {
        // 頁面別處也可能有 .mp4 的連結；抓錯範圍會把不相干的影片當成名牌。
        let html = r#"
<a href="https://cdn/unrelated.mp4">別的影片</a>
<video class="miniprofile_nameplate" autoplay>
  <source src="https://cdn/real-nameplate.mp4" type="video/mp4">
</video>"#;
        let c = parse_mini_profile(html);
        assert_eq!(
            c.nameplate_mp4.as_deref(),
            Some("https://cdn/real-nameplate.mp4"),
            "要從 <video> 區塊裡找，不是整頁亂抓"
        );
    }

    #[tokio::test]
    async fn books_search_external_google_空手時退到_openlibrary() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/openlibrary/search.json"))
            .and(query_param("q", "冷門書"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "docs": [{
                    "title": "冷門書",
                    "author_name": ["某人"],
                    "first_publish_year": 1999,
                    "number_of_pages_median": 250,
                }]
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let v = body_of(
            books_search_external(
                axum::extract::State(st),
                axum::extract::Query(BookSearchQuery { query: Some("冷門書".into()), isbn: None }),
            )
            .await,
        )
        .await;
        let books = v["books"].as_array().unwrap();
        assert_eq!(books.len(), 1, "Google 沒結果就該換 OpenLibrary");
        assert_eq!(books[0]["title"], "冷門書");
        assert_eq!(books[0]["source"], "openlibrary");
        assert_eq!(books[0]["page_count"], 250);
    }

    /// OpenLibrary 的 **ISBN 分支走完全不同的端點與回應形狀**（`/api/books` 而不是
    /// `/search.json`，資料包在 `"ISBN:<號碼>"` 這個 key 底下）。同一支函式兩條路，
    /// 只測其中一條等於沒測到另一條——而 ISBN 查詢正是新增書籍最常走的那條。
    #[tokio::test]
    async fn books_search_external_的_isbn_走_openlibrary_的另一支端點() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/openlibrary/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "ISBN:9781234567890": {
                    "title": "以 ISBN 查到的書",
                    "authors": [{ "name": "作者甲" }, { "name": "作者乙" }],
                    "publishers": [{ "name": "某出版社" }],
                    "publish_date": "2020",
                    "number_of_pages": 512,
                    "cover": { "medium": "https://covers.openlibrary.org/m.jpg" },
                    "subjects": [
                        { "name": "分類一" }, { "name": "分類二" }, { "name": "分類三" },
                        { "name": "分類四" }, { "name": "分類五" }, { "name": "第六個不該出現" },
                    ],
                    "excerpts": [{ "text": "摘錄的內容" }],
                }
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            books_search_external(
                axum::extract::State(st),
                axum::extract::Query(BookSearchQuery { query: None, isbn: Some("978-1-234-56789-0".into()) }),
            )
            .await,
        )
        .await;
        let b = &v["books"][0];
        assert_eq!(b["isbn"], "9781234567890", "連字號要去掉才對得上回應的 key");
        assert_eq!(b["title"], "以 ISBN 查到的書");
        assert_eq!(b["authors"], "作者甲, 作者乙", "這裡的作者是物件陣列不是字串陣列");
        assert_eq!(b["publisher"], "某出版社");
        assert_eq!(b["page_count"], 512);
        assert_eq!(b["cover_url"], "https://covers.openlibrary.org/m.jpg", "large 沒有就退 medium");
        assert_eq!(b["description"], "摘錄的內容", "沒有 notes 時退到 excerpts[0].text");
        // 註：`notes` 是**空字串**時也要退到 excerpts，見下面那條測試。
        assert_eq!(b["categories"], "分類一, 分類二, 分類三, 分類四, 分類五", "分類只取前五個");
        assert_eq!(b["source"], "openlibrary");
    }

    /// `notes` 是**空字串**時要當成沒有，退到 excerpts。
    ///
    /// 這條是 `cargo mutants` 指出來的：把 `.filter(|s| !s.is_empty())` 的驚嘆號刪掉
    /// 測試照樣全綠，因為既有的案例裡 notes 根本不存在（走的是 `and_then` 的 None 那側）。
    /// OpenLibrary 實際上很常回空字串，那時書籍簡介會整個變空白。
    #[tokio::test]
    async fn books_search_external_的_notes_是空字串時退到_excerpts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/openlibrary/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "ISBN:9781234567890": {
                    "title": "有空 notes 的書",
                    "notes": "",
                    "excerpts": [{ "text": "退而求其次的簡介" }],
                }
            })))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            books_search_external(
                axum::extract::State(st),
                axum::extract::Query(BookSearchQuery { query: None, isbn: Some("9781234567890".into()) }),
            )
            .await,
        )
        .await;
        assert_eq!(v["books"][0]["description"], "退而求其次的簡介", "空字串的 notes 不算有值");
    }

    #[tokio::test]
    async fn books_search_external_的_isbn_查不到時回空清單而不是報錯() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/google-books/books/v1/volumes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
            .mount(&server)
            .await;
        // OpenLibrary 查不到時回的是 `{}`，不是 404
        Mock::given(method("GET"))
            .and(path("/openlibrary/api/books"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;

        let st = state_with_mock(&server).await;
        let v = body_of(
            books_search_external(
                axum::extract::State(st),
                axum::extract::Query(BookSearchQuery { query: None, isbn: Some("9789999999999".into()) }),
            )
            .await,
        )
        .await;
        assert_eq!(v["message"], "success", "查不到不是錯誤");
        assert_eq!(v["books"].as_array().unwrap().len(), 0);
    }
}
