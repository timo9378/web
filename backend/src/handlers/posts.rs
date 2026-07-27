use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::{error::AppError, state::AppState};

// ── 多語系（對齊 Express index.js 的常數與 helper）─────────────────────────
pub(crate) const I18N_LOCALES: [&str; 5] = ["zh-TW", "zh-CN", "en", "ja", "ko"];

/// LOCALE_COLUMN_SUFFIX：zh-TW 是來源語、無後綴欄位。
pub(crate) fn locale_suffix(locale: &str) -> Option<&'static str> {
    match locale {
        "zh-CN" => Some("zh_cn"),
        "en" => Some("en"),
        "ja" => Some("ja"),
        "ko" => Some("ko"),
        _ => None,
    }
}

/// parseLocale：把 ?lang= 正規化成 canonical locale，無法辨識回 None。
pub(crate) fn parse_locale(raw: Option<&str>) -> Option<&'static str> {
    match raw?.to_lowercase().as_str() {
        "zh-tw" | "zh-hant" => Some("zh-TW"),
        "zh-cn" | "zh-hans" => Some("zh-CN"),
        "en" => Some("en"),
        "ja" => Some("ja"),
        "ko" => Some("ko"),
        _ => None,
    }
}

/// posts 一列（含全部 i18n 欄位；用 `SELECT p.*` 取，FromRow 依名對應、忽略多餘欄位）。
///
/// **欄位序 = posts 表宣告序**（見 `PRAGMA table_info(posts)`），因為 admin 端點的
/// `AdminPostFull` 照這個順序出 JSON，要對齊舊 `row_to_json`（DB 欄位序）的 key 序。
#[derive(Debug, FromRow)]
pub struct PostRow {
    pub(crate) id: i64,
    /// 網址用的英文 slug（canonical）。舊資料可能為 NULL → 前端退回用 id。
    pub(crate) slug: Option<String>,
    pub(crate) title: String,
    pub(crate) content: String,
    pub(crate) excerpt: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) status: String,
    pub(crate) author: Option<String>,
    pub(crate) view_count: i64,
    pub(crate) likes: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) layout_type: Option<String>,
    pub(crate) excerpt_zh_cn: Option<String>,
    pub(crate) title_ja: Option<String>,
    pub(crate) content_ja: Option<String>,
    pub(crate) excerpt_ja: Option<String>,
    pub(crate) title_en: Option<String>,
    pub(crate) content_en: Option<String>,
    pub(crate) excerpt_en: Option<String>,
    pub(crate) source_language: Option<String>,
    pub(crate) title_zh_cn: Option<String>,
    pub(crate) content_zh_cn: Option<String>,
    pub(crate) series_name: Option<String>,
    pub(crate) series_order: Option<i64>,
    pub(crate) title_ko: Option<String>,
    pub(crate) content_ko: Option<String>,
    // 欄位可為 NULL（`allow_comments INTEGER DEFAULT 1`，舊列理論上可能沒值）。
    // NULL 在舊 JS 語意等同「允許」（`null !== 0 && null !== false`）→ 見 allow_comments()。
    pub(crate) allow_comments: Option<bool>,
    pub(crate) excerpt_ko: Option<String>,
    // 內容格式：'markdown'（預設）| 'mdx'。舊列/未設 → NULL → 前端當 markdown。
    #[sqlx(default)]
    pub(crate) format: Option<String>,
    // GROUP_CONCAT(t.name)；無 tag 時為 NULL
    pub(crate) tags: Option<String>,
}

impl PostRow {
    /// DB 可為 NULL，但 API 對外恆為 boolean：NULL → true（對齊舊行為，null 視為允許）。
    pub(crate) fn allow_comments(&self) -> bool {
        self.allow_comments.unwrap_or(true)
    }
}

