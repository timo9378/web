//! Gallery / 圖片相關（sharp 域的零-sharp 部分）。
//! `/gallery/photos`＝讀 manifest.json；`/image-proxy`＝純串流代理（Express 用 axios pipe，無 sharp）。

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::state::AppState;

/// GALLERY manifest 路徑：與 Express 相同的 `storage/gallery/manifest.json`。
/// Express 的 `__dirname` = `/usr/src/app`（container），本機測試用 env 覆寫。
fn manifest_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("GALLERY_MANIFEST_PATH") {
        return p.into();
    }
    std::path::PathBuf::from("/usr/src/app/storage/gallery/manifest.json")
}

/// `GET /api/gallery/photos` —— 讀 manifest.json 原樣回傳（parse 後 res.json，非直接送檔）。
#[utoipa::path(get, path = "/api/gallery/photos", tag = "gallery",
    responses((status = 200, description = "相簿 manifest（動態 JSON）")))]
pub async fn gallery_photos() -> Response {
    match tokio::fs::read_to_string(manifest_path()).await {
        Ok(data) => match serde_json::from_str::<Value>(&data) {
            Ok(manifest) => Json(manifest).into_response(),
            // JSON.parse 失敗在 Express 落到非 ENOENT 分支 → 500
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to read gallery manifest" })),
            )
                .into_response(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 無 manifest → 空結構（generatedAt=當下時間，非決定性欄位）
            let now = crate::util::iso_from_millis(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
            );
            Json(json!({
                "version": "1.0.0",
                "generatedAt": now,
                "totalPhotos": 0,
                "photos": [],
            }))
            .into_response()
        }
        Err(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to read gallery manifest" })))
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct ImageProxyQuery {
    url: Option<String>,
}

/// 代理上限：書封/專輯封面都在幾百 KB 級，20MB 已極寬鬆（只在上游給 Content-Length 時驗）
const MAX_PROXY_BYTES: u64 = 20 * 1024 * 1024;

/// `GET /api/image-proxy?url=…` —— 圖片串流代理（解 CORS）。上游 bytes 原樣過。
/// SSRF 防護（Express 版沒有，刻意的行為差異）：URL 先過 net_guard 驗證，
/// 連線後再對實際 peer IP 驗一次（DNS rebinding / redirect 進內網都落在這層）；
/// 且只代理圖片型 Content-Type——不讓這支變成任意網頁的匿名代理。
#[utoipa::path(get, path = "/api/image-proxy", tag = "gallery",
    responses((status = 200, description = "串流上游圖片 bytes")))]
pub async fn image_proxy(State(state): State<AppState>, Query(q): Query<ImageProxyQuery>) -> Response {
    let bad_request = |msg: &'static str| {
        // Express：res.status(400).send('Missing image URL')（text/html）
        (StatusCode::BAD_REQUEST, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], msg).into_response()
    };
    let Some(url) = q.url.filter(|u| !u.is_empty()) else {
        return bad_request("Missing image URL");
    };
    let Some((url, _host)) = crate::net_guard::validate_url(&url) else {
        return bad_request("Invalid image URL");
    };
    let resp = state
        .http
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;
    match resp {
        // axios 預設非 2xx 會 throw → 走 catch 回 500；reqwest 不 throw，手動對齊
        Ok(r) if r.status().is_success() => {
            if let Some(addr) = r.remote_addr()
                && crate::net_guard::is_blocked_ip(&addr.ip())
            {
                return bad_request("Invalid image URL");
            }
            if r.content_length().is_some_and(|len| len > MAX_PROXY_BYTES) {
                return bad_request("Image too large");
            }
            let content_type = r
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_string();
            // octet-stream 給不標 CT 的圖片 CDN 留活口；缺 CT 沿用上面的 image/jpeg 預設
            if !(content_type.starts_with("image/") || content_type.starts_with("application/octet-stream")) {
                return bad_request("Not an image");
            }
            let stream = r.bytes_stream();
            (
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                    (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
                    // SVG 等被當「文件」直接開時不得執行 script（<img> 載入不受回應 CSP 影響）
                    (header::CONTENT_SECURITY_POLICY, "default-src 'none'".to_string()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                ],
                Body::from_stream(stream),
            )
                .into_response()
        }
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            "Failed to fetch image",
        )
            .into_response(),
    }
}

