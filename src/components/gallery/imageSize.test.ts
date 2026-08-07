// @vitest-environment jsdom
//
// 文章圖片的尺寸解析（`#th=…&w=…&h=…` → `<img width height>`）。
//
// 為什麼值得單獨測：這是文章頁 CLS 的唯一解藥，而它壞掉**完全沒有症狀**——
// 圖片照樣顯示、顏色也對，只是在圖載入前少留了版面，於是「捲在深處按 F5」
// 的讀者會看到整片內容跳動。實地量測（2026-08-07 正式站）：
//
//   冷啟動（scrollY=0）  CLS 0.0000   ← 圖在畫面外，位移不計入
//   捲到 4000px 後重整   CLS 0.3362   ← 四個 <p> 從 0px 長到 432/216/186/101
//
// 而 Lighthouse 那種「載入一次量一次」的工具永遠測不到它（見 CLAUDE.md）。
import { describe, expect, it } from 'vitest';

import { BlogImage } from './ImageLightbox';

/**
 * 直接測 React 元件會牽出 lightbox / EXIF / NAS 那一整串。
 * 這裡要釘的是「fragment → width/height」這段純字串邏輯，
 * 所以把它重寫一份對照——⚠ 兩邊必須一致，改了 ImageLightbox 就要改這裡。
 *
 * 用對照實作而不是把函式匯出，是因為匯出一個只給測試用的內部函式會讓 knip
 * 判成未使用的匯出（CI 有鎖），而這段邏輯只有五行、抄一份的成本低於開一個洞。
 */
const decodeSize = (src?: string): { width: number; height: number } | null => {
  if (!src) return null;
  const w = /[#&]w=(\d+)/.exec(src);
  const h = /[#&]h=(\d+)/.exec(src);
  if (!w || !h) return null;
  const width = Number(w[1]);
  const height = Number(h[1]);
  return width > 0 && height > 0 ? { width, height } : null;
};

const TH = 'ivcFDIIJTMeGeYmGeXb8esqvpw';

describe('從 URL fragment 解原始尺寸', () => {
  it('新格式的網址解得出寬高', () => {
    expect(decodeSize(`/uploads/2026/08/x.png#th=${TH}&w=1142&h=724`)).toEqual({ width: 1142, height: 724 });
  });

  // ⚠ 舊文章（2026-08 之前上傳的）沒有 w/h。必須安靜退回 null，
  // 讓元件不輸出 width/height——而不是輸出 0 或 NaN。
  it('舊格式只有 #th= → null，不是 0 也不是 NaN', () => {
    expect(decodeSize(`/uploads/2026/07/x.png#th=${TH}`)).toBeNull();
    expect(decodeSize('/uploads/2026/07/x.png')).toBeNull();
    expect(decodeSize(undefined)).toBeNull();
    expect(decodeSize('')).toBeNull();
  });

  // width="0" 比沒有 width 更糟：瀏覽器會把圖片壓成 0 寬
  it('0 一律當成沒有', () => {
    expect(decodeSize(`x.png#th=${TH}&w=0&h=724`)).toBeNull();
    expect(decodeSize(`x.png#th=${TH}&w=1142&h=0`)).toBeNull();
  });

  // 負號不在 `\d` 裡，而 regex 要求 `=` 後面**緊接**數字 → 整條不匹配 → null。
  // 比「解成正的 5」好：留一個錯的高度會位移，不留只是回到現況。
  it('負數不匹配，退回 null 而不是解成正數', () => {
    expect(decodeSize(`x.png#th=${TH}&w=-5&h=-5`)).toBeNull();
  });

  it('只有其中一個參數也當成沒有（寧可不預留，也不要留錯）', () => {
    expect(decodeSize(`x.png#th=${TH}&w=1142`)).toBeNull();
    expect(decodeSize(`x.png#th=${TH}&h=724`)).toBeNull();
  });

  // 順序不該影響解析：後端目前固定寫 th→w→h，但那是慣例不是保證
  it('參數順序顛倒也解得出來', () => {
    expect(decodeSize(`x.png#w=1142&h=724&th=${TH}`)).toEqual({ width: 1142, height: 724 });
    expect(decodeSize(`x.png#h=724&w=1142`)).toEqual({ width: 1142, height: 724 });
  });

  // ⚠ 這條擋的是「用 /w=(\d+)/ 這種沒有邊界的 regex」：那樣檔名裡的 `w=` 會被誤抓，
  // 而檔名是使用者上傳時帶進來的字串。前綴限定成 `#` 或 `&` 才只吃參數位置。
  it('不會把檔名裡的 w= 誤當成尺寸', () => {
    expect(decodeSize('/uploads/screenshot-w=100.png')).toBeNull();
    expect(decodeSize('/uploads/w=100-h=50.png')).toBeNull();
  });

  // 查詢字串的第一個參數前綴是 `?` 而不是 `#&`，所以不會被讀到。
  // 這是可接受的：尺寸只從**我們自己寫的 fragment** 來，別的來源不該被信任。
  // （`?a=1&w=100` 這種第二個參數確實會匹配到 `&w=`，但站上的圖片網址沒有查詢字串，
  //  而多讀到一個數字最壞也只是預留錯高度，不會比不預留更糟。）
  it('查詢字串的第一個參數不會被當成尺寸', () => {
    expect(decodeSize('/uploads/x.png?w=100&h=50')).toBeNull();
  });

  it('極端長寬比照實解析（704×85 這種橫幅是實際存在的）', () => {
    expect(decodeSize(`x.png#th=${TH}&w=704&h=85`)).toEqual({ width: 704, height: 85 });
  });
});

describe('元件仍然匯出得出來', () => {
  // 這條不是形式主義：上面那份對照實作是抄的，若哪天 ImageLightbox 整個被搬走
  // 或改名，至少這裡會紅，提醒人回來看對照有沒有跟著漂移。
  it('BlogImage 還在', () => {
    expect(BlogImage).toBeTypeOf('function');
  });
});
