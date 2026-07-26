use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::FromRow;

use crate::{
    auth::{require_admin, require_owner},
    error::AppError,
    handlers::posts::{PostRow, available_locales_with_source},
    state::AppState,
    util::{gen_slug, is_unique_violation, js_substring_prefix, parse_int, split_tags},
};

/// `GET /api/admin/tags` 單列（admin 版：含 0 篇的 tag、依名排序）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct AdminTagRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub name: String,
    pub created_at: String,
    #[specta(type = specta_typescript::Number)]
    pub post_count: i64,
    /// 顯示用譯名（name 仍是資料鍵）。後台編輯用。
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub name_ko: Option<String>,
    pub name_zh_cn: Option<String>,
}

/// `GET /api/admin/tags` —— requireAdmin。回應為**裸陣列**（對齊 Express `res.json(rows)`）。
/// 第一個被 Rust 接管的 authed 端點，驗證 JWT 中介層等價。
#[utoipa::path(get, path = "/api/admin/tags", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = Vec<AdminTagRow>),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_tags(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminTagRow>>, AppError> {
    require_admin(&headers, &state).await?;

    let rows = sqlx::query_as::<_, AdminTagRow>(
        "SELECT t.id, t.name, t.created_at, COUNT(pt.post_id) as post_count, \
         t.name_en, t.name_ja, t.name_ko, t.name_zh_cn \
         FROM tags t \
         LEFT JOIN post_tags pt ON t.id = pt.tag_id \
         GROUP BY t.id, t.name, t.created_at, t.name_en, t.name_ja, t.name_ko, t.name_zh_cn \
         ORDER BY t.name ASC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

/// `GET /api/admin/categories`（requireAdmin）。裸陣列。admin 版含 created_at、且 JOIN 不過濾 status。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct AdminCategoryRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub short_description: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub post_count: i64,
    /// 顯示用譯名（name 仍是資料鍵）。後台編輯用。
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub name_ko: Option<String>,
    pub name_zh_cn: Option<String>,
    pub description_en: Option<String>,
    pub description_ja: Option<String>,
    pub description_ko: Option<String>,
    pub description_zh_cn: Option<String>,
    pub short_description_en: Option<String>,
    pub short_description_ja: Option<String>,
    pub short_description_ko: Option<String>,
    pub short_description_zh_cn: Option<String>,
}

#[utoipa::path(get, path = "/api/admin/categories", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = Vec<AdminCategoryRow>),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_categories(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminCategoryRow>>, AppError> {
    require_admin(&headers, &state).await?;
    let rows = sqlx::query_as::<_, AdminCategoryRow>(
        "SELECT c.id, c.name, c.slug, c.description, c.short_description, c.created_at, c.updated_at, \
         c.name_en, c.name_ja, c.name_ko, c.name_zh_cn, \
         c.description_en, c.description_ja, c.description_ko, c.description_zh_cn, \
         c.short_description_en, c.short_description_ja, c.short_description_ko, c.short_description_zh_cn, \
                COUNT(p.id) as post_count \
         FROM categories c \
         LEFT JOIN posts p ON p.category = c.name \
         GROUP BY c.id, c.name, c.slug, c.description, c.short_description, c.created_at, c.updated_at, \
                  c.name_en, c.name_ja, c.name_ko, c.name_zh_cn, c.description_en, c.description_ja, c.description_ko, c.description_zh_cn, c.short_description_en, c.short_description_ja, c.short_description_ko, c.short_description_zh_cn \
         ORDER BY c.name ASC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

/// `GET /api/admin/users`（**requireOwner**）。`{ users: [...] }`，顯式欄位。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct AdminUserRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub provider: Option<String>,
    pub provider_id: Option<String>,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub role: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub linked_to: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AdminUsersResponse {
    pub users: Vec<AdminUserRow>,
}

#[utoipa::path(get, path = "/api/admin/users", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = AdminUsersResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminUsersResponse>, AppError> {
    require_owner(&headers, &state).await?;
    let users = sqlx::query_as::<_, AdminUserRow>(
        "SELECT id, provider, provider_id, display_name, email, avatar_url, role, linked_to, created_at, updated_at \
         FROM oauth_users ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(AdminUsersResponse { users }))
}

/// `GET /api/admin/blacklist`（requireAdmin）。`{ blacklist: rows }`（SELECT *；目前空表）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct BlacklistRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub ip: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct BlacklistResponse {
    pub blacklist: Vec<BlacklistRow>,
}

#[utoipa::path(get, path = "/api/admin/blacklist", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = BlacklistResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_blacklist(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BlacklistResponse>, AppError> {
    require_admin(&headers, &state).await?;
    let blacklist = sqlx::query_as::<_, BlacklistRow>(
        "SELECT id, ip, reason, created_at FROM ip_blacklist ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(BlacklistResponse { blacklist }))
}

/// `GET /api/admin/keyword-filters`（requireAdmin）。`{ filters: rows }`（SELECT *；目前空表）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct KeywordFilterRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub keyword: String,
    pub action: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct KeywordFiltersResponse {
    pub filters: Vec<KeywordFilterRow>,
}

#[utoipa::path(get, path = "/api/admin/keyword-filters", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = KeywordFiltersResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_keyword_filters(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<KeywordFiltersResponse>, AppError> {
    require_admin(&headers, &state).await?;
    let filters = sqlx::query_as::<_, KeywordFilterRow>(
        "SELECT id, keyword, action, created_at FROM keyword_filters ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(KeywordFiltersResponse { filters }))
}

// ── GET /api/admin/posts（分頁；requireAdmin）──────────────────────────────
#[derive(Debug, Deserialize)]
pub struct AdminPostsQuery {
    page: Option<String>,
    limit: Option<String>,
    search: Option<String>,
    status: Option<String>,
}

