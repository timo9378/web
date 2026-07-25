//! OG 圖產生（sharp 硬骨頭）。移植 Express `/og/:id.png`。
//!
//! Express：SVG 模板（純字串組裝）→ sharp（librsvg）光柵化 → PNG。
//! Rust：同一份 SVG 模板 → **resvg** 光柵化 → PNG。SVG 字串/ETag/headers/404/304
//! 為確定性可對拍；PNG bytes 因渲染引擎不同必異（驗尺寸+視覺）。
//! 字型：吃系統字型（容器需裝 Noto Sans CJK，與 Express 容器一致）。

use std::sync::Arc;

use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use base64::Engine;
use parking_lot::Mutex;
use resvg::{tiny_skia, usvg};

use crate::state::AppState;

/// `_escXml`：& < > " ' → 實體（單 pass，對齊 JS 單一 regex replace）。
fn esc_xml(s: &str) -> String {
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

/// `_wrapTitle`：JS 混合語意精確複製——`for...of` 按 code point 迭代、
/// `line.length`/`t.length` 按 **UTF-16** 計數、`slice(0, max-1)` 按 UTF-16 截斷。
fn wrap_title(title: &str, max_chars_per_line: usize, max_lines: usize) -> Vec<String> {
    let t = title.trim();
    let t_len16 = t.encode_utf16().count();
    let mut out: Vec<String> = Vec::new();
    let mut line = String::new();
    for ch in t.chars() {
        if line.encode_utf16().count() >= max_chars_per_line {
            out.push(std::mem::take(&mut line));
            if out.len() >= max_lines {
                break;
            }
        }
        line.push(ch);
    }
    if !line.is_empty() && out.len() < max_lines {
        out.push(line);
    }
    let joined16: usize = out.iter().map(|l| l.encode_utf16().count()).sum();
    if out.len() == max_lines && t_len16 > joined16
        && let Some(last) = out.last_mut() {
            let truncated = crate::util::js_substring_prefix(last, max_chars_per_line - 1);
            *last = format!("{truncated}…");
        }
    out
}

/// SVG 模板：與 Express 逐字相同（可對拍字串）。
fn build_svg(title: &str, category: Option<&str>, date: &str) -> String {
    let lines = wrap_title(title, 16, 3);
    let cat = category.filter(|c| !c.is_empty()).unwrap_or("手記");
    let title_svg: String = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            format!(
                r##"<text x="80" y="{}" font-family="Noto Sans CJK TC, HarmonyOS Sans SC, sans-serif" font-size="76" font-weight="700" fill="#ffffff">{}</text>"##,
                250 + i * 90,
                esc_xml(l)
            )
        })
        .collect();
    format!(
        r##"<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a1a"/>
      <stop offset="50%" stop-color="#11102a"/>
      <stop offset="100%" stop-color="#1a0a2e"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e0c3fc"/>
      <stop offset="50%" stop-color="#7f5af0"/>
      <stop offset="100%" stop-color="#dc3278"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.2" r="0.45">
      <stop offset="0%" stop-color="#7f5af0" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#7f5af0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="80" y="84" width="120" height="4" fill="url(#brand)" rx="2"/>
  <text x="80" y="140" font-family="Noto Sans CJK TC, HarmonyOS Sans SC, sans-serif" font-size="28" font-weight="600" fill="#c4b5fd" letter-spacing="2">{}</text>
  {}
  <text x="80" y="560" font-family="Noto Sans CJK TC, HarmonyOS Sans SC, sans-serif" font-size="26" font-weight="400" fill="rgba(255,255,255,0.55)">{} · koimsurai.com</text>
  <text x="1120" y="560" text-anchor="end" font-family="Noto Sans CJK TC, HarmonyOS Sans SC, sans-serif" font-size="32" font-weight="700" fill="url(#brand)">Koimsurai</text>
</svg>"##,
        esc_xml(cat).to_uppercase(),
        title_svg,
        esc_xml(date)
    )
}

/// 進程級：字型庫（載一次共用）+ OG 快取（對齊 Express `_ogCache` Map，無 TTL）。
struct OgState {
    fontdb: Arc<usvg::fontdb::Database>,
    cache: Mutex<std::collections::HashMap<i64, CachedOg>>,
}
struct CachedOg {
    png: Arc<Vec<u8>>,
    etag: String,
    key: String,
}
static OG: std::sync::OnceLock<OgState> = std::sync::OnceLock::new();

fn og_state() -> &'static OgState {
    OG.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        OgState { fontdb: Arc::new(db), cache: Mutex::new(std::collections::HashMap::new()) }
    })
}

