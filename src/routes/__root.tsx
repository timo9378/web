// 全域樣式/字型 —— 對齊舊 main.tsx 的 entry import(P2 之前漏掉導致全站無 Tailwind/CSS 變數/字型 → 全破版)。
// index.css 先載(@tailwind base + :root 變數 + body/grain/:lang 字型切換),component CSS 才能覆蓋。
import '@fontsource-variable/tasa-orbiter';
import '@fontsource-variable/tasa-explorer';
import '../index.css';
import '../App.css';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouterState,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ParallaxProvider } from 'react-scroll-parallax';
import { AuthProvider } from '../contexts/AuthContext';
import { PageVisibilityProvider } from '../contexts/PageVisibilityContext';
import { LocaleProvider, localeFromPathname } from '../start-i18n';
import AppShell from '../components/AppShell';
import NotFound from '../components/NotFound';
import { localeWrap } from '../localePage';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '宙と木 · Koimsurai' },
      { name: 'theme-color', content: '#7f5af0' },
    ],
    // PWA:manifest 過去從沒被掛上 → 瀏覽器根本看不到它,站台不可安裝。
    links: [
      { rel: 'manifest', href: '/site.webmanifest' },
      // feed 自動探索：瀏覽器擴充、聚合器、部分 AI 爬蟲都靠這一行才找得到 /rss.xml
      { rel: 'alternate', type: 'application/rss+xml', title: '宙と木 · Koimsurai', href: '/rss.xml' },
      { rel: 'apple-touch-icon', href: '/pwa-192.png' },
    ],
  }),
  // 未知路由 → 站內 404 頁(在 AppShell 內,保留導覽列);localeWrap 提供 i18n + locale。
  notFoundComponent: localeWrap(NotFound),
  component: RootComponent,
});

// PageVisibilityProvider 是受控的(需 isVisible)。SSR 預設 visible,client 端追蹤 document.hidden。
function PageVisibilityBridge({ children }: Readonly<{ children: ReactNode }>) {
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setIsVisible(!document.hidden);
    onChange();
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return <PageVisibilityProvider isVisible={isVisible}>{children}</PageVisibilityProvider>;
}

function RootComponent() {
  useServiceWorker();
  return (
    <RootDocument>
      <AppShell>
        <Outlet />
      </AppShell>
    </RootDocument>
  );
}

// 註冊 /sw.js(只快取 /assets/* 與離線頁,不碰 HTML —— HTML 交給 Nitro 的 ISR)。
// 取代 serve.mjs 時代那支「自毀 SW」:它的任務(清掉更早 SPA PWA 的殘留)已完成,
// 回訪者的瀏覽器會用這份新的取代它。
function useServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => void navigator.serviceWorker.register('/sw.js').catch(() => { /* SW 註冊失敗無妨 */ });
    // 等 load 之後再註冊,避免跟首屏資源搶頻寬
    if (document.readyState === 'complete') onLoad();
    else {
      window.addEventListener('load', onLoad, { once: true });
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  // <html lang> 依路由的 locale 動態設定(SEO/可及性);SSR + client 都從 pathname 推得,一致無 mismatch
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = localeFromPathname(pathname);
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
        {/* pre-paint:首訪+桌面+首頁時先藏內容(避免 client-only intro 掛上前先閃首頁);
            SpaceBackdropShell pre-reveal 移除,4s safety timeout 兜底(JS 失敗也不會卡住)。 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=sessionStorage.getItem('introCompleted')==='true';var m=matchMedia('(max-width:768px)').matches;var p=location.pathname;var h=p==='/'||/^\\/(en|ja|ko|zh-cn)\\/?$/.test(p);if(!d&&!m&&h){document.documentElement.classList.add('intro-pending');setTimeout(function(){document.documentElement.classList.remove('intro-pending')},4000);}}catch(e){}})()",
          }}
        />
      </head>
      <body>
        {/* 全域 providers(對齊舊 App.tsx 疊法)。SEOHead 已退休 → HelmetProvider/react-helmet-async 一併移除。 */}
        <AuthProvider>
          <ParallaxProvider>
            <PageVisibilityBridge>
              {/* 依 URL locale 的 i18n context 提到 root：讓 AppShell 的 Header/Footer/chrome 也拿到正確語言。
                  否則 chrome 在 per-page LocaleProvider 之外 → fallback 到 react-i18next 全域 instance,
                  prerender 多頁時語言互相洩漏(navbar 變別頁的語言)→ hydration text mismatch(React #418)。 */}
                <LocaleProvider locale={locale}>{children}</LocaleProvider>
            </PageVisibilityBridge>
          </ParallaxProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