// ── gallery sync（sharp 硬骨頭本體：rotate + resize + lossy webp + EXIF + manifest）──

use axum::http::HeaderMap;
use serde_json::Map;

fn gallery_source_path() -> std::path::PathBuf {
    std::env::var("GALLERY_SOURCE_PATH")
        .map(Into::into)
        .unwrap_or_else(|_| "/usr/src/app/storage/Blog_Source".into())
}
fn gallery_output_dir() -> std::path::PathBuf {
    std::env::var("GALLERY_OUTPUT_DIR")
        .map(Into::into)
        .unwrap_or_else(|_| "/usr/src/app/storage/gallery".into())
}
fn photo_tagger_url() -> String {
    std::env::var("PHOTO_TAGGER_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "http://photo-tagger:8000".into())
}

/// 目錄排除：`/(@eaDir|\.DS_Store|thumbs|cache|gallery)/i` —— 子字串、不分大小寫（照抄）。
fn is_excluded_dir(name: &str) -> bool {
    let l = name.to_lowercase();
    ["@eadir", ".ds_store", "thumbs", "cache", "gallery"].iter().any(|p| l.contains(p))
}

fn is_supported_image(p: &std::path::Path) -> bool {
    p.extension()
        .map(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp"))
        .unwrap_or(false)
}

/// 遞迴掃描（同 Express：readdir 序、不排序）。
fn scan_source_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            if is_excluded_dir(&entry.file_name().to_string_lossy()) {
                continue;
            }
            scan_source_files(&path, out)?;
        } else if ft.is_file() && is_supported_image(&path) {
            out.push(path);
        }
    }
    Ok(())
}

/// EXIF orientation → 旋轉（對齊 sharp `.rotate()` 自動轉）。
fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// exifr `pick` 等價：抽 9 欄映射成前端形狀（make/model 小寫 key）。空 → None。
fn extract_exif(bytes: &[u8]) -> (Option<Map<String, Value>>, u32) {
    let mut orientation = 1u32;
    let exif = match exif::Reader::new().read_from_container(&mut std::io::Cursor::new(bytes)) {
        Ok(e) => e,
        Err(_) => return (None, orientation),
    };
    if let Some(f) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        && let Some(v) = f.value.get_uint(0)
    {
        orientation = v;
    }
    let mut m = Map::new();
    let ascii = |tag: exif::Tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY).and_then(|f| match &f.value {
            exif::Value::Ascii(v) => {
                v.first().map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string())
            }
            _ => None,
        })
    };
    // 數字：exifr 給 JS number → 整值輸出整數（js_normalize 語意）
    let num = |tag: exif::Tag| -> Option<Value> {
        exif.get_field(tag, exif::In::PRIMARY)
            .and_then(|f| match &f.value {
                exif::Value::Rational(v) => v.first().map(|r| r.to_f64()),
                exif::Value::SRational(v) => v.first().map(|r| r.to_f64()),
                exif::Value::Short(v) => v.first().map(|&x| x as f64),
                exif::Value::Long(v) => v.first().map(|&x| x as f64),
                _ => None,
            })
            .map(|f| if f.fract() == 0.0 && f.abs() < 9e15 { Value::from(f as i64) } else { Value::from(f) })
    };
    if let Some(v) = ascii(exif::Tag::Make) {
        m.insert("make".into(), Value::from(v));
    }
    if let Some(v) = ascii(exif::Tag::Model) {
        m.insert("model".into(), Value::from(v));
    }
    if let Some(v) = ascii(exif::Tag::LensModel) {
        m.insert("LensModel".into(), Value::from(v));
    }
    if let Some(v) = num(exif::Tag::FNumber) {
        m.insert("FNumber".into(), v);
    }
    if let Some(v) = num(exif::Tag::PhotographicSensitivity) {
        m.insert("ISO".into(), v);
    }
    if let Some(v) = num(exif::Tag::ExposureTime) {
        m.insert("ExposureTime".into(), v);
    }
    if let Some(v) = num(exif::Tag::FocalLength) {
        m.insert("FocalLength".into(), v);
    }
    if let Some(v) = num(exif::Tag::FocalLengthIn35mmFilm) {
        m.insert("FocalLengthIn35mmFormat".into(), v);
    }
    // DateTimeOriginal："2023:04:27 10:56:22"——exifr 以**容器本地時區**（TZ=Asia/Taipei）
    // 解析再 toISOString（UTC）→ chrono 同語意：naive → Local → UTC ISO。
    if let Some(v) = ascii(exif::Tag::DateTimeOriginal)
        && let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&v, "%Y:%m:%d %H:%M:%S")
    {
        use chrono::TimeZone;
        if let chrono::LocalResult::Single(local) = chrono::Local.from_local_datetime(&naive) {
            let utc = local.with_timezone(&chrono::Utc);
            m.insert(
                "DateTimeOriginal".into(),
                Value::from(utc.format("%Y-%m-%dT%H:%M:%S.000Z").to_string()),
            );
        }
    }
    let e = if m.is_empty() { None } else { Some(m) };
    (e, orientation)
}

