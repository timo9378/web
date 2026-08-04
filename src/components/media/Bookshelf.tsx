import { useState, useEffect, useMemo, useRef, lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaStar, FaStarHalfAlt, FaBook, FaSearch, FaFilter, FaTimes } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BookRow } from '@koimsurai/api-types';
import { booksQueryOptions, bookStatsQueryOptions } from '@/data/bookshelfData';

// 3D 圖書館用 lazy import:three.js/R3F 只在 client 切到 3D 模式時才動態載入,
// 完全不進 server bundle / SSR render(避免每個請求白跑 three.js 的伺服器負擔)。
const ZeroGravityLibrary = lazy(() => import('./ZeroGravityLibrary'));
import './Bookshelf.css';

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

// 書封走後端 image-proxy：① 把 http://books.google.com 升 https（去掉 mixed-content 警告）
// ② 變成同源資源，crossOrigin canvas 取色才不會被 CORS 擋（Google Books 不送 CORS header）。
const proxiedCover = (url?: string): string =>
  url ? `${API_URL}/image-proxy?url=${encodeURIComponent(url)}` : '';

interface RGB { r: number; g: number; b: number }

/** `GET /api/books` 的單本，型別由後端 Rust struct 生成（見 backend/SPECTA_PLAN.md）。 */
export type Book = BookRow;

export interface BookStats {
  total_books: number;
  books_read: number;
  books_reading: number;
  average_rating?: number;
}

/* ── Extract dominant color from an image for cover glow ── */
const extractDominantColor = (imgSrc?: string): Promise<RGB> =>
  new Promise<RGB>((resolve) => {
    const fallback: RGB = { r: 127, g: 90, b: 240 };
    if (!imgSrc) return resolve(fallback);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 50;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(fallback);
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          if (brightness > 30 && brightness < 230) { rSum += r; gSum += g; bSum += b; count++; }
        }
        if (count === 0) return resolve(fallback);
        resolve({ r: Math.round(rSum / count), g: Math.round(gSum / count), b: Math.round(bSum / count) });
      } catch { resolve(fallback); }
    };
    img.onerror = () => resolve(fallback);
    img.src = imgSrc;
  });

/* ── Book card with cover-glow ── */
const BookCard = ({ book, delay, onClick, getStatusBadge, renderStars }: {
  book: Book;
  delay: number;
  onClick: () => void;
  getStatusBadge: (status?: string | null) => { text: string; color: string };
  renderStars: (rating?: number | null) => ReactNode;
}) => {
  const [glowColor, setGlowColor] = useState<RGB | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (book.cover_url) {
      void extractDominantColor(proxiedCover(book.cover_url)).then(setGlowColor);
    }
  }, [book.cover_url]);

  const style: CSSProperties | undefined = glowColor
    ? { '--cover-r': glowColor.r, '--cover-g': glowColor.g, '--cover-b': glowColor.b } as CSSProperties
    : undefined;

  return (
    <motion.div
      className="book-card"
      style={style}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 200 }}
      onClick={onClick}
    >
      <div className="book-cover-wrapper">
        {book.cover_url ? (
          <img ref={imgRef} src={proxiedCover(book.cover_url)} alt={book.title} className="book-cover" loading="lazy" />
        ) : (
          <div className="book-cover-placeholder"><FaBook /></div>
        )}
        <div className="status-badge" style={{ backgroundColor: getStatusBadge(book.reading_status).color }}>
          {getStatusBadge(book.reading_status).text}
        </div>
      </div>
      <div className="book-info">
        {/* h2 不是 h3：每張書卡是頁面 h1 底下的項目，中間沒有區塊標題，
          h3 會跳級（axe: heading-order）。class 保留，樣式不動。
          注意 456/463 那兩個 h3（簡介／個人筆記）是**對的**——它們在 modal 裡，
          上面有 h2（書名），不要一起改。 */}
        <h2 className="book-title">{book.title}</h2>
        {book.authors && <p className="book-author">{book.authors}</p>}
        {renderStars(book.rating)}
      </div>
    </motion.div>
  );
};

