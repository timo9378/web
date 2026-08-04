import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LocaleLink } from '@/i18n/locale-link';
import { useLocale } from '@/hooks/useLocale';
import { useTranslation } from 'react-i18next';
import { blogCategoriesQueryOptions, recentPostsQueryOptions } from '@/data/blogList';
import type { PostListItem } from '@koimsurai/api-types';
import { MegaMenuPanel, MegaMenuColumn } from './MegaMenu';
import { postPath } from '../../lib/postPath';

/**
 * 手記 menu 內容（categories + recent posts hover-linked）
 *   左欄：分類列表（hover 高亮 + filter 右欄）
 *   右欄：最新 N 篇（隨 hover 的分類動態切換）
 * 資料改由 TanStack Query 讀（categories 與 Blog 頁共用快取；posts 用 recentPostsQueryOptions(50)）。
 */

function RecentPostRow({ post }: { post: PostListItem }) {
  const { t } = useTranslation();
  const dateLabel = useMemo(() => {
    if (!post.created_at) return '';
    const d = new Date(post.created_at);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays < 1) return t('common.today');
    if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
    if (diffDays < 30) return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
    if (diffDays < 365) return t('common.monthsAgo', { count: Math.floor(diffDays / 30) });
    return t('common.yearsAgo', { count: Math.floor(diffDays / 365) });
  }, [post.created_at, t]);

  return (
    <LocaleLink to={postPath(post)} className="mega-menu-post" viewTransition>
      <div className="mega-menu-post-title">{post.title}</div>
      <div className="mega-menu-post-meta">
        {post.category && <span>{post.category}</span>}
        {post.category && dateLabel && <span className="mega-menu-post-meta-dot">·</span>}
        {dateLabel && <span>{dateLabel}</span>}
      </div>
    </LocaleLink>
  );
}

function BlogMenuContent() {
  const { t } = useTranslation();
  const navLocale = useLocale();
  const { data: allCategories = [] } = useQuery(blogCategoriesQueryOptions(navLocale));
  const { data: allPosts = [] } = useQuery(recentPostsQueryOptions(50, navLocale));
  const [activeCat, setActiveCat] = useState<string | null>(null); // null = 全部

  // 只顯示有文章的分類，避免空欄位佔版面
  const categories = useMemo(() => allCategories.filter((c) => c.post_count > 0), [allCategories]);
  const posts = useMemo(
    () => allPosts.filter((p) => p.status === 'published' || !p.status),
    [allPosts],
  );

  const filteredPosts = useMemo(() => {
    if (!activeCat) return posts.slice(0, 5);
    return posts.filter((p) => p.category === activeCat).slice(0, 5);
  }, [posts, activeCat]);

  return (
    <MegaMenuPanel>
      <MegaMenuColumn title={t('megaMenu.groups.categories')}>
        <LocaleLink
          to="/blog"
          className={`mega-menu-category ${activeCat === null ? 'mega-menu-category--active' : ''}`}
          onMouseEnter={() => setActiveCat(null)}
        >
          <span>{t('megaMenu.items.allPosts')}</span>
          <span className="mega-menu-category-count">{posts.length}</span>
        </LocaleLink>
        {categories.map((c) => (
          <LocaleLink
            key={c.name}
            to={`/blog?category=${encodeURIComponent(c.name)}`}
            className={`mega-menu-category ${activeCat === c.name ? 'mega-menu-category--active' : ''}`}
            onMouseEnter={() => setActiveCat(c.name)}
          >
            <span>{c.name}</span>
            <span className="mega-menu-category-count">{c.post_count}</span>
          </LocaleLink>
        ))}
      </MegaMenuColumn>

      <MegaMenuColumn title={activeCat ? t('megaMenu.groups.categoryLatest', { cat: activeCat }) : t('megaMenu.groups.latestPosts')} span={1}>
        <div className="mega-menu-posts">
          {filteredPosts.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'rgba(161,161,170,0.55)' }}>
              {t('megaMenu.items.emptyCategory')}
            </div>
          )}
          {filteredPosts.map((p) => (
            <RecentPostRow key={p.id} post={p} />
          ))}
          <LocaleLink to="/blog" className="mega-menu-view-all">
            {t('megaMenu.items.viewAllPosts')}
          </LocaleLink>
        </div>
      </MegaMenuColumn>
    </MegaMenuPanel>
  );
}

export default BlogMenuContent;
