import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Watch from '@/components/media/Watch';
import { animeHistoryQueryOptions, filmsQueryOptions, seriesQueryOptions, watchStatsQueryOptions } from '@/data/watchData';

export const Route = createFileRoute('/watch/')({
  ...localePage('watch', Watch),
  // 預取觀看紀錄（不含 liveNow 即時 / favorites 依語系）→ SSR baked。
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(animeHistoryQueryOptions),
      context.queryClient.prefetchQuery(filmsQueryOptions),
      context.queryClient.prefetchQuery(seriesQueryOptions),
      context.queryClient.prefetchQuery(watchStatsQueryOptions),
    ]);
  },
});
