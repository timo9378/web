//! 前端 Core Web Vitals 收集（ROADMAP B4）。
//!
//! 哲學：量測用 Google 官方 `web-vitals` lib（業界標準實作），**收集與儲存在自己家**
//! （此端點 + SQLite），不碰 GA4。GlitchTip 收 error/後端 perf，這裡補前端 CWV 缺口。
//!
//! - `POST /api/vitals`：client sendBeacon 上報（無 auth——公開 beacon；嚴格白名單驗證
//!   + 值域夾制防垃圾；機器層濫用由 CrowdSec 兜）。不存 IP/UA 等 PII。
//! - `GET /api/vitals/stats`：聚合自看（各 metric 的 count/p75/rating 分佈，近 N 天）。
//!
//! 資料表 `web_vitals` 由 main.rs 啟動時 CREATE TABLE IF NOT EXISTS（本 repo 無
//! migration 框架，schema 為 Express 時代手建；新表沿用冪等建表慣例）。

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{error::AppError, state::AppState};

const METRICS: [&str; 5] = ["LCP", "CLS", "INP", "FCP", "TTFB"];
const RATINGS: [&str; 3] = ["good", "needs-improvement", "poor"];

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct VitalBeacon {
    pub metric: String,
    pub value: f64,
    pub rating: String,
    pub path: String,
    #[serde(default, rename = "isMobile")]
    pub is_mobile: bool,
}

/// `POST /api/vitals` —— 單筆 beacon 寫入。驗證失敗一律 204（beacon 無人讀回應，
/// 不給探測者回饋面）；只有格式錯到解不開才 4xx（axum Json extractor 層）。
#[utoipa::path(post, path = "/api/vitals", tag = "misc",
    responses((status = 204, description = "已接收（驗證失敗也回 204，不給探測回饋）")))]
pub async fn report_vital(
    State(state): State<AppState>,
    Json(b): Json<VitalBeacon>,
) -> Result<StatusCode, AppError> {
    // 白名單 + 值域夾制（CLS 無單位通常 <1，其餘毫秒；120s 上限擋垃圾）
    let valid = METRICS.contains(&b.metric.as_str())
        && RATINGS.contains(&b.rating.as_str())
        && b.value.is_finite()
        && b.value >= 0.0
        && b.value <= 120_000.0
        && b.path.starts_with('/')
        && b.path.len() <= 200;
    if valid {
        // path 去掉 query（避免存到 token 類參數；beacon 端也已只送 pathname，此為第二道）
        let path = b.path.split('?').next().unwrap_or("/");
        sqlx::query("INSERT INTO web_vitals (metric, value, rating, path, is_mobile) VALUES (?, ?, ?, ?, ?)")
            .bind(&b.metric)
            .bind(b.value)
            .bind(&b.rating)
            .bind(path)
            .bind(if b.is_mobile { 1i64 } else { 0 })
            .execute(&state.pool)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    /// 統計視窗（天），預設 7、上限 90
    pub days: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct MetricStat {
    pub metric: String,
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
    pub p75: Option<f64>,
    #[specta(type = specta_typescript::Number)]
    pub good: i64,
    #[specta(type = specta_typescript::Number)]
    pub needs_improvement: i64,
    #[specta(type = specta_typescript::Number)]
    pub poor: i64,
}

/// `GET /api/vitals/stats` —— 各 metric 聚合（count / p75 / rating 分佈）。
/// 純聚合無 PII，公開讀（同 site_stats 慣例）。p75 用 ORDER BY + OFFSET（SQLite 無
/// percentile 函數；每 metric 一小查詢，五個 metric 規模下無感）。
#[utoipa::path(get, path = "/api/vitals/stats", tag = "misc",
    responses((status = 200, description = "各 metric 聚合統計（動態 JSON）")))]
pub async fn vitals_stats(
    State(state): State<AppState>,
    Query(q): Query<StatsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let days = q.days.unwrap_or(7).clamp(1, 90);
    let since = format!("-{days} days");
    let mut out = Vec::with_capacity(METRICS.len());
    for m in METRICS {
        let (count, good, ni, poor): (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), \
               COALESCE(SUM(rating = 'good'), 0), \
               COALESCE(SUM(rating = 'needs-improvement'), 0), \
               COALESCE(SUM(rating = 'poor'), 0) \
             FROM web_vitals WHERE metric = ? AND created_at >= datetime('now', ?)",
        )
        .bind(m)
        .bind(&since)
        .fetch_one(&state.pool)
        .await?;
        let p75: Option<f64> = if count > 0 {
            sqlx::query_scalar(
                "SELECT value FROM web_vitals WHERE metric = ? AND created_at >= datetime('now', ?) \
                 ORDER BY value LIMIT 1 OFFSET ?",
            )
            .bind(m)
            .bind(&since)
            .bind((count * 75 / 100).min(count - 1))
            .fetch_optional(&state.pool)
            .await?
        } else {
            None
        };
        out.push(MetricStat { metric: m.to_string(), count, p75, good, needs_improvement: ni, poor });
    }
    Ok(Json(json!({ "message": "success", "days": days, "metrics": out })))
}
