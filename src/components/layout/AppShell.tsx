import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { ClientOnly, useRouterState } from '@tanstack/react-router';
import { stripLocalePrefix } from '@/i18n/start-i18n';
import Header from './Header';
import Footer from './Footer';
import ScrollToTop from './ScrollToTop';
import CSSStarfield from '@/components/backdrop/CSSStarfield';
import BackToTopButton from './BackToTopButton';

// 桌面 WebGL 背景/開場 + 互動式 overlay → 純 client(three.js / portal 不進 SSR)
const SpaceBackdropShell = lazy(() => import('@/components/backdrop/SpaceBackdropShell'));
const CommandPalette = lazy(() => import('./CommandPalette'));
const ContextMenu = lazy(() => import('./ContextMenu'));

// 全域 app 殼(對齊舊 App.tsx 的 Layout + App 疊法):Header / Footer / 背景 / chrome 包住路由內容(children = <Outlet/>)。
// admin 隱藏 Header/Footer/CommandPalette;photos 隱藏 Footer。
export default function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  // Core Web Vitals 上報（B4）：client-only、動態載入（web-vitals 不進關鍵 bundle）
  useEffect(() => {
    void import('@/lib/reportWebVitals').then((m) => m.initWebVitals());
  }, []);

  // 錯誤上報 → 自架 GlitchTip。同樣動態載入（@sentry/react 不進關鍵 bundle）。
  //
  // ⚠️ 掛在 AppShell 而不是更早的位置，代價是**它初始化之前的錯誤抓不到**
  //   （hydration 之前、以及 AppShell 自己 render 失敗的情況）。
  //   要抓那些就得進 SSR 產的 inline script，而那跟 CSP 的 'unsafe-inline' 綁在一起，
  //   等收緊那條時再一起處理。目前的取捨是：不為了少數幾類錯誤把 SDK 提到關鍵路徑上。
  useEffect(() => {
    void import('@/lib/errorReporting').then((m) => m.initErrorReporting());
  }, []);

  // 文章內頁（BlogPost）是重 lazy chunk（BlogPost.css + shiki + mermaid）。頁面 idle 後
  // 先暖起來——否則首次點進文章會先閃一下 BlogPostPage 極簡 fallback（純 sans-serif 無樣式）
  // 才換成完整版。暖過後 Suspense 立即解析、fallback 不再出現。import 路徑與路由的 lazy
  // 同一支 → Vite dedupe 同 chunk。requestIdleCallback 不搶首屏；Safari 無此 API 退 setTimeout。
  useEffect(() => {
    const warm = () => { void import('@/components/blog/BlogPost'); };
    const ric = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) { ric(warm); return; }
    const warmTimer = setTimeout(warm, 1500);
    return () => clearTimeout(warmTimer);
  }, []);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bare = stripLocalePrefix(pathname); // 去 locale 前綴(無前導斜線)
  const isAdminPage = bare === 'admin' || bare.startsWith('admin/');
  const isPhotoPage = bare === 'photos';
  const isHomePage = bare === '';

  return (
    <div className="App">
      <ScrollToTop />
      {/* CSS 星空底:手機唯一背景;桌面是 3D 載入前的秒出 placeholder。SSR 即出。 */}
      <CSSStarfield />
      <ClientOnly fallback={null}>
        <Suspense fallback={null}><SpaceBackdropShell /></Suspense>
      </ClientOnly>

      <div
        className="main-content-container"
        style={{ position: 'relative', zIndex: 10, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        {!isAdminPage && <Header />}
        <main style={{ flex: '1 0 auto' }}>{children}</main>
        {!isAdminPage && !isPhotoPage && <Footer />}
        {!isAdminPage && (
          <ClientOnly fallback={null}>
            <Suspense fallback={null}><CommandPalette /></Suspense>
          </ClientOnly>
        )}
      </div>

      {!isAdminPage && (
        <ClientOnly fallback={null}>
          <Suspense fallback={null}><ContextMenu /></Suspense>
        </ClientOnly>
      )}

      <BackToTopButton isHomePage={isHomePage} />
    </div>
  );
}
