//! Gallery / 圖片相關（sharp 域的零-sharp 部分）。
//! `/gallery/photos`＝讀 manifest.json；`/image-proxy`＝純串流代理（Express 用 axios pipe，無 sharp）。

use axum::{
    Json,
    body::Body,
    extract::{Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize, Serializer};
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

// ── manifest 型別：這份 manifest 我們自己寫、自己讀，所以型別放在寫的那一端 ──

// manifest 是會被反覆讀寫的檔案，數字欄位一律走 util 的 ser_js_number（整值輸出整數）。
use crate::util::{now_ms, ser_js_number, ser_js_number_opt};

/// 同一張照片的四個尺寸；sync 產出時 full/regular 同檔、small/thumb 同檔。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct PhotoUrls {
    pub full: String,
    pub regular: String,
    pub small: String,
    pub thumb: String,
}

/// EXIF 的數值欄位在同一份 manifest 裡真的有兩種形狀：舊的 Node builder
/// （`scripts/builder`）寫 exiftool 的格式化字串（`"f/1.4"`、`"1/640"`、`"32 mm"`），
/// 本檔的 `extract_exif` 寫數字。線上 247 張裡兩種混雜，所以型別得誠實地兩者皆可
/// ——不是為了寬鬆，是資料真的長這樣。
#[derive(Debug, Clone, Deserialize, specta::Type, utoipa::ToSchema)]
#[serde(untagged)]
pub enum ExifValue {
    Num(#[specta(type = specta_typescript::Number)] f64),
    Text(String),
}

impl Serialize for ExifValue {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Num(n) => ser_js_number(n, s),
            Self::Text(t) => s.serialize_str(t),
        }
    }
}

/// exifr `pick` 的那組欄位（key 大小寫照 exifr 原樣，make/model 是小寫的）。
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct PhotoExif {
    pub make: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "LensModel")]
    pub lens_model: Option<String>,
    #[serde(rename = "FocalLength")]
    pub focal_length: Option<ExifValue>,
    #[serde(rename = "FocalLengthIn35mmFormat")]
    pub focal_length_in_35mm_format: Option<ExifValue>,
    #[serde(rename = "FNumber")]
    pub f_number: Option<ExifValue>,
    #[serde(rename = "ExposureTime")]
    pub exposure_time: Option<ExifValue>,
    #[serde(rename = "ISO")]
    pub iso: Option<ExifValue>,
    /// 拍攝時間。本檔寫的是帶相機自身時區的 ISO 8601（`"2023-04-27T10:56:22+08:00"`）；
    /// 相機沒寫 OffsetTime* 時退成不帶時區的裸本地時間。
    ///
    /// ⚠️ 舊 manifest 裡還有兩種歷史格式：Node builder 寫的 exiftool 原樣
    /// `"2023:04:27 10:56:22"`，以及本檔舊版拿容器 TZ 硬轉的 `"…Z"`。
    /// 前端的 `src/lib/exifDate.ts` 三種都吃；`scripts/backfill-exif-dates.ts` 負責收斂。
    #[serde(rename = "DateTimeOriginal")]
    pub date_time_original: Option<String>,
    // 以下四欄只有舊 builder 會寫；本檔的 extract_exif 不產，但讀到要留著
    #[serde(rename = "Software")]
    pub software: Option<String>,
    #[serde(rename = "Flash")]
    pub flash: Option<String>,
    #[serde(rename = "WhiteBalance")]
    pub white_balance: Option<String>,
    #[serde(rename = "MeteringMode")]
    pub metering_mode: Option<String>,
}

impl PhotoExif {
    const fn is_empty(&self) -> bool {
        self.make.is_none()
            && self.model.is_none()
            && self.lens_model.is_none()
            && self.focal_length.is_none()
            && self.focal_length_in_35mm_format.is_none()
            && self.f_number.is_none()
            && self.exposure_time.is_none()
            && self.iso.is_none()
            && self.date_time_original.is_none()
    }
}

