//! OpenCC 簡繁轉換（硬骨頭）。移植 Express `index.js` 的 `/admin/posts/:id/generate-zh-cn`
//! ——把 zh-TW 原文（title/content/excerpt）以 OpenCC `tw2s`（繁台→簡）轉為 zh-CN 存回。
//!
//! Express 用 `opencc-js` 的 `Converter({from:'tw', to:'cn'})`。改用純 Rust `ferrous-opencc`
//! 的 `BuiltinConfig::Tw2s`：對 opencc-js 同輸入實測 **byte-identical**（33 真實文章欄位
//! + 20 對抗案例含 著作/著手 語境消歧、臺/台、隻/只 全一致），故可 byte-level A/B 對拍。
//!
//! `/quote/daily` 也用 opencc（cn→tw），但因外部隨機名言來源 + 每日快取狀態刻意留 proxy。

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use ferrous_opencc::{OpenCC, config::BuiltinConfig};
use serde_json::json;
use tokio::sync::OnceCell;

use crate::{auth::require_admin, state::AppState};

/// 進程級單例：`Tw2s` 轉換器建構（載入內建字典 → FST）較重，一次性建好共用。
/// 首次使用才建（admin-only、罕用，不拖慢啟動），且在 blocking 池建避免卡 async worker。
static TW2S: OnceCell<Arc<OpenCC>> = OnceCell::const_new();

async fn tw2s() -> anyhow::Result<Arc<OpenCC>> {
    TW2S.get_or_try_init(|| async {
        tokio::task::spawn_blocking(|| OpenCC::from_config(BuiltinConfig::Tw2s).map(Arc::new))
            .await
            .map_err(|e| anyhow::anyhow!("opencc 建構 join 失敗: {e}"))?
            .map_err(|e| anyhow::anyhow!("opencc 載入 tw2s 失敗: {e}"))
    })
    .await
    .cloned()
}

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

fn is_kana(c: char) -> bool {
    let u = c as u32;
    // 平假名 / 片假名 / 片假名語音擴充 / 半形片假名（長音符 ー U+30FC 已含在片假名區）
    (0x3041..=0x309F).contains(&u)
        || (0x30A0..=0x30FF).contains(&u)
        || (0x31F0..=0x31FF).contains(&u)
        || (0xFF66..=0xFF9F).contains(&u)
}

fn is_han(c: char) -> bool {
    let u = c as u32;
    (0x3400..=0x4DBF).contains(&u)
        || (0x4E00..=0x9FFF).contains(&u)
        || (0xF900..=0xFAFF).contains(&u)
        || (0x20000..=0x2A6DF).contains(&u)
}

/// 漢字或假名——連在一起才算同一個「詞串」（々〆 是日文的疊字/略字記號）
fn is_cjk_word_char(c: char) -> bool {
    is_kana(c) || is_han(c) || c == '々' || c == '〆'
}

/// tw2s 轉換，但**跳過日文**。
///
/// 為什麼需要：站上的文章常整段引用日文（歌詞、書名、專有名詞），而 OpenCC 只看字不看語言，
/// 會把日文漢字一起簡體化——`靴紐→靴纽`、`僕ら→仆ら`、`聞こえてる→闻こえてる`、
/// `貴方→贵方`。等於把引文竄改掉，而且轉換仍然回 success，不特地檢查根本不會發現。
///
/// 判定方式：把文字切成「連續的漢字＋假名」詞串，**只要該串含任何假名就整串視為日文**保留原樣，
/// 其餘部分照常轉換。漢字本身中日共用、無法單獨判斷語言，所以用假名當錨點。
///
/// 已知取捨：中文與日文之間沒有標點或空白時會過度保留（`聽ヨルシカ的歌` 整串被當日文，
/// `聽/的/歌` 保持繁體）。寧可少轉幾個字，也不要把引用的日文改壞——後者是不可逆的內容錯誤。
///
/// 未被保留的部分會盡量整段送進 OpenCC（而不是逐字轉），讓詞組級的語境消歧（著作/著手 之類）
/// 維持原本的行為。
fn convert_preserving_japanese(cc: &OpenCC, text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut pending = String::new();
    let mut i = 0;

    while i < chars.len() {
        if !is_cjk_word_char(chars[i]) {
            pending.push(chars[i]);
            i += 1;
            continue;
        }
        let start = i;
        let mut has_kana = false;
        while i < chars.len() && is_cjk_word_char(chars[i]) {
            has_kana |= is_kana(chars[i]);
            i += 1;
        }
        let run: String = chars[start..i].iter().collect();
        if has_kana {
            if !pending.is_empty() {
                out.push_str(&cc.convert(&pending));
                pending.clear();
            }
            out.push_str(&run);
        } else {
            pending.push_str(&run);
        }
    }
    if !pending.is_empty() {
        out.push_str(&cc.convert(&pending));
    }
    out
}

