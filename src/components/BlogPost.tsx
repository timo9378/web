import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useId } from 'react';
import { useParams, useRouterState, useNavigate, ClientOnly } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useLocale, LocaleLink } from '../locale-link';
import { postDetailQueryOptions, blogCategoriesDetailQueryOptions, recentPostsQueryOptions, postReactionsQueryOptions, seriesQueryOptions, type CategoryInfo } from '../blogList';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PostDetailResponse, PostListItem, ReactionRow } from '@koimsurai/api-types';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import KoimLoader from './KoimLoader';
import rehypeRaw from 'rehype-raw';
import pangu from 'pangu';
import { highlightCode } from '../lib/shikiHighlight';
import { langEmoji } from '../lib/langEmoji';
import { CodeBody } from './CodeSurface';
// mermaid + ELK 改為「偵測到圖才動態載入」（見下方 loadMermaid singleton）——只有 2/11 篇有圖，
// 其餘文章不背這顆數百 KB 的 lib。頂層只留 type import（型別不進 runtime bundle）。
import type { Mermaid } from 'mermaid';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import {
  FaRegHeart, FaHeart, FaLink, FaRegComment, FaArrowUp,
  FaEnvelope, FaShareAlt, FaRss, FaTimes,
  FaTwitter, FaFacebook,
} from 'react-icons/fa';
import Comments from './Comments';
import { BlogImage } from './ImageLightbox';
// BlogPost.css：Tier-2 後本元件直接 SSR（不再靠 BlogPostPage fallback）→ CSS 由這裡匯入。
// 本元件是路由 eager import（進 /blog/$id 路由 chunk），故 CSS 進「文章路由 chunk」而非全域
// index.css（首頁等非文章頁不會白背這 2600+ 行）。
import './BlogPost.css';
import SignatureSVG from './SignatureSVG';
import { LinkCard } from './LinkCard';
import { LinkHoverPreview } from './LinkHoverPreview';
import { MdxContent } from './MdxContent';
// slugify / extractHeadings / computeReadTime：與 BlogPostPage（SSR fallback）共用同一份，
// 確保 heading anchor id / TOC / 閱讀時間兩邊逐字一致。
import { slugify, extractHeadings, computeReadTime } from '../lib/blogContent';
import { useCategoryLabel, useTagLabel, useLocalizedCategoryInfo } from '../lib/categoryLabel';
import { postPath } from '../lib/postPath';

/// `GET /api/posts/:id` 的成功回應（型別由後端 Rust struct 生成），外加 client 端自己算的
/// `date`（由 created_at 依語系格式化，見下方 setPost）。API 不回傳 date。
/// 該端點的 404 走另一組 JSON（只有 message / locale / available_locales），
/// 呼叫端用 `data.message === 'success'` 擋掉，所以這裡只描述成功形狀。
type Post = PostDetailResponse & { date?: string };

interface Heading { id: string; text: string; level: number }

interface MermaidOption { value: string; label: string; icon?: string }

/**
 * 「sidebar 文章連結」附帶 hover preview 行為
 * 因為要在 map iteration 內呼叫 hook，必須抽成子元件
 */
const PreviewablePostLink = React.memo(({ post, className, children, viewTransition, style, current }: { post: { id: number | string; slug?: string | null; title: string }; className?: string; children?: React.ReactNode; viewTransition?: boolean; style?: React.CSSProperties; current?: boolean }) => {
  // hover 預覽卡已移除（連同 article-preview 那整套）——側欄只是純連結。
  // current 也走同一個 <a>（只換 class）：若「目前這篇」改渲 <span>，換文章時該列的元素類型
  // 由 a→span，React 必定卸載重掛 → 新 DOM 節點 → 進場動畫重播 = 使用者看到「被點的那列
  // 整組消失再跑一次」。維持同型別才能讓 React 重用節點、只有真正新露出的列才播動畫。
  return (
    <LocaleLink
      to={postPath(post)}
      className={className}
      title={post.title}
      viewTransition={viewTransition}
      style={style}
      aria-current={current ? 'page' : undefined}
    >
      {children}
    </LocaleLink>
  );
});
PreviewablePostLink.displayName = 'PreviewablePostLink';

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

function parseMermaidFrontmatter(code: string): { config: Record<string, string | Record<string, string>>; body: string } {
  const trimmed = code.trim();
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(trimmed);
  if (!fm) return { config: {}, body: trimmed };
  const yamlBlock = fm[1];
  const config: Record<string, string | Record<string, string>> = {};
  let current: string | null = null;
  for (const line of yamlBlock.split('\n')) {
    const indent = line.search(/\S/);
    const trimLine = line.trim();
    if (!trimLine || trimLine.startsWith('#')) continue;
    const kv = /^(\w[\w-]*):\s*(.*)/.exec(trimLine);
    if (kv) {
      if (indent === 0 || indent === 2) {
        if (kv[2]) { config[kv[1]] = kv[2]; current = null; }
        else { config[kv[1]] = {}; current = kv[1]; }
      } else if (current) {
        const cur = config[current];
        if (cur && typeof cur === 'object') {
          cur[kv[1]] = kv[2];
        }
      }
    }
  }
  return { config, body: trimmed.slice(fm[0].length) };
}

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
  // 以 ref 存 onRendered，避免它進 effect deps 而重跑渲染（與既有 onError 同慣例）。
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

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
          onError?.(null);
          onRenderedRef.current?.();
        }
      } catch (e) {
        console.warn('Mermaid render error:', e);
        onError?.(e instanceof Error ? e.message : 'Mermaid 渲染失敗');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // mount/unmount only — onClose is stable via useCallback

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
const MermaidBlock = ({ code }: { code: string }) => {
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const parsed = useMemo(() => parseMermaidFrontmatter(code), [code]);
  const initCfg = parsed.config.config ?? parsed.config;
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

/* ── helpers ── */

/* 標題「主標：副標」拆分（display 用）：第一個全形「：」或半形「: 」切開，前面主標、後面副標。
   兩側都要有內容才拆，否則整串當主標。SEO 的 document title / og:title 仍用完整 post.title
   （搜尋結果要完整描述性標題），這裡只影響頁面上 h1 的呈現。 */
function splitTitle(title: string): { main: string; sub: string | null } {
  const m = /：|:\s/.exec(title);
  if (!m || m.index === 0) return { main: title, sub: null };
  const main = title.slice(0, m.index).trim();
  const sub = title.slice(m.index + m[0].length).trim();
  return main && sub ? { main, sub } : { main: title, sub: null };
}

/* 安全地把 React children 攤平成純文字（避免 String(obj) → [object Object]） */
const nodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (React.isValidElement(node)) {
    const p = node.props as { children?: React.ReactNode };
    return nodeText(p.children);
  }
  return '';
};

/* ── Font Options ── */
const FONT_OPTIONS = [
  { id: 'misans', name: 'MiSans', family: '"MiSans", system-ui, -apple-system, sans-serif' },
  { id: 'lxgw', name: '霞鶩文楷', family: '"LXGW WenKai TC", "LXGW WenKai", cursive' },
  { id: 'noto-serif', name: 'Noto Serif', family: '"Noto Serif SC", "Noto Serif TC", Georgia, serif' },
  { id: 'source-han', name: '思源黑體', family: '"Noto Sans SC", "Noto Sans TC", "Source Han Sans SC", sans-serif' },
];


/* ══════════════════════════
   CodeBlock
   ══════════════════════════ */
// 這些語言的 fenced code 改渲染成「終端機視窗」而非一般 code block。
const TERMINAL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'shellsession', 'shellscript']);

// 非原文語系的文章：頂部掛「AI 翻譯、未經人工審校」提示（站長無法人工審日/韓等語法）。
// 文字用目標語言寫（提示會出現在該語系頁），連回原文（source_language，走不帶 prefix 的規範路徑）。
const AI_TRANSLATION_NOTICE: Record<string, { text: string; original: string }> = {
  en: { text: 'AI-translated from the original (Traditional Chinese) — not human-reviewed, so wording may be imperfect.', original: 'View original' },
  ja: { text: 'この記事は原文（繁体字中国語）からのAI翻訳です。人手による校正はしていないため、表現に不自然さが残る場合があります。', original: '原文を見る' },
  ko: { text: '이 글은 원문(번체 중국어)의 AI 번역본이며, 사람이 검수하지 않아 표현이 어색할 수 있습니다.', original: '원문 보기' },
  'zh-CN': { text: '本文由原文（繁体中文）AI 翻译，未经人工审校，措辞可能不够自然。', original: '查看原文' },
};

