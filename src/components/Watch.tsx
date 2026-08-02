import { useState, useMemo, useEffect, type ElementType, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnimeRow, NowWatching, WatchFavoriteRow } from '@koimsurai/api-types';
import { LocaleLink } from '../locale-link';
import { useLocaleNavigate } from '../lib/useLocale';
import {
  animeHistoryQueryOptions,
  filmsQueryOptions,
  seriesQueryOptions,
  watchStatsQueryOptions,
  liveNowQueryOptions,
  watchFavoritesQueryOptions,
} from '../watchData';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth';
import FavoritesEditor from './FavoritesEditor';
import './Watch.css';
import { lookupOr } from '../lib/tableLookup';

/* ──────────────────────────────────────────────────────────────
   在看什麼 — 編輯風「品味展示」
─────────────────────────────────────────────────────────────── */


type WatchType = 'anime' | 'film' | 'tv';

interface WatchEntry {
  id?: string;
  type: WatchType;
  title: string;
  poster?: string;
  // 橫式劇照——只有 film 會帶（後端 films_recent 補），給「最近看完」hero 填滿寬幅橫幅用。
  backdrop?: string;
  isoDate?: string;
  date?: string;
  episode?: number | string;
  epCount?: number;
  year?: number | string;
  tmdbId?: number | string | null;
  externalUrl?: string | null;
  animeSn?: number | string;
  videoSn?: number | string;
}

// AnimeRow/FilmRow/TvRow/WatchStatsResponse 改由後端 specta 生成（見 backend/SPECTA_PLAN.md）。
// LiveNow（watch/now 即時狀態，動態組）與 WatchFavorite（favorites TMDb 在地化）維持手寫（非 row_to_json 端點）。
// 改吃後端 specta 生成的型別（backend handlers::watch::NowWatching）。
// 手寫那份把大半欄位標成可選、episode 還標成 number | string —— 實際上後端的寫入點
// （動畫瘋擴充的 heartbeat；Trakt 輪詢那條已移除）給的是字串，
// title/source/type/startedAt 也一定在。
export type LiveNow = NowWatching;
// 改吃後端 specta 生成的型別（backend handlers::watch::WatchFavoriteRow）。
// 手寫那份少了 kind / tmdbId 兩個欄位，rating 標成必填（DB 允許 NULL），
// externalUrl 標成可選（實際上一定有，是 format! 組出來的）。
export type WatchFavorite = WatchFavoriteRow;

/* 連結通通走 TMDb */
const tmdbUrl = (kind: string, id?: number | string | null): string | null =>
  id ? `https://www.themoviedb.org/${kind === 'film' || kind === 'movie' ? 'movie' : 'tv'}/${id}` : null;

const dedupeByTmdb = (items: WatchEntry[]): WatchEntry[] => {
  const byKey = new Map<string, number>();
  const out: WatchEntry[] = [];
  for (const it of items) {
    if (it.tmdbId == null) { out.push(it); continue; }
    const key = `${it.type === 'film' ? 'm' : 't'}:${it.tmdbId}`;
    const idx = byKey.get(key);
    if (idx == null) { byKey.set(key, out.length); out.push(it); }
    else if ((it.epCount ?? 0) > (out[idx].epCount ?? 0)) out[idx] = it; // 留集數多的
  }
  return out;
};

const EP_LABEL: Record<string, string> = {
  'zh-TW': '第 {{n}} 集', 'zh-CN': '第 {{n}} 集', en: 'Ep. {{n}}', ja: '第 {{n}} 話', ko: '{{n}}화',
};
const SERVICE_LABEL: Record<string, string> = {
  'zh-TW': '動畫瘋', 'zh-CN': '动画疯', en: 'Bahamut Anime', ja: '動畫瘋', ko: '動畫瘋',
};
const interpolate = (tpl: string, vars: Record<string, string | number | undefined>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));

