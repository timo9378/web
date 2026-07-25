//! 全站 RSS（`/rss`，app-level 非 /api）。移植 index.js 的 /rss。
//! 行為清理註記：Express 的 `new Date(created_at)`（無 'Z'）在 TZ=Asia/Taipei 下把 DB 的
//! UTC 時間誤當本地時間（pubDate 偏 8h）；此處採正確版（當 UTC 解析），退役後無對拍對象。

use axum::{
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};

use crate::state::AppState;
use crate::util::{js_date_to_utc_string, js_substring_prefix};

/// escXml（/rss 版）：& < > "（**不含 '**，與 og 的 5-char 版不同，照抄）。
fn esc_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[utoipa::path(get, path = "/rss", tag = "misc",
    responses((status = 200, description = "全站 RSS feed（XML）")))]
pub async fn site_rss(State(state): State<AppState>) -> Response {
    let site_url = std::env::var("SITE_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://koimsurai.com".into());
    type Row = (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let rows = sqlx::query_as::<_, Row>(
        "SELECT p.id, p.title, p.excerpt, p.content, p.created_at, p.updated_at, p.author, p.category, \
                GROUP_CONCAT(t.name) as tags \
         FROM posts p \
         LEFT JOIN post_tags pt ON p.id = pt.post_id \
         LEFT JOIN tags t ON pt.tag_id = t.id \
         WHERE p.status = 'published' \
         GROUP BY p.id ORDER BY p.created_at DESC LIMIT 30",
    )
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(_) => {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                "Internal Server Error",
            )
                .into_response();
        }
    };

    let now_str = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let last_build = rows
        .first()
        .map(|r| js_date_to_utc_string(r.5.as_deref().or(r.4.as_deref())))
        .unwrap_or_else(|| js_date_to_utc_string(Some(&now_str)));

    static TAG_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"<[^>]+>").unwrap());
    static MD_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"[#*`>\-\n]").unwrap());

    let items: Vec<String> = rows
        .iter()
        .map(|(id, title, excerpt, content, created_at, _updated_at, author, category, tags)| {
            // desc = excerpt || content 去 HTML/markdown、trim、slice(0,300)
            let desc = match excerpt.as_deref().filter(|s| !s.is_empty()) {
                Some(e) => e.to_string(),
                None => {
                    let c = content.as_deref().unwrap_or("");
                    let no_tag = TAG_RE.replace_all(c, "");
                    let no_md = MD_RE.replace_all(&no_tag, " ");
                    js_substring_prefix(no_md.trim(), 300)
                }
            };
            let cats: String = tags
                .as_deref()
                .unwrap_or("")
                .split(',')
                .filter(|t| !t.trim().is_empty())
                .map(|t| format!("<category>{}</category>", esc_xml(t.trim())))
                .collect();
            let cat_line = category
                .as_deref()
                .filter(|c| !c.is_empty())
                .map(|c| format!("<category>{}</category>", esc_xml(c)))
                .unwrap_or_default();
            format!(
                "    <item>\n      <title>{}</title>\n      <link>{site_url}/blog/{id}</link>\n      <guid isPermaLink=\"true\">{site_url}/blog/{id}</guid>\n      <description>{}</description>\n      <author>{}</author>\n      <pubDate>{}</pubDate>\n      {}\n      {}\n    </item>",
                esc_xml(title.as_deref().unwrap_or("")),
                esc_xml(&desc),
                esc_xml(author.as_deref().filter(|a| !a.is_empty()).unwrap_or("Koimsurai")),
                js_date_to_utc_string(created_at.as_deref()),
                cat_line,
                cats,
            )
        })
        .collect();

    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\">\n  <channel>\n    <title>Koimsurai 手記</title>\n    <link>{site_url}/blog</link>\n    <description>Koimsurai 的個人部落格 — 技術筆記、生活隨筆、影集心得</description>\n    <language>zh-TW</language>\n    <lastBuildDate>{last_build}</lastBuildDate>\n    <atom:link href=\"{site_url}/rss\" rel=\"self\" type=\"application/rss+xml\"/>\n{}\n  </channel>\n</rss>",
        items.join("\n")
    );
    ([(header::CONTENT_TYPE, "application/rss+xml; charset=utf-8")], xml).into_response()
}