/// 只有舊 builder 會寫（線上 247 張裡 2 張有）。三個數字都只從 JSON 讀進來，
/// 而 JSON 表達不了 NaN/Inf，所以是 `number` 而不是 f64 預設的 `number | null`。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct PhotoGps {
    #[serde(serialize_with = "ser_js_number")]
    #[specta(type = specta_typescript::Number)]
    pub latitude: f64,
    #[serde(serialize_with = "ser_js_number")]
    #[specta(type = specta_typescript::Number)]
    pub longitude: f64,
    #[serde(serialize_with = "ser_js_number_opt")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub altitude: Option<f64>,
}

/// manifest 裡的一張照片。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, utoipa::ToSchema)]
pub struct GalleryPhoto {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub urls: PhotoUrls,
    #[serde(rename = "originalUrl")]
    pub original_url: String,
    #[serde(rename = "thumbnailUrl")]
    pub thumbnail_url: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "aspectRatio", serialize_with = "ser_js_number")]
    #[specta(type = specta_typescript::Number)]
    pub aspect_ratio: f64,
    #[specta(type = specta_typescript::Number)]
    pub size: u64,
    pub format: String,
    /// 舊 builder 產的漸進式佔位圖；本檔不產，但讀到要留著（線上 247 張裡 246 張有）
    #[serde(rename = "thumbHash")]
    pub thumb_hash: Option<String>,
    pub exif: Option<PhotoExif>,
    /// epoch 毫秒。舊資料是 EXIF 拍攝時間，缺時退成來源檔 mtime
    #[serde(rename = "shootTime", serialize_with = "ser_js_number_opt")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub shoot_time: Option<f64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "tagsEn", default)]
    pub tags_en: Vec<String>,
    pub gps: Option<PhotoGps>,
}

/// `GET /api/gallery/photos`
#[derive(Debug, Serialize, specta::Type, utoipa::ToSchema)]
pub struct PhotosManifest {
    pub version: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    #[serde(rename = "totalPhotos")]
    pub total_photos: u32,
    pub photos: Vec<GalleryPhoto>,
}

/// 單張形狀不符只丟那一張（warn），不讓整個相簿 500 ——
/// 舊資料是 Node builder 寫的，沒有任何東西保證每一張都齊。
fn photos_from_values(arr: &[Value]) -> Vec<GalleryPhoto> {
    arr.iter()
        .filter_map(|p| match serde_json::from_value::<GalleryPhoto>(p.clone()) {
            Ok(photo) => Some(photo),
            Err(e) => {
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("<無 id>");
                tracing::warn!("[gallery] 跳過形狀不符的照片 {id}：{e}");
                None
            }
        })
        .collect()
}

fn empty_manifest() -> PhotosManifest {
    PhotosManifest { version: "1.0".into(), generated_at: String::new(), total_photos: 0, photos: vec![] }
}

fn manifest_from_value(v: &Value) -> PhotosManifest {
    let photos =
        v.get("photos").and_then(|p| p.as_array()).map(|a| photos_from_values(a)).unwrap_or_default();
    PhotosManifest {
        version: v
            .get("version")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("1.0")
            .to_string(),
        generated_at: v.get("generatedAt").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
        // 取實際回傳的張數而不是檔案裡寫的：兩者本來就該一致，
        // 真不一致時（有照片被跳過）也不該回一個和 photos 對不上的數字。
        total_photos: u32::try_from(photos.len()).unwrap_or(u32::MAX),
        photos,
    }
}

/// `GET /api/gallery/photos` —— 讀 manifest.json（parse 後 res.json，非直接送檔）。
#[utoipa::path(get, path = "/api/gallery/photos", tag = "gallery",
    responses((status = 200, body = PhotosManifest)))]
