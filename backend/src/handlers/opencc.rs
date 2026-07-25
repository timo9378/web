//! OpenCC 簡繁轉換（硬骨頭）。移植 Express `index.js` 的 `/admin/posts/:id/generate-zh-cn`
//! ——把 zh-TW 原文（title/content/excerpt）以 OpenCC `tw2s`（繁台→簡）轉為 zh-CN 存回。
//!
//! Express 用 `opencc-js` 的 `Converter({from:'tw', to:'cn'})`。改用純 Rust `ferrous-opencc`
//! 的 `BuiltinConfig::Tw2s`：對 opencc-js 同輸入實測 **byte-identical**（33 真實文章欄位
//! + 20 對抗案例含 著作/著手 語境消歧、臺/台、隻/只 全一致），故可 byte-level A/B 對拍。
//!
//! `/quote/daily` 也用 opencc（cn→tw），但因外部隨機名言來源 + 每日快取狀態刻意留 proxy。

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use ferrous_opencc::{OpenCC, config::BuiltinConfig};
use serde_json::json;
use tokio::sync::OnceCell;

use crate::{auth::require_admin, state::AppState};

/// 進程級單例：`Tw2s` 轉換器建構（載入內建字典 → FST）較重，一次性建好共用。
/// 首次使用才建（admin-only、罕用，不拖慢啟動），且在 blocking 池建避免卡 async worker。
static TW2S: OnceCell<Arc<OpenCC>> = OnceCell::const_new();

async fn tw2s() -> anyhow::Result<Arc<OpenCC>> {
    TW2S.get_or_try_init(|| async {
        tokio::task::spawn_blocking(|| OpenCC::from_config(BuiltinConfig::Tw2s).map(Arc::new))
            .await
            .map_err(|e| anyhow::anyhow!("opencc 建構 join 失敗: {e}"))?
            .map_err(|e| anyhow::anyhow!("opencc 載入 tw2s 失敗: {e}"))
    })
    .await
    .cloned()
}

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

/// `POST /api/admin/posts/:id/generate-zh-cn` —— requireAdmin。
#[utoipa::path(post, path = "/api/admin/posts/{id}/generate-zh-cn", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "zh-CN 轉換結果（動態 JSON）"), (status = 400, description = "來源語言非 zh-TW 或缺 title/content"), (status = 401, description = "未授權"), (status = 404, description = "文章不存在"), (status = 500, description = "OpenCC 轉換或 DB 失敗")))]
pub async fn generate_zh_cn(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    // 對齊 Express：SELECT * 後只讀這幾欄
    let row = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, Option<String>)>(
        "SELECT source_language, title, content, excerpt FROM posts WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await;
    let (source_language, title, content, excerpt) = match row {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => return err(StatusCode::NOT_FOUND, "文章不存在"),
        Ok(Some(r)) => r,
    };

    // source_language || 'zh-TW'；非 zh-TW → 400
    let source = source_language.filter(|s| !s.is_empty()).unwrap_or_else(|| "zh-TW".into());
    if source != "zh-TW" {
        return err(StatusCode::BAD_REQUEST, "只能從 zh-TW 原文自動轉换為 zh-CN");
    }
    // !title || !content（含空字串）→ 400
    let title = title.filter(|s| !s.is_empty());
    let content = content.filter(|s| !s.is_empty());
    let (Some(title), Some(content)) = (title, content) else {
        return err(StatusCode::BAD_REQUEST, "原文缺少 title 或 content");
    };
    // excerpt ? t2s(excerpt) : null（空字串也視為無）
    let excerpt = excerpt.filter(|s| !s.is_empty());

    let cc = match tw2s().await {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("OpenCC 轉换失敗: {e}")),
    };
    // 轉換為 CPU 工作（content 可達數十 KB）→ 丟 blocking 池，不卡 async worker
    let converted = tokio::task::spawn_blocking(move || {
        let title_zh_cn = cc.convert(&title);
        let content_zh_cn = cc.convert(&content);
        let excerpt_zh_cn = excerpt.map(|e| cc.convert(&e));
        (title_zh_cn, content_zh_cn, excerpt_zh_cn)
    })
    .await;
    let (title_zh_cn, content_zh_cn, excerpt_zh_cn) = match converted {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("OpenCC 轉换失敗: {e}")),
    };

    let upd = sqlx::query(
        "UPDATE posts SET title_zh_cn = ?, content_zh_cn = ?, excerpt_zh_cn = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&title_zh_cn)
    .bind(&content_zh_cn)
    .bind(&excerpt_zh_cn)
    .bind(&id)
    .execute(&state.pool)
    .await;
    if let Err(e) = upd {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    Json(json!({
        "message": "success",
        "title_zh_cn": title_zh_cn,
        "content_zh_cn": content_zh_cn,
        "excerpt_zh_cn": excerpt_zh_cn,
    }))
    .into_response()
}
