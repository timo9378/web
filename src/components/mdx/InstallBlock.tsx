// MDX <Install pkg="react-compare-slider" />：套件安裝指令分頁（npm/pnpm/yarn/bun）。
// 直接生成四個 pkg manager 的指令，套用站上既有的 CodeTabs（分頁 + shiki 高亮 + 複製鈕）。
// dev=true → 開發依賴（-D / -d）。
import CodeTabsBlock from './CodeTabsBlock';

export default function InstallBlock({ pkg = '', dev = false }: { pkg?: string; dev?: boolean }) {
  const p = pkg.trim();
  const files = [
    { name: 'pnpm', lang: 'bash', code: `pnpm add${dev ? ' -D' : ''} ${p}` },
    { name: 'npm', lang: 'bash', code: `npm install${dev ? ' -D' : ''} ${p}` },
    { name: 'yarn', lang: 'bash', code: `yarn add${dev ? ' -D' : ''} ${p}` },
    { name: 'bun', lang: 'bash', code: `bun add${dev ? ' -d' : ''} ${p}` },
  ];
  return (
    <div className="mdx-install">
      <CodeTabsBlock files={files} />
    </div>
  );
}
