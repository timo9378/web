import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale } from './useLocale';
import { postDetailQueryOptions } from '@/data/blogList';
import { prefetchPostChunk } from './prefetchPost';

// hover 預抓文章：BlogPost lazy chunk + 文章 JSON（進 Query 快取，點擊後 route loader
// ensureQueryData 直接命中）。locale 對齊目的地 route loader 的 lang（/blog=zh-TW、/$locale/blog=locale）。
export function usePrefetchArticle() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  return useCallback(
    (id: string | number) => {
      void prefetchPostChunk();
      void queryClient.prefetchQuery(postDetailQueryOptions(id, locale));
    },
    [queryClient, locale],
  );
}
