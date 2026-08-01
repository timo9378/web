//! `/admin/upload`（sharp 硬骨頭之 thumbhash）。移植 Express multer + `computeThumbHashBase64`。
//!
//! 檔案落地與 Express 相同（`storage/uploads/YYYY/MM/{Date.now()}-{rand}.ext`，原 bytes 不動）。
//! thumbhash：image crate resize（fit-inside 100、Lanczos3、sharp 的 Math.round 尺寸公式）
//! → `thumbhash` crate（spec port）→ base64url。實測對 sharp 版：尺寸公式 100% 對齊、
//! hash 2/5 byte 相同、3/5 差 ≤2 字元（±1 量化係數，解碼後模糊圖視覺零差異）。

use axum::{
    Json,
    extract::{FromRequest, Multipart, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::Engine;
use rand::Rng;
use serde_json::json;

use crate::{auth::require_admin, state::AppState};

fn uploads_base() -> std::path::PathBuf {
    std::env::var("UPLOAD_BASE_DIR").map(Into::into).unwrap_or_else(|_| "/usr/src/app/storage/uploads".into())
}

/// ffmpeg / ffprobe 的執行檔名，可用 env 覆寫。
///
/// 存在的理由跟 `state::ExternalUrls` 一樣：**讓外部相依可被替換，否則測不到**。
/// 這兩個函式的邏輯（有沒有旋轉 → 重編還是無損重封裝、成功要換檔、失敗要清 tmp）
/// 全都藏在 subprocess 後面，不注入的話只驗得到「ffmpeg 不在時保留原檔」那一條——
/// 實測 `cargo mutants` 有 10 個變異因此無人看守。
///
/// 正式環境完全不受影響：不設 env 就是 `ffmpeg` / `ffprobe`，跟原本一樣走 PATH。
fn ffmpeg_bin() -> String {
    std::env::var("FFMPEG_BIN").unwrap_or_else(|_| "ffmpeg".into())
}
fn ffprobe_bin() -> String {
    std::env::var("FFPROBE_BIN").unwrap_or_else(|_| "ffprobe".into())
}

/// sharp `fit:'inside'` + `withoutEnlargement` 尺寸公式（Math.round；實測 5/5 對齊）。
fn fit_inside(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w <= max && h <= max {
        return (w, h);
    }
    let ratio = (max as f64 / w as f64).min(max as f64 / h as f64);
    ((w as f64 * ratio).round().max(1.0) as u32, (h as f64 * ratio).round().max(1.0) as u32)
}

/// `computeThumbHashBase64` 等價：失敗回 None（Express catch → null）。
fn compute_thumbhash(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let (tw, th) = fit_inside(img.width(), img.height(), 100);
    let resized = img.resize_exact(tw, th, image::imageops::FilterType::Lanczos3);
    let rgba = resized.to_rgba8();
    let hash = thumbhash::rgba_to_thumb_hash(tw as usize, th as usize, rgba.as_raw());
    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&hash))
}

/// ffmpeg 最長跑多久（大檔重編可能要幾分鐘；超時就保留原檔，不讓上傳卡死）
const FFMPEG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// 從 ffprobe 的 stdout 解出旋轉角度。抽成純函式是為了**不裝 ffmpeg 也測得到**——
/// 這段的邏輯（跳過 0、容忍雜訊行、小數要 round）全在這裡，subprocess 只負責取字串。
///
/// ffprobe 會把兩個來源都印出來（新版在 `side_data` 的 rotation、舊檔在 tags 的 rotate），
/// 一行一個值，沒有的那個是空行。取「第一個非 0 的」而不是第一行——因為兩者常常
/// 一個有值一個是 0，順序還不保證。
fn parse_rotation(stdout: &str) -> Option<i32> {
    let deg = stdout.lines().filter_map(|l| l.trim().parse::<f64>().ok()).find(|d| *d != 0.0)?;
    Some(deg.round() as i32)
}

/// 讀出影片的旋轉角度（0 表示不需要處理）。ffprobe 不在或讀不到 → None。
async fn probe_rotation(path: &std::path::Path) -> Option<i32> {
    let out = tokio::process::Command::new(ffprobe_bin())
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            // 新版 ffmpeg 放在 side_data 的 rotation；舊檔可能只有 tags 的 rotate
            "-show_entries",
            "stream_side_data=rotation:stream_tags=rotate",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(path)
        .output()
        .await
        .ok()?;
    parse_rotation(&String::from_utf8_lossy(&out.stdout))
}

