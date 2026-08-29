import { useEffect, useState, useMemo, useRef } from 'react';
import { dedupeWatchItems, filterAndSortWatchItems } from '@/lib/mediaLists';
import { useQuery } from '@tanstack/react-query';
import { LocaleLink } from '@/i18n/locale-link';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { FaSearch, FaChevronDown } from 'react-icons/fa';
import type { AnimeRow, FilmRow, TvRow } from '@koimsurai/api-types';
import { animeLibraryQueryOptions, filmsLibraryQueryOptions, tvLibraryQueryOptions } from '@/data/watchData';
import './WatchLibrary.css';

/* ──────────────────────────────────────────────────────────────
   /watch/library — 完整清單（Bookshelf 風，3 tab：動畫 / 電影 / 影集）
   依賴：/api/anime/history、/api/films/recent、/api/tv/recent（TanStack Query 管理）
─────────────────────────────────────────────────────────────── */

type WatchType = 'anime' | 'film' | 'tv';

interface WatchItem {
  id: string;
  type: WatchType;
  title: string;
  poster?: string;
  isoDate?: string;
  episode?: number | string;
  epCount?: number;
  year?: number | string;
  tmdbId?: number | string | null;
  genres?: string;
  externalUrl?: string | null;
}

const reveal = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

/* ── normalize 三條源到同一個 shape ────────────────────────── */
function normalizeAnime(rows?: AnimeRow[]): WatchItem[] {
  // group by anime_sn，每部一筆
  const byAnime = new Map<number | string, AnimeRow[]>();
  for (const r of rows ?? []) {
    const arr = byAnime.get(r.anime_sn);
    if (arr) arr.push(r);
    else byAnime.set(r.anime_sn, [r]);
  }
  return [...byAnime.values()].map((eps) => {
    const sorted = eps.slice().sort((a, b) => (b.last_watched_at ?? '').localeCompare(a.last_watched_at ?? ''));
    const head = sorted[0];
    // tmdb_id 取「該動畫任一筆有值的」— 最新集數常是剛同步、還沒 enrich 的 NULL
    const tmdbId = head.tmdb_id ?? eps.find((e) => e.tmdb_id != null)?.tmdb_id ?? null;
    return {
      id: `a${head.anime_sn}`,
      type: 'anime' as const,
      // 生成 AnimeRow 為 nullable（DB 可 null）→ WatchItem 的 title 必填、poster/episode optional，橋接。
      title: head.title ?? '',
      poster: head.cover_url ?? undefined,
      isoDate: (head.last_watched_at ?? '').slice(0, 10),
      episode: head.episode ?? undefined,
      epCount: eps.length,
      tmdbId,
      // 連結走 TMDb（動畫算 TV）；尚未 enrich 就退到 TMDb 搜尋頁
      externalUrl: tmdbId
        ? `https://www.themoviedb.org/tv/${tmdbId}`
        : `https://www.themoviedb.org/search?query=${encodeURIComponent(head.title ?? '')}`,
    };
  });
}

function normalizeFilms(rows?: FilmRow[]): WatchItem[] {
  return (rows ?? []).map((f) => ({
    id: `f${f.id}`,
    type: 'film' as const,
    title: f.title,
    poster: f.poster_url ?? undefined,
    isoDate: f.watched_date ?? undefined,
    year: f.release_year ?? undefined,
    tmdbId: f.tmdb_id,
    genres: f.genres ?? undefined,
    externalUrl: f.tmdb_id ? `https://www.themoviedb.org/movie/${f.tmdb_id}` : null,
  }));
}

function normalizeTv(rows?: TvRow[]): WatchItem[] {
  return (rows ?? []).map((s) => ({
    id: `t${s.series_name}`,
    type: 'tv' as const,
    title: s.series_name,
    poster: s.poster_url ?? undefined,
    isoDate: s.last_watched ?? undefined,
    epCount: s.ep_count,
    tmdbId: s.tmdb_id,
    genres: s.genres ?? undefined,
    externalUrl: s.tmdb_id ? `https://www.themoviedb.org/tv/${s.tmdb_id}` : null,
  }));
}

const SORT_OPTIONS = ['newest', 'oldest', 'titleAsc', 'titleDesc'];

interface WatchItems {
  anime: WatchItem[] | null;
  film: WatchItem[] | null;
  tv: WatchItem[] | null;
}

