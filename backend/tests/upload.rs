//! `POST /api/admin/upload` 的整合測試——這個檔在此之前是 **0% 覆蓋**。
//!
//! 純函式（`fit_inside` / `compute_thumbhash` / `uploads_base`）是私有的，
//! 單元測試放在 `src/handlers/upload.rs` 檔內；這裡測的是 handler 整條路徑：
//! 授權順序、multipart 解析、檔案落地、以及**client 給的檔名不能逃出上傳目錄**。
//!
//! ⚠ 用 `UPLOAD_BASE_DIR` 把檔案導到暫存目錄，**依賴 nextest 的行程隔離**
//! （每個測試各自一個行程）。專案的門檻指令是 `cargo llvm-cov nextest`，成立。

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use common::{owner_token, test_app};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

const BOUNDARY: &str = "----koimsuraitestboundary";

/// 組一個 multipart/form-data body。`filename` 是 client 宣告的原始檔名——
/// 它同時是副檔名的來源，也是路徑穿越的攻擊面。
fn multipart(field: &str, filename: &str, content_type: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n").as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    body
}

async fn post_upload(
    app: &axum::Router,
    bearer: Option<&str>,
    body: Vec<u8>,
    content_type: &str,
) -> (StatusCode, Value) {
    let mut b =
        Request::builder().method("POST").uri("/api/admin/upload").header(header::CONTENT_TYPE, content_type);
    if let Some(t) = bearer {
        b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let resp = app.clone().oneshot(b.body(Body::from(body)).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let v = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, v)
}

/// 每個測試自己的上傳根目錄。nextest 一個測試一個行程，所以 pid 就足以區分。
fn temp_upload_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("koimsurai-upload-{}-{}", std::process::id(), tag));
    let _ = std::fs::remove_dir_all(&dir);
    unsafe { std::env::set_var("UPLOAD_BASE_DIR", &dir) };
    dir
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 64]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img).write_to(&mut buf, image::ImageFormat::Png).unwrap();
    buf.into_inner()
}

/// 收集目錄下所有檔案的相對路徑。
fn walk(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push(p.strip_prefix(root).unwrap().to_path_buf());
            }
        }
    }
    out.sort();
    out
}

// ── 授權 ──────────────────────────────────────────────────────────────────

/// 沒有 token → **401，不是 400**。
///
/// 這條守的是 upload.rs 檔頭那段註解講的事：`Multipart` 不能當參數 extractor，
/// 因為 body extractor 在 handler 之前跑，無認證的非 multipart 請求會先吃 400，
/// requireAdmin 根本沒機會回 401（順序與 Express 相反）。所以 handler 收的是
/// `Request`、先驗 auth 再手動抽 multipart。有人「順手簡化」成參數 extractor 的話，
/// 這條會紅。
#[tokio::test]
async fn upload_requires_auth_before_touching_the_body() {
    let (app, _pool) = test_app().await;

    // 連 body 都不是 multipart——如果順序錯了，這裡會回 400 而不是 401
    let (status, _) = post_upload(&app, None, b"not multipart at all".to_vec(), "text/plain").await;
    assert_eq!(status, 401, "未授權必須先回 401，不能先嫌 body 格式");

    let body = multipart("file", "a.png", "image/png", &png(4, 4));
    let (status, _) =
        post_upload(&app, None, body, &format!("multipart/form-data; boundary={BOUNDARY}")).await;
    assert_eq!(status, 401);
}

// ── 沒有檔案 ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn non_multipart_body_is_no_file_uploaded() {
    let _dir = temp_upload_dir("non-multipart");
    let (app, _pool) = test_app().await;
    let (status, body) =
        post_upload(&app, Some(&owner_token(true)), b"{}".to_vec(), "application/json").await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "No file uploaded");
}

/// multipart 但欄位名不是 `file` → 400（對齊 multer 的 `.single('file')`）。
#[tokio::test]
async fn multipart_without_the_file_field_is_rejected() {
    let _dir = temp_upload_dir("wrong-field");
    let (app, _pool) = test_app().await;
    let body = multipart("avatar", "a.png", "image/png", &png(4, 4));
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 400, "欄位名不是 file 應該當成沒上傳：{resp}");
    assert_eq!(resp["error"], "No file uploaded");
}

// ── 正常上傳 ──────────────────────────────────────────────────────────────

