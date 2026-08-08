/**
 * Mermaid 圖表區塊 —— 從 `BlogPost.tsx` 抽出來的。
 *
 * 為什麼抽：BlogPost.tsx 原本 2296 行、62 個頂層宣告，而這 575 行是其中**唯一一個
 * 完全不與其他部分往來的叢集**——對外只露 `MermaidBlock` 一個名字，反向零依賴。
 * 留在原檔只是讓「改文章頁」這件事永遠要先捲過 500 行跟它無關的圖表工具列程式碼。
 *
 * 抽出來也順手證實了一件事：`loadMermaid` 從來沒有被 BlogPost 呼叫過。
 * 原本那行 import 上面的註解寫著「BlogPost 偵測到有圖就先暖機」，但那個暖機並不存在
 * ——singleton 是被第一個 `<MermaidBlock>` 觸發的。註解描述的是沒寫出來的意圖，
 * 混在 2296 行裡沒有人會發現。現在它是本檔的私有函式。
 *
 * ⚠ 這是**純搬移**：所有程式碼與註解逐字照搬，只補了 import 與 export。
 * 驗證方式是把兩個檔接回去跟搬移前逐字元 diff（除了那行改過的 BlogImage import 之外一致）。
 *
 * CSS 當時沒有跟著搬（見 MermaidBlock.css 的檔頭），因為改 CSS 的風險是「規則順序變了」，
 * 而那要靠 computed-style 守門才驗得出來——當時那道守門**沒有涵蓋文章內頁**。
 * 先補了 `/blog/5` 進去，才把樣式也搬過來。
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
// mermaid + ELK 是「偵測到圖才動態載入」（見下方 loadMermaid singleton）——只有少數文章有圖，
// 其餘文章不背這顆數百 KB 的 lib。頂層只留 type import（型別不進 runtime bundle）。
import type { Mermaid } from 'mermaid';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { parseMermaidFrontmatter } from '@/lib/mdx/mermaidFrontmatter';
import { lookup } from '@/lib/tableLookup';
// 圖表樣式跟著元件走（同名檔）。⚠ 這行會讓這份 CSS 排在 BlogPost.css **之前**——
// BlogPost.tsx 的 import 清單裡 `./MermaidBlock` 在 `./BlogPost.css` 前面。
// 理由與驗證方式見 MermaidBlock.css 的檔頭。
import './MermaidBlock.css';

interface MermaidOption { value: string; label: string; icon?: string }

/* ── Mermaid：延遲載入 singleton ──
   偵測到 mermaid 區塊才動態 import mermaid + ELK layout（其餘文章零負擔）。
   Promise 快取 → registerLayoutLoaders 只跑一次；多個圖表共用同一次載入。 */
let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= Promise.all([
    import('mermaid'),
    import('@mermaid-js/layout-elk'),
  ]).then(([m, elk]) => {
    m.default.registerLayoutLoaders(elk.default);
    return m.default;
  });
  return mermaidPromise;
}

/* ── ELK layout 的 JSON.stringify 護欄 ──
   @mermaid-js/layout-elk（0.2.x，升級未修）在 layout 過程會 JSON.stringify 整個 elk 圖：
   兩處 log.debug 的參數一律先求值 + subgraph 用 JSON.parse(JSON.stringify(node)) 深拷貝。
   本站 <html> 由 React（TanStack Start）渲染、documentElement 帶 __reactFiber（own enumerable
   屬性），圖裡只要夾到任何 DOM 節點，序列化就會 "Converting circular structure to JSON" → 整張
   ELK 圖畫不出來（一般站的 documentElement 無 fiber、DOM 節點序列化成 {} 不會炸，故只有本站踩到）。
   上游改不了 → render 期間暫時把 JSON.stringify 換成「遇 DOM 節點就略過」的安全版：對非 DOM 輸入
   輸出完全相同（深拷貝仍保留座標等數值，只是丟掉不需要的 DOM ref），僅避免 throw。ref-count 支援多圖並行。 */