/// 取某後綴的 (title, content, excerpt) 三元組。
fn i18n_trio<'a>(row: &'a PostRow, sfx: &str) -> (Option<&'a str>, Option<&'a str>, Option<&'a str>) {
    match sfx {
        "en" => (row.title_en.as_deref(), row.content_en.as_deref(), row.excerpt_en.as_deref()),
        "zh_cn" => (row.title_zh_cn.as_deref(), row.content_zh_cn.as_deref(), row.excerpt_zh_cn.as_deref()),
        "ja" => (row.title_ja.as_deref(), row.content_ja.as_deref(), row.excerpt_ja.as_deref()),
        "ko" => (row.title_ko.as_deref(), row.content_ko.as_deref(), row.excerpt_ko.as_deref()),
        _ => (None, None, None),
    }
}

fn source_lang(row: &PostRow) -> &str {
    row.source_language.as_deref().unwrap_or("zh-TW")
}

/// 非空字串才算「有內容」（對齊 JS 的 `!t` truthy 檢查：null 與 '' 都視為無）。
fn nonempty(s: Option<&str>) -> Option<&str> {
    s.filter(|v| !v.is_empty())
}

/// getLocaleContent：回 (title, content, excerpt)；該 locale 無內容回 None。
fn locale_content(row: &PostRow, locale: &str) -> Option<(String, String, String)> {
    let source = source_lang(row);
    if locale == source {
        return Some((row.title.clone(), row.content.clone(), row.excerpt.clone().unwrap_or_default()));
    }
    let sfx = locale_suffix(locale)?;
    let (t, c, e) = i18n_trio(row, sfx);
    let t = nonempty(t)?;
    let c = nonempty(c)?;
    let excerpt = nonempty(e).unwrap_or("").to_string();
    Some((t.to_string(), c.to_string(), excerpt))
}

/// `locale_content` 的 SQL 版：「這篇有沒有該 locale 的內容」，給各種 COUNT 用。
///
/// **必須跟上面的 `locale_content` 同語意**（locale == source 一律算有；其餘要 title 與
/// content 都非空），否則計數會跟列表對不起來：列表 `continue` 掉沒譯文的文章，計數卻照算，
/// 讀者就會看到「分類寫 4 篇、點進去 0 篇」「分頁說有 11 篇卻翻到空白頁」。
///
/// locale 一律先過 `parse_locale`，是白名單裡的 `&'static str`，直接內插無注入風險。
pub(crate) fn locale_available_sql(locale: &str, alias: &str) -> String {
    let is_source = format!("COALESCE({alias}.source_language, 'zh-TW') = '{locale}'");
    match locale_suffix(locale) {
        // zh-TW 是來源語、沒有後綴欄位可查：只有 source_language 相符才算有內容。
        None => format!("({is_source})"),
        Some(sfx) => format!(
            "({is_source} OR (COALESCE({alias}.title_{sfx}, '') <> '' \
             AND COALESCE({alias}.content_{sfx}, '') <> ''))"
        ),
    }
}

/// availableLocales：列出該文實際有內容的 locale（source 永遠在最前）。
fn available_locales(row: &PostRow) -> Vec<String> {
    available_locales_with_source(row, source_lang(row))
}

/// 同上，但 source 由呼叫端給。admin 端點對 source_language 的預設規則跟公開端點不同
/// （admin 會把空字串也視為缺、退回 zh-TW），所以不能共用 `source_lang`。
pub(crate) fn available_locales_with_source(row: &PostRow, source: &str) -> Vec<String> {
    let source = source.to_string();
    let mut list = vec![source.clone()];
    for loc in I18N_LOCALES {
        if loc == source {
            continue;
        }
        if let Some(sfx) = locale_suffix(loc) {
            let (t, c, _) = i18n_trio(row, sfx);
            if nonempty(t).is_some() && nonempty(c).is_some() {
                list.push(loc.to_string());
            }
        }
    }
    list
}

fn split_tags(tags: &Option<String>) -> Vec<String> {
    match tags {
        Some(s) if !s.is_empty() => s.split(',').map(|x| x.to_string()).collect(),
        _ => vec![],
    }
}

// ── GET /api/posts（分頁列表）────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    page: Option<String>,
    limit: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    category: Option<String>,
    status: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
    lang: Option<String>,
}

