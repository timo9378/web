/**
 * 友鏈頁 `/friends` 的申請表單。
 *
 * 這是整頁唯一的互動，而且它沒有後端——送出只是把六個欄位組成一封 `mailto:`。
 * 也就是說**沒有任何伺服器端的東西會發現它壞掉**：欄位漏了、必填沒擋住、
 * 成功畫面沒出來，站上都只是「按了沒反應」。
 *
 * ⚠ 底下不去驗那封 mailto 的內容。`window.location.href = mailto` 沒有對應的網路請求，
 *   從測試這一側觀測不到；硬要攔就得改寫 `window.location`，那是在測試裡改變被測對象的
 *   行為，比不測更糟。這裡守的是使用者看得到的那一半：擋不擋得住空表單、送出後有沒有
 *   回饋、以及回饋裡有沒有給出退路（自動開信件失敗時該寄到哪）。
 */

import { expect, test, type Page } from '@playwright/test';

const modal = (page: Page) => page.locator('.friends-modal');

async function openModal(page: Page): Promise<void> {
  const open = page.locator('.friends-apply-btn');
  await expect(open, '友鏈頁要有申請入口').toBeVisible({ timeout: 15_000 });
  // SSR 的按鈕在 React 接上 onClick 之前就可點（理由見 blog-post.spec.ts 的 clickUntil）
  await expect(async () => {
    if (!(await modal(page).isVisible())) await open.click();
    await expect(modal(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [200, 400, 800, 1500] });
}

/** 六個欄位都是必填，填一份合法的。 */
async function fillValid(page: Page): Promise<void> {
  for (const [label, value] of [
    ['你的名字', '測試的人'],
    ['站點名稱', '測試站'],
    ['網站連結', 'https://example.com'],
    ['頭像連結', 'https://example.com/a.png'],
    ['Email', 'me@example.com'],
    ['一句自介', '路過來打個招呼'],
  ] as const) {
    await modal(page).getByLabel(label, { exact: false }).fill(value);
  }
}

test.describe('友鏈申請', () => {
  test.use({ locale: 'zh-TW' });

  test('入口開得了表單，關閉鈕與點遮罩都關得掉', async ({ page }) => {
    await page.goto('/friends');
    await openModal(page);
    await expect(modal(page)).toContainText('來自網海的問候');

    await modal(page).getByRole('button', { name: '關閉' }).click();
    await expect(modal(page)).toHaveCount(0, { timeout: 10_000 });

    // 點遮罩要關、點表單內部不能關（後者靠 stopPropagation，很容易在改版時掉掉）
    await openModal(page);
    await modal(page).click({ position: { x: 5, y: 5 } });
    await expect(modal(page), '點在表單內部不該把它關掉').toBeVisible();
    await page.locator('.friends-modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(modal(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('空的表單送不出去，六個欄位都是必填', async ({ page }) => {
    await page.goto('/friends');
    await openModal(page);

    await modal(page).getByRole('button', { name: '送出' }).click();
    // 擋住的話畫面停在表單，不會切到成功畫面
    await expect(modal(page).locator('.friends-modal-success'), '空表單不該送得出去').toHaveCount(0);
    await expect(modal(page).locator('form')).toBeVisible();

    // 確認是**每一個**欄位都必填，不是只有第一個擋住
    const inputs = modal(page).locator('.friends-modal-form input');
    const n = await inputs.count();
    expect(n, '表單有六個欄位').toBe(6);
    for (let i = 0; i < n; i++) {
      await expect(inputs.nth(i), `第 ${i + 1} 個欄位沒有標成必填`).toHaveAttribute('required', '');
    }
  });

  test('網址與 Email 欄位擋得住格式不對的值', async ({ page }) => {
    await page.goto('/friends');
    await openModal(page);
    await fillValid(page);

    // 用 type 讓瀏覽器自己驗，比自己寫 regex 可靠——但前提是 type 真的有設對
    await expect(modal(page).getByLabel('網站連結')).toHaveAttribute('type', 'url');
    await expect(modal(page).getByLabel('頭像連結')).toHaveAttribute('type', 'url');
    await expect(modal(page).getByLabel('Email')).toHaveAttribute('type', 'email');

    await modal(page).getByLabel('Email').fill('這不是信箱');
    await modal(page).getByRole('button', { name: '送出' }).click();
    await expect(modal(page).locator('.friends-modal-success'), '格式不對還是送得出去').toHaveCount(0);
  });

  test('填完送出會給回饋，而且留下自己寄信的退路', async ({ page }) => {
    await page.goto('/friends');
    await openModal(page);
    await fillValid(page);

    await modal(page).getByRole('button', { name: '送出' }).click();
    const success = modal(page).locator('.friends-modal-success');
    await expect(success, '送出之後要換成成功畫面').toBeVisible({ timeout: 10_000 });
    await expect(success).toContainText('正在開啟信件用戶端');
    // 開不起來信件用戶端的人（不少）得知道信要寄去哪，不然這個功能對他們等於沒有
    await expect(success, '自動開信失敗時沒有給出信箱').toContainText('timo9378@gmail.com');

    await success.getByRole('button', { name: '關閉' }).click();
    await expect(modal(page)).toHaveCount(0, { timeout: 10_000 });
  });
});
