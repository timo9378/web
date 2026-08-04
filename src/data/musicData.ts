import { queryOptions } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import type {
  RecentlyPlayedState,
  TopGenresState,
  TopTracksState,
  NowPlaying,
  AudioFeature,
} from '@/components/media/Music';
import type { AudioFeaturesResponse } from '@koimsurai/api-types';

// 音樂頁資料改由 TanStack Query 管理（取代 loader + 元件內 fetch + 兩個 setInterval）。
//
// Spotify 端點的 queryFn **不 throw**：{error, configured:false} 是合法的回應狀態
// （例如「未設定 Spotify」），元件會 render 它，所以當作資料回傳、不是失敗。
// 後端不通（catch）也回一份空 error-state，對齊舊 loadMusic 的行為（SSR 不擋頁）。
//
// now-playing 刻意不進 loader 預取：30 秒輪詢的即時狀態，烤進 SSR 只會是過期快照。
const STALE = 5 * 60 * 1000;
const DATA_REFRESH = 10 * 60 * 1000;
const NOW_PLAYING_REFRESH = 30 * 1000;

async function getState<T>(
  path: string,
  ok: (d: Record<string, unknown>) => T,
  bad: (msg: string) => T,
): Promise<T> {
  try {
    const res = await fetch(apiUrl(path));
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.error === 'string') return bad(data.error);
    return ok(data);
  } catch {
    return bad('');
  }
}

export const recentlyPlayedQueryOptions = queryOptions({
  queryKey: ['spotify', 'recently-played'],
  queryFn: () =>
    getState<RecentlyPlayedState>(
      '/api/spotify/recently-played',
      (d) => ({ tracks: (d.items as RecentlyPlayedState['tracks']) ?? [], configured: true }),
      (error) => ({ error, configured: false }),
    ),
  staleTime: STALE,
  refetchInterval: DATA_REFRESH,
});

export const topGenresQueryOptions = queryOptions({
  queryKey: ['spotify', 'top-genres'],
  queryFn: () =>
    getState<TopGenresState>(
      '/api/spotify/top-genres',
      (d) => ({ genres: (d.genres as TopGenresState['genres']) ?? [], configured: true }),
      (error) => ({ error, configured: false }),
    ),
  staleTime: STALE,
  refetchInterval: DATA_REFRESH,
});

export const topTracksQueryOptions = (range: string) =>
  queryOptions({
    queryKey: ['spotify', 'top-tracks', range],
    queryFn: () =>
      getState<TopTracksState>(
        `/api/spotify/top-tracks?time_range=${range}&limit=20`,
        (d) => ({ tracks: (d.items as TopTracksState['tracks']) ?? [], configured: true }),
        (error) => ({ error, configured: false }),
      ),
    staleTime: STALE,
  });

// now-playing：30 秒輪詢；不進 loader。失敗回 { is_playing:false }（對齊舊 fetchNowPlaying catch）。
export const nowPlayingQueryOptions = queryOptions({
  queryKey: ['spotify', 'now-playing'],
  queryFn: async (): Promise<NowPlaying> => {
    try {
      const res = await fetch(apiUrl('/api/spotify/now-playing'));
      return (await res.json()) as NowPlaying;
    } catch {
      // 欄位補齊：後端一律送出這三個 key（item/progress_ms 沒在播時是 null），
      // 前端的 fallback 也要維持同樣形狀，別讓型別分岔。
      return { is_playing: false, item: null, progress_ms: null };
    }
  },
  staleTime: 0,
  refetchInterval: NOW_PLAYING_REFRESH,
});

// audio-features：依當前分頁的可見曲目 id 抓（Spotify 2024/11 已停用，通常回 null）。
export const audioFeaturesQueryOptions = (ids: string[]) =>
  queryOptions({
    queryKey: ['spotify', 'audio-features', [...ids].sort()],
    // Partial 不是保守寫法而是事實：Spotify 2024/11 起 audio-features 多半回 null，
    // 這張表本來就不保證每個 id 都查得到。標成 Record<string, T> 會讓消費端的
    // `feat ? ... : ...` 看起來多餘，實際上非有不可。
    queryFn: async (): Promise<Partial<Record<string, AudioFeature>>> => {
      const res = await fetch(apiUrl(`/api/spotify/audio-features?ids=${ids.join(',')}`));
      const data = (await res.json()) as AudioFeaturesResponse;
      const map: Partial<Record<string, AudioFeature>> = {};
      data.audio_features.forEach((f) => {
        if (f) map[f.id] = f;
      });
      return map;
    },
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