fn parse_int(s: Option<&str>, default: i64) -> i64 {
    s.and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(default)
}

/// `GET /api/posts` 的單篇摘要。`title`/`excerpt` 已依 `?lang=` 取好該語系內容。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct PostListItem {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub slug: Option<String>,
    pub title: String,
    pub excerpt: String,
    /// 該語系內文的前 260 個 UTF-16 code unit（= JS `content.substring(0,260)`）。
    /// 列表卡片顯示的是內文截斷而非 AI 摘要（見 Blog.tsx NoteCard），但整篇 content
    /// 進列表要多 ~188KB，所以只送前端截斷所需的長度。
    pub content_preview: String,
    pub category: Option<String>,
    pub status: String,
    pub author: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub view_count: i64,
    #[specta(type = specta_typescript::Number)]
    pub likes: i64,
    pub layout_type: Option<String>,
    pub allow_comments: bool,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub source_language: String,
    pub available_locales: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct Pagination {
    #[specta(type = specta_typescript::Number)]
    pub page: i64,
    #[specta(type = specta_typescript::Number)]
    pub limit: i64,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
    #[serde(rename = "totalPages")]
    #[specta(type = specta_typescript::Number)]
    pub total_pages: i64,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct PostsListResponse {
    pub message: String,
    pub posts: Vec<PostListItem>,
    pub locale: Option<String>,
    pub pagination: Pagination,
}

/// `GET /api/posts` —— 公開分頁列表（過濾 / 排序 / 多語）。SQL 與分頁邏輯照抄 Express。
#[utoipa::path(
    get, path = "/api/posts", tag = "posts",
    params(
        ("page" = Option<String>, Query), ("limit" = Option<String>, Query),
        ("sortBy" = Option<String>, Query), ("search" = Option<String>, Query),
        ("tag" = Option<String>, Query), ("category" = Option<String>, Query),
        ("lang" = Option<String>, Query, description = "語系（zh-TW/en/ja/ko/zh-cn）"),
    ),
    responses((status = 200, body = PostsListResponse)),
)]
pub async fn list_posts(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<PostsListResponse>, AppError> {
    let status = q.status.as_deref().unwrap_or("published");
    let page = parse_int(q.page.as_deref(), 1);
    let limit = parse_int(q.limit.as_deref(), 10);
    let offset = (page - 1) * limit;
    let requested_locale = parse_locale(q.lang.as_deref());

    // 動態 WHERE（與 Express 同序：status → search → tag → category）
    let mut sql = String::from(
        "SELECT p.*, GROUP_CONCAT(t.name) as tags \
         FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id \
         WHERE p.status = ?",
    );
    if q.search.is_some() {
        sql.push_str(" AND (p.title LIKE ? OR p.content LIKE ?)");
    }
    if q.tag.is_some() {
        sql.push_str(" AND t.name = ?");
    }
    if q.category.is_some() {
        sql.push_str(" AND p.category = ?");
    }
    sql.push_str(" GROUP BY p.id");
    match q.sort_by.as_deref() {
        Some("oldest") => sql.push_str(" ORDER BY p.created_at ASC"),
        Some("popular") => sql.push_str(" ORDER BY p.view_count DESC, p.created_at DESC"),
        _ => sql.push_str(" ORDER BY p.created_at DESC"),
    }
    sql.push_str(" LIMIT ? OFFSET ?");

    let mut query = sqlx::query_as::<_, PostRow>(sqlx::AssertSqlSafe(sql.as_str())).bind(status);
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        query = query.bind(like.clone()).bind(like);
    }
    if let Some(t) = &q.tag {
        query = query.bind(t.clone());
    }
    if let Some(c) = &q.category {
        query = query.bind(c.clone());
    }
    let rows = query.bind(limit).bind(offset).fetch_all(&state.pool).await?;

    // count 查詢（同樣的 WHERE，無 GROUP BY/排序/分頁）
    let mut count_sql = String::from(
        "SELECT COUNT(DISTINCT p.id) as total \
         FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id \
         WHERE p.status = ?",
    );
    if q.search.is_some() {
        count_sql.push_str(" AND (p.title LIKE ? OR p.content LIKE ?)");
    }
    if q.tag.is_some() {
        count_sql.push_str(" AND t.name = ?");
    }
    if q.category.is_some() {
        count_sql.push_str(" AND p.category = ?");
    }
    // 帶 ?lang= 時列表會把沒該語系譯文的文章 continue 掉（見下面的迴圈），total 也要跟著扣，
    // 否則分頁器會依一個永遠填不滿的數字多開空白頁。沒帶 lang＝取原文，不過濾。
    if let Some(loc) = requested_locale {
        count_sql.push_str(" AND ");
        count_sql.push_str(&locale_available_sql(loc, "p"));
    }
    let mut count_q = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(count_sql.as_str())).bind(status);
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        count_q = count_q.bind(like.clone()).bind(like);
    }
    if let Some(t) = &q.tag {
        count_q = count_q.bind(t.clone());
    }
    if let Some(c) = &q.category {
        count_q = count_q.bind(c.clone());
    }
    let total: i64 = count_q.fetch_one(&state.pool).await?;

    let mut posts = Vec::new();
    for row in &rows {
        let content = match requested_locale {
            Some(loc) => locale_content(row, loc),
            None => Some((row.title.clone(), row.content.clone(), row.excerpt.clone().unwrap_or_default())),
        };
        let Some((title, locale_content_str, excerpt)) = content else {
            continue; // 該語言無翻譯 → 不出現在列表
        };
        posts.push(PostListItem {
            id: row.id,
            slug: row.slug.clone(),
            title,
            excerpt,
            content_preview: crate::util::js_substring_prefix(&locale_content_str, 260),
            category: row.category.clone(),
            status: row.status.clone(),
            author: row.author.clone(),
            view_count: row.view_count,
            likes: row.likes,
            layout_type: row.layout_type.clone(),
            allow_comments: row.allow_comments(),
            created_at: row.created_at.clone(),
            updated_at: row.updated_at.clone(),
            source_language: source_lang(row).to_string(),
            available_locales: available_locales(row),
            tags: split_tags(&row.tags),
        });
    }

    let (resp_total, total_pages) = if requested_locale.is_some() {
        let n = posts.len() as i64;
        (n, if limit > 0 { (n + limit - 1) / limit } else { 0 })
    } else {
        (total, if limit > 0 { (total + limit - 1) / limit } else { 0 })
    };

    Ok(Json(PostsListResponse {
        message: "success".into(),
        posts,
        locale: requested_locale.map(String::from),
        pagination: Pagination { page, limit, total: resp_total, total_pages },
    }))
}

