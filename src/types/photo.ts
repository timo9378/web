// 照片型別的唯一來源在後端：manifest.json 由 gallery sync 寫、gallery_photos 讀，
// 兩端用的是同一個 Rust struct（backend handlers::gallery::GalleryPhoto）。
//
// 這裡原本手寫了一份 interface，比對線上 247 張後有三處對不上：
//   - exif 的 FocalLength/FNumber/ExposureTime 寫成 string，實際是 string | number
//     （舊 Node builder 寫 exiftool 格式化字串、Rust 寫數字，同一份檔案裡混著）
//   - blurhash / isLivePhoto / livePhotoVideoUrl / camera / lens 沒有任何東西會寫
//   - location 同上（EXIFPanel 為它留了一整段 UI）
import type { GalleryPhoto } from '@koimsurai/api-types';

export type PhotoManifest = GalleryPhoto;

// 瀑布流頭部項目類型。只在下面的 MasonryItemType 聯集裡出現，外部不需要拿到這個類別本身。
class MasonryHeaderItem {
  static readonly default = new MasonryHeaderItem()
}

export type MasonryItemType = PhotoManifest | MasonryHeaderItem
