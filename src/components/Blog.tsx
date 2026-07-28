import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LocaleLink } from '../locale-link';
import { useLocale } from '../lib/useLocale';
import { motion, AnimatePresence } from 'framer-motion';
import { FaRegHeart, FaHeart, FaRegComment, FaShareAlt, FaRegEye, FaSearch, FaTimes, FaChevronDown } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import Comments from './Comments';
import NebulaBackground from './NebulaBackground';
import KoimLoader from './KoimLoader';
import type { Variants } from 'framer-motion';
import type { PostListItem } from '@koimsurai/api-types';
import { postsListQueryOptions, blogTagsQueryOptions, blogCategoriesQueryOptions } from '../blogList';
import { usePrefetchArticle } from '../lib/usePrefetchArticle';
import './Blog.css';
import { useCategoryLabel, useTagLabel } from '../lib/categoryLabel';
import { postPath } from '../lib/postPath';

/** `GET /api/posts` 的單篇摘要，型別由後端 Rust struct 生成（見 backend/SPECTA_PLAN.md）。 */
export type Post = PostListItem;
export type Tag = string | { name: string; post_count?: number };
export interface Category { name: string; post_count?: number }
interface PostGroup { year: number; month: number; label: string; posts: Post[] }
interface HeatmapCell { date: Date; count: number; level: number }

/* ════════════════════════════════════════════════
   FloatingComments — 浮動留言視窗 (Portal)
   ════════════════════════════════════════════════ */
const FloatingComments = ({ postId, postTitle, allowComments = true, onClose }: { postId: string | number; postTitle: string; allowComments?: boolean; onClose: () => void }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    // 防止背景滾動
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.documentElement.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <AnimatePresence>
      <motion.div
        className="floating-comments-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="floating-comments-panel"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.96 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="floating-comments-header">
            <h3>{postTitle}</h3>
            <button className="floating-comments-close" onClick={onClose}><FaTimes /></button>
          </div>
          <div className="floating-comments-body">
            <Comments postId={postId} allowComments={allowComments} />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

/* ════════════════════════════════════════════════
   動畫 variants
   ════════════════════════════════════════════════ */
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.06, ease: 'easeOut' },
  }),
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

/* ════════════════════════════════════════════════
   NoteCard — 支援 record / column 兩種樣板
   ════════════════════════════════════════════════ */

