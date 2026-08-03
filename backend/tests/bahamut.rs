//! 動畫瘋（bahamut）的兩個 admin 端點：`/status` 與 `/cookie`。
//!
//! 這支檔案原本只有 24%，而漏掉的那些**多數根本不需要碰上游**——之前把它整包歸類成
//! 「要先把 anigamer client 抽成可注入才測得動」，那個判斷只對 `sync_bahamut_history`
//! 成立。實際重新逐函式看過之後：`push_auth` / `status` / `jwt_fields` / `cookie`
//! 加起來近 300 個 region，全部走 router 就到得了，**一行生產程式碼都不用動**。
//!
//! 為什麼值得測：
//!
//!   · `push_auth` 是一條**繞過管理員驗證**的旁路（給瀏覽器擴充推 cookie 用）。
//!     它自己實作了常數時間比對；比對寫鬆了等於把後台的一個端點開給任何人。
//!   · `cookie` 是整條同步鏈的入口。它寫檔、熱抽換 client、重置告警節流、再觸發同步——
//!     其中任何一步默默失敗，症狀都是「觀看紀錄停在幾天前」，而沒有任何錯誤訊息。
//!
//! ⚠ 這個檔用 `std::env::set_var`，依賴 nextest 的行程隔離（每個測試一個行程）。
//!   而且必須在 `test_app_with_state()` **之前**設好：`build_state` 是在建 state 的
//!   當下就讀 `BAHAMUT_COOKIE` / `BAHAMUT_COOKIE_FILE`，之後再改沒有用。

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use common::{owner_token, request, test_app_with_state};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

/// `validate()` 要求這 7 個 cookie 都在且非空。
const ALL_REQUIRED: &str = "BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; \
                            BAHAFLT=f; BAHAENUR=e; BAHARUNE=a.b.c";

/// 造一個 payload 帶 `exp` 的 JWT（簽章不驗，anigamer 只解 payload），
/// 到期時間是「`days` 天又 12 小時後」，所以 `daysLeft` 穩定等於 `days`。
///
/// ⚠ 那半天不是裝飾。`daysLeft` 是 `seconds_until_expiry.div_euclid(86_400)`，
///   而 `seconds_until_expiry` 是在**讀取的當下**才算的。若寫成剛好整數天，
///   產生 JWT 到發請求之間只要跨過一秒，864000 就變成 863999，答案從 10 掉到 9——
///   一條會在忙碌的 runner 上隨機紅的測試，而且看起來像是程式壞了。
fn jwt_expiring_in_days(days: i64) -> String {
    use base64::Engine as _;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let payload = json!({ "exp": now + days * 86_400 + 43_200 }).to_string();
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
    format!("eyJhbGciOiJIUzI1NiJ9.{b64}.sig")
}

/// 準備環境（一定要在 test_app_with_state 之前呼叫）並回傳 cookie 檔路徑。
fn prepare_env(tag: &str, cookie: Option<&str>) -> std::path::PathBuf {
    // ⚠ 不導開的話 cookie 檔會落在 **CWD**：`cookie_file_path("sqlite::memory:")`
    //   取不到 parent → dir 是空字串 → 寫成 ./.bahamut-cookie.json，
    //   也就是把測試產物丟進 repo。
    let dir = std::env::temp_dir().join(format!("koimsurai-baha-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("cookie.json");
    unsafe {
        std::env::set_var("BAHAMUT_COOKIE_FILE", &file);
        match cookie {
            Some(c) => std::env::set_var("BAHAMUT_COOKIE", c),
            None => std::env::remove_var("BAHAMUT_COOKIE"),
        }
    }
    file
}

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    extra: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut b = Request::builder().method(method).uri(path);
    for (k, v) in extra {
        b = b.header(*k, *v);
    }
    let req = match body {
        Some(v) => {
            b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap()
        }
        None => b.body(Body::empty()).unwrap(),
    };
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, v)
}

// ── push_auth：繞過管理員驗證的那條旁路 ───────────────────────────────

