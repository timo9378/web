use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

use crate::handlers::posts::{CommentRow, CommentsResponse};
use crate::{error::AppError, state::AppState};

/// 從 DB 取出的 thought 列（欄位順序對齊 live `thoughts` 表的實際 `t.*` 展開：
/// dislikes 是後加欄位、排在最後）。
#[derive(Debug, FromRow)]
struct ThoughtRow {
    id: i64,
    content: String,
    ref_type: Option<String>,
    ref_url: Option<String>,
    ref_json: Option<String>,
    likes: i64,
    created_at: String,
    updated_at: Option<String>,
    // edited 在 sqlite 是 INTEGER 0/1；sqlx 直接解成 bool，對齊 Express 的 `!!r.edited`
    edited: bool,
    dislikes: i64,
    comment_count: i64,
}

/// `ref` 裡少數幾個「字串或數字都可能」的欄位。enrich 自己寫的是字串
/// （`rating` 走 `format!("{:.1}")`、`year` 取日期前 4 碼），但同一個 key 也可能
/// 來自呼叫端 `ref.json` 的原值，那邊沒有任何東西保證它是字串。
///
/// 與 gallery 的 `ExifValue` 刻意各自一份：兩邊的 union 是不同原因造成的
/// （那邊是兩個寫入端格式不同，這邊是 enrich 覆值與呼叫端原值並存），
/// 綁在一起只會讓其中一邊的註解變成謊話。
#[derive(Debug, Clone, Deserialize, specta::Type, utoipa::ToSchema)]
#[serde(untagged)]
pub enum ThoughtRefScalar {
    Num(#[specta(type = specta_typescript::Number)] f64),
    Text(String),
}

impl Serialize for ThoughtRefScalar {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            // 走 ser_js_number 而非直接寫 f64：ref_json 裡的 tmdbId 是 123，
            // 原樣讀進來就該原樣寫回去，不該變成 123.0
            Self::Num(n) => crate::util::ser_js_number(n, s),
            Self::Text(t) => s.serialize_str(t),
        }
    }
}

/// `ref_json` 解析後的物件。這欄不是自由格式——本 repo 裡只有兩個產生者：
///   - `unfurl_url`（`ref_type="link"`）→ title / desc / image / site
///   - `enrich_media_ref`（`ref_type="media"`）→ source / url / title / overview /
///     rating / genres / year / poster，外加呼叫端 `ref.json` 帶進來的
///     kind / mediaType / tmdbId（那三個 enrich 只是 spread 過去，自己不產）
///
/// 線上 5 則碎念裡 2 則有 ref，兩則都是 link。media 這條路目前沒有任何 client
/// 走得到（MCP 只送 content/refUrl/clearRef），欄位是照 enrich_media_ref 的
/// 實作列的，不是猜的。
///
/// 未列到的 key 會在 `ref` 裡被丟掉，但同一個回應的 `ref_json` 是原封不動的
/// 字串，所以資料不會不見。
#[derive(Debug, Clone, Deserialize, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ThoughtRef {
    pub title: Option<String>,
    pub desc: Option<String>,
    pub image: Option<String>,
    pub site: Option<String>,
    // 以下是 media（TMDb 卡片）用的
    pub kind: Option<String>,
    pub url: Option<String>,
    pub source: Option<String>,
    pub overview: Option<String>,
    pub genres: Option<String>,
    pub poster: Option<String>,
    #[serde(rename = "mediaType")]
    pub media_type: Option<String>,
    pub rating: Option<ThoughtRefScalar>,
    pub year: Option<ThoughtRefScalar>,
    #[serde(rename = "tmdbId")]
    pub tmdb_id: Option<ThoughtRefScalar>,
}

/// 對外輸出的 thought：欄位順序 = Express `{ ...r, edited, ref }` 後的實際 key 順序。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ThoughtOut {
    #[specta(type = specta_typescript::Number)]
    id: i64,
    content: String,
    ref_type: Option<String>,
    ref_url: Option<String>,
    ref_json: Option<String>,
    #[specta(type = specta_typescript::Number)]
    likes: i64,
    created_at: String,
    updated_at: Option<String>,
    edited: bool,
    #[specta(type = specta_typescript::Number)]
    dislikes: i64,
    #[specta(type = specta_typescript::Number)]
    comment_count: i64,
    /// Express 的 `ref: safeParse(r.ref_json)`：解析成功→物件、失敗或 null→JSON null。
    #[serde(rename = "ref")]
    ref_val: Option<ThoughtRef>,
}

