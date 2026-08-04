import { createFileRoute, notFound } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Watch from '@/components/media/Watch';
import { animeHistoryQueryOptions, filmsQueryOptions, seriesQueryOptions, watchStatsQueryOptions } from '@/data/watchData';
import { localeFromPrefix } from '@/i18n/start-i18n';

export const Route = createFileRoute('/$locale/watch/')({
  ...localePagePrefixed('watch', Watch),
  // 覆蓋守門 loader：保留前綴驗證，再預取觀看紀錄（紀錄本身不分語系）
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    await Promise.all([
      context.queryClient.prefetchQuery(animeHistoryQueryOptions),
      context.queryClient.prefetchQuery(filmsQueryOptions),
      context.queryClient.prefetchQuery(seriesQueryOptions),
      context.queryClient.prefetchQuery(watchStatsQueryOptions),
    ]);
  },
});