#[tokio::test]
async fn 推送_token_正確時不必是管理員() {
    prepare_env("push-ok", None);
    unsafe { std::env::set_var("BAHAMUT_PUSH_TOKEN", "s3cret-push-token") };
    let (app, _pool, _state) = test_app_with_state().await;

    // 瀏覽器擴充只有這顆 token，沒有後台的 JWT——這條路徑就是為它存在的
    let (status, _) =
        send(&app, "GET", "/api/admin/bahamut/status", None, &[("X-Bahamut-Token", "s3cret-push-token")])
            .await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn 推送_token_錯誤時退回管理員驗證() {
    prepare_env("push-bad", None);
    unsafe { std::env::set_var("BAHAMUT_PUSH_TOKEN", "s3cret-push-token") };
    let (app, _pool, _state) = test_app_with_state().await;

    // ⚠ 這兩個 case 是分開的：比對是「先比長度、再逐 byte XOR 累加」。
    //   只測長度不同的話，把 XOR 那段改成永遠 0（等於誰都能過）測試照樣綠。
    for (token, why) in [("s3cret-push-tokeX", "長度相同但內容不同"), ("wrong", "長度就不同"), ("", "空字串")]
    {
        let (status, _) =
            send(&app, "GET", "/api/admin/bahamut/status", None, &[("X-Bahamut-Token", token)]).await;
        assert_eq!(status, 401, "{why} 的 token 不該通過");
    }

    // 完全不帶那個標頭也一樣
    let (status, _) = send(&app, "GET", "/api/admin/bahamut/status", None, &[]).await;
    assert_eq!(status, 401);

    // 但管理員本來就進得去（旁路壞掉不該連正門一起堵住）
    let (status, _) = request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn 沒設推送_token_時任何值都不該放行() {
    prepare_env("push-unset", None);
    unsafe { std::env::remove_var("BAHAMUT_PUSH_TOKEN") };
    let (app, _pool, _state) = test_app_with_state().await;

    // 沒設定＝這條旁路關閉。若實作寫成「env 沒設就跳過比對」，那就是預設全開——
    // 而預設全開的東西沒有人會發現，直到有人掃到這個端點。
    for token in ["", "anything", "s3cret-push-token"] {
        let (status, _) =
            send(&app, "GET", "/api/admin/bahamut/status", None, &[("X-Bahamut-Token", token)]).await;
        assert_eq!(status, 401, "旁路關閉時 `{token}` 不該通過");
    }
}

// ── status ────────────────────────────────────────────────────────────

#[tokio::test]
async fn 沒有_cookie_時把缺哪幾個列出來() {
    prepare_env("status-empty", None);
    let (app, _pool, _state) = test_app_with_state().await;

    let (status, body) =
        request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], false);
    // 只回 ok:false 的話，後台只知道「壞了」但不知道要補什麼
    assert_eq!(body["missing"].as_array().unwrap().len(), 7);
    assert!(body["jwtExpiresAt"].is_null());
    assert!(body["daysLeft"].is_null());
}

#[tokio::test]
async fn 有完整_cookie_時回報_jwt_到期日與剩餘天數() {
    let jwt = jwt_expiring_in_days(10);
    prepare_env(
        "status-ok",
        Some(&format!("BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; BAHAFLT=f; BAHAENUR=e; BAHARUNE={jwt}")),
    );
    let (app, _pool, _state) = test_app_with_state().await;

    let (status, body) =
        request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);
    assert_eq!(body["missing"].as_array().unwrap().len(), 0);
    // 這兩欄是「還剩幾天要換 cookie」的唯一來源。算錯的話會在到期那天才發現，
    // 而那時候觀看紀錄已經停了。
    assert!(body["jwtExpiresAt"].as_str().unwrap().contains('T'), "應該是 ISO 8601");
    assert_eq!(body["daysLeft"], 10);
}

#[tokio::test]
async fn baharune_不是_jwt_時_cookie_齊全但沒有到期資訊() {
    prepare_env("status-nojwt", Some(ALL_REQUIRED)); // BAHARUNE=a.b.c，解不出 payload
    let (app, _pool, _state) = test_app_with_state().await;

    let (_, body) = request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    // 這是真的會發生的狀態：cookie 數量齊了但 BAHARUNE 是垃圾。
    // 若把「解不出 JWT」誤報成 ok:false，後台會叫人去補已經在的 cookie。
    assert_eq!(body["ok"], true);
    assert!(body["jwtExpiresAt"].is_null());
    assert!(body["daysLeft"].is_null());
}

// ── cookie：熱更新 ────────────────────────────────────────────────────

#[tokio::test]
async fn 沒帶_cookie_也沒帶_jar_是_400() {
    prepare_env("cookie-none", None);
    let (app, _pool, _state) = test_app_with_state().await;
    let (status, body) =
        request(&app, "POST", "/api/admin/bahamut/cookie", Some(json!({})), Some(&owner_token(true))).await;
    assert_eq!(status, 400);
    assert_eq!(body["ok"], false);
    assert_eq!(body["message"], "缺少 cookie 或 jar");
}

