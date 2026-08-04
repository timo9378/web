import { queryOptions } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import type { Thought } from '@/components/blog/ThoughtCard';

// 單則碎念改由 TanStack Query 管理。route loader 用 ensureQueryData 預取（同時拿到資料給 head()），
// 元件用 useQuery 讀同一份快取。queryFn 找不到回 null（route 據此 throw notFound）。
export const thoughtDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['thoughts', 'detail', id],
    queryFn: async (): Promise<Thought | null> => {
      const res = await fetch(apiUrl(`/api/thoughts/${id}`));
      if (!res.ok) return null;
      const data = (await res.json()) as { thought?: Thought };
      return data.thought ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

/** 碎念沒有標題欄位，用內容前段當標題（過長截斷）。 */
export function thoughtTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
}
