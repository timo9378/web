import { defineEventHandler, setHeader } from 'nitro/h3';

// /llms.txt —— 給 LLM / AI agent 的網站摘要（llmstxt.org 慣例：Markdown、單一 H1、blockquote 摘要、
// 以 ## 分區列連結）。也是 Lighthouse「Agentic Browsing」稽核檢查的檔案。照 robots/sitemap 走 route
// 而非 public/ 靜態檔：要吃 SITE_URL env、並即時列近期文章。
const SITE_URL = process.env.SITE_URL || 'https://koimsurai.com';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend-rs:3002';

interface Post {
  id: number | string;
  title?: string;
  created_at?: string;
}

// 主要頁面（與 sitemap 的靜態頁對齊）。
const PAGES: [string, string][] = [
  ['/blog', '技術文章：開發、除錯、自架服務、AI 應用的長篇實作紀錄'],
  ['/photos', '攝影作品'],
  ['/bookshelf', '書櫃 / 閱讀紀錄'],
  ['/music', '音樂'],
  ['/setup', '軟硬體配置'],
  ['/about', '關於作者'],
];

export default defineEventHandler(async (event) => {
  let posts: Post[] = [];
  try {
    const res = await fetch(`${BACKEND_URL}/api/posts?limit=30`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as Post[] | { posts?: Post[] };
    posts = Array.isArray(data) ? data : (data.posts ?? []);
  } catch {
    // 後端不通 → 仍回一份只有站點區塊的 llms.txt，不要回 500。
  }

  let md = '# 宙と木 · Koimsurai\n\n';
  md += '> Koimsurai（timo9378）的個人網站與技術部落格。以開發、除錯、自架服務、AI 應用的長篇實作紀錄為主，'
    + '多為繁體中文（部分另有 English / 日本語 / 한국어 / 简体中文）。\n\n';

  md += '## 主要頁面\n\n';
  for (const [path, desc] of PAGES) md += `- [${SITE_URL}${path}](${SITE_URL}${path}): ${desc}\n`;

  md += '\n## 近期文章\n\n';
  for (const p of posts.slice(0, 20)) {
    if (!p.title) continue;
    md += `- [${p.title}](${SITE_URL}/blog/${p.id})\n`;
  }

  md += '\n## 使用說明\n\n';
  md += '- 內容為原創技術長文，歡迎 AI 檢索、摘要與引用；引用時請保留來源連結。\n';
  md += `- 完整網址清單見 [sitemap](${SITE_URL}/sitemap.xml)（含各語系 hreflang）。\n`;
  md += `- 訂閱新文章：[RSS](${SITE_URL}/rss)；各語系加 \`?lang=en|ja|ko|zh-CN\`。\n`;

  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  setHeader(event, 'cache-control', 'public, max-age=3600');
  return md;
});
