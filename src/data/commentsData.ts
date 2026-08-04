import { queryOptions } from '@tanstack/react-query';
import type { CommentRow } from '@koimsurai/api-types';
import { apiUrl } from '@/lib/api';

// 留言列表（posts / thoughts 共用同一 CommentRow 形狀，後端 thoughts.rs 也用 query_as::<CommentRow>）。
// 讀取進 query 快取；送出/按讚後由元件 invalidate/ setQueryData 更新，保持單一真相來源。
export const commentsQueryOptions = (basePath: string, postId: number | string) =>
  queryOptions({
    queryKey: ['comments', basePath, String(postId)],
    queryFn: async (): Promise<CommentRow[]> => {
      const res = await fetch(apiUrl(`/api/${basePath}/${postId}/comments`));
      if (!res.ok) throw new Error(`GET /api/${basePath}/${postId}/comments ${res.status}`);
      const data = (await res.json()) as { comments?: CommentRow[] };
      return data.comments ?? [];
    },
    staleTime: 60 * 1000,
  });
