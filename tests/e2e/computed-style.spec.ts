/**
 * 計算後樣式的回歸守門。
 *
 * ## 為什麼不是截圖比對
 *
 * 截圖比對在這個專案測不準。實測噪音底線（同一份 build 跑兩次）：
 *   /blog/43   7810 px   ← mermaid 渲染時序
 *   /history    228 px
 * 而 /music 的專輯圖來自 Spotify CDN，根本固定不了。真正的 CSS 變化會被這些淹掉，
 * 設成門檻只會製造假紅——跟 lighthouserc.cjs 拒絕拿 performance 分數當門檻同一個理由。
 *
 * `getComputedStyle` 沒有這個問題：它是 cascade 的最終結果，跟圖片載到第幾張無關。
 *
 * ## 基準檔為什麼存 hash 而不是原值
 *
 * 8560 個元素 × 34 個屬性直接存是好幾 MB，每次改樣式都會產生巨大 diff。
 * 存 hash 之後基準檔只有幾十 KB，而「哪個元素變了」照樣指得出來——
 * 要知道「變成什麼」再跑一次本機比對即可。
 *
 * ## 動畫屬性為什麼排除
 *
 * transform / opacity / box-shadow / filter 在有動畫的元素上每一幀都不同，
 * 收進來就變成隨機紅。這幾個屬性的回歸靠人眼與 Lighthouse，不靠這支。
 *
 * ## 更新基準
 *
 *   UPDATE_STYLE_BASELINE=1 pnpm exec playwright test computed-style
 *
 * 改了樣式就要更新，並在 PR 裡說明「為什麼這些元素該變」。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './fixtures';
import { gotoAdmin, signIn } from './admin-session';
import type { Page } from '@playwright/test';

// 專案是 ESM（package.json 的 "type": "module"），沒有 __dirname。
//
// 一頁一個基準檔，不是全部塞一個 json：playwright 預設多 worker 平行跑，
// 共用一個檔案的話 afterAll 會互相覆蓋（第一版就是這樣，靠運氣才對）。
// 順帶的好處是改樣式時 diff 只會動到真正受影響的那幾頁。
const BASELINE_DIR = path.join(import.meta.dirname, 'computed-style.baseline');
const fileFor = (route: string) => path.join(BASELINE_DIR, `${route.replace(/\//g, '_') || '_root'}.json`);
const UPDATE = process.env.UPDATE_STYLE_BASELINE === '1';

const ROUTES = [
  '/', '/about', '/blog', '/photos', '/setup',
  '/history', '/friends', '/bookshelf', '/watch', '/messages', '/about-site',
];

/**
 * 後台頁面。
 *
 * ⚠ 加進來是因為這支測試漏掉了一次真實的回歸：升 Tailwind v4 之後，`AdminTheme.css`
 * 那條未分層的 `:where(…) button { padding:0; border-radius:0; font-size:inherit }`
 * 反過來壓死 `@layer utilities`（v4 用原生 cascade layer，未分層恆勝，跟特異性無關），
 * 後台每顆按鈕的 `px-3 py-2 rounded-md text-sm` 全部歸零、欄位擠成一團。
 * 上面那 11 條公開路由**一個像素都沒變**，所以整套 e2e 全綠——是使用者回報才發現的。
 *
 * `padding-*` / `border-radius` / `font-size` / `color` 本來就在 PROPS 裡，
 * 差的只是沒有任何一條測試打開過後台。
 *
 * 後台沒有密碼登入 UI（走 OAuth），所以照 admin-session.ts 自簽一個 OWNER token。
 * 每個路由要等的東西不一樣，用標題（編輯器那種沒有 <h1> 的頁面才需要另外處理）。
 */
const ADMIN_ROUTES: { route: string; heading: string | RegExp }[] = [
  { route: '/admin/dashboard', heading: /儀表板|Dashboard/ },
  { route: '/admin/posts', heading: /文章/ },
  { route: '/admin/tags', heading: '標籤管理' },
];

