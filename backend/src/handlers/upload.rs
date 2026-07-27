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

/// 讀出影片的旋轉角度（0 表示不需要處理）。ffprobe 不在或讀不到 → None。
async fn probe_rotation(path: &std::path::Path) -> Option<i32> {
    let out = tokio::process::Command::new("ffprobe")
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
    let text = String::from_utf8_lossy(&out.stdout);
    let deg = text.lines().filter_map(|l| l.trim().parse::<f64>().ok()).find(|d| *d != 0.0)?;
    Some(deg.round() as i32)
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

    let mut cmd = tokio::process::Command::new("ffmpeg");
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