impl From<ThoughtRow> for ThoughtOut {
    fn from(r: ThoughtRow) -> Self {
        // safeParse 等價：解析 ref_json；None 或形狀不符 → null。形狀不符會 warn ——
        // 原字串仍在 ref_json 欄位裡，不會靜靜掉資料。
        let ref_val = r.ref_json.as_deref().and_then(|s| match serde_json::from_str::<ThoughtRef>(s) {
            Ok(v) => Some(v),
            Err(e) => {
                tracing::warn!("[thoughts] id={} 的 ref_json 形狀不符（ref 回 null）：{e}", r.id);
                None
            }
        });
        ThoughtOut {
            id: r.id,
            content: r.content,
            ref_type: r.ref_type,
            ref_url: r.ref_url,
            ref_json: r.ref_json,
            likes: r.likes,
            created_at: r.created_at,
            updated_at: r.updated_at,
            edited: r.edited,
            dislikes: r.dislikes,
            comment_count: r.comment_count,
            ref_val,
        }
    }
}

/// 顯式列出 `t.*` 的欄位（依 live 表實際順序），加上 comment_count 子查詢。
/// 用顯式欄位而非 `t.*`，讓 FromRow 穩定、也不依賴實體欄位順序變動。
const THOUGHT_SELECT: &str = r#"
    t.id, t.content, t.ref_type, t.ref_url, t.ref_json, t.likes,
    t.created_at, t.updated_at, t.edited, t.dislikes,
    (SELECT COUNT(*) FROM comments c WHERE c.thought_id = t.id AND c.status = 'approved') AS comment_count
"#;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    limit: Option<String>,
    offset: Option<String>,
}

/// 模擬 JS `parseInt(s, 10)`：略過前導空白、吃可選正負號與後續數字；無數字→default。
fn js_parse_int(s: &str, default: i64) -> i64 {
    let t = s.trim_start();
    let mut out = String::new();
    let mut chars = t.chars().peekable();
    if let Some(&c) = chars.peek()
        && (c == '+' || c == '-')
    {
        out.push(c);
        chars.next();
    }
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() {
            out.push(c);
            chars.next();
        } else {
            break;
        }
    }
    if out.is_empty() || out == "+" || out == "-" { default } else { out.parse().unwrap_or(default) }
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ThoughtsListResponse {
    message: &'static str,
    thoughts: Vec<ThoughtOut>,
}

/// `GET /api/thoughts` —— 公開列表。limit/offset 夾擠規則照抄 Express。
#[utoipa::path(get, path = "/api/thoughts", tag = "thoughts",
    params(("limit" = Option<String>, Query), ("offset" = Option<String>, Query)),
    responses((status = 200, body = ThoughtsListResponse)))]
pub async fn list_thoughts(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<ThoughtsListResponse>, AppError> {
    // Express: min(parseInt(limit||'30'),100) / max(parseInt(offset||'0'),0)
    let limit = q.limit.as_deref().map(|s| js_parse_int(s, 30)).unwrap_or(30).min(100);
    let offset = q.offset.as_deref().map(|s| js_parse_int(s, 0)).unwrap_or(0).max(0);

    let sql = format!(
        "SELECT {THOUGHT_SELECT} FROM thoughts t ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?"
    );
    let rows = sqlx::query_as::<_, ThoughtRow>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(ThoughtsListResponse {
        message: "success",
        thoughts: rows.into_iter().map(ThoughtOut::from).collect(),
    }))
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ThoughtDetailResponse {
    message: &'static str,
    thought: ThoughtOut,
}

/// `GET /api/thoughts/:id` —— 公開單篇。找不到回 404 `{"error":"not found"}`（對齊 Express）。
#[utoipa::path(get, path = "/api/thoughts/{id}", tag = "thoughts",
    params(("id" = String, Path)),
    responses((status = 200, body = ThoughtDetailResponse), (status = 404, description = "找不到")))]
