use sqlx::{Pool, Sqlite};
use std::sync::Arc;

/// 共享應用狀態。
/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    /// sqlx 連線池，連到與 Express 相同的 sqlite 檔（strangler 期間共用）。
    /// sqlx pool over the SAME sqlite file Express uses (shared during the strangler period).
    pub pool: Pool<Sqlite>,
    /// 對外部 API（TMDb / Simkl / Resend / Spotify / Steam）發請求用的 HTTP client。
    /// HTTP client for outbound calls to third-party APIs.
    pub http: reqwest::Client,
    /// JWT 簽章密鑰，與 Express 的 `JWT_SECRET` 共用（HS256）。
    /// JWT signing secret, shared with Express `JWT_SECRET` (HS256).
    pub jwt_secret: Arc<str>,
    /// Spotify in-process 狀態（token/top/audio-features 快取與熔斷）。
    pub spotify: Arc<SpotifyState>,
    /// steam/profile SWR 快取。
    pub steam: Arc<SteamState>,
    /// watch 域狀態（now-watching / TMDb detail 快取）。
    pub watch: Arc<WatchState>,
    /// bahamut client + sync 控制。
    pub bahamut: Arc<BahamutState>,
    /// 對外服務的 base URL（預設＝正式位址）。見 `ExternalUrls`。
    pub external: Arc<ExternalUrls>,
}

/// 對外服務的 base URL。
///
/// **預設值就是正式位址、編譯進去**，所以正式路徑的行為與寫死在字串裡時完全相同。
/// 這裡刻意不用環境變數：那會多開一個外部可控的注入面（改掉它就能讓伺服器去打任意
/// 主機），而我們要的只是測試能替換。
///
/// 存在的理由是可測性。thirdparty.rs 2248 個 region、watch.rs 2239、spotify.rs 709，
/// 三者合計五千多個 region 一直測不到——不是因為沒人想寫測試，是因為上游位址寫死在
/// 字串裡，任何 mock server 都攔不下來。測試建 `AppState` 時把這裡指向本地 mock。
///
/// ⚠ 只放**會被 fetch 的位址**。回應裡給前端當連結用的網址不要放進來——
/// 例如 `SteamProfile.profile_url`（使用者點了要去真的 Steam）、書封圖網址。
/// 那些指到 mock 等於把測試設定洩漏到正式回應裡。
#[derive(Debug, Clone)]
pub struct ExternalUrls {
    /// GitHub REST + GraphQL（handlers/thirdparty.rs）
    pub github_api: String,
    /// Steam Web API（handlers/thirdparty.rs）
    pub steam_api: String,
    /// Steam 社群站——miniprofile 那支 HTML 抓取用，**不是** profile_url
    pub steam_community: String,
    /// WakaTime API（handlers/thirdparty.rs）
    pub wakatime: String,
    /// Google Books（書籍搜尋）
    pub google_books: String,
    /// Open Library（ISBN 查詢與搜尋）
    pub openlibrary: String,
    /// Spotify Web API（handlers/spotify.rs 全部走 `sp_get`）
    pub spotify_api: String,
    /// Spotify 帳號服務——只放 token 交換那條。
    /// `/authorize` 那個是回給瀏覽器跳轉的目的地不是我們發的請求，留在 spotify.rs 裡當字面值。
    pub spotify_accounts: String,
    /// 每日名言的四個來源（handlers/quote.rs）。
    ///
    /// 分成四個欄位而不是一個 base：它們是四個不同的站，路徑也各自不同。
    /// 不注入的話 `quote_daily` 的測試會真的打到那四個站——而且在 CI 上**可能會成功**，
    /// 於是測試結果取決於別人的服務今天有沒有掛，那比沒有測試更糟。
    pub hitokoto: String,
    pub zenquotes: String,
    pub meigen: String,
    pub korean_advice: String,
    /// 動畫瘋的兩個上游（handlers/bahamut.rs 的 sync worker）。
    ///
    /// 這兩個不是我們自己 fetch 的——是傳給 `anigamer` SDK 的 `ClientOptions::base_urls`。
    /// SDK 0.1.0 把位址寫死在 `format!` 裡，於是 `sync_bahamut_history` 那 423 個 region
    /// 完全測不到；0.1.1 才開了這個口，理由與這整個結構相同。
    ///
    /// ⚠ 分成 api 與 web 兩個是因為它們是兩個不同的服務：`api` 回 JSON（觀看歷史），
    ///   `web` 回 HTML（封面圖的 og:image）。
    pub bahamut_api: String,
    pub bahamut_web: String,
}

