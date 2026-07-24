// 文章內容驗證：讓 agent 寫完能自己檢查，而不是等人眼發現。
//
// 存在的理由：前台 MDX 編譯失敗會**靜默退回 markdown**（頁面上就出現一堆裸露的 <Diff …> 原始碼），
// 而 create_post/update_post 一律回 success → agent 完全不知道自己寫壞了。這支把「靜默壞掉」
// 變成「寫完當場知道」。
import { BLOCK_NAMES } from './blocks.js';

export type Severity = 'error' | 'warning' | 'hint';

export interface Finding {
  severity: Severity;
  /** 1-based 行號（拿不到就省略） */
  line?: number;
  message: string;
  /** 該怎麼修 */
  fix?: string;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** MDX 基礎元素以外、文章可用的標籤（HTML 原生標籤不當成未知元件）。 */
const HTML_OK = new Set([
  'br', 'img', 'a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'kbd', 'sup', 'sub', 'small',
  'details', 'summary', 'div', 'span', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'video', 'source', 'figure', 'figcaption', 'blockquote', 'hr', 'mark', 'del', 'ins',
]);

const ALERT_TYPES = 'NOTE|TIP|IMPORTANT|WARNING|CAUTION';

/** 把程式碼區塊（``` 圍籬）與行內 code（反引號）換成等長空白：
 *  文中示範用的 `<Routes>`、`{ "key": 1 }` 都在 code 裡、完全合法，不遮蔽就會全部誤報。
 *  逐行處理並保留長度與換行 → 行號不會跑掉。 */
function maskCode(src: string): string {
  let inFence = false;
  return src
    .split('\n')
    .map((line) => {
      const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        inFence = !inFence;
        return ' '.repeat(line.length);
      }
      if (inFence) return ' '.repeat(line.length);
      return line.replace(/`+[^`]*`+/g, (s) => ' '.repeat(s.length));
    })
    .join('\n');
}

/** 純文字/regex 層面的檢查（不需要編譯）。一律跑在遮蔽過程式碼的版本上。 */
function staticChecks(raw: string, format: string): Finding[] {
  const content = maskCode(raw);
  const out: Finding[] = [];
  const isMdx = format === 'mdx';

  // 1) 用了自訂 block 卻不是 mdx → 前台會把標籤當純文字印出來
  if (!isMdx) {
    const used = [...content.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)]
      .map((m) => m[1])
      .filter((n) => BLOCK_NAMES.has(n));
    if (used.length) {
      out.push({
        severity: 'error',
        message: `format='markdown' 但用到自訂 block：${[...new Set(used)].join('、')}`,
        fix: "把 format 設成 'mdx'（或拿掉這些 block）。",
      });
    }
  }

  // 2) 未知元件（拼錯的 block 名）
  for (const m of content.matchAll(/<([A-Za-z][A-Za-z0-9]*)[\s/>]/g)) {
    const name = m[1];
    if (!/^[A-Z]/.test(name)) continue; // 小寫 = HTML 原生
    if (BLOCK_NAMES.has(name) || HTML_OK.has(name.toLowerCase())) continue;
    out.push({
      severity: 'error',
      line: lineOf(content, m.index),
      message: `未知的 block <${name}>（不在可用清單裡，MDX 會編譯失敗或渲染成空白）`,
      fix: '用 koimsurai_list_blocks 查正確名稱。',
    });
  }

  // 3) alert 斜線語法（本站不支援 → 整段退成普通引用、露出字面文字）
  for (const m of content.matchAll(new RegExp(`^[ \\t]*>[ \\t]*\\[!(${ALERT_TYPES})/`, 'gim'))) {
    out.push({
      severity: 'error',
      line: lineOf(content, m.index),
      message: `alert 的斜線標題語法 [!${m[1].toUpperCase()}/…] 不支援，會整段變成普通引用並露出字面文字`,
      fix: `改成 > [!${m[1].toUpperCase()}] 單獨一行，標題那句寫進內文（可用粗體開頭）。`,
    });
  }

  // 4) alert 同行接標題（能渲染，但那句會黏進內文）
  for (const m of content.matchAll(new RegExp(`^[ \\t]*>[ \\t]*\\[!(${ALERT_TYPES})\\][ \\t]+\\S`, 'gim'))) {
    out.push({
      severity: 'warning',
      line: lineOf(content, m.index),
      message: `[!${m[1].toUpperCase()}] 後面同一行接了字：本站不支援自訂標題，那句會直接黏進內文開頭`,
      fix: '把 [!TYPE] 單獨一行，內容從下一行開始（想強調就用粗體開頭句）。',
    });
  }

  // 5) 正文手打「一、二、三」粗體編號 → 該用 <Steps>
  for (const m of content.matchAll(/^\*\*[一二三四五六七八九十]+、/gm)) {
    out.push({
      severity: 'hint',
      line: lineOf(content, m.index),
      message: '正文手打粗體編號（**一、…**）',
      fix: '改用 <Steps><Step title="…">…</Step></Steps>，數字圈與排版都自動。',
    });
  }

  // 6) 裸網址當連結文字的清單 → 該用 <Refs>
  for (const m of content.matchAll(/^[ \t]*[-*][ \t]+.*\[(?:https?:\/\/|www\.)[^\]]+\]\(/gm)) {
    out.push({
      severity: 'hint',
      line: lineOf(content, m.index),
      message: '清單裡用裸網址當連結文字（每條都會彈 hover 預覽卡，很吵）',
      fix: '文末參考資料改用 <Refs items={[{ label, links: [{ text, href }] }]} />。',
    });
  }

  // 7) 外部圖片熱連結
  for (const m of content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)) {
    if (m[1].includes('koimsurai.com')) continue;
    out.push({
      severity: 'warning',
      line: lineOf(content, m.index),
      message: `圖片直接熱連結外部網址：${m[1].slice(0, 60)}`,
      fix: '先用 koimsurai_upload_image 上傳，改引用 /uploads/… 網址。',
    });
  }

  return out;
}

/** 真的跑一次 MDX 編譯（與前台同一組 plugin）→ 抓出會導致靜默退回 markdown 的語法錯。 */
async function compileCheck(content: string): Promise<Finding[]> {
  try {
    const { compile } = await import('@mdx-js/mdx');
    const remarkGfm = (await import('remark-gfm')).default;
    const { remarkAlert } = await import('remark-github-blockquote-alert');
    await compile(content, {
      outputFormat: 'function-body',
      development: false,
      remarkPlugins: [remarkGfm, remarkAlert],
    });
    return [];
  } catch (e) {
    const err = e as { message?: string; line?: number; reason?: string; column?: number };
    return [{
      severity: 'error',
      line: typeof err.line === 'number' ? err.line : undefined,
      message: `MDX 編譯失敗：${err.reason ?? err.message ?? String(e)}`,
      fix: '前台遇到這個會靜默退回 markdown（讀者會看到裸露的標籤原始碼）。常見原因：正文裡的 < 或 { 沒包成 `inline code`、標籤沒閉合。',
    }];
  }
}

export interface ValidateResult {
  ok: boolean;
  format: string;
  summary: string;
  errors: Finding[];
  warnings: Finding[];
  hints: Finding[];
}

export async function validateContent(content: string, format = 'mdx'): Promise<ValidateResult> {
  const findings = staticChecks(content, format);
  if (format === 'mdx') findings.push(...(await compileCheck(content)));

  const bySev = (s: Severity) => findings.filter((f) => f.severity === s).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const errors = bySev('error');
  const warnings = bySev('warning');
  const hints = bySev('hint');
  const ok = errors.length === 0;

  return {
    ok,
    format,
    summary: ok
      ? `通過：${warnings.length} 個警告、${hints.length} 個建議${warnings.length + hints.length === 0 ? '（完全乾淨）' : ''}`
      : `${errors.length} 個錯誤必須修（發布出去會壞）、${warnings.length} 個警告、${hints.length} 個建議`,
    errors,
    warnings,
    hints,
  };
}
