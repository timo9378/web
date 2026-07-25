//! Newsletter mailer（resend 硬骨頭）。移植 Express `mailer.js` + `/admin/posts/:id/send-newsletter`。
//!
//! Express 用 `resend` npm SDK 的 `batch.send`。改用 reqwest 直打 Resend batch API。
//! **wire byte-target**：`resend` SDK 的 `parseEmailToApiOptions` 把每封信轉成
//! `{from, headers, html, subject, text, to}`（其餘欄位 undefined→JSON.stringify 丟棄）。
//! ⚠️ **保留 Express bug**：mailer.js 傳 `reply_to`（snake），但 SDK 讀 `email.replyTo`（camel）
//! → `reply_to` 恆 undefined → **wire 不含 reply_to**（即使 NEWSLETTER_REPLY_TO 有設）。
//! 為遷移期 byte-equivalence，Rust **一併省略 reply_to**（記在行為清理版待修）。
//! 驗證方式：兩邊都 `RESEND_BASE_URL` 指本地 mock、比對實際 wire body（不真寄）。

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};

use crate::util::encode_uri_component;
use crate::{auth::require_admin, state::AppState};

const BATCH_SIZE: usize = 100;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string())
}
fn newsletter_from() -> String {
    env_or("NEWSLETTER_FROM", "Koimsurai <hello@koimsurai.com>")
}
fn public_site_url() -> String {
    // (PUBLIC_SITE_URL || default).replace(/\/$/, '')
    let raw = env_or("PUBLIC_SITE_URL", "https://koimsurai.com");
    raw.strip_suffix('/').unwrap_or(&raw).to_string()
}
fn resend_base_url() -> String {
    // 對齊 SDK：process.env.RESEND_BASE_URL || 'https://api.resend.com'
    env_or("RESEND_BASE_URL", "https://api.resend.com")
}

/// escapeHtml：& < > " ' → 實體（& 先）。
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn post_url(site: &str, post_id: &Value) -> String {
    format!("{site}/blog/{}", crate::util::js_interp(post_id))
}
fn unsubscribe_url(site: &str, token: &str) -> String {
    format!("{site}/unsubscribe?token={}", encode_uri_component(token))
}

struct Sub {
    email: String,
    name: Option<String>,
    token: String,
}
struct Post {
    id: Value,
    title: String,
    excerpt: Option<String>,
}

fn render_subject(post: &Post) -> String {
    format!("{} — Koimsurai 新文章", post.title)
}

fn render_text(site: &str, post: &Post, sub: &Sub) -> String {
    // [title, '', excerpt||'', '', `閱讀全文：${url}`, '', '— Koimsurai', '', `退訂：${unsub}`].join('\n')
    let url = post_url(site, &post.id);
    let unsub = unsubscribe_url(site, &sub.token);
    [
        post.title.clone(),
        String::new(),
        post.excerpt.clone().unwrap_or_default(),
        String::new(),
        format!("閱讀全文：{url}"),
        String::new(),
        "— Koimsurai".to_string(),
        String::new(),
        format!("退訂：{unsub}"),
    ]
    .join("\n")
}

