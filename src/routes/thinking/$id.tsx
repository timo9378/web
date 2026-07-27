import { createFileRoute, notFound } from '@tanstack/react-router';
import { localeWrap } from '../../localePage';
import ThinkingDetail from '../../components/ThinkingDetail';
import { thoughtDetailQueryOptions, thoughtTitle } from '../../thoughtData';
import { pageMeta } from '../../seoMeta';
import { DEFAULT_LOCALE } from '../../lib/locales';

export const Route = createFileRoute('/thinking/$id')({
  loader: async ({ context, params }) => {
    // ensureQueryData：預取進 queryClient（給元件 useQuery 讀）+ 回傳資料（給 head()）。
    const thought = await context.queryClient.ensureQueryData(thoughtDetailQueryOptions(params.id));
    if (!thought) throw notFound();
    return { thought };
  },
  // 這條路由原本沒有 head()：每則碎念的標題都是站台預設值、也沒有描述。
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { thought } = loaderData;
    return { meta: pageMeta(thoughtTitle(thought.content), thought.content, `/thinking/${thought.id}`, DEFAULT_LOCALE) };
  },
  component: localeWrap(ThinkingDetail),
});
