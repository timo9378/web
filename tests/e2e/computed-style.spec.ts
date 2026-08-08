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
 * 存 hash 之後基準檔只有幾十 KB，而「哪個元素變了」照樣指得出來。
 *
 * ⚠ 代價是**報錯訊息本身不能只有 hash 與路徑**。只給
 * `HTML:0>BODY:1>DIV:0>…>DIV:0` 的話，讀的人唯一能做的事是接受新基準，
 * 而一個只能按接受的守門會慢慢變成裝飾。實際發生過：為了查一次報紅，
 * 得另外寫一支一次性的 spec 把路徑走回元素，才知道那是**留言區的 loading 狀態**
 * ——跟 CSS 無關的時序差異，卻長得跟樣式回歸一模一樣。
 *
 * 所以 `collect()` 會順便收元素身分（tag/id/class + 一小段文字），失敗時連同
 * **現在的屬性值**一起印出來。身分不進基準檔、不參與比對，純粹是給人看的。
 * 「之前是什麼值」仍然講不出來（那要存原值），但「這是哪個元素、現在長什麼樣」
 * 通常就夠判斷了——因為看的人剛改過 CSS，知道自己動了什麼。
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
  // ⚠ `/blog/5` 是**文章內頁**，跟上面的 `/blog`（清單頁）是兩套完全不同的 CSS。
  //
  // 加它是因為守備範圍差太多：`BlogPost.css` 有 **3317 行**，是全專案最大的一支，
  // 而在此之前**沒有任何一條路由會載到它**——清單頁走的是 Blog.css。
  // 也就是說整個文章頁的排版（內文、程式碼區塊、圖表、目錄、留言）改壞了，
  // 這道守門一個字都不會說。後台那三條當初就是因為同樣的理由補進來的（見下面的說明）。
  //
  // 挑 5 而不是別篇：種子資料裡只有它同時有**程式碼區塊、mermaid 圖表、圖片**
  // 三種內容（見 seed.mjs），也就是文章頁最容易出事的那幾塊都在同一頁上。
  '/blog/5',
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

/**
 * 收樣式，同時收「這個路徑是哪個元素」。
 *
 * ⚠ `ids` 不進基準檔，也不參與比對——它只在報錯時用。
 *
 * 為什麼需要它：基準檔存的是 hash，所以測試紅的時候只講得出
 * `HTML:0>BODY:1>DIV:0>DIV:1>MAIN:1>DIV:0>DIV:2>DIV:1>DIV:2>DIV:0>DIV:1>DIV:0` 變了，
 * 而那串東西無法回答任何問題。實際發生過：為了查一次報紅，得另外寫一支
 * 一次性的 spec 去把那條路徑走回元素，才知道它是**留言區的 loading 狀態**
 * ——一個跟 CSS 完全無關的時序差異。
 *
 * 那次之後這個守門的可用回應只剩「接受新基準」，而一個只能按接受的守門會慢慢變成裝飾。
 *
 * ⚠ 不能在報錯時「照路徑從 documentElement 走回去」——`pathOf` 有 12 層上限，
 *   深的元素路徑是**截斷**的，第一段不一定是 `HTML`。所以身分必須在採樣的同一次
 *   `evaluate` 裡跟著算出來，那時手上還有元素本身。
 */