pub async fn get_thought(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ThoughtDetailResponse>, AppError> {
    let sql = format!("SELECT {THOUGHT_SELECT} FROM thoughts t WHERE t.id = ?");
    let row = sqlx::query_as::<_, ThoughtRow>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;

    match row {
        Some(r) => Ok(Json(ThoughtDetailResponse { message: "success", thought: r.into() })),
        // Express 回 404 + {"error":"not found"}；用 AppError 之外的明確分支處理
        None => Err(AppError::not_found("not found")),
    }
}

/// `GET /api/thoughts/:id/comments` —— 與 blog 留言共用同一張 comments 表，
/// 只是 key 在 thought_id。重用 `posts::CommentRow`（其 14 欄 row 解碼已由 post 留言驗過）。
#[utoipa::path(get, path = "/api/thoughts/{id}/comments", tag = "thoughts",
    params(("id" = String, Path)),
    responses((status = 200, body = CommentsResponse)))]
pub async fn list_thought_comments(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CommentsResponse>, AppError> {
    let comments = sqlx::query_as::<_, CommentRow>(
        "SELECT id, post_id, author, content, likes, created_at, is_admin, email, website, status, ip, parent_id, avatar_url, thought_id \
         FROM comments WHERE thought_id = ? AND status = 'approved' ORDER BY created_at ASC",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(CommentsResponse::new(comments)))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReactBody {
    prev: Option<String>,
    next: Option<String>,
}

/// 反應值是否合法：like / dislike / '' / null。
fn react_ok(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some("like") | Some("dislike") | Some("") | None)
}

/// `POST /api/thoughts/:id/react` 的回應。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ThoughtReactResponse {
    pub message: &'static str,
    #[specta(type = specta_typescript::Number)]
    pub likes: i64,
    #[specta(type = specta_typescript::Number)]
    pub dislikes: i64,
}

/// `POST /api/thoughts/:id/react` —— 讚/倒讚切換（依 prev→next 差值調整，clamp 0）。
/// 信任 client 的 prev（個人站可接受）。找不到 id 也回 success+0/0（對齊 Express，不 404）。
#[utoipa::path(post, path = "/api/thoughts/{id}/react", tag = "thoughts",
    params(("id" = String, Path)),
    responses((status = 200, body = ThoughtReactResponse)))]
pub async fn thought_react(
    State(state): State<AppState>,
    Path(id): Path<String>,
    crate::error::JsonBody(body): crate::error::JsonBody<ReactBody>,
) -> Response {
    if !react_ok(&body.prev) || !react_ok(&body.next) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad reaction" }))).into_response();
    }
    let d_like =
        (body.next.as_deref() == Some("like")) as i64 - (body.prev.as_deref() == Some("like")) as i64;
    let d_dislike =
        (body.next.as_deref() == Some("dislike")) as i64 - (body.prev.as_deref() == Some("dislike")) as i64;

    if let Err(e) = sqlx::query(
        "UPDATE thoughts SET likes = MAX(0, likes + ?), dislikes = MAX(0, dislikes + ?) WHERE id = ?",
    )
    .bind(d_like)
    .bind(d_dislike)
    .bind(&id)
    .execute(&state.pool)
    .await
    {
        return crate::error::internal_error(StatusCode::BAD_REQUEST, e);
    }

    let row = sqlx::query_as::<_, (i64, i64)>("SELECT likes, dislikes FROM thoughts WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    let (likes, dislikes) = row.unwrap_or((0, 0));
    Json(ThoughtReactResponse { message: "success", likes, dislikes }).into_response()
}

// ════════════════ admin thoughts CRUD（requireAdmin）════════════════
use serde_json::Map;

use crate::auth::require_admin;
use crate::util::{js_interp, js_truthy};

/// html entity decode，複製 Express `dec()`（同序替換；`&#0?39;` 兩型都處理）。
fn dec(s: Option<String>) -> Option<String> {
    s.map(|v| {
        v.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#039;", "'")
            .replace("&#39;", "'")
    })
}

