//! 文章內嵌投票（MDX `<Poll>`）。只存聚合票數，不存投票者：
//! 防重複投票在 client 端以 localStorage 做（與站上 reactions 同策略，不收 IP）。
//!
//! - `GET  /api/polls/{id}`      —— 公開純讀，回各選項票數 + 總數
//! - `POST /api/polls/{id}/vote` —— 公開投票（body `{ "option": "..." }`），回更新後票數
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use crate::state::AppState;

/// 選項鍵 / poll id 的長度上限（避免任意長字串灌爆表）。
const MAX_KEY_LEN: usize = 64;
/// 單一投票最多容納的選項數：超過就不再接受「新」選項（既有選項仍可投）。
/// 選項由作者在文章裡定義，正常不會多；這是防止有人用亂數 option 灌列的上限。
const MAX_OPTIONS_PER_POLL: i64 = 20;

#[derive(Debug, Serialize, FromRow, specta::Type, utoipa::ToSchema)]
pub struct PollOptionRow {
    pub option_key: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
}

#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct PollResponse {
    pub options: Vec<PollOptionRow>,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct VoteBody {
    pub option: Option<String>,
}

async fn load_poll(state: &AppState, id: &str) -> Result<PollResponse, sqlx::Error> {
    let options = sqlx::query_as::<_, PollOptionRow>(
        "SELECT option_key, count FROM poll_votes WHERE poll_id = ? ORDER BY count DESC, option_key ASC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let total = options.iter().map(|o| o.count).sum();
    Ok(PollResponse { options, total })
}

/// `GET /api/polls/:id` —— 公開純讀。未有人投過就回空清單（total 0）。
#[utoipa::path(
    get, path = "/api/polls/{id}", tag = "polls",
    params(("id" = String, Path)),
    responses((status = 200, body = PollResponse)),
)]
pub async fn get_poll(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match load_poll(&state, &id).await {
        Ok(p) => Json(p).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

/// `POST /api/polls/:id/vote` —— 公開投票，票數 +1 後回最新結果。
#[utoipa::path(
    post, path = "/api/polls/{id}/vote", tag = "polls",
    params(("id" = String, Path)),
    responses((status = 200, body = PollResponse), (status = 400, description = "選項不合法")),
)]
pub async fn vote_poll(
    State(state): State<AppState>,
    Path(id): Path<String>,
    crate::error::JsonBody(body): crate::error::JsonBody<VoteBody>,
) -> Response {
    let option = body.option.unwrap_or_default();
    let option = option.trim();
    if id.is_empty() || id.len() > MAX_KEY_LEN || option.is_empty() || option.len() > MAX_KEY_LEN {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid poll id or option" })))
            .into_response();
    }

    // 新選項才受選項數上限約束（既有選項一律放行）。
    let existing =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM poll_votes WHERE poll_id = ? AND option_key <> ?")
            .bind(&id)
            .bind(option)
            .fetch_one(&state.pool)
            .await;
    match existing {
        Ok(n) if n >= MAX_OPTIONS_PER_POLL => {
            let is_known = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM poll_votes WHERE poll_id = ? AND option_key = ?",
            )
            .bind(&id)
            .bind(option)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0);
            if is_known == 0 {
                return (StatusCode::BAD_REQUEST, Json(json!({ "error": "too many options" })))
                    .into_response();
            }
        }
        Ok(_) => {}
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }

    if let Err(e) = sqlx::query(
        "INSERT INTO poll_votes (poll_id, option_key, count, updated_at) VALUES (?, ?, 1, datetime('now')) \
         ON CONFLICT(poll_id, option_key) DO UPDATE SET count = count + 1, updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(option)
    .execute(&state.pool)
    .await
    {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    match load_poll(&state, &id).await {
        Ok(p) => Json(p).into_response(),
        Err(e) => crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}
