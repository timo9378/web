// PostData = 後端生成的單篇回應型別（原本繞道 BlogPostPage 的別名，該 fallback 元件已退役）。
import type { PostDetailResponse as PostData } from '@koimsurai/api-types';

import { DEFAULT_LOCALE, type Locale, localePathname } from './lib/locales';

// 文章頁的完整 SEO meta，放在路由 head() —— 那是唯一會進 SSR HTML 的地方。
//
// 為什麼不用元件裡的 <SEOHead>：SEOHead 走 react-helmet-async，只在 client hydrate 後才把標籤掛上，
// 而 Facebook / Twitter / LINE / Discord 的爬蟲不執行 JS，看到的永遠是 SSR HTML。
// 實測（含遷移前的正式站 serve.mjs 版本）SSR HTML 裡 og:* / twitter:* 全部缺席 → 社群分享預覽一直是壞的。
// 文章頁更特殊：SSR 走的是 <ClientOnly> 的 fallback `BlogPostPage`，它根本沒掛 SEOHead，
// 真正有 SEOHead 的 `BlogPost` 是 client-only 元件。
//
// （2026-07：SEOHead 已全面退休。所有頁面的 title/description/og 都改由 head() 出、進 SSR；
//  文章頁的 BlogPosting JSON-LD 也搬進 head().scripts。react-helmet-async 依賴已移除。）

const BASE_URL = 'https://koimsurai.com';
const SITE_NAME = '宙と木 · Koimsurai';

// 對齊 SEOHead 的既有對應表
export const LOCALE_TO_OG: Record<string, string> = {
  'zh-TW': 'zh_TW',
  'zh-CN': 'zh_CN',
  en: 'en_US',
  ja: 'ja_JP',
  ko: 'ko_KR',
};

// og:locale:alternate 不在這裡出——它必須「一個語系一個標籤」重複出現，而 head() 的 meta 會被
// 依 name/property 去重（官方文件明載：「meta tags with the same name or property will be
// overridden by the last occurrence」，且沒有 key 之類的逃生口）。改寫在 __root 的
// RootDocument，那裡是直接渲染 <head>，不經過這層去重。

interface MetaTag {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
}

// 後端存的是 SQLite `datetime('now')` → UTC、格式 'YYYY-MM-DD HH:MM:SS'，不是 ISO 8601。
// og 的 article:published_time / modified_time 規格要 ISO 8601，直接塞原字串爬蟲會解析失敗。
const toIso = (s?: string | null): string | undefined => {
  if (!s) return undefined;
  if (s.includes('T')) return s; // 已是 ISO 就不動
  return `${s.replace(' ', 'T')}Z`;
};

/** 一般頁面（非文章）head() 用的 meta。canonicalPath 例:/music、/en/music */
export function pageMeta(
  title: string | null,
  description: string,
  canonicalPath: string,
  locale: string,
): MetaTag[] {
  const url = `${BASE_URL}${canonicalPath}`;
  const image = `${BASE_URL}/og-default-v2.png`;
  // 對齊 SEOHead 既有的標題格式
  const fullTitle = title ? `${title} - 宙と木` : SITE_NAME;

  return [
    { title: fullTitle },
    { name: 'description', content: description },

    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: fullTitle },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: LOCALE_TO_OG[locale] ?? 'zh_TW' },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: fullTitle },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:url', content: url },
  ];
}

/** 文章頁 head() 用的 meta。canonicalPath 例:/blog/39、/en/blog/39 */
export function articleMeta(post: PostData, canonicalPath: string, locale: string): MetaTag[] {
  const description = post.excerpt;
  const url = `${BASE_URL}${canonicalPath}`;
  // OG 圖由後端 resvg 生成（CJK 已驗）。舊的前端 /og-image/:id（sharp）隨 serve.mjs 一起退役。
  const image = `${BASE_URL}/api/og/${post.id}.png`;

  return [
    { title: `${post.title} - 宙と木` },
    { name: 'description', content: description },

    { property: 'og:type', content: 'article' },
    { property: 'og:title', content: post.title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: LOCALE_TO_OG[locale] ?? 'zh_TW' },

    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: post.title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:url', content: url },

    ...(toIso(post.created_at) ? [{ property: 'article:published_time', content: toIso(post.created_at)! }] : []),
    ...(toIso(post.updated_at) ? [{ property: 'article:modified_time', content: toIso(post.updated_at)! }] : []),
    ...(post.author ? [{ property: 'article:author', content: post.author }] : []),
  ];
}

