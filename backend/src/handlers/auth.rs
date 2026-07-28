use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::{bearer_token, verify_jwt},
    error::AppError,
    state::AppState,
};

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct LoginBody {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

/// `POST /api/auth/login` —— 管理員密碼登入（bcrypt 驗證 → 簽 7d JWT）。
/// 純讀（查 users + 簽 token，不寫 DB），邏輯與回應逐字照抄 Express。
#[utoipa::path(
    post, path = "/api/auth/login", tag = "auth",
    responses(
        (status = 200, description = "登入成功，回 JWT + 使用者（動態 JSON）"),
        (status = 401, description = "帳密錯誤"),
    ),
)]
pub async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Result<Response, AppError> {
    let username = body.username.unwrap_or_default();
    let password = body.password.unwrap_or_default();

    // Express: `if (!username || !password)` —— 空字串也算缺。
    if username.is_empty() || password.is_empty() {
        return Ok(
            (StatusCode::BAD_REQUEST, Json(json!({ "message": "請提供用戶名和密碼" }))).into_response()
        );
    }

    // 查使用者。DB 錯 → 500 {"message":"伺服器錯誤"}（對齊 Express，非 AppError 的 error key）
    let user = match sqlx::query_as::<_, (i64, String, String, Option<String>)>(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
    )
    .bind(&username)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(u) => u,
        Err(_) => {
            return Ok(
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "伺服器錯誤" }))).into_response()
            );
        }
    };

    let invalid =
        || (StatusCode::UNAUTHORIZED, Json(json!({ "message": "用戶名或密碼錯誤" }))).into_response();
    let Some((id, uname, hash, role)) = user else {
        return Ok(invalid());
    };

    // bcrypt 驗證（相容 bcryptjs 的 $2a/$2b/$2y）。cost-10 ≈ 數十 ms 純 CPU，
    // 丟 spawn_blocking 避免卡住 tokio worker。驗證失敗或 hash 壞 → 視為密碼錯。
    let pw = password.clone();
    let ok = tokio::task::spawn_blocking(move || bcrypt::verify(&pw, &hash).unwrap_or(false))
        .await
        .unwrap_or(false);
    if !ok {
        return Ok(invalid());
    }

    // 簽 JWT：payload {id, username, role} + iat/exp（7 天），對齊 Express jwt.sign(expiresIn:'7d')。
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let exp = now + 7 * 24 * 60 * 60;
    let claims = json!({ "id": id, "username": uname, "role": role, "iat": now, "exp": exp });
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Anyhow(anyhow::anyhow!("sign jwt: {e}")))?;

    Ok(Json(json!({
        "message": "登入成功",
        "token": token,
        "user": { "id": id, "username": uname, "role": role },
    }))
    .into_response())
}

/// 單一 OAuth provider 的公開設定。clientId 是公開值（前端組授權 URL 要用），
/// 沒設定時是空字串而不是缺欄位——所以 enabled 才是「這個 provider 能不能用」的判準。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct OAuthProviderInfo {
    #[serde(rename = "clientId")]
    pub client_id: String,
    pub enabled: bool,
}

/// `GET /api/auth/providers` 回應。兩個 provider 一律都在，用 enabled 區分。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AuthProvidersResponse {
    pub google: OAuthProviderInfo,
    pub github: OAuthProviderInfo,
}

/// `GET /api/auth/providers` —— 回前端 OAuth 設定（clientId 為公開值；enabled = clientId 非空）。
/// clientId 由 env `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` 提供（與 Express 同源）。
/// 原本回 `Json<serde_json::Value>`（json! 手捏）→ specta 生不出型別，前端只好手寫一份
/// 對應的 interface，而手寫的那份把 clientId 標成可選、把 provider 標成可能缺席，
/// 都與後端實際行為不符。改成 struct 之後前端直接吃生成型別。
#[utoipa::path(get, path = "/api/auth/providers", tag = "auth",
    responses((status = 200, description = "可用 OAuth provider 清單", body = AuthProvidersResponse)))]
pub async fn providers() -> Json<AuthProvidersResponse> {
    let g = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let gh = std::env::var("GITHUB_CLIENT_ID").unwrap_or_default();
    Json(AuthProvidersResponse {
        google: OAuthProviderInfo { enabled: !g.is_empty(), client_id: g },
        github: OAuthProviderInfo { enabled: !gh.is_empty(), client_id: gh },
    })
}

/// `POST /api/auth/logout` —— JWT 無狀態，前端清 token 即可；這裡僅回 ok。
#[utoipa::path(post, path = "/api/auth/logout", tag = "auth",
    responses((status = 200, description = "登出（stateless JWT，client 端清 token）")))]
pub async fn logout() -> Json<serde_json::Value> {
    Json(json!({ "message": "ok" }))
}

/// role || 'USER'：null 或空字串都退回 "USER"（對齊 Express `user.role || 'USER'`）。
fn role_or_user(role: Option<String>) -> String {
    role.filter(|r| !r.is_empty()).unwrap_or_else(|| "USER".to_string())
}

/// oauth_users 一列（/auth/me 用到的欄位）。
type OauthRow =
    (i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>);
//                id   display_name     email            avatar_url       provider         role             linked_to