/// 從 html 抽 og meta（複製 Express 的兩條 regex：property/name 在 content 前或後）。
fn og(html: &str, prop: &str) -> Option<String> {
    let p = regex::escape(prop);
    let a = regex::RegexBuilder::new(&format!(
        r#"<meta[^>]+(?:property|name)=["']{p}["'][^>]+content=["']([^"']+)["']"#
    ))
    .case_insensitive(true)
    .build()
    .ok()?;
    if let Some(c) = a.captures(html).and_then(|c| c.get(1)) {
        return Some(c.as_str().to_string());
    }
    let b = regex::RegexBuilder::new(&format!(
        r#"<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']{p}["']"#
    ))
    .case_insensitive(true)
    .build()
    .ok()?;
    b.captures(html).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

/// 簡易 unfurl：抓 URL 的 og:title/description/image/site_name（複製 Express `unfurlUrl`）。
/// 失敗（非 http(s)/逾時/非 2xx）回 None。
async fn unfurl_url(http: &reqwest::Client, url: &str) -> Option<Value> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return None;
    }
    let resp = http
        .get(url)
        .timeout(std::time::Duration::from_secs(6))
        .header("User-Agent", "Mozilla/5.0 (compatible; koimsurai-bot/1.0; +https://koimsurai.com)")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let full = resp.text().await.ok()?;
    // JS html.slice(0, 200000)：UTF-16 code unit 截斷
    let html: String = if full.encode_utf16().count() > 200_000 {
        let units: Vec<u16> = full.encode_utf16().take(200_000).collect();
        String::from_utf16_lossy(&units)
    } else {
        full
    };

    let title_tag = regex::RegexBuilder::new(r"<title[^>]*>([^<]+)</title>")
        .case_insensitive(true)
        .build()
        .ok()?
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string());

    let title = dec(og(&html, "og:title").or(title_tag));
    let desc = dec(og(&html, "og:description").or_else(|| og(&html, "description")));
    let image = og(&html, "og:image");
    let host = parsed.host_str().unwrap_or("");
    let site = dec(og(&html, "og:site_name"))
        .unwrap_or_else(|| host.strip_prefix("www.").unwrap_or(host).to_string());

    Some(serde_json::json!({ "title": title, "desc": desc, "image": image, "site": site }))
}