// ── GET /api/posts/:id（單篇）─────────────────────────────────────────────
#[derive(Debug, Deserialize)]
pub struct LangQuery {
    lang: Option<String>,
}

/// `GET /api/posts/:id` 成功回應。欄位序對齊舊 `json!` 的 key 序。
/// 404 路徑（找不到 / 該語系無內容）仍是各自的錯誤 JSON，不走這個型別。
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct PostDetailResponse {
    pub message: String,
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    /// canonical 網址用的 slug；前端拿它把非 canonical 的網址 301 過去。
    pub slug: Option<String>,
    pub title: String,
    pub content: String,
    pub excerpt: String,
    pub category: Option<String>,
    pub status: String,
    pub author: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub view_count: i64,
    #[specta(type = specta_typescript::Number)]
    pub likes: i64,
    pub layout_type: Option<String>,
    pub allow_comments: bool,
    /// 內容格式：'markdown'（預設）| 'mdx'。前端據此選渲染管線。
    pub format: Option<String>,
    pub series_name: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub series_order: Option<i64>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub locale: String,
    pub source_language: String,
    pub is_source: bool,
    pub available_locales: Vec<String>,
    pub tags: Vec<String>,
}

/// `GET /api/posts/:id` —— 公開單篇（多語；找不到 / 該語無內容皆回對應 404）。
#[utoipa::path(
    get, path = "/api/posts/{id}", tag = "posts",
    params(("id" = String, Path), ("lang" = Option<String>, Query, description = "語系")),
    responses((status = 200, body = PostDetailResponse), (status = 404, description = "找不到 / 該語系無內容")),
)]
pub async fn get_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<LangQuery>,
) -> Result<Response, AppError> {
    // 路徑參數可以是 slug、數字 id、或**改名前的舊 slug**（三者都要能進站）：
    //   1) 先當 slug 找 → 2) 純數字就當 id 找 → 3) 查 post_slug_history 的舊 slug。
    // 回應一律帶上目前的 canonical slug，前端據此把非 canonical 的網址 301 過去。
    let row = sqlx::query_as::<_, PostRow>(
        "SELECT p.*, GROUP_CONCAT(t.name) as tags \
         FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id \
         WHERE p.slug = ? \
         GROUP BY p.id",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?;

    let row = match row {
        Some(r) => Some(r),
        None => {
            // 數字 → 當 id；否則查舊 slug 對應的 post_id
            let by_id = id.parse::<i64>().ok();
            let resolved_id = match by_id {
                Some(n) => Some(n),
                None => {
                    sqlx::query_scalar::<_, i64>("SELECT post_id FROM post_slug_history WHERE old_slug = ?")
                        .bind(&id)
                        .fetch_optional(&state.pool)
                        .await?
                }
            };
            match resolved_id {
                Some(n) => {
                    sqlx::query_as::<_, PostRow>(
                        "SELECT p.*, GROUP_CONCAT(t.name) as tags \
                         FROM posts p \
                         LEFT JOIN post_tags pt ON p.id = pt.post_id \
                         LEFT JOIN tags t ON pt.tag_id = t.id \
                         WHERE p.id = ? \
                         GROUP BY p.id",
                    )
                    .bind(n)
                    .fetch_optional(&state.pool)
                    .await?
                }
                None => None,
            }
        }
    };

    let Some(row) = row else {
        // 對齊 Express：404 + {"message":"Post not found"}
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "message": "Post not found" }))).into_response());
    };

    let source = source_lang(&row).to_string();
    let requested = parse_locale(q.lang.as_deref()).unwrap_or(source.as_str());

    let Some((title, content, excerpt)) = locale_content(&row, requested) else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({
                "message": "Post not available in requested locale",
                "locale": requested,
                "available_locales": available_locales(&row),
            })),
        )
            .into_response());
    };

    let is_source = requested == source;
    Ok(Json(PostDetailResponse {
        message: "success".into(),
        slug: row.slug.clone(),
        id: row.id,
        title,
        content,
        excerpt,
        category: row.category.clone(),
        status: row.status.clone(),
        author: row.author.clone(),
        view_count: row.view_count,
        likes: row.likes,
        layout_type: row.layout_type.clone(),
        allow_comments: row.allow_comments(),
        format: row.format.clone(),
        series_name: row.series_name.clone(),
        series_order: row.series_order,
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
        locale: requested.to_string(),
        source_language: source.clone(),
        is_source,
        available_locales: available_locales(&row),
        tags: split_tags(&row.tags),
    })
    .into_response())
}

