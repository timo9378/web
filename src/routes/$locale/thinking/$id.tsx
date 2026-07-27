import { createFileRoute, notFound } from '@tanstack/react-router';
import { localeWrap } from '../../../localePage';
import ThinkingDetail from '../../../components/ThinkingDetail';
import { thoughtDetailQueryOptions, thoughtTitle } from '../../../thoughtData';
import { pageMeta } from '../../../seoMeta';
import { localeFromPrefix } from '../../../start-i18n';
import { DEFAULT_LOCALE } from '../../../lib/locales';

export const Route = createFileRoute('/$locale/thinking/$id')({
  loader: async ({ context, params }) => {
    // 保留 localeGuardedPage 原本的前綴守門
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    const thought = await context.queryClient.ensureQueryData(thoughtDetailQueryOptions(params.id));
    if (!thought) throw notFound();
    return { thought };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    const { thought } = loaderData;
    const locale = localeFromPrefix(params.locale) ?? DEFAULT_LOCALE;
    // 碎念本身不分語系（內容就一份），但 canonical/og:locale 要跟著路由
    return {
      meta: pageMeta(thoughtTitle(thought.content), thought.content, `/${params.locale}/thinking/${thought.id}`, locale),
    };
  },
  component: localeWrap(ThinkingDetail),
});
