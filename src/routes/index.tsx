import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { buildAlternateLinks, localeFromPrefix, pickLocaleFromAcceptLanguage } from '../start-i18n';
import { LocaleProvider } from '../LocaleProvider';
import { isBotUserAgent } from '../lib/bot';
import { DEFAULT_LOCALE, LOCALE_PREFIX, type Locale } from '../lib/locales';
import MainPage from '../components/MainPage';
import { siteJsonLd } from '../seoMeta';
import { seoMetaFor } from '../pageSeo';

// server-only:讀 UA / cookie / Accept-Language → 決定首頁要導向哪個 locale。
// 包在 createServerFn 裡,server-only 的 header API 才不會被打進 client bundle。
const detectLocale = createServerFn({ method: 'GET' }).handler((): Locale => {
  // bot 不導 → 讓爬蟲停在預設 zh-TW,各語言交給 hreflang 索引。
  if (isBotUserAgent(getRequestHeader('user-agent'))) return DEFAULT_LOCALE;
  // 使用者選過語言(cookie)優先;否則用瀏覽器 Accept-Language。
  const cookieRaw = getCookie('koim_locale');
  return (
    (cookieRaw ? localeFromPrefix(cookieRaw) : null) ??
    pickLocaleFromAcceptLanguage(getRequestHeader('accept-language'))
  );
});

// 預設語言(zh-TW)無前綴首頁 +「依 Accept-Language 自動導向」入口。
// `/` 不進 prerender(見 vite.config.start.ts 的 filter)→ 每次請求都在 server 跑 beforeLoad。
export const Route = createFileRoute('/')({
  head: () => ({
    meta: seoMetaFor('', DEFAULT_LOCALE, '/'),
    scripts: [siteJsonLd(DEFAULT_LOCALE)],
    links: buildAlternateLinks('', DEFAULT_LOCALE),
  }),
  beforeLoad: async () => {
    if (typeof window !== 'undefined') return; // 只在 server 初次請求偵測;client 端導覽回首頁不被導走
    const target = await detectLocale();
    if (target !== DEFAULT_LOCALE) {
      throw redirect({ href: `/${LOCALE_PREFIX[target]}`, statusCode: 302 });
    }
  },
  component: () => (
    <LocaleProvider locale={DEFAULT_LOCALE}>
      <MainPage />
    </LocaleProvider>
  ),
});
