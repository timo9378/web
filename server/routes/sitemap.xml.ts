import { defineEventHandler, setHeader } from 'nitro/h3';

import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES, localePathname } from '../../src/lib/locales';

// serve.mjs 的 /sitemap.xml 移植:靜態頁清單 + 打後端撈已發布文章。
//
// 多語系（xhtml:link alternate）：Google 接受 HTML 標籤 / HTTP header / sitemap 三種宣告方式，
// 頁面本身已經有 <link rel="alternate">，所以這裡是「補上主動提交」而不是修錯——沒有這一層，
// /ja/blog/… 只能靠爬到 zh-TW 頁面再順著 hreflang 找過去，發現得慢也不明確。
//
// 兩個容易做錯的地方：
//   1. **只列真的有譯文的語系**。文章沒翻譯時前台會 fallback 回原文，硬列 5 語等於送一堆
//      內容相同、只有 lang 不同的頁面給 Google，會被判重複內容。逐篇用後端的 available_locales。
//   2. **alternate 必須對稱**。每個語系版本各自出一筆 <url>，且都帶「完整且相同」的一組
//      alternate（含指回自己）。少一邊 Google 就不採信整組宣告。
const SITE_URL = process.env.SITE_URL || 'https://koimsurai.com';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-rs:3002';

// UI 頁五語都有翻譯（src/routes/$locale/ 底下每頁都在），所以直接展開全語系。
const STATIC_PAGES: [string, string, string][] = [
  ['/', '1.0', 'weekly'],
  ['/blog', '0.9', 'daily'],
  ['/photos', '0.7', 'weekly'],
  ['/bookshelf', '0.6', 'monthly'],
  ['/music', '0.5', 'weekly'],
  ['/setup', '0.5', 'monthly'],
  ['/activity', '0.5', 'daily'],
  ['/about', '0.7', 'monthly'],
];

interface Post {
  id: number | string;
  /** 網址用的 canonical slug；舊資料沒有就退回 id。 */
  slug?: string | null;
  updated_at?: string;
  created_at?: string;
  /** 這篇實際有內容的語系（後端 PostListItem 已提供）；缺就當只有預設語系。 */
  available_locales?: string[];
}

/** 後端字串陣列 → 我們支援的 Locale[]（保序、濾掉不支援的；空的話至少有預設語系）。 */
function toLocales(arr: readonly string[] | undefined): Locale[] {
  if (!arr || arr.length === 0) return [DEFAULT_LOCALE];
  const known = SUPPORTED_LOCALES.filter((l) => arr.includes(l));
  return known.length > 0 ? known : [DEFAULT_LOCALE];
}

export default defineEventHandler(async (event) => {
  const today = new Date().toISOString().slice(0, 10);
  let posts: Post[] = [];
  try {
    const res = await fetch(`${BACKEND_URL}/api/posts?limit=500`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as Post[] | { posts?: Post[] };
    posts = Array.isArray(data) ? data : (data.posts ?? []);
  } catch {
    // 後端不通:仍回一份只有靜態頁的 sitemap,不要回 500
    // (舊版是 fallback 到 dist/client/sitemap.xml,但 Nitro 下沒有那份靜態檔了)
  }

  /** 一組 <url>：basePath 的每個語系各一筆，每筆都帶完整且相同的 alternate 清單。 */
  const urlSet = (basePath: string, locales: readonly Locale[], lastmod: string, changefreq: string, priority: string) => {
    const alternates =
      locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${localePathname(l, basePath)}"/>\n`).join('') +
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${localePathname(DEFAULT_LOCALE, basePath)}"/>\n`;
    return locales
      .map(
        (l) =>
          `  <url>\n    <loc>${SITE_URL}${localePathname(l, basePath)}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n` +
          alternates +
          `  </url>\n`,
      )
      .join('');
  };

  let xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  for (const [loc, priority, changefreq] of STATIC_PAGES) {
    xml += urlSet(loc, SUPPORTED_LOCALES, today, changefreq, priority);
  }
  for (const p of posts) {
    const lastmod = (p.updated_at ?? p.created_at ?? '').slice(0, 10) || today;
    xml += urlSet(`/blog/${p.slug || p.id}`, toLocales(p.available_locales), lastmod, 'monthly', '0.8');
  }
  xml += '</urlset>\n';

  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  setHeader(event, 'cache-control', 'public, max-age=3600');
  return xml;
});
