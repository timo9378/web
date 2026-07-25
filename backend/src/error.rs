use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

/// 服務層錯誤。回應形狀刻意對齊 Express：多數端點 `{ "error": ... }`，
/// 但 auth（requireAdmin）用 `{ "message": ... }`，故分變體決定 body key。
#[derive(Debug)]
pub enum AppError {
    Database(sqlx::Error),
    /// 代理回 Express 時的上游錯誤（連線失敗等）。
    Upstream(reqwest::Error),
    /// 404，回應 `{"error": "<msg>"}`，對齊 Express 的 `res.status(404).json({error})`。
    NotFound(String),
    /// 401，回應 `{"message": "<msg>"}`，對齊 Express requireAdmin。
    Unauthorized(String),
    /// 403，回應 `{"message": "<msg>"}`，對齊 Express requireAdmin。
    Forbidden(String),
    Anyhow(anyhow::Error),
}

impl AppError {
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Unauthorized(msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        Self::Upstream(err)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        Self::Anyhow(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // (狀態碼, 對外 body, log 用細節)：auth 用 message key、其餘用 error key。
        // Database/Upstream/Anyhow 的原文只進 log——SQLite/reqwest 錯誤字串可能含
        // 資料表、欄位、內部 URL 等細節，不外洩給客戶端（刻意偏離 Express 的舊行為）。
        let (status, body, detail): (StatusCode, Value, Option<String>) = match self {
            AppError::Database(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "Internal server error" }),
                Some(e.to_string()),
            ),
            AppError::Upstream(e) => {
                (StatusCode::BAD_GATEWAY, json!({ "error": "Upstream error" }), Some(e.to_string()))
            }
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, json!({ "error": msg }), None),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, json!({ "message": msg }), None),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, json!({ "message": msg }), None),
            AppError::Anyhow(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "Internal server error" }),
                Some(format!("{e:#}")),
            ),
        };
        if status.is_server_error() {
            tracing::error!(%status, %body, detail = detail.as_deref().unwrap_or(""), "request failed");
        } else {
            tracing::debug!(%status, %body, "request rejected");
        }
        (status, Json(body)).into_response()
    }
}

/// 手排錯誤分支用（match Err(e) 直接組 Response 的 handler）：
/// 原文＋呼叫點進 log，客戶端只拿泛用訊息（同 IntoResponse 的 Database 分支）。
/// 狀態碼由呼叫端決定——部分舊端點對齊 Express 用 400 回 DB 錯誤，維持不變。
#[track_caller]
pub fn internal_error(status: StatusCode, e: impl std::fmt::Display) -> Response {
    let loc = std::panic::Location::caller();
    tracing::error!("internal error at {}:{}: {e}", loc.file(), loc.line());
    (status, Json(json!({ "error": "Internal server error" }))).into_response()
}
