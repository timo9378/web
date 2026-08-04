import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';

import KoimLoader from '@/components/common/KoimLoader';

// 新增文章。維持 lazy()：PostEditor 帶著 monaco，要留在後台自己的 chunk。
const Page = lazy(() => import('../../../components/admin/PostEditor'));

export const Route = createFileRoute('/admin/posts/create')({
  // AI 寫作（ArticleGenerator）匯入時會把整份草稿塞在 `n8n_data` 裡帶過來。
  // 宣告在這裡才有型別——不然 navigate({ search: ... }) 那端型別是 {}，過不了編譯。
  //
  // ⚠ 值傳「未編碼」的 JSON 字串：TanStack 自己會做 URL 編碼，而 PostEditor 那端是用
  //   URLSearchParams.get() 讀（解一次碼）。呼叫端若再自己 encodeURIComponent 一次
  //   就變成雙重編碼，JSON.parse 會拿到一坨 %7B。
  //
  // 回傳型別要寫成 `{ n8n_data?: string }`（**選用屬性**）而不是讓它推成
  // `{ n8n_data: string | undefined }`。後者對 TanStack 來說是「一定要有這個 key」，
  // 於是每一個連到本頁的 <Link> 都會被要求傳 search——側欄那幾個「新增文章」按鈕
  // 當場全部編譯失敗。這個差別在 react-router 時代根本不會被發現。
  validateSearch: (search: Record<string, unknown>): { n8n_data?: string } => ({
    n8n_data: typeof search.n8n_data === 'string' ? search.n8n_data : undefined,
  }),
  component: () => (
    <Suspense fallback={<KoimLoader inline size="sm" />}>
      <Page />
    </Suspense>
  ),
});
