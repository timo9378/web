// MDX 自訂 block 元件。之後每加一個 block 就在這裡多一個元件 export，
// 再到 MdxContent 的 scope 註冊。未來可由此衍生 prop 驗證 + Agent 的 block 目錄。
import {
  Children,
  isValidElement,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ClientOnly } from '@tanstack/react-router';
import { FaGithub, FaXTwitter } from 'react-icons/fa6';
import CodeTabsBlock from './CodeTabsBlock';
import DiffImpl from './DiffBlock';
import InstallImpl from './InstallBlock';
import RefsImpl from './RefsBlock';
import PollImpl from './PollBlock';

// 影片 block（Video 自架、YouTube facade）直接重新匯出 → 一併在 MdxContent scope 註冊。
export { Video, YouTube } from './MediaEmbed';

// 重的元件 lazy import，只有文章真的用到才進 bundle。
const BarChartImpl = lazy(() => import('./BarChartBlock'));
const MathImpl = lazy(() => import('./MathBlock'));
const SketchImpl = lazy(() => import('./SketchBlock'));
const ChartImpl = lazy(() => import('./ChartBlock'));
const InteractiveChartImpl = lazy(() => import('./InteractiveChartBlock'));
const ImageCompareImpl = lazy(() => import('./ImageCompareBlock'));
const chartFallback = <div className="mdx-chart-loading" aria-hidden />;

/** 作者註：段落長度的站長旁白。極簡左側線條風（引號圖標），跟彩色 alert 明確區隔。 */
export function Note({ children, title }: { children?: ReactNode; title?: string }) {
  return (
    <aside className="mdx-note">
      <div className="mdx-note-label">
        <span className="mdx-note-quote" aria-hidden>
          ❝
        </span>
        {title ?? '站長註'}
      </div>
      <div className="mdx-note-content">{children}</div>
    </aside>
  );
}

// useLayoutEffect 只在 client（SSR 用 useEffect 避免警告）。
const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/** 行內作者註解：被註解的文字帶虛線底，hover/點擊 → 底線由左長出 + 冒出小卡。
 *  小卡 portal 到 body（fixed 定位、夾進視窗）→ 不被文章卡片的 overflow:clip / backdrop-filter 裁掉。 */