/// `resize({width, withoutEnlargement:true})` 尺寸（只縮不放，round）。
fn fit_width(w: u32, h: u32, max_w: u32) -> (u32, u32) {
    if w <= max_w {
        return (w, h);
    }
    let ratio = max_w as f64 / w as f64;
    (max_w, ((h as f64 * ratio).round().max(1.0)) as u32)
}

struct Processed {
    width: u32,
    height: u32,
    size: u64,
    format: String,
    exif: Option<Map<String, Value>>,
}

/// `processSingleGalleryImage`：rotate → 雙輸出 webp（1920 q85 / 400 q80）→ 原檔尺寸 + EXIF。
fn process_single_image(
    source: &std::path::Path,
    full_out: &std::path::Path,
    thumb_out: &std::path::Path,
) -> anyhow::Result<Processed> {
    let bytes = std::fs::read(source)?;
    let (exif_map, orientation) = extract_exif(&bytes);
    let img = image::load_from_memory(&bytes)?; // failOn:'none' ≈ 盡量解
    let format = image::guess_format(&bytes)
        .map(|f| match f {
            image::ImageFormat::Jpeg => "jpeg",
            image::ImageFormat::Png => "png",
            image::ImageFormat::WebP => "webp",
            _ => "jpg",
        })
        .unwrap_or("jpg")
        .to_string();
    let rotated = apply_orientation(img, orientation);
    // 尺寸取「旋轉後」的實際值——EXIF orientation 5~8 會交換寬高，
    // 用旋轉前的值會讓直式照片 manifest 的 aspectRatio 顛倒 → 瀑布流版面錯位。
    let (out_w, out_h) = (rotated.width(), rotated.height());
    for (out_path, max_w, q) in [(full_out, 1920u32, 85.0f32), (thumb_out, 400u32, 80.0f32)] {
        let (tw, th) = fit_width(rotated.width(), rotated.height(), max_w);
        let resized = if (tw, th) == (rotated.width(), rotated.height()) {
            rotated.clone()
        } else {
            rotated.resize_exact(tw, th, image::imageops::FilterType::Lanczos3)
        };
        let rgb = image::DynamicImage::ImageRgb8(resized.to_rgb8());
        let enc = webp::Encoder::from_image(&rgb).map_err(|e| anyhow::anyhow!("webp enc: {e}"))?;
        let mem = enc.encode(q);
        std::fs::write(out_path, &*mem)?;
    }
    let size = std::fs::metadata(full_out)?.len();
    Ok(Processed { width: out_w, height: out_h, size, format, exif: exif_map })
}

/// `tagPhoto`：POST {path} → {zh_tw,en}。失敗 None（不擋 sync）。
async fn tag_photo(state: &AppState, tagger_path: &str) -> Option<(Vec<Value>, Vec<Value>)> {
    let timeout_ms: u64 =
        std::env::var("PHOTO_TAGGER_TIMEOUT_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(25000);
    let resp = state
        .http
        .post(format!("{}/tag", photo_tagger_url()))
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "path": tagger_path }).to_string())
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    let arr = |k: &str| data.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Some((arr("zh_tw"), arr("en")))
}

