import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import { booksQueryOptions, bookStatsQueryOptions } from '@/data/bookshelfData';
import Bookshelf from '@/components/media/Bookshelf';

export const Route = createFileRoute('/bookshelf')({
  ...localePage('bookshelf', Bookshelf),
  // 預取進 queryClient → SSR baked + hydrate 後 useQuery 讀快取不重抓。
  // prefetchQuery 吞錯不擋頁；loader 回 void（元件用 useQuery 讀快取，不靠 loader 回傳值）
  // → 不污染跨路由 useLoaderData({strict:false}) 的 union。
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(booksQueryOptions),
      context.queryClient.prefetchQuery(bookStatsQueryOptions),
    ]);
  },
});