/// admin 端點的整列 post（`SELECT p.*` 全欄，含 12 個 i18n 欄）。
///
/// **欄位序 = posts 表宣告序 + tags**，對齊舊 `row_to_json` 的 key 序（serde_json
/// preserve_order → struct 欄位序即 JSON key 序）。`/api/admin/posts` 與
/// `/api/admin/posts/:id` 共用；兩者對 excerpt / source_language 的處理不同，由呼叫端覆寫。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AdminPostFull {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub title: String,
    pub content: String,
    pub excerpt: Option<String>,
    pub category: Option<String>,
    pub status: String,
    pub author: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub view_count: i64,
    #[specta(type = specta_typescript::Number)]
    pub likes: i64,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub layout_type: Option<String>,
    pub excerpt_zh_cn: Option<String>,
    pub title_ja: Option<String>,
    pub content_ja: Option<String>,
    pub excerpt_ja: Option<String>,
    pub title_en: Option<String>,
    pub content_en: Option<String>,
    pub excerpt_en: Option<String>,
    pub source_language: Option<String>,
    pub title_zh_cn: Option<String>,
    pub content_zh_cn: Option<String>,
    pub series_name: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub series_order: Option<i64>,
    pub title_ko: Option<String>,
    pub content_ko: Option<String>,
    pub allow_comments: bool,
    pub excerpt_ko: Option<String>,
    /// 內容格式：'markdown'（預設）| 'mdx'。
    pub format: Option<String>,
    pub tags: Vec<String>,
}

impl AdminPostFull {
    /// 原樣轉換（excerpt / source_language 皆為 DB 原值）。
    fn from_row(r: &PostRow) -> Self {
        Self {
            id: r.id,
            title: r.title.clone(),
            content: r.content.clone(),
            excerpt: r.excerpt.clone(),
            category: r.category.clone(),
            status: r.status.clone(),
            author: r.author.clone(),
            view_count: r.view_count,
            likes: r.likes,
            created_at: r.created_at.clone(),
            updated_at: r.updated_at.clone(),
            layout_type: r.layout_type.clone(),
            excerpt_zh_cn: r.excerpt_zh_cn.clone(),
            title_ja: r.title_ja.clone(),
            content_ja: r.content_ja.clone(),
            excerpt_ja: r.excerpt_ja.clone(),
            title_en: r.title_en.clone(),
            content_en: r.content_en.clone(),
            excerpt_en: r.excerpt_en.clone(),
            source_language: r.source_language.clone(),
            title_zh_cn: r.title_zh_cn.clone(),
            content_zh_cn: r.content_zh_cn.clone(),
            series_name: r.series_name.clone(),
            series_order: r.series_order,
            title_ko: r.title_ko.clone(),
            content_ko: r.content_ko.clone(),
            allow_comments: r.allow_comments(),
            excerpt_ko: r.excerpt_ko.clone(),
            format: r.format.clone(),
            tags: split_tags(r.tags.as_deref()),
        }
    }
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AdminPostsResponse {
    pub posts: Vec<AdminPostFull>,
    #[serde(rename = "totalPages")]
    #[specta(type = specta_typescript::Number)]
    pub total_pages: i64,
    #[serde(rename = "currentPage")]
    #[specta(type = specta_typescript::Number)]
    pub current_page: i64,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
}

/// `{ posts:[{...p.*, tags:[], excerpt}], totalPages, currentPage, total }`。
/// excerpt 覆寫為「原 excerpt || content 前 150 字 + '...'」，對齊 Express。
#[utoipa::path(get, path = "/api/admin/posts", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = AdminPostsResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_posts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AdminPostsQuery>,
) -> Result<Json<AdminPostsResponse>, AppError> {
    require_admin(&headers, &state).await?;
    let page = parse_int(q.page.as_deref(), 1);
    let limit = parse_int(q.limit.as_deref(), 10);
    let offset = (page - 1) * limit;

    let mut sql = String::from(
        "SELECT p.*, GROUP_CONCAT(t.name) as tags FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id WHERE 1=1",
    );
    if q.status.is_some() {
        sql.push_str(" AND p.status = ?");
    }
    if q.search.is_some() {
        sql.push_str(" AND (p.title LIKE ? OR p.content LIKE ?)");
    }
    sql.push_str(" GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?");

    let mut query = sqlx::query_as::<_, PostRow>(sqlx::AssertSqlSafe(sql.as_str()));
    if let Some(s) = &q.status {
        query = query.bind(s.clone());
    }
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        query = query.bind(like.clone()).bind(like);
    }
    let rows = query.bind(limit).bind(offset).fetch_all(&state.pool).await?;

    let mut count_sql = String::from(
        "SELECT COUNT(DISTINCT p.id) as total FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id WHERE 1=1",
    );
    if q.status.is_some() {
        count_sql.push_str(" AND p.status = ?");
    }
    if q.search.is_some() {
        count_sql.push_str(" AND (p.title LIKE ? OR p.content LIKE ?)");
    }
    let mut count_q = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(count_sql.as_str()));
    if let Some(s) = &q.status {
        count_q = count_q.bind(s.clone());
    }
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        count_q = count_q.bind(like.clone()).bind(like);
    }
    let total: i64 = count_q.fetch_one(&state.pool).await?;

    let posts: Vec<AdminPostFull> = rows
        .iter()
        .map(|row| {
            let mut item = AdminPostFull::from_row(row);
            // excerpt: row.excerpt || (content.substring(0,150) + '...')
            item.excerpt = Some(
                item.excerpt
                    .take()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("{}...", js_substring_prefix(&row.content, 150))),
            );
            item
        })
        .collect();

    let total_pages = if limit > 0 { (total + limit - 1) / limit } else { 0 };
    Ok(Json(AdminPostsResponse { posts, total_pages, current_page: page, total }))
}

// ── GET /api/admin/comments（分頁；requireAdmin）──────────────────────────
#[derive(Debug, Deserialize)]
pub struct AdminCommentsQuery {
    status: Option<String>,
    post_id: Option<String>,
    search: Option<String>,
    page: Option<String>,
    limit: Option<String>,
}