/// `POST /api/admin/posts/:id/generate-zh-cn` —— requireAdmin。
#[utoipa::path(post, path = "/api/admin/posts/{id}/generate-zh-cn", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "zh-CN 轉換結果（動態 JSON）"), (status = 400, description = "來源語言非 zh-TW 或缺 title/content"), (status = 401, description = "未授權"), (status = 404, description = "文章不存在"), (status = 500, description = "OpenCC 轉換或 DB 失敗")))]
pub async fn generate_zh_cn(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    // 對齊 Express：SELECT * 後只讀這幾欄
    let row = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, Option<String>)>(
        "SELECT source_language, title, content, excerpt FROM posts WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await;
    let (source_language, title, content, excerpt) = match row {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => return err(StatusCode::NOT_FOUND, "文章不存在"),
        Ok(Some(r)) => r,
    };

    // source_language || 'zh-TW'；非 zh-TW → 400
    let source = source_language.filter(|s| !s.is_empty()).unwrap_or_else(|| "zh-TW".into());
    if source != "zh-TW" {
        return err(StatusCode::BAD_REQUEST, "只能從 zh-TW 原文自動轉换為 zh-CN");
    }
    // !title || !content（含空字串）→ 400
    let title = title.filter(|s| !s.is_empty());
    let content = content.filter(|s| !s.is_empty());
    let (Some(title), Some(content)) = (title, content) else {
        return err(StatusCode::BAD_REQUEST, "原文缺少 title 或 content");
    };
    // excerpt ? t2s(excerpt) : null（空字串也視為無）
    let excerpt = excerpt.filter(|s| !s.is_empty());

    let cc = match tw2s().await {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("OpenCC 轉换失敗: {e}")),
    };
    // 轉換為 CPU 工作（content 可達數十 KB）→ 丟 blocking 池，不卡 async worker
    let converted = tokio::task::spawn_blocking(move || {
        let title_zh_cn = convert_preserving_japanese(&cc, &title);
        let content_zh_cn = convert_preserving_japanese(&cc, &content);
        let excerpt_zh_cn = excerpt.map(|e| convert_preserving_japanese(&cc, &e));
        (title_zh_cn, content_zh_cn, excerpt_zh_cn)
    })
    .await;
    let (title_zh_cn, content_zh_cn, excerpt_zh_cn) = match converted {
        Ok(v) => v,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("OpenCC 轉换失敗: {e}")),
    };

    let upd = sqlx::query(
        "UPDATE posts SET title_zh_cn = ?, content_zh_cn = ?, excerpt_zh_cn = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&title_zh_cn)
    .bind(&content_zh_cn)
    .bind(&excerpt_zh_cn)
    .bind(&id)
    .execute(&state.pool)
    .await;
    if let Err(e) = upd {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    Json(json!({
        "message": "success",
        "title_zh_cn": title_zh_cn,
        "content_zh_cn": content_zh_cn,
        "excerpt_zh_cn": excerpt_zh_cn,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cc() -> OpenCC {
        OpenCC::from_config(BuiltinConfig::Tw2s).expect("載入 tw2s")
    }

    /// 純中文照常轉，行為不能因為這次改動而變
    #[test]
    fn 純中文照常轉簡體() {
        let cc = cc();
        assert_eq!(convert_preserving_japanese(&cc, "這是繁體中文的測試"), "这是繁体中文的测试");
        assert_eq!(convert_preserving_japanese(&cc, "鞋帶鬆了開來"), "鞋带松了开来");
    }

    /// 迴歸：日文歌詞曾被轉成 `靴纽`/`仆ら`/`闻こえてる`，等於竄改引文
    #[test]
    fn 日文原樣保留() {
        let cc = cc();
        for s in [
            "靴紐が解けてる",
            "僕らは身体も脱ぎ去って",
            "息を吸う音だけ聞こえてる",
            "貴方は今立ち上がる",
            "鳥の鳴く声だけ聞こえてる",
            "貴方の眼は遠くを見る",
            "ヨルシカ",
            "老人と海",
        ] {
            assert_eq!(convert_preserving_japanese(&cc, s), s, "日文被改動了：{s}");
        }
    }

    /// 同一行混排時，中文要轉、日文要留
    #[test]
    fn 中日混排各自處理() {
        let cc = cc();
        assert_eq!(
            convert_preserving_japanese(&cc, "這首歌就是《老人と海》，聽了會平靜"),
            "这首歌就是《老人と海》，听了会平静",
        );
        assert_eq!(
            convert_preserving_japanese(&cc, "> (鞋帶鬆了開來 葉隙間流瀉的陽光)"),
            "> (鞋带松了开来 叶隙间流泻的阳光)",
        );
    }

    /// 詞組級消歧不能因為切段而失效（著作 vs 著手 是 tw2s 的經典案例）
    #[test]
    fn 詞組消歧維持原行為() {
        let cc = cc();
        for s in ["原著小說", "著手處理", "臺灣", "隻身一人"] {
            assert_eq!(convert_preserving_japanese(&cc, s), cc.convert(s), "切段影響了消歧：{s}");
        }
    }
}
