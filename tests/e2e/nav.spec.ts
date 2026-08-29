/**
 * 兩個「找路」的入口：⌘K 指令面板與行動版選單。
 *
 * 兩者的共通點是**壞掉的時候完全看不出來**——指令面板沒接上快捷鍵就只是「按了沒反應」，
 * 行動版選單的展開列沒接上就只是「點了不會開」。桌機版的 mega menu 有 hover 觸發、
 * smoke 測試也走得到，這兩個沒有任何東西覆蓋。
 *
 * 指令面板還有一個容易壞的細節：三個資料來源（文章／分類／標籤）是 `enabled: open`
 * 才抓的，所以它們的載入時序跟頁面本身無關，開啟之後要等一下才會出現。
 */

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

// ⚠ 必須指定，不能靠預設。Playwright 的瀏覽器預設是 en-US，而首頁 `/` 會依
//   Accept-Language 在 server 端 302 到 `/en`（見 src/routes/index.tsx）——
//   於是整個外殼變英文，底下所有中文斷言都會找不到元素，而錯誤訊息只會說
//   「element(s) not found」，完全指不到真正的原因（我就這樣繞了一圈）。
//   那條導向本身是對的行為，另有測試守著（見 locale-and-filters.spec.ts）。
test.use({ locale: 'zh-TW' });

const palette = (page: Page) => page.locator('.cmdk-backdrop');

/** ⌘K 在 Linux/CI 上是 Control+K。開關由 window 上的 keydown 監聽器接，要等它掛上。 */
async function openPalette(page: Page): Promise<void> {
  await expect(async () => {
    if (!(await palette(page).isVisible())) await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [200, 400, 800, 1500] });
}

test.describe('指令面板', () => {
  test('Ctrl+K 開得起來，Esc 與點遮罩都關得掉', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);
    await expect(page.getByPlaceholder('輸入頁面、文章、分類或標籤…')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0, { timeout: 10_000 });

    // 點遮罩本身要關；點面板內部不能關（判斷靠 e.target === e.currentTarget）
    await openPalette(page);
    await page.locator('.cmdk-wrap').click({ position: { x: 5, y: 5 } });
    await expect(palette(page), '點在面板內部不該把它關掉').toBeVisible();
    await palette(page).click({ position: { x: 5, y: 5 } });
    await expect(palette(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('打字篩得到頁面，Enter 走得過去', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);

    // 'bookshelf' 只出現在「書櫃」那一筆的 keywords 裡，不會撞到別的項目
    await page.keyboard.type('bookshelf');
    const items = page.locator('[cmdk-item]');
    await expect(items).toHaveCount(1, { timeout: 10_000 });
    await expect(items.first()).toContainText('書櫃');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/bookshelf$/, { timeout: 15_000 });
    await expect(palette(page), '走過去之後面板要自己關掉').toHaveCount(0);
  });

  test('文章也在索引裡，選了會開到那一篇', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);

    // 文章／分類／標籤是 `enabled: open` 才抓的，所以要等——這也正是這條要守的東西：
    // 那三個 query 若沒接上，面板只會剩下九個靜態頁面，而畫面上看起來很正常。
    await page.keyboard.type('第二篇');
    const item = page.locator('[cmdk-item]', { hasText: '第二篇測試文章' });
    await expect(item, '面板應該搜得到文章，不是只有靜態頁面').toBeVisible({ timeout: 15_000 });

    await item.click();
    await expect(page).toHaveURL(/\/blog\/2$/, { timeout: 15_000 });
  });

  test('搜不到東西時給空狀態，不是一片空白', async ({ page }) => {
    await page.goto('/');
    await openPalette(page);
    await page.keyboard.type('zzz這個一定搜不到zzz');
    await expect(page.locator('.cmdk-empty')).toContainText('沒有相符的結果', { timeout: 10_000 });
  });
});

