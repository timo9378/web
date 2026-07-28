import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { useLocale, useLocaleNavigate } from '../lib/useLocale';
import { useTranslation } from 'react-i18next';
import {
  FileText, Hash, Folder, Music, BookOpen, Activity,
  Home, Compass, Camera, Settings, Search,
  type LucideIcon,
} from 'lucide-react';
import { recentPostsQueryOptions, blogCategoriesQueryOptions, blogTagsQueryOptions } from '../blogList';
import './CommandPalette.css';
import { useCategoryLabel } from '../lib/categoryLabel';

interface StaticPage { label: string; path: string; icon: LucideIcon; keywords: string }

const STATIC_PAGES: StaticPage[] = [
  { label: '首頁',    path: '/',          icon: Home,     keywords: 'home index 主頁' },
  { label: '手記',    path: '/blog',      icon: FileText, keywords: 'blog posts 文章 日記' },
  { label: '書櫃',    path: '/bookshelf', icon: BookOpen, keywords: 'books 閱讀 reading' },
  { label: '音樂',    path: '/music',     icon: Music,    keywords: 'music spotify 音樂' },
  { label: '活動',    path: '/activity',  icon: Activity, keywords: 'activity 活動 動態' },
  { label: '軌跡',    path: '/about#journey',   icon: Compass,  keywords: 'journey 旅程 時間線' },
  { label: '留言',    path: '/messages',  icon: Compass,  keywords: 'messages 留言 guestbook contact' },
  { label: '相簿',    path: '/photos',    icon: Camera,   keywords: 'photos 照片 相簿' },
  { label: '工作站',  path: '/setup',     icon: Settings, keywords: 'setup 設備' },
];

export default function CommandPalette() {
  const categoryLabel = useCategoryLabel();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const navigate = useLocaleNavigate();
  const navLocale = useLocale();

  // ⌘K / Ctrl+K 開關
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);

  // 首次打開才載入（enabled: open，降低首屏成本）；三源改吃共用 query 快取。
  const { data: postsData = [] } = useQuery({ ...recentPostsQueryOptions(200, navLocale), enabled: open });
  const { data: categories = [] } = useQuery({ ...blogCategoriesQueryOptions(navLocale), enabled: open });
  const { data: tags = [] } = useQuery({ ...blogTagsQueryOptions(navLocale), enabled: open });
  const posts = useMemo(() => postsData.filter((p) => p.status === 'published' || !p.status), [postsData]);

  const go = (path: string) => { setOpen(false); void navigate(path); };

  const postItems = useMemo(() => posts.slice(0, 50), [posts]);

  if (!open) return null;

  return (
    // 用 e.target === e.currentTarget 判斷「點在遮罩本身」，而不是靠內層 div
    // stopPropagation 擋冒泡：後者等於在一個非互動元素上掛 onClick，只為了
    // 攔事件。改掉之後內層那層純事件管線的 onClick 可以整個拿掉。
    // 點遮罩關閉是滑鼠的便利路徑，不是唯一出口：cmdk 原生處理 Escape，
        // 輸入框也在焦點序列內。遮罩本身不該進 Tab 序列（那反而多一個空的停留點）
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
    <div className="cmdk-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk-wrap">
        <Command label={t('commandPalette.label')} shouldFilter>
          <div className="cmdk-input-row">
            <Search className="cmdk-search-icon" size={16} />
            {/* 命令面板一開就該能直接打字——autoFocus 正是使用者預期，少了它反而要多按一次 Tab */}
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <Command.Input placeholder={t('commandPalette.placeholder')} autoFocus />
            <kbd className="cmdk-kbd">ESC</kbd>
          </div>

          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">{t('commandPalette.empty')}</Command.Empty>

            <Command.Group heading={t('commandPalette.groups.pages')}>
              {STATIC_PAGES.map((p) => (
                <Command.Item
                  key={p.path}
                  value={`${p.label} ${p.keywords} ${p.path}`}
                  onSelect={() => go(p.path)}
                >
                  <p.icon size={14} className="cmdk-icon" />
                  <span>{p.label}</span>
                  <span className="cmdk-meta">{p.path}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {postItems.length > 0 && (
              <Command.Group heading={t('commandPalette.groups.posts')}>
                {postItems.map((p) => (
                  <Command.Item
                    key={`post-${p.id}`}
                    value={`${p.title} ${p.excerpt} ${p.tags.join(' ')} ${p.category ?? ''}`}
                    onSelect={() => go(`/blog/${p.id}`)}
                  >
                    <FileText size={14} className="cmdk-icon" />
                    <span className="cmdk-truncate">{p.title}</span>
                    {p.category && <span className="cmdk-meta">{categoryLabel(p.category)}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {categories.length > 0 && (
              <Command.Group heading={t('commandPalette.groups.categories')}>
                {categories.map((c) => (
                  <Command.Item
                    key={`cat-${c.name}`}
                    value={`category ${c.name}`}
                    onSelect={() => go(`/blog?category=${encodeURIComponent(c.name)}`)}
                  >
                    <Folder size={14} className="cmdk-icon" />
                    <span>{c.name}</span>
                    {c.post_count != null && <span className="cmdk-meta">{c.post_count} {t('blog.postCount')}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {tags.length > 0 && (
              <Command.Group heading={t('commandPalette.groups.tags')}>
                {tags.slice(0, 30).map((tag) => {
                  // blogTagsQueryOptions 的 Tag 是 string | {name} union（對齊 Blog 頁）
                  const name = typeof tag === 'object' ? tag.name : tag;
                  return (
                    <Command.Item
                      key={`tag-${name}`}
                      value={`tag ${name}`}
                      onSelect={() => go(`/blog?tag=${encodeURIComponent(name)}`)}
                    >
                      <Hash size={14} className="cmdk-icon" />
                      <span>{name}</span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}
          </Command.List>

          <div className="cmdk-footer">
            <span><kbd>↑↓</kbd> 移動</span>
            <span><kbd>↵</kbd> 開啟</span>
            <span><kbd>⌘K</kbd> 切換</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