/// SVG → PNG（CPU 密集，呼叫端丟 spawn_blocking）。
fn rasterize(svg: &str, fontdb: Arc<usvg::fontdb::Database>) -> anyhow::Result<Vec<u8>> {
    let opt = usvg::Options { fontdb, ..Default::default() };
    let tree = usvg::Tree::from_data(svg.as_bytes(), &opt)?;
    let mut pixmap = tiny_skia::Pixmap::new(1200, 630).ok_or_else(|| anyhow::anyhow!("pixmap alloc"))?;
    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    Ok(pixmap.encode_png()?)
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
    let stamp = updated_at
        .filter(|s| !s.is_empty())
        .or(created_at.clone())
        .unwrap_or_default();
    let cache_key = format!("{post_id}::{stamp}::{title}");

    let og = og_state();
    {
        let cache = og.cache.lock();
        if let Some(c) = cache.get(&post_id)
            && c.key == cache_key {
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
    let svg = build_svg(&title, category.as_deref(), &date);
    let fontdb = og.fontdb.clone();
    let png = match tokio::task::spawn_blocking(move || rasterize(&svg, fontdb)).await {
        Ok(Ok(p)) => Arc::new(p),
        _ => return text_resp(StatusCode::INTERNAL_SERVER_ERROR, "og generation failed"),
    };
    // etag = `"og-${id}-${base64(cacheKey).slice(0,12)}"`（標準 base64，切 ASCII 前 12）
    let b64 = base64::engine::general_purpose::STANDARD.encode(cache_key.as_bytes());
    let etag = format!("\"og-{post_id}-{}\"", &b64[..b64.len().min(12)]);
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

    /// 對照 Express `_wrapTitle`（node 實跑輸出寫死於此）。
    #[test]
    fn wrap_title_matches_js() {
        // 16 全形字/行、3 行、超長截斷加 …
        assert_eq!(wrap_title("短標題", 16, 3), vec!["短標題"]);
        let t = "我想做一個 tool-calling 修復 proxy,結果 benchmark 親手殺死了這個產品";
        assert_eq!(
            wrap_title(t, 16, 3),
            vec!["我想做一個 tool-calli", "ng 修復 proxy,結果 b", "enchmark 親手殺死了這…"]
        );
        // 空白 trim
        assert_eq!(wrap_title("  a  ", 16, 3), vec!["a"]);
        // 空字串 → 空陣列
        assert_eq!(wrap_title("", 16, 3), Vec::<String>::new());
        // emoji surrogate pair（🐱=2 UTF-16 units）→ 第一行提早滿
        assert_eq!(
            wrap_title("emoji🐱測試混排的標題會怎麼斷行呢一二三四五六七八九十", 16, 3),
            vec!["emoji🐱測試混排的標題會怎", "麼斷行呢一二三四五六七八九十"]
        );
        // 剛好 3 行整 → 不加省略號；超 1 字 → 截斷
        assert_eq!(wrap_title(&"A".repeat(48), 16, 3), vec!["A".repeat(16); 3]);
        assert_eq!(
            wrap_title(&"A".repeat(49), 16, 3),
            vec!["A".repeat(16), "A".repeat(16), format!("{}…", "A".repeat(15))]
        );
    }

    #[test]
    fn esc_xml_matches_js() {
        assert_eq!(esc_xml(r#"a&b<c>d"e'f"#), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
    }

    // ── property tests ────────────────────────────────────────────────
    // 上面的對拍測試釘的是「已知案例」；這裡釘的是「所有輸入都該成立的不變量」。
    // OG 標題直接來自使用者輸入的文章標題，CJK/emoji/組合字元都會進來。
    proptest::proptest! {
        /// 行數不超過 max_lines。
        #[test]
        fn wrap_title_respects_max_lines(t in ".{0,200}", max_chars in 1usize..40, max_lines in 1usize..6) {
            let out = wrap_title(&t, max_chars, max_lines);
            proptest::prop_assert!(out.len() <= max_lines, "got {} lines", out.len());
        }

        /// 每行長度上限：實作是「先檢查再 push char」，而一個 char 可能佔 2 個 UTF-16
        /// 單位（surrogate pair），所以單行最多可能超出 1 個單位——這是既有行為，
        /// 在此明確釘住，日後若改斷行邏輯會被這條擋下。
        #[test]
        fn wrap_title_line_length_bounded(t in ".{0,200}", max_chars in 1usize..40, max_lines in 1usize..6) {
            for line in wrap_title(&t, max_chars, max_lines) {
                let n = line.encode_utf16().count();
                proptest::prop_assert!(n <= max_chars + 1, "line {n} units > {max_chars}+1: {line:?}");
            }
        }

        /// 只有空白的輸入 → 空結果（trim 後為空）。
        #[test]
        fn wrap_title_blank_input_is_empty(t in "[ \t\n]{0,20}") {
            proptest::prop_assert!(wrap_title(&t, 16, 3).is_empty());
        }

        /// 轉義後不得殘留任何未轉義的 XML 特殊字元。
        #[test]
        fn esc_xml_leaves_no_raw_specials(s in ".{0,200}") {
            let out = esc_xml(&s);
            for c in ['<', '>', '"', '\''] {
                proptest::prop_assert!(!out.contains(c), "raw {c:?} left in {out:?}");
            }
            // '&' 只能以 entity 開頭的形式出現
            let stripped = out
                .replace("&amp;", "").replace("&lt;", "").replace("&gt;", "")
                .replace("&quot;", "").replace("&#39;", "");
            proptest::prop_assert!(!stripped.contains('&'), "unescaped & in {out:?}");
        }
    }
}
