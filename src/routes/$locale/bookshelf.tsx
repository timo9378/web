import { createFileRoute, notFound } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Bookshelf from '@/components/media/Bookshelf';
import { booksQueryOptions, bookStatsQueryOptions } from '@/data/bookshelfData';
import { localeFromPrefix } from '@/i18n/start-i18n';

export const Route = createFileRoute('/$locale/bookshelf')({
  ...localePagePrefixed('bookshelf', Bookshelf),
  // 覆蓋 localePagePrefixed 的守門 loader：保留前綴驗證，再預取書單（書目本身不分語系）。
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    await Promise.all([
      context.queryClient.prefetchQuery(booksQueryOptions),
      context.queryClient.prefetchQuery(bookStatsQueryOptions),
    ]);
  },
});
