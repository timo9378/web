use axum::http::{HeaderMap, header};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;

use crate::{error::AppError, state::AppState};

/// JWT claims（彈性：legacy admin token 帶 id/username/role；OAuth token 帶 userId/provider/role）。
#[derive(Debug, Deserialize)]
struct Claims {
    #[serde(default)]
    username: Option<String>,
    #[serde(rename = "userId", default)]
    user_id: Option<i64>,
}

/// 通過 requireAdmin 後的使用者（角色為 ADMIN 或 OWNER）。
#[derive(Debug)]
pub struct AdminUser {
    #[allow(dead_code)]
    pub role: String,
    /// OAuth 路徑=主帳號 id（Express `req.user.dbUser.id`）；legacy token=None（無 dbUser）。
    pub db_user_id: Option<i64>,
}

/// 驗 HS256 token（同 require_admin 的 Validation 設定），回原始 claims（任意欄位）。
/// 給 `/auth/me` 這種需要看 userId/provider/username 各欄位的端點用。
pub fn verify_jwt(token: &str, secret: &str) -> Option<serde_json::Value> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    decode::<serde_json::Value>(token, &DecodingKey::from_secret(secret.as_bytes()), &validation)
        .ok()
        .map(|d| d.claims)
}

/// 從 `Authorization` header 取 Bearer token（沒有則 None）。
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|h| h.strip_prefix("Bearer "))
}

/// `basic_auth_check` 的 extractor 版本，理由同 [`AdminAuth`]（`/posts/legacy` 用）。
pub struct BasicAuth;

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for BasicAuth {
    type Rejection = axum::response::Response;

    // 這支沒有 await，但 trait 宣告成 async fn；拿掉 async 就得手寫回傳
    // `impl Future` 並包 `ready(...)`，只為消一個 lint 不值得。
    #[allow(clippy::unused_async_trait_impl, reason = "簽名由 axum 的 trait 決定")]
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        match basic_auth_check(&parts.headers) {
            Some(resp) => Err(resp),
            None => Ok(Self),
        }
    }
}

/// basicAuth 等價（/posts/legacy 用）：通過回 None、失敗回 Some(response)。
/// 401 帶 `WWW-Authenticate: Basic`；env 未設 → 503。
pub fn basic_auth_check(headers: &HeaderMap) -> Option<axum::response::Response> {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use base64::Engine;

    let unauthorized = |msg: &str| {
        let mut resp =
            (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({ "message": msg }))).into_response();
        resp.headers_mut().insert("WWW-Authenticate", axum::http::HeaderValue::from_static("Basic"));
        resp
    };

    let Some(auth) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return Some(unauthorized("Authorization header required"));
    };
    // Express: Buffer.from(header.split(' ')[1], 'base64') → user:pass
    let b64 = auth.split(' ').nth(1).unwrap_or("");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default();
    let mut it = decoded.splitn(2, ':');
    let user = it.next().unwrap_or("");
    let pass = it.next().unwrap_or("");

    let admin_user = std::env::var("ADMIN_USERNAME").unwrap_or_default();
    let admin_pass = std::env::var("ADMIN_PASSWORD").unwrap_or_default();
    if admin_user.is_empty() || admin_pass.is_empty() {
        return Some(
            (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({ "message": "Admin basic auth is not configured" })),
            )
                .into_response(),
        );
    }
    if user == admin_user && pass == admin_pass { None } else { Some(unauthorized("Invalid credentials")) }
}

/// requireAdmin：需要 ADMIN 或 OWNER。
pub async fn require_admin(headers: &HeaderMap, state: &AppState) -> Result<AdminUser, AppError> {
    authorize(headers, state, false).await
}

