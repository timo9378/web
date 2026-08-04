import { createFileRoute, notFound } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Thinking from '@/components/blog/Thinking';
import { thoughtsListQueryOptions } from '@/data/thinkingData';
import { localeFromPrefix } from '@/i18n/start-i18n';

export const Route = createFileRoute('/$locale/thinking/')({
  ...localePagePrefixed('thinking', Thinking),
  // 覆蓋守門 loader：保留前綴驗證，再預取碎念（碎念本身不分語系）
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    await context.queryClient.prefetchQuery(thoughtsListQueryOptions);
  },
});
