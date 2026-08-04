//! 前端錯誤與 CSP 違規的**轉發端點**（Sentry SDK 的 `tunnel` 模式）。
//!
//! 前端不直接打 GlitchTip，改成把 envelope POST 到這裡，由後端轉發到內網的
//! `http://glitchtip:8000`。四個理由：
//!
//!   1. **DSN 不外流。** 直連的話 key 一定出現在 bundle 裡（那是設計如此，不是失誤），
//!      任何人抄走就能往你的專案灌事件。走這裡的話 key 只存在於後端環境變數。
//!   2. **CSP 的 `connect-src` 維持 `'self'`。** 直連要多開一個來源，而每多一個
//!      就多一條「哪天被拿去外送資料」的路。
//!   3. **擋廣告外掛不會誤殺。** uBlock 那類會用通用規則比對 `/envelope/`、`/api/N/store/`
//!      這種路徑。被擋的時候是**靜默的**——前端以為送出去了，你以為沒出錯。
//!   4. **`glitchtip.koimsurai.com` 不必對公網開 ingest。** 那個子網域現在只剩
//!      你自己看儀表板用。
//!
//! ⚠️ 這兩個端點**無認證**（本來就不可能有：CSP report 是瀏覽器直接送的，帶不了
//!   任何自訂標頭）。防濫用靠三層：body 上限、DSN 比對、以及 nginx 的 `limit_req`
//!   + CrowdSec 的 `nginx-req-limit-exceeded`。
//!
//! ⚠️ 一律回 **202**，不論轉發成不成功。上游怎麼了是我們的事，不要讓前端把
//!   「錯誤回報失敗」當成一個需要重試的錯誤——那正是製造無窮迴圈的方法。

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};

use crate::state::AppState;

/// envelope 上限。Sentry 事件含 stack trace + source context + breadcrumbs，
/// 正常在幾十 KB；200KB 是「夠用且擋得住灌」的折衷。
const MAX_BODY: usize = 200 * 1024;

/// CSP report 依規格很小（一個 JSON 物件）。給 16KB 綽綽有餘。
const MAX_CSP_BODY: usize = 16 * 1024;

/// 從 DSN 拆出轉發需要的三件事。
///
/// DSN 形狀：`http://<public_key>@<host>:<port>/<project_id>`
#[derive(Debug, Clone)]
pub struct Dsn {
    pub public_key: String,
    /// 已含 scheme 與 host:port，例如 `http://glitchtip:8000`
    pub origin: String,
    pub project_id: String,
}

impl Dsn {
    pub fn parse(raw: &str) -> Option<Self> {
        let url = reqwest::Url::parse(raw).ok()?;
        let public_key = url.username().to_string();
        if public_key.is_empty() {
            return None;
        }
        let project_id = url.path().trim_matches('/').to_string();
        if project_id.is_empty() || !project_id.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let host = url.host_str()?;
        let origin = match url.port() {
            Some(p) => format!("{}://{host}:{p}", url.scheme()),
            None => format!("{}://{host}", url.scheme()),
        };
        Some(Self { public_key, origin, project_id })
    }

    /// ⚠️ `?sentry_key=` **不能省**。轉發時我們不帶 `X-Sentry-Auth`，而 GlitchTip
    ///   找不到任何認證就回 `403 {"detail": "Denied"}`——而且那是「送出成功」的一次
    ///   HTTP 請求，沒有檢查狀態碼的話完全看不出來。
    fn envelope_url(&self) -> String {
        format!("{}/api/{}/envelope/?sentry_key={}", self.origin, self.project_id, self.public_key)
    }

    fn security_url(&self) -> String {
        format!("{}/api/{}/security/?sentry_key={}", self.origin, self.project_id, self.public_key)
    }
}

/// 前端專案的**真** DSN（`SENTRY_FRONTEND_DSN`）。只有後端知道。
/// 沒設 → 兩個端點都直接回 202 不做事。
fn frontend_dsn() -> Option<Dsn> {
    Dsn::parse(&std::env::var("SENTRY_FRONTEND_DSN").ok()?)
}