fn render_email(site: &str, post: &Post, sub: &Sub) -> String {
    let title = escape_html(&post.title);
    // escapeHtml(post.excerpt||'').slice(0,320)（UTF-16 前綴）
    let excerpt = crate::util::js_substring_prefix(&escape_html(post.excerpt.as_deref().unwrap_or("")), 320);
    let url = post_url(site, &post.id);
    let unsub = unsubscribe_url(site, &sub.token);
    let greeting = match &sub.name {
        Some(n) if !n.is_empty() => format!("Hi {}，", escape_html(n)),
        _ => "Hi，".to_string(),
    };
    // post.excerpt && post.excerpt.length > 320 ? '…' : ''（原始 excerpt UTF-16 長度）
    let ellipsis = match &post.excerpt {
        Some(e) if !e.is_empty() && e.encode_utf16().count() > 320 => "…",
        _ => "",
    };
    // excerpt 區塊：excerpt(escaped+sliced 非空) ? <p>…</p> : ''
    let excerpt_block = if !excerpt.is_empty() {
        format!(
            "<p style=\"margin:0 0 24px 0;font-size:15px;line-height:1.75;color:rgba(231,227,247,0.75);\">\n          {excerpt}{ellipsis}\n        </p>"
        )
    } else {
        String::new()
    };
    let site_bare = site.strip_prefix("https://").or_else(|| site.strip_prefix("http://")).unwrap_or(site);

    format!(
        r#"<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#0c0a18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang TC','Noto Sans TC',sans-serif;color:#e7e3f7;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">
{excerpt} · Koimsurai 新文章上架
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0a18;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <!-- header -->
      <tr><td style="padding:8px 0 24px 0;">
        <a href="{site}" style="color:#c7b8ff;text-decoration:none;font-size:14px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;">
          ✦ Koimsurai
        </a>
      </td></tr>

      <!-- card -->
      <tr><td style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:36px 32px;">
        <p style="margin:0 0 18px 0;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(199,184,255,0.6);font-weight:600;">
          New Post
        </p>
        <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.4;color:#ffffff;font-weight:700;">
          {title}
        </h1>
        {excerpt_block}
        <p style="margin:8px 0 0 0;">
          <a href="{url}" style="display:inline-block;padding:11px 22px;background:rgba(199,184,255,0.08);border:1px solid rgba(199,184,255,0.35);color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px;font-weight:500;letter-spacing:0.02em;">
            閱讀全文 →
          </a>
        </p>
      </td></tr>

      <!-- greeting -->
      <tr><td style="padding:28px 4px 0 4px;font-size:13px;line-height:1.7;color:rgba(231,227,247,0.55);">
        {greeting}
        <br>
        感謝你訂閱 Koimsurai。如果今天這封信打擾到你，請點下面的退訂連結，下次就不會再寄了。
      </td></tr>

      <!-- footer -->
      <tr><td style="padding:32px 4px 0 4px;border-top:1px solid rgba(255,255,255,0.06);margin-top:24px;font-size:11px;line-height:1.7;color:rgba(231,227,247,0.4);">
        <p style="margin:24px 0 0 0;">
          You're receiving this because you subscribed at
          <a href="{site}" style="color:rgba(199,184,255,0.7);text-decoration:underline;">{site_bare}</a>.
        </p>
        <p style="margin:8px 0 0 0;">
          <a href="{unsub}" style="color:rgba(199,184,255,0.7);text-decoration:underline;">一鍵退訂</a>
          &nbsp;·&nbsp;
          <a href="{site}/blog" style="color:rgba(199,184,255,0.7);text-decoration:underline;">所有文章</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"#
    )
}

/// 建每封信的 wire object：`{from, headers, html, subject, text, to}`（reply_to 略，對齊 SDK bug）。
fn build_email_object(site: &str, from: &str, subject: &str, post: &Post, sub: &Sub) -> Value {
    let unsub = unsubscribe_url(site, &sub.token);
    let mut headers = Map::new();
    headers.insert("List-Unsubscribe".into(), json!(format!("<{unsub}>")));
    headers.insert("List-Unsubscribe-Post".into(), json!("List-Unsubscribe=One-Click"));
    let mut m = Map::new();
    m.insert("from".into(), json!(from));
    m.insert("headers".into(), Value::Object(headers));
    m.insert("html".into(), json!(render_email(site, post, sub)));
    m.insert("subject".into(), json!(subject));
    m.insert("text".into(), json!(render_text(site, post, sub)));
    m.insert("to".into(), json!([sub.email]));
    Value::Object(m)
}

/// sendNewsletter：分批（100/批）打 Resend batch API。回 (sent, failed, errors)。
async fn send_newsletter(state: &AppState, post: &Post, subs: &[Sub]) -> (i64, i64, Vec<String>) {
    // getResend()：RESEND_API_KEY 未設 → 特殊回傳
    let key = match std::env::var("RESEND_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => return (0, 0, vec!["RESEND_API_KEY not configured".to_string()]),
    };
    if subs.is_empty() {
        return (0, 0, vec![]);
    }
    let site = public_site_url();
    let from = newsletter_from();
    let subject = render_subject(post);
    let base = resend_base_url();
    let (mut sent, mut failed) = (0i64, 0i64);
    let mut errors: Vec<String> = Vec::new();

    for chunk in subs.chunks(BATCH_SIZE) {
        let payload: Vec<Value> =
            chunk.iter().map(|s| build_email_object(&site, &from, &subject, post, s)).collect();
        let resp = state
            .http
            .post(format!("{base}/emails/batch"))
            .header("Authorization", format!("Bearer {key}"))
            .header("Content-Type", "application/json")
            .header("x-batch-validation", "strict")
            .body(serde_json::to_string(&Value::Array(payload)).unwrap_or_default())
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => sent += chunk.len() as i64,
            Ok(r) => {
                failed += chunk.len() as i64;
                // error.message || JSON.stringify(error)：取上游 body 的 .message
                let body = r.text().await.unwrap_or_default();
                let msg = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
                    .unwrap_or(body);
                errors.push(msg);
            }
            Err(e) => {
                failed += chunk.len() as i64;
                errors.push(e.to_string());
            }
        }
    }
    (sent, failed, errors)
}

