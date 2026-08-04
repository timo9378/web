import { useEffect, useState, useRef, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { subscribeScroll, scrollRatio } from '@/store/scrollStore';
import { LocaleLink } from '@/i18n/locale-link';
import { motion } from 'framer-motion';
import { FaArrowUp } from 'react-icons/fa';
import SignatureSVG from '@/components/common/SignatureSVG';
import Comments from '@/components/blog/Comments';
import '@/components/blog/BlogPost.css';     // 拿 BlogPost 的 dim overlay / post-content-wrapper / TOC 樣式
import './InfoPage.css';

interface PagerLink { to: string; title: string }
interface Heading { id: string; text: string; level: number }

interface InfoPageProps {
  title: string;
  subtitle?: string;
  slug?: string;           // 用來當 Comments 的 postId
  prev?: PagerLink | null; // { to, title } | null
  next?: PagerLink | null; // { to, title } | null
  closingNote?: ReactNode; // 末尾的小字（例：本站已運行 X 天）
  children?: ReactNode;
}

/**
 * 通用「資訊型頁面」layout：
 *   ── 大標 / 副標
 *   ── 內容區（max-width，中間置中）— 走 BlogPost 的 post-content-wrapper glass card
 *   ── 右側 sticky TOC（沒有左 sidebar，但 grid 留出對稱空間）
 *   ── 簽名檔
 *   ── 「回顧一下」 / 「繼續瞭解」 上下篇 cross-link
 *   ── Comments
 *
 * 用 contentRef 內容自動偵測 h2/h3 來建 TOC，呼叫端只要丟 children 就好。
 */
function InfoPage({
  title,
  subtitle,
  slug,
  prev,
  next,
  closingNote,
  children,
}: InfoPageProps) {
  const contentRef = useRef<HTMLElement>(null);
  const tocRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);

  // 從渲染後的 DOM 把 h2/h3 抓出來建 TOC
  useEffect(() => {
    if (!contentRef.current) return;
    const els = contentRef.current.querySelectorAll('h2[id], h3[id]');
    const list = Array.from(els).map((el) => ({
      id: el.id,
      text: el.textContent,
      level: el.tagName === 'H2' ? 2 : 3,
    }));
    setHeadings(list);
  }, [children]);

  // 滾動進度 + scrollspy：兩者都是「訂閱捲動、每次讀快照」，交給 useSyncExternalStore。
  // 兩個 getSnapshot 都回傳純量（number / string），不會因為每次新建物件而無限重繪。
  // activeId 的快照閉包會隨 headings 變動而重建 —— 那正好是我們要的：headings 一改，
  // 元件重繪、快照重算。
  const progress = useSyncExternalStore(subscribeScroll, () => scrollRatio() * 100, () => 0);
  const activeId = useSyncExternalStore(
    subscribeScroll,
    () => {
      // scrollspy: 找到 viewport 上半部第一個 heading
      const triggerY = window.innerHeight * 0.3;
      let current = '';
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerY) current = h.id;
        else break;
      }
      return current;
    },
    () => '',
  );

  const scrollToHeading = useCallback((id: string) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
    }, 50);
  }, []);

  return (
    <div className="blog-post-container info-page" style={{ fontFamily: 'inherit' }}>

      {/* 同一塊 dim overlay 蓋在 starfield 上面，跟 BlogPost 一致的暗色感 */}
      <div className="blog-post-dim-overlay" />

      {/* Header */}
      <motion.header
        className="post-header info-page-header"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      >
        <h1 className="post-title info-page-title">{title}</h1>
        {subtitle && <p className="info-page-subtitle">{subtitle}</p>}
      </motion.header>

      {/* 跟 BlogPost 一樣的三欄佈局：左留白 + 中內容 + 右 TOC */}
      <div className="post-body info-page-body">
        {/* 左 sidebar：空白用以對稱（不放 PostsNav，因為 info page 沒有「鄰近文章」概念） */}
        <aside className="post-sidebar-left info-page-sidebar-left" aria-hidden />

        <motion.div
          className="post-main-column info-page-main"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1], delay: 0.05 }}
        >
          {/* 不用 post-content-wrapper 那個 glass card，about/history 是字直接浮在背景上 */}
          <article className="post-content info-page-content" ref={contentRef}>
            {children}
            <SignatureSVG className="blog-signature info-page-signature" />
            {closingNote && <p className="info-page-closing">{closingNote}</p>}
          </article>

          {/* prev / next 「回顧一下 / 繼續瞭解」 */}
          {(prev ?? next) && (
            <nav className="info-page-pager" aria-label="頁面導覽">
              <div className="info-page-pager-side">
                {prev && (
                  <LocaleLink to={prev.to} className="info-page-pager-link info-page-pager-prev">
                    <span className="info-page-pager-label">回顧一下：</span>
                    <span className="info-page-pager-title">{prev.title}</span>
                  </LocaleLink>
                )}
              </div>
              <div className="info-page-pager-side info-page-pager-side--right">
                {next && (
                  <LocaleLink to={next.to} className="info-page-pager-link info-page-pager-next">
                    <span className="info-page-pager-label">繼續瞭解：</span>
                    <span className="info-page-pager-title">{next.title}</span>
                  </LocaleLink>
                )}
              </div>
            </nav>
          )}

          {/* 留言區 — Comments 後端用 post_id 隔離，加 meta- 前綴避免跟數字文章 ID 撞 */}
          {slug && (
            <div className="info-page-comments post-extras" id="comments">
              <Comments postId={`meta-${slug}`} />
            </div>
          )}
        </motion.div>

        {/* 右側 sticky TOC — 跟 BlogPost 一致的 class，承襲 BlogPost.css 樣式 */}
        {headings.length > 0 && (
          <aside className="post-sidebar-right">
            <div className="table-of-contents">
              <div className="toc-header">
                <h3>目錄</h3>
                <div className="reading-progress-circle">
                  <svg viewBox="0 0 36 36">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="var(--post-accent)" strokeWidth="3"
                      strokeDasharray={progress + ', 100'} />
                  </svg>
                  <span className="progress-text">{Math.round(progress)}%</span>
                </div>
              </div>
              <nav className="toc-nav" ref={tocRef}>
                {headings.map((h) => (
                  <button
                    key={h.id}
                    data-heading-id={h.id}
                    className={'toc-item level-' + h.level + (activeId === h.id ? ' active' : '')}
                    onClick={() => scrollToHeading(h.id)}
                    title={h.text}
                  >
                    <span className="toc-bullet" />
                    <span className="toc-text">{h.text}</span>
                  </button>
                ))}
              </nav>
              <button className="toc-bottom-link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                <FaArrowUp /> 回到頂部
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default InfoPage;
