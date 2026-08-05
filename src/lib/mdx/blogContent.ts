// 文章內容的純函式工具——BlogPost（完整版）與 BlogPostPage（SSR fallback）共用，
// 確保兩邊的標題 anchor id / TOC / 閱讀時間「同一份邏輯」→ fallback 的 TOC 與完整版逐字對得上，
// swap 時右側目錄不需替換、連結也對得到（在 server 端就算好，SEO 拿到目錄結構）。

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * anchor id 允許保留的字元：ASCII 詞字元、連字號，以及漢字／假名／諺文。
 *
 * ⚠ 原本只寫了 `一-龥`（CJK 統一漢字基本區），而站上有 ja / ko 版本，於是：
 *   - **日文**的假名整段被吃掉：「まず請求書を見る」→ `請求書見`
 *   - **韓文**一個漢字都沒有，整個標題塌成一個 `-`。線上 ko 版的
 *     `/ko/blog/why-i-switched-to-zed` 25 個標題裡有 14 個 id 是 `-`，
 *     TOC 每一條連結都跳到同一個地方。
 *
 * 這裡只「加」字元、不「減」，所以既有的 zh-TW / en anchor 逐字不變。
 * 各區段：々(3005)／平假名／片假名（跳過 ・30FB，那是分隔符）／CJK 統一漢字
 * （順手補到 9FFF，原本停在 9FA5）／諺文字母與相容字母／諺文音節。
 */
const SLUG_STRIP = /[^\w\-々ぁ-ゟァ-ヺー-ヿ一-鿿ᄀ-ᇿㄱ-ㆎ가-힣]+/g;

/// 標題 → anchor id（與 heading 元素的 id 用同一個 → TOC 連結對得到）。
export const slugify = (text: string): string =>
  text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(SLUG_STRIP, '').replace(/--+/g, '-');

/**
 * 斷行：CRLF 算一個，並且 `\r` 與 U+2028 / U+2029 也都是行終止符。
 *
 * ⚠ 只 `split('\n')` 是不夠的。站上有幾篇文章是 CRLF 存進資料庫的，那樣切每行尾端會留一個
 * `\r`——而 JS 的 `.` **不吃行終止符**，沒有 `m` 旗標的 `$` 也不會在 `\r` 前成立，於是
 * `^(#{1,4})\s+(.+)$` 整個比對失敗，那幾篇的目錄會空到一條都不剩（實測有 3 篇會這樣）。
 * 舊寫法用的是 `gm`，`m` 讓 `$` 在 `\r` 前也算行尾，所以剛好躲過這件事。
 *
 * ⚠ 用 `new RegExp` 而不是 regex literal，是因為 U+2028 / U+2029 本身就是行終止符：
 * 字面字元放進 literal 會讓那一行沒收尾（tsc 報 Unterminated regular expression literal）。
 */
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r${String.fromCharCode(0x2028, 0x2029)}]`);

/**
 * 從 markdown 內文抽 h1~h4，code block 裡的 `#` 不算。
 *
 * ⚠ 逐行掃而不是用 `content.replace(/```[\s\S]*?```/g, '')`，因為那個寫法有兩個漏洞：
 *   1. **沒閉合的 fence 完全擋不住**——非貪婪比對找不到收尾就整段不刪，後面 code 裡的
 *      `# 註解` 全部變成目錄項目。寫到一半的草稿常常就是這樣。
 *   2. `~~~` 也是合法的 fence，舊寫法只認 ```。
 * 這裡改成記住「是哪一種標記開的」，同種才收得掉；沒收掉就當文件到尾都還在 code block 內。
 */
export function extractHeadings(content: string): TocHeading[] {
  const out: TocHeading[] = [];
  let fence: string | null = null;
  for (const line of content.split(LINE_BREAK)) {
    const f = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (f) {
      const kind = f[1][0];
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,4})\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    out.push({ id: slugify(text), text, level: m[1].length });
  }
  return out;
}

/// 估算閱讀時間（分鐘）：去標籤/markdown 符號後 ≈500 字/分。
export function computeReadTime(content: string): number {
  const len = content.replace(/<[^>]+>/g, '').replace(/[#*`>\-[\]()]/g, '').length;
  return Math.max(1, Math.ceil(len / 500));
}
