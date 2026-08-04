// MDX <CodeTabs>：多檔程式碼分頁。重用站上既有的 shiki 高亮（highlightCode）。
// SSR 出樸素 pre（fallback），client 端 idle 後套 shiki——與 CodeBlock 同策略、不需 ClientOnly。
// 分頁依副檔名帶上檔案類型彩色圖示（照 VS Code 檔案圖示的感覺）。
/* 檔案圖示是從靜態 FILE_ICONS 表取出的既有元件 ref（非 render 期建立），static-components 誤判 → 關該規則。 */
/* eslint-disable @eslint-react/static-components */
import { useEffect, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  SiTypescript,
  SiJavascript,
  SiReact,
  SiJson,
  SiCss3,
  SiHtml5,
  SiPython,
  SiRust,
  SiGo,
  SiMarkdown,
  SiGnubash,
} from 'react-icons/si';
import { VscFileCode } from 'react-icons/vsc';
import { highlightCode } from '@/lib/mdx/shikiHighlight';
import { CodeBody } from './CodeSurface';

interface CodeFile {
  name: string;
  lang?: string;
  code: string;
}

// 副檔名 → { 圖示, 品牌色 }。未知副檔名退回中性 code 圖示。
const FILE_ICONS: Record<string, { Icon: IconType; color: string }> = {
  ts: { Icon: SiTypescript, color: '#3178c6' },
  tsx: { Icon: SiReact, color: '#61dafb' },
  js: { Icon: SiJavascript, color: '#f7df1e' },
  mjs: { Icon: SiJavascript, color: '#f7df1e' },
  cjs: { Icon: SiJavascript, color: '#f7df1e' },
  jsx: { Icon: SiReact, color: '#61dafb' },
  json: { Icon: SiJson, color: '#cbcb41' },
  css: { Icon: SiCss3, color: '#8a6dff' },
  html: { Icon: SiHtml5, color: '#e34c26' },
  py: { Icon: SiPython, color: '#3776ab' },
  rs: { Icon: SiRust, color: '#dea584' },
  go: { Icon: SiGo, color: '#00add8' },
  md: { Icon: SiMarkdown, color: '#cdd3d8' },
  mdx: { Icon: SiMarkdown, color: '#cdd3d8' },
  sh: { Icon: SiGnubash, color: '#4eaa25' },
  bash: { Icon: SiGnubash, color: '#4eaa25' },
};
function fileIcon(name: string): { Icon: IconType; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICONS[ext] ?? { Icon: VscFileCode, color: 'rgba(255,255,255,0.55)' };
}

export default function CodeTabsBlock({ files = [] }: { files?: CodeFile[] }) {
  const [active, setActive] = useState(0);
  const [html, setHtml] = useState<Record<number, string>>({});
  const cur = files.at(active);

  useEffect(() => {
    if (!cur || html[active]) return;
    let cancelled = false;
    highlightCode(cur.code, cur.lang ?? 'text')
      .then((h) => {
        if (!cancelled) setHtml((prev) => ({ ...prev, [active]: h }));
      })
      .catch(() => {
        /* 高亮失敗留 plain pre */
      });
    return () => {
      cancelled = true;
    };
  }, [active, cur, html]);

  if (!files.length) {
    return <div className="mdx-chart-empty">（CodeTabs：無檔案 / files 格式錯誤）</div>;
  }

  return (
    <div className="mdx-codetabs">
      <div className="mdx-codetabs-bar" role="tablist">
        {files.map((f, i) => {
          const { Icon, color } = fileIcon(f.name);
          return (
            <button
              key={f.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={i === active ? 'mdx-codetabs-tab active' : 'mdx-codetabs-tab'}
              onClick={() => setActive(i)}
            >
              <Icon className="mdx-codetabs-tab-icon" style={{ color }} aria-hidden />
              {f.name}
            </button>
          );
        })}
      </div>
      <div className="mdx-codetabs-body">
        <CodeBody highlighted={html[active] ?? null} code={cur?.code ?? ''} />
      </div>
    </div>
  );
}
