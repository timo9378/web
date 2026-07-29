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
            let j = fetch_json(state, "https://v1.hitokoto.cn/?c=a&c=b&c=d&c=i&c=k").await?;
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
            let j = fetch_json(state, "https://zenquotes.io/api/today").await?;
            let q = j.get(0)?;
            Some((q.get("q")?.as_str()?.to_string(), q.get("a")?.as_str()?.to_string()))
        }
        "ja" => {
            let j = fetch_json(state, "https://meigen.doodlenote.net/api/json.php?c=1").await?;
            let q = j.get(0)?;
            // auther 是該 API 自己的拼字
            Some((q.get("meigen")?.as_str()?.to_string(), q.get("auther")?.as_str()?.to_string()))
        }
        "ko" => {
            let j = fetch_json(state, "https://korean-advice-open-api.vercel.app/api/advice").await?;
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

    if let Some(cached) = QUOTE_CACHE.lock().get(&key).cloned() {
        return quote_resp(cached);
    }

    let quote = match fetch_quote(&state, &locale).await.filter(|(t, _)| !t.is_empty()) {
        Some((text, from)) => DailyQuote { text, from },
        None => {
            tracing::warn!("[quote] {locale} 來源失敗，用 fallback");
            // getDate() % pool.len＝本地時區「日」（TZ=Asia/Taipei）
            let day: usize = chrono::Local::now().format("%d").to_string().parse().unwrap_or(1);
            let pool = fallback_pool(&locale);
            let (t, f) = pool[day % pool.len()];
            DailyQuote { text: t.to_owned(), from: f.to_owned() }
        }
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
