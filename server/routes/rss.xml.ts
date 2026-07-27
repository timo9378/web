import { defineEventHandler, getQuery, setHeader } from 'nitro/h3';

import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES, localePathname } from '../../src/lib/locales';

// /rss.xml —— RSS 2.0 feed。
//
// 為什麼要有：部落格沒有 feed，讀者沒辦法用聚合器訂閱，而且現在不少 AI 爬蟲會優先找 feed
// 而不是硬爬 HTML。站上已經有電子報，feed 只是同一批內容的另一個出口。
//
// 多語系：`/rss.xml?lang=ja` 出該語系的標題/摘要與 /ja/blog/… 連結；不帶參數就是 zh-TW。
// 各語系用同一支 route 而非五個檔——內容來源是同一份 API，只是取不同欄位。
// <atom:link rel="self"> 是 RSS 規範建議的自我指涉，聚合器用它判斷 feed 正規網址。
const SITE_URL = process.env.SITE_URL || 'https://koimsurai.com';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-rs:3002';
const SITE_NAME = '宙と木 · Koimsurai';
const MAX_ITEMS = 30;

interface Post {
  id: number | string;
  slug?: string | null;
  title?: string;
  excerpt?: string;
  created_at?: string;
  updated_at?: string;
  available_locales?: string[];
}

/** XML 文字節點跳脫。`&` 一定要先換，否則會把後面替換出來的實體再跳脫一次。 */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SQLite 的 'YYYY-MM-DD HH:MM:SS'(UTC) → RFC 822，RSS 的 pubDate 規格要這個格式。 */
function toRfc822(s?: string): string {
  if (!s) return new Date(0).toUTCString();
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0).toUTCString() : d.toUTCString();
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const requested = typeof q.lang === 'string' ? q.lang : '';
  const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(requested)
    ? (requested as Locale)
    : DEFAULT_LOCALE;

  let posts: Post[] = [];
  try {
    const res = await fetch(`${BACKEND_URL}/api/posts?limit=${MAX_ITEMS}&lang=${locale}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as Post[] | { posts?: Post[] };
    posts = Array.isArray(data) ? data : (data.posts ?? []);
  } catch {
    // 後端不通:仍回一份空 feed，不要回 500（聚合器對 5xx 會退避重試，空 feed 反而無害）
  }

  // 沒有該語系譯文的文章不放進該語系的 feed——訂閱日文卻收到中文全文，體感是壞掉的。
  if (locale !== DEFAULT_LOCALE) {
    posts = posts.filter((p) => (p.available_locales ?? []).includes(locale));
  }

  const selfPath = locale === DEFAULT_LOCALE ? '/rss.xml' : `/rss.xml?lang=${locale}`;
  const items = posts
    .map((p) => {
      const link = `${SITE_URL}${localePathname(locale, `blog/${p.slug || p.id}`)}`;
      return (
        `    <item>\n` +
        `      <title>${esc(p.title ?? '')}</title>\n` +
        `      <link>${esc(link)}</link>\n` +
        `      <guid isPermaLink="true">${esc(link)}</guid>\n` +
        `      <pubDate>${toRfc822(p.created_at)}</pubDate>\n` +
        `      <description>${esc(p.excerpt ?? '')}</description>\n` +
        `    </item>\n`
      );
    })
    .join('');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '  <channel>\n' +
    `    <title>${esc(SITE_NAME)}</title>\n` +
    `    <link>${SITE_URL}${localePathname(locale)}</link>\n` +
    `    <description>${esc(SITE_NAME)}</description>\n` +
    `    <language>${locale}</language>\n` +
    `    <lastBuildDate>${toRfc822(posts[0]?.updated_at ?? posts[0]?.created_at)}</lastBuildDate>\n` +
    `    <atom:link href="${esc(SITE_URL + selfPath)}" rel="self" type="application/rss+xml"/>\n` +
    items +
    '  </channel>\n</rss>\n';

  setHeader(event, 'content-type', 'application/rss+xml; charset=utf-8');
  setHeader(event, 'cache-control', 'public, max-age=3600');
  return xml;
});