#[tokio::test]
async fn cookie_不齊時擋下並列出缺哪幾個() {
    prepare_env("cookie-partial", None);
    let (app, _pool, _state) = test_app_with_state().await;

    let (status, body) = request(
        &app,
        "POST",
        "/api/admin/bahamut/cookie",
        Some(json!({ "cookie": "BAHAID=1; BAHANICK=n" })),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(body["message"], "缺少必要 cookie");
    // 擴充推來一半的 cookie 是常見情形（使用者沒登入完）。列出缺的才有辦法查。
    let missing = body["missing"].as_array().unwrap();
    assert_eq!(missing.len(), 5);
}

#[tokio::test]
async fn 用_cookie_字串熱更新_會寫檔並換掉_client() {
    let file = prepare_env("cookie-str", None);
    let jwt = jwt_expiring_in_days(5);
    let (app, _pool, state) = test_app_with_state().await;

    // 更新前是空的
    let (_, before) = request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(before["ok"], false);

    // ⚠ 先佔住 sync_lock。`cookie` 最後會呼叫 sync_bahamut_history，而那支在拿不到鎖時
    //   會立刻回 busy——不佔的話它會真的去打 ani.gamer.com.tw。測試不該依賴外部網站，
    //   也不該在別人的伺服器上留下流量。
    let guard = state.bahamut.sync_lock.lock().await;

    let cookie_str =
        format!("BAHAID=1; BAHAHASHID=h; BAHANICK=n; BAHALV=1; BAHAFLT=f; BAHAENUR=e; BAHARUNE={jwt}");
    let (status, body) = request(
        &app,
        "POST",
        "/api/admin/bahamut/cookie",
        Some(json!({ "cookie": cookie_str })),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], true);
    assert_eq!(body["daysLeft"], 5);
    assert_eq!(body["sync"]["busy"], true, "同步應該被鎖擋下（測試刻意佔著鎖）");
    drop(guard);

    // 1) 有寫檔——不寫的話重啟就回到舊 cookie，而擴充不會再推一次
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved["BAHARUNE"], jwt);
    assert_eq!(saved["BAHAID"], "1");

    // 2) 記憶體裡的 client 也真的換掉了——只寫檔沒熱抽換的話，要重啟才生效
    let (_, after) = request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(after["ok"], true);
    assert_eq!(after["daysLeft"], 5);
}

#[tokio::test]
async fn 用_jar_物件熱更新() {
    prepare_env("cookie-jar", None);
    let (app, _pool, state) = test_app_with_state().await;
    let guard = state.bahamut.sync_lock.lock().await;

    // 擴充推的是 jar 物件，手動貼的是 cookie 字串——兩條路都要能走
    let (status, body) = request(
        &app,
        "POST",
        "/api/admin/bahamut/cookie",
        Some(json!({ "jar": {
            "BAHAID": "1", "BAHAHASHID": "h", "BAHANICK": "n", "BAHALV": "1",
            "BAHAFLT": "f", "BAHAENUR": "e", "BAHARUNE": "a.b.c",
        }})),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["ok"], true);
    drop(guard);

    let (_, after) = request(&app, "GET", "/api/admin/bahamut/status", None, Some(&owner_token(true))).await;
    assert_eq!(after["ok"], true);
}

#[tokio::test]
async fn 換新_cookie_會重置告警節流() {
    prepare_env("cookie-throttle", None);
    let (app, _pool, state) = test_app_with_state().await;
    let guard = state.bahamut.sync_lock.lock().await;

    // 假裝剛剛才發過告警
    state.bahamut.last_jwt_alert_at.store(9_999_999_999_999, std::sync::atomic::Ordering::Relaxed);

    let (status, _) = request(
        &app,
        "POST",
        "/api/admin/bahamut/cookie",
        Some(json!({ "cookie": ALL_REQUIRED })),
        Some(&owner_token(true)),
    )
    .await;
    assert_eq!(status, 200);
    drop(guard);

    // 不重置的話：使用者換了新 cookie、新 cookie 又出問題，卻要等 24 小時才會收到通知
    assert_eq!(
        state.bahamut.last_jwt_alert_at.load(std::sync::atomic::Ordering::Relaxed),
        0,
        "換 cookie 之後告警節流沒有重置"
    );
}

#[tokio::test]
async fn 熱更新也要通過推送驗證() {
    prepare_env("cookie-auth", None);
    unsafe { std::env::remove_var("BAHAMUT_PUSH_TOKEN") };
    let (app, _pool, _state) = test_app_with_state().await;

    // 這個端點會改掉整個同步鏈用的憑證，沒有身分就能打等於任何人都能停掉同步
    let (status, _) =
        send(&app, "POST", "/api/admin/bahamut/cookie", Some(json!({ "cookie": ALL_REQUIRED })), &[]).await;
    assert_eq!(status, 401);
}
