// 文章閱讀體驗的純邏輯：標題拆解、閱讀進度、TOC 的 scroll-spy。
//
// 從 BlogPost.tsx 抽出來的理由不是「檔案太大」，是**這些東西測不到**：
// 原本它們藏在一個 2337 行、92 個 hook 的元件裡，e2e 只走到 16%，而其中
// scroll-spy 的挑選邏輯已經出過一次 bug（見 pickActiveHeading 的說明）。
// 抽成純函式之後，同樣的邏輯可以用一組矩形座標直接驗，不必先渲染整頁文章。
//
// 行為與抽出前逐字相同——這裡沒有順手「改良」任何判斷，那會讓回歸測試失去基準。

/** 標題拆成主標與副標。 */
export interface TitleParts {
  main: string;
  sub: string | null;
}

/**
 * 把標題拆成「主標」與「副標」。
 *
 * 分隔符只認兩種寫法，其餘一律當成單一主標：
 *   - 全形冒號 `：`（**後面不需要空白**）
 *   - 半形冒號 `:` **後面必須跟一個空白**
 *
 * 半形要求空白是為了不要誤切這類標題：`Rust 1.85:2024 edition`、
 * 時間 `09:30`、比例 `16:9`——它們的冒號兩側沒有空白。
 *
 * 拆不出東西（分隔符在開頭、或某一半是空的）就退回單一主標，
 * 不會產生空的主標或空的副標。
 */
export function splitTitle(title: string): TitleParts {
  const m = /：|:\s/.exec(title);
  if (!m || m.index === 0) return { main: title, sub: null };
  const main = title.slice(0, m.index).trim();
  const sub = title.slice(m.index + m[0].length).trim();
  return main && sub ? { main, sub } : { main: title, sub: null };
}

/**
 * 閱讀進度百分比（0~100）。
 *
 * 頁面短到捲不動時回 0 而不是 100——`scrollable <= 0` 時除法會得到 Infinity 或 NaN，
 * 而畫面上那條進度條吃到 NaN 會整條消失（不是變成 0%），看起來像功能壞了。
 */
export function readingProgressPct(scrollY: number, viewportHeight: number, docHeight: number): number {
  const scrollable = docHeight - viewportHeight;
  if (scrollable <= 0) return 0;
  return Math.min(100, Math.max(0, (scrollY / scrollable) * 100));
}

/** scroll-spy 的輸入：標題元素的 id 與它相對視窗頂端的位置。 */
export interface HeadingRect {
  id: string;
  top: number;
}

/**
 * 從目前畫面上的標題位置挑出「正在讀的那一個」。
 *
 * 兩段式，順序不能對調：
 *   1. **落在閱讀帶內的**（top 在 -100 ~ 200 之間）取離 100px 最近的那個。
 *      100px 是「視線大概在的高度」，不是螢幕正中央——讀者的注意力在偏上的位置。
 *   2. 閱讀帶內一個都沒有（例如停在兩個標題之間的長段落）就退而求其次，
 *      取**第一個還在視窗內**的標題，而不是留空。留空的話 TOC 高亮會整個消失，
 *      讀者會以為目錄壞了。
 *
 * ⚠ 呼叫端必須只餵「TOC 有列到的標題」。原本的實作抓的是 `querySelectorAll('[id]')`，
 *   把腳註與 alert 這類也有 id 的元素一起收進來 → 它們會劫持 active 狀態，
 *   而 TOC 裡沒有對應項目，高亮就消失了。那是真的發生過的 bug。
 *
 * 挑不到就回空字串，由呼叫端決定要不要沿用上一個值。
 */
export function pickActiveHeading(rects: HeadingRect[], viewportHeight: number): string {
  let cur = '';
  let minD = Number.POSITIVE_INFINITY;
  for (const { id, top } of rects) {
    if (top <= 200 && top >= -100 && Math.abs(top - 100) < minD) {
      minD = Math.abs(top - 100);
      cur = id;
    }
  }
  if (cur) return cur;
  for (const { id, top } of rects) {
    if (top > 0 && top < viewportHeight) return id;
  }
  return '';
}