/// 依 post_id 載入文章標題/摘要 + active 訂閱者並寄送電子報。回 (sent, failed, errors)。
/// 無 active 訂閱者 → (0, 0, [])。呼叫端負責 requireAdmin / 狀態 / RESEND 設定檢查。
/// 供 admin 建/改文「發佈即推送」與手動 route 共用底層 `send_newsletter`。
pub(crate) async fn dispatch_newsletter(
    state: &AppState,
    post_id: i64,
) -> Result<(i64, i64, Vec<String>), String> {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT title, excerpt FROM posts WHERE id = ?",
    )
    .bind(post_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let (title, excerpt) = row.ok_or_else(|| "post not found".to_string())?;
    let subs = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT email, name, unsubscribe_token FROM newsletter_subscribers WHERE status = ? AND unsubscribe_token IS NOT NULL",
    )
    .bind("active")
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    if subs.is_empty() {
        return Ok((0, 0, vec![]));
    }
    let subs: Vec<Sub> = subs.into_iter().map(|(email, name, token)| Sub { email, name, token }).collect();
    let post = Post { id: json!(post_id), title: title.unwrap_or_default(), excerpt };
    Ok(send_newsletter(state, &post, &subs).await)
}

/// `POST /api/admin/posts/:id/send-newsletter` —— requireAdmin。
#[utoipa::path(post, path = "/api/admin/posts/{id}/send-newsletter", tag = "admin", security(("bearer" = [])),
    params(("id" = String, Path)),
    responses((status = 200, description = "電子報寄送結果（動態 JSON）"), (status = 400, description = "只有已發佈文章可寄送"), (status = 401, description = "未授權"), (status = 404, description = "文章不存在"), (status = 500, description = "RESEND_API_KEY 未設定或伺服器錯誤")))]
pub async fn send_newsletter_route(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = require_admin(&headers, &state).await {
        return e.into_response();
    }
    // isMailerConfigured()
    if std::env::var("RESEND_API_KEY").ok().filter(|s| !s.is_empty()).is_none() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "RESEND_API_KEY not configured on server" })),
        )
            .into_response();
    }
    let row = sqlx::query_as::<_, (i64, Option<String>, Option<String>, Option<String>)>(
        "SELECT id, title, excerpt, status FROM posts WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await;
    let (post_id, title, excerpt, status) = match row {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(None) => {
            return (StatusCode::NOT_FOUND, Json(json!({ "error": "post not found" }))).into_response();
        }
        Ok(Some(r)) => r,
    };
    if status.as_deref() != Some("published") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "only published posts can be sent" })))
            .into_response();
    }
    let post = Post { id: json!(post_id), title: title.unwrap_or_default(), excerpt };

    let subs = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT email, name, unsubscribe_token FROM newsletter_subscribers WHERE status = ? AND unsubscribe_token IS NOT NULL",
    )
    .bind("active")
    .fetch_all(&state.pool)
    .await;
    let subs = match subs {
        Err(e) => return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        Ok(rows) => rows,
    };
    if subs.is_empty() {
        return Json(json!({ "sent": 0, "failed": 0, "message": "no active subscribers" })).into_response();
    }
    let subs: Vec<Sub> = subs.into_iter().map(|(email, name, token)| Sub { email, name, token }).collect();
    let (sent, failed, errors) = send_newsletter(&state, &post, &subs).await;
    Json(json!({ "message": "newsletter dispatched", "sent": sent, "failed": failed, "errors": errors }))
        .into_response()
}
