import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { FaTimes, FaSearch, FaFileAlt } from 'react-icons/fa';
import { recentPostsQueryOptions } from '../../blogList';

interface LinkablePost {
  id: number | string;
  title?: string;
  excerpt?: string;
  status?: string;
}

interface PostLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (post: LinkablePost) => void;
}

/**
 * 舊文章連結選擇器（C-3）
 * 由 Monaco editor 透過 Cmd/Ctrl+Shift+K 或 toolbar 按鈕觸發。
 * 拉一份 published posts 清單，提供模糊搜尋，點擊後 onSelect(post) 回傳。
 */
const PostLinkModal = ({ isOpen, onClose, onSelect }: PostLinkModalProps) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 文章清單改由 TanStack Query 讀（開啟才抓）；reuse 公開 recentPostsQueryOptions(300)。
  const { data: allPosts = [], isFetching: loading } = useQuery({ ...recentPostsQueryOptions(300), enabled: isOpen });
  const posts = useMemo(
    () => allPosts.filter((p) => p.status === 'published' || !p.status),
    [allPosts],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    // 等 Dialog 動畫掛上再 focus；modal 快速關閉時要清掉，避免殘留計時器
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts.slice(0, 50);
    return posts
      .filter((p) =>
        (p.title).toLowerCase().includes(q) ||
        (p.excerpt).toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [posts, query]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-[min(640px,92vw)] rounded-xl border border-zinc-700/60 bg-zinc-900/95 backdrop-blur-md shadow-2xl overflow-hidden"
          initial={{ scale: 0.96, y: -10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: -10, opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <FaSearch className="text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="搜尋文章標題或摘要…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && filtered[0]) onSelect(filtered[0]);
              }}
              className="flex-1 bg-transparent outline-none text-zinc-100 placeholder-zinc-500 text-sm"
            />
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors"
              aria-label="close"
            >
              <FaTimes />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-center text-sm text-zinc-500">
                載入文章清單中…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-zinc-500">
                {query ? '找不到符合的文章' : '沒有可用的文章'}
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <ul className="py-1">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="flex items-start gap-3 w-full text-left px-4 py-2.5 hover:bg-zinc-800/70 transition-colors"
                    >
                      <FaFileAlt className="text-zinc-500 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-100 truncate">
                          {p.title}
                        </div>
                        {p.excerpt && (
                          <div className="text-xs text-zinc-500 truncate mt-0.5">
                            {p.excerpt}
                          </div>
                        )}
                      </div>
                      <code className="text-[10px] text-zinc-600 mt-1 shrink-0">/blog/{p.id}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="px-4 py-2 text-[11px] text-zinc-600 border-t border-zinc-800 flex items-center justify-between">
            <span>↑↓ 選擇 · Enter 選第一筆 · Esc 關閉</span>
            <span>{filtered.length} / {posts.length} 篇</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PostLinkModal;
