import { createFileRoute, notFound } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Music from '@/components/media/Music';
import { recentlyPlayedQueryOptions, topGenresQueryOptions, topTracksQueryOptions } from '@/data/musicData';
import { localeFromPrefix } from '@/i18n/start-i18n';

export const Route = createFileRoute('/$locale/music')({
  ...localePagePrefixed('music', Music),
  // 覆蓋守門 loader：保留前綴驗證，再預取音樂資料（Spotify 資料不分語系）
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    await Promise.all([
      context.queryClient.prefetchQuery(recentlyPlayedQueryOptions),
      context.queryClient.prefetchQuery(topGenresQueryOptions),
      context.queryClient.prefetchQuery(topTracksQueryOptions('medium_term')),
    ]);
  },
});