impl Default for ExternalUrls {
    fn default() -> Self {
        Self {
            github_api: "https://api.github.com".into(),
            steam_api: "https://api.steampowered.com".into(),
            steam_community: "https://steamcommunity.com".into(),
            wakatime: "https://wakatime.com".into(),
            google_books: "https://www.googleapis.com".into(),
            openlibrary: "https://openlibrary.org".into(),
            spotify_api: "https://api.spotify.com".into(),
            spotify_accounts: "https://accounts.spotify.com".into(),
            hitokoto: "https://v1.hitokoto.cn".into(),
            zenquotes: "https://zenquotes.io".into(),
            meigen: "https://meigen.doodlenote.net".into(),
            korean_advice: "https://korean-advice-open-api.vercel.app".into(),
            bahamut_api: anigamer::DEFAULT_API_BASE.into(),
            bahamut_web: anigamer::DEFAULT_WEB_BASE.into(),
        }
    }
}

impl ExternalUrls {
    /// 測試用：全部指向同一個 mock server。
    /// 每個服務用不同路徑前綴，這樣一台 mock 就能同時扮演六個上游，
    /// 而且 mock 收到的請求路徑一看就知道是打給誰的。
    #[cfg(test)]
    pub(crate) fn all_pointing_at(base: &str) -> Self {
        Self {
            github_api: format!("{base}/github"),
            steam_api: format!("{base}/steam-api"),
            steam_community: format!("{base}/steam-community"),
            wakatime: format!("{base}/wakatime"),
            google_books: format!("{base}/google-books"),
            openlibrary: format!("{base}/openlibrary"),
            spotify_api: format!("{base}/spotify-api"),
            spotify_accounts: format!("{base}/spotify-accounts"),
            hitokoto: format!("{base}/hitokoto"),
            zenquotes: format!("{base}/zenquotes"),
            meigen: format!("{base}/meigen"),
            korean_advice: format!("{base}/korean-advice"),
            bahamut_api: format!("{base}/bahamut-api"),
            bahamut_web: format!("{base}/bahamut-web"),
        }
    }
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
    /// 快取的就是端點回應本體，用同一個型別就不可能快取到形狀不符的內容
    /// （同 watch/now、spotify top-* 的做法）。`_cachedAt` 不在裡面——那是
    /// 下面 fetched_at 的職責，不是 profile 的一部分。
    pub data: crate::handlers::thirdparty::SteamProfile,
    pub fetched_at: i64,
    pub last_tried_at: i64,
}

#[derive(Default)]
pub struct SteamState {
    pub cache: parking_lot::Mutex<Option<SteamProfileCache>>,
    /// inflight dedup：同一時間只跑一個 refresh（tokio Mutex，可跨 await）
    pub refresh_lock: tokio::sync::Mutex<()>,
}