/// 媒體 ref enrich：給 tmdbId + mediaType，向 TMDb 補完整卡片資料（複製 Express `enrichMediaRef`）。
/// key 順序：先 spread 原 json、再 source/url/title/…（serde Map insert 對既有 key 保位、新 key 追加，
/// 語意同 JS 物件賦值 → stringify 後 byte 對齊）。
async fn enrich_media_ref(http: &reqwest::Client, json: &Map<String, Value>) -> Map<String, Value> {
    let mut out = json.clone();
    out.insert("source".into(), Value::from("www.themoviedb.org"));
    let mt = if json.get("mediaType").and_then(|v| v.as_str()) == Some("movie") { "movie" } else { "tv" };
    let tmdb_id = json.get("tmdbId").filter(|v| js_truthy(Some(v))).map(js_interp);
    out.insert(
        "url".into(),
        match &tmdb_id {
            Some(id) => Value::from(format!("https://www.themoviedb.org/{mt}/{id}")),
            None => Value::Null,
        },
    );
    let token = std::env::var("TMDB_API_TOKEN").unwrap_or_default();
    if !token.is_empty()
        && let Some(id) = &tmdb_id
    {
        let resp = http
            .get(format!("https://api.themoviedb.org/3/{mt}/{id}?language=zh-TW"))
            .bearer_auth(&token)
            .header("accept", "application/json")
            .send()
            .await;
        if let Ok(r) = resp
            && r.status().is_success()
        {
            // reqwest 未開 json feature，text + serde 解析
            if let Ok(d) =
                r.text().await.map_err(|_| ()).and_then(|t| serde_json::from_str::<Value>(&t).map_err(|_| ()))
            {
                let pick = |v: Option<&Value>| -> Option<String> {
                    v.filter(|x| js_truthy(Some(x))).and_then(|x| x.as_str()).map(String::from)
                };
                let title = pick(json.get("title"))
                    .or_else(|| pick(d.get("title")))
                    .or_else(|| pick(d.get("name")))
                    .unwrap_or_default();
                out.insert("title".into(), Value::from(title));
                out.insert("overview".into(), Value::from(pick(d.get("overview")).unwrap_or_default()));
                let rating = d
                    .get("vote_average")
                    .and_then(|v| v.as_f64())
                    .filter(|&v| v != 0.0)
                    .map(|v| format!("{v:.1}"));
                out.insert("rating".into(), rating.map(Value::from).unwrap_or(Value::Null));
                let genres = d
                    .get("genres")
                    .and_then(|g| g.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|g| g.get("name").and_then(|n| n.as_str()))
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .filter(|s| !s.is_empty());
                out.insert("genres".into(), genres.map(Value::from).unwrap_or(Value::Null));
                // (release_date || first_air_date || '').slice(0,4) || json.year || null
                let date =
                    pick(d.get("release_date")).or_else(|| pick(d.get("first_air_date"))).unwrap_or_default();
                let y: String = date.chars().take(4).collect();
                let year = if !y.is_empty() {
                    Value::from(y)
                } else if js_truthy(json.get("year")) {
                    json.get("year").cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                };
                out.insert("year".into(), year);
                let poster = if js_truthy(json.get("poster")) {
                    json.get("poster").cloned().unwrap_or(Value::Null)
                } else if let Some(p) = pick(d.get("poster_path")) {
                    Value::from(format!("https://image.tmdb.org/t/p/w500{p}"))
                } else {
                    Value::Null
                };
                out.insert("poster".into(), poster);
            }
        }
    }
    out
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct AdminThoughtBody {
    content: Option<String>,
    #[serde(rename = "refUrl")]
    ref_url: Option<String>,
    #[serde(rename = "ref")]
    ref_obj: Option<Value>,
    #[serde(rename = "clearRef")]
    clear_ref: Option<Value>,
}

/// 依 body 解析出 (ref_type, ref_url, ref_json)（POST 分支邏輯；PUT 不做 media enrich）。
async fn resolve_ref_for_create(
    http: &reqwest::Client,
    body: &AdminThoughtBody,
) -> (Option<String>, Option<String>, Option<String>) {
    if let Some(r) = &body.ref_obj {
        let rtype = r.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let json_truthy = js_truthy(r.get("json"));
        if rtype == "media" && json_truthy {
            let obj = r.get("json").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            let m = enrich_media_ref(http, &obj).await;
            let url = m.get("url").filter(|v| js_truthy(Some(v))).and_then(|v| v.as_str()).map(String::from);
            let s = serde_json::to_string(&Value::Object(m)).ok();
            return (Some("media".into()), url, s);
        }
        if !rtype.is_empty() && json_truthy {
            let url = r.get("url").filter(|v| js_truthy(Some(v))).and_then(|v| v.as_str()).map(String::from);
            let s = r.get("json").and_then(|j| serde_json::to_string(j).ok());
            return (Some(rtype.to_string()), url, s);
        }
    }
    if let Some(u) = body.ref_url.as_deref().filter(|s| !s.is_empty()) {
        let meta = unfurl_url(http, u).await.unwrap_or_else(|| serde_json::json!({}));
        return (Some("link".into()), Some(u.to_string()), serde_json::to_string(&meta).ok());
    }
    (None, None, None)
}

/// `POST /api/admin/thoughts` —— 建立碎念（可帶 refUrl 自動 unfurl，或 ref:{type,url,json}；media 會 TMDb enrich）。
#[utoipa::path(post, path = "/api/admin/thoughts", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "建立碎念（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn admin_create_thought(
    State(state): State<AppState>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(body): crate::error::JsonBody<AdminThoughtBody>,
) -> Response {
    let content = body.content.clone().unwrap_or_default();
    if content.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "content required" }))).into_response();
    }
    let (ref_type, r_url, ref_json) = resolve_ref_for_create(&state.http, &body).await;
    match sqlx::query("INSERT INTO thoughts (content, ref_type, ref_url, ref_json) VALUES (?, ?, ?, ?)")
        .bind(content.trim())
        .bind(&ref_type)
        .bind(&r_url)
        .bind(&ref_json)
        .execute(&state.pool)
        .await
    {
        Ok(r) => Json(json!({ "message": "success", "id": r.last_insert_rowid() })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `PUT /api/admin/thoughts/:id` —— 編輯（標記 edited + updated_at）。
/// ref 分支對齊 Express：clearRef → 清空；ref{type,json} → 直接覆寫（**不** enrich）；
/// refUrl 且與現值不同 → 重新 unfurl；否則保留原 ref。
#[utoipa::path(put, path = "/api/admin/thoughts/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "更新碎念（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn admin_update_thought(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(body): crate::error::JsonBody<AdminThoughtBody>,
) -> Response {
    let row = sqlx::query_as::<_, (String, Option<String>, Option<String>, Option<String>)>(
        "SELECT content, ref_type, ref_url, ref_json FROM thoughts WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await;
    let (old_content, mut ref_type, mut r_url, mut ref_json) = match row {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))).into_response(),
        Ok(Some(r)) => r,
    };

    if js_truthy(body.clear_ref.as_ref()) {
        ref_type = None;
        r_url = None;
        ref_json = None;
    } else if let Some(r) = &body.ref_obj {
        let rtype = r.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if !rtype.is_empty() && js_truthy(r.get("json")) {
            ref_type = Some(rtype.to_string());
            r_url = r.get("url").filter(|v| js_truthy(Some(v))).and_then(|v| v.as_str()).map(String::from);
            ref_json = r.get("json").and_then(|j| serde_json::to_string(j).ok());
        }
    } else if let Some(u) = body.ref_url.as_deref().filter(|s| !s.is_empty())
        && Some(u.to_string()) != r_url
    {
        let meta = unfurl_url(&state.http, u).await.unwrap_or_else(|| serde_json::json!({}));
        ref_type = Some("link".into());
        r_url = Some(u.to_string());
        ref_json = serde_json::to_string(&meta).ok();
    }

    let new_content = match &body.content {
        Some(c) => c.trim().to_string(),
        None => old_content,
    };
    match sqlx::query(
        "UPDATE thoughts SET content = ?, ref_type = ?, ref_url = ?, ref_json = ?, updated_at = CURRENT_TIMESTAMP, edited = 1 WHERE id = ?",
    )
    .bind(&new_content)
    .bind(&ref_type)
    .bind(&r_url)
    .bind(&ref_json)
    .bind(&id)
    .execute(&state.pool)
    .await
    {
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `DELETE /api/admin/thoughts/:id` —— 刪碎念（連同其留言）。
/// 注意：Express 此端點**不回 404**（刪 0 列也回 success），照抄。
#[utoipa::path(delete, path = "/api/admin/thoughts/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "刪除碎念"), (status = 401, description = "未授權")))]
pub async fn admin_delete_thought(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    if let Err(e) =
        sqlx::query("DELETE FROM comments WHERE thought_id = ?").bind(&id).execute(&state.pool).await
    {
        tracing::warn!("[thoughts] 刪 thought {id} 連帶留言失敗: {e}");
    }
    match sqlx::query("DELETE FROM thoughts WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `GET /api/thoughts/rss` —— 公開 RSS feed（碎念，最新 30 筆）。移植 `routes/thoughts.js`。
#[utoipa::path(get, path = "/api/thoughts/rss", tag = "thoughts",
    responses((status = 200, description = "碎念 RSS feed（XML）")))]
pub async fn thoughts_rss(State(state): State<AppState>) -> Response {
    use crate::util::{js_date_to_utc_string, js_interp, js_substring_prefix, js_truthy, xml_esc};
    type Row = (i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>);
    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, content, ref_type, ref_url, ref_json, created_at FROM thoughts \
         ORDER BY created_at DESC, id DESC LIMIT 30",
    )
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        // Express：res.status(500).send('error')（text/html）
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
                "error",
            )
                .into_response();
        }
    };
    let mut items = String::new();
    for (id, content, ref_type, ref_url, ref_json, created_at) in &rows {
        let link = format!("https://koimsurai.com/thinking/{id}");
        // ref = safeParse(ref_json)：解析成功且 truthy 才算「有 ref」
        let ref_val: Option<Value> = ref_json.as_deref().and_then(|s| serde_json::from_str(s).ok());
        // desc = content || ''
        let content_str = content.clone().unwrap_or_default();
        let mut desc = content_str.clone();
        if js_truthy(ref_val.as_ref()) {
            // ref.title || ''
            let title = ref_val.as_ref().and_then(|v| v.get("title"));
            let t = match title {
                Some(v) if js_truthy(Some(v)) => js_interp(v),
                _ => String::new(),
            };
            match ref_type.as_deref() {
                Some("link") => {
                    // r.ref_url || ''
                    let u = ref_url.as_deref().filter(|s| !s.is_empty()).unwrap_or("");
                    desc.push_str(&format!("\n\n🔗 {t} {u}"));
                }
                Some("media") => desc.push_str(&format!("\n\n🎬 {t}")),
                _ => {}
            }
        }
        // title = esc((content||'').slice(0,60))
        let title_esc = xml_esc(&js_substring_prefix(&content_str, 60));
        let pub_date = js_date_to_utc_string(created_at.as_deref());
        items.push_str(&format!(
            "<item><title>{title_esc}</title><link>{link}</link><guid>{link}</guid><pubDate>{pub_date}</pubDate><description>{}</description></item>",
            xml_esc(&desc)
        ));
    }
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\"><channel><title>碎念 · Koimsurai</title><link>https://koimsurai.com/thinking</link><description>想到什麼寫什麼</description>{items}</channel></rss>"
    );
    ([(axum::http::header::CONTENT_TYPE, "application/rss+xml; charset=utf-8")], xml).into_response()
}