// 後台編輯器預覽（PostPreview）也重用這批 → export，讓預覽跟前台同一套渲染（shiki/mermaid/terminal）。
export const CodeBlock = ({ node: _node, inline, className, children, ...props }: { node?: unknown; inline?: boolean; className?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) => {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match ? match[1] : 'text';
  const codeText = nodeText(children).replace(/\n$/, '');

  // 自動偵測 mermaid 圖表：有 language tag 或內容以 mermaid 關鍵字開頭
  const isMermaid = lang === 'mermaid' || (
    !inline && (lang === 'text' || !match) &&
    /^(---|graph\s|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|sankey)/m.test(codeText.trim())
  );

  // Shiki lazy 反白 — 渲染後 idle 才開始，載入前先顯示 plain pre
  useEffect(() => {
    if (inline || isMermaid || !match) return;
    let cancelled = false;
    const idle = (cb: () => void) => (window.requestIdleCallback ? window.requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 80));
    idle(() => {
      highlightCode(codeText, lang).then((html) => {
        if (!cancelled) setHighlighted(html);
      }).catch(() => { /* fallback 留 plain pre */ });
    });
    return () => { cancelled = true; };
  }, [codeText, lang, inline, isMermaid, match]);

  if (!inline && isMermaid) {
    // mermaid 用 react-zoom-pan-pinch（render 期碰 window，非 SSR-safe）→ 只把這個島包 ClientOnly。
    // fallback 是固定高 .mm-sandbox 空殼（CSS height:420px）→ SSR 佔位穩定、client 接手渲染圖時不 reflow。
    return (
      <ClientOnly fallback={<div className="mm-sandbox" />}>
        <MermaidBlock code={codeText} />
      </ClientOnly>
    );
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(codeText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  if (!inline && match) {
    // 終端機類語言 → 渲染成終端機視窗（紅黃綠燈 + 無行號），跟一般 code block 明確區隔。唯讀。
    if (TERMINAL_LANGS.has(lang)) {
      return (
        <div className="terminal-block">
          <div className="terminal-bar">
            <span className="terminal-glyph" aria-hidden>❯_</span>
            <span className="terminal-title">{lang}</span>
            <button onClick={handleCopy} className="copy-button">
              {isCopied ? t('blog.codeCopied') : t('blog.codeCopy')}
            </button>
          </div>
          <div className="terminal-body">
            {highlighted ? (
              // shiki 高亮的可信 HTML（作者內容 + shiki）
              // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
              <div className="shiki-output" dangerouslySetInnerHTML={{ __html: highlighted }} />
            ) : (
              <pre className="shiki-fallback">
                <code>{codeText}</code>
              </pre>
            )}
            <div className="terminal-cursor-line" aria-hidden>
              <span className="terminal-prompt-sym">❯</span>
              <span className="terminal-cursor" />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="code-block-wrapper">
        <div className="code-block-header">
          <span className="language-name">
            <span className="language-emoji" aria-hidden>{langEmoji(lang)}</span>
            {lang}
          </span>
          <button onClick={handleCopy} className="copy-button">
            {isCopied ? t('blog.codeCopied') : t('blog.codeCopy')}
          </button>
        </div>
        <CodeBody highlighted={highlighted} code={codeText} />
      </div>
    );
  }
  return <code className={className} {...props}>{children}</code>;
};

/* ══════════════════════════
   Custom paragraph — detect standalone link lines for LinkCard
   ══════════════════════════ */
export const CustomParagraph = ({ children, node: _node, ...props }: { children?: React.ReactNode; node?: unknown } & React.HTMLAttributes<HTMLParagraphElement>) => {
  const childArray = React.Children.toArray(children);

  const extractFirstUrlFromText = (text: string | null | undefined) => {
    if (!text) return null;
    // Capture URL while trimming common trailing wrappers like ")" or "]".
    const match = /https?:\/\/[^\s<>)\]]+/i.exec(text);
    return match ? match[0] : null;
  };

  // 遞迴取得所有子文字內容
  const getText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(getText).join('');
    if (React.isValidElement(node)) {
      const p = node.props as { children?: React.ReactNode };
      if (p.children) return getText(p.children);
    }
    return '';
  };

  // 從 children 中找出所有 <a> 元素
  const findLinks = (arr: React.ReactNode[]): React.ReactElement[] => {
    const links: React.ReactElement[] = [];
    arr.forEach(child => {
      if (React.isValidElement(child) && (child.props as { href?: string }).href) links.push(child);
    });
    return links;
  };

  // 可嵌入的連結類型
  const isEmbeddableLink = (href: string) => {
    try {
      const u = new URL(href);
      const host = u.hostname.replace('www.', '');
      return host.includes('youtube.com') || host.includes('youtu.be') ||
        host.includes('bilibili.com') || host.includes('b23.tv') ||
        host.includes('spotify.com') ||
        host.includes('koimsurai.com');
    } catch { return false; }
  };

  // 單一子元素 — 可能是純文字 URL 或 <a> 連結
  if (childArray.length === 1) {
    const child = childArray[0];

    // 純文字 URL
    if (typeof child === 'string') {
      const trimmed = child.trim();
      if (/^https?:\/\/\S+$/.test(trimmed)) {
        return <LinkCard href={trimmed} />;
      }

      const textUrl = extractFirstUrlFromText(trimmed);
      if (textUrl && isEmbeddableLink(textUrl)) {
        return (
          <div className="link-card-with-text">
            <p {...props}>{child}</p>
            <LinkCard href={textUrl} />
          </div>
        );
      }
    }

    // ReactMarkdown <a> 元素（remarkGfm autolink 或 markdown 連結）
    if (React.isValidElement(child) && (child.props as { href?: string }).href) {
      const cprops = child.props as { href: string; children?: React.ReactNode };
      const href = cprops.href;
      const text = getText(cprops.children).trim();
      // Allow cards for embeddable links even when markdown link text is custom.
      if (isEmbeddableLink(href) || text === href || text === '' || href.includes(text) || text.includes(href)) {
        return <LinkCard href={href} />;
      }
    }
  }

  // 多子元素 — 檢查是否包含可嵌入的連結（如「【標題】 url」格式）
  if (childArray.length >= 2) {
    const links = findLinks(childArray);
    const embeddableLink = links.find(link => isEmbeddableLink((link.props as { href?: string }).href ?? ''));

    if (embeddableLink) {
      const href = (embeddableLink.props as { href: string }).href;
      // 取得非連結部分的文字
      const textParts = childArray.filter(c => c !== embeddableLink);
      const hasText = textParts.some(c => {
        const t = typeof c === 'string' ? c.trim() : getText(c).trim();
        return t.length > 0;
      });

      if (hasText) {
        // 有文字描述 — 顯示文字 + 嵌入卡片
        return (
          <div className="link-card-with-text">
            <p {...props}>{textParts}</p>
            <LinkCard href={href} />
          </div>
        );
      } else {
        return <LinkCard href={href} />;
      }
    }
  }

  return <p {...props}>{children}</p>;
};

/* ══════════════════════════
   CategoryTooltipTrigger — hover 顯示分類 tooltip (Portal 到 body)
   ══════════════════════════ */