/// watch 域的 in-process 狀態（now-watching + TMDb detail 快取）。
#[derive(Default)]
pub struct WatchState {
    /// 目前即時觀看：(對外資料, 過期時間 epoch ms)。
    /// 過期時間刻意不放進 NowWatching —— 那是伺服器記帳，不是 API 欄位。
    /// 舊寫法把 expiresAt 塞在同一個 JSON 裡、serve 時再 remove()，靠「記得移除」維持正確。
    pub now: parking_lot::Mutex<Option<(crate::handlers::watch::NowWatching, i64)>>,
    /// TMDb detail 快取：`kind:id:lang` → {title, poster_url, year}（同 Express：無 TTL）
    pub tmdb_detail: parking_lot::Mutex<std::collections::HashMap<String, serde_json::Value>>,
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

// ── 測試支援 ──────────────────────────────────────────────────────────────
// 只在 cfg(test) 存在，不進正式 binary。
//
// 為什麼放這裡而不是 tests/api.rs：那邊測的是「打 HTTP 進去、看回應出來」，
// 拿不到 `AppState` 上的那幾把鎖。而 inflight dedup 的契約（N 個並發只打上游一次、
// 等到鎖之後要重查快取）只有直接摸得到鎖才驗得了——要嘛佔住鎖讓所有人排隊，
// 要嘛在他們排隊期間改變共享狀態，看醒來的人有沒有重新看一眼。

/// 測試用的共用 JWT 密鑰（與 tests/api.rs 的 `TEST_SECRET` 同值，兩邊不互相依賴）。
#[cfg(test)]
pub(crate) const TEST_SECRET: &str = "test-secret";

/// 建一個接上獨立 in-memory DB 的 `AppState`。
///
/// bahamut 的 cookie 檔刻意指向唯一的暫存目錄——`build_state` 會先讀檔、讀不到才
/// 回頭吃 `BAHAMUT_COOKIE` 環境變數。若讓它落在 CWD，本機那份真的 cookie 檔會蓋掉
/// 測試想要的狀態，於是測試在我的機器上綠、在 CI 上紅（或反過來）。
#[cfg(test)]
pub(crate) async fn test_state() -> AppState {
    test_state_with(ExternalUrls::default()).await
}

/// 同上，但由呼叫端決定上游位址。
///
/// ⚠ 一定要在**建 state 的時候**就指過去，不能事後改 `state.external`：
///   `BahamutState.client` 是 `Arc<AniGamer>`，base URL 在 `AniGamer::new` 之後就
///   固定在裡面了。事後改那個欄位不會報錯，只會讓測試安靜地打到真的動畫瘋——
///   而那在 CI 上甚至可能成功。
#[cfg(test)]
pub(crate) async fn test_state_with(external: ExternalUrls) -> AppState {
    use std::str::FromStr;

    let opts = sqlx::sqlite::SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("in-memory sqlite URL")
        .foreign_keys(true);
    // in-memory DB 一條連線就是一份 DB → 鎖在單連線，全部操作共用同一份
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .expect("connect in-memory sqlite");
    sqlx::migrate!("./migrations").run(&pool).await.expect("run migrations");

    let tmp =
        std::env::temp_dir().join(format!("koimsurai-test-{}-{:p}", std::process::id(), &raw const pool));
    std::fs::create_dir_all(&tmp).expect("create temp dir");
    let fake_db_url = format!("sqlite://{}/db.sqlite", tmp.display());

    AppState {
        pool,
        http: reqwest::Client::new(),
        jwt_secret: Arc::from(TEST_SECRET),
        spotify: Arc::new(SpotifyState::default()),
        steam: Arc::new(SteamState::default()),
        watch: Arc::new(WatchState::default()),
        bahamut: crate::handlers::bahamut::build_state(&fake_db_url, &external),
        external: Arc::new(external),
    }
}

/// OWNER 角色的 JWT（帶 exp），給需要過 `require_admin` 的測試用。
#[cfg(test)]
pub(crate) fn test_owner_token() -> String {
    let now = crate::util::now_secs();
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &serde_json::json!({ "id": 1, "username": "admin", "role": "OWNER", "iat": now, "exp": now + 3600 }),
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .expect("sign test JWT")
}

/// `Authorization: Bearer <owner token>`，直接餵給 handler。
#[cfg(test)]
pub(crate) fn test_admin_headers() -> axum::http::HeaderMap {
    let mut h = axum::http::HeaderMap::new();
    h.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {}", test_owner_token()).parse().expect("valid header value"),
    );
    h
}
