import { defineEventHandler, setHeader } from 'nitro/h3';

// serve.mjs 的 /sitemap.xml 移植:靜態頁清單 + 打後端撈已發布文章。
// 行為對齊舊版(同一組 staticPages / priority / changefreq、同樣 1h cache)。
const SITE_URL = process.env.SITE_URL || 'https://koimsurai.com';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-rs:3002';

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

  const url = (loc: string, lastmod: string, changefreq: string, priority: string) =>
    `  <url><loc>${SITE_URL}${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>\n`;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const [loc, priority, changefreq] of STATIC_PAGES) xml += url(loc, today, changefreq, priority);
  for (const p of posts) {
    const lastmod = (p.updated_at ?? p.created_at ?? '').slice(0, 10) || today;
    xml += url(`/blog/${p.slug || p.id}`, lastmod, 'monthly', '0.8');
  }
  xml += '</urlset>\n';

  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  setHeader(event, 'cache-control', 'public, max-age=3600');
  return xml;
});