/// admin 留言列的一列：comments 表全欄（DB 宣告序）+ LEFT JOIN 的 post_title。
/// 欄位序對齊舊 `row_to_json`（`SELECT c.*` → comments 宣告序，post_title 附在最後）。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct AdminCommentRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    // thought 留言的 post_id 為 NULL
    #[specta(type = Option<specta_typescript::Number>)]
    pub post_id: Option<i64>,
    pub author: String,
    pub content: String,
    #[specta(type = specta_typescript::Number)]
    pub likes: i64,
    pub created_at: String,
    #[specta(type = specta_typescript::Number)]
    pub is_admin: i64,
    pub email: Option<String>,
    pub website: Option<String>,
    pub status: Option<String>,
    pub ip: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub parent_id: Option<i64>,
    pub avatar_url: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub thought_id: Option<i64>,
    // LEFT JOIN posts：blog 留言有標題、thought 留言為 NULL。
    pub post_title: Option<String>,
}

/// 全站留言的狀態計數（**不受 status/search/post_id 過濾影響**，永遠是全域分佈）。
/// status 受限於這四種（見 comments.rs 建立邏輯 + admin 審核端點），故可 typed 成固定欄位。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema, Default)]
pub struct CommentCounts {
    #[specta(type = specta_typescript::Number)]
    pub pending: i64,
    #[specta(type = specta_typescript::Number)]
    pub approved: i64,
    #[specta(type = specta_typescript::Number)]
    pub spam: i64,
    #[specta(type = specta_typescript::Number)]
    pub trash: i64,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AdminCommentsResponse {
    pub comments: Vec<AdminCommentRow>,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
    #[specta(type = specta_typescript::Number)]
    pub page: i64,
    #[specta(type = specta_typescript::Number)]
    pub limit: i64,
    pub counts: CommentCounts,
}

/// `{ comments:[c.*+post_title], total, page, limit, counts }`。
#[utoipa::path(get, path = "/api/admin/comments", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, body = AdminCommentsResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_comments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AdminCommentsQuery>,
) -> Result<Json<AdminCommentsResponse>, AppError> {
    require_admin(&headers, &state).await?;
    let page = parse_int(q.page.as_deref(), 1);
    let limit = parse_int(q.limit.as_deref(), 50);
    let offset = (page - 1) * limit;

    // status='all' 時不過濾（對齊 Express `status && status !== 'all'`）
    let status_filter = q.status.clone().filter(|s| s != "all");
    let use_status = status_filter.is_some();
    let mut where_ = String::from("1=1");
    if use_status {
        where_.push_str(" AND c.status = ?");
    }
    if q.post_id.is_some() {
        where_.push_str(" AND c.post_id = ?");
    }
    if q.search.is_some() {
        where_.push_str(" AND (c.content LIKE ? OR c.author LIKE ? OR c.ip LIKE ?)");
    }

    // count
    let count_sql = format!("SELECT COUNT(*) as total FROM comments c WHERE {where_}");
    let mut count_q = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(count_sql.as_str()));
    if use_status {
        count_q = count_q.bind(status_filter.clone());
    }
    if let Some(p) = &q.post_id {
        count_q = count_q.bind(p.clone());
    }
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        count_q = count_q.bind(like.clone()).bind(like.clone()).bind(like);
    }
    let total: i64 = count_q.fetch_one(&state.pool).await?;

    // rows
    let sql = format!(
        "SELECT c.*, p.title as post_title FROM comments c \
         LEFT JOIN posts p ON c.post_id = p.id WHERE {where_} \
         ORDER BY c.created_at DESC LIMIT ? OFFSET ?"
    );
    let mut query = sqlx::query_as::<_, AdminCommentRow>(sqlx::AssertSqlSafe(sql.as_str()));
    if use_status {
        query = query.bind(status_filter.clone());
    }
    if let Some(p) = &q.post_id {
        query = query.bind(p.clone());
    }
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        query = query.bind(like.clone()).bind(like.clone()).bind(like);
    }
    let comments = query.bind(limit).bind(offset).fetch_all(&state.pool).await?;

    // counts：全站分佈（不套用上面的過濾），四種狀態各歸位；不在四種內的忽略（實務不會有）。
    let mut counts = CommentCounts::default();
    let status_counts = sqlx::query_as::<_, (Option<String>, i64)>(
        "SELECT status, COUNT(*) as count FROM comments GROUP BY status",
    )
    .fetch_all(&state.pool)
    .await?;
    for (status, count) in status_counts {
        match status.as_deref() {
            Some("pending") => counts.pending = count,
            Some("approved") => counts.approved = count,
            Some("spam") => counts.spam = count,
            Some("trash") => counts.trash = count,
            _ => {}
        }
    }

    Ok(Json(AdminCommentsResponse { comments, total, page, limit, counts }))
}

// ════════════════════ Admin CRUD 寫入（requireAdmin）════════════════════
// 每個 handler 先跑 require_admin；auth 失敗回其 401/403 response。

macro_rules! auth_or_return {
    ($headers:expr_2021, $state:expr_2021) => {
        if let Err(e) = require_admin($headers, $state).await {
            return e.into_response();
        }
    };
}

// ── tags ──
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TagBody {
    name: Option<String>,
    // 顯示用譯名（name 仍是資料鍵，不參與 join/比對）
    name_en: Option<String>,
    name_ja: Option<String>,
    name_ko: Option<String>,
    name_zh_cn: Option<String>,
}

