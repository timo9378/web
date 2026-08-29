//! 每日名言（`/api/quote/daily`）。移植 `routes/home.js` 的 getDailyQuote。
//! zh 走一言（hitokoto）+ opencc 簡→繁；en=ZenQuotes、ja=meigen.doodlenote、ko=korean-advice。
//! 當日快取（key=`{date}|{locale}`）＝隨機名言穩定一天；來源失敗落 fallback pool（依日期取，同日固定）。

use axum::{
    Json,
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::AppState;

const SUPPORTED: [&str; 5] = ["zh-TW", "zh-CN", "en", "ja", "ko"];

fn fallback_pool(locale: &str) -> &'static [(&'static str, &'static str)] {
    match locale {
        "zh-CN" => &[("强大使人快乐。", "一拳超人"), ("迷惘的时候，就选比较难走的那条路。", "宫崎骏")],
        "en" => &[
            ("Stay hungry. Stay foolish.", "Steve Jobs"),
            ("Simplicity is the ultimate sophistication.", "Leonardo da Vinci"),
        ],
        "ja" => &[
            ("夢を見るから、人生は輝く。", "モーツァルト"),
            ("止まりさえしなければ、どんなにゆっくりでも進めばよい。", "孔子"),
        ],
        "ko" => {
            &[("음악은 인간의 내면으로부터 나오는 폭발이다.", "베토벤"), ("천 리 길도 한 걸음부터.", "속담")]
        }
        _ => &[("強大使人快樂。", "一拳超人"), ("迷惘的時候，就選比較難走的那條路。", "宮崎駿")],
    }
}

/// opencc 簡→繁（cn→tw）；與 quote 的 s2t 對齊（ferrous S2tw 實測 byte-identical）。
fn s2t(text: &str) -> String {
    static S2TW: std::sync::OnceLock<Option<ferrous_opencc::OpenCC>> = std::sync::OnceLock::new();
    match S2TW
        .get_or_init(|| ferrous_opencc::OpenCC::from_config(ferrous_opencc::config::BuiltinConfig::S2tw).ok())
    {
        Some(cc) => cc.convert(text),
        None => text.to_string(), // 對齊 JS：轉換器掛了回原文
    }
}

async fn fetch_json(state: &AppState, url: &str) -> Option<Value> {
    let r = state
        .http
        .get(url)
        .header("User-Agent", "koimsurai.com daily-quote")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !r.status().is_success() {
        return None;
    }
    serde_json::from_str(&r.text().await.ok()?).ok()
}

/// 各語系抓取器 → {text, from}；任一步失敗回 None（落 fallback）。
async fn fetch_quote(state: &AppState, locale: &str) -> Option<(String, String)> {
    match locale {
        "zh-TW" | "zh-CN" => {
            let j = fetch_json(state, &format!("{}/?c=a&c=b&c=d&c=i&c=k", state.external.hitokoto)).await?;
            let text = j.get("hitokoto")?.as_str()?.to_string();
            let from_who = j.get("from_who").and_then(|v| v.as_str()).unwrap_or("");
            let from_src = j.get("from").and_then(|v| v.as_str()).unwrap_or("");
            // [from_who, from].filter(Boolean).join('「') + (both ? '」' : '')
            let mut from =
                [from_who, from_src].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("「");
            if !from_who.is_empty() && !from_src.is_empty() {
                from.push('」');
            }
            if locale == "zh-TW" { Some((s2t(&text), s2t(&from))) } else { Some((text, from)) }
        }
        "en" => {
            let j = fetch_json(state, &format!("{}/api/today", state.external.zenquotes)).await?;
            let q = j.get(0)?;
            Some((q.get("q")?.as_str()?.to_string(), q.get("a")?.as_str()?.to_string()))
        }
        "ja" => {
            let j = fetch_json(state, &format!("{}/api/json.php?c=1", state.external.meigen)).await?;
            let q = j.get(0)?;
            // auther 是該 API 自己的拼字
            Some((q.get("meigen")?.as_str()?.to_string(), q.get("auther")?.as_str()?.to_string()))
        }
        "ko" => {
            let j = fetch_json(state, &format!("{}/api/advice", state.external.korean_advice)).await?;
            Some((j.get("message")?.as_str()?.to_string(), j.get("author")?.as_str()?.to_string()))
        }
        _ => None,
    }
}

