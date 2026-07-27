import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '../../localePage';
import Blog from '../../components/Blog';
import { postsListQueryOptions } from '../../blogList';
import { DEFAULT_LOCALE } from '../../lib/locales';

export const Route = createFileRoute('/blog/')({
  ...localePage('blog', Blog),
  // 預取首屏文章（sortBy=newest，對齊元件初始排序）→ SSR baked。prefetchQuery 吞錯不擋頁。
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(postsListQueryOptions(DEFAULT_LOCALE, 'newest'));
  },
});
