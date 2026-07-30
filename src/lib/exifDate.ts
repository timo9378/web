// manifest 的 exif.DateTimeOriginal 在線上有**兩種**格式，因為有兩個寫入端：
//   舊的 Node builder（scripts/builder）→ exiftool 原樣的 "2023:04:27 10:56:22"（246 筆）
//   Rust 的 gallery sync                → UTC ISO 的 "2025-07-27T21:45:09.000Z"（1 筆）
//
// 兩邊的解析點以前各自只吃得下一種：EXIFPanel 用 `new Date(s)`（exiftool 那種會是
// Invalid Date），PhotoGallery 用 `s.split(':')`（ISO 那種會切出 "15/00.164Z"）。
// 這裡集中處理，讓「兩種格式」只在這一個檔案裡是已知的事。
//
// ⚠️ 根治要讓兩個寫入端產同一種格式，但那牽涉時區語意（exiftool 那串是相機當地
// 時間、沒有時區；Rust 那條已經按容器 TZ 轉成 UTC 了），不是純技術選擇。

const EXIFTOOL_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** 兩種格式都吃；解不出來回 null（呼叫端自己決定要顯示什麼）。 */
export function parseExifDate(raw?: string | null): Date | null {
  if (!raw) return null;
  // exiftool 那串沒有時區 → 當成當地時間解（相機記的就是當地牆上時間）
  const m = EXIFTOOL_RE.exec(raw);
  const d = new Date(m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 瀑布流卡片角落的 "MM/DD"。解不出來回空字串（原本的行為）。 */
export function exifMonthDay(raw?: string | null): string {
  const d = parseExifDate(raw);
  return d ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : '';
}

/** 年份字串。解不出來回空字串。 */
export function exifYear(raw?: string | null): string {
  const d = parseExifDate(raw);
  return d ? String(d.getFullYear()) : '';
}

/** "YYYY/MM/DD"（admin 選圖用）。 */
export function exifYmd(raw?: string | null): string {
  const d = parseExifDate(raw);
  return d ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : '';
}
