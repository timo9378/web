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
    let url = format!("https://api.github.com/users/{username}");
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
        public_repos: v.get("public_repos").and_then(|x| x.as_i64()),
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
    let Some(v) = gh_fetch(&state.http, &path, token.as_deref()).await else {
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
                id: r.get("id").and_then(|x| x.as_i64())?,
                name: r.get("name").and_then(|x| x.as_str())?.to_string(),
                html_url: r.get("html_url").and_then(|x| x.as_str())?.to_string(),
                description: r.get("description").and_then(|x| x.as_str()).map(String::from),
                language: r.get("language").and_then(|x| x.as_str()).map(String::from),
                stargazers_count: r.get("stargazers_count").and_then(|x| x.as_i64()).unwrap_or(0),
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
        r#"query($login: String!) {{
             user(login: $login) {{
               contributionsCollection{args} {{
                 contributionCalendar {{
                   totalContributions
                   weeks {{ contributionDays {{ date contributionCount }} }}
                 }}
               }}
             }}
           }}"#
    );
    let body = json!({ "query": query, "variables": { "login": username } }).to_string();
    let resp = state
        .http
        .post("https://api.github.com/graphql")
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
                        count: d.get("contributionCount").and_then(|x| x.as_i64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let total = cal.and_then(|c| c.get("totalContributions")).and_then(|t| t.as_i64()).unwrap_or(0);
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
    let events = gh_fetch(&state.http, &path, token.as_deref()).await;

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
            size: p.and_then(|p| p.get("size")).and_then(|v| v.as_i64()),
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
                        percent: x.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0),
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
    let mut v: Value = serde_json::from_str(&body).unwrap_or(Value::from(body));
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
    let url_summary = format!("https://wakatime.com/api/v1/users/current/summaries?start={date}&end={date}");
    let url_durations = format!("https://wakatime.com/api/v1/users/current/durations?date={date}");
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
        if let Some(t) = d.get("time").and_then(|v| v.as_f64()) {
            actual_start = Some(actual_start.map_or(t, |e| e.min(t)));
            let end = t + d.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
            actual_end = Some(actual_end.map_or(end, |e| e.max(end)));
        }
    }
    let gt = summary.pointer("/data/0/grand_total");

    Json(WakatimeTodayResponse {
        grand_total: gt.map(|g| WakatimeGrandTotal {
            text: g.get("text").and_then(|v| v.as_str()).map(String::from),
            total_seconds: g.get("total_seconds").and_then(|v| v.as_f64()),
        }),
        start: summary.get("start").and_then(|v| v.as_str()).map(String::from),
        end: summary.get("end").and_then(|v| v.as_str()).map(String::from),
        actual_coding_time: WakatimeActualCodingTime {
            // JS new Date(x*1000)：ms 取整（ToInteger 截斷）
            start: actual_start.map(|t| iso_from_millis((t * 1000.0) as i64)),
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
    match waka_get(&state.http, "https://wakatime.com/api/v1/users/current/stats/last_7_days", &key).await {
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
                    appid: g.get("appid").and_then(|x| x.as_i64()),
                    name: g.get("name").and_then(|x| x.as_str()).map(String::from),
                    playtime_2weeks: g.get("playtime_2weeks").and_then(|x| x.as_i64()),
                    playtime_forever: g.get("playtime_forever").and_then(|x| x.as_i64()),
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
        format!("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key={key}&steamids={id}");
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
        personastate: p.get("personastate").and_then(|v| v.as_i64()),
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
                .then(|| v.pointer("/response/game_count").and_then(|x| x.as_i64()))
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
        "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key={key}&steamid={id}&format=json"
    );
    steam_games(&state, &url, false).await
}

#[utoipa::path(get, path = "/api/steam/owned-games", tag = "integrations",
    responses((status = 200, body = SteamGamesResponse)))]
pub async fn steam_owned_games(State(state): State<AppState>) -> Response {
    let Some((key, id)) = steam_env() else { return steam_games_unconfigured() };
    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key={key}&steamid={id}&include_appinfo=true&include_played_free_games=true&format=json"
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
            icon: c.get(1).map(|m| m.as_str()).unwrap_or("").to_string(),
            name: c.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
            xp: c.get(3).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
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
    let result: Result<SteamProfile, String> = (|| {
        let player = player?;
        let level = level?;
        let badges = badges.unwrap_or(Value::Null);
        let player_obj = player.pointer("/response/players/0");
        let lvl = level.pointer("/response/player_level").and_then(|v| v.as_i64());
        let (Some(player_obj), Some(level)) = (player_obj, lvl) else {
            return Err("incomplete response from Steam".to_string());
        };
        let badge_count =
            badges.pointer("/response/badges").and_then(|b| b.as_array()).map(|a| a.len()).unwrap_or(0);
        Ok(SteamProfile {
            player: steam_player_from(player_obj),
            level,
            xp: badges.pointer("/response/player_xp").and_then(|v| v.as_i64()).unwrap_or(0),
            xp_to_next: badges
                .pointer("/response/player_xp_needed_to_level_up")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            badge_count: badge_count as i64,
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
    if let Some(c) = state.steam.cache.lock().clone() {
        return Json(SteamProfileResponse { profile: c.data, cached_at: c.fetched_at }).into_response();
    }
    match refresh_steam_profile(&state, &key, &id).await {
        Ok(profile) => {
            let cached_at = state.steam.cache.lock().as_ref().map(|c| c.fetched_at).unwrap_or(now_ms());
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
}
