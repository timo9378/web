//! 公開讀取端點的**回應形狀**快照。
//!
//! ## 為什麼是快照而不是手寫斷言
//!
//! 這批端點（rss / series / books / polls / watch）的回應是幾十個欄位的巢狀結構，
//! 手寫斷言的實際結果是「挑三五個欄位驗、其餘全放過」——而回歸通常正好發生在
//! 沒被挑到的那幾個欄位上。`cargo insta test --accept` 直接把整份預期輸出生出來，
//! 涵蓋範圍是全部欄位，寫的人只要**讀一遍生出來的東西對不對**。
//!
//! 這批在動手前的 region 覆蓋率：rss / series / site / quote 都是 **0%**，
//! watch 13.6%，thoughts 7.0%。
//!
//! ## 快照測試怎麼不變成橡皮圖章
//!
//! 快照最大的失敗模式是「壞了就按 --accept」。這裡靠三件事壓住：
//!   1. 種子資料的日期全部寫死（見 common::seed_extra）。回應每跑一次都不一樣的話，
//!      人只會學會反射性接受。
//!   2. 真的會變的值（RSS 的 lastBuildDate 之類）用 redaction 換成固定字串，
//!      而不是整個欄位不看——欄位在不在、位置對不對仍然被驗。
//!   3. 快照旁邊都寫清楚「這裡在保護什麼」。看不出保護什麼的快照，
//!      下次壞掉就會被直接接受。
//!
//! 更新方式：`cargo insta test --accept`（會改 tests/snapshots/*.snap，**要逐一看過 diff**）。

use insta::assert_json_snapshot;

mod common;
use common::{get, seed_extra, test_app};

/// 建 app 並灌入快照專用的額外資料。
async fn app_with_content() -> axum::Router {
    let (app, pool) = test_app().await;
    seed_extra(&pool).await;
    app
}

// ── 系列文 ───────────────────────────────────────────────────────────────

/// 保護的是「系列清單怎麼把兩篇文章聚合成一筆」——篇數、代表圖、起訖時間這些
/// 衍生欄位，是最容易在改 SQL 時算錯又沒人發現的地方。
#[tokio::test]
async fn series_list_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/series").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

/// 單一系列的文章排序。series_order 是 nullable，排序規則（NULL 排最後）
/// 寫在 SQL 的 CASE 裡，改動時編譯器不會說話。
#[tokio::test]
async fn series_detail_orders_by_series_order() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/series/測試系列").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

// ── 書櫃 ─────────────────────────────────────────────────────────────────

/// 書櫃列表：欄位名是 snake_case 還是 camelCase、rating 是不是數字，
/// 這些前端直接吃的細節靠 specta 保證型別、靠這裡保證實際輸出對得上。
#[tokio::test]
async fn books_list_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/books").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

/// 統計摘要整份都是算式（分組計數、平均分），正是「錯了會安靜地錯」的形狀。
#[tokio::test]
async fn books_summary_is_computed_correctly() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/books/stats/summary").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

// ── 投票 / 站台計數器 ────────────────────────────────────────────────────

/// 票數聚合成 {option: count} 的形狀。
#[tokio::test]
async fn poll_results_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/polls/demo").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

/// 不存在的投票不該 500（Schemathesis 抓過同類型的問題）。
#[tokio::test]
async fn unknown_poll_does_not_500() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/polls/no-such-poll").await;
    assert!(status.is_success() || status == 404, "非預期狀態 {status}：{body}");
    assert_json_snapshot!("unknown_poll", body);
}

// ── 觀看紀錄 ─────────────────────────────────────────────────────────────

/// 三個 watch 端點目前覆蓋率 13.6%，而它們的回應都經過欄位改名與型別轉換。
#[tokio::test]
async fn anime_history_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/anime/history").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

#[tokio::test]
async fn films_recent_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/films/recent").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

#[tokio::test]
async fn tv_recent_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/tv/recent").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

/// watch/stats 整份都是算式（各類型計數、總時數）。
#[tokio::test]
async fn watch_stats_are_computed_correctly() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/watch/stats").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body);
}

// ── 首頁摘要 ─────────────────────────────────────────────────────────────

/// home/digest 把好幾張表併成一份給首頁用的東西，是這裡面最容易在改別的
/// 端點時被連帶改壞、又最沒人會注意到的一支。
#[tokio::test]
async fn home_digest_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/home/digest").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body, {
        // 內文摘要會截斷到固定長度，但來源是 seed 的固定字串，不需要遮
        // 這裡只遮真正跟時間有關的欄位
        ".**.created_at" => "[created_at]",
        ".**.updated_at" => "[updated_at]",
    });
}

// ── 碎念 ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn thoughts_list_shape() {
    let app = app_with_content().await;
    let (status, body) = get(&app, "/api/thoughts").await;
    assert_eq!(status, 200);
    assert_json_snapshot!(body, {
        ".**.created_at" => "[created_at]",
        ".**.updated_at" => "[updated_at]",
    });
}
