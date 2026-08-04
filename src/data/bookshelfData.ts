import { queryOptions } from '@tanstack/react-query';
import type { BookRow, BooksListResponse } from '@koimsurai/api-types';
import { apiUrl } from '@/lib/api';
import type { BookStats } from '@/components/media/Bookshelf';

// 書櫃資料改由 TanStack Query 管理（取代原本的 loader + 元件內 fetch + setInterval 輪詢）。
// - loader 用 context.queryClient.prefetchQuery 預取 → SSR 首屏 baked 進 HTML（SEO）。
//   用 prefetchQuery（非 ensureQueryData）：後端不通時吞掉錯誤、不擋整頁（對齊舊 loadBookshelf
//   的「任一失敗都不擋頁面」）。
// - 元件用 useQuery 讀同一份快取，hydrate 後不重抓（staleTime 內視為新鮮）。
// - queryFn 失敗時 throw：refetch 失敗 Query 會**保留上一份資料**（對齊舊 fetchBooks 失敗不清空）。
// - refetchInterval 取代舊的 15 分鐘 setInterval（只在 client 跑，SSR 不受影響）。
const STALE = 5 * 60 * 1000;
const REFRESH = 15 * 60 * 1000;

export const booksQueryOptions = queryOptions({
  queryKey: ['books'],
  queryFn: async (): Promise<BookRow[]> => {
    const res = await fetch(apiUrl('/api/books'));
    if (!res.ok) throw new Error(`GET /api/books ${res.status}`);
    const data = (await res.json()) as BooksListResponse;
    return data.books;
  },
  staleTime: STALE,
  refetchInterval: REFRESH,
});

export const bookStatsQueryOptions = queryOptions({
  queryKey: ['books', 'stats'],
  queryFn: async (): Promise<BookStats | null> => {
    const res = await fetch(apiUrl('/api/books/stats/summary'));
    if (!res.ok) throw new Error(`GET /api/books/stats/summary ${res.status}`);
    const data = (await res.json()) as { message?: string; stats?: BookStats };
    return data.message === 'success' ? (data.stats ?? null) : null;
  },
  staleTime: STALE,
  refetchInterval: REFRESH,
});
