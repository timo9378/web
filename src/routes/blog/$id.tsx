import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { postIdent } from '../../lib/postPath';
import { buildAlternateLinks, toLocales } from '@/i18n/start-i18n';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { DEFAULT_LOCALE } from '../../lib/locales';
import FullBlogPost from '@/components/blog/BlogPost';
import { postDetailQueryOptions, recentPostsQueryOptions, blogCategoriesDetailQueryOptions } from '@/data/blogList';
import { articleJsonLd, articleMeta } from '@/seo/seoMeta';

// 預設語言(zh-TW)文章頁:/blog/:id。
// Tier-2：BlogPost 改為 SSR-safe，直接 eager import + 單次 SSR（不再 ClientOnly 蓋 BlogPostPage
// fallback → 消除進場的雙渲染 swap）。內文/TOC/程式碼(plain)在 SSR 就出；shiki 反白、mermaid
// 圖、互動於 hydration 後原地增強，不再卸載重掛。eager import 只進「文章路由 chunk」不進全域。
export const Route = createFileRoute('/blog/$id')({
  loader: async ({ context, params }) => {
    // ensureQueryData：SSR 預取進 query 快取（dehydrate 帶到 client）+ 回傳給 head()。
    // BlogPost SSR 時 useQuery 讀同一份、hydrate 後不再重打 API。
    // 側欄 posts-nav / 上下篇導覽 / 內文站內連結卡的「首幀完整」：平行預取文章清單 / 分類詳情
    // （prefetchQuery 吞錯不擋頁），dehydrate 帶到 client → SSR 首幀就是真側欄 / 真導覽，
    // 不再 client 才補上造成位移。
    //
    // ⚠️ 參數必須跟元件端的 useQuery 一字不差，queryKey 是 ['posts','recent',limit,locale]：
    //   PostsNav      → recentPostsQueryOptions(100, 'zh-TW')
    //   PrevNextNav   → recentPostsQueryOptions(200, 'zh-TW')
    // 原本這裡只預取 (100) —— 少了 locale，key 變 [...,100,'']，兩個元件**都沒命中**，
    // 於是 hydration 後才各補一次 API。上下篇導覽因此從無到有撐出 96px，把下方的留言區
    // 往下推 145px；平常這推移發生在視口外不計分，但「重新整理」時 scroll restoration 已把
    // 讀者固定在深處 → 位移落在視口內 → 實測 CLS 0.3763。
    // 兩個 limit 都要預取（同一支 API、不同 key），否則只解一半。
    try {
      const [post] = await Promise.all([
        context.queryClient.ensureQueryData(postDetailQueryOptions(params.id, 'zh-TW')),
        context.queryClient.prefetchQuery(recentPostsQueryOptions(100, 'zh-TW')),
        context.queryClient.prefetchQuery(recentPostsQueryOptions(200, 'zh-TW')),
        context.queryClient.prefetchQuery(blogCategoriesDetailQueryOptions('zh-TW')),
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
      scripts: [articleJsonLd(post, `/blog/${postIdent(post)}`, DEFAULT_LOCALE)],
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