/// 圖片上傳：落到 `YYYY/MM/` 底下、bytes 逐位元組不動、URL 帶 `#th=`。
#[tokio::test]
async fn image_upload_lands_on_disk_unmodified_and_gets_a_thumbhash() {
    let dir = temp_upload_dir("image-ok");
    let (app, _pool) = test_app().await;
    let original = png(200, 120);

    let body = multipart("file", "photo.PNG", "image/png", &original);
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    assert_eq!(resp["message"], "success");

    let url = resp["url"].as_str().unwrap();
    let filename = resp["filename"].as_str().unwrap();
    let th = resp["thumbhash"].as_str().expect("圖片應該算出 thumbhash");

    // URL 形狀：/uploads/YYYY/MM/{檔名}#th={hash}
    assert!(url.starts_with("/uploads/"), "url = {url}");
    assert!(url.ends_with(&format!("#th={th}")), "thumbhash 應該掛在 URL 片段上：{url}");
    // 副檔名沿用 client 給的（含大小寫），檔名主體則是伺服器生的 {毫秒}-{亂數}
    assert!(filename.ends_with(".PNG"), "副檔名應該保留原樣：{filename}");
    let stem = filename.trim_end_matches(".PNG");
    let (ms, rand) = stem.split_once('-').expect("檔名應該是 {毫秒}-{亂數} 的形狀");
    assert!(ms.parse::<i64>().is_ok(), "前半應該是毫秒時間戳：{ms}");
    assert!(rand.parse::<u64>().is_ok(), "後半應該是亂數：{rand}");

    // 檔案真的在 YYYY/MM/ 底下，而且內容一個位元組都沒動
    let files = walk(&dir);
    assert_eq!(files.len(), 1, "應該只落一個檔：{files:?}");
    let rel = &files[0];
    let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    assert_eq!(parts.len(), 3, "應該是 YYYY/MM/檔名 三層：{rel:?}");
    assert_eq!(parts[0].len(), 4, "年應該是四位數：{}", parts[0]);
    assert_eq!(parts[1].len(), 2, "月應該補零成兩位數：{}", parts[1]);
    assert_eq!(parts[2], filename);
    assert_eq!(std::fs::read(dir.join(rel)).unwrap(), original, "落地的 bytes 必須與上傳的完全相同");
}

/// 非圖片（也非影片）→ 存檔但不算 thumbhash，URL 不帶 `#th=`。
#[tokio::test]
async fn non_image_upload_has_no_thumbhash() {
    let dir = temp_upload_dir("non-image");
    let (app, _pool) = test_app().await;
    let payload = b"%PDF-1.4 fake pdf".to_vec();

    let body = multipart("file", "doc.pdf", "application/pdf", &payload);
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    assert!(resp["thumbhash"].is_null(), "非圖片不該有 thumbhash：{resp}");
    assert!(!resp["url"].as_str().unwrap().contains("#th="), "URL 不該帶片段：{resp}");

    let files = walk(&dir);
    assert_eq!(files.len(), 1);
    assert_eq!(std::fs::read(dir.join(&files[0])).unwrap(), payload);
}

/// 宣告是圖片但內容不是 → 存檔成功，thumbhash 是 null（不是 500）。
///
/// mimetype 由 client 宣告、不驗內容（對齊 multer），所以這條路徑一定會被走到。
#[tokio::test]
async fn bogus_image_still_uploads_with_null_thumbhash() {
    let dir = temp_upload_dir("bogus-image");
    let (app, _pool) = test_app().await;

    let body = multipart("file", "fake.png", "image/png", b"definitely not a png");
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "算不出 thumbhash 不該讓上傳失敗：{resp}");
    assert!(resp["thumbhash"].is_null());
    assert_eq!(walk(&dir).len(), 1, "檔案還是要存下來");
}

