/**
 * 片庫頁 `/watch/library`。
 *
 * 這一頁把三個來源（動畫瘋 / 電影 / 影集）併成一個可切分頁的清單，切換、搜尋、
 * 排序全部在瀏覽器端做。原本 e2e 只有「這頁 render 得出來」，也就是三個分頁裡
 * 只要有一個是空的、或搜尋根本沒接上，測試都照樣綠。
 *
 * ⚠ 種子每個分頁各放三筆（見 seed.mjs）。只有一筆的時候排序與搜尋測不出東西。
 */

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const cards = (page: Page) => page.locator('.wl-card');
const titles = async (page: Page): Promise<string[]> =>
  (await page.locator('.wl-card-title').allInnerTexts()).map((s) => s.trim());

const tab = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

async function waitForLibrary(page: Page): Promise<void> {
  await expect(page.locator('.wl-page')).toBeVisible({ timeout: 15_000 });
  await expect(cards(page).first(), '預設的動畫分頁應該有種子資料').toBeVisible({ timeout: 15_000 });
}

test.describe('片庫', () => {
  test('三個分頁都切得過去，而且各自有東西', async ({ page }) => {
    await page.goto('/watch/library');
    await waitForLibrary(page);

    for (const name of ['動畫', '電影', '影集']) {
      const t = tab(page, name);
      await t.click();
      await expect(t).toHaveClass(/active/);

      // 分頁上的數字要跟實際列出的張數一致——不一致代表 counts 與 visible
      // 走的是不同的推導（例如去重只做了一邊），畫面上看起來卻很正常
      const badge = Number((await t.locator('.wl-tab-count').innerText()).trim());
      expect(badge, `「${name}」分頁的計數是 0，種子每類都有三筆`).toBeGreaterThan(0);
      await expect
        .poll(() => cards(page).count(), { message: `「${name}」分頁的計數與實際卡片數對不起來`, timeout: 10_000 })
        .toBe(badge);
    }
  });

  test('搜尋只留下標題吃得到關鍵字的，找不到時給空狀態', async ({ page }) => {
    await page.goto('/watch/library');
    await waitForLibrary(page);
    const total = await cards(page).count();
    expect(total).toBeGreaterThanOrEqual(3);

    const search = page.getByPlaceholder('搜尋標題…');
    await search.fill('Angel');
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(1);
    expect((await titles(page))[0]).toContain('Angel Beats');

    // 大小寫不該影響——使用者不會照著原標題的大小寫打
    await search.fill('angel');
    await expect
      .poll(() => cards(page).count(), { message: '搜尋沒有忽略大小寫', timeout: 10_000 })
      .toBe(1);

    await search.fill('這個一定找不到zzz');
    await expect(page.locator('.wl-info'), '找不到要講話，不是給一片空白').toContainText('沒有符合的結果', {
      timeout: 10_000,
    });

    await search.fill('');
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(total);
  });

  test('排序：標題 A→Z 與 Z→A 要互為顛倒', async ({ page }) => {
    await page.goto('/watch/library');
    await waitForLibrary(page);

    const trigger = page.locator('.wl-sort-trigger');
    const pick = async (label: string) => {
      await trigger.click();
      await page.locator('.wl-sort-item', { hasText: label }).click();
      await expect(trigger, '選完之後觸發鈕要顯示目前的排序').toContainText(label);
    };

    await pick('標題 A→Z');
    const asc = await titles(page);
    expect(asc.length).toBeGreaterThanOrEqual(3);

    // 同 bookshelf：驗「互為顛倒」而不是寫死順序，才不會被 ICU 定序的版本差異搞紅
    await pick('標題 Z→A');
    await expect
      .poll(async () => (await titles(page)).join('|'), {
        message: '切成 Z→A 之後順序沒有變',
        timeout: 10_000,
      })
      .toBe([...asc].reverse().join('|'));
  });

  test('切分頁的時候搜尋條件要一起套用，不是各算各的', async ({ page }) => {
    await page.goto('/watch/library');
    await waitForLibrary(page);

    // 「Angel Beats」只在動畫分頁。輸入它之後切到電影分頁，應該是空的——
    // 如果切分頁把搜尋字串留著、卻拿舊分頁的清單去篩，就會看到不屬於這個分頁的東西。
    await page.getByPlaceholder('搜尋標題…').fill('Angel');
    await expect.poll(() => cards(page).count(), { timeout: 10_000 }).toBe(1);

    await tab(page, '電影').click();
    await expect(page.locator('.wl-info')).toContainText('沒有符合的結果', { timeout: 10_000 });
    await expect(cards(page)).toHaveCount(0);
  });
});