// ── GET /api/posts/:id/reactions ─────────────────────────────────────────
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct ReactionRow {
    pub emoji: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct ReactionsResponse {
    pub reactions: Vec<ReactionRow>,
}

/// `GET /api/posts/:id/reactions` —— 公開純讀。
#[utoipa::path(
    get, path = "/api/posts/{id}/reactions", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, body = ReactionsResponse)),
)]
pub async fn post_reactions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ReactionsResponse>, AppError> {
    let reactions = sqlx::query_as::<_, ReactionRow>(
        "SELECT emoji, count FROM post_reactions WHERE post_id = ? AND count > 0 ORDER BY count DESC",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(ReactionsResponse { reactions }))
}

// ── GET /api/posts/:id/comments ──────────────────────────────────────────
/// comments 一列。欄位順序對齊 live 表實際 `SELECT *` 展開順序。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct CommentRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    // thought 留言的 post_id 為 NULL（createComment 只填 thought_id）；blog 留言為文章 id。
    // Option 對兩者都正確：Some→數字、None→null。
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
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct CommentsResponse {
    pub message: String,
    pub comments: Vec<CommentRow>,
}

impl CommentsResponse {
    pub fn new(comments: Vec<CommentRow>) -> Self {
        Self { message: "success".into(), comments }
    }
}