async function collect(page: Page): Promise<{ values: Record<string, string>; ids: Record<string, string> }> {
  return page.evaluate(({ props, skip }) => {
    const values: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const pathOf = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 12; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName}:${i}`);
      }
      return parts.join('>');
    };
    // `className` 在 SVG 元素上是 SVGAnimatedString 而不是字串——直接 split 會炸，
    // 而炸在 evaluate 裡的訊息很難讀。用 classList 就沒有這個分岔。
    const idOf = (el: Element) => {
      const cls = [...el.classList].join('.');
      const tag = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (cls ? `.${cls}` : '');
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
      return text ? `${tag} 「${text}」` : tag;
    };
    const skipSel = skip.join(',');
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest(skipSel)) continue;
      const cs = getComputedStyle(el);
      const p = pathOf(el);
      values[p] = props.map((x) => cs.getPropertyValue(x)).join('|');
      ids[p] = idOf(el);
    }
    return { values, ids };
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
 * 每個屬性各兩位十進位數字，串成一條「指紋」。基準檔每筆存成 `<hash> <指紋>`。
 *
 * 為什麼要有它：只有整體 hash 的話，報錯只能講「這個元素變了」，講不出**哪個屬性**變了。
 * 而 PROPS 有 31 個，把 31 個值全印出來反而更難讀——真正變的那一個會被淹掉
 * （第一版就是這樣，footer 連結的 `color` 夾在 30 條 `0px` / `none` 中間）。
 *
 * ⚠ **比對用的仍然是前面那個完整 hash，不是這條指紋。**
 * 兩位數字每個屬性有 1/100 的碰撞機率，拿來當門檻會漏掉真回歸；
 * 但當提示用剛好——碰撞只會讓某個變了的屬性**沒被標記出來**，
 * 不會反過來把沒變的說成變了（值一樣 → 數字必定一樣）。
 * 也就是說最壞情況是提示少講一條，門檻本身仍然是準的。
 *
 * ⚠ 只能用十進位。base36 / hex 會在基準檔裡湊出像英文單字的片段，而 `typos` 掃整個
 *   repo 含這些 json——理由同上面 `hash()` 的註解，那是真的發生過的 CI 紅。
 *
 * 成本：每筆多 62 個字元。基準檔平均每筆 97 bytes（大部分是那條 DOM 路徑），
 * 所以整體約從 477 KB 長到 790 KB——換到「哪個屬性變了」很划算。
 */
const PROP_DIGITS = 2;
const fingerprint = (values: string[]) =>
  values.map((v) => hash(v).slice(-PROP_DIGITS).padStart(PROP_DIGITS, '0')).join('');

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

  const { values: raw, ids } = await collect(page);
  // 每筆存 `<整體 hash> <每屬性兩位數字的指紋>`：前者是門檻，後者只在報錯時拿來指出屬性。
  const hashed: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) hashed[k] = `${hash(v)} ${fingerprint(v.split('|'))}`;

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
  // ⚠ 門檻只看空白前面那個完整 hash。後面的指紋是給人看的提示，
  //   兩位數字會碰撞，拿它當門檻會漏掉真回歸（理由見 fingerprint 的註解）。
  const hashOf = (v: string | undefined) => v?.split(' ')[0];
  const fpOf = (v: string | undefined) => v?.split(' ')[1] ?? '';

  const onlyOneSide: string[] = [];
  const changed: string[] = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(hashed)])) {
    if (want[k] === undefined || hashed[k] === undefined) { onlyOneSide.push(k); continue; }
    if (hashOf(want[k]) !== hashOf(hashed[k])) changed.push(k);
  }
  if (onlyOneSide.length) {
    // 也附幾個身分：只有數字的話，這行永遠只是雜訊；帶上元素才看得出「哦，是留言區還沒載完」。
    const sample = onlyOneSide.slice(0, 3).map((k) => ids[k] ?? '(只在基準裡，這次沒出現)');
    console.log(
      `${route}：${onlyOneSide.length} 個路徑只存在一邊（DOM 結構差異，非樣式），已略過` +
        `${sample.length ? `　例：${sample.join('、')}` : ''}`,
    );
  }

  // 報錯時把「哪個元素、哪個屬性、現在是什麼值」講出來。
  //
  // 只給 DOM 路徑的話，讀的人唯一能做的事就是接受新基準——那等於這道門沒有守。
  // 「之前是什麼值」仍然講不出來（基準只存 hash，要講前後差異就得存原值，
  // 那是好幾 MB 與每次改樣式都爆炸的 diff，見檔頭的取捨）。但實務上
  // 「哪個元素 + 哪個屬性 + 現在是什麼」已經夠判斷了，因為看的人剛改過 CSS。
  const detail = changed.slice(0, 8).map((k) => {
    const vals = raw[k].split('|');
    const oldFp = fpOf(want[k]);
    const newFp = fpOf(hashed[k]);
    const moved = PROPS
      .map((p, i) => ({ p, v: vals[i], i }))
      .filter(({ i }) => oldFp.slice(i * PROP_DIGITS, (i + 1) * PROP_DIGITS)
        !== newFp.slice(i * PROP_DIGITS, (i + 1) * PROP_DIGITS));
    // 指紋碰撞（1/100）時 moved 可能是空的——那就退回列出全部，總比什麼都不講好
    const shown = moved.length ? moved : PROPS.map((p, i) => ({ p, v: vals[i], i }));
    return `  · ${ids[k] ?? '(?)'}\n      ${k}\n      ${moved.length ? '變了的屬性' : '（指紋碰撞，列出全部）'}：` +
      shown.map(({ p, v }) => `${p} = ${v}`).join('、');
  }).join('\n');

  expect(
    changed.slice(0, 20),
    `${route}：${changed.length} 個元素的計算後樣式變了（另有 ${onlyOneSide.length} 個路徑只存在一邊，` +
      `那是 DOM 結構差異不算）。\n` +
      `${detail}${changed.length > 8 ? `\n  …另外還有 ${changed.length - 8} 個` : ''}\n\n` +
      `若是預期中的改動：\n` +
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
