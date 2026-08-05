/**
 * 量「e2e 走過多少前端原始碼」。
 *
 * 做法：Playwright 收 V8 的 JS coverage → 用 build 產物的 source map 映回 src/ 的原始檔。
 * 量的是**瀏覽器真的執行到哪幾行**，不是「測試斷言了什麼」。兩者要分開看：
 * 這個數字高只代表程式碼被跑過，不代表它的行為被驗證過。
 *
 * 用法：
 *   pnpm build
 *   node tests/e2e/stack.mjs        # 另一個終端機
 *   node scripts/e2e-coverage.mjs
 *
 * ⚠ 這支是**走一遍路由**來近似 e2e 套件，不是跑真的 spec。真的 spec 會點進編輯器、
 *   切篩選器，走到這裡走不到的地方。要精確量的話，臨時做一個 fixture 把
 *   `page.coverage` 包進去、把 spec 的 import 指過去跑完再改回來——那個做法會動到
 *   18 個 spec 檔，不適合常駐在 repo 裡。實測兩者差距：這支 164 檔 / 67.8%，
 *   真 spec 200 檔 / 53.7%（真 spec 載入更多檔，但多出來的那些覆蓋率低）。
 *
 * ⚠ 兩個踩過的坑，改這支之前先讀：
 *   1. vite 用 `sourcemap: 'hidden'`——產物裡**沒有** sourceMappingURL 註解，
 *      v8-to-istanbul 自己找不到 map，必須照 `<檔名>.map` 的慣例手動餵。
 *      不餵它不會報錯，只會安靜地回 0 個檔。
 *   2. 過濾自家檔案要用**絕對路徑**。曾經寫成 `'src/' + abs.split('/src/').pop()`，
 *      結果第三方套件底下的 src 目錄也被重組成看似自家的路徑，排除規則永遠比對不到。
 *      （順帶一提：這一行原本寫了帶萬用字元的 node_modules 路徑，裡面的星號加斜線
 *      會把區塊註解提早收掉，後面整段變成程式碼——oxlint 才是第一個發現的。）
 */
import { chromium } from '@playwright/test';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import v8toIstanbul from 'v8-to-istanbul';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:13996';
const REPO = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO, '.output/public');
const SRC_ROOT = path.join(REPO, 'src') + path.sep;
const TOKEN_KEY = 'koimsurai_user_token';

/** 自己簽一個 OWNER token，這樣後台頁面也走得進去（用的是 e2e stack 的測試密鑰）。 */
function ownerToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ id: 1, username: 'cov', role: 'OWNER', iat: now, exp: now + 7200 });
  return `${head}.${body}.${createHmac('sha256', 'e2e-secret').update(`${head}.${body}`).digest('base64url')}`;
}

const PUBLIC = ['/', '/about', '/blog', '/blog/7', '/photos', '/setup', '/history', '/friends',
  '/bookshelf', '/watch', '/music', '/messages', '/about-site', '/journey', '/portfolio', '/activity'];
const ADMIN = ['/admin/dashboard', '/admin/posts', '/admin/tags', '/admin/categories', '/admin/comments'];

if (!fs.existsSync(OUT_DIR)) {
  console.error('找不到 .output/public——先跑 `pnpm build`。');
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();

const seedPage = await ctx.newPage();
await seedPage.goto(`${BASE}/`);
await seedPage.evaluate(([k, v]) => window.localStorage.setItem(k, v), [TOKEN_KEY, ownerToken()]);
await seedPage.close();

const page = await ctx.newPage();
await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });

for (const route of [...PUBLIC, ...ADMIN]) {
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45_000 });
    // 捲一遍逼出 lazy 區塊與掛在 IntersectionObserver 上的東西
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    process.stdout.write('.');
  } catch {
    process.stdout.write('x');
  }
}
console.log('');

const entries = await page.coverage.stopJSCoverage();
await browser.close();

const bySrc = new Map();
for (const e of entries) {
  const file = path.join(OUT_DIR, new URL(e.url, BASE).pathname);
  const mapFile = `${file}.map`;
  if (!fs.existsSync(file) || !fs.existsSync(mapFile)) continue;
  const conv = v8toIstanbul(file, 0, {
    source: e.source ?? fs.readFileSync(file, 'utf8'),
    sourceMap: { sourcemap: JSON.parse(fs.readFileSync(mapFile, 'utf8')) },
  });
  try {
    await conv.load();
  } catch {
    continue;
  }
  conv.applyCoverage(e.functions);
  for (const [abs, data] of Object.entries(conv.toIstanbul())) {
    if (!abs.startsWith(SRC_ROOT) || abs.includes('node_modules')) continue;
    const rel = path.relative(REPO, abs);
    // vite 的資產模組（圖片）也有 source map，內容是一行 `export default "…"`
    if (!/\.tsx?$/.test(rel) || /routeTree\.gen|\/ui\/|\/animate-ui\//.test(rel)) continue;
    const st = Object.values(data.s ?? {});
    if (!st.length) continue;
    const cur = bySrc.get(rel) ?? { covered: 0, total: 0 };
    cur.covered += st.filter((n) => n > 0).length;
    cur.total += st.length;
    bySrc.set(rel, cur);
  }
  conv.destroy();
}

// 完全沒被載入的檔根本不會出現在 V8 的清單裡。不補這一段，分母就只算「有載入的檔」，
// 覆蓋率會被灌水。
const allSrc = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!/\/(ui|animate-ui)$/.test(p)) walk(p);
      continue;
    }
    if (!/\.tsx?$/.test(ent.name) || /routeTree\.gen|\.test\.|\.d\.ts$/.test(p)) continue;
    allSrc.push(path.relative(REPO, p));
  }
})(path.join(REPO, 'src'));
const never = allSrc.filter((f) => !bySrc.has(f));

const rows = [...bySrc].map(([f, v]) => ({ f, ...v, pct: (v.covered / v.total) * 100 }));
const tot = rows.reduce((a, r) => ({ c: a.c + r.covered, t: a.t + r.total }), { c: 0, t: 0 });
const avg = tot.t / rows.length;

console.log(`\n檔案：${rows.length}/${allSrc.length} 有載入（${never.length} 個完全沒碰到）`);
console.log(`已載入檔的 statements：${tot.c}/${tot.t} = ${((tot.c / tot.t) * 100).toFixed(1)}%`);
console.log(`把沒載入的也算進分母（以平均檔案大小估）：約 ${((tot.c / (tot.t + avg * never.length)) * 100).toFixed(1)}%`);

if (never.length) {
  const byDir = {};
  for (const f of never) {
    const k = f.split('/').slice(0, 3).join('/');
    byDir[k] = (byDir[k] ?? 0) + 1;
  }
  console.log('\n完全沒碰到的：');
  for (const [k, v] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(2)}  ${k}`);
  }
}

console.log('\n覆蓋率最低的 14 個（>=30 statements）：');
for (const r of rows.filter((r) => r.total >= 30).sort((a, b) => a.pct - b.pct).slice(0, 14)) {
  console.log(`  ${r.pct.toFixed(0).padStart(3)}%  ${r.f}  (${r.covered}/${r.total})`);
}