// 快取存型別化的 DailyQuote 而不是 serde_json::Value —— 快取的東西就是端點回應本身，
// 用同一個型別就不可能快取到形狀不符的內容（同 watch/now、spotify top-* 的做法）。
static QUOTE_CACHE: std::sync::LazyLock<parking_lot::Mutex<std::collections::HashMap<String, DailyQuote>>> =
    std::sync::LazyLock::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

#[derive(Deserialize)]
pub struct QuoteQuery {
    locale: Option<String>,
}

/// `GET /api/quote/daily` 的 quote。text/from 兩個來源都是字串：
/// 外部來源走 fetch_quote → Option<(String, String)>，失敗時走 fallback_pool
/// 的 &'static [(&str, &str)]。前端手寫版把 from 標成可選，實際上一定有值。
#[derive(Debug, Clone, Serialize, specta::Type, utoipa::ToSchema)]
pub struct DailyQuote {
    pub text: String,
    pub from: String,
}

/// `GET /api/quote/daily`
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct DailyQuoteResponse {
    pub message: String,
    pub quote: DailyQuote,
}

/// `GET /api/quote/daily?locale=zh-TW`
#[utoipa::path(get, path = "/api/quote/daily", tag = "misc",
    responses((status = 200, body = DailyQuoteResponse)))]
pub async fn quote_daily(State(state): State<AppState>, Query(q): Query<QuoteQuery>) -> Response {
    let locale = q.locale.as_deref().filter(|l| SUPPORTED.contains(l)).unwrap_or("zh-TW").to_string();
    // today = toISOString().slice(0,10)＝UTC 日期（JS 語意）
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let key = format!("{today}|{locale}");

    // 先 clone 出來讓 guard 在這一行結束就釋放：寫成 `if let Some(x) = LOCK.lock()…`
    // 的話 guard 會活到整個 if-let 結束（含 body），臨界區平白變長。
    let cached = QUOTE_CACHE.lock().get(&key).cloned();
    if let Some(cached) = cached {
        return quote_resp(cached);
    }

    let quote = if let Some((text, from)) = fetch_quote(&state, &locale).await.filter(|(t, _)| !t.is_empty())
    {
        DailyQuote { text, from }
    } else {
        tracing::warn!("[quote] {locale} 來源失敗，用 fallback");
        // getDate() % pool.len＝本地時區「日」（TZ=Asia/Taipei）
        let day: usize = chrono::Local::now().format("%d").to_string().parse().unwrap_or(1);
        let pool = fallback_pool(&locale);
        let (t, f) = pool[day % pool.len()];
        DailyQuote { text: t.to_owned(), from: f.to_owned() }
    };
    {
        let mut cache = QUOTE_CACHE.lock();
        cache.insert(key, quote.clone());
        cache.retain(|k, _| k.starts_with(&today)); // 只留今天的 key
    }
    quote_resp(quote)
}

