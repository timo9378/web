use std::{env, str::FromStr, sync::Arc, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use koimsurai_web_backend::{handlers, router, state};
use state::AppState;

// jemalloc（tikv fork）：長跑 server 的 RSS/碎片化優於 glibc malloc
//（反代大量短命 alloc + takumi/webp 圖片管線爆量 alloc）。MSVC 不支援 → cfg 排除。
#[cfg(not(target_env = "msvc"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

// jemalloc 預設 decay 無上限且無背景執行緒 → 記憶體只進不出。
// 實測（20 萬請求 ×100 併發，n=3，負載退去 20s 後的穩態 RSS）：
//   glibc 44.9MB ／ jemalloc 預設 47.6MB（比 glibc 還差）／ 本設定 22.3MB（-50%）
// 這台同時跑 ~35 個容器，穩態 RSS 才是真正該省的數字。
// tikv-jemalloc 以 _rjem_ 前綴編譯，設定符號名須為 _rjem_malloc_conf（環境變數則是 _RJEM_MALLOC_CONF）。
#[cfg(not(target_env = "msvc"))]
#[allow(non_upper_case_globals)]
#[unsafe(export_name = "_rjem_malloc_conf")]
pub static malloc_conf: &[u8] = b"background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:1000\0";

/// Sentry（自架 GlitchTip）初始化。回傳的 guard 要活到程式結束——提早 drop 會讓
/// 尚未送出的事件被丟掉，而那不會有任何錯誤訊息。
///
/// `SENTRY_DSN` 沒設或是空字串 → 回 None，整個功能關閉（本機開發的預設狀態）。
///
/// ⚠️ 刻意在 tokio runtime **之前**呼叫：sentry 的傳輸層自己起一條背景執行緒，
///   官方文件明說要在 runtime 啟動前初始化。
fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty())?;

    // ⚠️ 0.49 起 `ClientOptions` 是 #[non_exhaustive]，不能寫成結構體字面值
    //   （連 `..Default::default()` 也不行，那是 E0639）。只能逐欄位指派，
    //   所以下面那個 clippy lint 要放行。
    #[allow(clippy::field_reassign_with_default)]
    let mut opts = sentry::ClientOptions::default();
    opts.release = sentry::release_name!();
    // 沒設就是 "production"（正式部署唯一會跑到這裡的環境）
    opts.environment = Some(env::var("SENTRY_ENVIRONMENT").unwrap_or_else(|_| "production".into()).into());
    // 不送 IP／cookie／header 之類的個資。本站的立場是不外送讀者行為，
    // 即使收件端是自己的機器也維持一致——那樣萬一哪天改指到 SaaS 也不會突然外洩。
    opts.send_default_pii = false;
    // ⚠️ 只要錯誤，不要 APM——traces 是流量大戶而這裡用不到（效能已經有 web_vitals
    //   表在收實地資料）。`TracesSamplingStrategy::Disabled` 本來就是預設值，
    //   這裡寫出來是為了讓「刻意不開」這件事在程式碼裡看得見。
    opts.traces_sampling_strategy = sentry::TracesSamplingStrategy::Disabled;
    // 結構化日誌。要的不是「多一份 log」——docker logs 本來就有——而是**錯誤的前後文**：
    // 點進一個 issue 能看到那次請求前後發生什麼，不必回頭去 grep 容器日誌對時間。
    // 量的上限靠 GLITCHTIP_LOG_HOT_DAYS（預設 7 天後轉冷儲存）控制。
    //
    // ⚠️ 這裡不需要設 `opts.enable_logs`：sentry 0.49 起它已 deprecated，而且**預設就是
    // true**。它現在只控制「整合的自動捕獲」（本專案是 sentry-tracing 的 logs feature），
    // 要調整送什麼要去該整合自己的選項或 before_send_log，不是這個旗標。

    Some(sentry::init((dsn, opts)))
}

fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let _sentry = init_sentry();
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(run())
}

