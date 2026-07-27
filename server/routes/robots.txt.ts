import { defineEventHandler, setHeader } from 'nitro/h3';

// serve.mjs 的 /robots.txt 移植。用 route 而非 public/ 靜態檔,因為 Sitemap 那行要吃 SITE_URL env。
const SITE_URL = process.env.SITE_URL || 'https://koimsurai.com';

// ⚠ 不要加回 `Disallow: /api/`。
// 那行的本意是「別索引這些 JSON」，實際效果卻是「別抓取」——Googlebot 連渲染頁面時要用都不行，
// GSC 的網址審查會列出一整排「遭到 robots.txt 封鎖」的資源（留言數、按讚數、文章清單…）。
// 目前正文是 SSR 出來的所以沒實害，但只要有任何區塊改成客戶端載入就會安靜地出事。
// 防止 JSON 被收錄改由後端回應標頭 `X-Robots-Tag: noindex` 處理（見 backend/src/router.rs），
// 那才是 Google 官方對這個需求的建議做法。
const ROBOTS = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/*

Sitemap: ${SITE_URL}/sitemap.xml
`;

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain');
  return ROBOTS;
});