const Bookshelf = () => {
  const { t } = useTranslation();
  // 資料改由 TanStack Query 管理：route loader 已 ensureQueryData 預取 → SSR 首屏 baked、
  // hydrate 後 useQuery 讀同一份快取（不重抓）；15 分鐘輪詢 = queryOptions 的 refetchInterval。
  const { data: books = [], isPending } = useQuery(booksQueryOptions);
  const { data: stats = null } = useQuery(bookStatsQueryOptions);
  const loading = isPending;
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_added_desc');
  const [showFilters, setShowFilters] = useState(false);
  const [is3DMode, setIs3DMode] = useState(false);

  // filteredBooks 完全由 books + 四個篩選條件推導 —— 是衍生值不是狀態。
  // 原本用 useEffect + setState：每次條件變動都要先繪一次舊清單、effect 再補繪一次，
  // 而且中間那一幀顯示的是過期資料。改成 render 期計算就沒有這個窗口。
  const filteredBooks = useMemo(() => {
    let filtered = [...books];

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(book =>
        book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (book.authors?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(book => book.reading_status === statusFilter);
    }

    // Rating filter
    if (ratingFilter !== 'all') {
      filtered = filtered.filter(book => book.rating === parseInt(ratingFilter, 10));
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date_added_asc':
          return new Date(a.date_added ?? '').getTime() - new Date(b.date_added ?? '').getTime();
        case 'date_added_desc':
          return new Date(b.date_added ?? '').getTime() - new Date(a.date_added ?? '').getTime();
        case 'title_asc':
          return a.title.localeCompare(b.title);
        case 'title_desc':
          return b.title.localeCompare(a.title);
        case 'rating_desc':
          return (b.rating ?? 0) - (a.rating ?? 0);
        case 'published_date_desc':
          return (b.published_date ?? '').localeCompare(a.published_date ?? '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [books, searchTerm, statusFilter, ratingFilter, sortBy]);

  const getStatusBadge = (status?: string | null) => {
    const badges: Record<'read' | 'reading' | 'to-read', { text: string; color: string }> = {
      'read': { text: t('bookshelf.statuses.read'), color: '#10b981' },
      'reading': { text: t('bookshelf.statuses.reading'), color: '#3b82f6' },
      'to-read': { text: t('bookshelf.statuses.toRead'), color: '#f59e0b' }
    };
    const key = status === 'read' || status === 'reading' || status === 'to-read' ? status : 'to-read';
    return badges[key];
  };

  const renderStars = (rating?: number | null) => {
    if (rating === null || rating === undefined) return <span className="no-rating">{t('bookshelf.noRating')}</span>;
    const stars: ReactNode[] = [];
    const numRating = rating;

    for (let i = 1; i <= 5; i++) {
      if (numRating >= i) {
        stars.push(<FaStar key={i} className="star-filled" />);
      } else if (numRating >= i - 0.5) {
        stars.push(<FaStarHalfAlt key={i} className="star-filled" />);
      } else {
        stars.push(<FaStar key={i} className="star-empty" />);
      }
    }
    return <div className="stars">{stars}</div>;
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setRatingFilter('all');
    setSortBy('date_added_desc');
  };

  if (loading) {
    return (
      <div className="bookshelf-container">
        <div className="loading-spinner">
          <FaBook className="spinning-book" />
          <p>{t('bookshelf.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bookshelf-container">
      {/* ── Nebula Background ── */}
      <div className="bookshelf-dim-overlay" />
      <div className="bookshelf-nebula-bg">
        <div className="nebula-layer bs-nebula-1" />
        <div className="nebula-layer bs-nebula-2" />
        <div className="nebula-layer bs-nebula-3" />
      </div>

      {/* ── Content ── */}
      <div className="bookshelf-content-wrapper">
        {/* Hero Header */}
        <motion.div
          className="bookshelf-header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="bookshelf-title">
            <span className="bs-title-gradient">{t('bookshelf.heroTitle')}</span>
            <span className="bs-title-sub">Knowledge Constellation</span>
          </h1>
          <p className="bookshelf-subtitle">{t('bookshelf.subtitle')}</p>

          {/* Stats Strip */}
          {stats && (
            <div className="stats-strip">
              <div className="stats-strip-item">
                <div className="stats-strip-value">{stats.total_books}</div>
                <div className="stats-strip-label">{t('bookshelf.stats.total')}</div>
              </div>
              <div className="stats-strip-item">
                <div className="stats-strip-value">{stats.books_read}</div>
                <div className="stats-strip-label">{t('bookshelf.stats.read')}</div>
              </div>
              <div className="stats-strip-item">
                <div className="stats-strip-value">{stats.books_reading}</div>
                <div className="stats-strip-label">{t('bookshelf.stats.reading')}</div>
              </div>
              <div className="stats-strip-item">
                <div className="stats-strip-value">{stats.average_rating ? `${stats.average_rating}★` : '—'}</div>
                <div className="stats-strip-label">{t('bookshelf.stats.avgRating')}</div>
              </div>
            </div>
          )}
        </motion.div>

      {/* Search and Filter Bar */}
      <motion.div
        className="search-filter-bar"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <div className="search-box">
          <FaSearch className="search-icon" />
          <input
            type="text"
            placeholder={t('bookshelf.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          {searchTerm && (
            <button className="clear-search" onClick={() => setSearchTerm('')}>
              <FaTimes />
            </button>
          )}
        </div>

        <button
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
        >
          <FaFilter /> {t('bookshelf.filter')}
        </button>

        <button
          className="view-mode-toggle"
          onClick={() => setIs3DMode(!is3DMode)}
        >
          {is3DMode ? t('bookshelf.twoDView') : `🌌 ${t('bookshelf.zeroGravity')}`}
        </button>
      </motion.div>

      {/* Filter Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            className="filter-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="filter-group">
              <label>{t('bookshelf.filterStatus')}</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">{t('common.all')}</option>
                <option value="read">{t('bookshelf.statuses.read')}</option>
                <option value="reading">{t('bookshelf.statuses.reading')}</option>
                <option value="to-read">{t('bookshelf.statuses.toRead')}</option>
              </select>
            </div>

            <div className="filter-group">
              <label>{t('bookshelf.filterRating')}</label>
              <select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
                <option value="all">{t('common.all')}</option>
                <option value="5">⭐⭐⭐⭐⭐</option>
                <option value="4">⭐⭐⭐⭐</option>
                <option value="3">⭐⭐⭐</option>
                <option value="2">⭐⭐</option>
                <option value="1">⭐</option>
              </select>
            </div>

            <div className="filter-group">
              <label>{t('bookshelf.filterSort')}</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="date_added_desc">{t('bookshelf.sortOpts.dateAddedDesc')}</option>
                <option value="date_added_asc">{t('bookshelf.sortOpts.dateAddedAsc')}</option>
                <option value="title_asc">{t('bookshelf.sortOpts.titleAsc')}</option>
                <option value="title_desc">{t('bookshelf.sortOpts.titleDesc')}</option>
                <option value="rating_desc">{t('bookshelf.sortOpts.ratingDesc')}</option>
                <option value="published_date_desc">{t('bookshelf.sortOpts.publishedDateDesc')}</option>
              </select>
            </div>

            <button className="clear-filters" onClick={clearFilters}>
              {t('bookshelf.filterClear')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Books Grid */}
      <motion.div
        className="books-grid"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {filteredBooks.length === 0 ? (
          <div className="no-books">
            <FaBook className="no-books-icon" />
            <p>目前沒有符合條件的書籍</p>
          </div>
        ) : (
          filteredBooks.map((book, i) => (
            <BookCard
              key={book.id}
              book={book}
              delay={i * 0.04}
              onClick={() => setSelectedBook(book)}
              getStatusBadge={getStatusBadge}
              renderStars={renderStars}
            />
          ))
        )}
      </motion.div>
      </div>{/* end bookshelf-content-wrapper */}

      {/* Book Detail Modal */}
      <AnimatePresence>
        {selectedBook && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedBook(null)}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setSelectedBook(null)}>
                <FaTimes />
              </button>

              <div className="modal-body">
                <div className="modal-cover">
                  {selectedBook.cover_url ? (
                    <img src={proxiedCover(selectedBook.cover_url)} alt={selectedBook.title} />
                  ) : (
                    <div className="modal-cover-placeholder">
                      <FaBook />
                    </div>
                  )}
                </div>

                <div className="modal-details">
                  <h2>{selectedBook.title}</h2>
                  
                  {selectedBook.authors && (
                    <p className="modal-author">作者: {selectedBook.authors}</p>
                  )}

                  <div className="modal-meta">
                    {selectedBook.publisher && (
                      <div className="meta-item">
                        <strong>出版社:</strong> {selectedBook.publisher}
                      </div>
                    )}
                    {selectedBook.published_date && (
                      <div className="meta-item">
                        <strong>出版日期:</strong> {selectedBook.published_date}
                      </div>
                    )}
                    {selectedBook.page_count && (
                      <div className="meta-item">
                        <strong>頁數:</strong> {selectedBook.page_count}
                      </div>
                    )}
                    {selectedBook.isbn && (
                      <div className="meta-item">
                        <strong>ISBN:</strong> {selectedBook.isbn}
                      </div>
                    )}
                  </div>

                  <div className="modal-status-rating">
                    <div
                      className="modal-status-badge"
                      style={{ backgroundColor: getStatusBadge(selectedBook.reading_status).color }}
                    >
                      {getStatusBadge(selectedBook.reading_status).text}
                    </div>
                    {renderStars(selectedBook.rating)}
                  </div>

                  {selectedBook.description && (
                    <div className="modal-description">
                      <h3>簡介</h3>
                      <p>{selectedBook.description}</p>
                    </div>
                  )}

                  {selectedBook.personal_notes && (
                    <div className="modal-notes">
                      <h3>個人筆記</h3>
                      <p>{selectedBook.personal_notes}</p>
                    </div>
                  )}

                  {(selectedBook.date_started ?? selectedBook.date_finished) && (
                    <div className="modal-dates">
                      {selectedBook.date_started && (
                        <p><strong>開始閱讀:</strong> {new Date(selectedBook.date_started).toLocaleDateString('zh-TW')}</p>
                      )}
                      {selectedBook.date_finished && (
                        <p><strong>完成閱讀:</strong> {new Date(selectedBook.date_finished).toLocaleDateString('zh-TW')}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3D 零重力圖書館(client-only,lazy)*/}
      {is3DMode && (
        <Suspense fallback={null}>
        <ZeroGravityLibrary
          books={filteredBooks.map(book => ({
            id: book.id,
            title: book.title,
            authors: book.authors ? book.authors.split(',') : [],
            // 生成型別是 `| null`（serde 語意）；ZGL 的介面用 optional，`?? undefined` 橋接。
            coverUrl: book.cover_url ?? undefined,
            description: book.description ?? undefined,
            publishedDate: book.published_date ?? undefined,
            pageCount: book.page_count ?? undefined,
          }))}
          onClose={() => setIs3DMode(false)}
        />
        </Suspense>
      )}
    </div>
  );
};

export default Bookshelf;