#[utoipa::path(post, path = "/api/admin/tags", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "建立標籤（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn create_tag(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TagBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let name = body.name.unwrap_or_default();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "標籤名稱為必填" }))).into_response();
    }
    match sqlx::query(
        "INSERT INTO tags (name, name_en, name_ja, name_ko, name_zh_cn, created_at) \
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(&name)
    .bind(body.name_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .execute(&state.pool)
    .await
    {
        Ok(r) => {
            (StatusCode::CREATED, Json(json!({ "id": r.last_insert_rowid(), "name": name, "post_count": 0 })))
                .into_response()
        }
        Err(e) if is_unique_violation(&e) => {
            (StatusCode::CONFLICT, Json(json!({ "error": "標籤已存在" }))).into_response()
        }
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[utoipa::path(put, path = "/api/admin/tags/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "更新標籤（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<TagBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let name = body.name.unwrap_or_default();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "標籤名稱為必填" }))).into_response();
    }
    match sqlx::query(
        "UPDATE tags SET name = ?, name_en = ?, name_ja = ?, name_ko = ?, name_zh_cn = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(body.name_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(&id)
    .execute(&state.pool)
    .await
    {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "標籤不存在" }))).into_response()
        }
        Ok(r) => Json(json!({ "id": id, "name": name, "updated": r.rows_affected() })).into_response(),
        Err(e) if is_unique_violation(&e) => {
            (StatusCode::CONFLICT, Json(json!({ "error": "標籤名稱已存在" }))).into_response()
        }
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[utoipa::path(delete, path = "/api/admin/tags/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除標籤（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    auth_or_return!(&headers, &state);
    if let Err(e) = sqlx::query("DELETE FROM post_tags WHERE tag_id = ?").bind(&id).execute(&state.pool).await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    match sqlx::query("DELETE FROM tags WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "標籤不存在" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "標籤已刪除" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── categories ──
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CategoryBody {
    name: Option<String>,
    description: Option<String>,
    slug: Option<String>,
    short_description: Option<String>,
    // 顯示用譯名／譯述（name 仍是資料鍵，不參與 join/比對）
    name_en: Option<String>,
    name_ja: Option<String>,
    name_ko: Option<String>,
    name_zh_cn: Option<String>,
    description_en: Option<String>,
    description_ja: Option<String>,
    description_ko: Option<String>,
    description_zh_cn: Option<String>,
    short_description_en: Option<String>,
    short_description_ja: Option<String>,
    short_description_ko: Option<String>,
    short_description_zh_cn: Option<String>,
}

/// slug = 提供的（非空）或由 name 生成。
fn resolve_slug(slug: &Option<String>, name: &str) -> String {
    match slug {
        Some(s) if !s.is_empty() => s.clone(),
        _ => gen_slug(name),
    }
}

#[utoipa::path(post, path = "/api/admin/categories", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "建立分類（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn create_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CategoryBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let name = body.name.clone().unwrap_or_default();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "分類名稱為必填" }))).into_response();
    }
    let slug = resolve_slug(&body.slug, &name);
    let description = body.description.clone().unwrap_or_default();
    let short_description = body.short_description.clone().unwrap_or_default();
    match sqlx::query(
        "INSERT INTO categories (name, slug, description, short_description, \
         name_en, name_ja, name_ko, name_zh_cn, description_en, description_ja, description_ko, description_zh_cn, short_description_en, short_description_ja, short_description_ko, short_description_zh_cn, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    )
    .bind(&name)
    .bind(&slug)
    .bind(&description)
    .bind(&short_description)
    .bind(body.name_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .execute(&state.pool)
    .await
    {
        Ok(r) => (
            StatusCode::CREATED,
            Json(json!({
                "id": r.last_insert_rowid(), "name": name, "slug": slug,
                "description": description, "short_description": short_description, "post_count": 0
            })),
        )
            .into_response(),
        Err(e) if is_unique_violation(&e) => {
            (StatusCode::CONFLICT, Json(json!({ "error": "分類名稱或 slug 已存在" }))).into_response()
        }
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[utoipa::path(put, path = "/api/admin/categories/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "更新分類（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn update_category(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CategoryBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let name = body.name.clone().unwrap_or_default();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "分類名稱為必填" }))).into_response();
    }
    // 先取舊名（判斷是否需同步 posts.category）
    let old_name = match sqlx::query_scalar::<_, String>("SELECT name FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(n)) => n,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "error": "分類不存在" }))).into_response(),
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let slug = resolve_slug(&body.slug, &name);
    let description = body.description.clone().unwrap_or_default();
    let short_description = body.short_description.clone().unwrap_or_default();
    let updated = match sqlx::query(
        "UPDATE categories SET name = ?, slug = ?, description = ?, short_description = ?, \
         name_en = ?, name_ja = ?, name_ko = ?, name_zh_cn = ?, description_en = ?, description_ja = ?, description_ko = ?, description_zh_cn = ?, short_description_en = ?, short_description_ja = ?, short_description_ko = ?, short_description_zh_cn = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&name)
    .bind(&slug)
    .bind(&description)
    .bind(&short_description)
    .bind(body.name_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.name_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.description_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_en.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_ja.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_ko.as_deref().filter(|v| !v.is_empty()))
    .bind(body.short_description_zh_cn.as_deref().filter(|v| !v.is_empty()))
    .bind(&id)
    .execute(&state.pool)
    .await
    {
        Ok(r) => r.rows_affected(),
        Err(e) if is_unique_violation(&e) => {
            return (StatusCode::CONFLICT, Json(json!({ "error": "分類名稱或 slug 已存在" })))
                .into_response();
        }
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    // 名稱變更 → 同步 posts.category（Express 忽略此步錯誤）
    if old_name != name {
        let _ = sqlx::query("UPDATE posts SET category = ? WHERE category = ?")
            .bind(&name)
            .bind(&old_name)
            .execute(&state.pool)
            .await;
    }
    // 注意：回應無 short_description（對齊 Express）
    Json(json!({ "id": id, "name": name, "slug": slug, "description": description, "updated": updated }))
        .into_response()
}

#[utoipa::path(delete, path = "/api/admin/categories/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除分類（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn delete_category(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    auth_or_return!(&headers, &state);
    let cat_name = match sqlx::query_scalar::<_, String>("SELECT name FROM categories WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(n)) => n,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "error": "分類不存在" }))).into_response(),
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let affected = match sqlx::query("UPDATE posts SET category = NULL WHERE category = ?")
        .bind(&cat_name)
        .execute(&state.pool)
        .await
    {
        Ok(r) => r.rows_affected(),
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    match sqlx::query("DELETE FROM categories WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(_) => Json(json!({ "message": "分類已刪除", "affectedPosts": affected })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── ip_blacklist ──
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct BlacklistBody {
    ip: Option<String>,
    reason: Option<String>,
}

#[utoipa::path(post, path = "/api/admin/blacklist", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "新增黑名單 IP（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn create_blacklist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<BlacklistBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let ip = body.ip.unwrap_or_default();
    if ip.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "IP is required" }))).into_response();
    }
    match sqlx::query("INSERT OR IGNORE INTO ip_blacklist (ip, reason) VALUES (?, ?)")
        .bind(&ip)
        .bind(body.reason.unwrap_or_default())
        .execute(&state.pool)
        .await
    {
        Ok(r) => (StatusCode::CREATED, Json(json!({ "message": "success", "id": r.last_insert_rowid() })))
            .into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[utoipa::path(delete, path = "/api/admin/blacklist/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除黑名單 IP（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn delete_blacklist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    auth_or_return!(&headers, &state);
    match sqlx::query("DELETE FROM ip_blacklist WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── keyword_filters ──
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct KeywordBody {
    keyword: Option<String>,
    action: Option<String>,
}

#[utoipa::path(post, path = "/api/admin/keyword-filters", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "新增關鍵字過濾（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn create_keyword_filter(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<KeywordBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let keyword = body.keyword.unwrap_or_default();
    if keyword.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Keyword is required" }))).into_response();
    }
    let action = match body.action.as_deref() {
        Some(a @ ("spam" | "reject")) => a.to_string(),
        _ => "spam".to_string(),
    };
    match sqlx::query("INSERT OR IGNORE INTO keyword_filters (keyword, action) VALUES (?, ?)")
        .bind(&keyword)
        .bind(&action)
        .execute(&state.pool)
        .await
    {
        Ok(r) => (StatusCode::CREATED, Json(json!({ "message": "success", "id": r.last_insert_rowid() })))
            .into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[utoipa::path(delete, path = "/api/admin/keyword-filters/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除關鍵字過濾（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn delete_keyword_filter(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    auth_or_return!(&headers, &state);
    match sqlx::query("DELETE FROM keyword_filters WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ── comments moderation（requireAdmin）──
const VALID_STATUSES: [&str; 4] = ["pending", "approved", "spam", "trash"];

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct StatusBody {
    status: Option<String>,
}

/// `PATCH /api/admin/comments/:id/status`
#[utoipa::path(patch, path = "/api/admin/comments/{id}/status", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "更新留言狀態（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn patch_comment_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<StatusBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let status = body.status.unwrap_or_default();
    if !VALID_STATUSES.contains(&status.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid status" }))).into_response();
    }
    match sqlx::query("UPDATE comments SET status = ? WHERE id = ?")
        .bind(&status)
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "Comment not found" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// 註：`PATCH /admin/comments/batch/status` 不實作——Express 端此路由被先註冊的 `:id/status` 遮蔽成
// 死路由（`batch/status` 被當 id="batch" → UPDATE 0 列 → 404）。Rust 亦不註冊 batch，讓它落到
// `:id/status`(id="batch") → 同樣 404，行為等價。見 main.rs 路由註解。

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ContentBody {
    content: Option<String>,
}

/// `PUT /api/admin/comments/:id`（改內容）
#[utoipa::path(put, path = "/api/admin/comments/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "更新留言內容（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn update_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ContentBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let content = body.content.unwrap_or_default();
    if content.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Content is required" }))).into_response();
    }
    match sqlx::query("UPDATE comments SET content = ? WHERE id = ?")
        .bind(&content)
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "Comment not found" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `DELETE /api/admin/comments/:id`（永久刪除）
#[utoipa::path(delete, path = "/api/admin/comments/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除留言（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn delete_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    auth_or_return!(&headers, &state);
    match sqlx::query("DELETE FROM comments WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "Comment not found" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "success" })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `POST /api/admin/comments/:id/reply` —— 站長回覆（is_admin=1, status=approved, author='站長'）。
#[utoipa::path(post, path = "/api/admin/comments/{id}/reply", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "站長回覆留言（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn reply_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ContentBody>,
) -> Response {
    auth_or_return!(&headers, &state);
    let content = body.content.unwrap_or_default();
    if content.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Content is required" }))).into_response();
    }
    // 取原留言的 post_id（可能為 NULL）；查無此留言 → 404
    let parent = sqlx::query_scalar::<_, Option<i64>>("SELECT post_id FROM comments WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await;
    let post_id = match parent {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "Parent comment not found" })))
                .into_response();
        }
        Ok(Some(pid)) => pid,
    };
    match sqlx::query(
        "INSERT INTO comments (post_id, author, content, status, is_admin, parent_id, ip) \
         VALUES (?, '站長', ?, 'approved', 1, ?, '')",
    )
    .bind(post_id)
    .bind(&content)
    .bind(&id)
    .execute(&state.pool)
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(json!({ "message": "success", "id": r.last_insert_rowid() })))
            .into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ════════════════ admin posts CRUD（requireAdmin）════════════════
use axum::body::Body;
use axum::extract::Request;

use crate::handlers::posts::I18N_LOCALES;
use crate::util::{js_interp, js_truthy};

/// JS 值 → SQL 綁定字串：null→None、字串原樣、其他型別 js 字串化。
fn to_s(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(js_interp(other)),
    }
}

/// `x || null` 語意：truthy → 字串、falsy → None。
fn truthy_s(v: Option<&Value>) -> Option<String> {
    v.filter(|x| js_truthy(Some(x))).and_then(to_s)
}

/// JS `Number(v)` 強制轉換：undefined→NaN(None)、null→0、''→0、bool→0/1、字串 parse 失敗→NaN。
fn js_number(v: Option<&Value>) -> Option<f64> {
    match v {
        None => None, // NaN
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(b)) => Some(if *b { 1.0 } else { 0.0 }),
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Some(0.0)
            } else {
                t.parse::<f64>().ok() // 失敗 → None (NaN)
            }
        }
        _ => None,
    }
}