/**
 * 會被 !important / cascade 影響、且**不隨環境或動畫改變**的屬性。
 *
 * ⚠ 刻意排除的，每一條都是實際害這支測試在 CI 紅過的：
 *
 *   width / height          —— `auto` 的解析值取決於文字寬度
 *   margin-left / -right    —— 同上（`margin: auto` 置中時解出來的是「剩餘空間」）
 *   line-height             —— `normal` 的解析值直接取自字體度量
 *   transform / opacity /
 *   box-shadow / filter     —— 動畫元素上逐幀不同
 *
 * 前三類的共通點是**依賴字體度量**，而 CI runner 沒有這台機器上的 CJK 字體
 * （MiSans / Noto Sans TC / PingFang TC…），fallback 不同 → 文字寬度不同 → 數字就不同。
 * 實測 /setup 的 `.setup-category-subtitle` 本機 margin-left 是 687.906px，CI 不是。
 *
 * margin-top / -bottom 留著：一般流裡 `margin: auto` 的垂直方向解析成 0，不受影響。
 */
const PROPS = [
  'background-color', 'background-image', 'color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-radius', 'outline-color', 'outline-width', 'outline-style',
  'display', 'visibility', 'font-family', 'font-size', 'font-weight',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-bottom',
  'text-decoration-line', 'text-align', 'flex-direction', 'justify-content', 'align-items',
];

/**
 * 排除隨機產生的裝飾背景。
 *
 * RandomComets / RandomShootingStars / RandomUFOs 產生的元素**數量本身是隨機的**，
 * 所以 DOM 路徑每次載入都不一樣——收進來的話首頁每跑必紅（實測 700 個元素）。
 * 這份清單跟 index.css 裡 `html.fs-active` 那條隱藏規則的對象一致。
 */
const DECORATIVE = [
  '.css-starfield', '.nebula-bg', '.nebula-dust', '.nebula-dim-overlay',
  '.foreground-stars-container', '.comet', '.shooting-star', '.ufo',
  '.cursor-trail-canvas', '.intro-overlay', '.starfield-gpu',
  // ⚠ 熱力圖是**跟著日曆走**的，不是樣式。格線錨在 `new Date()`（見 Blog.tsx 的 `cells`
  //   與 Activity 的 gridFromEvents），所以每過一天就有一格從「未來」翻成「過去」
  //   （`heatmap-level--1` → `heatmap-level-0`），背景色跟著變。
  //
  //   後果是**基準檔每天都會過期**：2026-08-05 產的基準，08-06 一跑就報「1 個元素變了」，
  //   而那一格正是「今天」。追查過一輪才發現不是任何一次改動造成的——
  //   guard 本身把一個時間相依的東西收進了快照。
  //
  //   排除它不會漏掉真回歸：格子的配色規則若真的改了，會是**整排**一起變，
  //   而 CSS 檔的改動本來就會反映在別的元素上。
  '.heatmap-cell', '.heatmap-day',
];

/**
 * 等 DOM 不再變動。
 *
 * `networkidle` + 固定 sleep 不夠：首頁的 Hero 有 JS 打字機（useTypingEffect，
 * 延遲 900ms 開始、每字 80ms），而**CSS 的 `animation:none` 停不掉 setInterval**。
 * 早收的話會抓到打到一半的 DOM，元素路徑跟著位移——實測首頁因此間歇性報 34~688
 * 個「變化」，而那是純粹的假紅。
 *
 * 用「連續 N 次快照相同」而不是固定等待：慢的機器等久一點，快的機器不用白等。
 */
async function waitForDomStable(page: Page, { stableFor = 3, interval = 250, timeout = 15000 } = {}) {
  const started = Date.now();
  let last = '';
  let stable = 0;
  while (Date.now() - started < timeout) {
    const now = await page.evaluate(() => `${document.body.innerHTML.length}:${document.querySelectorAll('body *').length}`);
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= stableFor) return;
    await page.waitForTimeout(interval);
  }
}

