//! OAuth callbacks（google/github）。移植 Express `/auth/{google,github}/callback` + `upsertOAuthUser`。
//!
//! 使用者底線：**不搞壞現有 user 狀態** → upsert 8 分支語意逐字照抄
//! （existing update 不覆蓋 role 除非 OWNER email／linked_to 解析主帳號／同 email 關聯
//! ／OWNER email 升級主帳號／全新／無 email）。
//! 驗證：provider URL 可 env 覆寫（僅測試）→ mock provider 跑全流程；
//! upsert 對照 node 腳本（原函數）在同 fixture 跑相同輸入矩陣比 DB 終態。
//! `/spotify/callback`（一次性 setup HTML）依既定決策留 proxy。

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde_json::{Map, Value, json};
use sqlx::Row;

use crate::state::AppState;

const OWNER_EMAIL: &str = "timo9378@gmail.com";

fn env_url(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string())
}

struct OauthUser {
    id: i64,
    display_name: Option<String>,
    email: Option<String>,
    avatar_url: Option<String>,
    role: Option<String>,
}

fn row_to_user(r: &sqlx::sqlite::SqliteRow) -> OauthUser {
    OauthUser {
        id: r.get("id"),
        display_name: r.get("display_name"),
        email: r.get("email"),
        avatar_url: r.get("avatar_url"),
        role: r.get("role"),
    }
}

/// `upsertOAuthUser`：語意逐字照抄（見模組註解）。
async fn upsert_oauth_user(
    state: &AppState,
    provider: &str,
    provider_id: &str,
    display_name: &str,
    email: &str,
    avatar_url: &str,
) -> Result<OauthUser, sqlx::Error> {
    let auto_role = if !email.is_empty() && email.to_lowercase() == OWNER_EMAIL.to_lowercase() {
        "OWNER"
    } else {
        "USER"
    };

    // 1. (provider, provider_id) 查找
    let existing = sqlx::query("SELECT * FROM oauth_users WHERE provider = ? AND provider_id = ?")
        .bind(provider)
        .bind(provider_id)
        .fetch_optional(&state.pool)
        .await?;
    if let Some(ex) = existing {
        let ex_role: Option<String> = ex.get("role");
        let linked_to: Option<i64> = ex.get("linked_to");
        let ex_id: i64 = ex.get("id");
        // 不覆蓋 role，除非 OWNER email
        let update_role: Option<String> = if auto_role == "OWNER" { Some("OWNER".into()) } else { ex_role };
        sqlx::query("UPDATE oauth_users SET display_name = ?, email = ?, avatar_url = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(display_name)
            .bind(email)
            .bind(avatar_url)
            .bind(&update_role)
            .bind(ex_id)
            .execute(&state.pool)
            .await?;
        if let Some(primary_id) = linked_to
            && let Some(primary) = sqlx::query("SELECT * FROM oauth_users WHERE id = ?")
                .bind(primary_id)
                .fetch_optional(&state.pool)
                .await?
        {
            return Ok(row_to_user(&primary));
        }
        return Ok(OauthUser {
            id: ex_id,
            display_name: Some(display_name.to_string()),
            email: Some(email.to_string()),
            avatar_url: Some(avatar_url.to_string()),
            role: update_role,
        });
    }

    // 2. 無此 provider 紀錄 → email 關聯
    if !email.is_empty() {
        let same =
            sqlx::query("SELECT * FROM oauth_users WHERE email = ? AND email != \"\" AND linked_to IS NULL")
                .bind(email)
                .fetch_optional(&state.pool)
                .await?;
        if let Some(same) = same {
            let mut primary = row_to_user(&same);
            // OWNER email → 主帳號升級
            if auto_role == "OWNER" && primary.role.as_deref() != Some("OWNER") {
                sqlx::query("UPDATE oauth_users SET role = ? WHERE id = ?")
                    .bind("OWNER")
                    .bind(primary.id)
                    .execute(&state.pool)
                    .await?;
                primary.role = Some("OWNER".into());
            }
            sqlx::query("INSERT INTO oauth_users (provider, provider_id, display_name, email, avatar_url, role, linked_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .bind(provider)
                .bind(provider_id)
                .bind(display_name)
                .bind(email)
                .bind(avatar_url)
                .bind(auto_role)
                .bind(primary.id)
                .execute(&state.pool)
                .await?;
            return Ok(primary);
        }
    }

    // 3. 全新（或無 email）
    let r = sqlx::query("INSERT INTO oauth_users (provider, provider_id, display_name, email, avatar_url, role) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(provider)
        .bind(provider_id)
        .bind(display_name)
        .bind(email)
        .bind(avatar_url)
        .bind(auto_role)
        .execute(&state.pool)
        .await?;
    Ok(OauthUser {
        id: r.last_insert_rowid(),
        display_name: Some(display_name.to_string()),
        email: Some(email.to_string()),
        avatar_url: Some(avatar_url.to_string()),
        role: Some(auto_role.to_string()),
    })
}

/// 簽 30d OAuth JWT + 組回應（google/github 共用）。
fn finish(state: &AppState, provider: &str, user: &OauthUser) -> Response {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let role = user.role.clone().filter(|r| !r.is_empty()).unwrap_or_else(|| "USER".into());
    let claims = json!({
        "userId": user.id,
        "provider": provider,
        "displayName": user.display_name,
        "avatar": user.avatar_url,
        "role": role,
        "iat": now,
        "exp": now + 30 * 24 * 60 * 60,
    });
    let token =
        match encode(&Header::default(), &claims, &EncodingKey::from_secret(state.jwt_secret.as_bytes())) {
            Ok(t) => t,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "登入失敗" })))
                    .into_response();
            }
        };
    Json(json!({
        "token": token,
        "user": {
            "id": user.id,
            "displayName": user.display_name,
            "email": user.email,
            "avatar": user.avatar_url,
            "provider": provider,
            "role": role,
        }
    }))
    .into_response()
}

