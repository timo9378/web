use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

/// `GET /api/categories` 單列。欄位順序對齊 Express SELECT。
#[derive(Debug, Serialize, FromRow, utoipa::ToSchema, specta::Type)]
pub struct CategoryRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub updated_at: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub post_count: i64,
    /// 顯示用譯名（name 仍是資料鍵）。沒填就由前端 fallback 回 name。
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub name_ko: Option<String>,
    pub name_zh_cn: Option<String>,
    /// 描述的譯文（tooltip 用）。
    pub description_en: Option<String>,
    pub description_ja: Option<String>,
    pub description_ko: Option<String>,
    pub description_zh_cn: Option<String>,
    pub short_description_en: Option<String>,
    pub short_description_ja: Option<String>,
    pub short_description_ko: Option<String>,
    pub short_description_zh_cn: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema, specta::Type)]
pub struct CategoriesResponse {
    pub message: &'static str,
    pub categories: Vec<CategoryRow>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct CategoriesQuery {
    /// 只計入有該語系內容的文章（同 `/api/posts?lang=`）。省略＝計入全部。
    pub lang: Option<String>,
}

/// `GET /api/categories` —— 公開純讀。SQL 逐字照抄 Express，另加 `?lang=` 的語系過濾。
#[utoipa::path(get, path = "/api/categories", tag = "categories",
    params(CategoriesQuery),
    responses((status = 200, body = CategoriesResponse)))]
pub async fn list_categories(
    State(state): State<AppState>,
    Query(q): Query<CategoriesQuery>,
) -> Result<Json<CategoriesResponse>, AppError> {
    // `/api/posts?lang=` 會濾掉沒該語系譯文的文章，這裡的 post_count 若不跟著濾，側欄就會
    // 出現「歲月留痕 4」點進去卻是空的。條件放在 LEFT JOIN 的 ON 而**不是** WHERE：放
    // WHERE 會把該語系 0 篇的分類整列打掉（LEFT JOIN 退化成 INNER），前端就拿不到那筆
    // 分類資料；放 ON 則會照樣回該列、post_count = 0，由前端的 `post_count > 0` 隱藏。
    let locale_cond = crate::handlers::posts::parse_locale(q.lang.as_deref())
        .map(|loc| format!(" AND {}", crate::handlers::posts::locale_available_sql(loc, "p")))
        .unwrap_or_default();
    let sql = format!(
        r#"
        SELECT
          c.id,
          c.name,
          c.slug,
          c.description,
          c.short_description,
          c.updated_at,
          COUNT(p.id) as post_count,
          c.name_en, c.name_ja, c.name_ko, c.name_zh_cn,
          c.description_en, c.description_ja, c.description_ko, c.description_zh_cn, c.short_description_en, c.short_description_ja, c.short_description_ko, c.short_description_zh_cn
        FROM categories c
        LEFT JOIN posts p ON p.category = c.name AND p.status = 'published'{locale_cond}
        GROUP BY c.id, c.name, c.slug, c.description, c.short_description, c.updated_at,
                 c.name_en, c.name_ja, c.name_ko, c.name_zh_cn,
                 c.description_en, c.description_ja, c.description_ko, c.description_zh_cn, c.short_description_en, c.short_description_ja, c.short_description_ko, c.short_description_zh_cn
        ORDER BY post_count DESC, c.name ASC
        "#
    );
    let categories =
        sqlx::query_as::<_, CategoryRow>(sqlx::AssertSqlSafe(sql.as_str())).fetch_all(&state.pool).await?;

    Ok(Json(CategoriesResponse { message: "success", categories }))
}
