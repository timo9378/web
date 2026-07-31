/**
 * CLS（Cumulative Layout Shift）量測。
 *
 * ## 為什麼用 Playwright 而不是 Lighthouse
 *
 * Lighthouse 在這個專案上量不到真正的問題。同一頁在無節流本機跑是 CLS 0，開了節流
 * 還是 0（LCP 卻爆到 4.2s，證明節流確實有生效）——因為它永遠是冷啟動、無 history、
 * 單頁直接載入。而文章頁真正的 CLS 只在「重新整理且捲在深處」時才出現，任何
 * 「載入一次量一次」的工具都抓不到。
 *
 * ## 量的是什麼
 *
 * 用 `addInitScript` 在任何內容載入前裝好 layout-shift 的 PerformanceObserver，
 * 並且照 web-vitals 的 **session window** 演算法累加（5 秒窗、1 秒間隔、取最大窗），
 * 不是把所有 shift 加總——後者會高估，而且和實地 web_vitals 表裡的數字對不起來。
 *
 * 兩個情境：
 *   1. 冷載入：抓字體、圖片沒尺寸、動態插入這類標準成因
 *      （實地抓到過 TASA Explorer 那支 latin webfont 造成 0.0337 位移）
 *   2. 捲在深處按 F5：scroll restoration 搶在 SSR HTML 解析完之前還原位置
 *      （docH 從 2792 一路長到 7109 的那個成因，實地量到 0.4252）
 *
 * ## 門檻怎麼來的
 *
 * 不是猜的，是實際重複跑量變異數之後訂的——見各測試上方的註解。
 */

import { expect, test, type Page } from '@playwright/test';

/** Google 的 CLS 分級：≤0.1 good、≤0.25 needs improvement。 */
const GOOD = 0.1;

/**
 * 在任何內容載入前裝好觀測器。
 *
 * 這裡自己實作 session window 而不是引 web-vitals 套件：那個套件在 page context 裡
 * 要另外 bundle，而演算法本身只有十幾行。規則是 CLS 的定義：
 * 同一個 session window 內的 shift 累加，window 的上限是 5 秒、相鄰 shift 間隔上限
 * 是 1 秒，超過就開新 window；最終 CLS 取所有 window 的最大值。
 */
async function installClsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ShiftEntry extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node }[];
    }
    const w = window as unknown as {
      __cls: number;
      __clsEntries: { value: number; time: number; target: string }[];
    };
    w.__cls = 0;
    w.__clsEntries = [];

    let current = 0;
    let firstTs = 0;
    let lastTs = 0;

    const describe = (e: ShiftEntry): string => {
      const node = e.sources?.find((s) => s.node)?.node as Element | undefined;
      if (!node?.tagName) return '(不明)';
      const cls = typeof node.className === 'string' ? node.className.split(/\s+/)[0] : '';
      return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls ? `.${cls}` : ''}`;
    };

    new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const e = raw as ShiftEntry;
        // 使用者輸入 500ms 內造成的位移不算 CLS（規格如此，捲動本身不算）
        if (e.hadRecentInput) continue;
        if (current && (e.startTime - lastTs > 1000 || e.startTime - firstTs > 5000)) {
          current = 0; // 開新 session window
          firstTs = e.startTime;
        }
        if (!current) firstTs = e.startTime;
        lastTs = e.startTime;
        current += e.value;
        w.__cls = Math.max(w.__cls, current);
        w.__clsEntries.push({ value: e.value, time: Math.round(e.startTime), target: describe(e) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

interface ClsResult {
  cls: number;
  entries: { value: number; time: number; target: string }[];
  docHeight: number;
}

async function readCls(page: Page): Promise<ClsResult> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __cls: number;
      __clsEntries: { value: number; time: number; target: string }[];
    };
    return { cls: w.__cls, entries: w.__clsEntries, docHeight: document.documentElement.scrollHeight };
  });
}

/** 位移大的前幾筆，失敗訊息裡直接指出是哪個元素在動。 */
function blame(r: ClsResult): string {
  const top = [...r.entries].sort((a, b) => b.value - a.value).slice(0, 5);
  if (top.length === 0) return '（沒有任何 layout-shift 記錄）';
  return top.map((e) => `      ${e.value.toFixed(4)} @${e.time}ms  ${e.target}`).join('\n');
}

/**
 * 冷載入的 CLS。
 *
 * 本機重複量到的都是 0.0000（首頁 / 文章列表 / 長文），所以門檻訂在 GOOD 而不是
 * 貼著 0——共用 runner 上字體載入時序會抖，貼著 0 訂等於買一個假紅。
 * 真的退化（例如再冒出一支沒有 size-adjust 的 webfont）數量級是 0.03 以上，擋得到。
 *
 * 注意這一組**抓不到**下面那個情境。冷載入永遠是 0.0000，即使在 CLS 0.52 的版本上
 * 也一樣——這正是為什麼 Lighthouse 這類「載入一次量一次」的工具在這個專案上量不到
 * 真正的問題。
 */
for (const [path, label] of [
  ['/', '首頁'],
  ['/blog', '文章列表'],
  ['/blog/4', '長文章頁'],
] as const) {
  test(`冷載入不該有明顯位移：${label}`, async ({ page }) => {
    await installClsObserver(page);
    await page.goto(path, { waitUntil: 'load' });
    // 字體交換與圖片解碼都在 load 之後才發生，量太早會漏掉
    await page.waitForTimeout(2500);

    const r = await readCls(page);
    expect(r.cls, `${label} 冷載入 CLS=${r.cls.toFixed(4)}，位移來源：\n${blame(r)}\n`).toBeLessThan(GOOD);
  });
}

/**
 * **捲在深處按 F5**——這才是實地真正出事的情境。
 *
 * 重點在於必須自己編排，不能用「reload 一下量一下」的現成 API：
 * chrome-devtools 的 `performance_start_trace({reload: true})` 自己的重載**不帶捲動還原**，
 * 量文章頁只會得到 0.03；要重現就得先捲好、再 reload、再讀。Playwright 的 page.reload()
 * 走的是真的瀏覽器重載，scroll restoration 會生效。
 *
 * ## 這個測試一寫出來就抓到一個真的線上缺陷
 *
 * 第一次跑就是 0.5183，並且指名 `div#comments.post-extras`。線上同樣重現
 * （/blog/palworld-dedicated-server-docker：0.5266）。根因是 `.post-content` 上的
 * `content-visibility: auto` 把整篇文章塌成 1200px 佔位，於是捲動位置被還原到一個
 * docH=2904 的版面上，內容補齊後 docH 變 13157，視口內的東西整批被推走。
 * 修法與四項效能量測見 src/components/BlogPost.css 的註解。
 *
 * 門檻：修好之後本機重複跑的分佈是 0.0000，零變異（壞的版本也是零變異的 0.5183）。
 * 訂 GOOD 留了很大的餘裕，因為這個測試要擋的是「回歸到 0.5 那個量級」，
 * 不是守住小數點後三位。
 */