pub async fn gallery_photos() -> Response {
    match tokio::fs::read_to_string(manifest_path()).await {
        Ok(data) => match serde_json::from_str::<Value>(&data) {
            Ok(manifest) => Json(manifest_from_value(&manifest)).into_response(),
            // JSON.parse 失敗在 Express 落到非 ENOENT 分支 → 500
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to read gallery manifest" })),
            )
                .into_response(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 無 manifest → 空結構（generatedAt=當下時間，非決定性欄位）
            Json(PhotosManifest {
                version: "1.0.0".into(),
                generated_at: crate::util::iso_from_millis(now_ms()),
                total_photos: 0,
                photos: vec![],
            })
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
        .map_or_else(|_| "/usr/src/app/storage/Blog_Source".into(), Into::into)
}
fn gallery_output_dir() -> std::path::PathBuf {
    std::env::var("GALLERY_OUTPUT_DIR").map_or_else(|_| "/usr/src/app/storage/gallery".into(), Into::into)
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
    p.extension().is_some_and(|e| {
        matches!(e.to_string_lossy().to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp")
    })
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

/// exifr `pick` 等價：抽 9 欄映射成 `PhotoExif`。全空 → None。
fn extract_exif(bytes: &[u8]) -> (Option<PhotoExif>, u32) {
    let mut orientation = 1u32;
    let Ok(exif) = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(bytes)) else {
        return (None, orientation);
    };
    if let Some(f) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        && let Some(v) = f.value.get_uint(0)
    {
        orientation = v;
    }
    let mut m = PhotoExif::default();
    let ascii = |tag: exif::Tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY).and_then(|f| match &f.value {
            exif::Value::Ascii(v) => {
                v.first().map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string())
            }
            _ => None,
        })
    };
    // 數字：exifr 給 JS number（整值輸出整數由 ExifValue 的 Serialize 處理）
    let num = |tag: exif::Tag| -> Option<ExifValue> {
        exif.get_field(tag, exif::In::PRIMARY)
            .and_then(|f| match &f.value {
                exif::Value::Rational(v) => v.first().map(exif::Rational::to_f64),
                exif::Value::SRational(v) => v.first().map(exif::SRational::to_f64),
                exif::Value::Short(v) => v.first().map(|&x| f64::from(x)),
                exif::Value::Long(v) => v.first().map(|&x| f64::from(x)),
                _ => None,
            })
            .map(ExifValue::Num)
    };
    m.make = ascii(exif::Tag::Make);
    m.model = ascii(exif::Tag::Model);
    m.lens_model = ascii(exif::Tag::LensModel);
    m.f_number = num(exif::Tag::FNumber);
    m.iso = num(exif::Tag::PhotographicSensitivity);
    m.exposure_time = num(exif::Tag::ExposureTime);
    m.focal_length = num(exif::Tag::FocalLength);
    m.focal_length_in_35mm_format = num(exif::Tag::FocalLengthIn35mmFilm);
    // DateTimeOriginal 是相機的**牆上時間**，本身不帶時區；時區在另一個 tag——
    // EXIF 2.31 的 OffsetTimeOriginal（實測來源檔 248/248 都有寫，Canon EOS M6 II
    // 與 Pixel 7 Pro 皆然）。
    //
    // 舊寫法是把它丟給 `chrono::Local` 再轉 UTC，也就是拿**容器的** TZ 去補資料裡
    // 沒有的東西：在國外拍的照片（相機會寫 +09:00）會被硬蓋成台北。改成直接接相機
    // 自己寫的 offset；真的沒有 offset 就輸出裸的本地時間，不假裝知道時區。
    if let Some(v) = ascii(exif::Tag::DateTimeOriginal)
        && let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&v, "%Y:%m:%d %H:%M:%S")
    {
        let offset = ascii(exif::Tag::OffsetTimeOriginal)
            .or_else(|| ascii(exif::Tag::OffsetTime))
            .filter(|s| is_utc_offset(s));
        m.date_time_original =
            Some(format!("{}{}", naive.format("%Y-%m-%dT%H:%M:%S"), offset.unwrap_or_default()));
    }
    let e = if m.is_empty() { None } else { Some(m) };
    (e, orientation)
}

/// EXIF 的 `OffsetTime*` 是 `"+08:00"` / `"-05:00"`。格式不對就當沒有——
/// 接一個壞掉的 offset 上去會讓整串時間變成解不開的字串，比沒有還糟。
const fn is_utc_offset(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 6
        && (b[0] == b'+' || b[0] == b'-')
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3] == b':'
        && b[4].is_ascii_digit()
        && b[5].is_ascii_digit()
}