export function Annot({ children, note }: { children?: ReactNode; note?: ReactNode }) {
  const [open, setOpen] = useState(false); // 觸控：點擊 toggle
  const [hover, setHover] = useState(false); // 桌機：hover
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = open || hover;

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!show || !el) return;
    // 註解文字若跨行，getBoundingClientRect() 會 union 兩行 → left 變成整段最左、上下也含另一行，
    // 卡片會飄到離被註解的詞很遠的地方。改用逐行的 client rects：對齊「第一行」的起點，
    // 放下方時則對齊「最後一行」的底 → 卡片永遠貼著文字本身。
    const rects = el.getClientRects();
    const first = rects.item(0) ?? el.getBoundingClientRect();
    const last = rects.item(rects.length - 1) ?? first;
    const pad = 8;
    const vw = window.innerWidth;
    // ⚠ 本模組 export 了名為 Math 的元件（KaTeX），會遮蔽全域 Math → 不能用 Math.min。
    const cardW = 304 < vw - pad * 2 ? 304 : vw - pad * 2;
    let left = first.left;
    if (left + cardW > vw - pad) left = vw - pad - cardW;
    if (left < pad) left = pad;
    const below = first.top < 170; // 太靠視窗頂 → 卡片放下方
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setPos({ left, top: below ? last.bottom + 9 : first.top - 9, below });
  }, [show]);

  // 小卡是 portal 到 body 的 fixed 定位：捲動時文字走了、卡片會留在原地
  // （點擊開啟後按鈕仍保有焦點 → onFocus 讓它一直是 show，於是卡在畫面上）。
  // 捲動就收起來，比追著重算位置單純，也符合預期。
  useEffect(() => {
    if (!show) return;
    const close = () => {
      setOpen(false);
      setHover(false);
    };
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('scroll', close);
    };
  }, [show]);

  return (
    <>
      {/* 用真的 <button>：原本是 span + role="note" + tabIndex={0} + 手刻 onKeyDown，
          role="note" 本身是非互動語意，卻掛了 tabIndex 與鍵盤處理——名實不符。
          <button> 直接拿到焦點、Enter/Space 與正確語意，下面的 onKeyDown 只需留 Escape。 */}
      <button
        ref={ref}
        type="button"
        className="annot"
        data-open={show ? 'true' : undefined}
        aria-expanded={show}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Enter/Space 由 <button> 原生處理，這裡只補 Escape 收起
          if (e.key === 'Escape') {
            setOpen(false);
            setHover(false);
          }
        }}
      >
        <span className="annot-text">{children}</span>
      </button>
      {show && pos
        ? createPortal(
            <div
              className={
                pos.below ? 'annot-card annot-card--portal annot-card--below' : 'annot-card annot-card--portal'
              }
              role="tooltip"
              style={{ left: pos.left, top: pos.top }}
            >
              <span className="annot-card-label">站長註</span>
              <span className="annot-card-body">{note}</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** 吃 JSON 資料的長條圖（recharts）。SSR 不友善（要量容器尺寸）→ ClientOnly 包 + lazy 載，
 *  fallback 是固定高佔位（避免 hydration reflow）。
 *  用法：<BarChart data={[{label:'int8',value:42},…]} title="…" unit="tok/s" /> */
export function BarChart(props: {
  data?: { label: string; value: number }[];
  title?: string;
  unit?: string;
  color?: string;
}) {
  return (
    <ClientOnly fallback={chartFallback}>
      <Suspense fallback={chartFallback}>
        <BarChartImpl {...props} />
      </Suspense>
    </ClientOnly>
  );
}

/** 統一圖表（recharts）：type = line/area/bar/pie/donut/scatter/radar。
 *  用法 <Chart type="line" data={[{label:'2020', a:3, b:5}]} series={['a','b']} title="…" /> */
export function Chart(props: {
  type?: string;
  data?: Record<string, unknown>[];
  series?: (string | { key: string; name?: string; color?: string })[];
  categoryKey?: string;
  title?: string;
  unit?: string;
  stacked?: boolean;
  xKey?: string;
  yKey?: string;
  zKey?: string;
  height?: number;
}) {
  return (
    <ClientOnly fallback={chartFallback}>
      <Suspense fallback={chartFallback}>
        <ChartImpl {...(props as Parameters<typeof ChartImpl>[0])} />
      </Suspense>
    </ClientOnly>
  );
}

/** 互動圖表：讀者拉滑桿改值 → 即時重繪。用法
 *  <InteractiveChart type="bar" data={[{label:'A', value:40}]} title="…" unit="…" /> */
export function InteractiveChart(props: {
  type?: 'bar' | 'line' | 'area';
  data?: { label?: string; value?: number }[];
  title?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <ClientOnly fallback={chartFallback}>
      <Suspense fallback={chartFallback}>
        <InteractiveChartImpl {...props} />
      </Suspense>
    </ClientOnly>
  );
}

/** CJK 注音（Ruby）：base 字 + 上方讀音。用法 <Ruby text="漢字" reading="かんじ" />。 */
export function Ruby({ text, reading }: { text?: ReactNode; reading?: string }) {
  return (
    <ruby className="mdx-ruby">
      {text}
      {reading ? <rt>{reading}</rt> : null}
    </ruby>
  );
}

/** 社群提及徽章。用法 <Mention platform="github" user="innei" /> 或 platform="x"。 */
export function Mention({ platform = 'github', user }: { platform?: string; user?: string }) {
  const u = (user ?? '').replace(/^@/, '');
  const isX = platform === 'x' || platform === 'twitter';
  const href = isX ? `https://x.com/${u}` : `https://github.com/${u}`;
  return (
    <a className="mdx-mention" href={href} target="_blank" rel="noreferrer noopener">
      {isX ? <FaXTwitter aria-hidden /> : <FaGithub aria-hidden />}
      <span>{u}</span>
    </a>
  );
}

/** 多檔程式碼分頁。用法 <CodeTabs files={[{ name:'index.ts', lang:'ts', code:'…' }, …]} />。 */
export function CodeTabs(props: { files?: { name: string; lang?: string; code: string }[] }) {
  return <CodeTabsBlock {...props} />;
}

/** KaTeX 數學公式。tex 用屬性字串傳（避免 { } 被 MDX 當表達式）。
 *  <Math tex="E=mc^2" /> 行內；<Math tex="\\int_0^1 x\\,dx" display /> 區塊。 */
export function Math(props: { tex?: string; display?: boolean }) {
  const fallback = props.display ? (
    <div className="mdx-math-loading" aria-hidden />
  ) : (
    <span className="mdx-math-inline">{props.tex}</span>
  );
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <MathImpl {...props} />
      </Suspense>
    </ClientOnly>
  );
}

interface TabProps {
  title?: string;
  children?: ReactNode;
}

/** 內容分頁容器：藥丸切換，每個 <Tab title="…"> 放整段內容（prose、code、其他 block 皆可）。
 *  用法：
 *  <Tabs>
 *    <Tab title="做法 A（推薦）">…</Tab>
 *    <Tab title="做法 B">…</Tab>
 *  </Tabs>
 *  適合「同一件事的多種做法/取捨」對照。 */
export function Tabs({ children }: { children?: ReactNode }) {
  // Children.toArray：取 <Tab> 子元素成陣列（要 map 出藥丸 + 只渲染 active 那頁）。分頁清單靜態不重排。
  // eslint-disable-next-line @eslint-react/no-children-to-array
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement<TabProps>[];
  const [active, setActive] = useState(0);
  if (!tabs.length) return null;
  // ⚠ 本模組 export 了名為 Math 的元件（KaTeX），會遮蔽全域 Math → 不能用 Math.min。
  const cur = active < tabs.length ? active : tabs.length - 1;
  return (
    <div className="mdx-tabs">
      <div className="mdx-tabs-bar" role="tablist">
        {tabs.map((t, i) => (
          <button
            // 靜態分頁清單不重排 → index 當 key 安全
            // eslint-disable-next-line @eslint-react/no-array-index-key
            key={t.props.title ?? `tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === cur}
            className={i === cur ? 'mdx-tabs-pill active' : 'mdx-tabs-pill'}
            onClick={() => setActive(i)}
          >
            {t.props.title ?? `分頁 ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="mdx-tabs-panel" role="tabpanel">
        {tabs[cur]}
      </div>
    </div>
  );
}

/** <Tabs> 的單一分頁。title 為藥丸標籤；children 為該頁內容。 */
export function Tab({ children }: TabProps) {
  return <div className="mdx-tab">{children}</div>;
}

/** mermaid → Excalidraw 真手繪風（rough.js）SVG。用法 <Sketch chart="graph TD; A-->B" title="…" />。
 *  chart 收 mermaid 定義；重套件（excalidraw）→ 只在 client、lazy 載入（只有用到才進 bundle）。 */
export function Sketch(props: { chart?: string; title?: string }) {
  const fallback = <div className="mdx-sketch-loading" aria-hidden />;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <SketchImpl {...props} />
      </Suspense>
    </ClientOnly>
  );
}

/** 防劇透：內容模糊，點擊揭開。純視覺遮擋（非加密），適合劇情/答案。 */
export function Spoiler({ children }: { children?: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  // 揭開前是真的 <button>：焦點、Enter/Space、報讀器語意全部免費拿到，
  // 原本 span + role="button" 得自己刻 tabIndex 與 onKeyDown（而且 role 只是「宣稱」
  // 是按鈕，行為仍要自己補）。揭開後回到 <span>，讓文字可以正常選取。
  if (revealed) {
    return <span className="spoiler spoiler--revealed">{children}</span>;
  }
  return (
    <button type="button" className="spoiler" title="點擊顯示" onClick={() => setRevealed(true)}>
      {children}
    </button>
  );
}

/** 程式碼前後對比（行首 + 新增、- 刪除；重用 shiki 高亮 base 語言）。code 用屬性字串傳、
 *  多行用範本字面值：<Diff lang="ts" code={`-const a = 1\n+const a = 2`} title="patch" /> */
export function Diff(props: { code?: string; lang?: string; title?: string }) {
  return <DiffImpl {...props} />;
}

/** 套件安裝指令分頁（npm/pnpm/yarn/bun）。<Install pkg="react-compare-slider" />；dev 為開發依賴。 */
export function Install(props: { pkg?: string; dev?: boolean }) {
  return <InstallImpl {...props} />;
}

/** 文章內嵌投票（真投票，票數存後端；localStorage 防重複）。id 要全站唯一、之後別改（改了票數歸零）。
 *  <Poll id="ssr-strategy" question="你會怎麼渲染?" options={[{key:'ssr',label:'單次 SSR'},{key:'csr',label:'CSR'}]} /> */
export function Poll(props: {
  id?: string;
  question?: string;
  options?: { key?: string; label?: string }[];
  showTotal?: boolean;
}) {
  return <PollImpl {...props} />;
}

/** 文末參考連結區（每列標籤 + 連結，依網域自動帶品牌 icon，不觸發 hover 卡）。
 *  <Refs items={[{ label:'anigamer · TS', links:[{ text:'GitHub', href:'…' }, { text:'npm', href:'…' }] }]} /> */
export function Refs(props: {
  items?: { label?: string; links?: { text: string; href: string }[] }[];
  title?: string;
}) {
  return <RefsImpl {...props} />;
}

/** 前後圖對比滑桿（拖曳分隔線）。<ImageCompare before="/uploads/a.png" after="/uploads/b.png" /> */
export function ImageCompare(props: {
  before?: string;
  after?: string;
  beforeLabel?: string;
  afterLabel?: string;
  alt?: string;
  caption?: string;
}) {
  const fallback = <div className="mdx-imgcompare-loading" aria-hidden />;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <ImageCompareImpl {...props} />
      </Suspense>
    </ClientOnly>
  );
}

/** 鍵盤按鍵。<Kbd>Ctrl</Kbd> + <Kbd>C</Kbd> */
export function Kbd({ children }: { children?: ReactNode }) {
  return <kbd className="mdx-kbd">{children}</kbd>;
}

/** 段落級收合區塊（點 summary 展開）。<Details summary="完整 log">…</Details>。open 預設收合。 */
export function Details({ summary, children, open }: { summary?: ReactNode; children?: ReactNode; open?: boolean }) {
  return (
    <details className="mdx-details" open={open}>
      <summary className="mdx-details-summary">{summary ?? '展開'}</summary>
      <div className="mdx-details-body">{children}</div>
    </details>
  );
}

/** 編號步驟流程（步驟號由 CSS counter 產生）。
 *  <Steps><Step title="裝依賴">…</Step><Step title="設定">…</Step></Steps> */
export function Steps({ children }: { children?: ReactNode }) {
  return <div className="mdx-steps">{children}</div>;
}

/** <Steps> 的單一步驟。 */
export function Step({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mdx-step">
      {title ? <div className="mdx-step-title">{title}</div> : null}
      <div className="mdx-step-body">{children}</div>
    </div>
  );
}

/** 專案結構樹。tree 用屬性字串傳，縮排（每 2 空格一層）表層級、結尾 / 為資料夾：
 *  <FileTree tree={`src/\n  components/\n    Button.tsx\n  index.ts\npackage.json`} /> */
export function FileTree({ tree = '' }: { tree?: string }) {
  const lines = tree
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .split('\n')
    .filter((l) => l.trim());
  return (
    <div className="mdx-filetree">
      {lines.map((line, i) => {
        const indent = line.length - line.trimStart().length;
        const name = line.trim();
        const isFolder = name.endsWith('/');
        return (
          // 靜態清單、不重排 → index 併入 key 安全
          <div
            // eslint-disable-next-line @eslint-react/no-array-index-key
            key={`${i}-${name}`}
            className={isFolder ? 'mdx-filetree-row mdx-filetree-row--folder' : 'mdx-filetree-row'}
            style={{ paddingLeft: `${indent * 0.55 + 0.2}rem` }}
          >
            <span className="mdx-filetree-icon" aria-hidden>
              {isFolder ? '📁' : '📄'}
            </span>
            <span className="mdx-filetree-name">{isFolder ? name.slice(0, -1) : name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 數字磚容器（一排 KPI）。<Stats><Stat label="吞吐" value="42" unit="tok/s" /></Stats> */
export function Stats({ children }: { children?: ReactNode }) {
  return <div className="mdx-stats">{children}</div>;
}

/** 單一數字磚。trend 可選（up 綠 / down 紅 / flat 灰）。 */
export function Stat({
  label,
  value,
  unit,
  trend,
  hint,
}: {
  label?: ReactNode;
  value?: ReactNode;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  hint?: ReactNode;
}) {
  return (
    <div className="mdx-stat">
      <div className="mdx-stat-value">
        {value}
        {unit ? <span className="mdx-stat-unit">{unit}</span> : null}
      </div>
      {label ? <div className="mdx-stat-label">{label}</div> : null}
      {hint ? <div className="mdx-stat-hint">{hint}</div> : null}
      {trend ? <span className={`mdx-stat-trend mdx-stat-trend--${trend}`} aria-hidden /> : null}
    </div>
  );
}
