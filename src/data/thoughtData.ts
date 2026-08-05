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

/**
 * 碎念沒有標題欄位，用內容前段當標題（過長截斷）。
 *
 * ⚠ 用 `Array.from` 依**碼點**切，不是 `slice` 依 UTF-16 code unit。
 * 碎念裡 emoji 很常見，而 emoji 佔兩個 code unit——`slice(0, 32)` 落在代理對中間時
 * 會留下半個字元，畫面上就是一個 �，而且那個字串再被拿去當 title 屬性或分享文字也一樣壞。
 */
export function thoughtTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  return chars.length > 32 ? `${chars.slice(0, 32).join('')}…` : oneLine;
}
