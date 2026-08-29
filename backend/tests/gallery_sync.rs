//! 相簿同步（`POST /api/admin/gallery/sync`）。
//!
//! 這是 `gallery.rs` 裡最大的一塊，也是原本幾乎完全沒測到的一塊（223 個 region 漏 214）。
//! 它做的事很重：遞迴掃描來源目錄 → 每張新圖旋轉／縮放／編成 webp → 抽 EXIF →
//! 打 RAM++ 拿標籤 → 寫 manifest。壞掉的樣子有三種，沒有一種會噴錯：
//!
//!   · 掃描漏檔／多掃 → 相簿少了幾張，或多出縮圖快取那種本來就不該出現的東西
//!   · orientation 沒套用 → 直式照片的寬高顛倒，manifest 的 aspectRatio 跟著錯，
//!     前端瀑布流用它算欄高，於是整個版面錯位
//!   · 增量判斷失效 → 每次同步都把全部照片重編一次（幾百張，幾分鐘）
//!
//! ⚠ 這個檔用 `std::env::set_var`（sync 的路徑全靠環境變數注入），**依賴 nextest 的
//!   行程隔離**——每個測試各自一個行程，所以互不干擾。用 `cargo test` 跑會共用行程，
//!   這些測試就會互相踩。CI 用的是 nextest。

mod common;

use common::{owner_token, request, test_app};
use serde_json::Value;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// 素材目錄（唯讀；產生方式見 scratchpad 的 gen_gallery_fixtures.py 註解）：
///
/// ```text
/// photo-a.jpg                 60x40，EXIF orientation=6（順時針 90 度）+ 相機參數
/// photo-b.png                 30x50，無 EXIF
/// sub/photo-c.jpeg            40x40，驗遞迴掃描與 .jpeg 副檔名
/// cache/should-not-be-seen.jpg  在被排除的目錄名底下
/// notes.txt                   不支援的副檔名
/// broken.jpg                  副檔名對、內容不是圖片
/// ```
fn source_dir() -> String {
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/gallery_src").to_string()
}

/// 每個測試自己的輸出目錄。nextest 一個測試一個行程，所以 pid 就足以區隔；
/// 不共用是必要的——sync 會把 manifest 寫進去，共用等於測試之間互相污染。
struct OutDir(std::path::PathBuf);

impl OutDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!("koimsurai-gallery-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        unsafe {
            std::env::set_var("GALLERY_SOURCE_PATH", source_dir());
            std::env::set_var("GALLERY_OUTPUT_DIR", &p);
        }
        Self(p)
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(&std::fs::read_to_string(self.0.join("manifest.json")).unwrap()).unwrap()
    }
    fn has(&self, name: &str) -> bool {
        self.0.join(name).exists()
    }
}

impl Drop for OutDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 沒有 tagger 的話 sync 會對每張照片打一次不存在的服務再等 timeout。
/// 指到一個「回 500」的假服務，讓那條路徑走得快又走得到（tagger 失敗不該擋 sync）。
async fn failing_tagger() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/tag"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("PHOTO_TAGGER_URL", server.uri());
        std::env::set_var("PHOTO_TAGGER_TIMEOUT_MS", "2000");
    }
    server
}

async fn sync(app: &axum::Router) -> (axum::http::StatusCode, Value) {
    request(app, "POST", "/api/admin/gallery/sync", None, Some(&owner_token(true))).await
}

#[tokio::test]
async fn 掃描只收支援的圖片_排除的目錄整個不進去() {
    let out = OutDir::new("scan");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;

    let (status, body) = sync(&app).await;
    assert_eq!(status, 200, "{body}");

    // total = 掃到的來源檔數。photo-a / photo-b / sub/photo-c / broken.jpg 共四個：
    //   · notes.txt 副檔名不支援 → 不算
    //   · cache/ 是被排除的目錄名 → 裡面那張連看都不該看
    assert_eq!(body["total"], 4, "掃描到的檔數不對：{body}");
    assert_eq!(body["processed"], 3);
    // broken.jpg 解不開 → 記一筆 failed 但不能讓整個 sync 掛掉
    assert_eq!(body["failed"], 1, "壞掉的圖片應該只記一筆失敗，而不是中斷整批");
    assert_eq!(body["skipped"], 0);
    assert_eq!(body["totalPhotos"], 3);

    // 排除目錄裡那張若被處理了，輸出目錄會多出它的 webp——這是最直接的證據
    assert!(!out.has("should-not-be-seen.webp"), "被排除目錄裡的照片被處理了");
    for id in ["photo-a", "photo-b", "photo-c"] {
        assert!(out.has(&format!("{id}.webp")), "{id} 的全尺寸圖沒產出來");
        assert!(out.has(&format!("{id}-thumb.webp")), "{id} 的縮圖沒產出來");
    }
}

