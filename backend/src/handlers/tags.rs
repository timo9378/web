use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

/// 公開標籤列表的單列。欄位順序 = SELECT 欄位順序 = Express JSON key 順序，
/// 以確保 byte-level 對拍等價（serde 依宣告順序序列化）。
/// One row of the public tag list. Field order = SELECT column order = Express JSON key
/// order, so serialization is byte-equivalent (serde serializes in declaration order).
#[derive(Debug, Serialize, FromRow, utoipa::ToSchema, specta::Type)]
pub struct TagRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub name: String,
    /// 直接保留 sqlite 原始 TEXT（例 `"2026-04-04 19:16:29"`），不經 chrono 解析，
    /// 避免格式漂移（Express 也是原樣丟出 DATETIME 字串）。
    pub created_at: String,
    #[specta(type = specta_typescript::Number)]
    pub post_count: i64,
    /// 顯示用譯名（name 仍是資料鍵）。沒填就由前端 fallback 回 name。
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub name_ko: Option<String>,
    pub name_zh_cn: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema, specta::Type)]
pub struct TagsResponse {
    pub message: &'static str,
    pub tags: Vec<TagRow>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct TagsQuery {
    /// 只計入有該語系內容的文章（同 `/api/posts?lang=`）。省略＝計入全部。
    pub lang: Option<String>,
}

/// `GET /api/tags` —— 第一個被 Rust 接管的端點（公開、純讀、無副作用）。
/// SQL 與排序逐字照抄 Express，讀同一個 sqlite。
///
/// First endpoint taken over by Rust (public, read-only, no side effects).
/// SQL and ordering copied verbatim from Express, reading the same sqlite.
#[utoipa::path(get, path = "/api/tags", tag = "tags",
    params(TagsQuery),
    responses((status = 200, body = TagsResponse)))]
pub async fn list_tags(
    State(state): State<AppState>,
    Query(q): Query<TagsQuery>,
) -> Result<Json<TagsResponse>, AppError> {
    // 與 Express index.js 的 `/tags` 查詢逐字一致（含 LEFT JOIN / HAVING / ORDER BY），
    // 確保資料與排序在同一份 DB 上完全相同；`?lang=` 的語系過濾是後加的。
    //
    // 條件併進 COUNT 的 CASE WHEN 而非 WHERE，理由同 categories：不能讓某語系 0 篇的標籤
    // 改變其他列的結果。這裡剛好 `HAVING post_count > 0` 會順手把 0 的標籤收掉。
    let locale_cond = crate::handlers::posts::parse_locale(q.lang.as_deref())
        .map(|loc| format!(" AND {}", crate::handlers::posts::locale_available_sql(loc, "p")))
        .unwrap_or_default();
    let sql = format!(
        r"
        SELECT t.id, t.name, t.created_at,
          COUNT(CASE WHEN p.status = 'published'{locale_cond} THEN 1 END) as post_count,
          t.name_en, t.name_ja, t.name_ko, t.name_zh_cn
        FROM tags t
        LEFT JOIN post_tags pt ON t.id = pt.tag_id
        LEFT JOIN posts p ON pt.post_id = p.id
        GROUP BY t.id
        HAVING post_count > 0
        ORDER BY post_count DESC, t.name ASC
        "
    );
    let tags = sqlx::query_as::<_, TagRow>(sqlx::AssertSqlSafe(sql.as_str())).fetch_all(&state.pool).await?;

    Ok(Json(TagsResponse { message: "success", tags }))
}
