// MDX <Diff lang="ts">…</Diff>：程式碼前後對比。行首 + 為新增、- 為刪除、其餘上下文。
// 重用站上既有 shiki（highlightCode）高亮 base 語言，再依 diff 類型給每行加紅綠底 class。
// SSR 出樸素 pre（CodeBody fallback），client idle 後套 shiki——與 CodeBlock 同策略。
import { useEffect, useMemo, useState } from 'react';
import { highlightCode } from '@/lib/mdx/shikiHighlight';
import { langEmoji } from '@/lib/langEmoji';
import { CodeBody } from './CodeSurface';

type LineType = 'add' | 'del' | 'ctx';

// 解析 diff 文字：去掉每行的 +/-/space 標記，回傳乾淨碼 + 每行類型。
function parseDiff(raw: string): { code: string; types: LineType[] } {
  const lines = raw.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
  const types: LineType[] = [];
  const code = lines
    .map((l) => {
      if (l.startsWith('+')) { types.push('add'); return l.slice(1); }
      if (l.startsWith('-')) { types.push('del'); return l.slice(1); }
      types.push('ctx');
      return l.startsWith(' ') ? l.slice(1) : l;
    })
    .join('\n');
  return { code, types };
}

// shiki 每行輸出 <span class="line">；依序把 add/del 行補上 diff class（CSS 上紅綠底）。
function tagDiffLines(html: string, types: LineType[]): string {
  let i = 0;
  return html.replace(/<span class="line"/g, () => {
    const t = types[i++];
    if (t === 'add') return '<span class="line diff-line-add"';
    if (t === 'del') return '<span class="line diff-line-del"';
    return '<span class="line"';
  });
}

export default function DiffBlock({ code = '', lang = 'text', title }: { code?: string; lang?: string; title?: string }) {
  const { code: clean, types } = useMemo(() => parseDiff(code), [code]);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(clean, lang)
      .then((h) => { if (!cancelled) setHtml(tagDiffLines(h, types)); })
      .catch(() => { /* 失敗留 plain pre fallback */ });
    return () => { cancelled = true; };
  }, [clean, lang, types]);

  const adds = types.filter((t) => t === 'add').length;
  const dels = types.filter((t) => t === 'del').length;

  return (
    <div className="code-block-wrapper mdx-diff">
      <div className="code-block-header">
        <span className="language-name">
          <span className="language-emoji" aria-hidden>{langEmoji(lang)}</span>
          {title ?? lang}
        </span>
        <span className="mdx-diff-stat" aria-label={`新增 ${adds} 行、刪除 ${dels} 行`}>
          <span className="mdx-diff-stat-add">+{adds}</span>
          <span className="mdx-diff-stat-del">−{dels}</span>
        </span>
      </div>
      <CodeBody highlighted={html} code={clean} />
    </div>
  );
}