/// 宣告是影片但內容不是 → ffmpeg 失敗（或根本不在），必須**保留原檔**而不是把檔案弄丟。
///
/// 兩種情況（ffmpeg 存在但處理失敗 / ffmpeg 不存在）的預期結果相同，所以這條測試
/// 在有沒有裝 ffmpeg 的機器上都成立。
#[tokio::test]
async fn video_upload_keeps_the_original_when_normalisation_fails() {
    let dir = temp_upload_dir("video-fallback");
    let (app, _pool) = test_app().await;
    let payload = b"not really an mp4".to_vec();

    let body = multipart("file", "clip.mp4", "video/mp4", &payload);
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "{resp}");

    let files = walk(&dir);
    assert_eq!(files.len(), 1, "正規化失敗時不該留下 .normalizing.mp4 之類的殘骸：{files:?}");
    assert_eq!(std::fs::read(dir.join(&files[0])).unwrap(), payload, "原檔必須原封不動");
}

// ── 安全：client 給的檔名 ──────────────────────────────────────────────────

/// **client 宣告的檔名不能把檔案寫到上傳目錄外面。**
///
/// 檔名主體是伺服器生的（`{毫秒}-{亂數}`），但**副檔名直接取自 client 的檔名**。
/// 擋住穿越的是 `Path::extension()` 的語義——它只看最後一個路徑元件裡最後一個 `.`
/// 之後的部分，所以結果不可能含 `/`。
///
/// 這個保證是隱性的：有人把它「簡化」成 `original.rsplit('.').next()` 就破了
/// （那樣 `x../../../etc/passwd` 會得到含斜線的「副檔名」）。所以要有一條測試釘住。
#[tokio::test]
async fn hostile_filenames_cannot_escape_the_upload_directory() {
    let dir = temp_upload_dir("traversal");
    let (app, _pool) = test_app().await;
    let token = owner_token(true);

    let hostile = [
        "../../../../etc/passwd",
        "..%2f..%2fescape.png",
        "x.../../../../tmp/pwned",
        "normal.png/../../../../evil.sh",
        "....//....//evil.png",
        ".hidden",
        "no-extension",
        "trailing.",
        "\u{5716}\u{7247}.png", // 非 ASCII 檔名
    ];
    for name in hostile {
        let body = multipart("file", name, "application/octet-stream", b"payload");
        let (status, resp) =
            post_upload(&app, Some(&token), body, &format!("multipart/form-data; boundary={BOUNDARY}")).await;
        assert_eq!(status, 200, "{name} 應該正常收下（消毒而不是拒絕）：{resp}");

        let filename = resp["filename"].as_str().unwrap();
        assert!(!filename.contains('/'), "{name} → 產生的檔名含斜線：{filename}");
        assert!(!filename.contains(".."), "{name} → 產生的檔名含 ..：{filename}");
    }

    // 所有檔案都必須落在 dir/YYYY/MM/ 底下，一個都不能跑到外面
    let files = walk(&dir);
    assert_eq!(files.len(), hostile.len(), "每個請求都該落一個檔：{files:?}");
    for f in &files {
        let depth = f.components().count();
        assert_eq!(depth, 3, "{f:?} 不在 YYYY/MM/ 底下");
        assert!(
            dir.join(f).canonicalize().unwrap().starts_with(dir.canonicalize().unwrap()),
            "{f:?} 逃出上傳目錄了"
        );
    }
}

/// 沒有副檔名的檔名 → 產生的檔名也沒有副檔名（而不是變成 `.` 結尾或 panic）。
#[tokio::test]
async fn filename_without_extension_produces_a_bare_name() {
    let _dir = temp_upload_dir("no-ext");
    let (app, _pool) = test_app().await;
    let body = multipart("file", "README", "text/plain", b"hello");
    let (status, resp) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    let filename = resp["filename"].as_str().unwrap();
    assert!(!filename.contains('.'), "沒有副檔名時不該多出一個點：{filename}");
}

// ── ffmpeg 正規化：用 stub 取代真的執行檔 ─────────────────────────────────
//
// `FFMPEG_BIN` / `FFPROBE_BIN` 可注入之後，這段邏輯才測得到。在此之前
// `cargo mutants` 有 10 個變異無人看守——包含「有旋轉卻走 -c copy」這種
// 會讓手機直式影片在 Chromium 上整片黑的錯誤（見 upload.rs 檔頭）。
//
// ⚠ 這段用 Unix 的檔案權限位元寫可執行的 stub。專案只跑在 Linux（debian image）。

use std::os::unix::fs::PermissionsExt;

fn write_stub(path: &std::path::Path, script: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, script).unwrap();
    let mut perms = std::fs::metadata(path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).unwrap();
}

