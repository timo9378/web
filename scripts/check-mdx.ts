/**
 * 已發布文章的 MDX 編譯守門。
 *
 * 為什麼需要：MDX 編譯失敗在前台是**靜默退回 markdown**——讀者看到裸露的標籤原始碼，
 * 而 create/update API 仍然回 success。CLAUDE.md 記著這件事，但沒有任何東西在執行它。
 *
 * 更麻煩的是錯誤 UI 其實寫好了、卻永遠不會亮：
 *   src/data/blogList.ts:43            編譯拋錯 → console.error → return data（沒有 compiledMdx）
 *   src/components/mdx/MdxContent.tsx:42   <div className="mdx-error">
 * 那個錯誤框只在 render 期 runSync 爆掉才出現，而編譯已經在上一層失敗了。
 *
 * 這支腳本用 **src/lib/mdx/mdx-compile-core.ts 的同一組 plugin** 把每篇已發布文章的每個
 * 語系編一遍。共用而不是抄一份，是因為抄的那份會在有人加 plugin 時悄悄過時。
 *
 * 用法：
 *   pnpm check:mdx                          # 預設打線上站
 *   SITE_URL=http://127.0.0.1:3002 pnpm check:mdx
 */

import { compileMdxSource } from '../src/lib/mdx/mdx-compile-core';
import { readRegisteredBlocks } from './mdx-block-names';
// 掃「未註冊的 block」之前要先去掉程式碼，否則泛型會被當成標籤。理由與另一個使用者見該檔。
import { LOCALES, localesOf } from './post-locales';
import { stripCode } from './strip-code';

const SITE = (process.env.SITE_URL ?? 'https://koimsurai.com').replace(/\/$/, '');
interface PostListItem { id: number; title: string; available_locales?: string[] }
interface PostDetail { id: number; title: string; content: string | null; format: string | null }

const label = (lang: string) => lang || 'zh-TW（原文）';

async function main() {
  const registered = new Set(readRegisteredBlocks());
  console.log(`已註冊的 MDX block：${registered.size} 個`);

  const listRes = await fetch(`${SITE}/api/posts?limit=500`);
  if (!listRes.ok) throw new Error(`取文章清單失敗：${listRes.status} ${SITE}/api/posts`);
  const { posts } = (await listRes.json()) as { posts: PostListItem[] };
  // 不是每篇都 × 5：只抓 available_locales 真的有的那些（見 post-locales.ts）。
  const planned = posts.reduce((n, p) => n + localesOf(p).length, 0);
  console.log(`${SITE} — ${posts.length} 篇已發布，共 ${planned} 個語系版本要編譯（上限 ${posts.length * LOCALES.length}）\n`);

  const failures: string[] = [];
  let compiled = 0;
  let skippedNotMdx = 0;
  let skippedNoLocale = 0;

  for (const p of posts) {
    for (const lang of localesOf(p)) {
      const url = lang ? `${SITE}/api/posts/${p.id}?lang=${encodeURIComponent(lang)}` : `${SITE}/api/posts/${p.id}`;
      const res = await fetch(url);
      // 走到這裡的 404 代表 available_locales 說有、詳情卻拿不到（資料不一致），
      // 不再是「正常的沒翻譯」——那些現在由 localesOf 事先排掉。
      // 不排掉的代價不是多幾個請求：CrowdSec 的 http-probing 情境在數 404，
      // 撞夠了整個 runner 的 IP 會被封，後續請求全部逾時（見 post-locales.ts）。
      if (res.status === 404) {
        skippedNoLocale++;
        continue;
      }
      if (!res.ok) {
        failures.push(`#${p.id} [${label(lang)}] 取內文失敗：HTTP ${res.status}`);
        continue;
      }
      const post = (await res.json()) as PostDetail;
      // markdown 的文章走另一條管線，不需要編譯
      if (post.format !== 'mdx') {
        skippedNotMdx++;
        continue;
      }
      if (!post.content?.trim()) {
        failures.push(`#${p.id} [${label(lang)}] format=mdx 但內文是空的`);
        continue;
      }
      try {
        await compileMdxSource(post.content);
        compiled++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`#${p.id} [${label(lang)}] ${post.title}\n      ${msg.split('\n')[0]}`);
        continue;
      }
      // 編得過不代表 render 得出來：用到沒註冊的 block，runSync 產出的程式碼會引用
      // undefined 元件 → 讀者打開才看到錯誤頁。在這裡先抓出來。
      const unknown = [...new Set([...stripCode(post.content).matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((x) => x[1]))]
        .filter((tag) => !registered.has(tag));
      if (unknown.length) {
        failures.push(`#${p.id} [${label(lang)}] ${post.title}\n      用到沒註冊的 block：${unknown.join(', ')}`);
      }
    }
  }

  console.log(`編譯成功 ${compiled}｜非 mdx 跳過 ${skippedNotMdx}｜該語系無此文 ${skippedNoLocale}`);
  if (failures.length) {
    console.error(`\n❌ ${failures.length} 篇編譯失敗——這些文章此刻在前台正靜默退回裸 markdown：\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log('\n✅ 全數編譯通過');
}

main().catch((e: unknown) => {
  console.error('check-mdx 執行失敗:', e instanceof Error ? e.message : e);
  process.exit(1);
});
