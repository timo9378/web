import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouterState, useNavigate, ClientOnly } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { LocaleLink } from '@/i18n/locale-link';
import { useLocale } from '@/hooks/useLocale';
import { postDetailQueryOptions, blogCategoriesDetailQueryOptions, recentPostsQueryOptions, postReactionsQueryOptions, seriesQueryOptions, type CategoryInfo } from '@/data/blogList';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PostDetailResponse, PostListItem, ReactionRow } from '@koimsurai/api-types';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import KoimLoader from '@/components/common/KoimLoader';
import rehypeRaw from 'rehype-raw';
import pangu from 'pangu';
import { highlightCode } from '@/lib/mdx/shikiHighlight';
import { langEmoji } from '@/lib/langEmoji';
import { CodeBody } from '@/components/mdx/CodeSurface';
// 圖表整套（渲染、工具列、主題／版面切換、全螢幕、mermaid+ELK 的延遲載入）在 MermaidBlock.tsx。
// 這裡只是把它掛進 ReactMarkdown 的元件表——mermaid 那顆 lib 由 MermaidBlock 自己動態載入，
// 沒有圖的文章連 import 都不會觸發。
import { MermaidBlock } from './MermaidBlock';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import {
  FaRegHeart, FaHeart, FaLink, FaRegComment, FaArrowUp,
  FaEnvelope, FaShareAlt, FaRss, FaTimes,
  FaTwitter, FaFacebook,
} from 'react-icons/fa';
import Comments from './Comments';
import { BlogImage } from '@/components/blog/BlogImage';
// BlogPost.css：Tier-2 後本元件直接 SSR（不再靠 BlogPostPage fallback）→ CSS 由這裡匯入。
// 本元件是路由 eager import（進 /blog/$id 路由 chunk），故 CSS 進「文章路由 chunk」而非全域
// index.css（首頁等非文章頁不會白背這 2600+ 行）。
import './BlogPost.css';
import SignatureSVG from '@/components/common/SignatureSVG';
import { LinkCard } from '@/components/common/LinkCard';
import { LinkHoverPreview } from '@/components/common/LinkHoverPreview';
import { MdxContent } from '@/components/mdx/MdxContent';
// slugify / extractHeadings / computeReadTime：與 BlogPostPage（SSR fallback）共用同一份，
// 確保 heading anchor id / TOC / 閱讀時間兩邊逐字一致。
import { slugify, extractHeadings, computeReadTime } from '@/lib/mdx/blogContent';
// 標題拆解、閱讀進度、scroll-spy 的挑選邏輯——純函式，抽出去才測得到（見該檔說明）。
import { pickActiveHeading, readingProgressPct, splitTitle } from '@/lib/blogReading';
import { useCategoryLabel, useTagLabel, useLocalizedCategoryInfo } from '@/lib/categoryLabel';
import { postPath } from '@/lib/postPath';
import { lookup } from '@/lib/tableLookup';

/// `GET /api/posts/:id` 的成功回應（型別由後端 Rust struct 生成），外加 client 端自己算的
/// `date`（由 created_at 依語系格式化，見下方 setPost）。API 不回傳 date。
/// 該端點的 404 走另一組 JSON（只有 message / locale / available_locales），
/// 呼叫端用 `data.message === 'success'` 擋掉，所以這裡只描述成功形狀。
type Post = PostDetailResponse & { date?: string };

interface Heading { id: string; text: string; level: number }

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


/* ── helpers ── */

/* 標題「主標：副標」拆分（display 用）：第一個全形「：」或半形「: 」切開，前面主標、後面副標。
   兩側都要有內容才拆，否則整串當主標。SEO 的 document title / og:title 仍用完整 post.title
   （搜尋結果要完整描述性標題），這裡只影響頁面上 h1 的呈現。 */

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
/* 閱讀字體選項。字體棧本身在 index.css（--blog-font-<id>），這裡只留 id 與顯示名——
   偏好必須在 paint 之前套用（見 __root.tsx 的 pre-paint script），而那段只能碰 CSS。
   新增字體：這裡加一列 + index.css 加兩行（--blog-font-<id> 與 html[data-blog-font=...]）。 */