/// 上傳影片正規化。
///
/// 手機拍的直式影片幾乎都是「橫向存放 + tkhd 旋轉矩陣」，靠播放器自己套矩陣把畫面轉正。
/// 這條路徑在各家實作的差異很大——本站實測 Chromium 會整片黑：`canvas.drawImage()` 走軟體
/// 路徑、自己算進旋轉，取得的畫面是亮的，但 `<video>` 元素的顯示路徑合成不出來。旋轉 metadata
/// 是出了名的相容性地雷（Firefox / ExoPlayer / Safari HLS 各有各的坑），所以在上傳這一關就把
/// 旋轉烘進畫素，之後沒有任何播放器需要處理矩陣。
///
/// 沒有旋轉的檔案只做 `-c copy` 重新封裝（無損），順便把 moov atom 搬到檔頭讓它能邊下邊播。
/// ffmpeg 不在、失敗或超時 → 保留原檔，絕不讓上傳失敗。
async fn normalize_video(path: &std::path::Path) {
    let rotation = probe_rotation(path).await;
    let tmp = path.with_extension("normalizing.mp4");

    let mut cmd = tokio::process::Command::new(ffmpeg_bin());
    cmd.arg("-y").arg("-i").arg(path);
    match rotation {
        // 有旋轉 → 只能重編才能把畫面轉正（ffmpeg 解碼時預設就會套用顯示矩陣，
        // 輸出因此是已轉正的畫素 + 單位矩陣，不需要再手動 transpose）
        Some(deg) if deg != 0 => {
            tracing::info!("影片帶 {deg}° 旋轉矩陣，重編以烘進畫素：{}", path.display());
            cmd.args([
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "24",
                "-preset",
                "medium",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
            ]);
        }
        // 沒旋轉 → 無損重封裝就好
        _ => {
            cmd.args(["-c", "copy"]);
        }
    }
    cmd.args(["-movflags", "+faststart"]).arg(&tmp);

    let status = match tokio::time::timeout(FFMPEG_TIMEOUT, cmd.output()).await {
        Ok(Ok(o)) if o.status.success() => Ok(()),
        Ok(Ok(o)) => {
            Err(format!("ffmpeg 失敗：{}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("")))
        }
        // ffmpeg 不在 image 裡（例如本機跑 cargo run）→ 保留原檔就好，不是錯誤
        Ok(Err(e)) => Err(format!("ffmpeg 無法執行：{e}")),
        Err(_) => Err("ffmpeg 超時".to_string()),
    };
    match status {
        Ok(()) => {
            if let Err(e) = tokio::fs::rename(&tmp, path).await {
                tracing::warn!("影片正規化後換檔失敗，保留原檔：{e}");
                let _ = tokio::fs::remove_file(&tmp).await;
            }
        }
        Err(msg) => {
            tracing::warn!("影片正規化跳過（保留原檔）：{msg}");
            let _ = tokio::fs::remove_file(&tmp).await;
        }
    }
}

/// `POST /api/admin/upload` —— requireAdmin + multer.single('file')。
/// ⚠️ Multipart 不能當參數 extractor：body extractor 在 handler 前跑，
/// 無 auth 的非 multipart 請求會先吃 400、requireAdmin 沒機會回 401（順序與 Express 反）。
/// 故收 Request、先驗 auth 再手動抽 multipart。
#[utoipa::path(post, path = "/api/admin/upload", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "上傳結果（url/filename/thumbhash，動態 JSON）"), (status = 400, description = "未上傳檔案"), (status = 401, description = "未授權"), (status = 500, description = "寫檔失敗")))]
pub async fn upload(State(state): State<AppState>, req: Request) -> Response {
    if let Err(e) = require_admin(req.headers(), &state).await {
        return e.into_response();
    }
    let mut multipart = match Multipart::from_request(req, &state).await {
        Ok(m) => m,
        // 非 multipart body：multer 情境下 req.file undefined → 400
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "No file uploaded" }))).into_response();
        }
    };
    // multer.single('file')：只取 name=='file' 的欄位
    let mut file: Option<(String, String, Vec<u8>)> = None; // (original_name, mimetype, bytes)
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let original = field.file_name().unwrap_or("").to_string();
        let mimetype = field.content_type().unwrap_or("").to_string();
        match field.bytes().await {
            Ok(b) => {
                file = Some((original, mimetype, b.to_vec()));
                break;
            }
            Err(_) => break,
        }
    }
    let Some((original, mimetype, bytes)) = file else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "No file uploaded" }))).into_response();
    };

    // 路徑/檔名：storage/uploads/YYYY/MM/{Date.now()}-{round(rand*1E9)}{ext}
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // Express 用 new Date().getFullYear()/getMonth()＝容器本地時區（compose TZ=Asia/Taipei）
    // → chrono Local（尊重 TZ env）對齊，月界不會放錯目錄。
    let now_local = chrono::Local::now();
    let year_s = now_local.format("%Y").to_string();
    let month_s = now_local.format("%m").to_string();
    let (year, month) = (year_s.as_str(), month_s.as_str());
    let ext = std::path::Path::new(&original)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let rand_part: u64 = rand::thread_rng().gen_range(0..=1_000_000_000);
    let filename = format!("{now_ms}-{rand_part}{ext}");
    let dir = uploads_base().join(year).join(month);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }
    let path = dir.join(&filename);
    if let Err(e) = tokio::fs::write(&path, &bytes).await {
        return crate::error::internal_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    // 影片：把旋轉矩陣烘進畫素（原地取代，檔名不變）
    if mimetype.starts_with("video/") {
        normalize_video(&path).await;
    }

    let mut file_url = format!("/uploads/{year}/{month}/{filename}");
    // 圖片才算 thumbhash（mimetype 為 client 宣告，對齊 multer）
    let mut th: Option<String> = None;
    if mimetype.starts_with("image/") {
        th = tokio::task::spawn_blocking(move || compute_thumbhash(&bytes)).await.ok().flatten();
        if let Some(t) = &th {
            file_url.push_str(&format!("#th={t}"));
        }
    }

    Json(json!({
        "message": "success",
        "url": file_url,
        "filename": filename,
        "thumbhash": th,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一張純色 PNG，給 thumbhash 用。
    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, _| image::Rgb([(x % 256) as u8, 128, 64]));
        let mut buf = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    /// sharp `withoutEnlargement`：本來就比上限小 → 原尺寸不動。
    #[test]
    fn fit_inside_never_enlarges() {
        assert_eq!(fit_inside(50, 50, 100), (50, 50));
        assert_eq!(fit_inside(100, 100, 100), (100, 100));
        assert_eq!(fit_inside(1, 1, 100), (1, 1));
    }

    /// 長邊縮到上限、短邊按比例（`Math.round`，不是 floor 也不是 ceil）。
    ///
    /// 150×100 特別選來釘住捨入：100/150 = 0.6667，100×0.6667 = 66.67 →
    /// round 是 **67**，floor 會得到 66。sharp 用的是 round，這裡對齊。
    #[test]
    fn fit_inside_scales_the_long_edge_and_rounds_the_short_one() {
        assert_eq!(fit_inside(200, 100, 100), (100, 50), "橫式");
        assert_eq!(fit_inside(100, 200, 100), (50, 100), "直式");
        assert_eq!(fit_inside(150, 100, 100), (100, 67), "短邊要 round 成 67 而不是 floor 成 66");
    }

    /// 極端長寬比不能算出 0——thumbhash 收到 0 會 panic 或產生無效 hash。
    #[test]
    fn fit_inside_clamps_to_at_least_one_pixel() {
        assert_eq!(fit_inside(1000, 1, 100), (100, 1));
        assert_eq!(fit_inside(1, 1000, 100), (1, 100));
    }

    /// 合法圖片 → Some，而且是 base64url 無 padding（會被塞進 URL 的 `#th=` 片段，
    /// 用標準 base64 的話 `+` `/` `=` 在 URL 裡會出事）。
    #[test]
    fn compute_thumbhash_returns_url_safe_base64() {
        let th = compute_thumbhash(&png(200, 120)).expect("合法 PNG 應該算得出 thumbhash");
        assert!(!th.is_empty());
        assert!(!th.contains('='), "不該有 padding：{th}");
        assert!(!th.contains('+') && !th.contains('/'), "必須是 URL-safe 字母表：{th}");
        assert!(
            th.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "出現非 base64url 字元：{th}"
        );
    }

    /// 不是圖片 → None（對齊 Express 的 `catch → null`），不是 panic 也不是 Err。
    #[test]
    fn compute_thumbhash_returns_none_for_non_image_bytes() {
        assert_eq!(compute_thumbhash(b"this is not an image"), None);
        assert_eq!(compute_thumbhash(&[]), None);
        // PNG magic 開頭但內容截斷——比純垃圾更容易讓解碼器走到別的分支
        assert_eq!(compute_thumbhash(&png(10, 10)[..8]), None);
    }

    /// 同一張圖每次算出來要一樣（thumbhash 進 URL，不穩定的話快取與比對都會壞）。
    #[test]
    fn compute_thumbhash_is_deterministic() {
        let bytes = png(64, 64);
        assert_eq!(compute_thumbhash(&bytes), compute_thumbhash(&bytes));
    }

    /// ffprobe 真實輸出的兩種形狀：新版把值放 `side_data` 的 rotation，舊檔放 tags 的
    /// rotate。兩行都會印，沒有的那個是空行——所以不能取第一行，要取第一個非 0 的。
    #[test]
    fn parse_rotation_reads_either_ffprobe_field() {
        assert_eq!(parse_rotation("-90\n\n"), Some(-90), "側資料有值、tags 沒有");
        assert_eq!(parse_rotation("\n90\n"), Some(90), "側資料沒有、tags 有");
        assert_eq!(parse_rotation("-90\n270\n"), Some(-90), "兩個都有 → 取第一個");
    }

    /// 0 要被跳過而不是當成答案。
    ///
    /// 這是整段最容易寫錯的一行：`find(|d| *d != 0.0)`。改成 `== 0.0` 或拿掉 filter 的話，
    /// 「side_data 是 0、tags 才是真正的 90」這種檔案會被判成不需要旋轉——而那正是
    /// 手機直式影片最常見的形狀，結果就是 Chromium 上整片黑（檔頭註解那個線上問題）。
    #[test]
    fn parse_rotation_skips_zero_and_returns_none_when_all_zero() {
        assert_eq!(parse_rotation("0\n90\n"), Some(90), "前面的 0 要跳過");
        assert_eq!(parse_rotation("0\n0\n"), None, "全部是 0 → 不需要處理");
        assert_eq!(parse_rotation("0\n"), None);
        assert_eq!(parse_rotation("0.0\n-180\n"), Some(-180));
    }

    /// 沒有輸出、或輸出不是數字 → None（ffprobe 不在、或影片沒有旋轉欄位）。
    #[test]
    fn parse_rotation_tolerates_garbage() {
        assert_eq!(parse_rotation(""), None);
        assert_eq!(parse_rotation("\n\n\n"), None);
        assert_eq!(parse_rotation("N/A\n"), None);
        assert_eq!(parse_rotation("rotation=90\n"), None, "帶 key 的形式不是我們要的 -of 格式");
        assert_eq!(parse_rotation("not a number\n90\n"), Some(90), "雜訊行要跳過而不是中斷");
    }

    /// 小數要 round（ffprobe 對某些檔案會印 `89.999998`）。
    #[test]
    fn parse_rotation_rounds_fractional_degrees() {
        assert_eq!(parse_rotation("89.999998\n"), Some(90));
        assert_eq!(parse_rotation("-90.4\n"), Some(-90));
        assert_eq!(parse_rotation("  270.5  \n"), Some(271), "前後空白要 trim");
    }

    /// **round 之後可能變成 0**——所以這裡回的是 `Some(0)` 而不是 `None`。
    ///
    /// 濾網 `!= 0.0` 看的是解析出來的浮點數（0.4 通過），round 才把它變成 0。
    /// `normalize_video` 那邊的 `deg != 0` guard 因此不是死碼，它擋的正是這種值。
    #[test]
    fn parse_rotation_can_round_down_to_zero() {
        assert_eq!(parse_rotation("0.4\n"), Some(0));
        assert_eq!(parse_rotation("-0.2\n"), Some(0));
    }

    /// `UPLOAD_BASE_DIR` 有設就用它，沒設退回容器內的正式路徑。
    ///
    /// ⚠ 依賴 nextest 的行程隔離（每個測試各自一個行程）。
    #[test]
    fn uploads_base_honours_the_env_override() {
        unsafe { std::env::remove_var("UPLOAD_BASE_DIR") };
        assert_eq!(uploads_base(), std::path::PathBuf::from("/usr/src/app/storage/uploads"));
        unsafe { std::env::set_var("UPLOAD_BASE_DIR", "/tmp/somewhere") };
        assert_eq!(uploads_base(), std::path::PathBuf::from("/tmp/somewhere"));
    }
}
