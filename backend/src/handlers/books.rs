use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::FromRow;

use crate::state::AppState;
use crate::{
    auth::require_admin,
    util::{bind_val, js_num_value, js_parse_int_opt, js_truthy},
};

/// books 一列（`SELECT *`）。欄位序 = books 表宣告序，對齊舊 `row_to_json` 的 key 序。
#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct BookRow {
    #[specta(type = specta_typescript::Number)]
    pub id: i64,
    pub isbn: Option<String>,
    pub title: String,
    pub authors: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub page_count: Option<i64>,
    pub language: Option<String>,
    pub categories: Option<String>,
    pub reading_status: Option<String>,
    // REAL：整值輸出整數（4.0 → 4，對齊舊 row_to_json 的 js_num_value；4.1 等維持 float）。
    #[serde(serialize_with = "serialize_rating")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub rating: Option<f64>,
    pub personal_notes: Option<String>,
    pub date_added: Option<String>,
    pub date_updated: Option<String>,
    pub date_started: Option<String>,
    pub date_finished: Option<String>,
}

/// rating（REAL）序列化：整值 float → 整數（`4.0`→`4`），非整值維持 float，None → null。
/// 對齊舊 `row_to_json` 對 REAL 欄位走 `js_num_value` 的行為。
fn serialize_rating<S: serde::Serializer>(v: &Option<f64>, s: S) -> Result<S::Ok, S::Error> {
    match v {
        None => s.serialize_none(),
        Some(f) => js_num_value(*f).serialize(s),
    }
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct BooksListResponse {
    pub message: String,
    pub books: Vec<BookRow>,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct BookDetailResponse {
    pub message: String,
    pub book: BookRow,
}

#[derive(Debug, Deserialize)]
pub struct BooksQuery {
    status: Option<String>,
    rating: Option<String>,
    year: Option<String>,
    search: Option<String>,
    #[serde(rename = "sortBy")]
    sort_by: Option<String>,
}

/// 共用查詢（/books 與 /admin/books 完全同邏輯，只差回應形狀）。
async fn query_books(state: &AppState, q: &BooksQuery) -> Result<Vec<BookRow>, sqlx::Error> {
    let mut sql = String::from("SELECT * FROM books WHERE 1=1");
    if q.status.is_some() {
        sql.push_str(" AND reading_status = ?");
    }
    if q.rating.is_some() {
        sql.push_str(" AND rating = ?");
    }
    if q.year.is_some() {
        sql.push_str(" AND published_date LIKE ?");
    }
    if q.search.is_some() {
        sql.push_str(" AND (title LIKE ? OR authors LIKE ?)");
    }
    sql.push_str(match q.sort_by.as_deref() {
        Some("date_added_asc") => " ORDER BY date_added ASC",
        Some("title_asc") => " ORDER BY title ASC",
        Some("title_desc") => " ORDER BY title DESC",
        Some("rating_desc") => " ORDER BY rating DESC, date_added DESC",
        Some("published_date_desc") => " ORDER BY published_date DESC",
        _ => " ORDER BY date_added DESC",
    });

    let mut query = sqlx::query_as::<_, BookRow>(sqlx::AssertSqlSafe(sql.as_str()));
    if let Some(s) = &q.status {
        query = query.bind(s.clone());
    }
    if let Some(r) = &q.rating {
        // Express: parseInt(rating)；NaN → 綁 NULL
        query = match js_parse_int_opt(r) {
            Some(i) => query.bind(i),
            None => query.bind(Option::<i64>::None),
        };
    }
    if let Some(y) = &q.year {
        query = query.bind(format!("{y}%"));
    }
    if let Some(s) = &q.search {
        let like = format!("%{s}%");
        query = query.bind(like.clone()).bind(like);
    }
    query.fetch_all(&state.pool).await
}

/// `GET /api/books` —— 公開列表，`{message, books}`。
#[utoipa::path(get, path = "/api/books", tag = "books", responses((status = 200, body = BooksListResponse)))]
pub async fn list_books(State(state): State<AppState>, Query(q): Query<BooksQuery>) -> Response {
    match query_books(&state, &q).await {
        Ok(books) => Json(BooksListResponse { message: "success".into(), books }).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `GET /api/admin/books` —— requireAdmin，**裸陣列**。
#[utoipa::path(get, path = "/api/admin/books", tag = "admin", security(("bearer" = [])),
    responses((status = 200, body = Vec<BookRow>), (status = 401, description = "未授權")))]
pub async fn admin_books(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<BooksQuery>,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    match query_books(&state, &q).await {
        Ok(books) => Json(books).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `GET /api/books/:id` —— 公開單本，`{message, book}`；404 `{message:'Book not found'}`。
#[utoipa::path(get, path = "/api/books/{id}", tag = "books",
    params(("id" = String, Path)),
    responses((status = 200, body = BookDetailResponse)))]
pub async fn get_book(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match sqlx::query_as::<_, BookRow>("SELECT * FROM books WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
    {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({ "message": "Book not found" }))).into_response(),
        Ok(Some(book)) => Json(BookDetailResponse { message: "success".into(), book }).into_response(),
    }
}

/// POST/PUT 共用的 13/15 個欄位鍵名。
const BOOK_FIELDS: [&str; 13] = [
    "isbn",
    "title",
    "authors",
    "publisher",
    "published_date",
    "description",
    "cover_url",
    "page_count",
    "language",
    "categories",
    "reading_status",
    "rating",
    "personal_notes",
];

/// `POST /api/books`（requireAdmin）—— 建書。回應 `{message, book:{id, ...req.body}}`（spread 原 body）。
#[utoipa::path(post, path = "/api/books", tag = "books", security(("bearer" = [])),
    responses((status = 200, description = "建立書籍（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn create_book(
    State(state): State<AppState>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(body): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    if !js_truthy(body.get("title")) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "書名為必填欄位" }))).into_response();
    }
    let mut q = sqlx::query(
        "INSERT INTO books (isbn, title, authors, publisher, published_date, description, \
         cover_url, page_count, language, categories, reading_status, rating, personal_notes, \
         date_added, date_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    );
    for k in BOOK_FIELDS {
        // reading_status 缺 key → 'to-read'（destructure default，null 不觸發）
        if k == "reading_status" && !body.contains_key(k) {
            q = q.bind("to-read");
        } else {
            q = bind_val(q, body.get(k));
        }
    }
    match q.execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(r) => {
            // {id: lastID, ...req.body}：body 的 key 覆寫值、id 位置保持最前
            let mut book = Map::new();
            book.insert("id".into(), json!(r.last_insert_rowid()));
            for (k, v) in &body {
                book.insert(k.clone(), v.clone());
            }
            (StatusCode::CREATED, Json(json!({ "message": "success", "book": Value::Object(book) })))
                .into_response()
        }
    }
}

