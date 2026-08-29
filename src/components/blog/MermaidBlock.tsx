/**
 * Mermaid 圖表區塊：渲染 + 縮放平移 + 全螢幕 + 下載 SVG/PNG。
 *
 * 渲染走 beautiful-mermaid（同步、零 DOM 相依），所以 SVG 在 render 階段就產好，
 * SSR 也吐得出來。換掉 mermaid 本體之後一併消失的東西：lazy-load singleton、
 * 為了 ELK 序列化撞到 React fiber 而寫的 JSON.stringify 護欄、以及工具列的
 * look / layout / direction 三個下拉（beautiful-mermaid 只有 ELK、方向由語法決定，
 * 手繪風用 <Sketch>）。
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
// beautiful-mermaid 是同步的、零 DOM 相依（內部自帶 ELK 並以 FakeWorker 同步跑），
// 所以可以直接在 render 階段產生 SVG——SSR 就吐得出圖，不再有「先空白、載入後換入」
// 的位移，也不需要為了 lazy-load 維護一個 singleton。
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { parseMermaidFrontmatter } from '@/lib/mdx/mermaidFrontmatter';
import { mermaidKey } from '@/lib/mdx/mermaidFences';
import { useMermaidSvgs } from '@/contexts/mermaidSvgs';
import { lookup } from '@/lib/tableLookup';
// 圖表樣式跟著元件走（同名檔）。⚠ 這行會讓這份 CSS 排在 BlogPost.css **之前**——
// BlogPost.tsx 的 import 清單裡 `./MermaidBlock` 在 `./BlogPost.css` 前面。
// 理由與驗證方式見 MermaidBlock.css 的檔頭。
import './MermaidBlock.css';

interface MermaidOption {
  value: string;
  label: string;
  icon?: string;
}

/* ── 主題 ──
   配色不進渲染器：SVG 內部用 `var(--fg)` / `var(--surface, …)` 上色，值由外層
   `.mm-theme-*` 的 CSS 提供（見 MermaidBlock.css）。所以換主題只是換 class，
   不重新渲染，client 端也不必背渲染器。

   ⚠ 舊版預設把節點填色設成 `rgba(127,90,240,0.12)` 疊在透明背景上，沒有被 classDef
   標色的節點幾乎與深空背景同色——讀者得自己切主題才看得見。那不是「需要一個切換器」，
   是對比不足。現在預設的 `deep` 給實心填色，不管底下是什麼都分得開。 */
const MERMAID_THEMES = [
  { value: 'deep', label: 'Deep Space', icon: '🌌' },
  { value: 'zinc', label: 'Zinc', icon: '⚪' },
  { value: 'tokyo', label: 'Tokyo Night', icon: '🌃' },
  { value: 'nord', label: 'Nord', icon: '❄️' },
  { value: 'light', label: 'Light', icon: '☀️' },
];

/* ── Toolbar SVG Icons ── */
const IconPalette = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.4-.15-.74-.42-1.03-.28-.28-.42-.63-.42-1.03 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6C22 6.5 17.52 2 12 2z" />
  </svg>
);
const IconExpand = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconZoomIn = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);
const IconZoomOut = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);
const IconFit = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </svg>
);
const IconCopyCode = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconCheckMark = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconDownload = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/* ── Mermaid 自動置中 + fit ──
   TransformWrapper 的 centerOnInit 只在掛載當下算一次，而容器尺寸與 SVG 尺寸未必同時就緒
   → transform 可能偏一邊、又沒 fit。
   解法：SVG 渲染完後，依它的 viewBox 內在尺寸算出剛好塞滿容器的縮放，置中套上去。 */
function fitMermaidView(ref: ReactZoomPanPinchRef | null): void {
  const wrapper = ref?.instance.wrapperComponent;
  const svg = wrapper?.querySelector('svg') as SVGSVGElement | null;
  if (!ref || !wrapper || !svg) return;
  // viewBox 是內在尺寸（不受目前 CSS transform 影響）；無 viewBox 時 baseVal 為 0 → 退回量測值。
  const vb = svg.viewBox.baseVal;
  const svgW = vb.width || svg.getBoundingClientRect().width;
  const svgH = vb.height || svg.getBoundingClientRect().height;
  if (!svgW || !svgH || !wrapper.clientWidth || !wrapper.clientHeight) {
    ref.centerView(1, 0);
    return;
  }
  const pad = 0.86; // 留點邊距，別讓圖貼滿容器
  const raw = Math.min(wrapper.clientWidth / svgW, wrapper.clientHeight / svgH) * pad;
  const scale = Math.max(0.15, Math.min(raw, 1.5)); // 小圖也別放大過頭
  ref.centerView(scale, 0);
}