let stringifyGuardDepth = 0;
let savedStringify: typeof JSON.stringify | null = null;
async function withDomSafeStringify<T>(fn: () => Promise<T>): Promise<T> {
  if (stringifyGuardDepth++ === 0) {
    const orig = JSON.stringify;
    savedStringify = orig;
    const patched = ((value: unknown, replacer?: unknown, space?: string | number) =>
      orig(
        value,
        function (this: unknown, key: string, val: unknown) {
          if (val && typeof val === 'object' && (val as { nodeType?: unknown }).nodeType != null) return undefined;
          return typeof replacer === 'function'
            ? (replacer as (this: unknown, k: string, v: unknown) => unknown).call(this, key, val)
            : val;
        },
        space,
      )) as typeof JSON.stringify;
    JSON.stringify = patched;
  }
  try {
    return await fn();
  } finally {
    if (--stringifyGuardDepth === 0 && savedStringify) {
      JSON.stringify = savedStringify;
      savedStringify = null;
    }
  }
}

const MERMAID_THEMES = [
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'default', label: 'Default', icon: '☀️' },
  { value: 'forest', label: 'Forest', icon: '🌲' },
  { value: 'neutral', label: 'Neutral', icon: '⚪' },
  { value: 'base', label: 'Base', icon: '🎨' },
];
const MERMAID_LOOKS = [
  { value: 'neo', label: 'Neo', icon: '💎' },
  { value: 'classic', label: 'Classic', icon: '📐' },
  { value: 'handDrawn', label: 'Hand Drawn', icon: '✏️' },
];
const MERMAID_LAYOUTS = [
  { value: 'dagre', label: 'Hierarchical', icon: '📊' },
  { value: 'elk', label: 'Adaptive', icon: '🌐' },
];
const MERMAID_DIRECTIONS = [
  { value: 'TB', label: 'Top to Bottom', icon: '↓' },
  { value: 'BT', label: 'Bottom to Top', icon: '↑' },
  { value: 'LR', label: 'Left to Right', icon: '→' },
  { value: 'RL', label: 'Right to Left', icon: '←' },
];

/* ── Toolbar SVG Icons ── */
const IconPalette = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.4-.15-.74-.42-1.03-.28-.28-.42-.63-.42-1.03 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6C22 6.5 17.52 2 12 2z"/>
  </svg>
);
const IconLook = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);
const IconLayout = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
);
const IconDirection = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="7 8 12 13 17 8"/><polyline points="7 14 12 19 17 14"/>
  </svg>
);
const IconExpand = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
);
const IconZoomIn = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
  </svg>
);
const IconZoomOut = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="8" y1="11" x2="14" y2="11"/>
  </svg>
);
const IconFit = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>
  </svg>
);
const IconCopyCode = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const IconCheckMark = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconDownload = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const DARK_THEME_VARS = {
  primaryColor: '#7f5af0',
  primaryTextColor: '#e0e0e0',
  primaryBorderColor: '#7f5af0',
  lineColor: '#7f5af0',
  secondaryColor: '#2cb67d',
  tertiaryColor: 'transparent',
  background: 'transparent',
  mainBkg: 'rgba(127, 90, 240, 0.12)',
  nodeBorder: '#7f5af0',
  clusterBkg: 'transparent',
  clusterBorder: 'rgba(127, 90, 240, 0.3)',
  titleColor: '#e0e0e0',
  edgeLabelBackground: 'rgba(30, 30, 46, 0.9)',
  fontSize: '14px',
};


