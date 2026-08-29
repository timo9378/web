use std::fmt::Write as _;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
// rand 0.10 把 trait 重切了：原本的 RngCore 改名為 Rng（fill_bytes 在這裡），
// 而原本 Rng 上的高階方法搬到 RngExt（見 upload.rs）。
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::handlers::posts::Pagination;
use crate::state::AppState;
use crate::{auth::require_admin, util::parse_int};

/// `newsletter_subscribers` 一列（`SELECT *`）。欄位序 = 表宣告序，對齊舊 `row_to_json`。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct SubscriberRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub subscribed_at: Option<String>,
    pub unsubscribed_at: Option<String>,
    pub unsubscribe_token: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SubscribersResponse {
    pub message: String,
    pub subscribers: Vec<SubscriberRow>,
    pub pagination: Pagination,
}

/// `GET /api/newsletter/by-token/:token` 的回應（顯式 3 欄）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct SubscriberByToken {
    pub email: String,
    pub name: Option<String>,
    pub status: Option<String>,
}

/// `crypto.randomBytes(16).toString('hex')` 等價：32 hex 字元。
fn gen_unsub_token() -> String {
    let mut b = [0u8; 16];
    // rand 0.9 起 thread_rng() 改名 rng()（舊名在 0.10 已移除）
    rand::rng().fill_bytes(&mut b);
    b.iter().fold(String::new(), |mut acc, x| {
        let _ = write!(acc, "{x:02x}");
        acc
    })
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SubscribeBody {
    email: Option<String>,
    name: Option<String>,
}

/// `POST /api/newsletter/subscribe` —— 公開訂閱；重複 email 且非 active → 重新啟用。
#[utoipa::path(post, path = "/api/newsletter/subscribe", tag = "newsletter",
    responses((status = 200, description = "訂閱電子報（動態 JSON）")))]
pub async fn subscribe(
    State(state): State<AppState>,
    crate::error::JsonBody(b): crate::error::JsonBody<SubscribeBody>,
) -> Response {
    let email = b.email.unwrap_or_default();
    if email.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Email is required" }))).into_response();
    }
    // Express regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    static EMAIL_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").expect("字面 regex"));
    let re = &*EMAIL_RE;
    if !re.is_match(&email) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid email format" }))).into_response();
    }
    let token = gen_unsub_token();
    let name = b.name.filter(|s| !s.is_empty());
    match sqlx::query(
        "INSERT INTO newsletter_subscribers (email, name, status, unsubscribe_token) VALUES (?, ?, 'active', ?)",
    )
    .bind(&email)
    .bind(&name)
    .bind(&token)
    .execute(&state.pool)
    .await
    {
        Ok(r) => (
            StatusCode::CREATED,
            Json(json!({ "message": "Successfully subscribed to newsletter", "id": r.last_insert_rowid() })),
        )
            .into_response(),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("UNIQUE constraint failed: newsletter_subscribers.email") {
                // 已訂閱：非 active → 重新啟用並補 token
                match sqlx::query(
                    "UPDATE newsletter_subscribers SET status = 'active', unsubscribed_at = NULL, \
                     unsubscribe_token = COALESCE(unsubscribe_token, ?) WHERE email = ? AND status != 'active'",
                )
                .bind(&token)
                .bind(&email)
                .execute(&state.pool)
                .await
                {
                    Err(e2) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e2.to_string() }))).into_response(),
                    Ok(r) if r.rows_affected() > 0 => {
                        Json(json!({ "message": "Re-subscribed to newsletter" })).into_response()
                    }
                    Ok(_) => (
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "This email is already subscribed" })),
                    )
                        .into_response(),
                }
            } else {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
            }
        }
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct UnsubscribeBody {
    email: Option<String>,
    token: Option<String>,
}

/// `POST /api/newsletter/unsubscribe` —— email 或 token 擇一（token 優先）。
#[utoipa::path(post, path = "/api/newsletter/unsubscribe", tag = "newsletter",
    responses((status = 200, description = "退訂電子報（動態 JSON）")))]
pub async fn unsubscribe(
    State(state): State<AppState>,
    crate::error::JsonBody(b): crate::error::JsonBody<UnsubscribeBody>,
) -> Response {
    let email = b.email.filter(|s| !s.is_empty());
    let token = b.token.filter(|s| !s.is_empty());
    // token 優先於 email（對齊 Express `token || email`）；兩者皆無 → 400
    let (sql, param) = match (token, email) {
        (Some(t), _) => (
            "UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = datetime('now') WHERE unsubscribe_token = ?",
            t,
        ),
        (None, Some(e)) => (
            "UPDATE newsletter_subscribers SET status = ?, unsubscribed_at = datetime('now') WHERE email = ?",
            e,
        ),
        (None, None) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Email or token is required" })))
                .into_response();
        }
    };
    match sqlx::query(sql).bind("unsubscribed").bind(&param).execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "Subscriber not found" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "Successfully unsubscribed from newsletter" })).into_response(),
    }
}

/// `GET /api/newsletter/by-token/:token` —— 退訂確認頁用（裸 row：email/name/status）。
#[utoipa::path(get, path = "/api/newsletter/by-token/{token}", tag = "newsletter",
    params(("token" = String, Path)),
    responses((status = 200, body = SubscriberByToken)))]
pub async fn by_token(State(state): State<AppState>, Path(token): Path<String>) -> Response {
    match sqlx::query_as::<_, SubscriberByToken>(
        "SELECT email, name, status FROM newsletter_subscribers WHERE unsubscribe_token = ?",
    )
    .bind(&token)
    .fetch_optional(&state.pool)
    .await
    {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({ "error": "invalid token" }))).into_response(),
        Ok(Some(sub)) => Json(sub).into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct SubscribersQuery {
    page: Option<String>,
    limit: Option<String>,
    status: Option<String>,
}

/// `GET /api/newsletter/subscribers`（requireAdmin）—— 分頁列表（SELECT * 動態 row）。
#[utoipa::path(get, path = "/api/newsletter/subscribers", tag = "newsletter", security(("bearer" = [])),
    responses((status = 200, body = SubscribersResponse), (status = 401, description = "未授權")))]
pub async fn subscribers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SubscribersQuery>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let page = parse_int(q.page.as_deref(), 1);
    let limit = parse_int(q.limit.as_deref(), 50);
    let offset = (page - 1) * limit;
    let status = q.status.as_deref().unwrap_or("active");

    let subscribers = match sqlx::query_as::<_, SubscriberRow>(
        "SELECT * FROM newsletter_subscribers WHERE status = ? ORDER BY subscribed_at DESC LIMIT ? OFFSET ?",
    )
    .bind(status)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) as total FROM newsletter_subscribers WHERE status = ?",
    )
    .bind(status)
    .fetch_one(&state.pool)
    .await
    {
        Ok(t) => t,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let total_pages = if limit > 0 { (total + limit - 1) / limit } else { 0 };
    Json(SubscribersResponse {
        message: "success".into(),
        subscribers,
        pagination: Pagination { page, limit, total, total_pages },
    })
    .into_response()
}