fn err_500() -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "登入失敗" }))).into_response()
}

/// `POST /api/auth/google/callback`
#[utoipa::path(post, path = "/api/auth/google/callback", tag = "auth",
    responses((status = 200, description = "Google OAuth 登入成功，回 JWT + 使用者（動態 JSON）"), (status = 400, description = "缺少 code"), (status = 500, description = "登入失敗")))]
pub async fn google_callback(
    State(state): State<AppState>,
    Json(body): Json<Map<String, Value>>,
) -> Response {
    let Some(code) = body.get("code").filter(|v| crate::util::js_truthy(Some(v))) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Missing code" }))).into_response();
    };
    let redirect_uri = body.get("redirectUri").cloned().unwrap_or(Value::Null);
    let token_url = env_url("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token");
    let user_url = env_url("GOOGLE_USER_URL", "https://www.googleapis.com/oauth2/v2/userinfo");

    // 交換 token（axios 非 2xx throw → catch 500）
    let token_res = state
        .http
        .post(&token_url)
        .header("Content-Type", "application/json")
        .body(
            json!({
                "code": code,
                "client_id": std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
                "client_secret": std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default(),
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            })
            .to_string(),
        )
        .send()
        .await;
    let access_token = match token_res {
        Ok(r) if r.status().is_success() => {
            let v: Value = match serde_json::from_str(&r.text().await.unwrap_or_default()) {
                Ok(v) => v,
                Err(_) => return err_500(),
            };
            v.get("access_token").and_then(|t| t.as_str()).map(String::from)
        }
        _ => return err_500(),
    };
    let Some(access_token) = access_token else { return err_500() };

    // 使用者資訊
    let user_res = state.http.get(&user_url).bearer_auth(&access_token).send().await;
    let info: Value = match user_res {
        Ok(r) if r.status().is_success() => match serde_json::from_str(&r.text().await.unwrap_or_default()) {
            Ok(v) => v,
            Err(_) => return err_500(),
        },
        _ => return err_500(),
    };
    // const { id, name, email, picture }（id String() 化）
    let id = info.get("id").map(crate::util::js_interp).unwrap_or_else(|| "undefined".into());
    let name = info.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let email = info.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let picture = info.get("picture").and_then(|v| v.as_str()).unwrap_or("").to_string();

    match upsert_oauth_user(&state, "google", &id, &name, &email, &picture).await {
        Ok(user) => finish(&state, "google", &user),
        Err(_) => err_500(),
    }
}