/// `resize({width, withoutEnlargement:true})` 尺寸（只縮不放，round）。
fn fit_width(w: u32, h: u32, max_w: u32) -> (u32, u32) {
    if w <= max_w {
        return (w, h);
    }
    let ratio = f64::from(max_w) / f64::from(w);
    // ratio < 1（上面已擋 w <= max_w），所以 h * ratio < h ≤ u32::MAX；max(1.0) 保證非負
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "只縮不放且已 max(1.0)")]
    (max_w, ((f64::from(h) * ratio).round().max(1.0)) as u32)
}

struct Processed {
    width: u32,
    height: u32,
    size: u64,
    format: String,
    exif: Option<PhotoExif>,
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
        .map_or("jpg", |f| match f {
            image::ImageFormat::Jpeg => "jpeg",
            image::ImageFormat::Png => "png",
            image::ImageFormat::WebP => "webp",
            _ => "jpg",
        })
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
async fn tag_photo(state: &AppState, tagger_path: &str) -> Option<(Vec<String>, Vec<String>)> {
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
    // 標籤一律當字串收：tagger 回非字串（理論上不會）就丟掉那一個，而不是讓
    // manifest 裡混進一個前端 renderer 處理不了的值。
    let arr = |k: &str| {
        data.get(k)
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect::<Vec<String>>())
            .unwrap_or_default()
    };
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
    let existing = match tokio::fs::read_to_string(&manifest_file).await {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(p) => manifest_from_value(&p),
            Err(_) => empty_manifest(),
        },
        Err(_) => empty_manifest(),
    };
    let version = existing.version.clone();
    let existing_by_id: std::collections::HashMap<&str, &GalleryPhoto> =
        existing.photos.iter().map(|p| (p.id.as_str(), p)).collect();

    let source_files: Vec<std::path::PathBuf> = {
        let root = source_root.clone();
        tokio::task::spawn_blocking(move || {
            let mut v = Vec::new();
            scan_source_files(&root, &mut v).map(|()| v)
        })
        .await??
    };

    let mut processed = 0i64;
    let mut skipped = 0i64;
    let mut failed = 0i64;
    let mut next_photos: Vec<GalleryPhoto> = Vec::new();

    for source_path in &source_files {
        let file_name = source_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let id = source_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let existing = existing_by_id.get(id.as_str()).copied();
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
        let (full, thumb) = (full_out.clone(), thumb_out.clone());
        let result = tokio::task::spawn_blocking(move || process_single_image(&sp, &full, &thumb)).await;
        let Ok(Ok(p)) = result else {
            failed += 1;
            continue;
        };
        let mtime_ms = tokio::fs::metadata(source_path)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0.0, |d| d.as_secs_f64() * 1000.0);

        // nextPhoto = {...existing, id, title, description, urls, originalUrl, thumbnailUrl,
        //              width, height, aspectRatio, size, format, shootTime, exif, tags, tagsEn}
        // 原本是 Map<String, Value> 的 spread；改成 struct 後 existing 只剩「明確要留」
        // 的欄位（thumbHash / gps / tags…），其餘一律由這次處理的結果覆值。
        let full_url = format!("/nas-images/{id}.webp");
        let thumb_url = format!("/nas-images/{id}-thumb.webp");
        let ar = if p.height != 0 { f64::from(p.width) / f64::from(p.height) } else { 1.0 };
        next_photos.push(GalleryPhoto {
            id: id.clone(),
            title: file_name.clone(),
            // description 舊值非空才留（js_truthy 對字串＝非空字串）
            description: existing
                .map(|e| e.description.clone())
                .filter(|d| !d.is_empty())
                .unwrap_or_default(),
            urls: PhotoUrls {
                full: full_url.clone(),
                regular: full_url.clone(),
                small: thumb_url.clone(),
                thumb: thumb_url.clone(),
            },
            original_url: full_url,
            thumbnail_url: thumb_url,
            width: p.width,
            height: p.height,
            aspect_ratio: ar,
            size: p.size,
            format: p.format.clone(),
            thumb_hash: existing.and_then(|e| e.thumb_hash.clone()),
            // exif: 這次抽到就用這次的，抽不到才沿用舊的（`exif || existing?.exif`）
            exif: p.exif.clone().or_else(|| existing.and_then(|e| e.exif.clone())),
            // shootTime 舊值非 0 才留（js_truthy 對數字＝非 0 且非 NaN）
            shoot_time: existing
                .and_then(|e| e.shoot_time)
                .filter(|s| *s != 0.0 && !s.is_nan())
                .or(Some(mtime_ms)),
            tags: existing.map(|e| e.tags.clone()).unwrap_or_default(),
            tags_en: existing.map(|e| e.tags_en.clone()).unwrap_or_default(),
            gps: existing.and_then(|e| e.gps.clone()),
        });
        processed += 1;
    }

    // RAM++ 標籤：缺 tagsEn 的照片
    let tagger_prefix = std::env::var("PHOTO_TAGGER_GALLERY_PREFIX").unwrap_or_else(|_| "/gallery".into());
    let mut tagged = 0i64;
    for p in &mut next_photos {
        if !p.tags_en.is_empty() {
            continue;
        }
        if let Some((zh, en)) = tag_photo(state, &format!("{tagger_prefix}/{}.webp", p.id)).await
            && (!zh.is_empty() || !en.is_empty())
        {
            p.tags = zh;
            p.tags_en = en;
            tagged += 1;
        }
    }

    // manifest 寫檔（JSON.stringify(manifest, null, 2)）
    let generated_at = crate::util::iso_from_millis(now_ms());
    let total_photos = next_photos.len();
    let manifest = PhotosManifest {
        version,
        generated_at: generated_at.clone(),
        total_photos: u32::try_from(total_photos).unwrap_or(u32::MAX),
        photos: next_photos,
    };
    tokio::fs::write(&manifest_file, serde_json::to_string_pretty(&manifest)?).await?;

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