/// 前端 bundle 裡那把 key（`SENTRY_TUNNEL_PUBLIC_KEY`）。
///
/// 為什麼要有兩把：Sentry SDK 在 `tunnel` 模式下**仍然需要一個 DSN**，它會把 dsn
/// 塞進 envelope 的 header——也就是說那把 key 一定會出現在 bundle 裡。實測 GlitchTip
/// 只認網址上的 `?sentry_key=`，**不驗** envelope 裡的 dsn 欄位，所以前端可以拿一把
/// 隨便產的假 key，由這裡在轉發時換成真的。
///
/// 換來的是：bundle 裡那把 key 只對「這個有速率限制的端點」有效，直接拿去打
/// GlitchTip 的 ingest 是無效的。也讓這把公開 key 可以單獨輪替，不必動 GlitchTip。
///
/// 沒設就退回用真 key 比對（等於不做這層區隔，功能照常）。
fn expected_public_key(real: &Dsn) -> String {
    std::env::var("SENTRY_TUNNEL_PUBLIC_KEY")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| real.public_key.clone())
}

/// 兩邊等長才逐位元組比，避免用比較耗時洩漏 key 的前綴。
fn key_matches(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 把讀者的真實 IP 往上游帶。
///
/// nginx 已經設了 `X-Forwarded-For` 與 `X-Real-IP`，這裡原樣轉過去，GlitchTip 才不會
/// 把所有事件都算在後端容器的 IP 上。
///
/// ⚠️ 這代表**讀者 IP 會進 GlitchTip 的資料庫**（保留期依 `GLITCHTIP_EVENT_RETENTION_DAYS`，
///   預設 90 天）。不想留的話，GlitchTip 組織層有 `scrub_ip_addresses` 可以開。
fn forward_client_ip(req: reqwest::RequestBuilder, headers: &HeaderMap) -> reqwest::RequestBuilder {
    let mut req = req;
    for name in ["x-forwarded-for", "x-real-ip"] {
        if let Some(v) = headers.get(name).and_then(|v| v.to_str().ok()) {
            req = req.header(name, v);
        }
    }
    req
}

/// 送出並回報結果。
///
/// ⚠️ 一定要看**狀態碼**，不能只看 `send()` 有沒有 Err。上游拒收（例如 payload 不合
///   GlitchTip 的 schema）回的是 422，那在 reqwest 眼中是成功的一次請求——
///   不檢查的話事件靜靜消失，兩邊都不會有任何線索。裝設時就是這樣浪費了一輪：
///   CSP report 少送三個欄位被 422，而這裡只印了「轉發成功」。
///
/// 這裡用 `warn` 而不是 `error`：上報管線自己出問題不該再變成一則 issue
///（何況那則 issue 多半也送不出去——正是它不通的時候）。
async fn forward(req: reqwest::RequestBuilder, what: &str) {
    match req.send().await {
        Err(e) => tracing::warn!("轉發{what}失敗: {e}"),
        Ok(resp) if !resp.status().is_success() => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!(%status, body = %body.chars().take(200).collect::<String>(), "上游拒收{what}");
        }
        Ok(_) => {}
    }
}

/// `POST /api/_report` —— Sentry SDK 的 `tunnel` 目的地。
///
/// 路徑刻意避開 `sentry` / `envelope` / `store` 這些字：那正是廣告外掛的通用規則在比對的
/// 東西，取名叫 `/api/sentry-tunnel` 等於白做。
pub async fn tunnel(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let Some(dsn) = frontend_dsn() else { return StatusCode::ACCEPTED };
    if body.len() > MAX_BODY {
        tracing::warn!(size = body.len(), "envelope 超過上限，丟棄");
        return StatusCode::ACCEPTED;
    }

    // envelope 的第一行是 header JSON。開 tunnel 模式時 SDK 會把 dsn 放進去，
    // 讓轉發端知道該送去哪個專案——我們拿它來**驗證**，不是拿來當路由。
    let Some(first_line) = body.split(|&b| b == b'\n').next() else { return StatusCode::ACCEPTED };
    let Ok(header) = serde_json::from_slice::<serde_json::Value>(first_line) else {
        return StatusCode::ACCEPTED;
    };
    let claimed = header.get("dsn").and_then(|v| v.as_str()).unwrap_or_default();
    // 只認自己那一把公開 key。不驗的話這裡就變成一個對外開放的 Sentry 轉發器，
    // 任何人都能拿它往**別人的**專案送東西（被當成濫用來源的那種）。
    match Dsn::parse(claimed) {
        Some(d) if key_matches(&d.public_key, &expected_public_key(&dsn)) => {}
        _ => {
            tracing::warn!("envelope 的 DSN 不符，丟棄");
            return StatusCode::ACCEPTED;
        }
    }

    let req = state
        .http
        .post(dsn.envelope_url())
        .header("content-type", "application/x-sentry-envelope")
        .body(body);
    forward(forward_client_ip(req, &headers), "envelope").await;
    StatusCode::ACCEPTED
}