fn quote_resp(quote: DailyQuote) -> Response {
    (
        [(header::CACHE_CONTROL, "public, max-age=3600")],
        Json(DailyQuoteResponse { message: "success".into(), quote }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // ⚠ `QUOTE_CACHE` 是**全域 static**（不在 AppState 裡），所以同一個行程裡的測試
    // 會共用它。nextest 是一個測試一個行程，所以現況安全——但這也是為什麼下面每條
    // 測試都自己起一台 mock：不能靠「上一條測試留下的狀態」。

    async fn state_with_mock(server: &MockServer) -> AppState {
        let mut st = crate::state::test_state().await;
        st.external = std::sync::Arc::new(crate::state::ExternalUrls::all_pointing_at(&server.uri()));
        st
    }

    async fn body_of(resp: Response) -> Value {
        let bytes = http_body_util::BodyExt::collect(resp.into_body()).await.expect("collect").to_bytes();
        serde_json::from_slice(&bytes).expect("回應應該是 JSON")
    }

    async fn daily(st: AppState, locale: Option<&str>) -> Response {
        quote_daily(
            axum::extract::State(st),
            axum::extract::Query(QuoteQuery { locale: locale.map(str::to_owned) }),
        )
        .await
    }

    #[test]
    fn fallback_pool_每個語系都有自己的一份() {
        // 全部回同一個 pool 的話，日文版會顯示中文名言而沒有人會發現
        for (locale, first) in [
            ("zh-TW", "強大使人快樂。"),
            ("zh-CN", "强大使人快乐。"),
            ("en", "Stay hungry. Stay foolish."),
            ("ja", "夢を見るから、人生は輝く。"),
            ("ko", "음악은 인간의 내면으로부터 나오는 폭발이다."),
        ] {
            let pool = fallback_pool(locale);
            assert!(!pool.is_empty(), "{locale} 的 fallback 不能是空的");
            assert_eq!(pool[0].0, first, "{locale}");
            assert!(pool.iter().all(|(t, f)| !t.is_empty() && !f.is_empty()), "{locale} 有空欄位");
        }
        // 未知語系退繁中（跟 quote_daily 的 locale 驗證一致）
        assert_eq!(fallback_pool("de")[0].0, fallback_pool("zh-TW")[0].0);
    }

    #[test]
    fn s2t_把簡體轉成繁體() {
        assert_eq!(s2t("强大使人快乐。"), "強大使人快樂。");
        assert_eq!(s2t("宫崎骏"), "宮崎駿");
        // 本來就是繁體的不該被改壞
        assert_eq!(s2t("強大使人快樂。"), "強大使人快樂。");
        assert_eq!(s2t(""), "");
    }

    #[tokio::test]
    async fn zh_tw_會把一言的簡體轉成繁體_並照_js_的規則拼作者() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/hitokoto/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hitokoto": "迷惘的时候，就选比较难走的那条路。",
                "from_who": "宫崎骏",
                "from": "某作品",
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let v = body_of(daily(st, Some("zh-TW")).await).await;
        assert_eq!(v["quote"]["text"], "迷惘的時候，就選比較難走的那條路。", "簡體要轉繁體");
        assert_eq!(v["quote"]["from"], "宮崎駿「某作品」", "兩個都有時是 who「src」");
    }

    #[tokio::test]
    async fn zh_cn_不做繁簡轉換() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/hitokoto/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hitokoto": "强大使人快乐。", "from_who": "", "from": "一拳超人",
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let v = body_of(daily(st, Some("zh-CN")).await).await;
        assert_eq!(v["quote"]["text"], "强大使人快乐。", "简中版不能被轉成繁體");
        assert_eq!(v["quote"]["from"], "一拳超人", "只有一個來源時不加引號");
    }

    #[tokio::test]
    async fn 一言的作者只有其中一個時不會多出引號() {
        for (who, src, want) in [("宫崎骏", "", "宫崎骏"), ("", "一拳超人", "一拳超人"), ("", "", "")]
        {
            // ⚠ 每一輪都要清快取。`QUOTE_CACHE` 是全域的、key 只有「日期|語系」，
            // 所以同一輪測試裡的第二次呼叫會直接吃到第一次的結果——第一版就是這樣紅的，
            // 而且錯誤訊息（拿到上一組的作者）完全看不出原因。
            QUOTE_CACHE.lock().clear();
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/hitokoto/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "hitokoto": "内容", "from_who": who, "from": src,
                })))
                .mount(&server)
                .await;
            let st = state_with_mock(&server).await;
            let v = body_of(daily(st, Some("zh-CN")).await).await;
            assert_eq!(v["quote"]["from"], want, "who={who:?} src={src:?}");
        }
    }

    #[tokio::test]
    async fn 英日韓各自的欄位名都不一樣() {
        // 三個 API 的欄位名毫無共通性（ja 那支甚至把 author 拼成 auther）。
        // 挑錯欄位的話 text 會是空的 → 走 fallback，畫面上看起來完全正常。
        let cases: [(&str, &str, serde_json::Value, &str, &str); 3] = [
            (
                "en",
                "/zenquotes/api/today",
                serde_json::json!([{ "q": "Stay hungry.", "a": "Steve Jobs" }]),
                "Stay hungry.",
                "Steve Jobs",
            ),
            (
                "ja",
                "/meigen/api/json.php",
                serde_json::json!([{ "meigen": "夢を見るから。", "auther": "モーツァルト" }]),
                "夢を見るから。",
                "モーツァルト",
            ),
            (
                "ko",
                "/korean-advice/api/advice",
                serde_json::json!({ "message": "천 리 길도 한 걸음부터.", "author": "속담" }),
                "천 리 길도 한 걸음부터.",
                "속담",
            ),
        ];
        for (locale, p, body, want_text, want_from) in cases {
            QUOTE_CACHE.lock().clear(); // 理由同上（這裡語系不同其實撞不到，保險起見一致處理）
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path(p))
                .respond_with(ResponseTemplate::new(200).set_body_json(body))
                .mount(&server)
                .await;
            let st = state_with_mock(&server).await;
            let v = body_of(daily(st, Some(locale)).await).await;
            assert_eq!(v["quote"]["text"], want_text, "{locale} 的正文欄位");
            assert_eq!(v["quote"]["from"], want_from, "{locale} 的作者欄位");
        }
    }

    #[tokio::test]
    async fn 來源掛掉時用_fallback_而不是回空白() {
        let server = MockServer::start().await; // 不掛任何 route → 一律 404
        let st = state_with_mock(&server).await;
        let v = body_of(daily(st, Some("en")).await).await;

        let text = v["quote"]["text"].as_str().unwrap();
        assert!(!text.is_empty(), "來源掛了也不能回空字串——首頁會出現一塊空白");
        assert!(
            fallback_pool("en").iter().any(|(t, _)| *t == text),
            "應該取自 en 的 fallback pool，得到 {text}"
        );
        assert!(!v["quote"]["from"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn 來源回了空正文一樣走_fallback() {
        // `.filter(|(t, _)| !t.is_empty())` 那條：上游有回但正文是空字串，
        // 不擋掉的話首頁就是一塊空白，而且沒有任何錯誤。
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/zenquotes/api/today"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([{ "q": "", "a": "" }])))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;
        let v = body_of(daily(st, Some("en")).await).await;
        let text = v["quote"]["text"].as_str().unwrap();
        assert!(fallback_pool("en").iter().any(|(t, _)| *t == text), "得到 {text}");
    }

    #[tokio::test]
    async fn 同一天同一語系只打一次上游() {
        // 快取的意義就是「隨機名言穩定一天」＋不要每次載入首頁都去打別人的 API。
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/korean-advice/api/advice"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "message": "천 리 길도 한 걸음부터.", "author": "속담",
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        let first = body_of(daily(st.clone(), Some("ko")).await).await;
        let second = body_of(daily(st.clone(), Some("ko")).await).await;
        let third = body_of(daily(st, Some("ko")).await).await;
        assert_eq!(first["quote"], second["quote"], "同一天要回同一則");
        assert_eq!(second["quote"], third["quote"]);
        assert_eq!(server.received_requests().await.unwrap().len(), 1, "第二、三次應該吃快取，不該再打上游");
    }

    #[tokio::test]
    async fn 不支援的語系退回繁中且不會拿它去組快取_key() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/hitokoto/"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hitokoto": "内容", "from_who": "作者", "from": "",
            })))
            .mount(&server)
            .await;
        let st = state_with_mock(&server).await;

        // de 不在支援清單 → 走 zh-TW（會打一言，而不是別的來源）
        let v = body_of(daily(st.clone(), Some("de")).await).await;
        assert_eq!(v["quote"]["from"], "作者");
        // 沒帶 locale 也一樣
        let v2 = body_of(daily(st, None).await).await;
        assert_eq!(v2["quote"], v["quote"], "兩者應該共用同一個快取 key（都是 zh-TW）");
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn 回應帶一小時的_cache_control() {
        let server = MockServer::start().await;
        let st = state_with_mock(&server).await;
        let resp = daily(st, Some("en")).await;
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=3600",
            "首頁每次載入都會打這支，沒有快取標頭等於白白多一次來回"
        );
    }
}