#[tokio::test]
async fn orientation_要套用_寬高跟著交換() {
    let out = OutDir::new("orient");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;
    sync(&app).await;

    let m = out.manifest();
    let a = m["photos"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "photo-a")
        .expect("photo-a 該在 manifest 裡");

    // 來源是 60x40 橫幅，EXIF orientation=6（順時針 90 度）→ 輸出必須是 40x60。
    // 沿用旋轉前的尺寸的話這裡會是 60x40，而 aspectRatio 跟著顛倒——
    // 前端瀑布流拿它算欄高，於是每一張直式照片都會把版面撐歪。
    assert_eq!(a["width"], 40, "orientation 沒套用到輸出尺寸");
    assert_eq!(a["height"], 60);
    let ar = a["aspectRatio"].as_f64().unwrap();
    assert!((ar - 40.0 / 60.0).abs() < 1e-9, "aspectRatio={ar}");

    // 沒有 orientation 的那張照原樣
    let b = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-b").unwrap();
    assert_eq!((b["width"].as_u64(), b["height"].as_u64()), (Some(30), Some(50)));
}

#[tokio::test]
async fn exif_抽得出相機參數與拍攝時間() {
    let out = OutDir::new("exif");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;
    sync(&app).await;

    let m = out.manifest();
    let a = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-a").unwrap();
    let e = &a["exif"];
    assert_eq!(e["make"], "TestMake");
    assert_eq!(e["model"], "TestModel");
    assert_eq!(e["ISO"], 100);
    // 分數要換算成小數：f/1.4 存的是 14/10，直接輸出分子的話前端會顯示 f/14
    assert!((e["FNumber"].as_f64().unwrap() - 1.4).abs() < 1e-6, "FNumber={}", e["FNumber"]);
    assert!((e["FocalLength"].as_f64().unwrap() - 32.0).abs() < 1e-6);
    assert!((e["ExposureTime"].as_f64().unwrap() - 1.0 / 640.0).abs() < 1e-9);

    // ⚠ 這張沒寫 OffsetTimeOriginal，所以輸出的是**不帶時區**的裸本地時間。
    //   舊版是拿容器的 TZ 硬補上去，於是在國外拍的照片會被標成台北時間。
    //   「不知道就不要假裝知道」——後面補不了的資訊，寫錯比留白糟。
    assert_eq!(e["DateTimeOriginal"], "2026-01-02T03:04:05");

    // 沒有 EXIF 的那張要是 null，不是一包全 null 的殼
    let b = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-b").unwrap();
    assert!(b["exif"].is_null(), "沒有 EXIF 時應該整個是 null：{}", b["exif"]);
}

#[tokio::test]
async fn manifest_的網址與格式欄位() {
    let out = OutDir::new("manifest");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;
    sync(&app).await;

    let m = out.manifest();
    assert_eq!(m["totalPhotos"], 3);
    assert!(m["generatedAt"].as_str().unwrap().contains('T'), "generatedAt 應該是 ISO 8601");

    let a = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-a").unwrap();
    // 四種尺寸的網址前端都會用到，缺一個就是某個版位的圖裂掉
    assert_eq!(a["urls"]["full"], "/nas-images/photo-a.webp");
    assert_eq!(a["urls"]["regular"], "/nas-images/photo-a.webp");
    assert_eq!(a["urls"]["small"], "/nas-images/photo-a-thumb.webp");
    assert_eq!(a["urls"]["thumb"], "/nas-images/photo-a-thumb.webp");
    assert_eq!(a["originalUrl"], "/nas-images/photo-a.webp");
    assert_eq!(a["thumbnailUrl"], "/nas-images/photo-a-thumb.webp");
    // title 是檔名（含副檔名），id 是去掉副檔名的
    assert_eq!(a["title"], "photo-a.jpg");
    // format 記的是**來源**格式，不是輸出的 webp
    assert_eq!(a["format"], "jpeg");
    assert!(a["size"].as_u64().unwrap() > 0, "size 應該是輸出檔的實際大小");
    // 沒有拍攝時間就退回檔案 mtime，不能是 0（前端拿它排序）
    assert!(a["shootTime"].as_f64().unwrap() > 0.0);

    let b = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-b").unwrap();
    assert_eq!(b["format"], "png");
}

#[tokio::test]
async fn 第二次同步整批跳過_不重編() {
    // 綁到具名變數（不是 `_`）才會活到測試結束——OutDir 的 Drop 負責清掉暫存目錄，
    // 用 `_` 會當場 drop，第二次 sync 就找不到第一次的產物了
    let _out = OutDir::new("incr");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;

    let (_, first) = sync(&app).await;
    assert_eq!(first["processed"], 3);

    // 增量判斷是「manifest 裡有這筆 **且** 兩個輸出檔都在」。少了任何一半，
    // 每次同步都會把全部照片重編一次——幾百張就是好幾分鐘，而且完全沒有症狀，
    // 只是「同步好像有點慢」。
    let (status, second) = sync(&app).await;
    assert_eq!(status, 200);
    assert_eq!(second["skipped"], 3, "第二次應該整批跳過：{second}");
    assert_eq!(second["processed"], 0);
    assert_eq!(second["totalPhotos"], 3);
}