/// 架好 ffprobe / ffmpeg 的 stub。
///
/// - `rotation`：ffprobe 要吐出的內容（原樣印到 stdout）
/// - `ffmpeg_ok`：ffmpeg stub 要成功還是失敗
///
/// ffmpeg stub 一律先建出輸出檔**再**決定離開碼——這樣「失敗時要清掉 tmp」
/// 那條路徑才驗得到（不建的話，殘骸本來就不存在，測不出有沒有清）。
/// 回傳記錄 argv 的檔案路徑。
fn stub_ffmpeg(dir: &std::path::Path, rotation: &str, ffmpeg_ok: bool) -> std::path::PathBuf {
    let bin = dir.join("bin");
    let argv_log = bin.join("argv.txt");
    write_stub(&bin.join("ffprobe"), &format!("#!/bin/sh\nprintf '%s\\n' '{rotation}'\n"));
    write_stub(
        &bin.join("ffmpeg"),
        &format!(
            "#!/bin/sh\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             for last in \"$@\"; do :; done\n\
             printf 'NORMALISED' > \"$last\"\n\
             exit {}\n",
            argv_log.display(),
            if ffmpeg_ok { 0 } else { 1 }
        ),
    );
    unsafe {
        std::env::set_var("FFPROBE_BIN", bin.join("ffprobe"));
        std::env::set_var("FFMPEG_BIN", bin.join("ffmpeg"));
    }
    argv_log
}

async fn upload_video(app: &axum::Router, payload: &[u8]) -> Value {
    let body = multipart("file", "clip.mp4", "video/mp4", payload);
    let (status, resp) = post_upload(
        app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200, "{resp}");
    resp
}

/// 上傳落地的那個檔（排除 stub 那些）。
fn uploaded_file(dir: &std::path::Path) -> std::path::PathBuf {
    let f: Vec<_> = walk(dir).into_iter().filter(|p| !p.starts_with("bin")).collect();
    assert_eq!(f.len(), 1, "應該只有一個上傳檔：{f:?}");
    dir.join(&f[0])
}

/// **有旋轉 → 重編**（`libx264`），而不是無損重封裝。
///
/// 這是整個檔案最重要的一條。判錯的話旋轉矩陣會原封不動留在檔案裡，
/// 而那正是 Chromium 上 `<video>` 整片黑的成因。
#[tokio::test]
async fn video_with_rotation_is_re_encoded_not_remuxed() {
    let dir = temp_upload_dir("rot-reencode");
    let argv_log = stub_ffmpeg(&dir, "90", true);
    let (app, _pool) = test_app().await;

    upload_video(&app, b"pretend mp4").await;

    let argv = std::fs::read_to_string(&argv_log).expect("ffmpeg stub 應該有被呼叫");
    let args: Vec<&str> = argv.lines().collect();
    assert!(args.contains(&"libx264"), "有旋轉時必須重編，實際 argv：{args:?}");
    assert!(!args.contains(&"copy"), "有旋轉時不能只做 -c copy：{args:?}");
    assert!(args.contains(&"+faststart"), "moov atom 要搬到檔頭：{args:?}");
    assert_eq!(
        std::fs::read(uploaded_file(&dir)).unwrap(),
        b"NORMALISED",
        "成功之後要用正規化的結果換掉原檔"
    );
}

/// **沒旋轉 → 無損重封裝**（`-c copy`），不該白白重編一次。
#[tokio::test]
async fn video_without_rotation_is_remuxed_losslessly() {
    let dir = temp_upload_dir("rot-copy");
    let argv_log = stub_ffmpeg(&dir, "0", true);
    let (app, _pool) = test_app().await;

    upload_video(&app, b"pretend mp4").await;

    let argv = std::fs::read_to_string(&argv_log).unwrap();
    let args: Vec<&str> = argv.lines().collect();
    assert!(args.contains(&"copy"), "沒旋轉時應該 -c copy：{args:?}");
    assert!(!args.contains(&"libx264"), "沒旋轉不該重編（會白白掉畫質又慢）：{args:?}");
    assert!(args.contains(&"+faststart"));
    assert_eq!(std::fs::read(uploaded_file(&dir)).unwrap(), b"NORMALISED");
}

