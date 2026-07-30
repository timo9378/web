import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '../../localePage';
import Blog from '../../components/Blog';
import { blogCategoriesQueryOptions, blogTagsQueryOptions, postsListQueryOptions } from '../../blogList';
import { DEFAULT_LOCALE } from '../../lib/locales';

export const Route = createFileRoute('/blog/')({
  ...localePage('blog', Blog),
  /* 預取首屏要用到的三份資料 → SSR baked。prefetchQuery 吞錯不擋頁。
   *
   * 標籤與分類原本沒預取，是本頁 CLS 的來源（實測 0.0326）。側欄那兩段是條件渲染在資料上
   * （`allTags.length > 0 &&`），client 才 fetch 到 → 而且它們排在側欄**最上面**，
   * 一插進來就把底下全部往下推：
   *
   *    451ms  精選:229  寫作活動:224  導航:106      ← 三段都衍生自 posts（本來就有預取）
   *   1430ms  標籤:254 插入 → 底下推 254px
   *   1488ms  分類:196 插入 → 再推 196px            合計 450px
   *
   * 「有預取的沒位移、沒預取的才位移」本身就是這個修法的證據。
   *
   * ⚠️ locale 必須跟元件端 useLocale() 得到的值一致（本路由無前綴 → zh-TW = DEFAULT_LOCALE），
   * 否則 queryKey 對不上，prefetch 白做、元件照樣自己再 fetch 一次。 */
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.prefetchQuery(postsListQueryOptions(DEFAULT_LOCALE, 'newest')),
      context.queryClient.prefetchQuery(blogTagsQueryOptions(DEFAULT_LOCALE)),
      context.queryClient.prefetchQuery(blogCategoriesQueryOptions(DEFAULT_LOCALE)),
    ]);
  },
});