function WatchLibrary() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WatchType>('anime');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  // 三源改由 TanStack Query 讀（library limit 版）；items / loading / err 由 query 結果 derive。
  const animeQ = useQuery(animeLibraryQueryOptions);
  const filmsQ = useQuery(filmsLibraryQueryOptions);
  const tvQ = useQuery(tvLibraryQueryOptions);
  const items = useMemo<WatchItems>(
    () => ({
      anime: animeQ.data ? normalizeAnime(animeQ.data) : null,
      film: filmsQ.data ? normalizeFilms(filmsQ.data) : null,
      tv: tvQ.data ? normalizeTv(tvQ.data) : null,
    }),
    [animeQ.data, filmsQ.data, tvQ.data],
  );
  const loading = animeQ.isPending || filmsQ.isPending || tvQ.isPending;
  const err = animeQ.isError || filmsQ.isError || tvQ.isError ? '載入失敗' : null;

  // close sort popup on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
    };
  }, [sortOpen]);

  // 跨「動畫(Bahamut)/影集(Netflix/Trakt)」去重：同 tmdb_id 視為同一部，保留集數最多的那筆。
  // 沒 tmdb_id 的不去重（避免用名字誤殺劇場版/相似名）。
  // 跨來源去重是純邏輯，抽在 lib/mediaLists.ts（含「沒 tmdbId 不去重」的理由）。
  const deduped = useMemo(() => {
    const { anime, tv } = dedupeWatchItems(items.anime ?? [], items.tv ?? []);
    return { anime: items.anime ? anime : null, film: items.film, tv: items.tv ? tv : null };
  }, [items]);

  const visible = useMemo(() => {
    // 搜尋與排序同樣抽在 lib/mediaLists.ts。
    return filterAndSortWatchItems(deduped[activeTab] ?? [], search, sortBy);
  }, [deduped, activeTab, search, sortBy]);

  const counts = {
    anime: deduped.anime?.length ?? 0,
    film: deduped.film?.length ?? 0,
    tv: deduped.tv?.length ?? 0,
  };

  return (
    <div className="wl-page">
      <div className="wl-scrim" />

      <div className="wl-wrap">
        <motion.header className="wl-header" {...reveal}>
          <LocaleLink to="/watch" className="wl-back">
            {t('watch.library.viewWatch')}
          </LocaleLink>
          <h1 className="wl-title">{t('watch.library.title')}</h1>
          <p className="wl-subtitle">{t('watch.library.subtitle')}</p>
        </motion.header>

        {/* tabs */}
        <div className="wl-tabs">
          {(['anime', 'film', 'tv'] as const).map((k) => (
            <button key={k} className={`wl-tab ${activeTab === k ? 'active' : ''}`} onClick={() => setActiveTab(k)}>
              {t(`watch.library.tabs.${k}`)}
              <span className="wl-tab-count">{counts[k]}</span>
            </button>
          ))}
        </div>

        {/* controls */}
        <div className="wl-controls">
          <label className="wl-search">
            <FaSearch />
            <input
              type="text"
              placeholder={t('watch.library.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="wl-sort" ref={sortRef}>
            <button
              type="button"
              className="wl-sort-trigger"
              onClick={() => setSortOpen((o) => !o)}
              aria-expanded={sortOpen}
            >
              <span>{t(`watch.library.sort.${sortBy}`)}</span>
              <FaChevronDown className={`wl-sort-chev${sortOpen ? ' is-open' : ''}`} />
            </button>
            <AnimatePresence>
              {sortOpen && (
                <motion.ul
                  className="wl-sort-menu"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <li key={opt}>
                      <button
                        type="button"
                        className={`wl-sort-item${sortBy === opt ? ' active' : ''}`}
                        onClick={() => {
                          setSortBy(opt);
                          setSortOpen(false);
                        }}
                      >
                        {t(`watch.library.sort.${opt}`)}
                      </button>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* grid */}
        {loading && <p className="wl-info">{t('watch.library.loading')}</p>}
        {err && <p className="wl-info wl-info--err">⚠️ {err}</p>}
        {!loading && !err && visible.length === 0 && <p className="wl-info">{t('watch.library.empty')}</p>}

        {!loading && visible.length > 0 && (
          <div className="wl-grid">
            {visible.map((it) => (
              <a
                key={it.id}
                href={it.externalUrl ?? '#'}
                target={it.externalUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="wl-card"
              >
                <div className="wl-card-poster">
                  {it.poster ? (
                    <img src={it.poster} alt={it.title} loading="lazy" />
                  ) : (
                    <div className="wl-card-placeholder">
                      {it.type === 'anime' ? '🌸' : it.type === 'film' ? '🎬' : '📺'}
                    </div>
                  )}
                </div>
                <div className="wl-card-meta">
                  <p className="wl-card-title">{it.title}</p>
                  <p className="wl-card-sub">
                    {it.type === 'film' && it.year ? <span>{it.year}</span> : null}
                    {it.type === 'tv' && it.epCount ? (
                      <span>
                        {it.epCount} {t('watch.library.epsSuffix')}
                      </span>
                    ) : null}
                    {it.type === 'anime' && it.epCount ? (
                      <span>
                        {it.epCount} {t('watch.library.epsSuffix')}
                      </span>
                    ) : null}
                    <span className="wl-card-date">{it.isoDate ?? t('watch.library.undated')}</span>
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WatchLibrary;