/// series_order 綁定：整數值綁 i64、其餘 f64。
pub(crate) fn bind_num<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    n: Option<f64>,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    match n {
        Some(f) if f.fract() == 0.0 && f.abs() < 9e15 => q.bind(f as i64),
        Some(f) => q.bind(f),
        None => q.bind(Option::<i64>::None),
    }
}

/// manageTags 等價：先刪舊關聯；tags 空→結束；否則逐一 INSERT OR IGNORE tags → 查 id → 建關聯。
pub(crate) async fn manage_tags(state: &AppState, post_id: &str, tags: &[String]) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM post_tags WHERE post_id = ?").bind(post_id).execute(&state.pool).await?;
    for name in tags {
        sqlx::query("INSERT OR IGNORE INTO tags (name) VALUES (?)").bind(name).execute(&state.pool).await?;
        let tag_id = sqlx::query_scalar::<_, i64>("SELECT id FROM tags WHERE name = ?")
            .bind(name)
            .fetch_one(&state.pool)
            .await?;
        sqlx::query("INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)")
            .bind(post_id)
            .bind(tag_id)
            .execute(&state.pool)
            .await?;
    }
    Ok(())
}

/// body.tags → Vec<String>（非陣列/缺 → 空）。
fn tags_from(body: &Map<String, Value>) -> Vec<String> {
    body.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// 讀 body + 解析成 JSON object。非 JSON / 非 object → None（呼叫端回 400）。
async fn read_json_body(body: Body) -> Option<Map<String, Value>> {
    let bytes = axum::body::to_bytes(body, 10 * 1024 * 1024).await.ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v.as_object().cloned()
}

/// 建/改文「發佈即推送」共用：呼叫 Rust mailer，回前端可讀結果（{sent,failed,errors} 或 {error}）。
/// 寄信失敗不影響建/改文本身——文章已寫入，只把結果附在回應的 `data.newsletter`。
async fn dispatch_newsletter_result(state: &AppState, post_id: i64) -> Value {
    match crate::handlers::mailer::dispatch_newsletter(state, post_id).await {
        Ok((sent, failed, errors)) => json!({ "sent": sent, "failed": failed, "errors": errors }),
        Err(e) => json!({ "error": e }),
    }
}

/// `POST /api/admin/posts` —— 建文（i18n 欄位 + tags + series）。
/// `send_newsletter && status==='published'` → 建文後用 Rust mailer 推送電子報（原委派 Express 已退役）。
#[utoipa::path(post, path = "/api/admin/posts", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "建立文章（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_create_post(State(state): State<AppState>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    if let Err(e) = require_admin(&parts.headers, &state).await {
        return e.into_response();
    }
    let Some(b) = read_json_body(body).await else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid JSON body" }))).into_response();
    };

    // 發佈時是否推送 Newsletter：先記旗標，建文成功後再寄（見下方）。
    let status_str = b.get("status").and_then(|v| v.as_str()).map(String::from);
    let want_newsletter = js_truthy(b.get("send_newsletter")) && status_str.as_deref() == Some("published");

    if !js_truthy(b.get("title")) || !js_truthy(b.get("content")) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "缺少必填欄位: title, content" })))
            .into_response();
    }
    // source_language：缺 → 'zh-TW'；有值但非合法 locale → 400（含 null → "null"）
    let source_language = if let Some(v) = b.get("source_language") {
        let s = v.as_str().unwrap_or("").to_string();
        if !I18N_LOCALES.contains(&s.as_str()) {
            let disp = match v {
                Value::String(x) => x.clone(),
                other => other.to_string(),
            };
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("無效的 source_language: {disp}") })),
            )
                .into_response();
        }
        s
    } else {
        "zh-TW".to_string()
    };

    let title = b.get("title").and_then(to_s);
    let content = b.get("content").and_then(to_s);
    let excerpt = b.get("excerpt").and_then(to_s); // 缺→NULL、''→''
    let category = truthy_s(b.get("category")); // || null
    let status = if b.contains_key("status") { b.get("status").and_then(to_s) } else { Some("draft".into()) };
    let layout_type = if b.contains_key("layout_type") {
        b.get("layout_type").and_then(to_s)
    } else {
        Some("record".into())
    };
    let format =
        if b.contains_key("format") { b.get("format").and_then(to_s) } else { Some("markdown".into()) };
    let i18n = |k: &str| truthy_s(b.get(k)); // || null
    let series_name = b
        .get("series_name")
        .filter(|v| js_truthy(Some(v)))
        .and_then(to_s)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let series_order = js_number(b.get("series_order")).filter(|f| f.is_finite());
    let allow_comments: i64 = if b.contains_key("allow_comments") {
        if js_truthy(b.get("allow_comments")) { 1 } else { 0 }
    } else {
        1
    };

    let mut q = sqlx::query(
        "INSERT INTO posts (title, content, excerpt, category, status, author, layout_type, format, source_language, \
         title_en, content_en, excerpt_en, title_zh_cn, content_zh_cn, excerpt_zh_cn, \
         title_ja, content_ja, excerpt_ja, title_ko, content_ko, excerpt_ko, \
         series_name, series_order, allow_comments, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    )
    .bind(&title)
    .bind(&content)
    .bind(&excerpt)
    .bind(&category)
    .bind(&status)
    .bind("Koimsurai")
    .bind(&layout_type)
    .bind(&format)
    .bind(&source_language);
    for k in [
        "title_en",
        "content_en",
        "excerpt_en",
        "title_zh_cn",
        "content_zh_cn",
        "excerpt_zh_cn",
        "title_ja",
        "content_ja",
        "excerpt_ja",
        "title_ko",
        "content_ko",
        "excerpt_ko",
    ] {
        q = q.bind(i18n(k));
    }
    q = q.bind(&series_name);
    q = bind_num(q, series_order);
    q = q.bind(allow_comments);

    let post_id = match q.execute(&state.pool).await {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let tags = tags_from(&b);
    if let Err(e) = manage_tags(&state, &post_id.to_string(), &tags).await {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    // data 物件：undefined（body 缺 key）→ 該 key 省略（JSON.stringify 語意）
    let mut data = Map::new();
    data.insert("id".into(), json!(post_id));
    data.insert("title".into(), b.get("title").cloned().unwrap_or(Value::Null));
    data.insert("content".into(), b.get("content").cloned().unwrap_or(Value::Null));
    if let Some(v) = b.get("excerpt") {
        data.insert("excerpt".into(), v.clone());
    }
    if let Some(v) = b.get("category") {
        data.insert("category".into(), v.clone());
    }
    data.insert("tags".into(), json!(tags_from(&b)));
    data.insert("status".into(), b.get("status").cloned().unwrap_or_else(|| json!("draft")));
    data.insert("source_language".into(), json!(source_language));
    if want_newsletter {
        data.insert("newsletter".into(), dispatch_newsletter_result(&state, post_id).await);
    }
    (StatusCode::CREATED, Json(json!({ "message": "success", "data": Value::Object(data) }))).into_response()
}

/// `PUT /api/admin/posts/:id` —— 更新（COALESCE / CASE-flag 語意逐字照抄）。
/// 行為清理版（原 Express：`category = ?` 無 COALESCE=缺 key 清 NULL、tags 缺=清空關聯，
/// 前端恆送全欄位故從未觸發）：category 改 CASE-flag、tags 缺 key 跳過 manage_tags——
/// 部分更新不再誤刪資料。
#[utoipa::path(put, path = "/api/admin/posts/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "更新文章（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_update_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req: Request,
) -> Response {
    let (parts, body) = req.into_parts();
    if let Err(e) = require_admin(&parts.headers, &state).await {
        return e.into_response();
    }
    let Some(b) = read_json_body(body).await else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid JSON body" }))).into_response();
    };
    let status_str = b.get("status").and_then(|v| v.as_str()).map(String::from);
    // 發佈時是否推送 Newsletter：先記旗標，更新成功後再寄（見下方）。
    let want_newsletter = js_truthy(b.get("send_newsletter")) && status_str.as_deref() == Some("published");

    if let Some(v) = b.get("source_language") {
        let s = v.as_str().unwrap_or("");
        if !I18N_LOCALES.contains(&s) {
            let disp = match v {
                Value::String(x) => x.clone(),
                other => other.to_string(),
            };
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("無效的 source_language: {disp}") })),
            )
                .into_response();
        }
    }

    // toNullable：缺 key → (flag=0, NULL)；'' → (1, NULL)；其他 → (1, 值)
    let nullable = |k: &str| -> (i64, Option<String>) {
        match b.get(k) {
            None => (0, None),
            Some(v) => {
                let s = to_s(v);
                (1, s.filter(|x| !x.is_empty()))
            }
        }
    };
    let series_name: (i64, Option<String>) = match b.get("series_name") {
        None => (0, None),
        Some(v) => {
            let s = match v {
                Value::Null => None,
                Value::String(x) if x.is_empty() => None,
                other => to_s(other).map(|x| x.trim().to_string()),
            };
            (1, s)
        }
    };
    let series_order: (i64, Option<f64>) = match b.get("series_order") {
        None => (0, None),
        Some(Value::Null) => (1, None),
        Some(Value::String(s)) if s.is_empty() => (1, None),
        Some(v) => (1, js_number(Some(v)).filter(|f| f.is_finite())),
    };
    let allow_comments: (i64, Option<i64>) = match b.get("allow_comments") {
        None => (0, None),
        Some(v) => (1, Some(if js_truthy(Some(v)) { 1 } else { 0 })),
    };

    let mut q = sqlx::query(
        "UPDATE posts SET \
         title = COALESCE(?, title), content = COALESCE(?, content), excerpt = COALESCE(?, excerpt), \
         category = CASE WHEN ? = 1 THEN ? ELSE category END, \
         status = COALESCE(?, status), layout_type = COALESCE(?, layout_type), \
         format = COALESCE(?, format), \
         source_language = COALESCE(?, source_language), \
         title_en = CASE WHEN ? = 1 THEN ? ELSE title_en END, \
         content_en = CASE WHEN ? = 1 THEN ? ELSE content_en END, \
         excerpt_en = CASE WHEN ? = 1 THEN ? ELSE excerpt_en END, \
         title_zh_cn = CASE WHEN ? = 1 THEN ? ELSE title_zh_cn END, \
         content_zh_cn = CASE WHEN ? = 1 THEN ? ELSE content_zh_cn END, \
         excerpt_zh_cn = CASE WHEN ? = 1 THEN ? ELSE excerpt_zh_cn END, \
         title_ja = CASE WHEN ? = 1 THEN ? ELSE title_ja END, \
         content_ja = CASE WHEN ? = 1 THEN ? ELSE content_ja END, \
         excerpt_ja = CASE WHEN ? = 1 THEN ? ELSE excerpt_ja END, \
         title_ko = CASE WHEN ? = 1 THEN ? ELSE title_ko END, \
         content_ko = CASE WHEN ? = 1 THEN ? ELSE content_ko END, \
         excerpt_ko = CASE WHEN ? = 1 THEN ? ELSE excerpt_ko END, \
         series_name = CASE WHEN ? = 1 THEN ? ELSE series_name END, \
         series_order = CASE WHEN ? = 1 THEN ? ELSE series_order END, \
         allow_comments = CASE WHEN ? = 1 THEN ? ELSE allow_comments END, \
         updated_at = datetime('now') WHERE id = ?",
    )
    .bind(b.get("title").and_then(to_s))
    .bind(b.get("content").and_then(to_s))
    .bind(b.get("excerpt").and_then(to_s))
    .bind(if b.contains_key("category") { 1i64 } else { 0 })
    .bind(b.get("category").and_then(to_s))
    .bind(b.get("status").and_then(to_s))
    .bind(b.get("layout_type").and_then(to_s))
    .bind(b.get("format").and_then(to_s))
    .bind(b.get("source_language").and_then(to_s));
    for k in [
        "title_en",
        "content_en",
        "excerpt_en",
        "title_zh_cn",
        "content_zh_cn",
        "excerpt_zh_cn",
        "title_ja",
        "content_ja",
        "excerpt_ja",
        "title_ko",
        "content_ko",
        "excerpt_ko",
    ] {
        let (f, v) = nullable(k);
        q = q.bind(f).bind(v);
    }
    q = q.bind(series_name.0).bind(&series_name.1);
    q = q.bind(series_order.0);
    q = bind_num(q, series_order.1);
    q = q.bind(allow_comments.0).bind(allow_comments.1);
    q = q.bind(&id);

    match q.execute(&state.pool).await {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(r) if r.rows_affected() == 0 => {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "文章不存在" }))).into_response();
        }
        Ok(_) => {}
    }
    // tags 有帶 key（含空陣列）才重建關聯；缺 key 不動（回應仍回 body 的 tags 或 []）
    let tags = tags_from(&b);
    if b.contains_key("tags")
        && let Err(e) = manage_tags(&state, &id, &tags).await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    let mut data = Map::new();
    data.insert("id".into(), json!(id));
    for k in ["title", "content", "excerpt", "category"] {
        if let Some(v) = b.get(k) {
            data.insert(k.into(), v.clone());
        }
    }
    data.insert("tags".into(), json!(tags));
    if let Some(v) = b.get("status") {
        data.insert("status".into(), v.clone());
    }
    if want_newsletter && let Ok(pid) = id.parse::<i64>() {
        data.insert("newsletter".into(), dispatch_newsletter_result(&state, pid).await);
    }
    Json(json!({ "message": "success", "data": Value::Object(data) })).into_response()
}