#[tokio::test]
async fn 輸出檔被刪掉的那張會重新處理() {
    let out = OutDir::new("repair");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;
    sync(&app).await;

    // 只看 manifest 不看檔案的話，這張永遠補不回來——相簿上就一直是破圖
    std::fs::remove_file(out.0.join("photo-b-thumb.webp")).unwrap();
    let (_, again) = sync(&app).await;
    assert_eq!(again["processed"], 1, "缺檔的那張應該被重新處理：{again}");
    assert_eq!(again["skipped"], 2);
    assert!(out.has("photo-b-thumb.webp"), "重新處理之後縮圖該補回來");
}

#[tokio::test]
async fn tagger_回得了標籤就寫進_manifest() {
    let out = OutDir::new("tagged");
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/tag"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "zh_tw": ["日落", "海洋"],
            // 非字串的要被丟掉而不是塞進 manifest —— 前端的 renderer 吃不下數字，
            // 而它會在渲染時才炸，離這裡很遠
            "en": ["sunset", 42, "ocean"],
        })))
        .mount(&server)
        .await;
    unsafe {
        std::env::set_var("PHOTO_TAGGER_URL", server.uri());
        std::env::set_var("PHOTO_TAGGER_TIMEOUT_MS", "2000");
    }
    let (app, _pool) = test_app().await;

    let (_, body) = sync(&app).await;
    assert_eq!(body["tagged"], 3);

    let m = out.manifest();
    let a = m["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-a").unwrap();
    assert_eq!(a["tags"], serde_json::json!(["日落", "海洋"]));
    assert_eq!(a["tagsEn"], serde_json::json!(["sunset", "ocean"]));
}

#[tokio::test]
async fn tagger_掛掉不影響同步本身() {
    let out = OutDir::new("no-tagger");
    // 指到一個沒人在聽的埠：連線直接失敗，比回 500 更接近「服務整個沒起來」
    unsafe {
        std::env::set_var("PHOTO_TAGGER_URL", "http://127.0.0.1:1");
        std::env::set_var("PHOTO_TAGGER_TIMEOUT_MS", "1000");
    }
    let (app, _pool) = test_app().await;

    // 標籤是加分項不是必需品。tagger 失敗就讓整批同步失敗的話，那個服務一掛，
    // 新照片就再也上不了架。
    let (status, body) = sync(&app).await;
    assert_eq!(status, 200, "tagger 掛掉不該讓同步失敗：{body}");
    assert_eq!(body["processed"], 3);
    assert_eq!(body["tagged"], 0);
    let m = out.manifest();
    assert_eq!(m["totalPhotos"], 3);
}

#[tokio::test]
async fn 來源目錄不存在時回_500_並說清楚是哪個路徑() {
    let _out = OutDir::new("missing");
    unsafe { std::env::set_var("GALLERY_SOURCE_PATH", "/definitely/not/here") };
    let (app, _pool) = test_app().await;

    let (status, body) = sync(&app).await;
    assert_eq!(status, 500);
    // 錯誤訊息要帶路徑。只回「同步失敗」的話，NAS 沒掛載跟目錄打錯字長得一模一樣。
    let err = body["error"].as_str().unwrap_or_default();
    assert!(err.contains("/definitely/not/here"), "錯誤訊息沒帶路徑：{err}");
}

#[tokio::test]
async fn 同步需要管理員身分() {
    let out = OutDir::new("auth");
    let (app, _pool) = test_app().await;
    let (status, _) = request(&app, "POST", "/api/admin/gallery/sync", None, None).await;
    assert_eq!(status, 401);
    // 沒帶身分時連掃描都不該開始（掃 NAS 是有成本的操作）
    assert!(!out.has("manifest.json"));
}

#[tokio::test]
async fn 舊_manifest_裡的描述與縮圖雜湊會被保留() {
    let out = OutDir::new("preserve");
    let _tagger = failing_tagger().await;
    let (app, _pool) = test_app().await;

    // 先跑一次拿到正確結構，再手動塞進「只有人工才會有」的欄位
    sync(&app).await;
    let mut m = out.manifest();
    for p in m["photos"].as_array_mut().unwrap() {
        if p["id"] == "photo-a" {
            p["description"] = Value::from("我手寫的說明");
            p["thumbHash"] = Value::from("FggGDIIYdopqcGu4i3SQbhT3Vg==");
        }
    }
    std::fs::write(out.0.join("manifest.json"), serde_json::to_string_pretty(&m).unwrap()).unwrap();
    // 讓它非跑不可（否則會走 skip 那條，什麼都沒驗到）
    std::fs::remove_file(out.0.join("photo-a.webp")).unwrap();

    let (_, again) = sync(&app).await;
    assert_eq!(again["processed"], 1);

    let a = out.manifest();
    let a = a["photos"].as_array().unwrap().iter().find(|p| p["id"] == "photo-a").unwrap();
    // 這兩欄重編時產不出來，只能從舊 manifest 沿用。沖掉的話使用者手寫的說明
    // 會在某一次例行同步之後靜默消失。
    assert_eq!(a["description"], "我手寫的說明");
    assert_eq!(a["thumbHash"], "FggGDIIYdopqcGu4i3SQbhT3Vg==");
}