/// `GET /api/posts/:id/comments` —— 公開純讀（只列 approved）。
#[utoipa::path(
    get, path = "/api/posts/{id}/comments", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, body = CommentsResponse)),
)]
pub async fn post_comments(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<CommentsResponse>, AppError> {
    let comments = sqlx::query_as::<_, CommentRow>(
        "SELECT id, post_id, author, content, likes, created_at, is_admin, email, website, status, ip, parent_id, avatar_url, thought_id \
         FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(CommentsResponse::new(comments)))
}

// ── 計數寫入（公開）────────────────────────────────────────────────────────
/// `POST /api/posts/:id/view` —— view_count + 1。
#[utoipa::path(
    post, path = "/api/posts/{id}/view", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "瀏覽數 +1（動態 JSON）")),
)]
pub async fn post_view(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match sqlx::query("UPDATE posts SET view_count = view_count + 1 WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "Post not found" }))).into_response()
        }
        Ok(_) => Json(json!({ "message": "success", "view_count_incremented": true })).into_response(),
    }
}

/// 共用：對 posts.likes 做 +1/-1（unlike 限 likes>0），回更新後 likes 或對應 404。
async fn adjust_post_likes(state: &AppState, id: &str, like: bool) -> Response {
    let (sql, not_found) = if like {
        ("UPDATE posts SET likes = likes + 1 WHERE id = ?", "Post not found")
    } else {
        ("UPDATE posts SET likes = likes - 1 WHERE id = ? AND likes > 0", "Post not found or cannot unlike")
    };
    match sqlx::query(sql).bind(id).execute(&state.pool).await {
        Err(e) => return crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            return (StatusCode::NOT_FOUND, Json(json!({ "message": not_found }))).into_response();
        }
        Ok(_) => {}
    }
    match sqlx::query_scalar::<_, i64>("SELECT likes FROM posts WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
    {
        Ok(likes) => Json(json!({ "message": "success", "likes": likes })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `POST /api/posts/:id/like`
#[utoipa::path(
    post, path = "/api/posts/{id}/like", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "文章讚 +1（動態 JSON）")),
)]
pub async fn post_like(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    adjust_post_likes(&state, &id, true).await
}

