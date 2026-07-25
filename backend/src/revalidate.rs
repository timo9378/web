use axum::{extract::Request, middleware::Next, response::Response};
use std::time::Duration;

// 文章內容變更後,通知前端清掉 ISR 快取(nitro routeRules 的 swr;文章頁 TTL 1h、列表 5min)。
//
// 刻意做成 middleware 而非在各 handler 內呼叫:posts 的寫入散在 posts.rs / admin.rs / opencc.rs
// 共 14 處,逐一掛必然會漏 —— 而且漏掉不會報錯,只會安靜地讓讀者看到舊內容。
// 這裡只認「寫入方法 + 動到文章本體的路徑 + 回應成功」,新增端點自動涵蓋。

// 這些子路徑是高頻互動,絕不能觸發清快取:
// /view 是每次有人瀏覽文章都會打 —— 若也清快取,等於每有一次瀏覽就把全站 ISR 清空,
// ISR 直接失效且不斷重複重生。like/reactions/comments 同理,而且它們的內容是 client 端
// 才 render 的(不在 SSR HTML 裡),清了也沒意義。
const NON_CONTENT_ACTIONS: &[&str] = &["view", "like", "unlike", "reactions", "comments", "send-newsletter"];

fn is_content_mutation(path: &str) -> bool {
    if !path.starts_with("/api/posts") && !path.starts_with("/api/admin/posts") {
        return false;
    }
    // 末段是高頻互動動作就跳過;其餘(/api/posts、/api/posts/:id、/api/posts/legacy、
    // /api/admin/posts/:id/generate-zh-cn …)都算文章本體變更。
    let last = path.rsplit('/').next().unwrap_or("");
    !NON_CONTENT_ACTIONS.contains(&last)
}

pub async fn notify_on_post_write(req: Request, next: Next) -> Response {
    let is_write = matches!(req.method().as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
    let should_notify = is_write && is_content_mutation(req.uri().path());

    let res = next.run(req).await;

    if should_notify && res.status().is_success() {
        tokio::spawn(fire()); // fire-and-forget:不拖慢寫入回應
    }
    res
}

async fn fire() {
    // 兩個 env 都要有值才啟用;缺任一 = 功能沒開,安靜跳過。
    // 注意要擋空字串:compose 用 ${REVALIDATE_SECRET:-} 替換,未設定時傳進來的是空字串而非「不存在」,
    // env::var 會回 Ok("") —— 不擋的話每次發文都會送出空密鑰、被前端擋掉,然後在 log 噴 warn。
    let (Ok(url), Ok(secret)) =
        (std::env::var("FRONTEND_REVALIDATE_URL"), std::env::var("REVALIDATE_SECRET"))
    else {
        return;
    };
    if url.is_empty() || secret.is_empty() {
        return;
    }

    let res = reqwest::Client::new()
        .post(&url)
        .header("x-revalidate-secret", secret)
        .timeout(Duration::from_secs(3))
        .send()
        .await;

    // 通知失敗不影響已完成的寫入,最壞情況只是等 TTL 過期 → 記 warn 供排查,不往上拋。
    match res {
        Ok(r) if r.status().is_success() => tracing::debug!("ISR 快取已請前端清除"),
        Ok(r) => tracing::warn!("前端 revalidate 回應 {}", r.status()),
        Err(e) => tracing::warn!("前端 revalidate 打不通: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{is_content_mutation, notify_on_post_write};
    use axum::{Router, body::Body, http::Request, routing::put};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tower::ServiceExt;

    // 假前端:收一個請求就把整包原始 HTTP 內容送回來,用來驗證通知真的送出且帶對標頭。
    async fn mock_frontend() -> (String, tokio::sync::oneshot::Receiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = vec![0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = sock.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok").await;
                let _ = tx.send(req);
            }
        });
        (format!("http://127.0.0.1:{port}/_revalidate"), rx)
    }

    fn app() -> Router {
        Router::new()
            .route("/api/posts/{id}", put(|| async { "ok" }))
            .route("/api/posts/{id}/view", put(|| async { "ok" }))
            .layer(axum::middleware::from_fn(notify_on_post_write))
    }

    // 正負兩案寫在同一個測試:env var 是 process 全域的,分成兩個平行測試會互相干擾。
    #[tokio::test]
    async fn 內容變更會實際發出通知_瀏覽則不會() {
        let (url, rx) = mock_frontend().await;
        // FIXME: Audit that the environment access only happens in single-threaded code.
        unsafe { std::env::set_var("FRONTEND_REVALIDATE_URL", &url) };
        // FIXME: Audit that the environment access only happens in single-threaded code.
        unsafe { std::env::set_var("REVALIDATE_SECRET", "s3cret") };

        // 1) 高頻瀏覽端點:不該發通知
        let res = app()
            .oneshot(Request::builder().method("PUT").uri("/api/posts/39/view").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(res.status().is_success());

        // 2) 文章本體變更:該發通知
        let res = app()
            .oneshot(Request::builder().method("PUT").uri("/api/posts/39").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(res.status().is_success());

        // 注意:這裡分辨不出通知是哪個請求觸發的(兩者發出的通知內容完全相同)。
        // 「/view 不可觸發」由上面的 高頻互動不可清快取 單元測試把關;
        // 本測試負責的是「middleware 真的有跑、狀態碼判斷正確、通知確實帶密鑰送達」。
        let got = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .expect("逾時:前端沒收到任何 revalidate 通知")
            .expect("通道關閉");
        assert!(got.starts_with("POST /_revalidate"), "收到的是: {got}");
        assert!(got.to_lowercase().contains("x-revalidate-secret: s3cret"), "缺少密鑰標頭: {got}");
    }

    #[test]
    fn 文章本體變更要清快取() {
        for p in [
            "/api/posts",
            "/api/posts/39",
            "/api/posts/legacy",
            "/api/posts/39/status",
            "/api/admin/posts",
            "/api/admin/posts/39",
            "/api/admin/posts/39/generate-zh-cn",
        ] {
            assert!(is_content_mutation(p), "{p} 應該要清快取");
        }
    }

    #[test]
    fn 高頻互動不可清快取() {
        // 這幾條若誤判成 true,每次有人看文章就會清光全站 ISR 快取
        for p in [
            "/api/posts/39/view",
            "/api/posts/39/like",
            "/api/posts/39/unlike",
            "/api/posts/39/reactions",
            "/api/posts/39/comments",
            "/api/admin/posts/39/send-newsletter",
        ] {
            assert!(!is_content_mutation(p), "{p} 不該清快取");
        }
    }

    #[test]
    fn 無關路徑不受影響() {
        for p in ["/api/thoughts", "/api/books", "/api/admin/users/1/role", "/"] {
            assert!(!is_content_mutation(p), "{p} 不該清快取");
        }
    }
}
