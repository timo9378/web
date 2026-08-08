//! OG 圖產生（`GET /api/og/:id.png`）。
//!
//! ## 為什麼從 resvg 換成 takumi
//!
//! 舊版是 Express 時代留下來的做法：手工組一段 SVG 字串 → resvg 光柵化。
//! 問題不在 resvg（它光柵化得很好），在 **SVG 沒有排版引擎**——`<text>` 不會換行，
//! 所以斷行得自己算。那份自製的 `wrap_title` 是「數 UTF-16 單位、滿 16 個就換行」，
//! 而它在線上產出過壞圖：
//!
//!   · `,在 Windows 上撞穿整條` —— 逗號被推到行首。CJK 排版的基本禁則（標點不能起首）
//!     它完全不知道。
//!   · `ct2rs × CTr…` —— `CTranslate2` 被切在字母中間。它不認得單字邊界。
//!   · 英文標題更慘：16 個字元一行，`Why I switched f` / `rom VS Code to Z` /
//!     `ed and never loo`，56 個字只顯示 48 個。因為它數的是「字元」而不是「寬度」，
//!     而一個 CJK 字的寬度大約是一個拉丁字母的兩倍。
//!
//! takumi 內含 taffy（flexbox）、parley（文字排版）與 icu_segmenter（斷行規則），
//! 上面三件事都由引擎處理。換過去之後 `wrap_title` 連同它那批對拍測試整個刪掉——
//! 那些測試釘的是「我們自己算得跟 JS 一樣」，而現在根本不需要自己算。
//!
//! ## 字型
//!
//! ⚠ takumi **不吃系統字型**（跟 resvg 的 fontdb 不同）。CJK 一定要自己註冊，
//! 否則中文全部變成豆腐——而且**不會報錯**，只是圖裡沒有字。
//! 容器裡的 `fonts-noto-cjk` 仍然要裝，只是改由我們讀檔案。見 `load_cjk_font`。

use std::sync::Arc;

