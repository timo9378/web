import { ClientOnly, notFound } from '@tanstack/react-router';
import { Suspense, lazy, type ComponentType, type ReactElement } from 'react';
import { LocaleProvider, buildAlternateLinks, localeFromPrefix } from './start-i18n';
import { DEFAULT_LOCALE } from './lib/locales';
import { useLocale } from './locale-link';
import KoimLoader from './components/KoimLoader';
import { seoMetaFor } from './pageSeo';
import { blogListJsonLd } from './seoMeta';

// 共用:把現有頁面元件包成 Start 路由 options(LocaleProvider 包覆 + 逐 locale hreflang)。
// component 用 useLocale() 從 URL 推 locale,所以 default 與 $locale 路由共用同一個 wrapper。
export function localeWrap(Comp: ComponentType): () => ReactElement {
  return function Wrapped() {
    const locale = useLocale();
    return (
      <LocaleProvider locale={locale}>
        <Comp />
      </LocaleProvider>
    );
  };
}

/** 預設語言(zh-TW)無前綴頁的 route options。basePath = 無前綴邏輯路徑(如 'bookshelf')。 */
export function localePage(basePath: string, Comp: ComponentType) {
  return {
    // meta 走 head() 而非元件內的 <SEOHead>：SEOHead 是 helmet，hydrate 後才掛，爬蟲看不到
    // → 過去每頁 SSR 的 <title> 全是同一個預設值、且無 description。詳見 pageSeo.ts。
    head: () => ({
      meta: seoMetaFor(basePath, DEFAULT_LOCALE, `/${basePath}`),
      links: buildAlternateLinks(basePath, DEFAULT_LOCALE),
      // 文章列表宣告成 Blog（CollectionPage 的專用型別），爬蟲才知道這頁是集合而非普通頁
      ...(basePath === 'blog' ? { scripts: [blogListJsonLd(DEFAULT_LOCALE)] } : {}),
    }),
    component: localeWrap(Comp),
  };
}

// 純瀏覽器頁(masonic / three / monaco / swiper 等不該 SSR 的重元件):
// 整頁 lazy + ClientOnly,server 端只出 loader shell + SEO head(hreflang/canonical),client 才載入真正元件。
function clientOnlyComp(factory: () => Promise<{ default: ComponentType }>): ComponentType {
  const Lazy = lazy(factory);
  return function ClientOnlyPage() {
    return (
      <ClientOnly fallback={<KoimLoader fullscreen size="lg" />}>
        <Suspense fallback={<KoimLoader fullscreen size="lg" />}>
          <Lazy />
        </Suspense>
      </ClientOnly>
    );
  };
}

/** 預設語言 client-only 頁。 */
export function localePageClient(basePath: string, factory: () => Promise<{ default: ComponentType }>) {
  return localePage(basePath, clientOnlyComp(factory));
}

/** 帶前綴 client-only 頁。 */
export function localePageClientPrefixed(basePath: string, factory: () => Promise<{ default: ComponentType }>) {
  return localePagePrefixed(basePath, clientOnlyComp(factory));
}

// 動態 /$locale/.../$param 頁:只做 locale 前綴守門(zh-TW/不合法 → notFound),
// 不發 hreflang(動態路徑沒有有意義的逐語系 alternate;由元件內 SEOHead 處理 title/desc)。
export function localeGuardedPage(Comp: ComponentType) {
  return {
    loader: ({ params }: { params: { locale: string } }) => {
      const locale = localeFromPrefix(params.locale);
      if (!locale || locale === 'zh-TW') throw notFound();
    },
    component: localeWrap(Comp),
  };
}

/** 帶前綴 /$locale/... 頁的 route options。 */
export function localePagePrefixed(basePath: string, Comp: ComponentType) {
  return {
    head: ({ params }: { params: { locale: string } }) => {
      const locale = localeFromPrefix(params.locale) ?? DEFAULT_LOCALE;
      return {
        meta: seoMetaFor(basePath, locale, `/${params.locale}/${basePath}`),
        links: buildAlternateLinks(basePath, locale),
        ...(basePath === 'blog' ? { scripts: [blogListJsonLd(locale)] } : {}),
      };
    },
    loader: ({ params }: { params: { locale: string } }) => {
      const locale = localeFromPrefix(params.locale);
      if (!locale || locale === 'zh-TW') throw notFound();
    },
    component: localeWrap(Comp),
  };
}
