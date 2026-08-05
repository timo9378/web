// mermaid code block 開頭那段 `---` frontmatter 的解析。
//
// mermaid 官方支援在圖的最前面放一段 YAML 設定（title、config.theme…）。
// 這裡不引 YAML parser：需要處理的只有「一層巢狀的 key: value」，
// 為此多背一個相依（與它的解析差異）不划算。
//
// 從 BlogPost.tsx 抽出來是為了測得到——原本它在一個 2337 行的元件裡，
// 而它的失敗模式是「設定安靜地被忽略」，畫面上只會看到圖的樣式跟預期不同。

export interface MermaidFrontmatter {
  /** 解析出的設定。值是字串，或巢狀一層的字串物件。 */
  config: Record<string, string | Record<string, string>>;
  /** 去掉 frontmatter 之後的圖表本文。 */
  body: string;
}

/**
 * 拆出 mermaid code block 的 frontmatter 與本文。
 *
 * 支援的形狀（縮排 0 或 2 都當成頂層，這是 mermaid 文件裡兩種都出現過的寫法）：
 *
 *     ---
 *     title: 流程圖
 *     config:
 *       theme: dark
 *     ---
 *     graph TD; A --> B
 *
 * 沒有 frontmatter 就回 `{ config: {}, body: 原文 }`——呼叫端不需要分兩種情況處理。
 * `#` 開頭的註解行與空行會被跳過。
 */
export function parseMermaidFrontmatter(code: string): MermaidFrontmatter {
  const trimmed = code.trim();
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(trimmed);
  if (!fm) return { config: {}, body: trimmed };

  const config: MermaidFrontmatter['config'] = {};
  let current: string | null = null;
  for (const line of fm[1].split('\n')) {
    const indent = line.search(/\S/);
    const trimLine = line.trim();
    if (!trimLine || trimLine.startsWith('#')) continue;
    const kv = /^(\w[\w-]*):\s*(.*)/.exec(trimLine);
    if (!kv) continue;
    if (indent === 0 || indent === 2) {
      if (kv[2]) {
        config[kv[1]] = kv[2];
        current = null;
      } else {
        config[kv[1]] = {};
        current = kv[1];
      }
    } else if (current) {
      const cur = config[current];
      if (cur && typeof cur === 'object') cur[kv[1]] = kv[2];
    }
  }
  return { config, body: trimmed.slice(fm[0].length) };
}
