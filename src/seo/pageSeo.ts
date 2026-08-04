import { createI18n } from '@/i18n/start-i18n';
import { type Locale } from '@/lib/locales';
import { pageMeta } from './seoMeta';
import { lookup } from '@/lib/tableLookup';

// 各頁的 SEO 標題／描述，以 localePage 的 basePath 為 key 集中管理。
//
// 為什麼要有這張表：這些頁的 title/description 原本只寫在元件裡的 <SEOHead>（已退休），而 SEOHead 走
// react-helmet-async —— hydrate 後才掛標籤，爬蟲不執行 JS 就看不到。結果是 SSR HTML 裡
// **每一頁的 <title> 都是同一個 "宙と木 · Koimsurai"、且完全沒有 meta description**，
// Google 無從分辨頁面、也沒有描述文字可讀。head() 是唯一會進 SSR 的地方，但它不能用 React
// hook（取不到 useTranslation），所以改由這張表 + createI18n(locale).t() 在 head() 內同步取值。
//
// key 用 basePath（localePage/localePagePrefixed 都已經帶著它）→ 20 幾個路由檔一行都不用改。

interface SeoEntry {
  /** i18n key（優先）；沒有對應翻譯的頁面才用 title/description 寫死 */
  titleKey?: string;
  descKey?: string;
  title?: string;
  description?: string;
}

const PAGE_SEO: Record<string, SeoEntry> = {
  // 首頁（basePath = ''）：title 留 null → 站台預設名（宙と木 · Koimsurai），描述用 hero 標語。
  // 原本首頁 head() 只出 links → SSR 完全沒有 og/description（Hero 的 <SEOHead> 是 helmet、爬蟲看不到）。
  '': { descKey: 'hero.description' },
  // 有 i18n 翻譯的
  blog: { titleKey: 'blog.metaTitle', descKey: 'blog.description' },
  music: { titleKey: 'music.title', descKey: 'music.description' },
  bookshelf: { titleKey: 'bookshelf.title', descKey: 'bookshelf.description' },
  activity: { titleKey: 'activity.title', descKey: 'activity.description' },
  setup: { titleKey: 'setup.title', descKey: 'setup.description' },
  thinking: { titleKey: 'thinking.title', descKey: 'thinking.subtitle' },
  watch: { titleKey: 'watch.title', descKey: 'watch.metaDescription' },
  'watch/library': { titleKey: 'watch.library.title', descKey: 'watch.library.subtitle' },
  // 這三頁的各語系翻譯原本散在元件內（AboutPage.SEO / Portfolio.dict）或直接寫死中文，
  // 已搬進 locales/*/common.json → 標題現在會跟著語系走，不再各語系都出中文。
  about: { titleKey: 'about.title', descKey: 'about.description' },
  portfolio: { titleKey: 'portfolio.title', descKey: 'portfolio.description' },
  photos: { titleKey: 'photos.title', descKey: 'photos.description' },
  // info.* 系列（走 localePage('<basePath>')）——原本沒登記 → <title> 全是站台預設值。
  // title/subtitle 五語系齊全，subtitle 當描述（同 thinking / watch.library 慣例）。
  friends: { titleKey: 'info.friends.title', descKey: 'info.friends.subtitle' },
  messages: { titleKey: 'info.messages.title', descKey: 'info.messages.subtitle' },
  history: { titleKey: 'info.history.title', descKey: 'info.history.subtitle' },
  'about-site': { titleKey: 'info.aboutSite.title', descKey: 'info.aboutSite.subtitle' },
};

// createI18n 每次呼叫都會建新實例；head() 每次 render 都會跑，所以以 locale 快取。
// 實例是唯讀用途（只 t()，不 changeLanguage），跨請求共用安全。
const cache = new Map<string, ReturnType<typeof createI18n>>();
function i18nFor(locale: Locale) {
  let inst = cache.get(locale);
  if (!inst) {
    inst = createI18n(locale);
    cache.set(locale, inst);
  }
  return inst;
}

/** 依 basePath 產出該頁的 SSR meta；沒登記的頁回 undefined（維持現有行為，不強加預設）。 */
export function seoMetaFor(basePath: string, locale: Locale, canonicalPath: string) {
  const entry = lookup(PAGE_SEO, basePath);
  if (!entry) return undefined;
  const t = i18nFor(locale).t;
  const title = entry.titleKey ? t(entry.titleKey) : (entry.title ?? null);
  const description = entry.descKey ? t(entry.descKey) : (entry.description ?? '');
  return pageMeta(title, description, canonicalPath, locale);
}
