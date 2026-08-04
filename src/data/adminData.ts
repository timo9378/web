import { queryOptions } from '@tanstack/react-query';
import type {
  AdminTagRow, AdminCategoryRow, AdminUserRow, AdminUsersResponse,
  BookRow, BooksListResponse, BlacklistRow, BlacklistResponse,
  KeywordFilterRow, KeywordFiltersResponse, SubscribersResponse, SubscriberRow,
  AdminPostsResponse, AdminCommentsResponse, AdminPostDetailResponse,
} from '@koimsurai/api-types';
import { apiUrl } from '@/lib/api';

// admin 管理頁的 TanStack Query 選項。全 behind auth（ClientOnly）——token 從 localStorage
// 讀（AuthContext 存這把 key），queryFn 帶 Authorization。列表讀進 query 快取，CRUD mutation
// 由各 manager invalidateQueries 重抓，消掉 useEffect+fetch 混用。全吃 specta 生成型別。
const TOKEN_KEY = 'koimsurai_user_token';

function authHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return (await res.json()) as T;
}

const STALE = 60 * 1000;

export const adminTagsQueryOptions = queryOptions({
  queryKey: ['admin', 'tags'],
  queryFn: () => adminGet<AdminTagRow[]>('/api/admin/tags'),
  staleTime: STALE,
});

export const adminCategoriesQueryOptions = queryOptions({
  queryKey: ['admin', 'categories'],
  queryFn: () => adminGet<AdminCategoryRow[]>('/api/admin/categories'),
  staleTime: STALE,
});

export const adminUsersQueryOptions = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: async (): Promise<AdminUserRow[]> => (await adminGet<AdminUsersResponse>('/api/admin/users')).users,
  staleTime: STALE,
});

export const adminBooksQueryOptions = queryOptions({
  queryKey: ['admin', 'books'],
  queryFn: async (): Promise<BookRow[]> => (await adminGet<BooksListResponse>('/api/books')).books,
  staleTime: STALE,
});

export const adminBlacklistQueryOptions = queryOptions({
  queryKey: ['admin', 'blacklist'],
  queryFn: async (): Promise<BlacklistRow[]> => (await adminGet<BlacklistResponse>('/api/admin/blacklist')).blacklist,
  staleTime: STALE,
});

export const adminKeywordFiltersQueryOptions = queryOptions({
  queryKey: ['admin', 'keyword-filters'],
  queryFn: async (): Promise<KeywordFilterRow[]> => (await adminGet<KeywordFiltersResponse>('/api/admin/keyword-filters')).filters,
  staleTime: STALE,
});

// 分頁/篩選的用 factory（queryKey 帶參數 → 換頁自動 refetch）
export const adminSubscribersByStatusQueryOptions = (status: string) =>
  queryOptions({
    queryKey: ['admin', 'subscribers', status],
    queryFn: async (): Promise<SubscriberRow[]> =>
      (await adminGet<SubscribersResponse>(`/api/newsletter/subscribers?status=${status}&limit=100`)).subscribers,
    staleTime: STALE,
  });

export const adminPostsQueryOptions = (query: string) =>
  queryOptions({
    queryKey: ['admin', 'posts', query],
    queryFn: () => adminGet<AdminPostsResponse>(`/api/admin/posts${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  });

export const adminCommentsQueryOptions = (query: string) =>
  queryOptions({
    queryKey: ['admin', 'comments', query],
    queryFn: () => adminGet<AdminCommentsResponse>(`/api/admin/comments${query ? `?${query}` : ''}`),
    staleTime: 30 * 1000,
  });

// /api/admin/stats 非 specta 端點（visitors=SUM(view_count) 等動態）→ 型別手寫小葉。
export interface AdminStats {
  totalPosts?: number;
  publishedPosts?: number;
  draftPosts?: number;
  postsThisMonth?: number;
  comments?: number;
  commentsThisWeek?: number;
  visitors?: number;
}
export const adminStatsQueryOptions = queryOptions({
  queryKey: ['admin', 'stats'],
  queryFn: () => adminGet<AdminStats>('/api/admin/stats'),
  staleTime: STALE,
});

export const adminPostDetailQueryOptions = (id: string | number) =>
  queryOptions({
    queryKey: ['admin', 'post-detail', String(id)],
    queryFn: () => adminGet<AdminPostDetailResponse>(`/api/admin/posts/${id}`),
    staleTime: 30 * 1000,
  });
