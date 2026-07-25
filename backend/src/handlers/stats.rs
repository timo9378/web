use std::time::{SystemTime, UNIX_EPOCH};

use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

/// 站台起算時間，對齊 Express：`new Date('2025-04-01T00:00:00+08:00').getTime()`。
const SITE_START_AT_MS: i64 = 1_743_436_800_000;

#[derive(Debug, FromRow)]
struct StatsRow {
    total_posts: i64,
    total_chars: i64,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct StatsResponse {
    pub message: String,
    #[specta(type = specta_typescript::Number)]
    pub total_posts: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_chars: i64,
    #[specta(type = specta_typescript::Number)]
    pub days: i64,
}

/// `GET /api/stats` —— 公開純讀 + 站齡日數。
/// `days` 複製 Express 的 JS 日期數學（`Math.floor` 對正數＝截斷，max(1, …)）；
/// 與 Express 同一時刻呼叫即一致。
#[utoipa::path(get, path = "/api/stats", tag = "stats", responses((status = 200, body = StatsResponse)))]
pub async fn site_stats(State(state): State<AppState>) -> Result<Json<StatsResponse>, AppError> {
    let row = sqlx::query_as::<_, StatsRow>(
        r#"
        SELECT
          COUNT(*) AS total_posts,
          COALESCE(SUM(LENGTH(content)), 0) AS total_chars
        FROM posts
        WHERE status = 'published'
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(SITE_START_AT_MS);
    let days = std::cmp::max(1, (now_ms - SITE_START_AT_MS) / 86_400_000);

    Ok(Json(StatsResponse {
        message: "success".to_string(),
        total_posts: row.total_posts,
        total_chars: row.total_chars,
        days,
    }))
}