/// `DELETE /api/admin/posts/:id` —— 先清 post_tags 再刪文；404 對齊。
#[utoipa::path(delete, path = "/api/admin/posts/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, description = "刪除文章（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_delete_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    if let Err(e) =
        sqlx::query("DELETE FROM post_tags WHERE post_id = ?").bind(&id).execute(&state.pool).await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    match sqlx::query("DELETE FROM posts WHERE id = ?").bind(&id).execute(&state.pool).await {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "文章不存在" }))).into_response()
        }
        Ok(r) => Json(json!({ "message": "文章已刪除", "deleted": r.rows_affected() })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `GET /api/admin/posts/:id` 成功回應：`{message, ...row, tags, available_locales}`。
/// flatten 讓 row 的欄位攤平在頂層，key 序 = message → AdminPostFull 欄位序 → available_locales。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct AdminPostDetailResponse {
    pub message: String,
    #[serde(flatten)]
    pub post: AdminPostFull,
    pub available_locales: Vec<String>,
}

/// `GET /api/admin/posts/:id` —— 編輯器用，回全 locale 欄位。
#[utoipa::path(get, path = "/api/admin/posts/{id}", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses(
        (status = 200, body = AdminPostDetailResponse),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_get_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let row = sqlx::query_as::<_, PostRow>(
        "SELECT p.*, GROUP_CONCAT(t.name) as tags FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id WHERE p.id = ? GROUP BY p.id",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await;
    let row = match row {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => {
            return (StatusCode::NOT_FOUND, Json(json!({ "message": "Post not found" }))).into_response();
        }
        Ok(Some(r)) => r,
    };
    let mut post = AdminPostFull::from_row(&row);
    // source_language: row.source_language || 'zh-TW'（空字串也算缺；與公開端點的規則不同）
    let source = post.source_language.as_deref().filter(|s| !s.is_empty()).unwrap_or("zh-TW").to_string();
    post.source_language = Some(source.clone());
    let available_locales = available_locales_with_source(&row, &source);
    Json(AdminPostDetailResponse { message: "success".into(), post, available_locales }).into_response()
}

