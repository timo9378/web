import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Thinking from '@/components/blog/Thinking';
import { thoughtsListQueryOptions } from '@/data/thinkingData';

export const Route = createFileRoute('/thinking/')({
  ...localePage('thinking', Thinking),
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(thoughtsListQueryOptions);
  },
});
