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
pub async fn get_github_stars(State(state): State<AppState>) -> Response {
    let cache = STARS_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().await;
    if let Some((at, count)) = *guard
        && at.elapsed() < STARS_TTL
    {
        return Json(CountResponse { count }).into_response();
    }

    let repo = std::env::var("GITHUB_REPO").unwrap_or_else(|_| "timo9378/sora-to-ki".to_string());
    let fetched = async {
        // 走 state 的 client 與 ExternalUrls，不自己 new 一個也不硬編網址——
        // 硬編的話這支就完全測不了（測試會真的打 api.github.com，而且在 CI 上
        // 還可能成功，於是測試結果取決於別人的服務今天有沒有掛）。
        let res = state
            .http
            .get(format!("{}/repos/{repo}", state.external.github_api))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State as AxState;
    use wiremock::matchers::{method as m, path as p};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ⚠ `STARS_CACHE` 是**全域 static**（跟 quote.rs 的 QUOTE_CACHE 同一類）。
    // nextest 一個測試一個行程所以現況安全，但同一條測試裡跑兩輪就會吃到上一輪的值——
    // 下面「快取生效」那條正是靠這個特性驗的，而「抓失敗回上次的值」那條也依賴它。

    async fn body_of(resp: Response) -> serde_json::Value {
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.expect("collect").to_bytes();
        serde_json::from_slice(&bytes).expect("回應應該是 JSON")
    }

    async fn state_with_mock(server: &MockServer) -> AppState {
        let mut st = crate::state::test_state().await;
        st.external = std::sync::Arc::new(crate::state::ExternalUrls::all_pointing_at(&server.uri()));
        st
    }

    #[tokio::test]
    async fn 按讚會累加而且讀回來的是同一個數() {
        let st = crate::state::test_state().await;
        // 還沒有人按過 → 0 而不是 404 或 null（前端直接顯示這個數字）
        let v = body_of(get_site_likes(AxState(st.clone())).await).await;
        assert_eq!(v["count"], 0, "沒有紀錄時要回 0，不是 null");

        for expect in 1..=3 {
            let v = body_of(post_site_like(AxState(st.clone())).await).await;
            assert_eq!(v["count"], expect, "POST 要回加完之後的值，前端才不用再讀一次");
        }
        let v = body_of(get_site_likes(AxState(st)).await).await;
        assert_eq!(v["count"], 3, "GET 讀回來要跟 POST 回的一致");
    }

    /// 星數抓得到就快取一小時；**抓不到要回上次的值**（沒有就 0），
    /// 不讓 GitHub 的抖動變成前台的錯誤或一個消失的數字。
    #[tokio::test]
    async fn 星數抓得到就快取_抓不到回上次的值() {
        let server = MockServer::start().await;
        Mock::given(m("GET"))
            .and(p("/github/repos/timo9378/sora-to-ki"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "stargazers_count": 42, "name": "sora-to-ki"
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let v = body_of(get_github_stars(AxState(st.clone())).await).await;
        assert_eq!(v["count"], 42);

        // 第二次要吃快取（TTL 一小時），不該再打 GitHub
        let before = server.received_requests().await.unwrap().len();
        let v = body_of(get_github_stars(AxState(st)).await).await;
        assert_eq!(v["count"], 42);
        assert_eq!(
            server.received_requests().await.unwrap().len(),
            before,
            "TTL 內不該再打——未認證的 GitHub API 一小時只有 60 次"
        );
    }

    #[tokio::test]
    async fn 星數抓不到時回_0_而不是錯誤() {
        // 這個行程的快取是空的（每個測試一個行程），所以走的是「沒有上次的值」那條
        let server = MockServer::start().await; // 不掛任何 route → 404
        let st = state_with_mock(&server).await;
        let resp = get_github_stars(AxState(st)).await;
        assert_eq!(resp.status(), StatusCode::OK, "外部服務掛掉不該讓前台看到錯誤");
        assert_eq!(body_of(resp).await["count"], 0, "沒有可回退的值時給 0");
    }

    #[tokio::test]
    async fn 星數回應少了欄位時也走降級路徑() {
        // GitHub 改欄位名或回錯誤物件（rate limit 是 200 + {message}）時走這條
        let server = MockServer::start().await;
        Mock::given(m("GET"))
            .and(p("/github/repos/timo9378/sora-to-ki"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "message": "API rate limit exceeded"
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let resp = get_github_stars(AxState(st)).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_of(resp).await["count"], 0);
    }
}