const DEFAULT_BLOG_FONT = 'noto-serif';
const FONT_OPTIONS = [
  { id: 'misans', name: 'MiSans' },
  { id: 'lxgw', name: '霞鶩文楷' },
  { id: 'noto-serif', name: 'Noto Serif' },
  { id: 'source-han', name: '思源黑體' },
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
    // lib.dom 宣告 requestIdleCallback 必存在，舊版 Safari 實際沒有 → 可選型別讓守衛誠實。
    // Window 是 [Global] 介面，解構後直接呼叫不會 Illegal invocation（同 AppShell 手法）。
    const ric = (window as Partial<Window>).requestIdleCallback;
    // 排程 handle 要接住：只靠 cancelled 旗標的話，unmount 後 callback 仍會跑完
    // 整個 highlightCode（shiki 反白不便宜），只是把結果丟掉。取消掉才是真的省。
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (ric) {
      idleId = ric(() => { void run(); }, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(() => { void run(); }, 80);
    }
    function run() {
      return highlightCode(codeText, lang).then((html) => {
        if (!cancelled) setHighlighted(html);
      }).catch(() => { /* fallback 留 plain pre */ });
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) (window as Partial<Window>).cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
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
  // Children.toArray 一般不建議（會遮蔽 key、鼓勵去操作 children），但這裡是
  // markdown 渲染器：要判斷「這個段落是不是只有一個裸連結」才能決定換成 LinkCard，
  // 除了檢查 children 結構沒有別的辦法——react-markdown 就是這樣把節點交給我們的。
  // eslint-disable-next-line @eslint-react/no-children-to-array
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
              <span>{t('blog.postCount', { count: info.post_count })}</span>
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
/** 文章頁 meta 與浮動按鈕上那顆愛心 = 反應列裡的這一個，不是舊的 `posts.likes`。 */
const HEART = '❤️';

/**
 * 反應狀態（數量 + 自己按過哪些 + toggle），給反應列和愛心按鈕共用。
 *
 * 抽出來是因為同一顆愛心原本有兩套來源：文章頁 meta 的 `❤️ {likeCount}` 和右下浮動
 * 按鈕走 `posts.likes`（`/api/posts/:id/like`），而下方反應列的 ❤️ 走 `post_reactions`。
 * 兩個數字各自增減，同一篇文章因此顯示兩個不一樣的值。
 *
 * 現在三處都吃這個 hook，共用同一份 Query 快取與同一個 localStorage key，所以在任何
 * 一處按下去，另外兩處會同步——它們本來就是同一個狀態，不是三份需要互相通知的副本。
 *
 * 不 export：列表卡片（Blog.tsx）刻意不用它，否則一頁十幾張卡片會各發一個 /reactions
 * 請求；那邊的初始值走 `PostListItem.heart_count`。而 export 非元件的東西會破壞這個
 * 檔案的 fast refresh（oxlint react/only-export-components）。
 */
function useReactions(postId: string | number) {
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
    // localStorage 在 server 上不存在 → 只能在 effect 讀（同 Comments 的說明）
    // eslint-disable-next-line @eslint-react/set-state-in-effect
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

  return { counts, mine, toggle };
}

/**
 * 反應狀態由 BlogPost 持有並傳進來，這裡不自己呼叫 useReactions。
 *
 * 一開始兩邊各呼叫一次，結果 `counts` 會同步（同一份 Query 快取）但 `mine` 不會——那是
 * 各自的 useState。症狀是在反應列取消 ❤️ 之後，浮動按鈕還是亮的，再按一次送出的 delta
 * 是 -1（它以為自己還按著），數字卡在 0 動不了。同一個狀態就只能有一個持有者。
 */
const Reactions = React.memo(({ counts, mine, toggle }: ReturnType<typeof useReactions>) => {
  return (
    // role="group" + aria-label 把一排 emoji 按鈕歸成一組；建議的 fieldset/optgroup
    // 都帶有表單語意，用在這裡反而錯
    // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
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
        {/* 同上：這塊 aside 排在文章 h1 之後，用 h4 會跳級 */}
        <h2 className="series-nav-name">{seriesName}</h2>
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
    const sorted = [...published].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
    const sorted = [...allPosts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
    <nav className="posts-nav" aria-label={t('blog.nearbyNav')}>
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
            // 骨架屏佔位，載入完就整批換掉，不存在重排問題
            // eslint-disable-next-line @eslint-react/no-array-index-key
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
      <nav className="toc-nav" aria-label={t('blog.toc')} ref={tocRef}>
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
                // 每個選項用自己的字體預覽 → 直接指向 index.css 的那份定義，不另存一份字體棧
                style={{ fontFamily: `var(--blog-font-${f.id})` }}
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
      // getBoundingClientRect 要等元素真的掛上才量得到，render 期無解 → 只能在 effect。
      // eslint-disable-next-line @eslint-react/set-state-in-effect
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
          // 同 LanguagePicker：不掛 role="listbox"/"option"。那組 role 承諾完整的 listbox
          // 鍵盤語意（方向鍵 + aria-activedescendant），這裡沒實作；role="option" 蓋在
          // button 上還會覆寫按鈕語意。一組按鈕本身就可存取，目前語言用 aria-current 標。
          style={{ position: 'absolute', top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
        >
          {LANG_OPTIONS.map(opt => {
            const isSource = opt.code === source;
            const isAvailable = available.includes(opt.code);
            return (
              <button
                key={opt.code}
                type="button"
                aria-current={opt.code === current ? 'true' : undefined}
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
  const lastActiveRef = useRef('');
  const [copied, setCopied] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [showMetaCatTooltip, setShowMetaCatTooltip] = useState(false);
  // SSR-safe：初始用預設（server 無 localStorage），掛載後才讀本地偏好 → 首次 client render 與 SSR 一致、不 mismatch。
  // 只驅動 FontSwitcher 的「目前選中」標記；實際字體由 html[data-blog-font] + CSS 變數決定。
  const [currentFont, setCurrentFont] = useState(DEFAULT_BLOG_FONT);
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
    const dateLocale = LOCALE_TO_DATE_LOCALE[postData.locale] ?? 'zh-TW';
    return {
      ...postData,
      // timeZone 固定 Asia/Taipei → server(UTC) 與 client 同一天、同 weekday，不 hydration mismatch。
      date: new Date(postData.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Taipei' }),
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

  const handleFontChange = useCallback((fontId: string) => {
    setCurrentFont(fontId);
    localStorage.setItem('blogFont', fontId);
    // 立刻套用：pre-paint script 只在整頁載入時跑，SPA 內切換字體要自己改 attribute
    document.documentElement.setAttribute('data-blog-font', fontId);
  }, []);

  // 掛載後補讀偏好——只為了讓 FontSwitcher 標對「目前選中」那一項。
  // 字體本身已經由 __root.tsx 的 pre-paint script 寫進 html[data-blog-font] 在首屏套好了，
  // 所以這裡 setState 不再造成任何版面變動（原本它會讓整篇文章重排 → CLS）。
  useEffect(() => {
    const stored = localStorage.getItem('blogFont');
    // 使用者偏好存在 localStorage，server 讀不到（同 Comments 的說明）
    // eslint-disable-next-line @eslint-react/set-state-in-effect
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

  /* ── 成功載入一篇：增加瀏覽數（每次載入新文章打一次）── */
  useEffect(() => {
    if (!postData?.id) return;
    // 以前這裡要手動 setLiked(false) 把讚的狀態歸零。現在 liked 是從 useReactions 推導
    // 的（key 帶 postId），換文章時自然就換成新文章的狀態，不必重置。
    // 刻意不用 AbortController：瀏覽數是 fire-and-forget，使用者讀完隨即跳頁正是常態，
    // 中止等於把要記的那一筆丟掉。sendBeacon 就是為這種卸載期送出設計的，
    // 後端 post_view 只吃 Path(id)、不讀 body，空 POST 即可。
    // 佇列滿時會回 false，那一筆就放掉——瀏覽數不值得為此再開一條 fetch。
    navigator.sendBeacon('/api/posts/' + postData.id + '/view');
  }, [postData?.id]);

  /* 註：原本這裡有「preview commit 過來自動 scroll 到使用者讀到那段」的邏輯，
       試了 ratio、文字匹配、比例對應好幾輪，preview 跟 BlogPost 渲染差異太大
       （contain-intrinsic-size / 欄寬 / 行高 / Shiki 非同步），找不到 100% 對的對應位置。
       最後決定拔掉 — 預覽是「快速瀏覽」，commit 進文章就從頂端讀，介面比較誠實。
       sessionStorage 順手清掉避免舊資料殘留。 */
  useEffect(() => {
    try { sessionStorage.removeItem('__koim_anchor'); } catch { /* ignore */ }
  }, []);

  /* ── Like state ──
     愛心 = 反應列裡的 ❤️。以前這裡另外維護 liked/likeCount 兩個 state（來源是
     `posts.likes`），跟下方反應列的 ❤️ 是兩個獨立的數字，同一篇文章會顯示不一致的
     值。現在共用 useReactions，三處是同一份狀態，不需要同步。 */
  const { counts: reactionCounts, mine: myReactions, toggle: toggleReaction } =
    useReactions(post?.id ?? id);
  const likeCount = reactionCounts[HEART] ?? 0;
  const liked = myReactions.has(HEART);

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
          const text = (clone.textContent).trim().replace(/\s+/g, ' ').slice(0, 320);
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

  /* ── Like handler ── 就是切換 ❤️ 反應；optimistic 與校正都在 useReactions 裡 */
  const handleLike = () => { toggleReaction(HEART); };

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
    // 同 Blog.tsx：lib.dom 宣告 share 必存在，桌面 Firefox 沒有 → 用可選型別讓守衛誠實。
    const nav: Partial<Navigator> = navigator;
    if (nav.share) {
      void nav.share({ title: shareTitle, url: shareUrl }).catch(() => { /* ignore */ });
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
    // 用 ref 而非 state 當「上一個 active」：讀 activeHeading 會讓它成為 effect 依賴，
    // 每次高亮變動就重掛一次 scroll listener——正好抵銷這個 debounce 的用意。

    const handleScroll = () => {
      const wh = window.innerHeight;
      setReadingProgress(readingProgressPct(window.scrollY, wh, document.documentElement.scrollHeight));

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!contentRef.current || !headings.length) return;
        // 只看「TOC 有列到的標題」——抓所有 [id]（含腳註/alert 的 id）的話會被非標題元素
        // 劫持 active 狀態、害 TOC 高亮消失。以 heading id 集合過濾。
        const headingIds = new Set(headings.map((h) => h.id));
        const rects = Array.from(contentRef.current.querySelectorAll('[id]'))
          .filter((el) => headingIds.has(el.id))
          .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }));
        const cur = pickActiveHeading(rects, wh);
        if (cur && cur !== lastActiveRef.current) {
          lastActiveRef.current = cur;
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
  const sourceLang = post.source_language;
  const availableLocales = post.available_locales;
  const currentLocale = post.locale;
  // 只有真的有這個語系的譯文提示才顯示；查三次改成查一次
  const translationNotice = lookup(AI_TRANSLATION_NOTICE, currentLocale);
  const titleParts = splitTitle(post.title);

  // 字體吃 CSS 變數而非 state：值由 __root.tsx 的 pre-paint script 從 localStorage 決定，
  // 首屏就是正確字體，不會再有「先用預設 serif 排一次、掛載後整篇重排」的位移。
  return (
    <div className="blog-post-container" style={{ fontFamily: 'var(--blog-font)' }}>
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
            <span className="meta-tip" data-tooltip="累計閱讀次數">📖 {post.view_count}</span>
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
            {currentLocale !== sourceLang && translationNotice && (
              <div className="ai-translation-notice">
                <span className="ai-translation-icon" aria-hidden>🌐</span>
                <span className="ai-translation-text">{translationNotice.text}</span>
                <a className="ai-translation-original" href={`/blog/${id}`}>{translationNotice.original} →</a>
              </div>
            )}
            <div className="post-content-wrapper">
              {/* AI Summary — inside card top with gradient fade */}
              {post.excerpt && (
                <div className="post-ai-summary-inline">
                  <div className="ai-summary-top-row">
                    {/* h2 而非 h4：它緊接在文章 h1 之後，跳級到 h4 會讓輔助科技讀到
                        「缺了兩層」的結構（Lighthouse heading-order 稽核會判定失敗）。
                        字級由 .ai-summary-top-row h2 控制，外觀不變。 */}
                    <h2>🔑 {t('blog.keyInsights')}</h2>
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
            <Reactions counts={reactionCounts} mine={myReactions} toggle={toggleReaction} />

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
