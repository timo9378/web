import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { postIdent } from '../../../lib/postPath';
import { LocaleProvider, buildAlternateLinks, localeFromPrefix, toLocales } from '../../../start-i18n';
import FullBlogPost from '../../../components/BlogPost';
import { postDetailQueryOptions, recentPostsQueryOptions, blogCategoriesDetailQueryOptions } from '../../../blogList';
import { articleJsonLd, articleMeta } from '../../../seoMeta';

// 帶前綴文章頁:/$locale/blog/:id(/en/blog/39 等)。loader 依 locale 抓翻譯版內容。
// Tier-2：同 /blog/$id —— BlogPost 直接 SSR（不再 ClientOnly + BlogPostPage fallback），消除雙渲染。
export const Route = createFileRoute('/$locale/blog/$id')({
  loader: async ({ context, params }) => {
    const locale = localeFromPrefix(params.locale);
    if (!locale || locale === 'zh-TW') throw notFound();
    try {
      // 側欄 / 站內連結卡的「首幀完整」：平行預取清單 + 分類（同 /blog/$id）。
      const [post] = await Promise.all([
        context.queryClient.ensureQueryData(postDetailQueryOptions(params.id, locale)),
        context.queryClient.prefetchQuery(recentPostsQueryOptions(100)),
        context.queryClient.prefetchQuery(blogCategoriesDetailQueryOptions(locale)),
      ]);
      // 同 /blog/$id：非 canonical 的識別碼（數字 id / 舊 slug）一律 301 到 slug 網址。
      const ident = postIdent(post);
      if (ident !== params.id) {
        throw redirect({ href: `/${params.locale}/blog/${ident}`, statusCode: 301 });
      }
      return { post, locale };
    } catch (e) {
      if (e instanceof Response || (e as { isRedirect?: boolean }).isRedirect) throw e;
      throw notFound();
    }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    const { post, locale } = loaderData;
    return {
      // og/twitter 也在這裡出（理由同 /blog/$id）
      meta: articleMeta(post, `/${params.locale}/blog/${postIdent(post)}`, locale),
      links: buildAlternateLinks(`blog/${postIdent(post)}`, locale, toLocales(post.available_locales)),
      scripts: [articleJsonLd(post, `/${params.locale}/blog/${postIdent(post)}`)],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { locale } = Route.useLoaderData();
  return (
    <LocaleProvider locale={locale}>
      <FullBlogPost />
    </LocaleProvider>
  );
}
