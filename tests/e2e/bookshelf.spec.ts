/**
 * 書櫃頁 `/bookshelf` 的搜尋與篩選。
 *
 * 這一頁的四個條件（關鍵字、狀態、評分、排序）是**在瀏覽器端**推導出清單的，
 * 後端只回一份完整書單。也就是說整段邏輯完全在 `Bookshelf.tsx` 的 useMemo 裡，
 * 後端測試一條都涵蓋不到，而它壞掉的樣子是「篩了但沒變」或「篩到空的」——
 * 兩種都不會噴錯，只會讓讀者覺得這頁怪怪的。
 *
 * ⚠ 種子刻意放了四本（見 seed.mjs）：三種 reading_status、有評分與沒評分、
 *   ASCII 與中文標題各有。書少於這個數量時下面的斷言會「綠得沒有意義」——
 *   兩本書的狀態篩選剩一本、排序反轉只有兩個元素，任何實作都會過。
 */

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('.book-card');
const titles = async (page: Page): Promise<string[]> =>
  (await page.locator('.book-card .book-title').allInnerTexts()).map((s) => s.trim());

/** 篩選面板預設收起來，三個 select 都在裡面。 */
async function openFilters(page: Page): Promise<void> {
  const panel = page.locator('.filter-panel');
  if (!(await panel.isVisible())) await page.locator('.filter-toggle').click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
}

// select 沒有跟 <label> 綁 htmlFor，getByLabel 抓不到。用「有哪個 option」來認人，
// 比 nth(0)/nth(1) 穩：欄位順序調換不會讓測試指到錯的那個。
const statusSelect = (page: Page) => page.locator('.filter-panel select:has(option[value="read"])');
const sortSelect = (page: Page) => page.locator('.filter-panel select:has(option[value="title_asc"])');

test.describe('書櫃', () => {
  test('關鍵字搜尋標題與作者，清除鈕還原', async ({ page }) => {
    await page.goto('/bookshelf');
    await expect(cards(page).first(), '種子有四本書').toBeVisible({ timeout: 15_000 });
    const total = await cards(page).count();
    expect(total, '書少於三本的話底下的篩選測試就沒有鑑別力了').toBeGreaterThanOrEqual(3);

    const search = page.locator('.search-input');
    await search.fill('Zero');
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(1);
    expect((await titles(page))[0]).toContain('Zero to One');

    // 作者也要吃得到——只比對標題的話，「想找某個作者寫的書」這個用法整個失效
    await search.fill('村上');
    await expect.poll(() => cards(page).count(), { message: '搜尋沒有涵蓋作者欄', timeout: 10_000 }).toBe(1);
    expect((await titles(page))[0]).toContain('海邊的卡夫卡');

    // 找不到的時候要講話，不是給一片空白
    await search.fill('這本書不存在zzz');
    await expect(page.locator('.no-books'), '搜不到要有空狀態文案').toBeVisible({ timeout: 10_000 });

    await page.locator('.clear-search').click();
    await expect(search).toHaveValue('');
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(total);
  });

  test('狀態篩選只留下該狀態的書，清除篩選會全部回來', async ({ page }) => {
    await page.goto('/bookshelf');
    await expect(cards(page).first()).toBeVisible({ timeout: 15_000 });
    const total = await cards(page).count();

    await openFilters(page);
    await statusSelect(page).selectOption('reading');
    await expect.poll(() => cards(page).count(), { message: '狀態篩選沒有生效', timeout: 10_000 }).toBeLessThan(total);

    // 留下來的每一張都得真的是「在讀」——只數數量的話，篩選條件寫錯欄位也會過
    const badges = await page.locator('.book-card .status-badge').allInnerTexts();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.trim(), '篩「閱讀中」卻混進別的狀態').toBe('閱讀中');

    await page.locator('.clear-filters').click();
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(total);
  });

  test('排序：標題升冪與降冪要互為顛倒', async ({ page }) => {
    await page.goto('/bookshelf');
    await expect(cards(page).first()).toBeVisible({ timeout: 15_000 });
    await openFilters(page);

    // 驗「互為顛倒」而不是驗某個寫死的順序：後者等於把 localeCompare 對中文的
    // 定序抄進測試裡，換一版 ICU 就會紅，而那不是回歸。
    await sortSelect(page).selectOption('title_asc');
    await expect.poll(async () => (await titles(page)).join('|'), { timeout: 10_000 }).not.toBe('');
    const asc = await titles(page);

    await sortSelect(page).selectOption('title_desc');
    await expect
      .poll(async () => (await titles(page)).join('|'), {
        message: '切成降冪之後順序沒有變——sortBy 可能沒接上',
        timeout: 10_000,
      })
      .toBe([...asc].reverse().join('|'));
  });

  test('點書開得了詳情，關得掉', async ({ page }) => {
    await page.goto('/bookshelf');
    const first = cards(page).first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    const name = (await first.locator('.book-title').innerText()).trim();

    const modal = page.locator('.modal-content');
    // 同 blog-post.spec.ts：SSR 出來的卡片在 React 接上 onClick 之前就可點，
    // 那一下點擊會安靜地什麼都不做，所以要重試——但先問「是不是已經開了」。
    await expect(async () => {
      if (!(await modal.isVisible())) await first.click();
      await expect(modal).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000, intervals: [200, 400, 800, 1500] });

    await expect(modal, '開的要是剛剛點的那一本').toContainText(name);

    await page.locator('.modal-close').click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
  });
});