/// ffprobe 讀不到旋轉（不存在／沒有該欄位）→ 當成沒旋轉，走 copy。
#[tokio::test]
async fn missing_ffprobe_falls_back_to_lossless_remux() {
    let dir = temp_upload_dir("no-ffprobe");
    let argv_log = stub_ffmpeg(&dir, "", true);
    unsafe { std::env::set_var("FFPROBE_BIN", dir.join("bin/does-not-exist")) };
    let (app, _pool) = test_app().await;

    upload_video(&app, b"pretend mp4").await;

    let args: Vec<String> = std::fs::read_to_string(&argv_log).unwrap().lines().map(str::to_string).collect();
    assert!(args.iter().any(|a| a == "copy"), "讀不到旋轉時應該保守走 copy：{args:?}");
    assert!(!args.iter().any(|a| a == "libx264"));
}

/// ffmpeg 失敗 → **保留原檔，並且清掉 tmp**。
///
/// stub 會先把輸出檔建出來再回非 0，所以「有沒有清乾淨」這件事驗得到。
#[tokio::test]
async fn ffmpeg_failure_keeps_the_original_and_removes_the_temp_file() {
    let dir = temp_upload_dir("ffmpeg-fail");
    stub_ffmpeg(&dir, "90", false);
    let (app, _pool) = test_app().await;
    let payload = b"pretend mp4";

    upload_video(&app, payload).await;

    let f: Vec<_> = walk(&dir).into_iter().filter(|p| !p.starts_with("bin")).collect();
    assert_eq!(f.len(), 1, "失敗時不該留下 .normalizing.mp4 殘骸：{f:?}");
    assert_eq!(std::fs::read(dir.join(&f[0])).unwrap(), payload, "原檔必須原封不動");
}

/// ffmpeg 執行檔不存在 → 保留原檔（本機沒裝 ffmpeg 時就是這條路徑）。
#[tokio::test]
async fn missing_ffmpeg_binary_keeps_the_original() {
    let dir = temp_upload_dir("no-ffmpeg");
    stub_ffmpeg(&dir, "90", true);
    unsafe { std::env::set_var("FFMPEG_BIN", dir.join("bin/does-not-exist")) };
    let (app, _pool) = test_app().await;
    let payload = b"pretend mp4";

    upload_video(&app, payload).await;

    assert_eq!(std::fs::read(uploaded_file(&dir)).unwrap(), payload);
}

/// 圖片不該去碰 ffmpeg（只有 `video/` 才正規化）。
#[tokio::test]
async fn images_never_invoke_ffmpeg() {
    let dir = temp_upload_dir("image-no-ffmpeg");
    let argv_log = stub_ffmpeg(&dir, "90", true);
    let (app, _pool) = test_app().await;

    let body = multipart("file", "a.png", "image/png", &png(8, 8));
    let (status, _) = post_upload(
        &app,
        Some(&owner_token(true)),
        body,
        &format!("multipart/form-data; boundary={BOUNDARY}"),
    )
    .await;
    assert_eq!(status, 200);
    assert!(!argv_log.exists(), "圖片不該呼叫 ffmpeg");
}

/// ffprobe 吐出 `0.4` → `parse_rotation` 回 **Some(0)** 而不是 None。
///
/// 這條是 `cargo mutants` 逼出來的。`deg != 0` 那個 guard 看起來像死碼——
/// `parse_rotation` 不是已經濾掉 0 了嗎？沒有：它濾的是**字串解析出來的浮點數**，
/// 而回傳前還有一次 `round()`。0.4 過得了 `!= 0.0` 的濾網，round 之後卻是 0。
///
/// 少了 guard 的話，這種檔案會被當成「有旋轉」而白白重編一次（掉畫質又慢），
/// 實際上它根本不需要轉。
#[tokio::test]
async fn rotation_that_rounds_to_zero_is_treated_as_no_rotation() {
    let dir = temp_upload_dir("rot-rounds-to-zero");
    let argv_log = stub_ffmpeg(&dir, "0.4", true);
    let (app, _pool) = test_app().await;

    upload_video(&app, b"pretend mp4").await;

    let argv = std::fs::read_to_string(&argv_log).unwrap();
    let args: Vec<&str> = argv.lines().collect();
    assert!(args.contains(&"copy"), "0.4° round 成 0，應該走無損重封裝：{args:?}");
    assert!(!args.contains(&"libx264"), "不該為了 0 度白白重編：{args:?}");
}
