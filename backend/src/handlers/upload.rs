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
