import { createFileRoute, notFound } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Blog from '@/components/blog/Blog';
import { blogCategoriesQueryOptions, blogTagsQueryOptions, postsListQueryOptions } from '@/data/blogList';
import { localeFromPrefix } from '@/i18n/start-i18n';

export const Route = createFileRoute('/$locale/blog/')({
  ...localePagePrefixed('blog', Blog),
  // 覆蓋 localePagePrefixed 的守門 loader:保留前綴驗證,再預取「該語系」的首屏資料
  // (三個 API 都吃 lang;不帶會 SSR 出 zh-TW 內容到 /en/blog 之類的頁面)
  //
  // 標籤與分類跟著一起預取的理由見 routes/blog/index.tsx——它們沒預取時會在 ~1.4s 插進側欄
  // 最上面、把底下推 450px。這裡用 params 推出的 locale，跟元件端 useLocale() 同值，key 才對得上。
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    await Promise.all([
      context.queryClient.prefetchQuery(postsListQueryOptions(locale, 'newest')),
      context.queryClient.prefetchQuery(blogTagsQueryOptions(locale)),
      context.queryClient.prefetchQuery(blogCategoriesQueryOptions(locale)),
    ]);
  },
});
