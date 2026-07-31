use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

/// 吃 JSON body 的 extractor，但**拒絕時也回 JSON**。
///
/// axum 內建的 `Json<T>` 在四種情況下回的是 `text/plain`：
///
///   壞掉的 JSON       400  "Failed to parse the request body as JSON: …"
///   沒有 content-type 415  "Expected request with `Content-Type: application/json`"
///   content-type 錯   415  同上
///   型別不符          422  "Failed to deserialize the JSON body into the target type: …"
///
/// 這對一個宣告「回應是 application/json」的 API 是不一致的：前端若一律 `JSON.parse()`
/// 就會拿到解析例外而不是結構化錯誤，錯誤處理只能靠 try/catch 猜。
///
/// 這不是理論問題——Schemathesis 的 stateful 測試在 `POST /api/admin/tags` 上實際
/// 抓到「Undocumented Content-Type: received text/plain, documented application/json」。
/// 手寫測試沒抓到，因為沒有人會想到去測「送壞掉的 body 時 content-type 是什麼」。
///
/// 用法：把 handler 的 `Json(body): Json<T>` 換成 `JsonBody(body): JsonBody<T>`。
pub struct JsonBody<T>(pub T);

impl<S, T> axum::extract::FromRequest<S> for JsonBody<T>
where
    T: serde::de::DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(req: axum::extract::Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(req, state).await {
            Ok(Json(v)) => Ok(Self(v)),
            // 狀態碼原樣保留（400/415/422 各有意義），只把 body 換成 JSON。
            Err(rej) => {
                let status = rej.status();
                Err((status, Json(json!({ "error": rej.body_text() }))).into_response())
            }
        }
    }
}

/// 吃路徑參數的 extractor，但**拒絕時也回 JSON**——與 [`JsonBody`] 同一個理由。
///
/// axum 的 `Path<T>` 在型別對不上（`/api/admin/tags/abc` 而 `T = i64`）時回 400 + `text/plain`。
///
/// 為什麼要把 `Path<String>` 換成 `PathParam<i64>`：這幾張表的 id 都是
/// `INTEGER PRIMARY KEY`，宣告成 String 是把「任何字串都是合法 id」寫進了 spec。
/// 後果不只是文件不準——Schemathesis 的 fuzzing 階段會依 spec 生隨機字串，
/// 其中大半（含 `/`、控制字元、空字串）根本放不進 URL 而被過濾掉，
/// 四支 DELETE 因此觸發 `filter_too_much` health check，整個階段被跳過。
pub struct PathParam<T>(pub T);

impl<S, T> axum::extract::FromRequestParts<S> for PathParam<T>
where
    T: serde::de::DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(v)) => Ok(Self(v)),
            Err(rej) => {
                let status = rej.status();
                Err((status, Json(json!({ "error": rej.body_text() }))).into_response())
            }
        }
    }
}

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