#[cfg(test)]
mod pure_tests {
    use super::*;

    // 這一塊全是「錯了不會有錯誤訊息」的純函式：照片轉錯方向、尺寸算錯、
    // 某個資料夾整個被跳過——都要有人去看相簿才會發現，而站長不會天天看。

    #[test]
    fn is_excluded_dir_是子字串比對而且不分大小寫() {
        for name in ["@eaDir", "@eadir", ".DS_Store", "Thumbs", "cache", "gallery"] {
            assert!(is_excluded_dir(name), "{name} 應該被排除");
        }
        // ⚠ 是 `contains` 不是相等 —— 所以使用者自己取名叫「Gallery 2024」或
        // 「快取備份cache」的資料夾會**整個被跳過**，而且不會有任何訊息。
        // 這是既有行為（輸出目錄就叫 gallery，靠它避免自我遞迴），寫下來免得日後
        // 有人花時間查「為什麼那個資料夾的照片都沒進相簿」。
        assert!(is_excluded_dir("Gallery 2024"));
        assert!(is_excluded_dir("我的cache備份"));
        // 正常的相片資料夾不該被誤傷
        for name in ["2026-01 京都", "Photos", "raw", "Lightroom Export"] {
            assert!(!is_excluded_dir(name), "{name} 不該被排除");
        }
    }

    #[test]
    fn is_supported_image_只認四種副檔名_不分大小寫() {
        for ok in ["a.jpg", "a.JPG", "a.jpeg", "a.PNG", "a.webp", "深/巢/狀/b.WebP"] {
            assert!(is_supported_image(std::path::Path::new(ok)), "{ok}");
        }
        for no in ["a.heic", "a.raw", "a.cr3", "a.mp4", "a.txt", "沒有副檔名", "a.jpg.bak"] {
            assert!(!is_supported_image(std::path::Path::new(no)), "{no}");
        }
    }

    #[test]
    fn is_utc_offset_只接受正負時分的六字元格式() {
        for ok in ["+08:00", "-05:00", "+00:00", "+13:45"] {
            assert!(is_utc_offset(ok), "{ok}");
        }
        // 格式不對就當沒有：接一個壞掉的 offset 上去，整串時間會變成解不開的字串
        for no in ["+8:00", "08:00", "+0800", "Z", "", "+08:0", "+08:000", "＋08:00"] {
            assert!(!is_utc_offset(no), "{no:?} 不該被當成合法 offset");
        }
    }