use axum::{
    extract::{Path, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use parking_lot::Mutex;
use takumi::prelude::*;

use crate::state::AppState;

const OG_WIDTH: u32 = 1200;
const OG_HEIGHT: u32 = 630;

/// HTML 屬性／文字節點的轉義。
///
/// 模板是字串組裝，所以標題仍然要轉義——這點跟 SVG 時代一樣。
/// （改用 node tree 就不需要，但那樣模板會變成一大串 builder 呼叫，比較難讀。）
fn esc_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// OG 卡片的 HTML。
///
/// ⚠ 根節點要自己撐滿畫布（`width/height: 100%`）——takumi 不會替你做，
///   忘了的話內容會擠在左上角。
///
/// ⚠ 標題的 `line-clamp: 3` 是舊版 `wrap_title(t, 16, 3)` 的替代品，差別是它按
///   **實際寬度**斷行、而且只在合法的斷點斷（標點不起首、單字不切半）。
///
/// ⚠ 省略號要靠 `text-overflow: ellipsis`，**不是** `line-clamp` 自己加的。
///   這是試出來的，三種寫法的實際結果：
///     `line-clamp:3` 單獨用            → 正確截成三行，但**沒有省略號**
///     `max-lines:3; block-ellipsis:auto` → 完全沒截，變五行把頁尾擠出畫面
///     `…; continue:discard`            → 整段 style 被丟掉（字級／顏色全失效）
///   所以是 `line-clamp:3` + `text-overflow:ellipsis`。動這兩行之前先跑 `產生樣張`。
fn build_html(title: &str, category: Option<&str>, date: &str) -> String {
    let cat = category.filter(|c| !c.is_empty()).unwrap_or("手記");
    format!(
        r##"<div style="
  width:100%; height:100%; display:flex; flex-direction:column; justify-content:space-between;
  padding:80px; box-sizing:border-box; font-family:'Noto Sans CJK TC';
  background-color:#11102a;
  background-image:
    radial-gradient(45% 45% at 85% 20%, rgba(127,90,240,0.55), rgba(127,90,240,0)),
    linear-gradient(135deg, #0a0a1a 0%, #11102a 50%, #1a0a2e 100%);
">
  <div style="display:flex; flex-direction:column;">
    <div style="width:120px; height:4px; border-radius:2px;
      background-image:linear-gradient(90deg, #e0c3fc, #7f5af0, #dc3278);"></div>
    <div style="margin-top:24px; font-size:28px; font-weight:600; color:#c4b5fd; letter-spacing:2px;">{cat}</div>
  </div>

  <div style="font-size:76px; font-weight:700; line-height:1.25; color:#ffffff;
    line-clamp:3; text-overflow:ellipsis;">{title}</div>

  <div style="display:flex; flex-direction:row; align-items:center; justify-content:space-between;">
    <div style="font-size:26px; color:rgba(255,255,255,0.55);">{date} · koimsurai.com</div>
    <div style="font-size:32px; font-weight:700;
      background-image:linear-gradient(90deg, #e0c3fc, #7f5af0, #dc3278);
      background-clip:text; color:transparent;">Koimsurai</div>
  </div>
</div>"##,
        cat = esc_html(&cat.to_uppercase()),
        title = esc_html(title.trim()),
        date = esc_html(date),
    )
}

/// 進程級狀態：字型（載一次共用）+ OG 快取（無 TTL，對齊 Express 的 `_ogCache`）。
struct OgState {
    fonts: Fonts,
    cache: Mutex<std::collections::HashMap<i64, CachedOg>>,
}
struct CachedOg {
    png: Arc<Vec<u8>>,
    etag: String,
    key: String,
}
static OG: std::sync::OnceLock<OgState> = std::sync::OnceLock::new();

/// Debian 的 `fonts-noto-cjk` 裝出來的路徑。多列一個 Bold 是因為標題是 700——
/// 少了它 takumi 會用合成粗體（font-synthesis），中文的合成粗體很糊。
///
/// ⚠ 這裡刻意**不 panic**。字型讀不到時仍然要能出圖（拉丁字用內建的 Geist），
/// 只是中文會變豆腐——而那至少還看得出「圖有產出、字型掛了」，比整條端點 500 好查。
const CJK_FONTS: [&str; 2] = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
];

fn load_cjk_font() -> Fonts {
    let mut fonts = Fonts::default();
    let mut loaded = 0usize;
    for path in CJK_FONTS {
        match std::fs::read(path) {
            // register 回傳它註冊到的 family 清單（.ttc 一個檔可能含多個），這裡只在意成敗
            Ok(bytes) => match fonts.register(FontResource::new(bytes)) {
                Ok(families) => {
                    tracing::info!("[OG] 載入字型 {path}（{} 個 family）", families.len());
                    loaded += 1;
                }
                Err(e) => tracing::error!("[OG] 字型註冊失敗 {path}: {e}"),
            },
            Err(e) => tracing::error!("[OG] 讀不到字型 {path}: {e}"),
        }
    }
    if loaded == 0 {
        // 這一行要夠大聲：症狀是「OG 圖裡的中文全變方框」，而端點仍然回 200
        tracing::error!("[OG] 一個 CJK 字型都沒載到——OG 圖的中文會是豆腐。容器裝了 fonts-noto-cjk 嗎？");
    }
    fonts
}

fn og_state() -> &'static OgState {
    OG.get_or_init(|| OgState { fonts: load_cjk_font(), cache: Mutex::new(std::collections::HashMap::new()) })
}

/// HTML → PNG（CPU 密集，呼叫端丟 spawn_blocking）。
fn render_png(html: &str, fonts: &Fonts) -> anyhow::Result<Vec<u8>> {
    let node = Node::from_html(html, FromHtmlOptions::default())
        .map_err(|e| anyhow::anyhow!("takumi from_html: {e}"))?;
    // 宣告內容語言。OG 端點用的是預設語系的標題，而站上的預設是 zh-Hant。
    //
    // ⚠ 這**不會**消掉 render 時 stderr 上那幾行
    //   `ICU4X data error: No segmentation model for language: ja`。
    //   我原本以為會，實測沒有——那是 parley 在字型層決定語言標記時發出的，
    //   跟這裡設的 lang 是兩條路徑。
    //
    //   它是無害的：斷行仍然正確（實測標點沒有跑到行首、單字沒有被切開），
    //   缺的只是日文的「詞典式斷詞」——而中文標題本來就用不到那個。
    //   之所以不去壓掉它：那要嘛換掉 icu 的 data provider、要嘛把 stderr 蓋掉，
    //   兩個都比這行雜訊更糟。OG 有快取，每篇文章實際只會 render 一次。
    let lang = Lang::parse("zh-Hant").ok();
    let options = RenderOptions::builder()
        .viewport(Viewport::new((OG_WIDTH, OG_HEIGHT)))
        .node(node)
        .fonts(fonts)
        .lang(lang)
        .build();
    let image = takumi::render(options).map_err(|e| anyhow::anyhow!("takumi render: {e}"))?;
    let mut out = Vec::new();
    takumi::write_image(&image, &mut out, OutputFormat::Png)
        .map_err(|e| anyhow::anyhow!("takumi encode: {e}"))?;
    Ok(out)
}

/// ETag 用的雜湊。FNV-1a：不需要相依、跨版本永遠決定性（ETag 會被客戶端與 CDN
/// 存著，換 Rust 版本就變值的話等於每次升級都讓全站的圖失效）。
///
/// ⚠️ 這裡原本是 `base64(cacheKey).slice(0, 12)`（照抄 Express）。那是**壞的**：
/// 12 個 base64 字元只編碼 9 個 byte，而 cacheKey 是 `{id}::{時間戳}::{標題}`——
/// 前 9 個 byte 只到 `1::2026-0`。也就是說標題與大部分時間戳從來沒有進入 ETag，
/// 同一篇文章改標題前後算出來是同一個值（實測驗證過）。
///
/// 後果不是「少了最佳化」而是**讀者看到舊圖**：站長改標題後伺服器端快取會失效並
/// 重新產圖，但 ETag 沒變 → 下一個帶著舊 ETag 來的讀者拿到 304 →
/// 他的瀏覽器繼續用舊圖，而且不會再問第二次。
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    h
}

fn text_resp(code: StatusCode, body: &'static str) -> Response {
    (code, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}

/// `GET /api/og/:file`（axum 不支援 `:id.png` 部分參數）——非 `.png` 後綴回 404。
#[utoipa::path(get, path = "/api/og/{file}", tag = "media",
    params(("file" = String, Path)),
    responses((status = 200, description = "OG 圖（PNG）"), (status = 304, description = "Not Modified（ETag 命中）"), (status = 404, description = "找不到"), (status = 500, description = "OG 產生失敗")))]
pub async fn og_png(State(state): State<AppState>, Path(file): Path<String>, req: Request) -> Response {
    let Some(id) = file.strip_suffix(".png") else {
        // 只處理 /og/:id.png；其他後綴 → 404（原委派 Express，已退役）
        return text_resp(StatusCode::NOT_FOUND, "not found");
    };
    let inm = req.headers().get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).map(String::from);

    let row = sqlx::query_as::<_, (i64, Option<String>, Option<String>, Option<String>, Option<String>)>(
        "SELECT id, title, category, created_at, updated_at FROM posts WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await;
    let (post_id, title, category, created_at, updated_at) = match row {
        Ok(Some(r)) => r,
        // err || !row → 404 'not found'
        _ => return text_resp(StatusCode::NOT_FOUND, "not found"),
    };
    let title = title.unwrap_or_default();
    // cacheKey = `${id}::${updated_at || created_at}::${title}`（js truthy：空字串也 fallback）
    let stamp = updated_at.filter(|s| !s.is_empty()).or(created_at.clone()).unwrap_or_default();
    let cache_key = format!("{post_id}::{stamp}::{title}");

    let og = og_state();
    {
        let cache = og.cache.lock();
        if let Some(c) = cache.get(&post_id)
            && c.key == cache_key
        {
            if inm.as_deref() == Some(c.etag.as_str()) {
                return StatusCode::NOT_MODIFIED.into_response();
            }
            return (
                [
                    (header::CONTENT_TYPE, "image/png".to_string()),
                    (header::ETAG, c.etag.clone()),
                    (header::CACHE_CONTROL, "public, max-age=300, s-maxage=86400".to_string()),
                ],
                c.png.as_ref().clone(),
            )
                .into_response();
        }
    }

    // date = (created_at || '').slice(0,10)
    let date = crate::util::js_substring_prefix(created_at.as_deref().unwrap_or(""), 10);
    let html = build_html(&title, category.as_deref(), &date);
    let png = match tokio::task::spawn_blocking(move || render_png(&html, &og_state().fonts)).await {
        Ok(Ok(p)) => Arc::new(p),
        Ok(Err(e)) => {
            tracing::error!("[OG] 產圖失敗 (post {post_id}): {e}");
            return text_resp(StatusCode::INTERNAL_SERVER_ERROR, "og generation failed");
        }
        Err(e) => {
            tracing::error!("[OG] 產圖 task 掛了 (post {post_id}): {e}");
            return text_resp(StatusCode::INTERNAL_SERVER_ERROR, "og generation failed");
        }
    };
    let etag = format!("\"og-{post_id}-{:016x}\"", fnv1a(&cache_key));
    og.cache.lock().insert(post_id, CachedOg { png: png.clone(), etag: etag.clone(), key: cache_key });
    (
        [
            (header::CONTENT_TYPE, "image/png".to_string()),
            (header::ETAG, etag),
            (header::CACHE_CONTROL, "public, max-age=300, s-maxage=86400".to_string()),
        ],
        png.as_ref().clone(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ETag 的雜湊必須涵蓋**整個** cache key。
    ///
    /// 回歸測試：原本是 `base64(cacheKey).slice(0, 12)`，而 12 個 base64 字元
    /// 只編碼 9 個 byte——cacheKey 是 `{id}::{時間戳}::{標題}`，前 9 個 byte
    /// 只到 `1::2026-0`。下面前兩組在舊寫法下算出來是**同一個值**。
    #[test]
    fn etag_雜湊要涵蓋整個_cache_key() {
        let a = fnv1a("1::2026-08-03 20:00:00::公開文章");
        let b = fnv1a("1::2026-02-01 00:00:00::改過的標題");
        let c = fnv1a("1::2026-08-03 20:00:00::公開文章 "); // 只差一個空白
        assert_ne!(a, b, "改了標題與時間戳卻算出同一個 ETag——讀者會一直看到舊圖");
        assert_ne!(a, c, "只差一個字元也要換值");
        // 同樣的輸入永遠是同樣的輸出（ETag 存在客戶端與 CDN，不能每次重啟就變）
        assert_eq!(a, fnv1a("1::2026-08-03 20:00:00::公開文章"));
        // 空字串也要能算（沒有標題、沒有時間戳的文章）
        assert_ne!(fnv1a(""), fnv1a("1::::"));
    }

    #[test]
    fn esc_html_轉義五個特殊字元() {
        assert_eq!(esc_html(r#"a&b<c>d"e'f"#), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
    }

    /// 標題直接來自使用者輸入，`</div>` 之類的東西不能把模板打斷。
    #[test]
    fn 標題裡的標籤不會逃出模板() {
        let html = build_html("</div><script>alert(1)</script>", None, "2026-08-09");
        assert!(!html.contains("<script>"), "原始 <script> 進了模板：{html}");
        assert!(html.contains("&lt;script&gt;"));
    }

    /// 分類是空的時候要退回「手記」（沿用 Express 的行為）。
    #[test]
    fn 空分類退回手記() {
        assert!(build_html("t", None, "d").contains("手記"));
        assert!(build_html("t", Some(""), "d").contains("手記"));
        assert!(build_html("t", Some("技術"), "d").contains("技術"));
    }

    /// ⚠ 這是換掉 resvg 之後最重要的一條：**真的把圖畫出來**。
    ///
    /// 舊版的測試釘的是「SVG 字串長得對」，但那證明不了圖畫得出來——
    /// 模板寫壞、字型沒載到、takumi API 換了，SVG 字串測試通通照過。
    /// 這條走完整條路徑（HTML → 排版 → 光柵化 → PNG），並檢查輸出真的是
    /// 1200×630 的 PNG。
    #[test]
    fn 長標題也畫得出正確尺寸的_png() {
        let fonts = load_cjk_font();
        // 遠超過三行的標題：舊版會在這裡把字元硬切掉，新版交給 line-clamp
        let long = "把 NLLB 翻譯接進 Rust,在 Windows 上撞穿整條工具鏈：ct2rs × CTranslate2 的 protobuf 撞名、CRT 之爭、關閉死鎖與 NVIDIA 崩潰";
        let png =
            render_png(&build_html(long, Some("位元築夢"), "2026-07-21"), &fonts).expect("長標題要畫得出來");
        // PNG magic
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a], "輸出不是 PNG");
        // IHDR 的寬高（big-endian u32，位移 16/20）
        let w = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        let h = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
        assert_eq!((w, h), (OG_WIDTH, OG_HEIGHT), "尺寸不對");
    }

    /// 空標題、空日期也不能炸——資料庫裡真的有這種列。
    #[test]
    fn 空輸入不會_panic() {
        let fonts = load_cjk_font();
        assert!(render_png(&build_html("", None, ""), &fonts).is_ok());
    }

    /// 把幾張樣張寫到 `/tmp/og-preview/`，用眼睛看。
    ///
    /// 這條**不是斷言**，是工具——排版對不對（有沒有壓到邊、標點有沒有跑到行首、
    /// 長標題截在哪）只有看得出來。改動模板時跑它：
    ///
    ///   cargo test --lib og::tests::產生樣張 -- --ignored --nocapture
    #[test]
    #[ignore = "產生樣張供人工檢視，不做斷言"]
    fn 產生樣張() {
        let fonts = load_cjk_font();
        let dir = std::path::Path::new("/tmp/og-preview");
        std::fs::create_dir_all(dir).unwrap();
        let cases: [(&str, &str, Option<&str>); 5] = [
            (
                "cjk-long",
                "把 NLLB 翻譯接進 Rust,在 Windows 上撞穿整條工具鏈：ct2rs × CTranslate2 的 protobuf 撞名、CRT 之爭、關閉死鎖與 NVIDIA 崩潰",
                Some("位元築夢"),
            ),
            ("cjk-short", "為什麼我從 VS Code 換到 Zed", Some("技術")),
            ("latin-long", "Why I switched from VS Code to Zed and never looked back", Some("Tech")),
            ("mixed", "CrowdSec 取代 fail2ban：從一次被掃到脫褲子說起", None),
            ("empty", "", None),
        ];
        for (name, title, cat) in cases {
            let png = render_png(&build_html(title, cat, "2026-08-09"), &fonts).unwrap();
            let path = dir.join(format!("{name}.png"));
            std::fs::write(&path, &png).unwrap();
            println!("{} → {}", path.display(), png.len());
        }
    }
}
