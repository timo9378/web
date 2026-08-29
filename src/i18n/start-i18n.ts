import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale, localePathname } from '@/lib/locales';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhTW from '@/locales/zh-TW/common.json';
import zhCN from '@/locales/zh-CN/common.json';
import en from '@/locales/en/common.json';
import ja from '@/locales/ja/common.json';
import ko from '@/locales/ko/common.json';

// ──────────────────────────────────────────────────────────────
// P2:URL 驅動的 i18n（SSR/SSG 用)。
// 語言來源 = URL 的 locale 前綴(不是 localStorage/navigator)→ server 端可確定性渲染、
// 零 hydration mismatch。每次 render 建「獨立 instance」避免 ISR 並發請求共用 singleton 互踩。
// ──────────────────────────────────────────────────────────────

// 語系常數（SUPPORTED_LOCALES / DEFAULT_LOCALE / LOCALE_PREFIX / Locale / localePathname）
// 在 lib/locales.ts——純資料、無 React 相依，所以 Nitro 的 sitemap route 也能 import。
// 這裡刻意「不」re-export：多一組 re-export 只會讓 react-refresh 多噴警告，消費端直接指過去更清楚。

// 語言切換器（footer LanguagePicker）顯示用的原生語名。
// key 放寬成 string：呼叫端拿到的 current language 是 i18next 的 string 型別。
export const LOCALE_LABELS: Record<string, string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

const PREFIX_TO_LOCALE: Record<string, Locale> = {
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  'zh-cn': 'zh-CN',
};

/** URL 前綴 → locale。undefined(無前綴)= 預設;非支援前綴 = null(讓路由 notFound)。 */
export function localeFromPrefix(prefix: string | undefined): Locale | null {
  if (!prefix) return DEFAULT_LOCALE;
  return PREFIX_TO_LOCALE[prefix.toLowerCase()] ?? null;
}

/** 後端 available_locales(字串陣列)→ 我們支援的 Locale[](保序、濾掉不支援的)。給 blog 逐篇 hreflang 用。 */
export function toLocales(arr: readonly string[] | undefined): Locale[] {
  if (!arr || arr.length === 0) return [DEFAULT_LOCALE];
  return SUPPORTED_LOCALES.filter((l) => arr.includes(l));
}

/** 完整 pathname → locale(給 __root 設 <html lang>)。第一段非 locale(如 /blog)→ 預設。 */
export function localeFromPathname(pathname: string): Locale {
  const seg = pathname.split('/').find(Boolean);
  return localeFromPrefix(seg) ?? DEFAULT_LOCALE;
}

/** 去掉 pathname 的 locale 前綴 → 無前綴邏輯路徑('/en/blog/39'→'blog/39';'/en'→'';'/'→'')。 */
export function stripLocalePrefix(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  const loc = segs.length ? localeFromPrefix(segs[0]) : null;
  if (loc && loc !== DEFAULT_LOCALE) segs.shift(); // 第一段是 en/ja/ko/zh-cn 才剝掉
  return segs.join('/');
}

/** Accept-Language header → 最佳支援 locale(依 q 值排序;認不出 → 預設 zh-TW)。 */
export function pickLocaleFromAcceptLanguage(header: string | undefined | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag.startsWith('zh')) {
      if (/hant|tw|hk|mo/.test(tag)) return 'zh-TW';
      if (/hans|cn|sg/.test(tag)) return 'zh-CN';
      return 'zh-TW'; // 純 zh → 預設繁中
    }
    if (tag.startsWith('en')) return 'en';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('ko')) return 'ko';
  }
  return DEFAULT_LOCALE;
}

// bot 偵測搬到 lib/bot.ts（純函式、零相依，Web Vitals 上報也要用）。消費端直接從那裡 import。

const SITE_URL = 'https://koimsurai.com';

/** 某 locale 下、某邏輯路徑(無前綴,如 '' 或 'blog/39')的絕對 URL。 */
export function localeUrl(locale: Locale, basePath = ''): string {
  return `${SITE_URL}${localePathname(locale, basePath)}`;
}

/**
 * canonical + hreflang alternates(含 x-default = 預設語言),給路由 head() 用。
 * locales 預設全 5 語(UI 頁都有翻譯);blog 之後傳該篇的 available_locales,只連真的有的語言。
 */
export function buildAlternateLinks(
  basePath: string,
  currentLocale: Locale,
  locales: readonly Locale[] = SUPPORTED_LOCALES,
): { rel: string; href: string; hreflang?: string }[] {
  return [
    { rel: 'canonical', href: localeUrl(currentLocale, basePath) },
    ...locales.map((loc) => ({ rel: 'alternate', hreflang: loc, href: localeUrl(loc, basePath) })),
    { rel: 'alternate', hreflang: 'x-default', href: localeUrl(DEFAULT_LOCALE, basePath) },
  ];
}

const RESOURCES = {
  'zh-TW': { common: zhTW },
  'zh-CN': { common: zhCN },
  en: { common: en },
  ja: { common: ja },
  ko: { common: ko },
};

export function createI18n(locale: Locale): I18nInstance {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources: RESOURCES,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React 自己防 XSS
  });
  return instance;
}