fn me_user_json(u: &OauthRow) -> serde_json::Value {
    json!({
        "id": u.0,
        "displayName": u.1,
        "email": u.2,
        "avatar": u.3,
        "provider": u.4,
        "role": role_or_user(u.5.clone()),
    })
}

/// `GET /api/auth/me` —— 前端用來恢復 session。錯誤回應用 `{"error":...}`（注意：非 message）。
#[utoipa::path(get, path = "/api/auth/me", tag = "auth", security(("bearer" = [])),
    responses((status = 200, description = "當前登入使用者（動態 JSON）"), (status = 401, description = "未登入")))]
pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    let unauth = |msg: &str| (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg }))).into_response();

    let Some(token) = bearer_token(&headers) else {
        return Ok(unauth("Not authenticated"));
    };
    let Some(claims) = verify_jwt(token, &state.jwt_secret) else {
        return Ok(unauth("Invalid token"));
    };

    let user_id = claims.get("userId").and_then(|v| v.as_i64()).filter(|&u| u != 0);
    let provider_truthy = claims.get("provider").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty());

    // OAuth token（userId && provider）
    if let (Some(uid), true) = (user_id, provider_truthy) {
        // Express：DB 錯 或 查無 → 401 {"error":"User not found"}
        let user = match sqlx::query_as::<_, OauthRow>(
            "SELECT id, display_name, email, avatar_url, provider, role, linked_to FROM oauth_users WHERE id = ?",
        )
        .bind(uid)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(u) => u,
            Err(_) => return Ok(unauth("User not found")),
        };
        let Some(user) = user else {
            return Ok(unauth("User not found"));
        };
        // 關聯帳號 → 回主帳號資料；主帳號查不到 → 退回自身資料
        if let Some(linked) = user.6 {
            let primary = sqlx::query_as::<_, OauthRow>(
                "SELECT id, display_name, email, avatar_url, provider, role, linked_to FROM oauth_users WHERE id = ?",
            )
            .bind(linked)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
            return Ok(match primary {
                Some(p) => Json(me_user_json(&p)).into_response(),
                None => Json(me_user_json(&user)).into_response(),
            });
        }
        return Ok(Json(me_user_json(&user)).into_response());
    }

    // legacy admin token（username）
    if let Some(username) = claims.get("username").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return Ok(Json(json!({
            "id": 0,
            "displayName": username,
            "email": "",
            "avatar": "",
            "provider": "admin",
            "role": "OWNER",
            "isAdmin": true,
        }))
        .into_response());
    }

    Ok(unauth("Invalid token"))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ResetAdminBody {
    username: Option<String>,
    password: Option<String>,
}

/// `POST /api/auth/reset-admin` —— 開發用密碼重置。行為清理版（原 Express 靠
/// NODE_ENV==='production' 擋、容器沒設=在正式環境是活的=安全發現 #3）：
/// **fail-safe 預設關閉**，需顯式 `ENABLE_RESET_ADMIN=1` 才開。
#[utoipa::path(post, path = "/api/auth/reset-admin", tag = "auth",
    responses((status = 200, description = "重置成功"), (status = 403, description = "未啟用 ENABLE_RESET_ADMIN")))]
pub async fn reset_admin(
    State(state): State<AppState>,
    body: Option<Json<ResetAdminBody>>,
) -> Result<Response, AppError> {
    if std::env::var("ENABLE_RESET_ADMIN").as_deref() != Ok("1") {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "message": "Not found" }))).into_response());
    }
    let b = body.map(|Json(x)| x).unwrap_or(ResetAdminBody { username: None, password: None });
    let env_user = std::env::var("ADMIN_USERNAME").ok().filter(|s| !s.is_empty());
    let env_pass = std::env::var("ADMIN_PASSWORD").ok().filter(|s| !s.is_empty());
    let username = env_user.or(b.username.filter(|s| !s.is_empty())).unwrap_or_else(|| "admin".to_string());
    let Some(password) = env_pass.or(b.password.filter(|s| !s.is_empty())) else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "message": "ADMIN_PASSWORD is not configured. Set ADMIN_PASSWORD in env or pass password in request body for dev reset." })),
        )
            .into_response());
    };

    // bcrypt cost-10 hash ≈ 數十 ms 純 CPU → spawn_blocking
    let pw = password.clone();
    let hash = match tokio::task::spawn_blocking(move || bcrypt::hash(&pw, 10)).await {
        Ok(Ok(h)) => h,
        _ => {
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "密碼處理失敗" })))
                .into_response());
        }
    };

    let updated = match sqlx::query("UPDATE users SET password_hash = ? WHERE username = ?")
        .bind(&hash)
        .bind(&username)
        .execute(&state.pool)
        .await
    {
        Ok(r) => r.rows_affected(),
        Err(_) => {
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "更新密碼失敗" })))
                .into_response());
        }
    };
    if updated == 0 {
        if sqlx::query("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
            .bind(&username)
            .bind(&hash)
            .execute(&state.pool)
            .await
            .is_err()
        {
            return Ok((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": "創建用戶失敗" })))
                .into_response());
        }
        return Ok(Json(json!({ "message": format!("管理員用戶 {username} 已創建"), "username": username }))
            .into_response());
    }
    Ok(Json(json!({ "message": format!("管理員 {username} 密碼已重置"), "username": username }))
        .into_response())
}
