// 全域樣式/字型 —— 對齊舊 main.tsx 的 entry import(P2 之前漏掉導致全站無 Tailwind/CSS 變數/字型 → 全破版)。
// index.css 先載(@tailwind base + :root 變數 + body/grain/:lang 字型切換),component CSS 才能覆蓋。
import '@fontsource-variable/tasa-orbiter';
import '@fontsource-variable/tasa-explorer';
import '../index.css';
import '../App.css';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
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
import { localeFromPathname } from '@/i18n/start-i18n';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { SUPPORTED_LOCALES } from '../lib/locales';
import { LOCALE_TO_OG } from '@/seo/seoMeta';
import AppShell from '@/components/layout/AppShell';
import NotFound from '@/components/layout/NotFound';
import { localeWrap } from '@/i18n/localePage';

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
      // feed 自動探索：瀏覽器擴充、聚合器、部分 AI 爬蟲都靠這一行才找得到。
      // 指向既有的 /rss（後端 handlers/rss.rs）——/rss.xml 只是 301 過去的別名。
      { rel: 'alternate', type: 'application/rss+xml', title: 'Koimsurai 手記', href: '/rss' },
      { rel: 'apple-touch-icon', href: '/pwa-192.png' },
    ],
  }),
  // 未知路由 → 站內 404 頁(在 AppShell 內,保留導覽列);localeWrap 提供 i18n + locale。
  notFoundComponent: localeWrap(NotFound),
  component: RootComponent,
});

// 訂閱 + 快照 + SSR 預設值,正是 useSyncExternalStore 的職責。
// 原本是 useState + effect 裡先 onChange() 再訂閱:那個「先呼叫一次」會在 mount 時
// 多觸發一次 render(document.hidden 在 render/SSR 期讀不到,只能等 effect)。
// 換成 useSyncExternalStore 後 client 首次 render 就拿得到真值,不再有補丁式的第二次 render。
const subscribeVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => { document.removeEventListener('visibilitychange', cb); };
};

// PageVisibilityProvider 是受控的(需 isVisible)。SSR 預設 visible,client 端追蹤 document.hidden。
function PageVisibilityBridge({ children }: Readonly<{ children: ReactNode }>) {
  const isVisible = useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true, // SSR:沒有 document,一律當可見
  );
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
        {/* WebMCP origin trial。沒有 token，navigator.modelContext 不存在，Lighthouse 的
            「已註冊的 WebMCP 工具 / 結構定義有效」永遠停在「不適用」。
            兩顆並存是刻意的：各瀏覽器只驗自己簽的那顆、忽略其餘，Chrome 與 Edge 的 trial
            是分開註冊的。都綁 https://koimsurai.com:443。
            ⚠ 到期日不同，Edge 那顆先死 —— 到期後只會靜默失效，不會有任何錯誤訊息。
              Edge   2026-09-11（不含子網域）
              Chrome 2026-11-17（含子網域） */}
        <meta
          httpEquiv="origin-trial"
          content="A1SldNowolVg1sn7ieRrEhM/+ptfGqSwkO9IJUZEx9FnvUqYS7TP3dn3k76moSbRXOsIriHl/qZaF79Nmc11UI8AAABNeyJvcmlnaW4iOiJodHRwczovL2tvaW1zdXJhaS5jb206NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTc4OTA5MzU2Mn0="
        />
        <meta
          httpEquiv="origin-trial"
          content="A5pLccd3+DBvsAJK4qQsCeO0JYYH6byAGRIs9HSZt1L5aN6VxBxemVEVKDLMb6MUgVQKo0h45pK58LUHChNQeAkAAAB0eyJvcmlnaW4iOiJodHRwczovL2tvaW1zdXJhaS5jb206NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTc5NDg3MzYwMCwiaXNTdWJkb21haW4iOnRydWUsImlzVGhpcmRQYXJ0eSI6dHJ1ZX0="
        />
        {/* og:locale:alternate 依規格要「一語系一個標籤」重複出現，但 head() 的 meta 會被依
            property 去重（官方文件：same name or property will be overridden by the last
            occurrence），只留得下一個 → 等於錯誤宣告「只有某一種語言」。這裡直接寫進 document
            head 繞過那層去重。
            代價：RootDocument 拿不到單篇文章的 available_locales，所以一律列出其餘四語。
            og 這個標籤只是給社群平台的語言提示，不像 hreflang 會有重複內容的風險，
            過度宣告可以接受；hreflang 那邊仍然是逐篇照實際譯文輸出。 */}
        {SUPPORTED_LOCALES.filter((l) => l !== locale).map((l) => (
          <meta key={l} property="og:locale:alternate" content={LOCALE_TO_OG[l]} />
        ))}
        {/* pre-paint,兩件事：
            1. 首訪+桌面+首頁時先藏內容(避免 client-only intro 掛上前先閃首頁);
               SpaceBackdropShell pre-reveal 移除,4s safety timeout 兜底(JS 失敗也不會卡住)。
            2. 套用文章閱讀字體偏好 → html[data-blog-font]。偏好在 localStorage、server 讀不到，
               原本是 BlogPost 掛載後才 setState，等於「首屏用預設 serif 畫完、再整篇換字體重排」——
               回訪讀者每次進文章都吃一次。字體棧定義在 index.css 的 --blog-font-<id>。
               只收 /^[a-z-]{1,20}$/：localStorage 是使用者可改的，不驗就等於把任意字串寫進 attribute。

            ⚠️ 試過但無效、別再加：`history.scrollRestoration='manual'`。
            動機是「長文章重新整理時瀏覽器搶先還原捲動位置」——實測還原發生在 160ms、當時 SSR HTML
            還沒解析完（docH 只有 2792，最終 7109），同一個 scrollTop 對應的內容完全不同 → CLS 0.4252。
            但把宣告放這裡沒有用：瀏覽器的還原是 navigation commit 的一部分，比 <head> 的同步 script
            更早，scrollY 依然被設成 1972/docH 2792。改成 manual 之後位移反而從「5 次中 3 次」變成
            必現（改由 router 還原，時序更固定）。真正要解得從「SSR HTML 解析完成前不要有可捲動高度」
            或 router 還原時機下手，不是這一行。 */}
        <script
          // 這裡是唯一選項：這段必須在 paint 之前「同步」跑完（<script src> 或 useEffect
          // 都太晚，首頁會先閃一下、文章會先用錯字體排一次）。內容是原始碼寫死的字串常量，
          // 沒有變數插值、沒有使用者輸入直接落地（localStorage 那個值有白名單格式驗證），
          // 不存在注入面。
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=sessionStorage.getItem('introCompleted')==='true';var m=matchMedia('(max-width:768px)').matches;var p=location.pathname;var h=p==='/'||/^\\/(en|ja|ko|zh-cn)\\/?$/.test(p);if(!d&&!m&&h){document.documentElement.classList.add('intro-pending');setTimeout(function(){document.documentElement.classList.remove('intro-pending')},4000);}}catch(e){}try{var f=localStorage.getItem('blogFont');if(f&&/^[a-z-]{1,20}$/.test(f)){document.documentElement.setAttribute('data-blog-font',f);}}catch(e){}})()",
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