/**
 * 行動版選單。
 *
 * ⚠ 這裡**不能**用 `toBeVisible()` / `toBeHidden()` 判斷開關，兩層都不行：
 *
 *   · 外層 `.mnav` 收起來時是 `max-height: 0` + `opacity: 0`，但 `max-height`
 *     不裁 padding —— 底部 10px 的 safe-area padding 加 1px 邊框讓它還有 11px 高，
 *     Playwright 因此判定「可見」。使用者當然看不到（opacity 0、pointer-events none、
 *     整塊 inert），但那個 11px 讓可見性斷言永遠是真。
 *   · 內層 `.mnav-sub-wrap` 用 `grid-template-rows: 0fr` 收合，容器高度是 0，
 *     可是裡面的 `<a>` 自己仍有 48px 的 box —— Playwright 看的是元素自身，
 *     於是收合中的子連結也被判定為「可見」。
 *
 * 所以改成斷言真正的契約：外層看 `inert`（它才是「這塊不能互動」的來源），
 * 內層看收合容器自己的高度（那正是使用者看到的東西）。
 */
test.describe('行動版選單', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const menu = (page: Page) => page.locator('.mnav');
  // ⚠ 一定要跟 null 比。`inert` 是布林屬性，存在時 getAttribute 回的是**空字串**，
  //   而 `!''` 是 true —— 寫成 `!(await getAttribute('inert'))` 會把「收起來」讀成
  //   「打開了」，於是底下的重試迴圈一次都不會按，最後錯誤訊息卻是
  //   「header intercepts pointer events」（因為選單根本沒展開，按鈕還在 header 底下）。
  const isOpen = async (page: Page) => (await menu(page).getAttribute('inert')) === null;

  /** 漢堡鈕在 hydrate 之前按下去不會有反應（理由見 blog-post.spec.ts 的 clickUntil）。 */
  async function openMenu(page: Page): Promise<void> {
    const toggle = page.getByRole('button', { name: 'Toggle navigation' });
    await expect(toggle, '手機寬度下才會出現漢堡鈕').toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      if (!(await isOpen(page))) {
        await toggle.click();
        // 這顆是 toggle，重試時再按一次會把剛開的關回去。等一次 commit 再判定，
        // 讓「按了但還沒反映到 DOM」不要被誤判成「按了沒用」。
        await page.waitForTimeout(300);
      }
      expect(await isOpen(page), '按了漢堡鈕但選單沒有打開').toBe(true);
    }).toPass({ timeout: 20_000, intervals: [200, 400, 800, 1500] });
    await expect(menu(page)).toHaveClass(/mnav--open/);
  }

  test('漢堡鈕開得了選單，關閉鈕關得掉', async ({ page }) => {
    await page.goto('/');
    await expect(menu(page), '一開始應該是收起來的（inert = 整塊不能互動）').toHaveAttribute('inert', '');

    await openMenu(page);
    await expect(menu(page)).toHaveClass(/mnav--open/);
    await expect(page.locator('.mnav-close')).toBeVisible();

    await page.locator('.mnav-close').click();
    await expect(menu(page), '關閉鈕沒有把選單收回去').toHaveAttribute('inert', '', { timeout: 10_000 });
  });

  test('展開次選單，點連結會走過去而且選單自己收起來', async ({ page }) => {
    await page.goto('/');
    await openMenu(page);

    // 「更多」底下那幾頁在桌機版是 mega menu，在手機只有這一條路進得去
    const group = page.locator('.mnav-group').filter({ has: page.getByRole('button', { name: '更多' }) });
    const subWrap = group.locator('.mnav-sub-wrap');
    const wrapHeight = async () => (await subWrap.boundingBox())?.height ?? -1;

    expect(await wrapHeight(), '展開之前收合層的高度該是 0').toBe(0);
    await group.getByRole('button', { name: '更多' }).first().click();
    await expect.poll(wrapHeight, { message: '按了展開但收合層沒有長出高度', timeout: 10_000 }).toBeGreaterThan(0);

    const photos = group.getByRole('link', { name: '照片' });
    await photos.click();
    await expect(page).toHaveURL(/\/photos$/, { timeout: 15_000 });
    // 走過去之後選單要收——不收的話讀者到了新頁面還被選單蓋著
    await expect(menu(page), '導覽之後選單沒有自己關掉').toHaveAttribute('inert', '', { timeout: 10_000 });
  });
});