/// `POST /api/csp-report` —— CSP `report-uri` 的目的地。
///
/// 瀏覽器送的 content-type 是 `application/csp-report`，而且**帶不了任何自訂標頭**，
/// 所以認證與路由資訊只能放在網址裡（`?sentry_key=`，由這裡補上）。
pub async fn csp_report(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> StatusCode {
    let Some(dsn) = frontend_dsn() else { return StatusCode::ACCEPTED };
    if body.len() > MAX_CSP_BODY {
        return StatusCode::ACCEPTED;
    }
    // 形狀不對就丟掉——這個端點是公開的，不先驗一下等於幫別人往資料庫塞任意 JSON
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) else { return StatusCode::ACCEPTED };
    if !v.get("csp-report").is_some_and(|r| r.is_object()) {
        return StatusCode::ACCEPTED;
    }

    let req = state.http.post(dsn.security_url()).header("content-type", "application/csp-report").body(body);
    forward(forward_client_ip(req, &headers), "CSP report").await;
    StatusCode::ACCEPTED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsn_拆得出轉發需要的三件事() {
        let d = Dsn::parse("http://abc123@glitchtip:8000/2").expect("正常 DSN");
        assert_eq!(d.public_key, "abc123");
        assert_eq!(d.origin, "http://glitchtip:8000");
        assert_eq!(d.project_id, "2");
        // ⚠️ sentry_key 一定要在查詢字串裡：轉發時沒有帶 X-Sentry-Auth 標頭（見 envelope 的
        // 送出處），認證完全靠這個參數。少了它 GlitchTip 會回 401 而事件只是安靜地不見。
        assert_eq!(d.envelope_url(), "http://glitchtip:8000/api/2/envelope/?sentry_key=abc123");
        assert!(d.security_url().starts_with("http://glitchtip:8000/api/2/security/?sentry_key=abc123"));

        // 沒有 port 時不要留下一個空的 ":"
        let d = Dsn::parse("https://k@glitchtip.koimsurai.com/1").expect("無 port");
        assert_eq!(d.origin, "https://glitchtip.koimsurai.com");
    }

    #[test]
    fn 形狀不對的_dsn_一律拒絕() {
        // 少 key、少 project、project 不是數字、根本不是 URL —— 全部要回 None。
        // 這些如果放行，轉發的網址會拼成奇怪的東西打到內網的別處
        for bad in [
            "http://glitchtip:8000/2",     // 沒有 key
            "http://abc@glitchtip:8000/",  // 沒有 project id
            "http://abc@glitchtip:8000/x", // project id 不是數字
            "not-a-url",
            "",
        ] {
            assert!(Dsn::parse(bad).is_none(), "{bad} 應該被拒");
        }
    }

    #[test]
    fn key_比對長度不同時直接不符() {
        assert!(key_matches("abcdef", "abcdef"));
        assert!(!key_matches("abcdef", "abcdeg"));
        // 長度不同要先擋掉——zip 會在短的那邊停下來，
        // 沒有這個檢查的話 "abc" 會被判定成 "abcdef" 的相符前綴
        assert!(!key_matches("abc", "abcdef"));
        assert!(!key_matches("abcdef", "abc"));
        assert!(!key_matches("", "abc"));
    }
}
