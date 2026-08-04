// 文章內容的純函式工具——BlogPost（完整版）與 BlogPostPage（SSR fallback）共用，
// 確保兩邊的標題 anchor id / TOC / 閱讀時間「同一份邏輯」→ fallback 的 TOC 與完整版逐字對得上，
// swap 時右側目錄不需替換、連結也對得到（在 server 端就算好，SEO 拿到目錄結構）。

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/// 標題 → anchor id（與 heading 元素的 id 用同一個 → TOC 連結對得到）。
export const slugify = (text: string): string =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-一-龥]+/g, '')
    .replace(/--+/g, '-');

/// 從 markdown 內文抽 h1~h4（先去掉 code block 內的 # 誤判）。
export function extractHeadings(content: string): TocHeading[] {
  const clean = content.replace(/```[\s\S]*?```/g, '');
  const re = /^(#{1,4})\s+(.+)$/gm;
  const out: TocHeading[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
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