/// `POST /api/auth/github/callback`
#[utoipa::path(post, path = "/api/auth/github/callback", tag = "auth",
    responses((status = 200, description = "GitHub OAuth 登入成功，回 JWT + 使用者（動態 JSON）"), (status = 400, description = "缺少 code"), (status = 500, description = "登入失敗")))]
pub async fn github_callback(
    State(state): State<AppState>,
    Json(body): Json<Map<String, Value>>,
) -> Response {
    let Some(code) = body.get("code").filter(|v| crate::util::js_truthy(Some(v))) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Missing code" }))).into_response();
    };
    let redirect_uri = body.get("redirectUri").cloned().unwrap_or(Value::Null);
    let token_url = env_url("GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token");
    let user_url = env_url("GITHUB_USER_URL", "https://api.github.com/user");
    let emails_url = env_url("GITHUB_EMAILS_URL", "https://api.github.com/user/emails");

    let token_res = state
        .http
        .post(&token_url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(
            json!({
                "code": code,
                "client_id": std::env::var("GITHUB_CLIENT_ID").unwrap_or_default(),
                "client_secret": std::env::var("GITHUB_CLIENT_SECRET").unwrap_or_default(),
                "redirect_uri": redirect_uri,
            })
            .to_string(),
        )
        .send()
        .await;
    let access_token = match token_res {
        Ok(r) if r.status().is_success() => {
            let v: Value = match serde_json::from_str(&r.text().await.unwrap_or_default()) {
                Ok(v) => v,
                Err(_) => return err_500(),
            };
            v.get("access_token").and_then(|t| t.as_str()).map(String::from)
        }
        _ => return err_500(),
    };
    let Some(access_token) = access_token else { return err_500() };

    let user_res = state
        .http
        .get(&user_url)
        .bearer_auth(&access_token)
        .header("User-Agent", "koimsurai-app")
        .send()
        .await;
    let info: Value = match user_res {
        Ok(r) if r.status().is_success() => match serde_json::from_str(&r.text().await.unwrap_or_default()) {
            Ok(v) => v,
            Err(_) => return err_500(),
        },
        _ => return err_500(),
    };
    let id = info.get("id").map(crate::util::js_interp).unwrap_or_else(|| "undefined".into());
    let login = info.get("login").and_then(|v| v.as_str()).unwrap_or("");
    let name = info.get("name").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let email = info.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let avatar = info.get("avatar_url").and_then(|v| v.as_str()).unwrap_or("").to_string();

    // 無 email → /user/emails 取 primary（失敗吞掉）
    let mut user_email = email;
    if user_email.is_empty()
        && let Ok(r) = state
            .http
            .get(&emails_url)
            .bearer_auth(&access_token)
            .header("User-Agent", "koimsurai-app")
            .send()
            .await
        && r.status().is_success()
        && let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&r.text().await.unwrap_or_default())
        && let Some(primary) =
            arr.iter().find(|e| e.get("primary").and_then(|p| p.as_bool()).unwrap_or(false))
        && let Some(em) = primary.get("email").and_then(|v| v.as_str())
    {
        user_email = em.to_string();
    }

    let display_name = name.unwrap_or(login).to_string();
    match upsert_oauth_user(&state, "github", &id, &display_name, &user_email, &avatar).await {
        Ok(user) => finish(&state, "github", &user),
        Err(_) => err_500(),
    }
}