    #[test]
    fn fit_width_只縮不放且四捨五入() {
        // 比上限小的原樣返回（withoutEnlargement）——放大會變成糊的
        assert_eq!(fit_width(800, 600, 1920), (800, 600));
        assert_eq!(fit_width(1920, 1080, 1920), (1920, 1080), "剛好等於上限不動");
        // 縮小要維持比例並四捨五入
        assert_eq!(fit_width(3840, 2160, 1920), (1920, 1080));
        assert_eq!(fit_width(4000, 3000, 1920), (1920, 1440));
        // 3:1 的極寬幅縮到 400：高度 133.33 → 133
        assert_eq!(fit_width(1200, 400, 400), (400, 133));
        // 極端長寬比不能算出 0（0 會讓 resize 直接失敗）
        assert_eq!(fit_width(10_000, 3, 400), (400, 1), "算出來不足 1 也要保底 1");
    }

    /// 用 2×2 的四色圖驗八個方向。EXIF orientation 錯了照片就是躺著或鏡像，
    /// 而且**只有人眼看得出來**——沒有任何自動化的東西會抱怨。
    #[test]
    fn apply_orientation_八個方向都對() {
        use image::{Rgb, RgbImage};
        // A B
        // C D
        let (a, b, c, d) = (Rgb([1, 0, 0]), Rgb([2, 0, 0]), Rgb([3, 0, 0]), Rgb([4, 0, 0]));
        let mut src = RgbImage::new(2, 2);
        src.put_pixel(0, 0, a);
        src.put_pixel(1, 0, b);
        src.put_pixel(0, 1, c);
        src.put_pixel(1, 1, d);
        let base = image::DynamicImage::ImageRgb8(src);

        let grid = |o: u32| -> [u8; 4] {
            let img = apply_orientation(base.clone(), o).to_rgb8();
            [img.get_pixel(0, 0)[0], img.get_pixel(1, 0)[0], img.get_pixel(0, 1)[0], img.get_pixel(1, 1)[0]]
        };
        assert_eq!(grid(1), [1, 2, 3, 4], "1＝不動");
        assert_eq!(grid(2), [2, 1, 4, 3], "2＝左右鏡像");
        assert_eq!(grid(3), [4, 3, 2, 1], "3＝旋轉 180");
        assert_eq!(grid(4), [3, 4, 1, 2], "4＝上下鏡像");
        assert_eq!(grid(5), [1, 3, 2, 4], "5＝轉置");
        assert_eq!(grid(6), [3, 1, 4, 2], "6＝順時針 90（最常見：直拍）");
        assert_eq!(grid(7), [4, 2, 3, 1], "7＝反轉置");
        assert_eq!(grid(8), [2, 4, 1, 3], "8＝逆時針 90");
        // 沒有 EXIF 或值不合法時原樣返回，不要亂轉
        assert_eq!(grid(0), [1, 2, 3, 4]);
        assert_eq!(grid(9), [1, 2, 3, 4]);
    }

    #[test]
    fn extract_exif_對不是圖片的位元組不會炸() {
        // 相簿裡混進壞檔或非 JPEG 時，整個 sync 不該掛掉
        let (exif, orientation) = extract_exif(b"not an image at all");
        assert!(exif.is_none());
        assert_eq!(orientation, 1, "讀不到就用 1（不轉），不是 0");
        let (exif, o) = extract_exif(&[]);
        assert!(exif.is_none());
        assert_eq!(o, 1);
    }

    fn photo_json(id: &str) -> Value {
        json!({
            "id": id, "title": "標題", "urls": { "full": "f", "regular": "r", "small": "s", "thumb": "t" },
            "originalUrl": "o", "thumbnailUrl": "th", "width": 1920, "height": 1080,
            "aspectRatio": 1.777, "size": 12345, "format": "webp",
        })
    }