const NoteCard = React.memo(({ post, index, onOpenComments }: { post: Post; index: number; onOpenComments?: (postId: string | number, postTitle: string, allowComments: boolean) => void }) => {
  const categoryLabel = useCategoryLabel();
  const tagLabel = useTagLabel();
  const { t } = useTranslation();
  const prefetchArticle = usePrefetchArticle();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [shareToast, setShareToast] = useState(false);
  const isColumn = post.layout_type === 'column';

  useEffect(() => {
    const likedPosts = JSON.parse(localStorage.getItem('likedPosts') ?? '[]') as unknown[];
    if (likedPosts.includes(post.id)) setLiked(true);
  }, [post.id]);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newState = !liked;
    try {
      const endpoint = newState ? 'like' : 'unlike';
      const res = await fetch(`/api/posts/${post.id}/${endpoint}`, { method: 'POST' });
      const data = await res.json() as { likes?: number };
      if (res.ok) {
        setLiked(newState);
        setLikeCount(data.likes ?? 0);
        const stored = JSON.parse(localStorage.getItem('likedPosts') ?? '[]') as unknown[];
        if (newState) {
          if (!stored.includes(post.id)) localStorage.setItem('likedPosts', JSON.stringify([...stored, post.id]));
        } else {
          localStorage.setItem('likedPosts', JSON.stringify(stored.filter(id => id !== post.id)));
        }
      }
    } catch (err) {
      console.error('Like failed:', err);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shareUrl = `${window.location.origin}/blog/${post.id}`;
    const shareData = { title: post.title, url: shareUrl };
    // lib.dom 把 Web Share API 宣告成必然存在，桌面 Firefox 實際沒有 → 收窄成可選型別，
    // 讓守衛在型別上也成立（否則 no-unnecessary-condition 會誤判它多餘）。
    // 必須留在 nav 上呼叫：Navigator 不是 [Global] 介面，解構後呼叫會 Illegal invocation。
    const nav: Partial<Navigator> = navigator;
    if (nav.share) {
      try {
        await nav.share(shareData);
      } catch (err) {
        // 使用者取消分享，不做處理
        if (!(err instanceof Error && err.name === 'AbortError')) {
          void navigator.clipboard.writeText(shareUrl);
          setShareToast(true);
          setTimeout(() => setShareToast(false), 2000);
        }
      }
    } else {
      void navigator.clipboard.writeText(shareUrl);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    }
  };

  const handleComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenComments?.(post.id, post.title, post.allow_comments);
  };

  // 列表頁優先顯示內文截斷，而非 AI 摘要。content_preview 是後端已截好的前 260 字
  // （整篇 content 進列表會多 ~188KB）。
  // markdown → 純文字：連結保留文字、圖片整個丟掉；`-` `*` `>` 只在行首當標記時吃掉，
  // 不然 `tool-calling` 會被清成 `toolcalling`。
  const excerpt = post.content_preview
    ? post.content_preview
        .replace(/<[^>]+>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?)/gm, '')
        .replace(/[*`]/g, '')
        .replace(/\n+/g, ' ')
        .trim()
        .substring(0, 220) + '...'
    : '';
  const dateObj = new Date(post.created_at);
  const dayStr = dateObj.getDate();
  const monthStr = dateObj.toLocaleDateString('zh-TW', { month: 'short' });
  const fullDate = dateObj.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <motion.article
      className={`note-card${isColumn ? ' note-card--column' : ''}`}
      custom={index}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
      layout
    >
      {/* 日期指示器 or 專欄小點 */}
      {isColumn ? (
        <div className="note-column-icon">
          <span className="column-icon-dot" />
        </div>
      ) : (
        <div className="note-date-indicator">
          <span className="note-day">{dayStr}</span>
          <span className="note-month">{monthStr}</span>
        </div>
      )}

      <div className="note-body">
        {/* 頂部 meta */}
        {(!isColumn || post.category) && (
          <div className="note-meta-top">
            {!isColumn && <span className="note-full-date">{fullDate}</span>}
            {post.category && <span className="note-category">{categoryLabel(post.category)}</span>}
          </div>
        )}

        {/* 標題 */}
        <LocaleLink
          to={postPath(post)}
          className="note-title-link"
          viewTransition
          onMouseEnter={() => prefetchArticle(post.id)}
          onFocus={() => prefetchArticle(post.id)}
        >
          <h2 className="note-title">{post.title}</h2>
        </LocaleLink>

        {/* 摘要 */}
        <p className="note-excerpt">{excerpt}</p>

        {/* 標籤 */}
        {post.tags.length > 0 && (
          <div className="note-tags">
            {post.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="note-tag">#{tagLabel(tag)}</span>
            ))}
          </div>
        )}

        {/* 底部互動列 */}
        <div className="note-actions">
          <button className={`note-action-btn ${liked ? 'liked' : ''}`} onClick={(e) => { void handleLike(e); }}>
            {liked ? <FaHeart /> : <FaRegHeart />}
            <span>{likeCount > 0 ? likeCount : ''}</span>
          </button>
          <button className="note-action-btn" onClick={handleComment}>
            <FaRegComment />
            <span>{t('blog.comment')}</span>
          </button>
          <button className={`note-action-btn${shareToast ? ' shared' : ''}`} onClick={(e) => { void handleShare(e); }}>
            <FaShareAlt />
            <span>{shareToast ? t('blog.shareCopied') : t('blog.share')}</span>
          </button>
          {(post.view_count) > 0 && (
            <span className="note-views">
              <FaRegEye />
              {post.view_count}
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );
});

/* ════════════════════════════════════════════════
   ActivityHeatmap — 寫作活動熱圖（過去 26 週）
   ════════════════════════════════════════════════ */
const ActivityHeatmap = React.memo(({ posts }: { posts: Post[] }) => {
  const { t } = useTranslation();
  const cells = useMemo(() => {
    const WEEKS = 26;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 對齊到本週日
    const offset = today.getDay();
    const lastDay = new Date(today);
    lastDay.setDate(today.getDate() + (6 - offset));
    const startDay = new Date(lastDay);
    startDay.setDate(lastDay.getDate() - WEEKS * 7 + 1);

    // 統計每日發文數
    const counts = new Map<string, number>();
    posts.forEach(p => {
      if (!p.created_at) return;
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    const grid: HeatmapCell[][] = [];
    const cur = new Date(startDay);
    for (let w = 0; w < WEEKS; w++) {
      const col: HeatmapCell[] = [];
      for (let d = 0; d < 7; d++) {
        const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
        const count = counts.get(key) ?? 0;
        const isFuture = cur > today;
        col.push({
          date: new Date(cur),
          count,
          level: isFuture ? -1 : count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4,
        });
        cur.setDate(cur.getDate() + 1);
      }
      grid.push(col);
    }
    return grid;
  }, [posts]);

  const totalPosts = posts.length;
  const formatDate = (d: Date) => d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="activity-heatmap">
      <div className="heatmap-stats">
        <span className="heatmap-total">{totalPosts}</span>
        <span className="heatmap-total-label">{t('blog.heatmapTotal')}</span>
      </div>
      <div className="heatmap-grid" role="img" aria-label={t('blog.heatmapAria')}>
        {cells.map((week) => (
          <div key={week[0]?.date.toISOString()} className="heatmap-col">
            {week.map((cell) => (
              <span
                key={cell.date.toISOString()}
                className={`heatmap-cell heatmap-level-${cell.level}`}
                title={cell.level >= 0 ? `${formatDate(cell.date)} · ${cell.count} 篇` : ''}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>{t('blog.heatmapLess')}</span>
        <span className="heatmap-cell heatmap-level-0" />
        <span className="heatmap-cell heatmap-level-1" />
        <span className="heatmap-cell heatmap-level-2" />
        <span className="heatmap-cell heatmap-level-3" />
        <span className="heatmap-cell heatmap-level-4" />
        <span>{t('blog.heatmapMore')}</span>
      </div>
    </div>
  );
});
ActivityHeatmap.displayName = 'ActivityHeatmap';

/* ════════════════════════════════════════════════
   Blog 主頁面
   ════════════════════════════════════════════════ */
function Blog() {
  const { t } = useTranslation();
  // 路由 loader 在 server 端抓好的首屏文章。元件被 /blog 與 /$locale/blog 共用 → strict:false
  // (官方給共用元件的用法:忽略 from、型別放寬)。有值就當初始資料 → SSR 直接 render 出文章,
  // 而不是卡在下面的 `if (loading)` 骨架屏。
  const locale = useLocale();
  const prefetchArticle = usePrefetchArticle();
  const categoryLabel = useCategoryLabel();
  const tagLabel = useTagLabel();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  // 資料改由 TanStack Query 管理：route loader 已 prefetch 首屏（newest）→ SSR baked、
  // hydrate 後 useQuery 讀快取。切換排序 = 換 queryKey 自動 refetch（且帶 locale）。
  const { data: posts = [], isPending: postsPending, error: postsError } = useQuery(postsListQueryOptions(locale, sortBy));
  const { data: allTags = [] } = useQuery(blogTagsQueryOptions(locale));
  const { data: allCategories = [] } = useQuery(blogCategoriesQueryOptions(locale));
  const loading = postsPending;
  const error = postsError ? (postsError instanceof Error ? postsError.message : t('blog.loadFailed')) : null;
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [floatingComment, setFloatingComment] = useState<{ postId: string; postTitle: string; allowComments: boolean } | null>(null);
  const search = useRouterState({ select: (s) => s.location.search }) as { category?: string; tag?: string };

  const handleOpenComments = useCallback((postId: string | number, postTitle: string, allowComments: boolean) => {
    setFloatingComment({
      postId: String(postId),
      postTitle,
      allowComments,
    });
  }, []);

  // 讀取 URL 參數自動帶入篩選
  useEffect(() => {
    if (search.category) setSelectedCategory(search.category);
    if (search.tag) setSelectedTag(search.tag);
  }, [search.category, search.tag]);

  // posts / tags / categories 都改由 useQuery 管理（見檔案上方）；
  // 排序切換由 sortBy 進 queryKey 自動 refetch，不再需要手動 fetch useEffect。

  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      // 內文只搜得到 content_preview（前 260 字）；列表本來就沒有整篇 content。
      // 全文搜尋要走後端 `/api/posts?search=`（SQL 對 p.content LIKE）。
      const matchSearch = !searchTerm || post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.content_preview.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTag = !selectedTag || post.tags.includes(selectedTag);
      const matchCat = !selectedCategory || post.category === selectedCategory;
      return matchSearch && matchTag && matchCat;
    });
  }, [posts, searchTerm, selectedTag, selectedCategory]);

  // 按年月分組
  const groupedPosts = useMemo(() => {
    const groups: Record<string, PostGroup> = {};
    filteredPosts.forEach(post => {
      const d = new Date(post.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!groups[key]) {
        groups[key] = {
          year: d.getFullYear(),
          month: d.getMonth(),
          label: d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' }),
          posts: [],
        };
      }
      groups[key].posts.push(post);
    });
    return Object.values(groups).sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);
  }, [filteredPosts]);

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedTag('');
    setSelectedCategory('');
  }, []);

  const featuredPosts = useMemo(() => posts.slice(0, 5), [posts]);
  const maxTagsShow = 10;
  const tagsToShow = tagsExpanded ? allTags : allTags.slice(0, maxTagsShow);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="blog-page">
        <NebulaBackground />
        <KoimLoader fullscreen text={t('blog.loading')} />
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="blog-page">
        <NebulaBackground />
        <div className="blog-loading">
          <p>❌ {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="blog-page">
      {/* ── 深空暗幕 + 星雲背景（共用元件） ── */}
      <NebulaBackground />

      {/* ── 主內容區 ── */}
      <div className="blog-content-wrapper">

        {/* ═══ 上方 Header 區 ═══ */}
        <div className="blog-header-area">
          {/* Hero 標題 */}
          <motion.header className="blog-hero" initial="hidden" animate="visible" variants={fadeUp}>
            <h1 className="blog-hero-title">
              <span className="blog-title-gradient">{t('blog.heroTitle')}</span>
              <span className="blog-title-sub">· Notes</span>
            </h1>
            <p className="blog-hero-desc">
              記錄技術探索、開發心得與生活碎片。每一篇都是當下最真誠的思考。
            </p>
          </motion.header>

          {/* 搜尋列 */}
          <motion.div className="blog-search-bar" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
            <FaSearch className="search-icon" />
            <input
              type="text"
              className="blog-search-input"
              placeholder={t('blog.search')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="search-clear" onClick={() => setSearchTerm('')}>
                <FaTimes />
              </button>
            )}
          </motion.div>

          {/* 排序控制 + 統計 */}
          <motion.div className="blog-sort-row" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
            <div className="sort-pills">
              {[
                { value: 'newest', label: t('blog.sort.newest') },
                { value: 'oldest', label: t('blog.sort.oldest') },
                { value: 'popular', label: t('blog.sort.popular') },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`sort-pill ${sortBy === opt.value ? 'active' : ''}`}
                  onClick={() => setSortBy(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="stats-inline">
              <span>{t('blog.statPosts')} <em>{posts.length}</em></span>
              <span className="stats-sep">｜</span>
              <span>{t('blog.statTags')} <em>{allTags.length}</em></span>
              <span className="stats-sep">｜</span>
              <span>{t('blog.statReads')} <em>{filteredPosts.reduce((sum, p) => sum + (p.view_count), 0)}</em></span>
            </div>
          </motion.div>

          {/* 活動篩選 */}
          {(selectedTag || selectedCategory || searchTerm) && (
            <motion.div className="active-filters" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
              {selectedCategory && (
                <span className="active-filter-chip">
                  📁 {selectedCategory}
                  <button onClick={() => setSelectedCategory('')}><FaTimes /></button>
                </span>
              )}
              {selectedTag && (
                <span className="active-filter-chip">
                  🏷️ {selectedTag}
                  <button onClick={() => setSelectedTag('')}><FaTimes /></button>
                </span>
              )}
              {searchTerm && (
                <span className="active-filter-chip">
                  🔍 {searchTerm}
                  <button onClick={() => setSearchTerm('')}><FaTimes /></button>
                </span>
              )}
              <button className="clear-all-btn" onClick={clearFilters}>{t('blog.clearAll')}</button>
            </motion.div>
          )}
        </div>

        {/* ═══ 下方 Content 區（文章 + sidebar）═══ */}
        <div className="blog-layout">
          <main className="blog-main">
          {filteredPosts.length === 0 ? (
            <motion.div className="blog-empty" variants={fadeUp} initial="hidden" animate="visible">
              <div className="empty-icon">📝</div>
              <h3>{searchTerm || selectedTag || selectedCategory ? t('blog.emptyFiltered') : t('blog.emptyNone')}</h3>
              <p>
                {searchTerm || selectedTag || selectedCategory
                  ? t('blog.emptyFilteredHint')
                  : t('blog.emptyNoneHint')}
              </p>
              {(searchTerm || selectedTag || selectedCategory) && (
                <button className="empty-clear-btn" onClick={clearFilters}>{t('blog.clearFilters')}</button>
              )}
            </motion.div>
          ) : (
            <motion.div className="notes-timeline" variants={stagger} initial="hidden" animate="visible">
              {groupedPosts.map((group) => (
                <div key={`${group.year}-${group.month}`} className="timeline-group">
                  <div className="timeline-group-label">{group.label}</div>
                  {group.posts.map((post, i) => (
                    <NoteCard key={post.id} post={post} index={i} onOpenComments={handleOpenComments} />
                  ))}
                </div>
              ))}
            </motion.div>
          )}
          </main>

          {/* ── 側邊欄 — 融入星空風格（去卡片化） ── */}
          <aside className="blog-sidebar">
          {/* 分類 */}
          {allCategories.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-heading">{t('blog.sideCategories')}</h3>
              <div className="category-list">
                <button
                  className={`category-item ${selectedCategory === '' ? 'active' : ''}`}
                  onClick={() => setSelectedCategory('')}
                >
                  全部
                </button>
                {allCategories.filter(cat => (cat.post_count ?? 0) > 0).map(cat => (
                  <button
                    key={cat.name}
                    className={`category-item ${selectedCategory === cat.name ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat.name)}
                  >
                    {categoryLabel(cat.name)}
                    <span className="cat-count">{cat.post_count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 標籤雲 */}
          {allTags.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-heading">{t('blog.sideTags')}</h3>
              <div className="tag-cloud">
                <button
                  className={`cloud-tag ${selectedTag === '' ? 'active' : ''}`}
                  onClick={() => setSelectedTag('')}
                >
                  全部
                </button>
                {tagsToShow.map(tag => {
                  const name = typeof tag === 'object' ? tag.name : tag;
                  const count = typeof tag === 'object' ? tag.post_count : '';
                  return (
                    <button
                      key={name}
                      className={`cloud-tag ${selectedTag === name ? 'active' : ''}`}
                      onClick={() => setSelectedTag(name)}
                    >
                      #{tagLabel(name)}{count ? ` (${count})` : ''}
                    </button>
                  );
                })}
              </div>
              {allTags.length > maxTagsShow && (
                <button className="tags-toggle" onClick={() => setTagsExpanded(!tagsExpanded)}>
                  {tagsExpanded ? t('blog.collapse') : `${t('blog.expandAll')} (${allTags.length})`}
                  <FaChevronDown className={`toggle-icon ${tagsExpanded ? 'expanded' : ''}`} />
                </button>
              )}
            </div>
          )}

          {/* 精選文章 */}
          {featuredPosts.length > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-heading">{t('blog.sideFeatured')}</h3>
              <ul className="featured-list">
                {featuredPosts.map(p => (
                  <li key={p.id}>
                    <LocaleLink
                      to={postPath(p)}
                      className="featured-link"
                      onMouseEnter={() => prefetchArticle(p.id)}
                      onFocus={() => prefetchArticle(p.id)}
                    >
                      <span className="featured-text">{p.title}</span>
                      <span className="featured-date">
                        {new Date(p.created_at).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })}
                      </span>
                    </LocaleLink>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 寫作活動熱圖 */}
          <div className="sidebar-section">
            <h3 className="sidebar-heading">{t('blog.sideActivity')}</h3>
            <ActivityHeatmap posts={posts} />
          </div>

          {/* 快速導航 */}
          <div className="sidebar-section">
            <h3 className="sidebar-heading">{t('blog.sideNav')}</h3>
            <div className="quick-nav">
              <LocaleLink to="/" className="nav-pill">🏠 {t('blog.navHome')}</LocaleLink>
              <LocaleLink to="/messages" className="nav-pill">💬 {t('blog.navMessages')}</LocaleLink>
              <LocaleLink to="/setup" className="nav-pill">🖥️ {t('blog.navSetup')}</LocaleLink>
              <LocaleLink to="/about#journey" className="nav-pill">🛤️ {t('blog.navJourney')}</LocaleLink>
            </div>
          </div>
          </aside>
        </div>{/* blog-layout */}
      </div>{/* blog-content-wrapper */}

      {/* 浮動留言視窗 */}
      <AnimatePresence>
        {floatingComment && (
          <FloatingComments
            postId={floatingComment.postId}
            postTitle={floatingComment.postTitle}
            allowComments={floatingComment.allowComments}
            onClose={() => setFloatingComment(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default Blog;