/// `POST /api/posts/:id/unlike`
#[utoipa::path(
    post, path = "/api/posts/{id}/unlike", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "文章取消讚（動態 JSON）")),
)]
pub async fn post_unlike(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    adjust_post_likes(&state, &id, false).await
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReactionBody {
    emoji: Option<String>,
    delta: Option<i64>,
}

/// `POST /api/posts/:id/reactions` —— emoji 反應 upsert（clamp 0）。
#[utoipa::path(
    post, path = "/api/posts/{id}/reactions", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "emoji 反應 upsert（動態 JSON）")),
)]
pub async fn post_reaction(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ReactionBody>,
) -> Response {
    const ALLOWED: [&str; 6] = ["👍", "❤️", "🎉", "🚀", "🤔", "😂"];
    let emoji = body.emoji.unwrap_or_default();
    if !ALLOWED.contains(&emoji.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid emoji" }))).into_response();
    }
    let d: i64 = if body.delta == Some(-1) { -1 } else { 1 };
    if let Err(e) = sqlx::query(
        "INSERT INTO post_reactions (post_id, emoji, count, updated_at) \
         VALUES (?, ?, MAX(0, ?), datetime('now')) \
         ON CONFLICT(post_id, emoji) DO UPDATE SET count = MAX(0, count + ?), updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(&emoji)
    .bind(d)
    .bind(d)
    .execute(&state.pool)
    .await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let count =
        sqlx::query_scalar::<_, i64>("SELECT count FROM post_reactions WHERE post_id = ? AND emoji = ?")
            .bind(&id)
            .bind(&emoji)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
    Json(json!({ "emoji": emoji, "count": count })).into_response()
}

/// `POST /api/comments/:id/like` —— comments.likes + 1。
#[utoipa::path(
    post, path = "/api/comments/{id}/like", tag = "posts",
    params(("id" = String, Path)),
    responses((status = 200, description = "留言讚 +1（動態 JSON）")),
)]
pub async fn comment_like(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match sqlx::query("UPDATE comments SET likes = likes + 1 WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Err(e) => return crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            return (StatusCode::NOT_FOUND, Json(json!({ "message": "Comment not found" }))).into_response();
        }
        Ok(_) => {}
    }
    match sqlx::query_scalar::<_, i64>("SELECT likes FROM comments WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await
    {
        Ok(likes) => Json(json!({ "message": "success", "likes": likes })).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

// ════════════════ posts 寫入（/posts 路徑；requireAdmin / basicAuth）════════════════
use serde_json::{Map, Value};

use crate::auth::require_admin;
use crate::handlers::admin::manage_tags;
use crate::util::js_truthy;

/// body.tags → Vec<String>（非陣列/缺 → 空；供 manageTags）。
fn tags_vec(b: &Map<String, Value>) -> Vec<String> {
    b.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn v_to_s(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(crate::util::js_interp(other)),
    }
}

/// `POST /api/posts`（requireAdmin）—— 簡版建文（無 i18n）。錯誤回 **400**（對齊 Express 此端點）。
#[utoipa::path(
    post, path = "/api/posts", tag = "posts", security(("bearer" = [])),
    responses((status = 200, description = "建立文章（動態 JSON）"), (status = 401, description = "未授權")),
)]
pub async fn create_post_public(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    if !js_truthy(b.get("title")) || !js_truthy(b.get("content")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing required fields: title, content" })),
        )
            .into_response();
    }
    let status =
        if b.contains_key("status") { b.get("status").and_then(v_to_s) } else { Some("draft".into()) };
    let layout = if b.contains_key("layout_type") {
        b.get("layout_type").and_then(v_to_s)
    } else {
        Some("record".into())
    };
    let r = sqlx::query(
        "INSERT INTO posts (title, content, excerpt, category, status, author, layout_type, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    )
    .bind(b.get("title").and_then(v_to_s))
    .bind(b.get("content").and_then(v_to_s))
    .bind(b.get("excerpt").and_then(v_to_s))
    .bind(b.get("category").filter(|v| js_truthy(Some(v))).and_then(v_to_s))
    .bind(&status)
    .bind("Koimsurai")
    .bind(&layout)
    .execute(&state.pool)
    .await;
    let post_id = match r {
        Ok(r) => r.last_insert_rowid(),
        Err(e) => return crate::error::internal_error(StatusCode::BAD_REQUEST, e),
    };
    let tags = tags_vec(&b);
    if let Err(e) = manage_tags(&state, &post_id.to_string(), &tags).await {
        return crate::error::internal_error(StatusCode::BAD_REQUEST, e);
    }
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
    data.insert("tags".into(), b.get("tags").cloned().unwrap_or_else(|| json!([])));
    data.insert("status".into(), b.get("status").cloned().unwrap_or_else(|| json!("draft")));
    (StatusCode::CREATED, Json(json!({ "message": "success", "data": Value::Object(data) }))).into_response()
}

