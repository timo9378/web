import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { postIdent } from '../../lib/postPath';
import { DEFAULT_LOCALE, LocaleProvider, buildAlternateLinks, toLocales } from '../../start-i18n';
import FullBlogPost from '../../components/BlogPost';
import { postDetailQueryOptions, recentPostsQueryOptions, blogCategoriesDetailQueryOptions } from '../../blogList';
import { articleJsonLd, articleMeta } from '../../seoMeta';

// 預設語言(zh-TW)文章頁:/blog/:id。
// Tier-2：BlogPost 改為 SSR-safe，直接 eager import + 單次 SSR（不再 ClientOnly 蓋 BlogPostPage
// fallback → 消除進場的雙渲染 swap）。內文/TOC/程式碼(plain)在 SSR 就出；shiki 反白、mermaid
// 圖、互動於 hydration 後原地增強，不再卸載重掛。eager import 只進「文章路由 chunk」不進全域。
export const Route = createFileRoute('/blog/$id')({
  loader: async ({ context, params }) => {
    // ensureQueryData：SSR 預取進 query 快取（dehydrate 帶到 client）+ 回傳給 head()。
    // BlogPost SSR 時 useQuery 讀同一份、hydrate 後不再重打 API。
    // 側欄 posts-nav 與內文站內連結卡的「首幀完整」：平行預取文章清單 / 分類詳情
    // （prefetchQuery 吞錯不擋頁），dehydrate 帶到 client → SSR 首幀就是真側欄 / 真連結卡，
    // 不再 client 才補上造成位移。（實測：post detail 的 dehydrate 完整、無汙染。）
    try {
      const [post] = await Promise.all([
        context.queryClient.ensureQueryData(postDetailQueryOptions(params.id, 'zh-TW')),
        context.queryClient.prefetchQuery(recentPostsQueryOptions(100)),
        context.queryClient.prefetchQuery(blogCategoriesDetailQueryOptions),
      ]);
      // 網址正規化：文章的 canonical 是 slug。用數字 id 或改名前的舊 slug 進來時
      // 一律 301 到 canonical 網址——舊網址（含 GSC 已索引的 /blog/<id>）永遠有效，
      // 且權重會轉移到新網址。
      const ident = postIdent(post);
      if (ident !== params.id) {
        throw redirect({ href: `/blog/${ident}`, statusCode: 301 });
      }
      return { post };
    } catch (e) {
      if (e instanceof Response || (e as { isRedirect?: boolean }).isRedirect) throw e;
      throw notFound();
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { post } = loaderData;
    return {
      // og/twitter 也在這裡出 —— head() 是唯一會進 SSR HTML 的地方,而社群爬蟲不執行 JS。
      // (元件內的 <SEOHead> 走 helmet,hydrate 後才掛,爬蟲永遠看不到)
      meta: articleMeta(post, `/blog/${postIdent(post)}`, DEFAULT_LOCALE),
      // hreflang 逐篇照 available_locales —— 只連這篇真的有的語言,不造假 alternate。
      links: buildAlternateLinks(`blog/${postIdent(post)}`, DEFAULT_LOCALE, toLocales(post.available_locales)),
      // BlogPosting 結構化資料進 SSR（取代退休的 SEOHead JSON-LD）。
      scripts: [articleJsonLd(post, `/blog/${postIdent(post)}`)],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <LocaleProvider locale={DEFAULT_LOCALE}>
      <FullBlogPost />
    </LocaleProvider>
  );
}