    #[test]
    fn photos_from_values_只丟掉壞的那張不是整包() {
        // manifest 是舊的 Node builder 寫的，沒有任何東西保證每張都齊。
        // 一張壞的就 500 的話，整個相簿頁會空白——寧可少一張。
        let arr = [
            photo_json("ok-1"),
            json!({ "id": "缺一堆必填欄位" }),
            photo_json("ok-2"),
            json!("根本不是物件"),
        ];
        let out = photos_from_values(&arr);
        assert_eq!(out.len(), 2, "只留得下兩張");
        assert_eq!(out[0].id, "ok-1");
        assert_eq!(out[1].id, "ok-2");
        // 選填欄位要有預設值而不是讓整張被丟掉
        assert_eq!(out[0].description, "");
        assert!(out[0].tags.is_empty());
        assert!(out[0].thumb_hash.is_none());
    }

    #[test]
    fn manifest_from_value_的_total_取實際張數而不是檔案裡寫的() {
        // 兩者本來就該一致；真不一致時（有照片被跳過）回一個對不上的數字
        // 會讓前端的分頁或「共 N 張」跟實際內容打架。
        let v = json!({
            "version": "2.0",
            "generatedAt": "2026-01-01T00:00:00.000Z",
            "totalPhotos": 999,
            "photos": [photo_json("a"), json!({ "id": "壞的" }), photo_json("b")],
        });
        let m = manifest_from_value(&v);
        assert_eq!(m.total_photos, 2, "檔案寫 999、實際只有 2 張解得開");
        assert_eq!(m.photos.len(), 2);
        assert_eq!(m.version, "2.0");
        assert_eq!(m.generated_at, "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn manifest_from_value_缺欄位時有合理預設() {
        let m = manifest_from_value(&json!({}));
        assert_eq!(m.version, "1.0", "沒寫版本就當 1.0");
        assert_eq!(m.generated_at, "");
        assert_eq!(m.total_photos, 0);
        assert!(m.photos.is_empty());
        // 空字串的 version 也要退回預設（不是原樣吐空字串出去）
        let m = manifest_from_value(&json!({ "version": "" }));
        assert_eq!(m.version, "1.0");
        // photos 不是陣列時不該炸
        let m = manifest_from_value(&json!({ "photos": "不是陣列" }));
        assert!(m.photos.is_empty());
    }

    /// 圖片處理管線本身：旋轉 → 縮到 1920/400 → 轉 webp。
    ///
    /// 這是相簿唯一會**改寫使用者資料**的地方，而輸出好不好只有人眼看得出來。
    /// 特別驗「回傳的寬高取的是旋轉**後**的值」——註解說得很清楚：
    /// orientation 5~8 會交換寬高，用旋轉前的值會讓直式照片的 aspectRatio 顛倒，
    /// 瀑布流版面就整個錯位。
    #[test]
    fn process_single_image_縮圖轉檔並回報旋轉後的尺寸() {
        let dir = std::env::temp_dir().join(format!("gallery-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.png");
        let full = dir.join("full.webp");
        let thumb = dir.join("thumb.webp");

        // 3000×1000 的橫幅（沒有 EXIF → orientation 1）
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(3000, 1000, |x, _| {
            image::Rgb([u8::try_from(x % 256).unwrap_or(0), 128, 64])
        }));
        img.save(&src).unwrap();

        let p = process_single_image(&src, &full, &thumb).expect("處理成功");
        assert_eq!((p.width, p.height), (3000, 1000), "回報的是原始（旋轉後）尺寸，不是縮圖尺寸");
        assert_eq!(p.format, "png", "format 取自來源檔而不是輸出檔");
        assert!(p.exif.is_none(), "PNG 沒有 EXIF");
        assert!(p.size > 0);
        assert_eq!(p.size, std::fs::metadata(&full).unwrap().len(), "size 取的是 full 那張");

        // 兩張輸出都要是 webp，而且尺寸依 1920 / 400 縮
        for (path, want_w, want_h) in [(&full, 1920u32, 640u32), (&thumb, 400, 133)] {
            let bytes = std::fs::read(path).unwrap();
            assert_eq!(
                image::guess_format(&bytes).unwrap(),
                image::ImageFormat::WebP,
                "{path:?} 應該是 webp"
            );
            let out = image::load_from_memory(&bytes).unwrap();
            assert_eq!((out.width(), out.height()), (want_w, want_h), "{path:?} 的尺寸");
        }

        // 比上限小的圖不放大（withoutEnlargement）
        let small_src = dir.join("small.png");
        image::DynamicImage::ImageRgb8(image::RgbImage::new(300, 200)).save(&small_src).unwrap();
        let p = process_single_image(&small_src, &full, &thumb).expect("處理成功");
        assert_eq!((p.width, p.height), (300, 200));
        let out = image::load_from_memory(&std::fs::read(&full).unwrap()).unwrap();
        assert_eq!((out.width(), out.height()), (300, 200), "小圖不該被放大成 1920");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn process_single_image_遇到不是圖片的檔案回_err_而不是_panic() {
        // 相簿來源目錄裡混進壞檔時，整批 sync 應該跳過那張而不是整個掛掉
        let dir = std::env::temp_dir().join(format!("gallery-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("broken.jpg");
        std::fs::write(&src, "這其實不是 JPEG".as_bytes()).unwrap();
        let r = process_single_image(&src, &dir.join("f.webp"), &dir.join("t.webp"));
        assert!(r.is_err(), "壞檔應該回 Err");
        // 來源不存在也一樣
        assert!(
            process_single_image(&dir.join("不存在.jpg"), &dir.join("f.webp"), &dir.join("t.webp")).is_err()
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_manifest_的形狀跟正常回應一致() {
        let m = empty_manifest();
        assert_eq!(m.version, "1.0");
        assert_eq!(m.total_photos, 0);
        assert!(m.photos.is_empty(), "photos 一定要是陣列——前端直接 .map");
    }
}

#[cfg(test)]
mod sync_lock_tests {
    use super::*;

    /// `GALLERY_SYNC_LOCK` 是模組私有的 static，整合測試（tests/api.rs 是另一個 crate）
    /// 摸不到它。而「同時只跑一個」這件事**只有**佔住鎖才驗得了確定——靠兩個並發請求
    /// 去賽跑會變成計時測試，在共用 runner 上必然間歇性失敗。所以這兩個測試寫在模組內。
    #[tokio::test]
    async fn sync_returns_409_while_another_is_running() {
        let state = crate::state::test_state().await;
        let headers = crate::state::test_admin_headers();

        let guard = GALLERY_SYNC_LOCK.lock().await;
        // 超時是斷言的一部分：try_lock 若被改成 lock().await，這裡會死等而不是回 409。
        // 沒有 timeout 的話那個退化會表現成「測試掛住」，在 CI 上只看得到一個沒有訊息的逾時。
        let resp =
            tokio::time::timeout(std::time::Duration::from_secs(5), gallery_sync(State(state), headers))
                .await
                .expect("已經有 sync 在跑時應該立刻回 409，不是排隊等它");
        assert_eq!(
            resp.status(),
            StatusCode::CONFLICT,
            "已經有一個 sync 在跑時要回 409，而不是排隊等它（那會把 admin 請求掛住）"
        );
        drop(guard);
    }

    /// 配對的反向斷言：沒人佔鎖時**不能**回 409。
    /// 少了這個，「無條件回 409」的實作也會讓上面那個測試綠。
    /// 這裡來源目錄不存在，所以走的是 500（ENOENT）——重點是它不是 409。
    #[tokio::test]
    async fn sync_does_not_report_conflict_when_lock_is_free() {
        let state = crate::state::test_state().await;
        let headers = crate::state::test_admin_headers();

        let resp = gallery_sync(State(state), headers).await;
        assert_ne!(resp.status(), StatusCode::CONFLICT, "沒人在跑卻回 409");
    }

    /// 鎖在 admin 守衛**之後**才拿：未授權的人不該有辦法觸發 409/佔用語意。
    #[tokio::test]
    async fn sync_checks_admin_before_touching_the_lock() {
        let state = crate::state::test_state().await;

        let guard = GALLERY_SYNC_LOCK.lock().await;
        let resp = gallery_sync(State(state), HeaderMap::new()).await;
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "沒帶 token 應該是 401，不是 409——409 會洩漏「現在有沒有在同步」"
        );
        drop(guard);
    }
}
