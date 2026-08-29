// @vitest-environment jsdom
//
// 元件測試的共用外殼。**這裡是唯一一份**——每支元件測試各自拼 provider 的話，
// 拼漏一個的症狀是「這個元件測不起來」，然後那支測試就被跳過或刪掉了。
//
// 疊法對齊 `src/routes/__root.tsx` 的實際順序：
//   QueryClientProvider（正式環境由 router 的 SSR 整合提供，測試裡直接給）
//     └ AuthProvider
//        └ ParallaxProvider
//           └ PageVisibilityProvider（受控，測試固定 visible）
//              └ LocaleProvider（每個 locale 一個獨立 i18n instance）
//                 └ RouterProvider（memory history）
//
// ⚠ RouterProvider 不能省。站上大量元件用 `Link` / `useRouterState` / `useNavigate`，
//   少了它會丟「useRouter must be used inside RouterProvider」——那是**外殼的問題**，
//   不是元件的 bug，但看起來一模一樣。有了它，剩下的錯才有診斷價值。
//
// ⚠ 路由樹刻意用**最小的一棵**（一個 catch-all），不是 routeTree.gen。
//   真的路由樹會把每一頁的 loader 都拉進來（打 API、動到 query 快取），
//   那樣測的就不是「這個元件掛不掛得起來」了。

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, type RenderResult } from '@testing-library/react';
import { ParallaxProvider } from 'react-scroll-parallax';
import type { ComponentProps, ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { PageVisibilityProvider } from '@/contexts/PageVisibilityContext';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import type { Locale } from '@/lib/locales';

/** RouterProvider 實際接受的 router 型別（避免用 any）。 */
type RouterProviderRouter = ComponentProps<typeof RouterProvider>['router'];

export interface RenderOptions {
  /** 預設 zh-TW。 */
  locale?: Locale;
  /** memory history 的起始路徑，元件裡的 `useRouterState` 讀得到。 */
  path?: string;
}

/**
 * 把 children 掛進完整的 provider 樹。
 *
 * QueryClient 每次都新建，而且關掉 retry —— 測試裡的失敗請求要立刻失敗，
 * 不然一個抓不到資料的元件會讓測試卡到逾時，錯誤訊息還是「timeout」而不是真正的原因。
 */
export async function renderWithProviders(ui: ReactNode, options: RenderOptions = {}): Promise<RenderResult> {
  const { locale = 'zh-TW', path = '/' } = options;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  // 待測元件掛在 **root route 本身**，底下再放一個 catch-all 的空子路由——
  // 這樣不管 memory history 指到哪個路徑（或元件內的 Link 導到哪），
  // root 的 component 都會渲染，不會變成「找不到路由」而整個空白。
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => null });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, catchAll]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });

  // ⚠ 一定要 `await router.load()` 再 render，而且 render 之後還要 flush 一次。
  //   RouterProvider 是**非同步**渲染的：剛 render 完 container 是空字串，
  //   要等它自己的第一次 load 完成才有內容。少了這兩步，每個元件測試都會拿到空 DOM，
  //   而錯誤訊息只會是「找不到那個 selector」——看起來像元件壞了。
  await router.load();

  let result!: RenderResult;
  await act(async () => {
    // ⚠ 這個 await 不是裝飾：act 的 callback 要有一次非同步的讓步，
    //   React 才會把 effect 都跑完再回來（少了它 oxlint 也會報 require-await）。
    await Promise.resolve();
    result = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ParallaxProvider>
            <PageVisibilityProvider isVisible>
              <LocaleProvider locale={locale}>
                {/* ⚠ 這道轉型是刻意的：測試用的最小路由樹跟 `declare module` 註冊的
                    正式 router 型別對不上，而那正是我們要的（不想把真的路由樹拉進來）。
                    轉成 RouterProvider 自己的 prop 型別，比 `any` 窄得多。 */}
                <RouterProvider router={router as unknown as RouterProviderRouter} />
              </LocaleProvider>
            </PageVisibilityProvider>
          </ParallaxProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  return result;
}
