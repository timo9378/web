import { expect, test } from '@playwright/test';

/**
 * 文章頁的目錄（TOC）、scroll-spy 與閱讀進度。
 *
 * 為什麼需要：`BlogPost.tsx` 有 2337 行，而 e2e 只走到 16%——這三件是讀者每次看文章
 * 都會用到、壞了卻**不會報錯**的功能（目錄空掉、點了不跳、高亮不動、進度條不前進）。
 *
 * 挑選邏輯本身（哪個標題算 active、進度百分比怎麼算）已經抽成純函式在
 * `src/lib/blogReading.ts`，由單元測試逐個邊界驗。這裡守的是**接線**：
 * 標題有沒有真的長出 id、TOC 有沒有拿到同一份、捲動事件有沒有接上去。
 * 兩邊分工不重疊——單元測試餵的是座標，這裡餵的是真的捲動。
 *
 * 用 id=4（CLS 用的長文，36 節）是因為它是唯一夠長、捲得動、標題夠多的種子文章；
 * 短文章上 scroll-spy 沒有東西可以測。
 */

const POST = '/blog/4';

// TOC 是右側欄，窄視窗會收起來
test.use({ viewport: { width: 1600, height: 900 } });

const tocIds = (page: import('@playwright/test').Page) =>
  page.$$eval('.toc-item', (els) => els.map((e) => e.getAttribute('data-heading-id') ?? ''));

const headingIds = (page: import('@playwright/test').Page) =>
  page.$$eval('.post-content h1[id], .post-content h2[id], .post-content h3[id], .post-content h4[id]', (els) =>
    els.map((e) => e.id),
  );

test.describe('文章目錄', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(POST);
    await page.locator('.toc-item').first().waitFor({ timeout: 20_000 });
  });

  // 這條守的是整條鏈最容易斷的地方：TOC 與標題元素的 id 是同一個 slugify 算的，
  // 對不起來的話目錄看起來正常、點下去卻什麼都不會發生。
  // （韓文標題的 anchor id 曾經全部塌成 `-`，25 個標題有 14 個撞號。）
  test('目錄項目與內文標題逐字對應，順序也一樣', async ({ page }) => {
    const [toc, heads] = await Promise.all([tocIds(page), headingIds(page)]);
    expect(toc.length, '目錄是空的').toBeGreaterThan(5);
    expect(toc).toEqual(heads);
  });

  test('每個 anchor id 都不重複，也不會是空的或只有連字號', async ({ page }) => {
    const ids = await headingIds(page);
    expect(new Set(ids).size, `有重複的 id：${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`).toBe(ids.length);
    expect(ids.filter((id) => !id || /^-+$/.test(id))).toEqual([]);
  });

  test('點目錄會捲到對應的標題', async ({ page }) => {
    const ids = await headingIds(page);
    const target = ids[Math.floor(ids.length / 2)];
    await page.locator(`[data-heading-id="${target}"]`).click();
    // ⚠ 用屬性選擇器而不是 `#id`：id 是中文/韓文的 slug，`#` 選擇器要 CSS.escape，
    //   而那是**瀏覽器**的全域——在 spec 的 Node 端呼叫會 ReferenceError。
    //   屬性選擇器沒有這個問題。
    // 平滑捲動，等它停下來
    await expect
      .poll(async () => page.locator(`[id="${target}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().top)), {
        timeout: 10_000,
      })
      .toBeLessThan(250);
  });

  test('捲動時高亮會跟著換，而且永遠有一個是亮的', async ({ page }) => {
    const active = () => page.$$eval('.toc-item.active', (els) => els.map((e) => e.getAttribute('data-heading-id')));
    // ⚠ 初始高亮是 effect 裡 `setTimeout(handleScroll, 500)` 設的，不是第一幀就有。
    //   直接斷言會抓到還沒初始化的狀態。
    await expect.poll(async () => (await active()).length, { timeout: 10_000 }).toBe(1);
    const first = (await active())[0];

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
    await expect.poll(async () => (await active())[0], { timeout: 10_000 }).not.toBe(first);
    // 高亮消失比高亮沒換更糟：讀者會以為目錄壞了
    expect(await active(), '捲到一半時高亮不該消失').toHaveLength(1);
  });

  test('閱讀進度跟著捲動前進，捲到底接近 100%', async ({ page }) => {
    const pct = () =>
      page.locator('.reading-progress-fill').evaluate((el) => Number.parseFloat(getComputedStyle(el).width));
    const atTop = await pct();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(pct, { timeout: 10_000 }).toBeGreaterThan(atTop);
    await expect.poll(() => page.locator('.progress-text').innerText(), { timeout: 10_000 }).toMatch(/9\d|100/);
  });

  test('「回到頂端」真的回得去', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(0);
    await page.locator('.toc-bottom-link').click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeLessThan(50);
  });
});