const CategoryTooltipTrigger = ({ postCategory, categoryInfo, showTooltip, onEnter, onLeave, linkClassName, compact = false }: { postCategory: string; categoryInfo: CategoryInfo | null; showTooltip: boolean; onEnter: () => void; onLeave: () => void; linkClassName?: string; compact?: boolean }) => {
  const categoryLabel = useCategoryLabel();
  // tooltip 的簡述/描述也依語系取譯文（沒填就退回原文）
  const { t, i18n } = useTranslation();
  const localizeCategory = useLocalizedCategoryInfo();
  const info = localizeCategory(categoryInfo);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (showTooltip && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX,
      });
    }
  }, [showTooltip]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ display: 'inline-block' }}
    >
      <LocaleLink
        to={'/blog?category=' + encodeURIComponent(postCategory)}
        className={linkClassName ?? 'text-sm text-white hover:text-purple-400 transition-colors font-semibold'}
      >
        {categoryLabel(postCategory)}
      </LocaleLink>
      {showTooltip && info && ReactDOM.createPortal(
        <div
          className={compact ? 'category-tooltip category-tooltip-compact' : 'category-tooltip'}
          style={{ position: 'absolute', top: pos.top, left: pos.left }}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {info.short_description && (
            <p className="category-tooltip-short">{info.short_description}</p>
          )}
          {!compact && info.description && (
            <p className="category-tooltip-desc">{info.description}</p>
          )}
          {!compact && (
            <div className="category-tooltip-meta">
              {info.post_count != null && (
                <span>{t('blog.postCount', { count: info.post_count ?? 0 })}</span>
              )}
              {info.updated_at && (
                <span>{t('blog.lastUpdated')} {new Date(info.updated_at).toLocaleDateString(i18n.resolvedLanguage ?? i18n.language)}</span>
              )}
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  );
};

/* ══════════════════════════
   ReactionBar — Emoji 反應列
   ══════════════════════════ */
const REACTIONS = ['👍', '❤️', '🎉', '🚀', '🤔', '😂'];
const Reactions = React.memo(({ postId }: { postId: string | number }) => {
  const queryClient = useQueryClient();
  const reactionsKey = postReactionsQueryOptions(postId).queryKey;
  // 反應數改由 Query 讀；counts 由列表 derive。toggle 走 setQueryData optimistic +
  // 伺服器回真值再校正（對齊舊的 optimistic → 校正流程）。mine 仍是 localStorage 本地態。
  const { data: reactions = [] } = useQuery(postReactionsQueryOptions(postId));
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    reactions.forEach(r => { map[r.emoji] = r.count; });
    return map;
  }, [reactions]);
  // SSR-safe：初始空 Set（server 無 localStorage），掛載後才讀本地已按過的 reactions → 不 mismatch。
  const [mine, setMine] = useState<Set<string>>(() => new Set<string>());
  useEffect(() => {
    try { setMine(new Set<string>(JSON.parse(localStorage.getItem(`reactions:${postId}`) ?? '[]') as string[])); }
    catch { /* localStorage 不可用就維持空 */ }
  }, [postId]);

  const patchCount = useCallback((emoji: string, resolve: (prev: number) => number) => {
    queryClient.setQueryData<ReactionRow[]>(reactionsKey, (old) => {
      const list = old ?? [];
      const idx = list.findIndex(r => r.emoji === emoji);
      if (idx >= 0) {
        const next = list.slice();
        next[idx] = { ...next[idx], count: Math.max(0, resolve(next[idx].count)) };
        return next;
      }
      return [...list, { emoji, count: Math.max(0, resolve(0)) }];
    });
  }, [queryClient, reactionsKey]);

  const toggle = useCallback((emoji: string) => {
    const has = mine.has(emoji);
    const delta = has ? -1 : 1;
    // optimistic
    patchCount(emoji, (c) => c + delta);
    setMine(prev => {
      const next = new Set(prev);
      if (has) next.delete(emoji); else next.add(emoji);
      try { localStorage.setItem(`reactions:${postId}`, JSON.stringify([...next])); } catch { /* localStorage 不可用就略過 */ }
      return next;
    });
    fetch(`/api/posts/${postId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji, delta }),
    }).then(r => r.json() as Promise<{ count?: number }>).then(data => {
      const count = data.count;
      if (typeof count === 'number') patchCount(emoji, () => count);
    }).catch(() => { /* 失敗就保持 optimistic 結果 */ });
  }, [mine, postId, patchCount]);

  return (
    <div className="reaction-bar" role="group" aria-label="Emoji 反應">
      {REACTIONS.map(e => {
        const n = counts[e] || 0;
        const active = mine.has(e);
        return (
          <button
            key={e}
            type="button"
            className={`reaction-btn${active ? ' is-active' : ''}${n > 0 ? ' has-count' : ''}`}
            onClick={() => toggle(e)}
            aria-pressed={active}
            aria-label={`${e}（${n}）`}
          >
            <span className="reaction-emoji">{e}</span>
            {n > 0 && <span className="reaction-count">{n}</span>}
          </button>
        );
      })}
    </div>
  );
});
Reactions.displayName = 'Reactions';

/* ══════════════════════════
   SeriesNav — 系列文導覽（若文章屬於某系列）
   ══════════════════════════ */
const SeriesNav = React.memo(({ seriesName, currentId }: { seriesName: string; currentId: string | number }) => {
  const { t } = useTranslation();
  const { data: posts = [] } = useQuery({ ...seriesQueryOptions(seriesName), enabled: !!seriesName });
  if (!seriesName || posts.length === 0) return null;
  const currentIdx = posts.findIndex(p => String(p.id) === String(currentId));
  return (
    <aside className="series-nav" aria-label={`系列文：${seriesName}`}>
      <header className="series-nav-header">
        <span className="series-nav-label">{t('blog.seriesLabel')}</span>
        <h4 className="series-nav-name">{seriesName}</h4>
        <span className="series-nav-progress">
          共 {posts.length} 篇 · 你正在讀第 {currentIdx >= 0 ? currentIdx + 1 : '?'} 篇
        </span>
      </header>
      <ol className="series-nav-list">
        {posts.map((p, i) => {
          const isCurrent = String(p.id) === String(currentId);
          return (
            <li key={p.id} className={`series-nav-item${isCurrent ? ' is-current' : ''}`}>
              <span className="series-nav-num">{p.series_order ?? i + 1}</span>
              {isCurrent ? (
                <span className="series-nav-title">{p.title}</span>
              ) : (
                <PreviewablePostLink post={p} className="series-nav-title" viewTransition>{p.title}</PreviewablePostLink>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
});
SeriesNav.displayName = 'SeriesNav';

/* ══════════════════════════
   PrevNextNav — 文章底部上/下一篇導覽
   ══════════════════════════ */
const PrevNextNav = React.memo(({ currentId }: { currentId: string | number }) => {
  const { t } = useTranslation();
  const navLocale = useLocale();
  const { data: allPosts = [] } = useQuery(recentPostsQueryOptions(200, navLocale));
  const { prev, next } = useMemo<{ prev: PostListItem | null; next: PostListItem | null }>(() => {
    const published = allPosts.filter(p => p.status === 'published' || !p.status);
    const sorted = [...published].sort((a, b) => new Date(a.created_at ?? '').getTime() - new Date(b.created_at ?? '').getTime());
    const idx = sorted.findIndex(p => String(p.id) === String(currentId));
    if (idx === -1) return { prev: null, next: null };
    return {
      prev: idx > 0 ? sorted[idx - 1] : null,
      next: idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [allPosts, currentId]);

  if (!prev && !next) return null;

  return (
    <nav className="prev-next-nav" aria-label="上一篇與下一篇">
      {prev ? (
        <LocaleLink to={postPath(prev)} className="prev-next-card prev-next-prev" viewTransition>
          <span className="prev-next-label">← {t('blog.prevPost')}</span>
          <span className="prev-next-title">{prev.title}</span>
        </LocaleLink>
      ) : <span className="prev-next-placeholder" />}
      {next ? (
        <LocaleLink to={postPath(next)} className="prev-next-card prev-next-next" viewTransition>
          <span className="prev-next-label">{t('blog.nextPost')} →</span>
          <span className="prev-next-title">{next.title}</span>
        </LocaleLink>
      ) : <span className="prev-next-placeholder" />}
    </nav>
  );
});

/* ══════════════════════════
   PostsNav — Left sidebar showing OTHER article titles
   ══════════════════════════ */
const PostsNav = React.memo(({ currentId, postCategory }: { currentId: string | number; postTitle?: string; postCategory?: string }) => {
  const { t } = useTranslation();
  const [showCategoryTooltip, setShowCategoryTooltip] = useState(false);
  const navLocale = useLocale();

  // 分類詳情改由 Query 讀（有 postCategory 才抓）。
  const { data: allCategories = [] } = useQuery({ ...blogCategoriesDetailQueryOptions(navLocale), enabled: !!postCategory });
  const categoryInfo = useMemo<CategoryInfo | null>(
    () => (postCategory ? (allCategories.find(c => c.name === postCategory) ?? null) : null),
    [allCategories, postCategory],
  );

  // 附近文章 + 同專欄文章：從 posts(limit 100) 依時間排序後開視窗，改由 Query + useMemo derive。
  const { data: allPosts = [] } = useQuery(recentPostsQueryOptions(100, navLocale));
  const { nearbyPosts, categoryPosts } = useMemo<{ nearbyPosts: PostListItem[]; categoryPosts: PostListItem[] }>(() => {
    if (!allPosts.length) return { nearbyPosts: [], categoryPosts: [] };
    // 按時間排序（最新在前）
    const sorted = [...allPosts].sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime());
    const currentIndex = sorted.findIndex(p => String(p.id) === String(currentId));
    if (currentIndex === -1) return { nearbyPosts: [], categoryPosts: [] };

    // 顯示範圍：最新→往前6、第2新→7、其後→以當前為中心前後各4（不滿則另一側補）
    let start, end;
    if (currentIndex === 0) { start = 0; end = Math.min(sorted.length, 6); }
    else if (currentIndex === 1) { start = 0; end = Math.min(sorted.length, 7); }
    else {
      const half = 4;
      start = Math.max(0, currentIndex - half);
      end = Math.min(sorted.length, currentIndex + half + 1);
      if (currentIndex - start < half) end = Math.min(sorted.length, end + (half - (currentIndex - start)));
      if (end - currentIndex - 1 < half) start = Math.max(0, start - (half - (end - currentIndex - 1)));
    }
    const nearby = sorted.slice(start, end);
    const cat = postCategory
      ? sorted.filter(p => p.category === postCategory && String(p.id) !== String(currentId)).slice(0, 5)
      : [];
    return { nearbyPosts: nearby, categoryPosts: cat };
  }, [allPosts, currentId, postCategory]);

  // 逐行進場的瀑布索引：附近清單 0..n-1，分類標頭 / 專欄其他文章接續往下 → 整條側欄
  // 一路 cascade。key 綁 post id（穩定）→ 換文章時只有「新露出的列」是新 DOM 節點，
  // 只有它們會重播 side-item-in（逐行塞入）；還在窗內的列不動。
  const catBase = nearbyPosts.length;
  return (
    <nav className="posts-nav">
      {/* 附近文章列表（清單未到時先出骨架佔位，不是空白 → 不 raw pop）*/}
      {nearbyPosts.length > 0 ? (
        <div className="posts-nav-nearby">
          {/* 進場＝CSS（第一幀就跑、不等 JS）；退場＝framer AnimatePresence（CSS 動不了
              「正在被移除的節點」）。initial={false} → framer 不插手進場，避免跟 CSS 搶。
              layout → 有列收合時，其餘列平順上移而不是瞬間跳。 */}
          <AnimatePresence initial={false}>
            {nearbyPosts.map((p, i) => {
              const isCurrent = String(p.id) === String(currentId);
              return (
                <motion.div
                  key={p.id}
                  layout
                  initial={false}
                  exit={{ opacity: 0, x: -14, height: 0, marginTop: 0, marginBottom: 0 }}
                  transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <PreviewablePostLink
                    post={p}
                    current={isCurrent}
                    className={
                      'posts-nav-item side-item-in text-sm py-1 block transition-colors truncate '
                      + (isCurrent ? 'text-white font-semibold posts-nav-current-item' : 'text-gray-500 hover:text-gray-300')
                    }
                    style={{ '--i': i } as React.CSSProperties}
                  >
                    {p.title}
                  </PreviewablePostLink>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : allPosts.length === 0 ? (
        <div className="posts-nav-nearby" aria-hidden="true">
          {[88, 72, 94, 63, 80].map((w, i) => (
            <div key={`skel-${w}-${i}`} className="bp-skel" style={{ height: 13, width: `${w}%`, margin: '0 0 12px' }} />
          ))}
        </div>
      ) : null}

      {/* 此文章收錄於分類（接續瀑布索引） */}
      {postCategory && (
        <div className="posts-nav-category side-item-in mt-6 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative', '--i': catBase } as React.CSSProperties}>
          <span className="text-xs text-gray-600 block mb-1">{t('blog.inColumn')}</span>
          <CategoryTooltipTrigger
            postCategory={postCategory}
            categoryInfo={categoryInfo}
            showTooltip={showCategoryTooltip}
            onEnter={() => setShowCategoryTooltip(true)}
            onLeave={() => setShowCategoryTooltip(false)}
          />
        </div>
      )}

      {/* 此專欄其他文章（逐行，索引接在分類區塊後；同樣有退場動畫） */}
      {categoryPosts.length > 0 && (
        <div className="posts-nav-list mt-4">
          <span className="text-xs text-gray-600 block mb-2 side-item-in" style={{ '--i': catBase + 1 } as React.CSSProperties}>{t('blog.otherInColumn')}</span>
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {categoryPosts.map((p, i) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={false}
                  exit={{ opacity: 0, x: -14, height: 0, marginTop: 0, marginBottom: 0 }}
                  transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <PreviewablePostLink
                    post={p}
                    className="posts-nav-item side-item-in text-sm text-gray-500 hover:text-gray-300 transition-colors py-0.5 block truncate"
                    style={{ '--i': catBase + 2 + i } as React.CSSProperties}
                  >
                    {p.title}
                  </PreviewablePostLink>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </nav>
  );
});

/* ══════════════════════════
   TableOfContents — Right sidebar (TOC with reading progress)
   ══════════════════════════ */
const TableOfContents = React.memo(({ headings, activeHeading, readingProgress, tocRef }: { headings: Heading[]; activeHeading: string; readingProgress: number; tocRef: React.RefObject<HTMLElement | null> }) => {
  const { t } = useTranslation();
  const scrollToHeading = useCallback((headingId: string) => {
    setTimeout(() => {
      const el =
        document.getElementById(headingId) ??
        document.querySelector('[id="' + headingId + '"]');
      if (!el) return;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
    }, 50);
  }, []);

  return (
    <div className="table-of-contents">
      <div className="toc-header">
        <h3>{t('blog.toc')}</h3>
        <div className="reading-progress-circle">
          <svg viewBox="0 0 36 36">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--post-accent)" strokeWidth="3" strokeDasharray={readingProgress + ', 100'} />
          </svg>
          <span className="progress-text">{Math.round(readingProgress)}%</span>
        </div>
      </div>
      <nav className="toc-nav" ref={tocRef}>
        {headings.map((h, i) => (
          <button
            key={h.id}
            data-heading-id={h.id}
            className={'toc-item level-' + h.level + (activeHeading === h.id ? ' active' : '')}
            style={{ '--i': i } as React.CSSProperties}
            onClick={() => scrollToHeading(h.id)}
            title={h.text}
          >
            <span className="toc-bullet" />
            <span className="toc-text">{h.text}</span>
          </button>
        ))}
      </nav>
      <button className="toc-bottom-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <FaArrowUp /> {t('blog.backToArticleTop')}
      </button>
    </div>
  );
});

/* ══════════════════════════
   SubscribeModal
   訂閱狀態存在 localStorage 的 KOIM_NEWSLETTER key 裡，
   {email, name, ts} 結構。重複打開 modal 會自動偵測，
   顯示「已訂閱」狀態而不是再來一次表單。
   ══════════════════════════ */
const NEWSLETTER_LS_KEY = 'koim_newsletter_subscriber';

function readSubscriberLS() {
  try {
    const raw = localStorage.getItem(NEWSLETTER_LS_KEY);
    return raw ? (JSON.parse(raw) as { email?: string; name?: string }) : null;
  } catch { return null; }
}
function writeSubscriberLS(value: unknown) {
  try { localStorage.setItem(NEWSLETTER_LS_KEY, JSON.stringify(value)); } catch { /* localStorage blocked */ }
}
function clearSubscriberLS() {
  try { localStorage.removeItem(NEWSLETTER_LS_KEY); } catch { /* localStorage blocked */ }
}

const SubscribeModal = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [subscribed, setSubscribed] = useState<{ email?: string; name?: string } | null>(() => readSubscriberLS());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      const data = await res.json() as { error?: string };
      if (res.ok) {
        setStatus('success');
        setMessage(t('newsletter.successWithEmoji'));
        const record = { email, name, ts: Date.now() };
        writeSubscriberLS(record);
        setSubscribed(record);
        setEmail('');
        setName('');
        setTimeout(() => onClose(), 1800);
      } else {
        setStatus('error');
        setMessage(data.error ?? t('newsletter.errorGeneric'));
      }
    } catch {
      setStatus('error');
      setMessage(t('newsletter.errorNetwork'));
    }
  };

  const handleUnsubscribe = async () => {
    if (!subscribed?.email) return;
    if (!window.confirm(t('newsletter.unsubConfirmJs', { email: subscribed.email }))) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: subscribed.email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? t('newsletter.unsubFailed'));
      }
      clearSubscriberLS();
      setSubscribed(null);
      setStatus('success');
      setMessage(t('newsletter.unsubDone'));
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : t('newsletter.unsubFailed'));
    }
  };

  return (
    <motion.div
      className="subscribe-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="subscribe-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25 }}
      >
        <button type="button" className="subscribe-close" onClick={onClose} aria-label="關閉"><FaTimes /></button>

        {subscribed ? (
          /* ── 已訂閱狀態 ── */
          <>
            <div className="subscribe-header">
              <FaEnvelope className="subscribe-icon" />
              <h3>{t('newsletter.confirmedTitle')}</h3>
              <p>
                <Trans
                  i18nKey="newsletter.alreadyBody"
                  values={{ email: subscribed.email }}
                  components={{ em: <span className="subscribe-email-chip" /> }}
                />
                <br />
                {t('newsletter.nextNotice')}
              </p>
            </div>
            <div className="subscribe-form">
              <button type="button" onClick={onClose}>
                {t('newsletter.okBtn')}
              </button>
              <button
                type="button"
                className="subscribe-secondary"
                onClick={() => { void handleUnsubscribe(); }}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? t('newsletter.unsubProcessing') : t('newsletter.unsubBtn')}
              </button>
            </div>
            {message && <p className={'subscribe-msg ' + status}>{message}</p>}
          </>
        ) : (
          /* ── 訂閱表單 ── */
          <>
            <div className="subscribe-header">
              <FaEnvelope className="subscribe-icon" />
              <h3>{t('newsletter.title')}</h3>
              <p>{t('newsletter.subscribeIntro')}</p>
            </div>
            <form
              onSubmit={(e) => { void handleSubmit(e); }}
              className="subscribe-form"
              toolname="subscribe_newsletter"
              tooldescription="訂閱 koimsurai 電子報，有新文章時以 email 通知"
            >
              <input type="text" name="name" toolparamdescription="訂閱者暱稱（選填）" placeholder={t('newsletter.namePlaceholderShort')} value={name} onChange={(e) => setName(e.target.value)} disabled={status === 'loading'} />
              <input type="email" name="email" toolparamdescription="訂閱用的 email 地址" placeholder={t('newsletter.emailPlaceholderShort')} value={email} onChange={(e) => setEmail(e.target.value)} required disabled={status === 'loading'} />
              <button type="submit" disabled={status === 'loading'}>
                {status === 'loading' ? t('newsletter.processing') : t('newsletter.subscribe')}
              </button>
            </form>
            {message && <p className={'subscribe-msg ' + status}>{message}</p>}
            <p className="subscribe-privacy">{t('newsletter.privacy')}</p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};

/* ══════════════════════════
   FontSwitcher — bottom-right popup
   ══════════════════════════ */
const FontSwitcher = ({ currentFont, onFontChange }: { currentFont: string; onFontChange: (id: string) => void }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="font-switcher">
      <button className="font-switcher-btn" onClick={() => setIsOpen(!isOpen)} title={t('blog.fontSwitcherTitle')}>
        <span>字</span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="font-switcher-popup"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.id}
                className={'font-option' + (currentFont === f.id ? ' active' : '')}
                onClick={() => { onFontChange(f.id); setIsOpen(false); }}
                style={{ fontFamily: f.family }}
              >
                {f.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ═══════════════════════════════════
   Toast — 短暫提示
   ═══════════════════════════════════ */
const Toast = ({ message, onDone }: { message: React.ReactNode; onDone: () => void }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div
      className="blog-toast"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    >
      {message}
    </motion.div>
  );
};

/* ═══════════════════════════════════
   LanguageSwitcher — 文章語言切換下拉
   ═══════════════════════════════════ */
const LANG_OPTIONS = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en',    label: 'English' },
  { code: 'ja',    label: '日本語' },
  { code: 'ko',    label: '한국어' },
];

const LanguageSwitcher = ({ open, setOpen, current, source, available, onSelect, onUnavailable }: { open: boolean; setOpen: (v: boolean) => void; current: string; source: string; available: string[]; onSelect: (code: string) => void; onUnavailable: (label: string) => void }) => {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, minWidth: 160 });

  // 外點關閉 + ESC 關閉
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      const menu = document.getElementById('blog-lang-menu');
      if (menu && e.target instanceof Node && menu.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // 計算菜單位置（以觸發按鈕為錨點，portal 到 body 避開父層 stacking context）
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
        minWidth: Math.max(160, rect.width),
      });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  const currentLabel = LANG_OPTIONS.find(o => o.code === current)?.label ?? current;

  return (
    <span className="meta-lang-switcher" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lang-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-icon">🌐</span>
        <span className="lang-code">{currentLabel}</span>
        <span className={`lang-caret ${open ? 'open' : ''}`}>▾</span>
      </button>
      {open && ReactDOM.createPortal(
        <div
          id="blog-lang-menu"
          className="lang-menu"
          role="listbox"
          style={{ position: 'absolute', top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
        >
          {LANG_OPTIONS.map(opt => {
            const isSource = opt.code === source;
            const isAvailable = available.includes(opt.code);
            return (
              <button
                key={opt.code}
                type="button"
                role="option"
                aria-selected={opt.code === current}
                className={`lang-item ${isAvailable ? '' : 'disabled'} ${opt.code === current ? 'active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (!isAvailable) { onUnavailable(opt.label); return; }
                  if (opt.code === current) return;
                  onSelect(opt.code);
                }}
              >
                <span>{opt.label}</span>
                {isSource && <span className="lang-badge">原文</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
};

/* URL prefix mapping — 必須與後端 LOCALE_URL_PREFIX 一致 */
const LOCALE_URL_PREFIX: Record<string, string> = { 'zh-TW': '', 'zh-CN': '/zh-cn', 'en': '/en', 'ja': '/ja', 'ko': '/ko' };
const LOCALE_TO_DATE_LOCALE: Record<string, string> = { 'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN', 'en': 'en-US', 'ja': 'ja-JP', 'ko': 'ko-KR' };

function parseLocaleFromPath(pathname: string) {
  if (pathname.startsWith('/en/blog/')) return 'en';
  if (pathname.startsWith('/zh-cn/blog/')) return 'zh-CN';
  if (pathname.startsWith('/ja/blog/')) return 'ja';
  if (pathname.startsWith('/ko/blog/')) return 'ko';
  return 'zh-TW';
}

function postPathForLocale(id: string | number | undefined, locale: string, sourceLang: string) {
  // 原文永遠走不帶 prefix 的規範路徑（與後端 postUrlForLocale 一致）
  if (locale === sourceLang) return `/blog/${id}`;
  return `${LOCALE_URL_PREFIX[locale] || ''}/blog/${id}`;
}

/* ═══════════════════════════════════
   BlogPost — 文章內頁
   ═══════════════════════════════════ */
function BlogPost() {
  const { t } = useTranslation();
  const tagLabel = useTagLabel();
  const [readingProgress, setReadingProgress] = useState(0);
  // headings 改為同步 useMemo（在 post 定義後、下方 Extract headings 處）→ 第一幀就有值
  const [activeHeading, setActiveHeading] = useState('');
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showMetaCatTooltip, setShowMetaCatTooltip] = useState(false);
  // SSR-safe：初始用預設（server 無 localStorage），掛載後才讀本地偏好 → 首次 client render 與 SSR 一致、不 mismatch。
  const [currentFont, setCurrentFont] = useState('noto-serif');
  const contentRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const { id = '' } = useParams({ strict: false });
  const location = useRouterState({ select: (s) => s.location });
  const navigate = useNavigate();
  const pathLocale = useMemo(() => parseLocaleFromPath(location.pathname), [location.pathname]);

  // 主文改由 TanStack Query 讀：route loader 已 ensureQueryData 預取 → SSR baked、
  // hydrate 讀同一份快取，不再重打 API。placeholderData 保留上一篇資料做平滑過渡（不閃白）。
  // date 是 client 依語系格式化的衍生欄位（API 不回傳）。
  const { data: postData, isPending, error: queryError } = useQuery({
    ...postDetailQueryOptions(id, pathLocale),
    placeholderData: keepPreviousData,
  });
  const post = useMemo<Post | null>(() => {
    if (!postData) return null;
    const dateLocale = LOCALE_TO_DATE_LOCALE[postData.locale ?? ''] ?? 'zh-TW';
    return {
      ...postData,
      // timeZone 固定 Asia/Taipei → server(UTC) 與 client 同一天、同 weekday，不 hydration mismatch。
      date: new Date(postData.created_at ?? '').toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Taipei' }),
    };
  }, [postData]);
  const loading = isPending;
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Post not found') : null;

  // 專欄 tooltip 的分類詳情：與 PostsNav 共用同一份 categories detail 快取（單抓）。
  const { data: metaCats = [] } = useQuery({ ...blogCategoriesDetailQueryOptions(pathLocale), enabled: !!postData?.category });
  const metaCategoryInfo = useMemo<CategoryInfo | null>(
    () => (postData?.category ? (metaCats.find(c => c.name === postData.category) ?? null) : null),
    [metaCats, postData?.category],
  );

  /* Font family memo */
  const fontFamily = useMemo(() => {
    const font = FONT_OPTIONS.find((f) => f.id === currentFont);
    return font ? font.family : FONT_OPTIONS[0].family;
  }, [currentFont]);

  const handleFontChange = useCallback((fontId: string) => {
    setCurrentFont(fontId);
    localStorage.setItem('blogFont', fontId);
  }, []);

  // 掛載後補讀本地字體偏好（見上方 currentFont 的 SSR-safe 初始）。
  useEffect(() => {
    const stored = localStorage.getItem('blogFont');
    if (stored) setCurrentFont(stored);
  }, []);

  /* heading components */
  const createHeading = useCallback((level: number) => {
    return ({ children, node: _node, ...props }: { children?: React.ReactNode; node?: unknown; [key: string]: unknown }) => {
      const Tag = 'h' + level;
      const text = nodeText(children);
      const hid = slugify(text);
      // hover 時字後面浮出 # 錨點連結（點了複製/跳到該段）。
      return React.createElement(
        Tag,
        { id: hid, ...props },
        children,
        React.createElement(
          'a',
          { href: '#' + hid, className: 'heading-anchor', 'aria-label': '本段錨點連結', tabIndex: -1 },
          '#',
        ),
      );
    };
  }, []);

  const headingComponents = useMemo(
    () => ({ h1: createHeading(1), h2: createHeading(2), h3: createHeading(3), h4: createHeading(4) }),
    [createHeading],
  );

  // MDX 文章的基礎元素 override：與 markdown 管線共用同一批元件（shiki 高亮、mermaid、
  // 連結卡、圖片燈箱、標題錨點）→ MDX 文不比 markdown 文遜。傳給 MdxContent。
  const mdxBaseComponents = useMemo(
    () => ({
      code: CodeBlock,
      // MDX 把 block code 包 <pre>，但 CodeBlock 自出 .code-block-wrapper（div）→ pre 透傳避免 div-in-pre。
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
      p: CustomParagraph,
      img: ({ src, alt, ...rest }: { src?: string; alt?: string }) => <BlogImage src={src} alt={alt} {...rest} />,
      a: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) => {
        const h = typeof href === 'string' ? href : '';
        if (!h || h.startsWith('#')) return <a href={h} {...rest}>{children}</a>;
        return <LinkHoverPreview href={h} className={(rest as { className?: string }).className}>{children}</LinkHoverPreview>;
      },
      ...headingComponents,
    }),
    [headingComponents],
  );

  /* ── 換文章才捲頂（初次掛載/重整不搶捲動，交給 scrollRestoration 還原）──
     否則 reload 時序會變成：首幀頂端 → scrollRestoration 還原到原位 → 這裡又 smooth 捲頂，
     使用者看到「上→下→上」。用 ref 記前一個 key，只有真的換文章（key 變）才捲頂。 */
  const prevScrollKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${id}:${pathLocale}`;
    if (prevScrollKeyRef.current !== null && prevScrollKeyRef.current !== key) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    prevScrollKeyRef.current = key;
  }, [id, pathLocale]);

  /* ── 成功載入一篇：重置 liked + 增加瀏覽數（每次載入新文章打一次）── */
  useEffect(() => {
    if (!postData?.id) return;
    setLiked(false);
    fetch('/api/posts/' + postData.id + '/view', { method: 'POST' }).catch(console.error);
  }, [postData?.id]);

  /* 註：原本這裡有「preview commit 過來自動 scroll 到使用者讀到那段」的邏輯，
       試了 ratio、文字匹配、比例對應好幾輪，preview 跟 BlogPost 渲染差異太大
       （contain-intrinsic-size / 欄寬 / 行高 / Shiki 非同步），找不到 100% 對的對應位置。
       最後決定拔掉 — 預覽是「快速瀏覽」，commit 進文章就從頂端讀，介面比較誠實。
       sessionStorage 順手清掉避免舊資料殘留。 */
  useEffect(() => {
    try { sessionStorage.removeItem('__koim_anchor'); } catch { /* ignore */ }
  }, []);

  /* ── Like state ── */
  useEffect(() => {
    if (!post) return;
    const stored = JSON.parse(localStorage.getItem('likedPosts') ?? '[]') as unknown[];
    const pid = post?.id ?? parseInt(id ?? '', 10);
    if (stored.includes(pid)) setLiked(true);
    setLikeCount(post.likes ?? 0);
  }, [post, id]);

  /* ── 排版優化：CJK-Latin 自動加空格 + 腳註 hover 浮窗 ── */
  useEffect(() => {
    if (!post?.content || !contentRef.current) return;
    const root = contentRef.current;

    // 1) 中英文自動加空格（pangu），略過 code/pre 區塊以免破壞範例
    requestAnimationFrame(() => {
      try {
        root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th').forEach((el) => {
          if (el.closest('pre') || el.closest('code')) return;
          (pangu as unknown as { spacingElementByNode: (node: Node) => void }).spacingElementByNode(el);
        });
      } catch { /* pangu 失敗不影響閱讀 */ }

      // 2) 腳註 hover 浮窗：把腳註內容寫到 ref 連結的 data-fn-content
      try {
        const fnMap = new Map<string, string>();
        root.querySelectorAll('.footnotes li[id^="user-content-fn-"], .footnotes li[id^="fn-"]').forEach((li) => {
          const id = li.id;
          const clone = li.cloneNode(true) as Element;
          clone.querySelectorAll('a.data-footnote-backref, a[href^="#user-content-fnref"], a[href^="#fnref"]').forEach((a) => a.remove());
          const text = (clone.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 320);
          fnMap.set(id, text);
        });
        root.querySelectorAll('sup a[data-footnote-ref], sup a.footnote-ref').forEach((a) => {
          const href = a.getAttribute('href') ?? '';
          const targetId = href.replace(/^#/, '');
          const text = fnMap.get(targetId);
          if (text) a.setAttribute('data-fn-content', text);
        });
      } catch { /* 腳註處理失敗就忽略 */ }
    });
  }, [post?.content]);

  /* ── Copy protection ── */
  useEffect(() => {
    const preventCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (sel?.anchorNode) {
        const parent = sel.anchorNode.parentElement;
        if (parent?.closest('.code-block-wrapper')) return;
      }
      e.preventDefault();
      e.clipboardData?.setData('text/plain', '此內容受版權保護，禁止複製。\n原文連結：' + window.location.href);
    };
    document.addEventListener('copy', preventCopy);
    return () => { document.removeEventListener('copy', preventCopy); };
  }, []);

  /* ── Like handler ── */
  const handleLike = async () => {
    const pid = post?.id ?? parseInt(id ?? '', 10);
    const next = !liked;
    try {
      const res = await fetch('/api/posts/' + pid + '/' + (next ? 'like' : 'unlike'), { method: 'POST' });
      const data = await res.json() as { likes?: number };
      if (res.ok) {
        setLiked(next);
        setLikeCount(data.likes ?? 0);
        const stored = JSON.parse(localStorage.getItem('likedPosts') ?? '[]') as unknown[];
        localStorage.setItem('likedPosts', JSON.stringify(next ? [...stored.filter((i) => i !== pid), pid] : stored.filter((i) => i !== pid)));
      }
    } catch (err) { console.error('Like failed:', err); }
  };

  const [showShareMenu, setShowShareMenu] = useState(false);

  /* ── Share handlers ── */
  // SSR-safe：server 無 window（只在 share 按鈕 handler 用到、不進 DOM，故 SSR 給空 origin 不影響 hydration）。
  const shareUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/blog/' + id;
  const shareTitle = post?.title ?? '';

  const handleCopyLink = () => {
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setShowShareMenu(false);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShareTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`, '_blank', 'noopener,noreferrer,width=550,height=420');
    setShowShareMenu(false);
  };

  const handleShareFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank', 'noopener,noreferrer,width=550,height=420');
    setShowShareMenu(false);
  };

  const handleNativeShare = () => {
    if (navigator.share) {
      void navigator.share({ title: shareTitle, url: shareUrl }).catch(() => { /* ignore */ });
    } else {
      handleCopyLink();
    }
    setShowShareMenu(false);
  };

  /* ── Read time（與 fallback 共用同一算法）── */
  const readTime = useMemo(() => computeReadTime(post?.content ?? ''), [post?.content]);

  /* ── Extract headings：同步 useMemo（不再 useEffect 延遲）→ 第一幀 TOC 就有值、
        scroll-spy 也能更早啟動；與 fallback 共用 extractHeadings，anchor id 逐字一致 ── */
  const headings = useMemo<Heading[]>(() => extractHeadings(post?.content ?? ''), [post?.content]);

  /* ── Scroll / progress / active heading ── */
  useEffect(() => {
    if (!post) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastActive = activeHeading;

    const handleScroll = () => {
      const wh = window.innerHeight;
      const dh = document.documentElement.scrollHeight;
      const st = window.scrollY;
      const scrollable = dh - wh;
      setReadingProgress(scrollable > 0 ? Math.min(100, Math.max(0, (st / scrollable) * 100)) : 0);

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!contentRef.current || !headings.length) return;
        // 只看「TOC 有列到的標題」——原本抓所有 [id]（含腳註/alert 的 id），會被非標題元素
        // 劫持 active 狀態、害 TOC 高亮消失。以 heading id 集合過濾。
        const headingIds = new Set(headings.map((h) => h.id));
        const els = Array.from(contentRef.current.querySelectorAll('[id]')).filter((el) => headingIds.has(el.id));
        let cur = '';
        let minD = Infinity;
        els.forEach((el) => {
          const t = el.getBoundingClientRect().top;
          if (t <= 200 && t >= -100 && Math.abs(t - 100) < minD) { minD = Math.abs(t - 100); cur = el.id; }
        });
        if (!cur) {
          for (const el of els) {
            const t = el.getBoundingClientRect().top;
            if (t > 0 && t < wh) { cur = el.id; break; }
          }
        }
        if (cur && cur !== lastActive) {
          lastActive = cur;
          setActiveHeading(cur);
          if (tocRef.current) {
            const item = tocRef.current.querySelector('[data-heading-id="' + cur + '"]');
            if (item) item.scrollIntoView({ behavior: 'auto', block: 'nearest' });
          }
        }
      }, 150);
    };

    let ticking = false;
    const listener = () => {
      if (!ticking) { window.requestAnimationFrame(() => { handleScroll(); ticking = false; }); ticking = true; }
    };
    window.addEventListener('scroll', listener, { passive: true });
    const init = setTimeout(handleScroll, 500);
    return () => { window.removeEventListener('scroll', listener); if (timer) clearTimeout(timer); clearTimeout(init); };
  }, [post, headings]);

  /* ════════ Loading ════════ */
  if (loading) {
    return (
      <div className="blog-post-container loading">
        <div className="blog-post-dim-overlay" />
        <KoimLoader fullscreen text="從星際載入文章" />
      </div>
    );
  }

  /* ════════ Error ════════ */
  if (error || !post) {
    const isLocaleMissing = error === 'LOCALE_NOT_AVAILABLE';
    return (
      <div className="blog-post-container error">
        <div className="blog-post-dim-overlay" />
        <div className="error-content">
          <div className="error-icon">🌐</div>
          <h1>{isLocaleMissing ? '此語言版本尚未提供' : '文章航線丟失'}</h1>
          <p>{isLocaleMissing ? '您請求的語言目前還沒有翻譯版本，可以前往原文頁面閱讀。' : '抱歉，我們在宇宙中找不到您要找的文章。'}</p>
          {isLocaleMissing ? (
            <LocaleLink to={`/blog/${id}`} className="back-to-blog-link">前往原文 →</LocaleLink>
          ) : (
            <LocaleLink to="/blog" className="back-to-blog-link">‹ 返回手記</LocaleLink>
          )}
        </div>
      </div>
    );
  }

  /* ════════ Main Render ════════ */
  // title/description/og/JSON-LD 由路由 head()（articleMeta + articleJsonLd）出，進 SSR。
  // 舊的 seoDescription/selfPath/alternates/xDefaultPath 只餵已退休的 <SEOHead>，一併移除。
  const postTags: string[] = post.tags;
  const sourceLang = post.source_language ?? 'zh-TW';
  const availableLocales = post.available_locales ?? [sourceLang];
  const currentLocale = post.locale ?? pathLocale;
  const titleParts = splitTitle(post.title);

  return (
    <div className="blog-post-container" style={{ fontFamily }}>
      {/* Dim overlay over global starfield */}
      <div className="blog-post-dim-overlay" />

      {/* Reading Progress */}
      <div className="reading-progress-bar">
        <div className="reading-progress-fill" style={{ width: readingProgress + '%' }} />
      </div>

      {/* Toast */}
      {toastMsg && (
        <Toast key={toastMsg} message={toastMsg} onDone={() => setToastMsg('')} />
      )}

      {/* ── Header ── */}
      <AnimatePresence mode="wait">
        <motion.header
          key={'header-' + id}
          className="post-header"
          // 進場動畫改由 CSS（BlogPost.css 的 post-enter）負責：它在第一幀 paint 就跑，
          // 不必等 hydration，LCP 不被綁住。這裡維持 initial={false}，避免 JS 在 hydrate 後
          // 又把已顯示的內容重設一次（那會變成「重播」而不是進場）。exit 仍交給 framer-motion。
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        >
          <h1 className="post-title">{titleParts.main}</h1>
          {titleParts.sub && <p className="post-subtitle">{titleParts.sub}</p>}

          <div className="post-meta-row">
            {post.layout_type !== 'column' && (
              <>
                <span className="meta-tip" data-tooltip="發布日期">⏱ {post.date}</span>
                <span className="meta-sep">·</span>
              </>
            )}
            <span className="meta-tip meta-author" data-tooltip="作者">✦ {post.author}</span>
            <span className="meta-sep">·</span>
            <span className="meta-tip" data-tooltip="累計閱讀次數">📖 {post.view_count ?? 0}</span>
            <span className="meta-sep">·</span>
            <span className="meta-tip" data-tooltip="讀者喜歡數">❤️ {likeCount}</span>
            <span className="meta-sep">·</span>
            <span className="meta-tip" data-tooltip="預估閱讀時間">☕ 約 {readTime} 分鐘</span>
            {post.category && (
              <>
                <span className="meta-sep">·</span>
                <span
                  className="meta-category-wrap"
                  onMouseEnter={() => setShowMetaCatTooltip(true)}
                  onMouseLeave={() => setShowMetaCatTooltip(false)}
                >
                  <CategoryTooltipTrigger
                    postCategory={post.category}
                    categoryInfo={metaCategoryInfo}
                    showTooltip={showMetaCatTooltip}
                    onEnter={() => setShowMetaCatTooltip(true)}
                    onLeave={() => setShowMetaCatTooltip(false)}
                    linkClassName="meta-category meta-category-link"
                    compact
                  />
                </span>
              </>
            )}
            <span className="meta-sep">·</span>
            <LanguageSwitcher
              open={langMenuOpen}
              setOpen={setLangMenuOpen}
              current={currentLocale}
              source={sourceLang}
              available={availableLocales}
              onSelect={(loc) => {
                const target = postPathForLocale(id, loc, sourceLang); // 已是絕對 locale 路徑,用 href 不再加前綴
                void navigate({ href: target });
              }}
              onUnavailable={(name) => setToastMsg(`「${name}」版本尚未提供`)}
            />
          </div>

          {postTags.length > 0 && (
            <div className="post-tags">
              {postTags.map((name) => (
                <span key={name} className="tag">#{tagLabel(name)}</span>
              ))}
            </div>
          )}
        </motion.header>
      </AnimatePresence>

      {/* ── Content body: left sidebar + center + right sidebar ── */}
      <div className="post-body">
        {/* Left sidebar — other article titles */}
        <aside className="post-sidebar-left">
          <PostsNav currentId={post.id} postTitle={post.title} postCategory={post.category ?? undefined} />
        </aside>

        <AnimatePresence mode="wait">
          <motion.div
            key={'content-' + id}
            className="post-main-column"
            // 進場動畫由 CSS 負責，但作用在「內層」的 .post-content-wrapper（見 BlogPost.css
            // 的 post-enter）→ 與這層 framer-motion 是不同元素，兩者不會搶同一個 transform。
            // 這層維持 initial={false}（不讓 JS 在 hydrate 後重設已顯示的內容），只保留 exit。
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* 非原文語系 → AI 翻譯提示（連回原文）。放卡片「外」：.post-ai-summary-inline 用負 margin
                貼齊卡片頂邊、圓角只在上方，必須是卡片第一個子元素，banner 插進去會壓壞它。 */}
            {currentLocale !== sourceLang && AI_TRANSLATION_NOTICE[currentLocale] && (
              <div className="ai-translation-notice">
                <span className="ai-translation-icon" aria-hidden>🌐</span>
                <span className="ai-translation-text">{AI_TRANSLATION_NOTICE[currentLocale].text}</span>
                <a className="ai-translation-original" href={`/blog/${id}`}>{AI_TRANSLATION_NOTICE[currentLocale].original} →</a>
              </div>
            )}
            <div className="post-content-wrapper">
              {/* AI Summary — inside card top with gradient fade */}
              {post.excerpt && (
                <div className="post-ai-summary-inline">
                  <div className="ai-summary-top-row">
                    <h4>🔑 {t('blog.keyInsights')}</h4>
                    <span className="ai-badge">✦ AI·GEN</span>
                  </div>
                  <p>{post.excerpt}</p>
                  <div className="ai-summary-fade" />
                </div>
              )}

              <article className="post-content drop-cap-first" ref={contentRef}>
                {postData?.compiledMdx ? (
                  // format='mdx'：server 端已編譯，這裡 runSync 執行成 React 元件（自訂 block +
                  // 與 markdown 共用的 code/link/img/heading override）。
                  <MdxContent compiled={postData.compiledMdx} baseComponents={mdxBaseComponents} />
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkAlert]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      code: CodeBlock,
                      p: CustomParagraph,
                      img: ({ src, alt, ...rest }) => <BlogImage src={src} alt={alt} {...rest} />,
                      // 行內連結 → hover 預覽卡（資料來自自家 /api/link-preview，不外送給第三方）。
                      // 「整段只有一個連結」那種會先被 CustomParagraph 攔去做 LinkCard 區塊卡，
                      // 所以這裡拿到的都是真正的行內連結。錨點（#foo）不預覽。
                      a: ({ href, children, ...rest }) => {
                        const h = typeof href === 'string' ? href : '';
                        if (!h || h.startsWith('#')) return <a href={h} {...rest}>{children}</a>;
                        return <LinkHoverPreview href={h} className={(rest as { className?: string }).className}>{children}</LinkHoverPreview>;
                      },
                      ...headingComponents,
                    } as Components}
                  >
                    {post.content}
                  </ReactMarkdown>
                )}
              </article>
              <SignatureSVG className="blog-signature" />
            </div>

            {/* ── Emoji 反應 ── */}
            <Reactions postId={post.id} />

            {/* ── Series 系列文導覽 ── */}
            {post.series_name && <SeriesNav seriesName={post.series_name} currentId={post.id} />}

            {/* ── Prev / Next ── */}
            <PrevNextNav currentId={post.id} />

            {/* ── Comments ── */}
            <div className="post-extras" id="comments">
              <Comments postId={post.id} allowComments={post.allow_comments} />
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Right sidebar — TOC。
            不用 framer/AnimatePresence：實測（線上量測）mode="wait" + initial 會在導航時把
            進場重播（opacity 0→1→重設 0→1）、文章切文章時舊 TOC 卡在 opacity 0 數秒。
            進場改由 CSS 逐行 stagger（.toc-item 的 side-item-in，SSR 首幀就開跑）；
            key 綁文章 id → 換文章時整個 aside 重掛、逐行動畫重新演一次。 */}
        {headings.length > 0 && (
          <aside key={'toc-' + id} className="post-sidebar-right">
            <TableOfContents headings={headings} activeHeading={activeHeading} readingProgress={readingProgress} tocRef={tocRef} />
          </aside>
        )}
      </div>

      {/* ── Floating side actions (right) ── */}
      <div className="floating-actions">
        <button className={'float-btn' + (liked ? ' active' : '')} onClick={() => { void handleLike(); }} title={t('blog.like') || 'Like'}>
          {liked ? <FaHeart /> : <FaRegHeart />}
          {likeCount > 0 && <span>{likeCount}</span>}
        </button>
        <div className="float-btn-wrapper">
          <button
            className={'float-btn' + (copied ? ' shared' : '')}
            onClick={() => setShowShareMenu(!showShareMenu)}
            title={t('blog.shareTitle')}
          >
            <FaShareAlt />
          </button>
          <AnimatePresence>
            {showShareMenu && (
              <motion.div
                className="share-menu"
                initial={{ opacity: 0, x: 10, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                <button onClick={handleShareTwitter}><FaTwitter /> Twitter</button>
                <button onClick={handleShareFacebook}><FaFacebook /> Facebook</button>
                <button onClick={handleCopyLink}><FaLink /> {copied ? t('blog.codeCopied') : t('blog.shareCopyLink')}</button>
                {typeof navigator.share === 'function' && (
                  <button onClick={handleNativeShare}><FaShareAlt /> {t('blog.shareMore')}</button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <a href="#comments" className="float-btn" title={t('blog.commentTitle')}>
          <FaRegComment />
        </a>
        <button className="float-btn" onClick={() => setShowSubscribe(true)} title={t('blog.subscribeTitle')}>
          <FaEnvelope />
        </button>
        <a href="/rss" className="float-btn" title="RSS" target="_blank" rel="noopener noreferrer">
          <FaRss />
        </a>
      </div>

      {/* ── Font Switcher (bottom-right) ── */}
      <FontSwitcher currentFont={currentFont} onFontChange={handleFontChange} />

      {/* ── Subscribe Modal ── */}
      <AnimatePresence>
        {showSubscribe && <SubscribeModal onClose={() => setShowSubscribe(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default BlogPost;