/// `GET /api/admin/stats` —— requireAdmin。文章/留言統計 + 模擬訪客數（`Math.random`）。
/// 行為清理版：原 Express 的 `visitors` 是 `Math.random()` 模擬數據 →
/// 改為 `SUM(posts.view_count)`（真實累計瀏覽）。其餘欄位照舊（確定性 DB count）。
#[utoipa::path(get, path = "/api/admin/stats", tag = "admin", security(("bearer" = [])),
    responses(
        (status = 200, description = "後台統計（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_stats(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let posts = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        "SELECT COUNT(*), \
                COUNT(CASE WHEN status = 'published' THEN 1 END), \
                COUNT(CASE WHEN status = 'draft' THEN 1 END), \
                COUNT(CASE WHEN created_at >= date('now', '-30 days') THEN 1 END) \
         FROM posts",
    )
    .fetch_one(&state.pool)
    .await;
    let (total_posts, published, draft, this_month) = match posts {
        Ok(r) => r,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let comments = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COUNT(CASE WHEN created_at >= date('now', '-7 days') THEN 1 END) FROM comments",
    )
    .fetch_one(&state.pool)
    .await;
    let (total_comments, comments_this_week) = match comments {
        Ok(r) => r,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    // Math.floor(Math.random()*1000)+1000 → [1000,1999]
    let visitors: i64 = match sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(view_count), 0) FROM posts")
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => v,
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    Json(json!({
        "totalPosts": total_posts,
        "publishedPosts": published,
        "draftPosts": draft,
        "postsThisMonth": this_month,
        "comments": total_comments,
        "commentsThisWeek": comments_this_week,
        "visitors": visitors,
        "message": "success",
    }))
    .into_response()
}

