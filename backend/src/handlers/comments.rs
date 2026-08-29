use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    auth::{bearer_token, verify_jwt},
    state::AppState,
};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CommentBody {
    author: Option<String>,
    content: Option<String>,
    captcha: Option<Value>,
    #[serde(rename = "captchaAnswer")]
    captcha_answer: Option<Value>,
    email: Option<String>,
    website: Option<String>,
    avatar_url: Option<String>,
    parent_id: Option<i64>,
}

/// 取 client IP：對齊 Express `req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || ''`。
/// 生產有 nginx 設 X-Forwarded-For（trust proxy=1），故 XFF 最左即真實 IP。
/// 無 XFF 時 Express 退 req.ip（socket）；這裡退 ''（生產不會走到，見 STRANGLER 備註）。
fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// JS 寬鬆相等（`==`）的近似：覆蓋 number/string/bool/null 與 number↔string 強制轉換
/// （captcha 比對用；exotic 型別未完整對齊）。
fn js_loose_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Number(n), Value::String(s)) | (Value::String(s), Value::Number(n)) => {
            let sv = if s.trim().is_empty() { Some(0.0) } else { s.trim().parse::<f64>().ok() };
            sv == n.as_f64()
        }
        _ => false,
    }
}

/// createComment 等價：author/content 必填 → OAuth 偵測 → captcha（匿名）→ IP 黑名單 →
/// 關鍵字過濾（reject/spam）→ 審核狀態 → INSERT → 201。target_col 為 'post_id'|'thought_id'（固定）。
async fn create_comment(
    state: &AppState,
    headers: &HeaderMap,
    target_col: &str,
    target_id: &str,
    body: CommentBody,
) -> Response {
    let author = body.author.unwrap_or_default();
    let content = body.content.unwrap_or_default();
    if author.is_empty() || content.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Author and content are required" })))
            .into_response();
    }

    // 登入（OAuth）用戶：Bearer token 驗章成功且帶 userId + provider
    let is_oauth = bearer_token(headers).and_then(|t| verify_jwt(t, &state.jwt_secret)).is_some_and(|c| {
        c.get("userId").and_then(serde_json::Value::as_i64).is_some()
            && c.get("provider").and_then(|v| v.as_str()).is_some()
    });

    // captcha 檢查（僅匿名且有帶 captcha 欄位時）
    if !is_oauth && let Some(captcha) = &body.captcha {
        let answer = body.captcha_answer.clone().unwrap_or(Value::Null);
        if !js_loose_eq(captcha, &answer) {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "驗證碼錯誤" }))).into_response();
        }
    }

    let ip = client_ip(headers);

    // IP 黑名單
    let blocked = sqlx::query_scalar::<_, i64>("SELECT id FROM ip_blacklist WHERE ip = ?")
        .bind(&ip)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    if blocked.is_some() {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "您的留言權限已被限制" }))).into_response();
    }

    // 關鍵字過濾：第一個命中的 filter 決定 action（DB rowid 序，無 ORDER BY）
    let filters =
        sqlx::query_as::<_, (String, Option<String>)>("SELECT keyword, action FROM keyword_filters")
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
    let lower = format!("{content} {author}").to_lowercase();
    let mut matched: Option<String> = None;
    for (keyword, action) in &filters {
        if lower.contains(&keyword.to_lowercase()) {
            matched = action.clone();
            break;
        }
    }
    if matched.as_deref() == Some("reject") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "留言內容包含不允許的詞彙" })))
            .into_response();
    }
    let status = if matched.as_deref() == Some("spam") {
        "spam"
    } else if is_oauth {
        "approved"
    } else {
        "pending"
    };

    // INSERT（is_admin 固定 0；parent_id 0/缺 → NULL）
    let sql = format!(
        "INSERT INTO comments ({target_col}, author, content, email, website, ip, status, is_admin, avatar_url, parent_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    );
    let parent = body.parent_id.filter(|&n| n != 0);
    let result = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(target_id)
        .bind(&author)
        .bind(&content)
        .bind(body.email.unwrap_or_default())
        .bind(body.website.unwrap_or_default())
        .bind(&ip)
        .bind(status)
        .bind(body.avatar_url.unwrap_or_default())
        .bind(parent)
        .execute(&state.pool)
        .await;

    match result {
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) => (
            StatusCode::CREATED,
            Json(json!({ "message": "success", "id": r.last_insert_rowid(), "status": status })),
        )
            .into_response(),
    }
}

/// `POST /api/posts/:id/comments`
#[utoipa::path(
    post, path = "/api/posts/{id}/comments", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "新增文章留言（動態 JSON）")),
)]
pub async fn post_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    crate::error::JsonBody(body): crate::error::JsonBody<CommentBody>,
) -> Response {
    create_comment(&state, &headers, "post_id", &id, body).await
}

/// `POST /api/thoughts/:id/comments`
#[utoipa::path(
    post, path = "/api/thoughts/{id}/comments", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "新增碎念留言（動態 JSON）")),
)]
pub async fn thought_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    crate::error::JsonBody(body): crate::error::JsonBody<CommentBody>,
) -> Response {
    create_comment(&state, &headers, "thought_id", &id, body).await
}