test('捲在文章深處重新整理，scroll restoration 不該造成位移', async ({ page }) => {
  await installClsObserver(page);
  await page.goto('/blog/4', { waitUntil: 'load' });

  // 先確認這篇真的夠長——頁面捲不動的話這個測試什麼都沒測到，
  // 而且會安靜地通過。這種「測試其實沒跑到」比測試失敗更糟。
  const { docHeight } = await readCls(page);
  const viewport = page.viewportSize()?.height ?? 720;
  expect(
    docHeight,
    `seed 的長文渲染後只有 ${docHeight}px（viewport ${viewport}px），捲不到深處＝這個測試沒有測到東西。` +
      `\n檢查 tests/e2e/seed.mjs 的 longArticle()。`,
  ).toBeGreaterThan(viewport * 3);

  // 捲到約三分之二處。
  //
  // ⚠ 這裡不能用「捲一下 + 固定等 600ms + 讀 scrollY」：TanStack 的 scrollRestoration
  //   在導航後也會設定捲動位置，跟這次 scrollTo 是在搶同一個狀態。CPU 一忙（整套 e2e
  //   平行跑的時候）router 的重設就會落在後面，把位置打回 0——實測三次整套裡失敗一次，
  //   而且失敗的是這一行前置步驟、不是 CLS 斷言本身。
  //   改成「捲完之後等 scrollY 真的到位並穩住」，等的是狀態不是秒數。
  const target = await page.evaluate(() => Math.round(document.documentElement.scrollHeight * 0.66));
  await expect
    .poll(
      async () => {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), target);
        await page.waitForTimeout(100);
        return page.evaluate(() => Math.round(window.scrollY));
      },
      {
        message: '捲動一直沒到位——router 的 scrollRestoration 可能還在把位置打回去',
        timeout: 10_000,
      },
    )
    .toBeGreaterThan(target * 0.9);
  const scrolledTo = await page.evaluate(() => window.scrollY);
  expect(scrolledTo, '捲動沒有生效').toBeGreaterThan(viewport);

  // 重新整理：瀏覽器會嘗試還原捲動位置，而 SSR 的 HTML 還在解析
  await installClsObserver(page); // reload 後是新的 document，要重裝
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const r = await readCls(page);
  const restored = await page.evaluate(() => window.scrollY);
  expect(
    r.cls,
    `重整後 CLS=${r.cls.toFixed(4)}（還原到 scrollY=${restored}，docH=${r.docHeight}）` +
      `\n位移來源：\n${blame(r)}\n`,
  ).toBeLessThan(GOOD);
});
