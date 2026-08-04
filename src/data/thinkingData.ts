import { queryOptions } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import type { Thought } from '@/components/blog/ThoughtCard';

// 碎念列表改由 TanStack Query 管理。loader 用 prefetchQuery 預取 → SSR baked。
// 發文／編輯／刪除後用 queryClient.invalidateQueries(['thoughts','list']) 重抓。
export const thoughtsListQueryOptions = queryOptions({
  queryKey: ['thoughts', 'list'],
  queryFn: async (): Promise<Thought[]> => {
    const res = await fetch(apiUrl('/api/thoughts?limit=50'));
    if (!res.ok) throw new Error(`GET /api/thoughts ${res.status}`);
    const data = (await res.json()) as { thoughts?: Thought[] };
    return data.thoughts ?? [];
  },
  staleTime: 5 * 60 * 1000,
});