async function collect(page: Page): Promise<Record<string, string>> {
  return page.evaluate(({ props, skip }) => {
    const out: Record<string, string> = {};
    const pathOf = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 12; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName}:${i}`);
      }
      return parts.join('>');
    };
    const skipSel = skip.join(',');
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest(skipSel)) continue;
      const cs = getComputedStyle(el);
      out[pathOf(el)] = props.map((p) => cs.getPropertyValue(p)).join('|');
    }
    return out;
  }, { props: PROPS, skip: DECORATIVE });
}

/**
 * 純十進位的 hash。
 *
 * ⚠ 不要改回 base64url 或 hex。那兩種編碼會在基準檔裡湊出看起來像英文單字的片段，
 * 而 `typos` 掃整個 repo（含這些 json），會把它們判成拼錯讓 Backend job 變紅——實際
 * 發生過。加白名單可以解決，但那等於為了一個純機械產物去放寬錯字檢查。
 * 十進位數字結構上就撞不到任何字母。
 */
const hash = (s: string) => BigInt(`0x${createHash('sha1').update(s).digest('hex').slice(0, 16)}`).toString();

/**
 * 收集並與基準比對。抽出來是因為後台路由的「怎麼到那一頁」不一樣（要先自簽 token），
 * 但「到了之後怎麼比」完全相同——抄一份的下場是其中一份會慢慢跟另一份不一樣。
 */
async function compareWithBaseline(page: Page, route: string) {
  // 動畫關掉：不關的話 transition 中途的值會混進來
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
  await waitForDomStable(page);

  const raw = await collect(page);
  const hashed: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) hashed[k] = hash(v);

  const file = fileFor(route);
  if (UPDATE) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    // 排序後輸出：元素順序不影響語意，但排過的檔案 diff 才讀得懂
    const sorted = Object.fromEntries(Object.entries(hashed).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
    return;
  }

  expect(fs.existsSync(file), `${route} 沒有基準檔——新增頁面要先跑一次更新`).toBe(true);
  const want = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;

  // ⚠ 只比對「兩邊都存在」的路徑。
  //
  // 只出現在一邊的路徑代表 DOM 結構不同，而**CSS 改不動 DOM**——那種差異一定來自
  // 資料或時序。實際踩過：種子資料的時間戳是相對的，首頁「最近更新」清單的項目數
  // 因此會隨「跑的時間」變，本機產的基準拿到 CI 就報 4 個元素變了（重試也一樣紅，
  // 所以不是 flaky，是結構差異被誤判成樣式差異）。
  //
  // 忽略它們不會漏掉真的回歸：樣式回歸一定發生在「同一個元素、值變了」。
  const onlyOneSide: string[] = [];
  const changed: string[] = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(hashed)])) {
    if (want[k] === undefined || hashed[k] === undefined) { onlyOneSide.push(k); continue; }
    if (want[k] !== hashed[k]) changed.push(k);
  }
  if (onlyOneSide.length) {
    console.log(`${route}：${onlyOneSide.length} 個路徑只存在一邊（DOM 結構差異，非樣式），已略過`);
  }
  expect(
    changed.slice(0, 20),
    `${route}：${changed.length} 個元素的計算後樣式變了（另有 ${onlyOneSide.length} 個路徑只存在一邊，` +
      `那是 DOM 結構差異不算）。若是預期中的改動：\n` +
      `  UPDATE_STYLE_BASELINE=1 pnpm exec playwright test computed-style\n` +
      `並在 PR 說明為什麼這些元素該變。`,
  ).toEqual([]);
}

test.describe('計算後樣式沒有非預期的變化', () => {
  for (const route of ROUTES) {
    test(`${route} 的計算後樣式與基準一致`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await compareWithBaseline(page, route);
    });
  }
});

test.describe('後台的計算後樣式沒有非預期的變化', () => {
  for (const { route, heading } of ADMIN_ROUTES) {
    test(`${route} 的計算後樣式與基準一致`, async ({ page }) => {
      await signIn(page);
      await gotoAdmin(page, route, heading);
      await compareWithBaseline(page, route);
    });
  }
});