/// `require_admin` 的 extractor 版本——**存在的理由是執行順序**。
///
/// 原本各 handler 是在函式體內呼叫 `require_admin`，但 body extractor（`Json` /
/// `JsonBody`）比函式體先跑。結果是「沒帶 token 又沒帶 content-type」時先撞 415，
/// 而不是 401——而 spec 上這些端點宣告的是 401。
///
/// axum 保證所有 `FromRequestParts` 都在唯一的 `FromRequest`（吃 body 的那個）之前
/// 執行，且與參數順序無關。所以只要改成 extractor，順序自動就對了。
///
/// 抓到這件事的是 Schemathesis 的 `missing_required_header` 檢查（8 支端點）：
///   Got 415 when missing required 'Authorization' header, expected 401
/// 未授權的請求不該先被告知「你的 content-type 不對」。
pub struct AdminAuth(#[allow(dead_code)] pub AdminUser);

impl axum::extract::FromRequestParts<AppState> for AdminAuth {
    type Rejection = axum::response::Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        use axum::response::IntoResponse;
        require_admin(&parts.headers, state).await.map(Self).map_err(IntoResponse::into_response)
    }
}

/// requireOwner：僅 OWNER。
pub async fn require_owner(headers: &HeaderMap, state: &AppState) -> Result<AdminUser, AppError> {
    authorize(headers, state, true).await
}

/// `require_owner` 的 extractor 版本，理由同 [`AdminAuth`]。
pub struct OwnerAuth(pub AdminUser);

impl axum::extract::FromRequestParts<AppState> for OwnerAuth {
    type Rejection = axum::response::Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        use axum::response::IntoResponse;
        require_owner(&parts.headers, state).await.map(Self).map_err(IntoResponse::into_response)
    }
}

/// 驗 Bearer JWT（HS256）→ 依 token 類型查角色。owner_only 決定角色門檻與不足時的訊息。
/// 錯誤訊息與狀態碼逐字對齊 Express `createRequireAdmin`/`createRequireOwner`。
async fn authorize(headers: &HeaderMap, state: &AppState, owner_only: bool) -> Result<AdminUser, AppError> {
    // 1) 取 Bearer token
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthorized("未提供有效的授權令牌"))?;

    // 2) 驗章：leeway=0、僅 HS256、強制 exp（兩個簽發點都帶 exp——login 7 天、OAuth 30 天；
    //    不帶 exp 的 token 一律拒絕，避免永不過期。刻意偏離 node jwt.verify 的「有才驗」）。
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 0;
    let claims = decode::<Claims>(token, &DecodingKey::from_secret(state.jwt_secret.as_bytes()), &validation)
        .map_err(|_| AppError::unauthorized("無效的授權令牌"))?
        .claims;

    // 3) OAuth token（有 userId 且非 0）→ 查 oauth_users → linked_to → 主帳號角色
    if let Some(uid) = claims.user_id.filter(|&u| u != 0) {
        let user = sqlx::query_as::<_, (i64, Option<String>, Option<i64>)>(
            "SELECT id, role, linked_to FROM oauth_users WHERE id = ?",
        )
        .bind(uid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::unauthorized("使用者不存在"))?;
        let (id, _role, linked_to) = user.ok_or_else(|| AppError::unauthorized("使用者不存在"))?;

        let target = linked_to.unwrap_or(id);
        let primary = sqlx::query_as::<_, (Option<String>,)>("SELECT role FROM oauth_users WHERE id = ?")
            .bind(target)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| AppError::unauthorized("使用者不存在"))?;
        let (prole,) = primary.ok_or_else(|| AppError::unauthorized("使用者不存在"))?;
        let role = prole.unwrap_or_default();
        let allowed = if owner_only { role == "OWNER" } else { role == "ADMIN" || role == "OWNER" };
        if !allowed {
            return Err(AppError::forbidden(if owner_only {
                "權限不足，需要擁有者權限"
            } else {
                "權限不足，需要管理員權限"
            }));
        }
        Ok(AdminUser { role, db_user_id: Some(target) })
    }
    // 4) Legacy admin token（有非空 username）→ 視為 OWNER
    else if claims.username.as_deref().is_some_and(|u| !u.is_empty()) {
        Ok(AdminUser { role: "OWNER".to_string(), db_user_id: None })
    }
    // 5) 兩者皆無 → 403
    else {
        Err(AppError::forbidden("權限不足"))
    }
}
