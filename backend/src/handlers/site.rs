//! 站台層級的小端點：首頁的「留下印記」按讚、以及 GitHub 星數（走後端代理 + 快取，
//! 讀者的瀏覽器不會直接打 api.github.com——與站上 link-preview 同樣的自架立場）。
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;

use crate::state::AppState;

/// 按讚計數在 site_counters 的鍵。
const LIKE_KEY: &str = "site_likes";
/// GitHub 星數快取多久（星數變動很慢，一小時足夠且遠低於未認證的速率限制）。
const STARS_TTL: Duration = Duration::from_secs(3600);

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct CountResponse {
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
}

async fn read_count(state: &AppState, key: &str) -> Result<i64, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, i64>("SELECT count FROM site_counters WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.pool)
        .await?
        .unwrap_or(0))
}

/// `GET /api/site/likes` —— 公開純讀。
#[utoipa::path(get, path = "/api/site/likes", tag = "site", responses((status = 200, body = CountResponse)))]
pub async fn get_site_likes(State(state): State<AppState>) -> Response {
    match read_count(&state, LIKE_KEY).await {
        Ok(count) => Json(CountResponse { count }).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `POST /api/site/likes` —— 公開 +1（防重複在 client 端以 localStorage 做）。
#[utoipa::path(post, path = "/api/site/likes", tag = "site", responses((status = 200, body = CountResponse)))]
pub async fn post_site_like(State(state): State<AppState>) -> Response {
    if let Err(e) = sqlx::query(
        "INSERT INTO site_counters (key, count, updated_at) VALUES (?, 1, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET count = count + 1, updated_at = datetime('now')",
    )
    .bind(LIKE_KEY)
    .execute(&state.pool)
    .await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    match read_count(&state, LIKE_KEY).await {
        Ok(count) => Json(CountResponse { count }).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// GitHub 星數的記憶體快取（TTL 內直接回上次的值；重啟就重抓，無妨）。
static STARS_CACHE: OnceLock<Mutex<Option<(Instant, i64)>>> = OnceLock::new();

/// `GET /api/site/github-stars` —— 代理 GitHub API 並快取一小時。
/// 抓不到就回上次的值（沒有就 0），不讓外部服務的抖動變成前台錯誤。
#[utoipa::path(get, path = "/api/site/github-stars", tag = "site", responses((status = 200, body = CountResponse)))]
pub async fn get_github_stars() -> Response {
    let cache = STARS_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().await;
    if let Some((at, count)) = *guard
        && at.elapsed() < STARS_TTL
    {
        return Json(CountResponse { count }).into_response();
    }

    let repo = std::env::var("GITHUB_REPO").unwrap_or_else(|_| "timo9378/sora-to-ki".to_string());
    let fetched = async {
        let res = reqwest::Client::new()
            .get(format!("https://api.github.com/repos/{repo}"))
            .header("user-agent", "koimsurai-site")
            .header("accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(6))
            .send()
            .await
            .ok()?;
        // reqwest 沒開 json feature（避免多拉依賴）→ 自己用 serde_json 解析
        let text = res.text().await.ok()?;
        let body: serde_json::Value = serde_json::from_str(&text).ok()?;
        body.get("stargazers_count")?.as_i64()
    }
    .await;

    match fetched {
        Some(count) => {
            *guard = Some((Instant::now(), count));
            Json(CountResponse { count }).into_response()
        }
        // 抓失敗：回上次快取（沒有就 0），前台照樣能顯示
        None => Json(json!({ "count": guard.map(|(_, c)| c).unwrap_or(0) })).into_response(),
    }
}