/* ── Mermaid 自動置中 + fit ──
   圖是 SVG 非同步塞進 DOM 的（先載 mermaid、再 render）。TransformWrapper 的 centerOnInit
   只在掛載當下（內容還空）算一次 → SVG 出現後 transform 已過時（偏一邊、又沒 fit）。
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
const MermaidDiagram = ({ code, theme, look, layout, direction, onError, onRendered }: { code: string; theme: string; look: string; layout: string; direction: string; onError?: (err: string | null) => void; onRendered?: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // mermaid.render(id) 會用這個 id 在 DOM 插暫存節點：同頁多張圖若拿到相同 id，
  // 併發 render 會互相踩（症狀＝有的框空白、有的框疊了兩張圖）。原本用
  // `Date.now()-idRef` 產 id，但 idRef 是「每個實例各自從 0 開始」的，同一毫秒
  // 掛載的多張圖就會撞成同一個 id。改用 useId()：每個實例唯一且 SSR 安全。
  const reactId = useId();
  const idRef = useRef(0);
  // 以 ref 存 onRendered / onError，避免它們進 effect deps 而重跑渲染。
  // （原本註解說 onError 已照此慣例，實際上沒有——它直接進了 effect body，
  //   所以 exhaustive-deps 一直在報；補上後名實相符。）
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const parsed = useMemo(() => parseMermaidFrontmatter(code), [code]);

  useEffect(() => {
    if (!containerRef.current) return;
    // useId 產出形如 ":r3:"，冒號在 CSS/querySelector 選擇器裡不合法 → 清成安全字元。
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${idRef.current++}`;

    let body = parsed.body;
    body = body.replace(/((?:flowchart|graph)\s+)(?:TB|BT|LR|RL)/, `$1${direction}`);

    const themeVars: Record<string, string> = theme === 'dark' ? { ...DARK_THEME_VARS } : {};
    if (look === 'neo' && themeVars.clusterBkg) {
      delete themeVars.clusterBkg;
      delete themeVars.clusterBorder;
    }

    const render = async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme,
          look,
          layout,
          themeVariables: themeVars,
          flowchart: { curve: 'basis', useMaxWidth: false },
          securityLevel: 'loose',
        } as Parameters<typeof mermaid.initialize>[0]);
        // ELK layout 內部序列化整張圖會撈到 DOM 節點 → 用護欄迴避循環參照 throw（見 withDomSafeStringify）。
        const { svg } = await withDomSafeStringify(() => mermaid.render(id, body));
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          // mermaid 的 SVG 是 width=100% + max-width → 在 shrink-to-fit 的 zoom 容器裡會塌成 ~300px，
          // fit 依 viewBox 算出的縮放就套在錯的 layout 尺寸上，圖變超小。強制把 SVG 尺寸設成 viewBox
          // 內在尺寸（1438×648 之類）當 layout size → fit 縮放對得上、圖能填滿容器。
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            const vb = svgEl.viewBox.baseVal;
            if (vb.width && vb.height) {
              svgEl.setAttribute('width', String(vb.width));
              svgEl.setAttribute('height', String(vb.height));
              svgEl.style.maxWidth = 'none';
            }
          }
          onErrorRef.current?.(null);
          onRenderedRef.current?.();
        }
      } catch (e) {
        console.warn('Mermaid render error:', e);
        onErrorRef.current?.(e instanceof Error ? e.message : 'Mermaid 渲染失敗');
        const errNode = document.getElementById('d' + id);
        if (errNode) errNode.remove();
      }
    };
    void render();
  }, [code, theme, look, layout, direction, parsed.body, reactId]);

  return <div className="mermaid-render" ref={containerRef} />;
};

/* ── Toolbar icon menu ── */
const ToolbarMenu = ({ icon, label, value, options, onChange }: { icon: React.ReactNode; label: string; value: string; options: MermaidOption[]; onChange: (value: string) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => { if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false); };
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
              onClick={() => { onChange(o.value); setOpen(false); }}
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
const MermaidActions = ({ transformRef, code }: { transformRef: React.RefObject<ReactZoomPanPinchRef | null>; code: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);
  return (
    <div className="mm-toolbar-actions">
      <button type="button" className="mm-action-btn" onClick={() => transformRef.current?.zoomOut(0.3)} data-tooltip="縮小" aria-label="縮小">{IconZoomOut}</button>
      <button type="button" className="mm-action-btn" onClick={() => transformRef.current?.zoomIn(0.3)} data-tooltip="放大" aria-label="放大">{IconZoomIn}</button>
      <button type="button" className="mm-action-btn" onClick={() => scheduleFitMermaid(transformRef.current)} data-tooltip="重新置中" aria-label="重新置中">{IconFit}</button>
      <button type="button" className="mm-action-btn" onClick={copy} data-tooltip={copied ? '已複製' : '複製原始碼'} aria-label="複製原始碼">{copied ? IconCheckMark : IconCopyCode}</button>
      <button type="button" className="mm-action-btn mm-action-btn--dl" onClick={() => downloadMermaidSvg(transformRef.current)} data-tooltip="下載 SVG" aria-label="下載 SVG">{IconDownload}<span className="mm-action-ext">SVG</span></button>
      <button type="button" className="mm-action-btn mm-action-btn--dl" onClick={() => downloadMermaidPng(transformRef.current)} data-tooltip="下載 PNG" aria-label="下載 PNG">{IconDownload}<span className="mm-action-ext">PNG</span></button>
    </div>
  );
};

/* ── Fullscreen Modal ── */
const MermaidFullscreen = ({ code, theme, look, layout, direction, onTheme, onLook, onLayout, onDirection, onClose }: { code: string; theme: string; look: string; layout: string; direction: string; onTheme: (v: string) => void; onLook: (v: string) => void; onLayout: (v: string) => void; onDirection: (v: string) => void; onClose: () => void }) => {
  /* Lock scroll SYNCHRONOUSLY before paint — useLayoutEffect runs before the browser paints */
  useLayoutEffect(() => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    // 強制保持原位置（防止 overflow:hidden 改變 scroll position）
    window.scrollTo(0, scrollY);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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
            <ToolbarMenu icon={IconLook} label="Look" value={look} options={MERMAID_LOOKS} onChange={onLook} />
            <ToolbarMenu icon={IconLayout} label="Layout" value={layout} options={MERMAID_LAYOUTS} onChange={onLayout} />
            <ToolbarMenu icon={IconDirection} label="Direction" value={direction} options={MERMAID_DIRECTIONS} onChange={onDirection} />
          </div>
          <MermaidActions transformRef={transformRef} code={code} />
          <div className="mm-toolbar-right">
            <span className="mm-toolbar-hint">滾輪縮放 · 拖曳平移 · 雙擊還原</span>
            <button className="mm-close-btn" onClick={onClose} title="關閉 (Esc)">✕</button>
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
                <div className="mermaid-error"><span>⚠ {err}</span></div>
              ) : (
                <MermaidDiagram code={code} theme={theme} look={look} layout={layout} direction={direction} onError={setErr} onRendered={handleRendered} />
              )}
            </TransformComponent>
          </TransformWrapper>
        </div>
      </motion.div>
    </motion.div>,
    document.body
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
    (typeof initCfg === 'object' && typeof initCfg[key] === 'string') ? initCfg[key] : null;
  const initLayout = cfgStr('layout') ?? 'dagre';
  const initTheme = cfgStr('theme') ?? 'dark';
  // look 也吃 frontmatter（作者可預設 handDrawn 手繪風，不必讀者自己去工具列切）。
  const initLook = cfgStr('look') ?? 'classic';
  const dirMatch = /(?:flowchart|graph)\s+(TB|BT|LR|RL)/.exec(parsed.body);
  const initDir = dirMatch ? dirMatch[1] : 'TB';

  const [theme, setTheme] = useState(initTheme);
  const [look, setLook] = useState(initLook);
  const [layout, setLayout] = useState(initLayout);
  const [direction, setDirection] = useState(initDir);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  /* Stable callbacks — 不會因 re-render 產生新參考，避免子元件 effect 被重新觸發 */
  const handleCloseFullscreen = useCallback(() => setFullscreen(false), []);
  const handleSetTheme = useCallback((v: string) => setTheme(v), []);
  const handleSetLook = useCallback((v: string) => setLook(v), []);
  const handleSetLayout = useCallback((v: string) => setLayout(v), []);
  const handleSetDirection = useCallback((v: string) => setDirection(v), []);
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
            <ToolbarMenu icon={IconLook} label="Look" value={look} options={MERMAID_LOOKS} onChange={setLook} />
            <ToolbarMenu icon={IconLayout} label="Layout" value={layout} options={MERMAID_LAYOUTS} onChange={setLayout} />
            <ToolbarMenu icon={IconDirection} label="Direction" value={direction} options={MERMAID_DIRECTIONS} onChange={setDirection} />
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
            <MermaidDiagram code={code} theme={theme} look={look} layout={layout} direction={direction} onError={setError} onRendered={handleRendered} />
          </TransformComponent>
        </TransformWrapper>

        {/* Expand button */}
        <button type="button" className="mm-expand-btn" onClick={() => setFullscreen(true)} data-tooltip="放大檢視" aria-label="放大檢視">
          {IconExpand}
        </button>
      </div>

      {/* Fullscreen portal */}
      <AnimatePresence>
        {fullscreen && (
          <MermaidFullscreen
            code={code}
            theme={theme} look={look} layout={layout} direction={direction}
            onTheme={handleSetTheme} onLook={handleSetLook} onLayout={handleSetLayout} onDirection={handleSetDirection}
            onClose={handleCloseFullscreen}
          />
        )}
      </AnimatePresence>
    </>
  );
};