async fn run() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,koimsurai_web_backend=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        // tracing 事件 → Sentry。event_filter 決定每個層級走哪幾條路（可以用 | 疊）：
        //   ERROR  → Event（成為 issue）+ Log
        //   WARN   → Breadcrumb（附在下一個 issue 上）+ Log
        //   INFO   → 只有 Log
        //   DEBUG/TRACE → 丟掉。這兩級在正式環境是 request 級別的雜訊，
        //                 全送的話 Postgres 會被灌爆而且沒有對應的價值。
        //
        // ⚠️ WARN 刻意**不**變成 Event。link_preview 抓不到、manage_tags 失敗這類
        //   日常雜訊每天都有，變成 issue 的話列表會被淹掉——而列表一旦沒人看，
        //   真的出事時也就沒人看。
        .with(sentry_tracing::layer().event_filter(|md| match *md.level() {
            tracing::Level::ERROR => sentry_tracing::EventFilter::Event | sentry_tracing::EventFilter::Log,
            tracing::Level::WARN => {
                sentry_tracing::EventFilter::Breadcrumb | sentry_tracing::EventFilter::Log
            }
            tracing::Level::INFO => sentry_tracing::EventFilter::Log,
            _ => sentry_tracing::EventFilter::Ignore,
        }))
        .init();

    // 開機自檢：`SENTRY_SMOKE_TEST=1` 時送一則測試錯誤，然後照常啟動。
    //
    // 存在的理由是這條管線**壞掉時完全沒有症狀**——DSN 打錯、容器不在同一個網路、
    // GlitchTip 的 migration 沒跑，三種情況下伺服器都照常服務，你只會以為「最近沒出錯」。
    // 裝好時要驗一次，之後每次升級 GlitchTip 或改動網路設定時再驗一次。
    //
    // 驗完把環境變數拿掉，不然每次重啟都會多一則假錯誤。
    if env::var("SENTRY_SMOKE_TEST").is_ok_and(|v| v == "1") {
        tracing::error!(
            smoke_test = true,
            "SENTRY_SMOKE_TEST：這是刻意送出的測試錯誤，看得到就代表上報管線是通的"
        );
    }

    // sqlite：WAL 讓讀寫可重疊；busy_timeout 避免 SQLITE_BUSY；
    // create_if_missing 讓全新部署由 migrations 從零建出 DB。
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let connect_opts = SqliteConnectOptions::from_str(&database_url)?
        .busy_timeout(Duration::from_secs(5))
        .journal_mode(SqliteJournalMode::Wal)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(env::var("DATABASE_MAX_CONNECTIONS").ok().and_then(|v| v.parse().ok()).unwrap_or(5))
        .connect_with(connect_opts)
        .await?;

    // schema 由 sqlx migrations 管理（backend/migrations/）。
    // baseline 全 IF NOT EXISTS：對既有正式 DB 是 no-op（只記錄版本），
    // 對全新 DB / 測試 in-memory DB 建出完整 schema。
    sqlx::migrate!("./migrations").run(&pool).await?;

    let http = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;

    // JWT_SECRET（HS256 驗章）。fail-fast：沒設就不啟動。
    let jwt_secret = env::var("JWT_SECRET").expect("JWT_SECRET must be set");

    // 預設＝正式位址，編譯進去。這個欄位存在的理由見 state::ExternalUrls。
    let external = state::ExternalUrls::default();
    let state = AppState {
        pool,
        http,
        jwt_secret: Arc::from(jwt_secret.as_str()),
        spotify: Arc::new(state::SpotifyState::default()),
        steam: Arc::new(state::SteamState::default()),
        watch: Arc::new(state::WatchState::default()),
        bahamut: handlers::bahamut::build_state(&database_url, &external),
        external: std::sync::Arc::new(external),
    };

    // Simkl 歷史同步 worker（ENABLE_SIMKL_SYNC=1 才啟動；見 handlers/simkl.rs）。
    // 取代已移除的 Trakt 同步——Trakt 未預告刪掉了免費帳號的 API app。
    handlers::simkl::spawn_sync(state.clone());
    // 動畫瘋同步 worker（ENABLE_BAHAMUT_SYNC=1 才啟動；見 handlers/bahamut.rs）
    handlers::bahamut::spawn_sync(state.clone());

    let app = router::build_router(state);

    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3002".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("koimsurai-web-backend listening on http://{bind_addr}");
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;

    Ok(())
}

/// SIGTERM（docker stop）/ Ctrl-C → 停止收新連線、讓在途請求跑完。
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => tracing::error!("SIGTERM handler 安裝失敗: {e}"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received — draining in-flight requests");
}