/// `PUT /api/admin/users/:id/role` —— requireOwner。改用戶角色（不能改自己）。
#[utoipa::path(put, path = "/api/admin/users/{id}/role", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "更新使用者角色（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_update_user_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Map<String, Value>>,
) -> Response {
    let owner = match require_owner(&headers, &state).await {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("");
    if !matches!(role, "USER" | "ADMIN" | "OWNER") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "無效的角色，允許值：USER, ADMIN, OWNER" })))
            .into_response();
    }
    // req.user.dbUser.id === parseInt(userId)（legacy token 無 dbUser → 跳過）
    if let (Some(db_id), Some(target)) = (owner.db_user_id, crate::util::js_parse_int_opt(&id))
        && db_id == target
    {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "不能修改自己的角色" }))).into_response();
    }
    match sqlx::query("UPDATE oauth_users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(role)
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "用戶不存在" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "角色更新成功", "role": role })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `PATCH /api/admin/comments/batch/status` —— 批次審核。
/// Express 原版因 `:id/status` 先註冊而永遠打不到（bug #2）；axum matchit 靜態段
/// 天然優先於參數段，此處為修好後的行為。
#[utoipa::path(patch, path = "/api/admin/comments/batch/status", tag = "admin", security(("bearer" = [])),
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "批次更新留言狀態（動態 JSON）"),
        (status = 401, description = "未授權"),
    ))]
pub async fn admin_batch_comment_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Map<String, Value>>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let ids: Vec<i64> = body
        .get("ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
        .unwrap_or_default();
    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if ids.is_empty() || !matches!(status, "pending" | "approved" | "spam" | "trash") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid request" }))).into_response();
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!("UPDATE comments SET status = ? WHERE id IN ({placeholders})");
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.as_str())).bind(status);
    for id in &ids {
        q = q.bind(id);
    }
    match q.execute(&state.pool).await {
        Ok(r) => Json(json!({ "message": "success", "affected": r.rows_affected() })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}
