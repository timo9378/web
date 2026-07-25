use std::{env, str::FromStr, sync::Arc, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use koimsurai_web_backend::{handlers, router, state};
use state::AppState;

// jemalloc（tikv fork）：長跑 server 的 RSS/碎片化優於 glibc malloc
//（反代大量短命 alloc + resvg/webp 圖片管線爆量 alloc）。MSVC 不支援 → cfg 排除。
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,koimsurai_web_backend=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

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

    let state = AppState {
        pool,
        http,
        jwt_secret: Arc::from(jwt_secret.as_str()),
        spotify: Arc::new(state::SpotifyState::default()),
        steam: Arc::new(state::SteamState::default()),
        watch: Arc::new(state::WatchState::default()),
        bahamut: handlers::bahamut::build_state(&database_url),
    };

    // Trakt 歷史同步 worker（ENABLE_TRAKT_SYNC=1 才啟動；見 handlers/watch.rs）
    handlers::watch::spawn_trakt_sync(state.clone());
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