/// `PUT /api/posts/:id`（requireAdmin）—— 6 欄 COALESCE（**category 也 COALESCE**，與 admin 版不同）。
#[utoipa::path(
    put, path = "/api/posts/{id}", tag = "posts", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "更新文章（動態 JSON）"), (status = 401, description = "未授權")),
)]
pub async fn update_post_public(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let r = sqlx::query(
        "UPDATE posts SET title = COALESCE(?, title), content = COALESCE(?, content), \
         excerpt = COALESCE(?, excerpt), category = COALESCE(?, category), status = COALESCE(?, status), \
         layout_type = COALESCE(?, layout_type), updated_at = datetime('now') WHERE id = ?",
    )
    .bind(b.get("title").and_then(v_to_s))
    .bind(b.get("content").and_then(v_to_s))
    .bind(b.get("excerpt").and_then(v_to_s))
    .bind(b.get("category").and_then(v_to_s))
    .bind(b.get("status").and_then(v_to_s))
    .bind(b.get("layout_type").and_then(v_to_s))
    .bind(&id)
    .execute(&state.pool)
    .await;
    let changes = match r {
        Ok(r) => r.rows_affected(),
        Err(e) => return crate::error::internal_error(StatusCode::BAD_REQUEST, e),
    };
    if changes == 0 {
        return (StatusCode::NOT_FOUND, Json(json!({ "message": "Post not found" }))).into_response();
    }
    let tags = tags_vec(&b);
    if let Err(e) = manage_tags(&state, &id, &tags).await {
        return crate::error::internal_error(StatusCode::BAD_REQUEST, e);
    }
    Json(json!({ "message": "success", "changes": changes })).into_response()
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct StatusBody {
    status: Option<String>,
}

/// `PATCH /api/posts/:id/status`（requireAdmin）—— 僅 published|draft。
#[utoipa::path(
    patch, path = "/api/posts/{id}/status", tag = "posts", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "更新文章狀態（動態 JSON）"), (status = 401, description = "未授權")),
)]
pub async fn patch_post_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(b): Json<StatusBody>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    let status = b.status.unwrap_or_default();
    if status != "published" && status != "draft" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "無效的狀態值，必須是 published 或 draft" })),
        )
            .into_response();
    }
    match sqlx::query("UPDATE posts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&status)
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "找不到文章" }))).into_response()
        }
        Ok(r) => Json(json!({ "message": "狀態更新成功", "status": status, "changes": r.rows_affected() }))
            .into_response(),
    }
}

/// `DELETE /api/posts/:id`（requireAdmin）—— post_tags 先清（錯 500），posts 刪（錯 400）。
#[utoipa::path(
    delete, path = "/api/posts/{id}", tag = "posts", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "刪除文章（動態 JSON）"), (status = 401, description = "未授權")),
)]
pub async fn delete_post_public(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
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
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "Post not found" }))).into_response()
        }
        Ok(r) => Json(json!({ "message": "deleted", "changes": r.rows_affected() })).into_response(),
    }
}

/// `POST /api/posts/legacy`（**basicAuth**）—— 舊匯入端點。
#[utoipa::path(
    post, path = "/api/posts/legacy", tag = "posts", security(("bearer" = [])),
    responses((status = 200, description = "舊匯入建文（動態 JSON）"), (status = 401, description = "未授權")),
)]
pub async fn create_post_legacy(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(b): Json<Map<String, Value>>,
) -> Response {
    if let Some(resp) = crate::auth::basic_auth_check(&headers) {
        return resp;
    }
    if !js_truthy(b.get("title")) || !js_truthy(b.get("content")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing required fields: title, content" })),
        )
            .into_response();
    }
    let author =
        b.get("author").filter(|v| js_truthy(Some(v))).and_then(v_to_s).unwrap_or_else(|| "Koimsurai".into());
    match sqlx::query(
        "INSERT INTO posts (title, content, status, author, created_at, updated_at) \
         VALUES (?, ?, 'published', ?, datetime('now'), datetime('now'))",
    )
    .bind(b.get("title").and_then(v_to_s))
    .bind(b.get("content").and_then(v_to_s))
    .bind(&author)
    .execute(&state.pool)
    .await
    {
        Err(e) => crate::error::internal_error(StatusCode::BAD_REQUEST, e),
        Ok(r) => {
            // {id: lastID, ...req.body}
            let mut data = Map::new();
            data.insert("id".into(), json!(r.last_insert_rowid()));
            for (k, v) in &b {
                data.insert(k.clone(), v.clone());
            }
            (StatusCode::CREATED, Json(json!({ "message": "success", "data": Value::Object(data) })))
                .into_response()
        }
    }
}
