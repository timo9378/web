import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, type ReactNode } from 'react';

import KoimLoader from '../../components/KoimLoader';
import { useAuth } from '../../contexts/auth';

// /admin/* 的版面層。整段包在 ClientOnly 裡 → 後台一行都不 SSR、不 prerender
// （私有頁面沒有 SEO 需求，而 monaco 這類重元件也不該進伺服器端渲染路徑）。
//
// 歷史：這裡原本掛的是一個用 react-router 的 island（components/AdminApp.tsx），
// 整包 BrowserRouter + Routes 疊在 TanStack 的 /admin/$ splat 之下。改成真正的
// file route 之後全站只剩一個 router，連結也變成對著 route tree 做型別檢查。
const AdminLayout = lazy(() => import('../../components/admin/AdminLayout'));

const LoadingFallback = () => <KoimLoader inline size="sm" />;

/**
 * 路由保護：非 ADMIN/OWNER 一律整頁導回站台首頁。
 *
 * 為什麼是元件而不是 `beforeLoad` + `redirect()`（TanStack 的慣用寫法）：
 * 權限狀態來自 `contexts/auth` 這個 React context，而 `beforeLoad` 在 React 樹之外執行，
 * 拿不到 context。要改成 beforeLoad 就得先把 auth 放進 router context——那是另一件事，
 * 而且會讓「登入狀態」多一條與現在不同的取得路徑。守衛留在元件層，行為與遷移前逐字相同。
 *
 * 用 `window.location.replace` 而不是 router 導航：要離開的是整個 /admin 子樹，
 * 硬跳轉可以順便把後台載進來的東西（monaco 等）整個丟掉。
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoggedIn, loading } = useAuth();
  const allowed = isLoggedIn && (user?.role === 'ADMIN' || user?.role === 'OWNER');
  useEffect(() => {
    if (!loading && !allowed) window.location.replace('/');
  }, [loading, allowed]);
  if (loading || !allowed) return <LoadingFallback />;
  return children;
}

export const Route = createFileRoute('/admin')({
  component: () => (
    <ClientOnly fallback={null}>
      <Suspense fallback={<LoadingFallback />}>
        <RequireAdmin>
          <AdminLayout />
        </RequireAdmin>
      </Suspense>
    </ClientOnly>
  ),
});
