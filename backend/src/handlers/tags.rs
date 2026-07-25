use axum::{Json, extract::State};
use serde::Serialize;
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

/// 公開標籤列表的單列。欄位順序 = SELECT 欄位順序 = Express JSON key 順序，
/// 以確保 byte-level 對拍等價（serde 依宣告順序序列化）。
/// One row of the public tag list. Field order = SELECT column order = Express JSON key
/// order, so serialization is byte-equivalent (serde serializes in declaration order).
#[derive(Debug, Serialize, FromRow, utoipa::ToSchema)]
pub struct TagRow {
    pub id: i64,
    pub name: String,
    /// 直接保留 sqlite 原始 TEXT（例 `"2026-04-04 19:16:29"`），不經 chrono 解析，
    /// 避免格式漂移（Express 也是原樣丟出 DATETIME 字串）。
    pub created_at: String,
    pub post_count: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TagsResponse {
    pub message: &'static str,
    pub tags: Vec<TagRow>,
}

/// `GET /api/tags` —— 第一個被 Rust 接管的端點（公開、純讀、無副作用）。
/// SQL 與排序逐字照抄 Express，讀同一個 sqlite。
///
/// First endpoint taken over by Rust (public, read-only, no side effects).
/// SQL and ordering copied verbatim from Express, reading the same sqlite.
#[utoipa::path(get, path = "/api/tags", tag = "tags",
    responses((status = 200, body = TagsResponse)))]
pub async fn list_tags(State(state): State<AppState>) -> Result<Json<TagsResponse>, AppError> {
    // 與 Express index.js 的 `/tags` 查詢逐字一致（含 LEFT JOIN / HAVING / ORDER BY），
    // 確保資料與排序在同一份 DB 上完全相同。
    let tags = sqlx::query_as::<_, TagRow>(
        r#"
        SELECT t.id, t.name, t.created_at,
          COUNT(CASE WHEN p.status = 'published' THEN 1 END) as post_count
        FROM tags t
        LEFT JOIN post_tags pt ON t.id = pt.tag_id
        LEFT JOIN posts p ON pt.post_id = p.id
        GROUP BY t.id
        HAVING post_count > 0
        ORDER BY post_count DESC, t.name ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(TagsResponse { message: "success", tags }))
}
