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

// ⚠ 下面 vitals_stats 的兩句 SQL 都帶 `path <> '/admin' AND path NOT LIKE '/admin/%'`，
// 改動時**兩句要一起改**——count 與 p75 必須落在同一個母體上（OFFSET 是用 count 算的）。
//
// 沒有抽成 const 再 format! 進去，是因為 sqlx 這版的 `SqlSafeStr` 只收 `&'static str`：
// 執行期 String 得包 `AssertSqlSafe` 才過，那反而是把編譯期保證換成人工審查。條件是死的，
// 寫兩次比繞過檢查划算。
//
// 為什麼排除後台：/admin 有 auth、robots.txt 也 Disallow，不是讀者體驗的一部分；編輯器
// （大量 textarea + 即時預覽）天生會位移，實測 p75=0.173、93% 超標，一個人在編輯就足以
// 主導全站數字。beacon 端（src/lib/reportWebVitals.ts）已不再上報，這裡再擋一次是為了讓
// **既有的歷史資料**也立刻退出視窗，不必等 90 天滾完。

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct VitalBeacon {
    pub metric: String,
    pub value: f64,
    pub rating: String,
    pub path: String,
    #[serde(default, rename = "isMobile")]
    pub is_mobile: bool,
    /// CLS 歸因：那次最大位移元素的 CSS 選擇器（web-vitals 的 largestShiftTarget）。
    /// 只有 CLS 會帶，其餘 metric 為 None。
    #[serde(default)]
    pub target: Option<String>,
    /// 位移發生時頁面處於哪個載入階段（loading / dom-interactive / complete…）。
    /// 用來分辨「首次繪製前後」——complete 階段的位移多半是捲動觸發的延遲載入。
    #[serde(default, rename = "loadState")]
    pub load_state: Option<String>,
    /// 最大那次位移發生時讀者在哪一頁。CLS 在 SPA 裡累加整個 page lifecycle，`path` 記的是
    /// 離開時的位置——兩者不同時，該修的是這一欄指的頁面。
    #[serde(default, rename = "shiftPath")]
    pub shift_path: Option<String>,
}

/// 歸因欄位的長度上限。選擇器可以很長（html>body>div#root>…），但超過這個長度就不是
/// 有用的資訊而是垃圾/攻擊面了。截斷而不是丟棄——前綴已經足夠指認元件。
const MAX_TARGET_LEN: usize = 200;

fn clamp_attr(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty()).map(|mut v| {
        // char_indices 而非 truncate(200)：直接切 byte 會切爛多位元組字元
        if let Some((i, _)) = v.char_indices().nth(MAX_TARGET_LEN) {
            v.truncate(i);
        }
        v
    })
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
        sqlx::query(
            "INSERT INTO web_vitals \
               (metric, value, rating, path, is_mobile, target, load_state, shift_path) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&b.metric)
        .bind(b.value)
        .bind(&b.rating)
        .bind(path)
        .bind(if b.is_mobile { 1i64 } else { 0 })
        .bind(clamp_attr(b.target))
        .bind(clamp_attr(b.load_state))
        // shift_path 也去掉 query（同 path 的理由：避免存到 token 類參數）
        .bind(clamp_attr(b.shift_path.map(|s| s.split('?').next().unwrap_or("/").to_string())))
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
             FROM web_vitals WHERE metric = ? AND created_at >= datetime('now', ?) \
               AND path <> '/admin' AND path NOT LIKE '/admin/%'",
        )
        .bind(m)
        .bind(&since)
        .fetch_one(&state.pool)
        .await?;
        let p75: Option<f64> = if count > 0 {
            sqlx::query_scalar(
                "SELECT value FROM web_vitals WHERE metric = ? AND created_at >= datetime('now', ?) \
                   AND path <> '/admin' AND path NOT LIKE '/admin/%' \
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