/** 等兩幀（DOM 已 layout、lib 的 ResizeObserver 也更新過 content 尺寸）再 fit。 */
function scheduleFitMermaid(ref: ReactZoomPanPinchRef | null): void {
  requestAnimationFrame(() => requestAnimationFrame(() => fitMermaidView(ref)));
}

/** 取當前 mermaid 圖的 <svg> 元素（在 zoom wrapper 內）。 */
function mermaidSvgEl(ref: ReactZoomPanPinchRef | null): SVGSVGElement | null {
  return ref?.instance.wrapperComponent?.querySelector('svg') ?? null;
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 下載當前圖為 SVG（向量）。 */
function downloadMermaidSvg(ref: ReactZoomPanPinchRef | null): void {
  const svg = mermaidSvgEl(ref);
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const data = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
  triggerDownload(url, 'mermaid-diagram.svg');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 下載當前圖為 PNG（2× 點陣、深色底）。 */
function downloadMermaidPng(ref: ReactZoomPanPinchRef | null): void {
  const svg = mermaidSvgEl(ref);
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const w = vb.width || svg.getBoundingClientRect().width || 800;
  const h = vb.height || svg.getBoundingClientRect().height || 600;
  const scale = 2;
  const data = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'mermaid-diagram.png');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
}

/* ── MermaidDiagram (shared renderer used in inline + fullscreen) ── */
const MermaidDiagram = ({
  code,
  theme,
  onError,
  onRendered,
}: {
  code: string;
  theme: string;
  onError?: (err: string | null) => void;
  onRendered?: () => void;
}) => {
  const parsed = useMemo(() => parseMermaidFrontmatter(code), [code]);
  /* SVG 由伺服器預先渲染好（見 lib/mdx/mermaidRender.ts），這裡只查表。
     渲染器約 1.5 MB，讓它留在伺服器端，client 一個 byte 都不必背。 */
  const svgs = useMermaidSvgs();
  const svg = svgs[mermaidKey(parsed.body)] ?? '';

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  useEffect(() => {
    // 查不到＝伺服器渲染那張圖時失敗（語法壞掉），或對照表沒帶下來。
    onErrorRef.current?.(svg ? null : 'Mermaid 圖表解析失敗');
    if (svg) onRenderedRef.current?.();
  }, [svg]);

  if (!svg) return null;
  /* SVG 由 beautiful-mermaid 從語法樹產生（無 <script>、無 foreignObject），來源是自家 CMS
     的文章內容——與換掉之前 mermaid 走 `container.innerHTML = svg` 的信任邊界相同。 */
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
  return <div className={`mermaid-render mm-theme-${theme}`} dangerouslySetInnerHTML={{ __html: svg }} />;
};

/* ── SSR 用的靜態圖 ──
   互動層（react-zoom-pan-pinch）在 render 期碰 window，不是 SSR-safe，所以 MermaidBlock
   整顆包在 ClientOnly 裡。但**圖本身**只是一段 SVG 字串（伺服器已經渲染好），可以在 SSR
   就畫出來當 fallback：首屏直接看得到圖，hydration 後互動層原地接手。
   ⚠ .mm-sandbox 是固定高度，所以這個接手不會改變盒子外的版面。 */
export const MermaidStatic = ({ code }: { code: string }) => {
  const svgs = useMermaidSvgs();
  const svg = svgs[mermaidKey(parseMermaidFrontmatter(code).body)] ?? '';
  if (!svg) return <div className="mm-sandbox" />;
  return (
    <div className="mm-sandbox mm-sandbox--static">
      {/* eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml */}
      <div className="mermaid-render mm-theme-deep" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
};

/* ── Toolbar icon menu ── */
const ToolbarMenu = ({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: MermaidOption[];
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  return (
    <div className="mm-menu" ref={ref}>
      <button
        type="button"
        className={`mm-menu-trigger${open ? ' mm-menu-trigger--open' : ''}`}
        onClick={() => setOpen(!open)}
        data-tooltip={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>
      {open && (
        <div className="mm-menu-dropdown">
          <div className="mm-menu-label">{label}</div>
          {options.map((o) => (
            <button
              key={o.value}
              className={`mm-menu-item ${o.value === value ? 'mm-menu-item--active' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.icon && <span className="mm-menu-item-icon">{o.icon}</span>}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Mermaid 動作鈕（縮放 / 重新置中 / 複製原始碼 / 下載 SVG·PNG）── */
const MermaidActions = ({
  transformRef,
  code,
}: {
  transformRef: React.RefObject<ReactZoomPanPinchRef | null>;
  code: string;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);
  return (
    <div className="mm-toolbar-actions">
      <button
        type="button"
        className="mm-action-btn"
        onClick={() => transformRef.current?.zoomOut(0.3)}
        data-tooltip="縮小"
        aria-label="縮小"
      >
        {IconZoomOut}
      </button>
      <button
        type="button"
        className="mm-action-btn"
        onClick={() => transformRef.current?.zoomIn(0.3)}
        data-tooltip="放大"
        aria-label="放大"
      >
        {IconZoomIn}
      </button>
      <button
        type="button"
        className="mm-action-btn"
        onClick={() => scheduleFitMermaid(transformRef.current)}
        data-tooltip="重新置中"
        aria-label="重新置中"
      >
        {IconFit}
      </button>
      <button
        type="button"
        className="mm-action-btn"
        onClick={copy}
        data-tooltip={copied ? '已複製' : '複製原始碼'}
        aria-label="複製原始碼"
      >
        {copied ? IconCheckMark : IconCopyCode}
      </button>
      <button
        type="button"
        className="mm-action-btn mm-action-btn--dl"
        onClick={() => downloadMermaidSvg(transformRef.current)}
        data-tooltip="下載 SVG"
        aria-label="下載 SVG"
      >
        {IconDownload}
        <span className="mm-action-ext">SVG</span>
      </button>
      <button
        type="button"
        className="mm-action-btn mm-action-btn--dl"
        onClick={() => downloadMermaidPng(transformRef.current)}
        data-tooltip="下載 PNG"
        aria-label="下載 PNG"
      >
        {IconDownload}
        <span className="mm-action-ext">PNG</span>
      </button>
    </div>
  );
};

/* ── Fullscreen Modal ── */
const MermaidFullscreen = ({
  code,
  theme,
  onTheme,
  onClose,
}: {
  code: string;
  theme: string;
  onTheme: (v: string) => void;
  onClose: () => void;
}) => {
  /* Lock scroll SYNCHRONOUSLY before paint — useLayoutEffect runs before the browser paints */
  useLayoutEffect(() => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    // 強制保持原位置（防止 overflow:hidden 改變 scroll position）
    window.scrollTo(0, scrollY);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', esc);
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      // 恢復原位置
      window.scrollTo(0, scrollY);
      window.removeEventListener('keydown', esc);
    };
    // 只在 mount/unmount 跑：onClose 由呼叫端 useCallback 固定住。
    // （原本寫 react-hooks/exhaustive-deps，那是舊 ESLint 的命名空間，
    //   換成 oxlint 之後形同虛設 —— 這條規則現在叫 @eslint-react/exhaustive-deps。）
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, []);

  const [err, setErr] = useState<string | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const handleRendered = useCallback(() => scheduleFitMermaid(transformRef.current), []);

  return ReactDOM.createPortal(
    <motion.div
      className="mm-fullscreen-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="mm-fullscreen-container"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* Fullscreen toolbar */}
        <div className="mm-fullscreen-toolbar">
          <div className="mm-toolbar-group">
            <ToolbarMenu icon={IconPalette} label="Theme" value={theme} options={MERMAID_THEMES} onChange={onTheme} />
          </div>
          <MermaidActions transformRef={transformRef} code={code} />
          <div className="mm-toolbar-right">
            <span className="mm-toolbar-hint">滾輪縮放 · 拖曳平移 · 雙擊還原</span>
            <button className="mm-close-btn" onClick={onClose} title="關閉 (Esc)">
              ✕
            </button>
          </div>
        </div>
        {/* Canvas */}
        <div className="mm-fullscreen-canvas" onDoubleClick={handleRendered}>
          <TransformWrapper
            ref={transformRef}
            initialScale={0.8}
            minScale={0.15}
            maxScale={6}
            centerOnInit
            limitToBounds={false}
            smooth
            wheel={{ step: 0.03, smoothStep: 0.003 }}
            doubleClick={{ disabled: true }}
            panning={{ velocityDisabled: true }}
          >
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem' }}
            >
              {err ? (
                <div className="mermaid-error">
                  <span>⚠ {err}</span>
                </div>
              ) : (
                <MermaidDiagram code={code} theme={theme} onError={setErr} onRendered={handleRendered} />
              )}
            </TransformComponent>
          </TransformWrapper>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

/* ── MermaidBlock (main entry) ── */
export const MermaidBlock = ({ code }: { code: string }) => {
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const parsed = useMemo(() => parseMermaidFrontmatter(code), [code]);
  // frontmatter 可能有巢狀的 config:，也可能就是扁平的一層——查不到就用外層那份
  const initCfg = lookup(parsed.config, 'config') ?? parsed.config;
  const cfgStr = (key: string): string | null =>
    typeof initCfg === 'object' && typeof initCfg[key] === 'string' ? initCfg[key] : null;
  // frontmatter 仍可指定 theme；layout / look / direction 已無對應物（見檔頭調色盤那段），
  // 舊文章寫了也只是被忽略，不會壞。
  const initTheme = cfgStr('theme') ?? 'deep';

  const [theme, setTheme] = useState(initTheme);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  /* Stable callbacks — 不會因 re-render 產生新參考，避免子元件 effect 被重新觸發 */
  const handleCloseFullscreen = useCallback(() => setFullscreen(false), []);
  const handleSetTheme = useCallback((v: string) => setTheme(v), []);
  // SVG 渲染完 → fit；也綁到雙擊當「重新置中」（原本雙擊 reset 會退回沒 fit 的初始狀態）。
  const handleRendered = useCallback(() => scheduleFitMermaid(transformRef.current), []);

  if (error) {
    return (
      <div className="mermaid-error">
        <span>⚠ Mermaid 圖表解析失敗</span>
        <pre>{code}</pre>
      </div>
    );
  }

  return (
    <>
      <div
        className="mm-sandbox"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={handleRendered}
      >
        {/* Toolbar bar */}
        <div className={`mm-toolbar ${hovered ? 'mm-toolbar--visible' : ''}`}>
          <div className="mm-toolbar-group">
            <ToolbarMenu icon={IconPalette} label="Theme" value={theme} options={MERMAID_THEMES} onChange={setTheme} />
          </div>
          <MermaidActions transformRef={transformRef} code={code} />
        </div>

        {/* Zoomable canvas */}
        <TransformWrapper
          ref={transformRef}
          initialScale={0.65}
          minScale={0.15}
          maxScale={5}
          centerOnInit
          limitToBounds={false}
          smooth
          wheel={{ step: 0.03, smoothStep: 0.003 }}
          doubleClick={{ disabled: true }}
          panning={{ velocityDisabled: true }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem' }}
          >
            <MermaidDiagram code={code} theme={theme} onError={setError} onRendered={handleRendered} />
          </TransformComponent>
        </TransformWrapper>

        {/* Expand button */}
        <button
          type="button"
          className="mm-expand-btn"
          onClick={() => setFullscreen(true)}
          data-tooltip="放大檢視"
          aria-label="放大檢視"
        >
          {IconExpand}
        </button>
      </div>

      {/* Fullscreen portal */}
      <AnimatePresence>
        {fullscreen && (
          <MermaidFullscreen code={code} theme={theme} onTheme={handleSetTheme} onClose={handleCloseFullscreen} />
        )}
      </AnimatePresence>
    </>
  );
};