/**
 * 文章頁的 BlogPosting JSON-LD，放進 head() 的 `scripts` → **進 SSR**。
 * 過去這段結構化資料只在元件的 <SEOHead>（helmet）裡出 → hydrate 後才掛、爬蟲看不到。
 * SEOHead 退休後改由此在 SSR 出，結構化資料首次讓不執行 JS 的爬蟲讀得到。
 */
export function articleJsonLd(
  post: PostData,
  canonicalPath: string,
  locale: Locale = DEFAULT_LOCALE,
): { type: string; children: string } {
  const url = `${BASE_URL}${canonicalPath}`;
  const image = `${BASE_URL}/api/og/${post.id}.png`;
  const published = toIso(post.created_at);
  const blogPath = localePathname(locale, 'blog');

  const blogPosting: Record<string, unknown> = {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: post.title,
    description: post.excerpt,
    url,
    image,
    // 五語站台一定要標：只靠 <html lang> 與 hreflang 推斷，Google 不見得會把各版本正確歸語言。
    inLanguage: locale,
    author: { '@type': 'Person', name: post.author ?? 'Koimsurai', url: BASE_URL },
    publisher: { '@type': 'Person', name: 'Koimsurai', url: BASE_URL },
    ...(published ? { datePublished: published } : {}),
    dateModified: toIso(post.updated_at) ?? published,
    ...(post.tags.length > 0 ? { keywords: post.tags.join(', ') } : {}),
    ...(post.category ? { articleSection: post.category } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };

  // 麵包屑：搜尋結果會顯示 koimsurai.com › Blog › 標題，取代裸網址，對點擊率有實際幫助。
  //
  // ⚠ 不要加「分類」那一層。Google 規定 `item` 對**除了最後一項以外**的每個 ListItem 都必填，
  // 而分類目前沒有獨立可索引頁（/blog?category=… 的 canonical 指回 /blog），給不出正當網址。
  // 曾經試過讓它只有 name 不給 item → Rich Results 測試直接判定「item 欄位未填」重大問題。
  // 硬塞一個 canonical 指向別處的網址更糟。分類資訊留在 BlogPosting 的 articleSection 就好。
  const crumbs: Record<string, unknown>[] = [
    { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${BASE_URL}${localePathname(locale)}` },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: `${BASE_URL}${blogPath}` },
    { '@type': 'ListItem', position: 3, name: post.title, item: url },
  ];

  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [blogPosting, { '@type': 'BreadcrumbList', itemListElement: crumbs }],
    }),
  };
}

/**
 * 首頁的 WebSite + Person。
 * WebSite 讓 Google 有機會給 sitelinks；Person 是知識面板／作者實體的訊號——站上本來就有完整的
 * 個人資訊與外部帳號，宣告出來才連得起來。這兩個實體全站唯一，只掛首頁。
 */
export function siteJsonLd(locale: Locale = DEFAULT_LOCALE): { type: string; children: string } {
  const home = `${BASE_URL}${localePathname(locale)}`;
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${BASE_URL}/#website`,
          url: home,
          name: SITE_NAME,
          inLanguage: locale,
          publisher: { '@id': `${BASE_URL}/#person` },
        },
        {
          '@type': 'Person',
          '@id': `${BASE_URL}/#person`,
          name: 'Koimsurai',
          url: BASE_URL,
          sameAs: ['https://github.com/timo9378'],
        },
      ],
    }),
  };
}

/** 文章列表頁的 Blog（CollectionPage 的專用型別），讓爬蟲知道這頁是文章集合而不是普通頁。 */
export function blogListJsonLd(locale: Locale = DEFAULT_LOCALE): { type: string; children: string } {
  const url = `${BASE_URL}${localePathname(locale, 'blog')}`;
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      '@id': `${url}#blog`,
      url,
      name: SITE_NAME,
      inLanguage: locale,
      isPartOf: { '@id': `${BASE_URL}/#website` },
      publisher: { '@id': `${BASE_URL}/#person` },
    }),
  };
}
