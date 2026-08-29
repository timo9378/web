/**
 * Monaco 編輯器斜線指令片段庫（C-2）
 *
 * 內建 snippets + 使用者自訂 snippets（localStorage 持久化），
 * 讓部落格作者可以在不改 codebase 的情況下擴充自己常用的模板。
 *
 * 自訂格式（在瀏覽器 console 執行）：
 *   localStorage.setItem('koimsurai_user_snippets', JSON.stringify([
 *     { label: '/sig', detail: '簽名檔', body: '\\n— *Timo*  $0' },
 *     { label: '/ts',  detail: '今天日期', body: '${1:' + new Date().toISOString().slice(0,10) + '}' },
 *   ]));
 *
 * label 必須以 `/` 開頭；body 支援 Monaco snippet 語法（`$0`、`${1:placeholder}`）。
 */

export interface Snippet {
  label: string;
  detail: string;
  body: string;
}

const BUILTIN_SNIPPETS: Snippet[] = [
  { label: '/note', detail: 'GitHub Callout: Note', body: '> [!NOTE]\n> $0' },
  { label: '/tip', detail: 'GitHub Callout: Tip', body: '> [!TIP]\n> $0' },
  { label: '/important', detail: 'GitHub Callout: Important', body: '> [!IMPORTANT]\n> $0' },
  { label: '/warning', detail: 'GitHub Callout: Warning', body: '> [!WARNING]\n> $0' },
  { label: '/caution', detail: 'GitHub Callout: Caution', body: '> [!CAUTION]\n> $0' },
  { label: '/code', detail: '程式碼區塊', body: '```${1:ts}\n$0\n```' },
  { label: '/mermaid', detail: 'Mermaid 圖表', body: '```mermaid\nflowchart LR\n  A[$1] --> B[$0]\n```' },
  { label: '/table', detail: '表格', body: '| ${1:標題} | ${2:標題} |\n| --- | --- |\n| $3 | $0 |' },
  { label: '/details', detail: '可摺疊區塊', body: '<details>\n<summary>${1:點我展開}</summary>\n\n$0\n\n</details>' },
  { label: '/img', detail: '圖片', body: '![${1:alt}](${2:url})' },
  { label: '/fn', detail: '腳註', body: '${1:內文}[^${2:1}]\n\n[^${2:1}]: $0' },
];

const USER_SNIPPETS_KEY = 'koimsurai_user_snippets';

function loadUserSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(USER_SNIPPETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter((s): s is { label: string; detail?: unknown; body: string } => {
        if (typeof s !== 'object' || s === null) return false;
        const o = s as Record<string, unknown>;
        return typeof o.label === 'string' && o.label.startsWith('/') && typeof o.body === 'string';
      })
      .map((s) => ({
        label: s.label,
        detail: typeof s.detail === 'string' ? s.detail : '使用者自訂',
        body: s.body,
      }));
  } catch {
    return [];
  }
}

/**
 * 取得當前使用者可見的 snippets：使用者自訂的會 override 同名的內建項目。
 */
export function getActiveSnippets(): Snippet[] {
  const user = loadUserSnippets();
  if (user.length === 0) return BUILTIN_SNIPPETS;
  const userLabels = new Set(user.map((s) => s.label));
  return [...user, ...BUILTIN_SNIPPETS.filter((s) => !userLabels.has(s.label))];
}