/// `PUT /api/books/:id`（requireAdmin）—— 15 欄全 COALESCE（缺/null → 保留舊值）。
#[utoipa::path(put, path = "/api/books/{id}", tag = "books", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "更新書籍（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn update_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _auth: crate::auth::AdminAuth,
    crate::error::JsonBody(body): crate::error::JsonBody<Map<String, Value>>,
) -> Response {
    let mut q = sqlx::query(
        "UPDATE books SET \
         isbn = COALESCE(?, isbn), title = COALESCE(?, title), authors = COALESCE(?, authors), \
         publisher = COALESCE(?, publisher), published_date = COALESCE(?, published_date), \
         description = COALESCE(?, description), cover_url = COALESCE(?, cover_url), \
         page_count = COALESCE(?, page_count), language = COALESCE(?, language), \
         categories = COALESCE(?, categories), reading_status = COALESCE(?, reading_status), \
         rating = COALESCE(?, rating), personal_notes = COALESCE(?, personal_notes), \
         date_started = COALESCE(?, date_started), date_finished = COALESCE(?, date_finished), \
         date_updated = datetime('now') WHERE id = ?",
    );
    for k in BOOK_FIELDS {
        q = bind_val(q, body.get(k));
    }
    q = bind_val(q, body.get("date_started"));
    q = bind_val(q, body.get("date_finished"));
    q = q.bind(&id);
    match q.execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "Book not found" }))).into_response()
        }
        Ok(r) => Json(json!({ "message": "success", "changes": r.rows_affected() })).into_response(),
    }
}

/// `DELETE /api/books/:id`（requireAdmin）。
#[utoipa::path(delete, path = "/api/books/{id}", tag = "books", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "刪除書籍（動態 JSON）"), (status = 401, description = "未授權")))]
pub async fn delete_book(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    match sqlx::query("DELETE FROM books WHERE id = ?").bind(&id).execute(&state.pool).await {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(r) if r.rows_affected() == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "message": "Book not found" }))).into_response()
        }
        Ok(r) => Json(json!({ "message": "deleted", "changes": r.rows_affected() })).into_response(),
    }
}

/// `GET /api/books/stats/summary` —— 公開統計。
/// average_rating：truthy 才 toFixed(1)+parseFloat（0/null → null）；整值輸出整數。
#[utoipa::path(get, path = "/api/books/stats/summary", tag = "books",
    responses((status = 200, description = "書籍統計摘要（動態 JSON）")))]
pub async fn book_stats(State(state): State<AppState>) -> Response {
    let row = sqlx::query_as::<_, (i64, i64, i64, i64, Option<f64>, Option<i64>)>(
        "SELECT COUNT(*) as total_books, \
         COUNT(CASE WHEN reading_status = 'read' THEN 1 END) as books_read, \
         COUNT(CASE WHEN reading_status = 'reading' THEN 1 END) as books_reading, \
         COUNT(CASE WHEN reading_status = 'to-read' THEN 1 END) as books_to_read, \
         AVG(CASE WHEN rating IS NOT NULL THEN rating END) as average_rating, \
         SUM(CASE WHEN page_count IS NOT NULL THEN page_count ELSE 0 END) as total_pages FROM books",
    )
    .fetch_one(&state.pool)
    .await;
    match row {
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok((total, read, reading, to_read, avg, pages)) => {
            let average_rating = match avg {
                Some(v) if v != 0.0 => {
                    // toFixed(1)（半數遠離零）再 parseFloat
                    let r = (v * 10.0).round() / 10.0;
                    js_num_value(r)
                }
                _ => Value::Null,
            };
            Json(json!({
                "message": "success",
                "stats": {
                    "total_books": total,
                    "books_read": read,
                    "books_reading": reading,
                    "books_to_read": to_read,
                    "average_rating": average_rating,
                    "total_pages": pages,
                }
            }))
            .into_response()
        }
    }
}
