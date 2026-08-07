// 產生「把既有文章的圖片網址補上 &w=&h=」的 migration。
//
// 為什麼要回填：上傳端從 2026-08 起才把原始尺寸寫進 URL fragment，在那之前上傳的
// 圖片只有 `#th=<hash>`。前端拿不到尺寸就寫不出 `<img width height>`，而那是文章頁
// CLS 的唯一解藥（見 src/components/gallery/ImageLightbox.tsx 的 decodeSizeFromSrc）。
//
// 為什麼是 migration 而不是走 CMS API：這只換網址片段，不碰 MDX 內容結構——
// 用 SQL 的 REPLACE 精準且可重跑，走 API 得把整篇內容讀出來重寫再存回去，
// 任何一次序列化差異都會動到不該動的東西。0013_simkl_poster_backfill.sql 是同樣的先例。
//
// 用法：node scripts/gen-image-size-migration.mjs > backend/migrations/00XX_....sql
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SITE = process.env.SITE_URL ?? 'https://koimsurai.com';
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? '/mnt/hdd16tb_01/Blog/uploads';
/** 文章內容的欄位（原文 + 四個語系），回填要一起做，否則譯文版照樣位移 */
const COLS = ['content', 'content_en', 'content_ja', 'content_ko', 'content_zh_cn'];

const listRes = await fetch(`${SITE}/api/posts?limit=500`);
const { posts } = await listRes.json();

/** 所有語系的內容裡出現過的 /uploads 網址 */
const urls = new Set();
for (const p of posts) {
  for (const lang of ['', 'zh-CN', 'en', 'ja', 'ko']) {
    const u = lang ? `${SITE}/api/posts/${p.id}?lang=${lang}` : `${SITE}/api/posts/${p.id}`;
    const res = await fetch(u);
    if (!res.ok) continue;
    const d = await res.json();
    for (const m of (d.content ?? '').matchAll(/\/uploads\/[^\s)"'`\]]+/g)) urls.add(m[0]);
    await new Promise((s) => setTimeout(s, 100)); // 別把自己撞封了（見 post-locales.ts）
  }
}

const rows = [];
const skipped = [];
for (const url of [...urls].sort()) {
  if (!url.includes('#th=')) continue; // 沒有 thumbhash 的不是走上傳管線進來的
  if (/[#&]w=\d+/.test(url) && /[#&]h=\d+/.test(url)) continue; // 已經有了
  const rel = url.slice('/uploads/'.length).split('#')[0];
  const file = path.join(UPLOAD_ROOT, decodeURIComponent(rel));
  if (!fs.existsSync(file)) { skipped.push(`${rel}（檔案不存在）`); continue; }
  try {
    const { width, height } = await sharp(file).metadata();
    if (!width || !height) { skipped.push(`${rel}（讀不到尺寸）`); continue; }
    rows.push({ url, width, height });
  } catch (e) {
    skipped.push(`${rel}（${e instanceof Error ? e.message : e}）`);
  }
}

const esc = (s) => s.replace(/'/g, "''");
const out = [];
out.push('-- 既有文章的圖片網址補上原始尺寸（&w=&h=）。');
out.push('--');
out.push('-- 上傳端從 2026-08 起才寫入尺寸；在那之前的圖片只有 `#th=<hash>`，');
out.push('-- 前端因此寫不出 `<img width height>`，而那是文章頁 CLS 的唯一解藥：');
out.push('-- 圖片外層是 `width: fit-content`，圖載入前固有寬度是 0 → aspect-ratio');
out.push('-- 反推的高度也是 0 → 盒子塌掉 → 圖載入時底下內容整片位移。');
out.push('-- 實測正式站「捲到 4000px 後重整」CLS 0.3362，補上尺寸後歸零。');
out.push('--');
out.push('-- 每一條都帶 `NOT LIKE` 守衛 → 重跑不會把 &w=&h= 疊上去（migration 只跑一次，');
out.push('-- 但手動重放或還原後重跑是真的會發生的事）。');
out.push('');
for (const { url, width, height } of rows) {
  const from = url;
  const to = `${url}&w=${width}&h=${height}`;
  for (const col of COLS) {
    out.push(
      `UPDATE posts SET ${col} = REPLACE(${col}, '${esc(from)}', '${esc(to)}')\n` +
      `  WHERE ${col} LIKE '%${esc(from)}%' AND ${col} NOT LIKE '%${esc(from)}&w=%';`,
    );
  }
  out.push('');
}
console.log(out.join('\n'));
console.error(`回填 ${rows.length} 個網址 × ${COLS.length} 個欄位；跳過 ${skipped.length} 個`);
for (const s of skipped.slice(0, 10)) console.error(`  跳過：${s}`);
