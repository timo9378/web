import { queryOptions } from '@tanstack/react-query';
import type { DigestResponse, StatsResponse } from '@koimsurai/api-types';
import { apiUrl } from './api';

// 首頁動態帶 / 站台統計 / 每日名言的 TanStack Query 選項。
// 這些原本各自 useEffect + fetch（HomeLately / Footer / mega-menu），統一收進 query 快取，
// 消除「同專案兩種抓法混用」。digest/quote 失敗回空（對齊舊 catch 的靜默降級）。
const STALE = 5 * 60 * 1000;

// locale 進 queryKey：切語系（導航到 /ja 等）時會重抓，文章標題換成該語系的譯文。
export const homeDigestQueryOptions = (locale: string) =>
  queryOptions({
  queryKey: ['home', 'digest', locale],
  queryFn: async (): Promise<DigestResponse> => {
    try {
      const res = await fetch(apiUrl(`/api/home/digest?locale=${encodeURIComponent(locale)}`));
      if (!res.ok) throw new Error(`GET /api/home/digest ${res.status}`);
      return (await res.json()) as DigestResponse;
    } catch {
      return { message: 'error', posts: [], thoughts: [], comments: [], timeline: [] };
    }
  },
  staleTime: STALE,
});

// 站台統計（Footer / 首頁 mega-menu 共用）。失敗讓 query 走 error → 元件以 undefined 顯示 fallback。
export const siteStatsQueryOptions = queryOptions({
  queryKey: ['site', 'stats'],
  queryFn: async (): Promise<StatsResponse> => {
    const res = await fetch(apiUrl('/api/stats'));
    if (!res.ok) throw new Error(`GET /api/stats ${res.status}`);
    return (await res.json()) as StatsResponse;
  },
  staleTime: STALE,
});

// 每日名言：後端是動態 Value（快取 {text,from}），非 specta 端點，型別手寫留一份小葉。
export interface DailyQuote { text: string; from?: string }
export const dailyQuoteQueryOptions = (locale: string) =>
  queryOptions({
    queryKey: ['quote', 'daily', locale],
    queryFn: async (): Promise<DailyQuote | null> => {
      try {
        const res = await fetch(apiUrl(`/api/quote/daily?locale=${encodeURIComponent(locale)}`));
        if (!res.ok) throw new Error(`GET /api/quote/daily ${res.status}`);
        const data = (await res.json()) as { quote: DailyQuote | null };
        return data.quote;
      } catch {
        return null;
      }
    },
    staleTime: STALE,
  });
