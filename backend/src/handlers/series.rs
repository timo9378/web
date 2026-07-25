use axum::{
    Json,
    extract::{Path, State},
};
use serde::Serialize;
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

/// `GET /api/series` 單列：系列名 + 篇數 + 起訖時間。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct SeriesRow {
    pub name: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
    pub first_at: Option<String>,
    pub last_at: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SeriesListResponse {
    pub series: Vec<SeriesRow>,
}

/// `GET /api/series` —— 公開純讀（注意：回應**沒有** message 欄位，對齊 Express）。
#[utoipa::path(get, path = "/api/series", tag = "series", responses((status = 200, body = SeriesListResponse)))]
pub async fn list_series(State(state): State<AppState>) -> Result<Json<SeriesListResponse>, AppError> {
    let series = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT series_name AS name, COUNT(*) AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
        FROM posts
        WHERE series_name IS NOT NULL AND series_name <> '' AND status = 'published'
        GROUP BY series_name
        ORDER BY last_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(SeriesListResponse { series }))
}

/// `GET /api/series/:name` 單列：某系列下的文章（精簡欄位）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct SeriesPostRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub title: String,
    pub excerpt: Option<String>,
    pub series_name: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub series_order: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct SeriesDetailResponse {
    pub name: String,
    pub posts: Vec<SeriesPostRow>,
}

/// `GET /api/series/:name` —— 公開純讀。排序邏輯（NULL series_order 殿後）照抄 Express。
#[utoipa::path(
    get, path = "/api/series/{name}", tag = "series",
    params(("name" = String, Path, description = "系列名")),
    responses((status = 200, body = SeriesDetailResponse)),
)]
pub async fn series_by_name(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<SeriesDetailResponse>, AppError> {
    let posts = sqlx::query_as::<_, SeriesPostRow>(
        r#"
        SELECT id, title, excerpt, series_name, series_order, created_at
        FROM posts
        WHERE series_name = ? AND status = 'published'
        ORDER BY
          CASE WHEN series_order IS NULL THEN 1 ELSE 0 END,
          series_order ASC,
          created_at ASC
        "#,
    )
    .bind(&name)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(SeriesDetailResponse { name, posts }))
}
