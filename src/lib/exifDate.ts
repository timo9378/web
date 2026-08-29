// manifest 的 exif.DateTimeOriginal 目前的**目標格式**是帶相機自身時區的 ISO 8601
//   "2023-04-27T10:56:22+08:00"
// 時區取自 EXIF 2.31 的 OffsetTimeOriginal（實測來源檔 248/248 都有寫）。
// 兩個寫入端（backend handlers::gallery、scripts/builder）都產這一種，
// 舊資料由 scripts/backfill-exif-dates.ts 收斂。
//
// 這裡仍然三種都吃，因為舊備份 / 還沒 backfill 的 manifest 會有歷史格式：
//   exiftool 原樣   "2023:04:27 10:56:22"       → new Date 直接給 Invalid Date
//   舊 Rust 版      "2025-07-27T21:45:09.000Z"  → 拿容器 TZ 硬轉的 UTC，時區是捏造的
//
// ⚠️ 為什麼不直接回 Date：拍攝時間要顯示的是**相機當下的牆上時間**，不是絕對時刻。
// 一張在台灣 04/27 10:56 拍的照片，對美國讀者也還是 04/27 10:56 拍的——如果丟給
// `new Date("…+08:00")` 再用當地時區 render，那位讀者會看到 04/26。所以這裡解出
// 「年月日時分秒」本身，格式化時再固定用 UTC 印出來（Date.UTC + timeZone:'UTC'
// 是拿 Intl 的在地化排版、但不做任何時區換算的標準做法）。

/** 一組牆上時間（相機當下看到的數字），不是絕對時刻。 */
export interface ExifWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 相機寫的 UTC 偏移，如 "+08:00"；相機沒寫就是 null */
  offset: string | null;
}

const STAMP_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseExifWallClock(raw?: string | null): ExifWallClock | null {
  if (!raw) return null;
  const m = STAMP_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // 時區那組是 optional group，沒對到時執行期是 undefined。用 `m.at(7)` 而不是 `m[7]`：
  // 索引取值的型別是 string（型別在騙人），`.at()` 才誠實地回 string | undefined。
  const zone = m.at(7);
  // 尾巴是 Z：只知道 UTC、不知道相機在哪一區，牆上時間救不回來。
  // 退成用觀看端的時區換算（就是 backfill 之前的行為），並在此註明它是近似值。
  if (zone === 'Z') {
    const t = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
    if (Number.isNaN(t.getTime())) return null;
    return {
      year: t.getFullYear(),
      month: t.getMonth() + 1,
      day: t.getDate(),
      hour: t.getHours(),
      minute: t.getMinutes(),
      second: t.getSeconds(),
      offset: null,
    };
  }
  const w: ExifWallClock = {
    year: +y,
    month: +mo,
    day: +d,
    hour: +h,
    minute: +mi,
    second: +s,
    offset: zone ?? null,
  };
  // regex 只保證「兩位數字」，不保證是合法的月/日。沒擋的話 "2023-13-99" 會一路
  // 印成 "13/99"，而丟給 Date.UTC 又會靜靜滾成別的日期——兩種都比回 null 糟。
  return inRange(w) ? w : null;
}

function inRange(w: ExifWallClock): boolean {
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.day > 31) return false;
  if (w.hour > 23 || w.minute > 59 || w.second > 60) return false; // 60 給閏秒留門
  // 大小月 / 閏年：讓 Date 自己判——欄位滾動了就代表原本那天不存在
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day));
  return d.getUTCMonth() === w.month - 1 && d.getUTCDate() === w.day;
}

/** 把牆上時間包成 Date：欄位塞進 UTC，配 `timeZone:'UTC'` 格式化就不會被換算。 */
function asUtcShell(w: ExifWallClock): Date {
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 瀑布流卡片角落的 "MM/DD"。解不出來回空字串。 */
export function exifMonthDay(raw?: string | null): string {
  const w = parseExifWallClock(raw);
  return w ? `${pad(w.month)}/${pad(w.day)}` : '';
}

/** 年份字串。解不出來回空字串。 */
export function exifYear(raw?: string | null): string {
  const w = parseExifWallClock(raw);
  return w ? String(w.year) : '';
}

/** "YYYY/MM/DD"。解不出來回空字串。 */
export function exifYmd(raw?: string | null): string {
  const w = parseExifWallClock(raw);
  return w ? `${w.year}/${pad(w.month)}/${pad(w.day)}` : '';
}

/** EXIF 面板的「拍攝時間」：在地化排版，但印的是相機的牆上時間。 */
export function exifDateTimeText(raw?: string | null, locale = 'zh-TW'): string | null {
  const w = parseExifWallClock(raw);
  if (!w) return null;
  return asUtcShell(w).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
