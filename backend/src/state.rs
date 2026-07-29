use sqlx::{Pool, Sqlite};
use std::sync::Arc;

/// 共享應用狀態。
/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    /// sqlx 連線池，連到與 Express 相同的 sqlite 檔（strangler 期間共用）。
    /// sqlx pool over the SAME sqlite file Express uses (shared during the strangler period).
    pub pool: Pool<Sqlite>,
    /// 對外部 API（TMDb / Trakt / Resend / Spotify / Steam）發請求用的 HTTP client。
    /// HTTP client for outbound calls to third-party APIs.
    pub http: reqwest::Client,
    /// JWT 簽章密鑰，與 Express 的 `JWT_SECRET` 共用（HS256）。
    /// JWT signing secret, shared with Express `JWT_SECRET` (HS256).
    pub jwt_secret: Arc<str>,
    /// Spotify in-process 狀態（token/top/audio-features 快取與熔斷）。
    pub spotify: Arc<SpotifyState>,
    /// steam/profile SWR 快取。
    pub steam: Arc<SteamState>,
    /// watch 域狀態（now-watching / Trakt / TMDb detail 快取）。
    pub watch: Arc<WatchState>,
    /// bahamut client + sync 控制。
    pub bahamut: Arc<BahamutState>,
}

/// Spotify 端的 in-process 狀態（token 快取 + top-*/audio-features 快取與熔斷）。
/// 全部 parking_lot::Mutex 短臨界區（讀寫皆 clone 出來用，**不跨 await 持有**）。
#[derive(Default)]
pub struct SpotifyState {
    /// (access_token, expiry_ms)
    pub token: parking_lot::Mutex<Option<(String, i64)>>,
    /// top-genres：(payload, expires_at)
    /// 存型別化的結構而非 serde_json::Value —— 快取的東西就是端點回應本身，
    /// 兩者用同一個型別，就不可能快取到形狀不符的內容。
    pub top_genres: parking_lot::Mutex<Option<(crate::handlers::spotify::TopGenresResponse, i64)>>,
    /// top-tracks：key = "time_range:limit" → (payload, expires_at)
    pub top_tracks: parking_lot::Mutex<
        std::collections::HashMap<String, (crate::handlers::spotify::TopTracksResponse, i64)>,
    >,
    /// top-* 熔斷到期（ms）
    pub top_disabled_until: std::sync::atomic::AtomicI64,
    /// audio-features：trackId → (data, expires_at)
    pub audio_features:
        parking_lot::Mutex<std::collections::HashMap<String, (crate::handlers::spotify::AudioFeature, i64)>>,
    /// audio-features 熔斷到期（ms）
    pub af_disabled_until: std::sync::atomic::AtomicI64,
}

/// steam/profile 的 SWR 快取。
#[derive(Clone)]
pub struct SteamProfileCache {
    pub data: serde_json::Value,
    pub fetched_at: i64,
    pub last_tried_at: i64,
}

#[derive(Default)]
pub struct SteamState {
    pub cache: parking_lot::Mutex<Option<SteamProfileCache>>,
    /// inflight dedup：同一時間只跑一個 refresh（tokio Mutex，可跨 await）
    pub refresh_lock: tokio::sync::Mutex<()>,
}

/// watch 域的 in-process 狀態（now-watching + Trakt slug + TMDb detail 快取）。
#[derive(Default)]
pub struct WatchState {
    /// 目前即時觀看：(對外資料, 過期時間 epoch ms)。
    /// 過期時間刻意不放進 NowWatching —— 那是伺服器記帳，不是 API 欄位。
    /// 舊寫法把 expiresAt 塞在同一個 JSON 裡、serve 時再 remove()，靠「記得移除」維持正確。
    pub now: parking_lot::Mutex<Option<(crate::handlers::watch::NowWatching, i64)>>,
    /// 上次 Trakt /watching 輪詢時間（ms；25s 節流）
    pub last_trakt_poll: std::sync::atomic::AtomicI64,
    /// Trakt user slug（首次查 /users/settings 後常駐）
    pub trakt_slug: parking_lot::Mutex<Option<String>>,
    /// TMDb detail 快取：`kind:id:lang` → {title, poster_url, year}（同 Express：無 TTL）
    pub tmdb_detail: parking_lot::Mutex<std::collections::HashMap<String, serde_json::Value>>,
    /// Trakt token refresh 串行鎖（deviation：Express 無鎖，併發 refresh race 會吃掉
    /// 一次性 refresh token → invalid_grant 永久死，live 已發生過）
    pub trakt_refresh_lock: tokio::sync::Mutex<()>,
}

/// bahamut（動畫瘋）client + sync 控制。
/// **設計**：`AniGamer` 內部已是 `Mutex<CookieJar>`（thread-safe、方法 `&self`、鎖不跨 await），
/// 故共享單一 `Arc<AniGamer>` 即可——cookie 熱抽換走內部 `set_cookies`，**不套外層 Mutex/ArcSwap**。
pub struct BahamutState {
    pub client: std::sync::Arc<anigamer::AniGamer>,
    /// sync 防重入（try_lock 拿不到＝已在跑，skip）。長時間 async 期間**不擋** status/cookie。
    pub sync_lock: tokio::sync::Mutex<()>,
    /// JWT 到期 Discord 告警節流（24h；ms）。
    pub last_jwt_alert_at: std::sync::atomic::AtomicI64,
    /// rotated cookie 持久化路徑（與 db 同目錄）。
    pub cookie_file: std::path::PathBuf,
}
