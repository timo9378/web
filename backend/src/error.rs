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
            Self::Database(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "Internal server error" }),
                Some(e.to_string()),
            ),
            Self::Upstream(e) => {
                (StatusCode::BAD_GATEWAY, json!({ "error": "Upstream error" }), Some(e.to_string()))
            }
            Self::NotFound(msg) => (StatusCode::NOT_FOUND, json!({ "error": msg }), None),
            Self::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, json!({ "message": msg }), None),
            Self::Forbidden(msg) => (StatusCode::FORBIDDEN, json!({ "message": msg }), None),
            Self::Anyhow(e) => (
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::{FromRequest, FromRequestParts};
    use axum::http::header;

    async fn parts_of(resp: Response) -> (StatusCode, String, Value) {
        let status = resp.status();
        let ct =
            resp.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.unwrap().to_bytes();
        let v = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
        (status, ct, v)
    }

    /// **底層錯誤的原文不能外洩。**
    ///
    /// SQLite 與 reqwest 的錯誤字串會帶資料表名、欄位名、內部 URL。這一條是刻意
    /// 偏離 Express 舊行為的地方（舊版直接把 `err.message` 丟給客戶端），
    /// 而「偏離」正是最容易在日後某次重構被人「修回去」的東西——沒有測試釘住的話。
    #[tokio::test]
    async fn 資料庫與上游的錯誤原文只進_log_不進回應() {
        let secret = "no such column: users.password_hash";
        let (status, ct, body) =
            parts_of(AppError::Database(sqlx::Error::Protocol(secret.into())).into_response()).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(ct.starts_with("application/json"));
        assert_eq!(body["error"], "Internal server error");
        assert!(!body.to_string().contains("password_hash"), "內部細節外洩了：{body}");

        let (status, _, body) = parts_of(
            AppError::Anyhow(anyhow::anyhow!("internal path /srv/secret/db.sqlite")).into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"], "Internal server error");
        assert!(!body.to_string().contains("secret"), "anyhow 的內容外洩了：{body}");
    }

    /// 我們自己寫的訊息**要**顯示（那是給使用者看的），而且 auth 那兩個用的是
    /// `message` key 不是 `error`——前端的錯誤處理靠這個分辨。
    #[tokio::test]
    async fn 自己的訊息要顯示_而且_auth_用_message_key() {
        let (status, _, body) = parts_of(AppError::not_found("找不到文章").into_response()).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "找不到文章", "404 用 error key");
        assert!(body.get("message").is_none());

        let (status, _, body) = parts_of(AppError::unauthorized("需要登入").into_response()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["message"], "需要登入", "401 用 message key（對齊 Express requireAdmin）");
        assert!(body.get("error").is_none());

        let (status, _, body) = parts_of(AppError::forbidden("權限不足").into_response()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["message"], "權限不足");
    }

    #[tokio::test]
    async fn 上游錯誤是_502_不是_500() {
        // 502 讓監控分得出「我們壞了」與「別人壞了」；一律 500 的話這個區別就沒了。
        let e = reqwest::get("http://127.0.0.1:1/不存在").await.unwrap_err();
        let (status, _, body) = parts_of(AppError::Upstream(e).into_response()).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"], "Upstream error");
    }

    #[tokio::test]
    async fn internal_error_由呼叫端決定狀態碼但_body_一律泛用() {
        // 部分舊端點對齊 Express 用 400 回 DB 錯誤——狀態碼可變，訊息不可變。
        for st in [StatusCode::INTERNAL_SERVER_ERROR, StatusCode::BAD_REQUEST] {
            let (status, ct, body) =
                parts_of(internal_error(st, "table posts has no column named xyz")).await;
            assert_eq!(status, st);
            assert!(ct.starts_with("application/json"));
            assert_eq!(body["error"], "Internal server error");
            assert!(!body.to_string().contains("xyz"), "細節外洩：{body}");
        }
    }

    fn req(ct: Option<&str>, body: &str) -> axum::extract::Request {
        let mut b = axum::http::Request::builder().method("POST").uri("/");
        if let Some(c) = ct {
            b = b.header(header::CONTENT_TYPE, c);
        }
        b.body(axum::body::Body::from(body.to_string())).unwrap()
    }

    /// `JsonBody` 存在的唯一理由：**拒絕時也要回 JSON**。
    /// axum 內建的 `Json<T>` 這四種情況回的是 text/plain，前端一律 `JSON.parse()`
    /// 就會拿到解析例外而不是結構化錯誤。
    #[tokio::test]
    async fn jsonbody_的四種拒絕都回_json_而不是_text_plain() {
        let cases: [(&str, Option<&str>, &str, StatusCode); 4] = [
            ("壞掉的 JSON", Some("application/json"), "{ 不是合法 json", StatusCode::BAD_REQUEST),
            ("沒有 content-type", None, r#"{"a":1}"#, StatusCode::UNSUPPORTED_MEDIA_TYPE),
            ("content-type 錯", Some("text/plain"), r#"{"a":1}"#, StatusCode::UNSUPPORTED_MEDIA_TYPE),
            ("型別不符", Some("application/json"), r#"{"a":1}"#, StatusCode::UNPROCESSABLE_ENTITY),
        ];
        for (why, ct, body, want) in cases {
            // 型別不符那條要一個「不可能從 {a:1} 解出來」的目標型別
            let resp = if why == "型別不符" {
                JsonBody::<Vec<i32>>::from_request(req(ct, body), &()).await.err()
            } else {
                JsonBody::<serde_json::Map<String, Value>>::from_request(req(ct, body), &()).await.err()
            };
            let resp = resp.unwrap_or_else(|| panic!("{why} 應該被拒絕"));
            let (status, ct_out, v) = parts_of(resp).await;
            assert_eq!(status, want, "{why} 的狀態碼要原樣保留（每個碼各有意義）");
            assert!(ct_out.starts_with("application/json"), "{why} 回的是 {ct_out}");
            assert!(v["error"].is_string(), "{why} 要有結構化的 error 欄位：{v}");
        }
    }

    #[tokio::test]
    async fn jsonbody_成功時原樣解出來() {
        let JsonBody(v) = JsonBody::<serde_json::Map<String, Value>>::from_request(
            req(Some("application/json"), r#"{"a":1}"#),
            &(),
        )
        .await
        .expect("合法 body 應該通過");
        assert_eq!(v["a"], 1);
    }

    /// `PathParam<i64>` 在型別對不上時同樣要回 JSON。
    /// 宣告成 `Path<String>` 會把「任何字串都是合法 id」寫進 OpenAPI spec，
    /// 讓 Schemathesis 的 fuzzing 生出一堆放不進 URL 的字串而整個階段被跳過。
    #[tokio::test]
    async fn pathparam_型別不符時回_json() {
        let mut parts = axum::http::Request::builder().uri("/").body(()).unwrap().into_parts().0;
        // 沒有路徑參數可抽 → 一樣走拒絕分支
        let err = PathParam::<i64>::from_request_parts(&mut parts, &()).await.err().expect("應該被拒絕");
        let (status, ct, v) = parts_of(err).await;
        assert!(status.is_client_error() || status.is_server_error());
        assert!(ct.starts_with("application/json"), "回的是 {ct}");
        assert!(v["error"].is_string(), "要有結構化的 error 欄位：{v}");
    }

    #[test]
    fn from_轉換把三種底層錯誤各自歸位() {
        let e: AppError = sqlx::Error::RowNotFound.into();
        assert!(matches!(e, AppError::Database(_)));
        let e: AppError = anyhow::anyhow!("boom").into();
        assert!(matches!(e, AppError::Anyhow(_)));
    }
}