/* short date formatter: '2026-02-07' → '2/7' */
const toShortDate = (iso?: string | null): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}` : '';
};

const reveal = {
  initial: { opacity: 0, y: 26, filter: 'blur(8px)' },
  whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

const Stars = ({ n }: { n: number }) => (
  <span className="w-stars">{'★'.repeat(n)}<span className="w-stars-dim">{'★'.repeat(5 - n)}</span></span>
);

const parseAnimeDate = (raw?: string | null): { isoDate: string; shortDate: string } => {
  if (!raw) return { isoDate: '', shortDate: '' };
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return { isoDate: '', shortDate: '' };
  return { isoDate: d.toISOString().slice(0, 10), shortDate: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
};

const groupByWeek = (items: WatchEntry[]): { thisWeek: WatchEntry[]; earlier: WatchEntry[] } => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const thisWeek: WatchEntry[] = [], earlier: WatchEntry[] = [];
  for (const item of items) {
    const d = item.isoDate ? new Date(item.isoDate) : null;
    if (d && d >= cutoff) thisWeek.push(item); else earlier.push(item);
  }
  return { thisWeek, earlier };
};

function Watch() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'zh-TW';
  // 資料改由 TanStack Query 管理：route loader 已 prefetch anime/films/tv/stats（SSR baked）。
  // liveNow（30 秒輪詢即時狀態）與 favorites（依 UI 語系）不進 SSR、client 自己抓。
  const { data: animeHistory = null, error: animeError } = useQuery(animeHistoryQueryOptions);
  const { data: films = null } = useQuery(filmsQueryOptions);
  const { data: series = null } = useQuery(seriesQueryOptions);
  const { data: stats = null } = useQuery(watchStatsQueryOptions);
  const { data: liveNow = null, dataUpdatedAt: liveNowUpdatedAt } = useQuery(liveNowQueryOptions);
  const { data: favorites = [] } = useQuery(watchFavoritesQueryOptions(lang));
  const err = animeError ? (animeError instanceof Error ? animeError.message : 'fetch failed') : null;

  // 進度條 client 端插值：兩次 30s 輪詢之間平滑推進（不加輪詢、不用 ws）。
  // **以後端快照 progressPct 為錨**（server 端算的、準）+ client 端「收到資料後流逝的 delta」
  // （用 useQuery 的 dataUpdatedAt 取 delta，而非絕對 startedAt）→ 免疫 client 時鐘偏差、
  // poll 當下值 100% 對齊後端。沒 startedAt/endsAt（bahamut 動畫）就退回靜態快照。
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  // 每秒跳動的計時器，set-state-in-effect 無解：改 useSyncExternalStore 會踩硬傷——
  // getSnapshot 含 Date.now() 時每次 render 都回傳新值 → React 判定變更 → 無限重繪。
  // 要避開就得自己做快照快取，machinery 比 setInterval + setState 還重。
  /* eslint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    if (!liveNow) { setLiveProgress(null); return; }
    const base = liveNow.progressPct;
    const s = liveNow.startedAt;
    const e = liveNow.endsAt;
    // startedAt 在生成型別裡是必填（兩個寫入點都一定給），只有 progressPct / endsAt 可能沒有
    if (base == null || e == null || e <= s) { setLiveProgress(base); return; }
    const durationMs = e - s;
    const compute = () => {
      const elapsed = Date.now() - liveNowUpdatedAt;
      setLiveProgress(Math.min(100, Math.max(0, base + (elapsed / durationMs) * 100)));
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
    /* eslint-enable @eslint-react/set-state-in-effect */
  }, [liveNow, liveNowUpdatedAt]);

  const [favEditing, setFavEditing] = useState(false);
  const { isAdmin } = useAuth();
  const navigate = useLocaleNavigate();
  const queryClient = useQueryClient();

  // FavoritesEditor 改動後重抓 favorites（所有語系版本）。
  const reloadFavorites = () => { void queryClient.invalidateQueries({ queryKey: ['watch', 'favorites'] }); };

  const shareToThinking = (item: WatchEntry | null) => {
    if (!item) return;
    const media = {
      tmdbId: item.tmdbId ?? null,
      mediaType: item.type === 'film' ? 'movie' : 'tv',
      kind: item.type === 'anime' ? '動畫' : item.type === 'film' ? '電影' : '影集',
      title: item.title,
      poster: item.poster,
    };
    try { sessionStorage.setItem('thinking_prefill', JSON.stringify(media)); } catch { /* ignore */ }
    void navigate('/thinking');
  };

  /* ── 從 anime_history 聚合成「每部動畫一筆」── */
  const { now, recentAnime } = useMemo<{ now: WatchEntry | null; recentAnime: WatchEntry[] }>(() => {
    if (!animeHistory || animeHistory.length === 0) {
      return { now: null, recentAnime: [] };
    }
    const byAnime = new Map<number | string, AnimeRow[]>();
    for (const row of animeHistory) {
      const arr = byAnime.get(row.anime_sn);
      if (arr) arr.push(row); else byAnime.set(row.anime_sn, [row]);
    }
    const grouped = [...byAnime.values()].map((eps) => {
      const sorted = eps.slice().sort((a, b) => (b.last_watched_at ?? '').localeCompare(a.last_watched_at ?? ''));
      const head = sorted[0];
      return {
        anime_sn: head.anime_sn,
        video_sn: head.video_sn,
        title: head.title,
        cover_url: head.cover_url,
        episode: head.episode,
        tmdbId: head.tmdb_id ?? eps.find((e) => e.tmdb_id != null)?.tmdb_id ?? null,
        lastWatchedAt: head.last_watched_at,
        epCount: eps.length,
      };
    });
    grouped.sort((a, b) => (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? ''));
    const head = grouped[0];
    const headParsed = parseAnimeDate(head.lastWatchedAt);
    return {
      now: {
        type: 'anime' as const,
        // 生成 AnimeRow 是 nullable（DB 欄位可為 null）→ WatchEntry 的 title 必填、poster/episode optional，橋接。
        poster: head.cover_url ?? undefined,
        title: head.title ?? '',
        animeSn: head.anime_sn,
        videoSn: head.video_sn,
        episode: head.episode ?? undefined,
        epCount: head.epCount,
        tmdbId: head.tmdbId,
        isoDate: headParsed.isoDate,
        date: headParsed.shortDate,
        externalUrl: tmdbUrl('tv', head.tmdbId)
          ?? `https://www.themoviedb.org/search?query=${encodeURIComponent(head.title ?? '')}`,
      },
      recentAnime: grouped.slice(1, 12).map((g) => {
        const { isoDate, shortDate } = parseAnimeDate(g.lastWatchedAt);
        return {
          id: `a${g.anime_sn}`,
          type: 'anime' as const,
          poster: g.cover_url ?? undefined,
          title: g.title ?? '',
          episode: g.episode ?? undefined,
          epCount: g.epCount,
          tmdbId: g.tmdbId,
          isoDate,
          date: shortDate,
          externalUrl: tmdbUrl('tv', g.tmdbId),
        };
      }),
    };
  }, [animeHistory]);

  const filmItems: WatchEntry[] = (films ?? []).map((f) => ({
    id: `f${f.id}`,
    type: 'film',
    title: f.title,
    // 生成型別是 `| null`；WatchEntry 用 optional → `?? undefined` 橋接。
    poster: f.poster_url ?? undefined,
    backdrop: f.backdrop_url ?? undefined,
    isoDate: f.watched_date ?? undefined,
    date: toShortDate(f.watched_date),
    year: f.release_year ?? undefined,
    tmdbId: f.tmdb_id,
    externalUrl: tmdbUrl('movie', f.tmdb_id),
  }));
  const tvItems: WatchEntry[] = (series ?? []).map((s) => ({
    id: `t${s.series_name}`,
    type: 'tv',
    title: s.series_name,
    poster: s.poster_url ?? undefined,
    isoDate: s.last_watched ?? undefined,
    date: toShortDate(s.last_watched),
    epCount: s.ep_count,
    tmdbId: s.tmdb_id,
    externalUrl: tmdbUrl('tv', s.tmdb_id),
  }));
  // 「最近看完」hero fallback：跨類型取最近一筆（動畫#1 / 電影#1 / 影集#1 比日期），
  // 不再只看動畫——否則看完 Trakt 電影，hero 仍顯示上一部動畫（史萊姆）。
  const recentMost: WatchEntry | null = [now, filmItems[0], tvItems[0]]
    .filter((e): e is WatchEntry => e != null)
    // .at(0) 而非 [0]：陣列索引在型別上永遠非空，?? null 會被判成多餘，
    // 而 recentMost 也就跟著被當成必然存在（下面的 hero fallback 判斷失去意義）。
    .sort((a, b) => (b.isoDate ?? '').localeCompare(a.isoDate ?? '')).at(0) ?? null;
  const recentAll = dedupeByTmdb([...recentAnime, ...filmItems, ...tvItems])
    .sort((a, b) => (b.isoDate ?? '').localeCompare(a.isoDate ?? ''))
    .slice(0, 14);
  const recentGrouped = groupByWeek(recentAll);

  const epTemplate = lookupOr(EP_LABEL, lang, EP_LABEL['zh-TW']);
  const renderRecentRow = (r: WatchEntry, prev?: WatchEntry): ReactElement => {
    const showDate = !prev || prev.date !== r.date;
    const Inner: ElementType = r.externalUrl ? 'a' : 'div';
    const linkProps = r.externalUrl
      ? { href: r.externalUrl, target: '_blank', rel: 'noopener noreferrer' }
      : {};
    return (
      <li className="w-recent-row" key={r.id}>
        <Inner
          className={'w-recent-link' + (showDate ? ' has-anchor' : '') + (r.externalUrl ? ' is-link' : '')}
          {...linkProps}
        >
          <span className="w-recent-anchor">{showDate ? r.date : ''}</span>
          <img className="w-recent-thumb" src={r.poster} alt={r.title} loading="lazy" />
          <span className="w-recent-title">{r.title}</span>
          <span className="w-recent-tags">
            {r.type === 'anime' && (
              <>
                <span className="w-recent-badge w-recent-badge--anime">{t('watch.typeAnime')}</span>
                {r.episode && <span className="w-recent-meta">{interpolate(epTemplate, { n: r.episode })}</span>}
              </>
            )}
            {r.type === 'film' && (
              <>
                <span className="w-recent-badge w-recent-badge--film">{t('watch.typeFilm')}</span>
                {r.year && <span className="w-recent-meta">{r.year}</span>}
              </>
            )}
            {r.type === 'tv' && (
              <>
                <span className="w-recent-badge w-recent-badge--tv">{t('watch.typeTv')}</span>
                {r.epCount && <span className="w-recent-meta">{interpolate(epTemplate, { n: r.epCount })}</span>}
              </>
            )}
          </span>
        </Inner>
      </li>
    );
  };

  const serviceLabel = lookupOr(SERVICE_LABEL, lang, SERVICE_LABEL['zh-TW']);
  const hero = liveNow
    ? {
        isLive: true,
        // liveNow 的封面只用它自己的 cover——不能 fallback 到 now（最近一部動畫），
        // 否則看 Trakt 電影卻顯示上一部動畫瘋番的封面（backend 已補 TMDb cover，這是防呆）。
        poster: liveNow.cover ?? null,
        title: liveNow.title,
        externalUrl: liveNow.externalUrl,
        progressPct: liveNow.progressPct,
        metaParts: [
          liveNow.episode ? interpolate(epTemplate, { n: liveNow.episode }) : null,
          liveNow.source === 'bahamut'
            ? serviceLabel
            : (liveNow.type === 'movie' ? t('watch.typeFilm') : t('watch.typeTv')),
        ].filter(Boolean),
      }
    : recentMost
      ? {
          isLive: false,
          // film 優先用橫式劇照填滿橫幅（poster 是直式會被裁+放大糊）；anime/tv 用自己的圖。
          poster: recentMost.backdrop ?? recentMost.poster ?? null,
          title: recentMost.title,
          externalUrl: recentMost.externalUrl,
          progressPct: null,
          metaParts: (
            recentMost.type === 'anime'
              ? [recentMost.episode ? interpolate(epTemplate, { n: recentMost.episode }) : null, serviceLabel]
              : recentMost.type === 'film'
                ? [t('watch.typeFilm'), recentMost.year != null ? String(recentMost.year) : null]
                : [t('watch.typeTv'), recentMost.epCount ? interpolate(epTemplate, { n: recentMost.epCount }) : null]
          ).concat(recentMost.date ?? null).filter(Boolean),
        }
      : null;

  return (
    <div className="w-page">
      <div className="w-scrim" />

      <div className="w-wrap">
        {/* header */}
        <motion.header className="w-header" {...reveal}>
          <h1 className="w-title">{t('watch.title')}</h1>
          <p className="w-subtitle">{t('watch.subtitle')}</p>

          <div className="w-stats">
            <div className="w-stat">
              <span className="w-stat-num">{stats?.animeCount ?? '—'}</span>
              <span className="w-stat-label">{t('watch.stats.animeLabel')}</span>
            </div>
            <div className="w-stat">
              <span className="w-stat-num">{stats?.filmCount ?? '—'}</span>
              <span className="w-stat-label">{t('watch.stats.filmLabel')}</span>
            </div>
            <div className="w-stat">
              <span className="w-stat-num">{stats?.tvSeriesCount ?? '—'}</span>
              <span className="w-stat-label">{t('watch.stats.tvLabel')}</span>
            </div>
          </div>
        </motion.header>

        {hero && (
          <motion.section className="w-now" {...reveal}>
            <a
              className={'w-now-banner' + (hero.isLive ? ' is-live' : '')}
              href={hero.externalUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              {hero.poster && <img className="w-now-banner-img" src={hero.poster} alt={hero.title} />}
              <div className="w-now-overlay">
                <span className={'w-eyebrow ' + (hero.isLive ? 'w-eyebrow--live' : 'w-eyebrow--last')}>
                  {hero.isLive ? t('watch.eyebrowLive') : t('watch.eyebrowLast')}
                </span>
                <h2 className="w-now-title">{hero.title}</h2>
                <p className="w-now-meta">{hero.metaParts.join(' · ')}</p>
              </div>
              <span className="w-now-cta">{t('watch.viewOnTmdb')} →</span>
              {hero.isLive && liveProgress != null && (
                <span className="w-now-progress" aria-hidden="true">
                  <span style={{ width: `${liveProgress}%` }} />
                </span>
              )}
            </a>
          </motion.section>
        )}

        {/* 一生推 */}
        <motion.section className="w-section" {...reveal}>
          <div className="w-h2-row">
            <div>
              <h2 className="w-h2">{t('watch.favoritesTitle')}</h2>
              <p className="w-h2-sub">{t('watch.favoritesSubtitle')}</p>
            </div>
            {isAdmin && (
              <button className="w-share-btn" onClick={() => setFavEditing(true)}>
                {t('watch.favManage')}
              </button>
            )}
          </div>
          <div className="w-favs">
            {favorites.map((f) => (
              <figure className="w-fav" key={f.id}>
                <a className="w-fav-poster" href={f.externalUrl} target="_blank" rel="noopener noreferrer">
                  {f.poster
                    ? <img src={f.poster} alt={f.title} loading="lazy" />
                    : <span className="w-fav-noposter">{f.title}</span>}
                  {f.quote && <figcaption className="w-fav-quote">「{f.quote}」</figcaption>}
                </a>
                <p className="w-fav-title">{f.title}</p>
                {/* rating 在 DB 允許 NULL（欄位是 `rating INTEGER DEFAULT 5`，沒有 NOT NULL） */}
                <p className="w-fav-line"><Stars n={f.rating ?? 0} /> <span className="w-fav-year">{f.year}</span></p>
              </figure>
            ))}
          </div>
        </motion.section>

        {favEditing && (
          <FavoritesEditor
            favorites={favorites}
            onClose={() => setFavEditing(false)}
            onChanged={reloadFavorites}
          />
        )}

        {/* 最近在看（依週分組） */}
        <motion.section className="w-section" {...reveal}>
          <div className="w-h2-row">
            <h2 className="w-h2">{t('watch.recentTitle')}</h2>
            <div className="w-h2-actions">
              {isAdmin && now && (
                <button className="w-share-btn" onClick={() => shareToThinking(now)}>＋ 發碎念</button>
              )}
              <LocaleLink to="/watch/library" className="w-section-link">
                {t('watch.library.title')} →
              </LocaleLink>
            </div>
          </div>
          {err && <p className="w-recent-err">⚠️ {err}</p>}
          {recentGrouped.thisWeek.length > 0 && (
            <>
              <h3 className="w-recent-group">{t('watch.recentGroups.thisWeek')}</h3>
              <ul className="w-recent">
                {recentGrouped.thisWeek.map((r, i) => renderRecentRow(r, recentGrouped.thisWeek[i - 1]))}
              </ul>
            </>
          )}
          {recentGrouped.earlier.length > 0 && (
            <>
              <h3 className="w-recent-group w-recent-group--dim">{t('watch.recentGroups.earlier')}</h3>
              <ul className="w-recent">
                {recentGrouped.earlier.map((r, i) => renderRecentRow(r, recentGrouped.earlier[i - 1]))}
              </ul>
            </>
          )}
        </motion.section>

        {/* 收尾 */}
        <motion.p className="w-ending" {...reveal}>
          {t('watch.ending')}
        </motion.p>
      </div>
    </div>
  );
}

export default Watch;