static GALLERY_SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// `POST /api/admin/gallery/sync` —— requireAdmin；同時只跑一個（409）。
#[utoipa::path(post, path = "/api/admin/gallery/sync", tag = "admin", security(("bearer" = [])),
    responses((status = 200, description = "相簿同步結果（動態 JSON）"), (status = 401, description = "未授權"), (status = 409, description = "同步進行中")))]
pub async fn gallery_sync(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(e) = crate::auth::require_admin(&headers, &state).await {
        return e.into_response();
    }
    let Ok(_guard) = GALLERY_SYNC_LOCK.try_lock() else {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Gallery sync is already running" })),
        )
            .into_response();
    };
    match sync_gallery_manifest(&state).await {
        Ok(result) => {
            let mut out = Map::new();
            out.insert("message".into(), Value::from("Gallery sync completed"));
            for (k, v) in result {
                out.insert(k, v);
            }
            Json(Value::Object(out)).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
            .into_response(),
    }
}

/// `syncGalleryManifest`：掃描 → 每張新圖處理 → RAM++ 標籤 → manifest 寫檔。
async fn sync_gallery_manifest(state: &AppState) -> anyhow::Result<Vec<(String, Value)>> {
    let source_root = gallery_source_path();
    let output_dir = gallery_output_dir();
    if !source_root.exists() {
        anyhow::bail!("ENOENT: no such file or directory, access '{}'", source_root.display());
    }
    tokio::fs::create_dir_all(&output_dir).await?;
    let manifest_file = output_dir.join("manifest.json");

    // readGalleryManifestSafe
    let (version, existing_photos): (Value, Vec<Value>) =
        match tokio::fs::read_to_string(&manifest_file).await {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(p) => (
                    p.get("version")
                        .filter(|v| crate::util::js_truthy(Some(v)))
                        .cloned()
                        .unwrap_or_else(|| Value::from("1.0")),
                    p.get("photos").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                ),
                Err(_) => (Value::from("1.0"), vec![]),
            },
            Err(_) => (Value::from("1.0"), vec![]),
        };
    let existing_by_id: std::collections::HashMap<String, &Value> = existing_photos
        .iter()
        .filter_map(|p| p.get("id").and_then(|v| v.as_str()).map(|id| (id.to_string(), p)))
        .collect();

    let source_files: Vec<std::path::PathBuf> = {
        let root = source_root.clone();
        tokio::task::spawn_blocking(move || {
            let mut v = Vec::new();
            scan_source_files(&root, &mut v).map(|_| v)
        })
        .await??
    };

    let mut processed = 0i64;
    let mut skipped = 0i64;
    let mut failed = 0i64;
    let mut next_photos: Vec<Value> = Vec::new();

    for source_path in &source_files {
        let file_name = source_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let id = source_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let existing = existing_by_id.get(&id).copied();
        let full_out = output_dir.join(format!("{id}.webp"));
        let thumb_out = output_dir.join(format!("{id}-thumb.webp"));

        // skip：existing 有且兩個輸出檔都在（exists 為快速 stat，容忍在 async 內）
        if let Some(ex) = existing
            && full_out.exists()
            && thumb_out.exists()
        {
            next_photos.push(ex.clone());
            skipped += 1;
            continue;
        }

        let sp = source_path.clone();
        let (fo, to) = (full_out.clone(), thumb_out.clone());
        let result = tokio::task::spawn_blocking(move || process_single_image(&sp, &fo, &to)).await;
        let p = match result {
            Ok(Ok(p)) => p,
            _ => {
                failed += 1;
                continue;
            }
        };
        let mtime_ms = tokio::fs::metadata(source_path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);

        // nextPhoto = {...existing, id, title, description, urls, originalUrl, thumbnailUrl,
        //              width, height, aspectRatio, size, format, shootTime, exif, tags, tagsEn}
        // spread 語意：existing key 保位、顯式 key 覆值、新 key 追加（preserve_order Map）。
        let mut photo: Map<String, Value> = existing.and_then(|e| e.as_object()).cloned().unwrap_or_default();
        let full_url = format!("/nas-images/{id}.webp");
        let thumb_url = format!("/nas-images/{id}-thumb.webp");
        photo.insert("id".into(), Value::from(id.clone()));
        photo.insert("title".into(), Value::from(file_name.clone()));
        let desc = existing
            .and_then(|e| e.get("description"))
            .filter(|v| crate::util::js_truthy(Some(v)))
            .cloned()
            .unwrap_or_else(|| Value::from(""));
        photo.insert("description".into(), desc);
        photo.insert(
            "urls".into(),
            serde_json::json!({ "full": full_url, "regular": full_url, "small": thumb_url, "thumb": thumb_url }),
        );
        photo.insert("originalUrl".into(), Value::from(full_url.clone()));
        photo.insert("thumbnailUrl".into(), Value::from(thumb_url.clone()));
        photo.insert("width".into(), Value::from(p.width));
        photo.insert("height".into(), Value::from(p.height));
        let ar = if p.height != 0 { p.width as f64 / p.height as f64 } else { 1.0 };
        photo.insert("aspectRatio".into(), crate::util::js_num_value(ar));
        photo.insert("size".into(), Value::from(p.size));
        photo.insert("format".into(), Value::from(p.format.clone()));
        let shoot = existing
            .and_then(|e| e.get("shootTime"))
            .filter(|v| crate::util::js_truthy(Some(v)))
            .cloned()
            .unwrap_or_else(|| crate::util::js_num_value(mtime_ms));
        photo.insert("shootTime".into(), shoot);
        // exif: exif || existing?.exif（undefined 則 key 被 JSON.stringify 丟掉）
        match (&p.exif, existing.and_then(|e| e.get("exif"))) {
            (Some(e), _) => {
                photo.insert("exif".into(), Value::Object(e.clone()));
            }
            (None, Some(old)) => {
                photo.insert("exif".into(), old.clone());
            }
            (None, None) => {
                photo.remove("exif");
            }
        }
        let tags =
            existing.and_then(|e| e.get("tags")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let tags_en =
            existing.and_then(|e| e.get("tagsEn")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
        photo.insert("tags".into(), Value::Array(tags));
        photo.insert("tagsEn".into(), Value::Array(tags_en));
        next_photos.push(Value::Object(photo));
        processed += 1;
    }

    // RAM++ 標籤：缺 tagsEn 的照片
    let tagger_prefix = std::env::var("PHOTO_TAGGER_GALLERY_PREFIX").unwrap_or_else(|_| "/gallery".into());
    let mut tagged = 0i64;
    for p in next_photos.iter_mut() {
        let has = p.get("tagsEn").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if has {
            continue;
        }
        let id = p.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if let Some((zh, en)) = tag_photo(state, &format!("{tagger_prefix}/{id}.webp")).await
            && (!zh.is_empty() || !en.is_empty())
        {
            if let Some(obj) = p.as_object_mut() {
                obj.insert("tags".into(), Value::Array(zh));
                obj.insert("tagsEn".into(), Value::Array(en));
            }
            tagged += 1;
        }
    }

    // manifest 寫檔（JSON.stringify(manifest, null, 2)）
    let generated_at = crate::util::iso_from_millis(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    );
    let total_photos = next_photos.len();
    let mut manifest = Map::new();
    manifest.insert("version".into(), version);
    manifest.insert("generatedAt".into(), Value::from(generated_at.clone()));
    manifest.insert("totalPhotos".into(), Value::from(total_photos));
    manifest.insert("photos".into(), Value::Array(next_photos));
    tokio::fs::write(&manifest_file, serde_json::to_string_pretty(&Value::Object(manifest))?).await?;

    Ok(vec![
        ("total".into(), Value::from(source_files.len())),
        ("processed".into(), Value::from(processed)),
        ("skipped".into(), Value::from(skipped)),
        ("failed".into(), Value::from(failed)),
        ("tagged".into(), Value::from(tagged)),
        ("totalPhotos".into(), Value::from(total_photos)),
        ("generatedAt".into(), Value::from(generated_at)),
    ])
}
