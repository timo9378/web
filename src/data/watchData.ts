import { queryOptions } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import type { AnimeRow, FilmRow, TvRow, WatchStatsResponse } from '@koimsurai/api-types';
import type { LiveNow, WatchFavorite } from '@/components/media/Watch';

// 在看什麼頁資料改由 TanStack Query 管理。loader 用 prefetchQuery 預取這 4 個（SSR baked）。
// liveNow（正在看，30 秒輪詢）與 favorites（依 UI 語系）刻意不進 loader，client 自己抓。
const STALE = 5 * 60 * 1000;
const LIVE_REFRESH = 30 * 1000;

export const animeHistoryQueryOptions = queryOptions({
  queryKey: ['watch', 'anime-history'],
  queryFn: async (): Promise<AnimeRow[]> => {
    const res = await fetch(apiUrl('/api/anime/history?limit=200'));
    if (!res.ok) throw new Error(`GET /api/anime/history ${res.status}`);
    const data = (await res.json()) as { history?: AnimeRow[] };
    return data.history ?? [];
  },
  staleTime: STALE,
});

export const filmsQueryOptions = queryOptions({
  queryKey: ['watch', 'films'],
  queryFn: async (): Promise<FilmRow[]> => {
    const res = await fetch(apiUrl('/api/films/recent?limit=20'));
    if (!res.ok) throw new Error(`GET /api/films/recent ${res.status}`);
    const data = (await res.json()) as { films?: FilmRow[] };
    return data.films ?? [];
  },
  staleTime: STALE,
});

export const seriesQueryOptions = queryOptions({
  queryKey: ['watch', 'tv'],
  queryFn: async (): Promise<TvRow[]> => {
    const res = await fetch(apiUrl('/api/tv/recent?limit=20'));
    if (!res.ok) throw new Error(`GET /api/tv/recent ${res.status}`);
    const data = (await res.json()) as { series?: TvRow[] };
    return data.series ?? [];
  },
  staleTime: STALE,
});

export const watchStatsQueryOptions = queryOptions({
  queryKey: ['watch', 'stats'],
  queryFn: async (): Promise<WatchStatsResponse> => {
    const res = await fetch(apiUrl('/api/watch/stats'));
    if (!res.ok) throw new Error(`GET /api/watch/stats ${res.status}`);
    return (await res.json()) as WatchStatsResponse;
  },
  staleTime: STALE,
});

// 藏書庫頁（/watch/library）：要全量做前端搜尋/排序/跨源去重，limit 拉大，另開 queryKey
// 避免和「在看什麼」頁的 recent（limit 小）互相污染快取。同樣 consume 生成的 row 型別。
export const animeLibraryQueryOptions = queryOptions({
  queryKey: ['watch', 'anime-library'],
  queryFn: async (): Promise<AnimeRow[]> => {
    const res = await fetch(apiUrl('/api/anime/history?limit=2000'));
    if (!res.ok) throw new Error(`GET /api/anime/history ${res.status}`);
    const data = (await res.json()) as { history?: AnimeRow[] };
    return data.history ?? [];
  },
  staleTime: STALE,
});

export const filmsLibraryQueryOptions = queryOptions({
  queryKey: ['watch', 'films-library'],
  queryFn: async (): Promise<FilmRow[]> => {
    const res = await fetch(apiUrl('/api/films/recent?limit=200'));
    if (!res.ok) throw new Error(`GET /api/films/recent ${res.status}`);
    const data = (await res.json()) as { films?: FilmRow[] };
    return data.films ?? [];
  },
  staleTime: STALE,
});

export const tvLibraryQueryOptions = queryOptions({
  queryKey: ['watch', 'tv-library'],
  queryFn: async (): Promise<TvRow[]> => {
    const res = await fetch(apiUrl('/api/tv/recent?limit=200'));
    if (!res.ok) throw new Error(`GET /api/tv/recent ${res.status}`);
    const data = (await res.json()) as { series?: TvRow[] };
    return data.series ?? [];
  },
  staleTime: STALE,
});

// liveNow：30 秒輪詢；不進 loader。失敗回 null（對齊舊 poll 的 catch）。
export const liveNowQueryOptions = queryOptions({
  queryKey: ['watch', 'now'],
  queryFn: async (): Promise<LiveNow | null> => {
    try {
      const res = await fetch(apiUrl('/api/watch/now'));
      const data = (await res.json()) as { watching?: LiveNow | null };
      return data.watching ?? null;
    } catch {
      return null;
    }
  },
  staleTime: 0,
  refetchInterval: LIVE_REFRESH,
});

// favorites 依 UI 語系抓；編輯後 invalidateQueries(['watch','favorites']) 重抓。
export const watchFavoritesQueryOptions = (locale: string) =>
  queryOptions({
    queryKey: ['watch', 'favorites', locale],
    queryFn: async (): Promise<WatchFavorite[]> => {
      const res = await fetch(apiUrl(`/api/watch/favorites?locale=${encodeURIComponent(locale)}`));
      if (!res.ok) throw new Error(`GET /api/watch/favorites ${res.status}`);
      const data = (await res.json()) as { favorites?: WatchFavorite[] };
      return data.favorites ?? [];
    },
    staleTime: 0,
  });
