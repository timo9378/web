import { expect, test } from './fixtures';

import { gotoAdmin, signIn, signOut } from './admin-session';

/**
 * 後台。在這個檔之前，e2e 對後台只驗過一件事：**未登入進不去**。
 * 登入之後的每一個操作——發標籤、審留言——一次都沒被走過，而那是站長每天在用的介面。
 *
 * session 的架設（自簽 OWNER token、為什麼不用 addInitScript、gotoAdmin 為什麼要重試）
 * 抽到 `./admin-session`，post-editor.spec.ts 共用同一份。
 */

test.describe('後台', () => {
  // 序列執行。兩個理由：
  //   1. 這些測試會改**共用狀態**（建/刪標籤、把留言改成已批准）。平行跑的話
  //      「送出的留言讀者還看不到」這種斷言會被另一條測試的批准動作破壞。
  //   2. 後台是 lazy + ClientOnly 的重元件；跟 axe 掃描、CLS trace 那些同時搶
  //      伺服器時載入會明顯變慢（單獨平行量是 600~975ms，混在完整套件裡會超過 20s）。
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('帶著 OWNER 的 session 進得了後台', async ({ page }) => {
    await signIn(page);
    await gotoAdmin(page, '/admin/tags', '標籤管理');
    // 沒有被踢回首頁
    await expect(page).toHaveURL(/\/admin\/tags$/);
  });

  /**
   * 標籤 CRUD 走真正的介面：新增 → 出現在列表 → 刪除 → 消失。
   *
   * 後端的 CRUD 另有 `backend/tests/admin.rs` 的往返測試，這裡要驗的是
   * 「按鈕真的接到那些 API、而且列表會跟著更新」——後端全對但前端沒 invalidate
   * 快取的話，站長會看到自己剛建的標籤沒出現，然後再建一次。
   */
  test('標籤：新增之後出現在列表，刪除之後消失', async ({ page }) => {
    const name = `e2e-tag-${Date.now()}`;
    await signIn(page);
    await gotoAdmin(page, '/admin/tags', '標籤管理');

    await page.getByRole('button', { name: '新增標籤' }).click();
    await page.getByLabel('標籤名稱').fill(name);
    await page.getByRole('button', { name: '創建' }).click();

    const row = page.locator('tr', { hasText: name });
    await expect(row, '新增之後列表要立刻看得到（快取沒 invalidate 就會看不到）').toBeVisible({
      timeout: 10_000,
    });

    // 刪除（列上的按鈕平常是 opacity-0、hover 才顯示，click 會自己先 hover）
    await row.getByRole('button', { name: '刪除' }).click();
    await page.getByRole('button', { name: '刪除', exact: true }).last().click();
    await expect(row, '刪除之後應該從列表上消失').toBeHidden({ timeout: 10_000 });
  });

  /**
   * **留言審核的完整往返**——這一條是整個 e2e 套件裡跨最多層的。
   *
   *   公開頁匿名送出 → 因為待審核所以讀者看不到
   *   → 後台看得到那則待審核
   *   → 站長按「批准」
   *   → 讀者現在看得到
   *
   * 中間任何一環壞掉都會變成「留言石沉大海」或「未審核的內容直接見客」，
   * 而兩者都不會有任何錯誤訊息。單獨測前端或單獨測後端都涵蓋不到這條線。
   */
  test('留言審核往返：送出 → 後台批准 → 讀者看得到', async ({ page }) => {
    const content = `e2e 審核往返 ${Date.now()}`;

    // ── 1. 讀者送出留言
    await page.goto('/blog/1');
    await expect(async () => {
      await page.locator('.mode-btn--anon').click();
      await expect(page.locator('input[name="author"]')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator('input[name="author"]').fill('e2e 讀者');
    await page.locator('textarea[name="content"]').fill(content);
    const q = (await page.locator('.captcha-q').innerText()).trim();
    const [a, b] = q.match(/\d+/g)!.map(Number);
    await page.locator('.captcha-input').fill(String(a + b));

    const posted = page.waitForResponse((r) => r.url().includes('/comments') && r.request().method() === 'POST');
    await page.locator('button.submit-btn').click();
    expect((await posted).status()).toBeLessThan(400);
    await expect(page.locator('.form-success')).toBeVisible();

    // ── 2. 還沒審核 → 讀者看不到
    await page.reload();
    await expect(page.locator('.comments-list, .comment-item').first()).not.toContainText(content);

    // ── 3. 站長登入後台，看得到那則待審核
    await signIn(page);
    await gotoAdmin(page, '/admin/comments', /留言/);
    const row = page.locator('div', { hasText: content }).last();
    await expect(row, '後台應該看得到剛送出的留言').toBeVisible({ timeout: 15_000 });

    // ── 4. 批准
    await row.getByRole('button', { name: '批准' }).click();

    // ── 5. 登出，以讀者的身分再看一次
    await signOut(page);
    await page.goto('/blog/1');
    await expect(
      page.locator('.comments-list, .comment-item').first(),
      '批准之後讀者就該看得到——看不到的話留言等於石沉大海',
    ).toContainText(content, { timeout: 15_000 });
  });

  /**
   * token 被清掉 → 立刻被請出去。
   *
   * 既有的「未登入進不了後台」測的是「一開始就沒有 token」。這條測的是
   * **session 中途失效**（過期／登出／被撤銷）——後台是 SPA，不會自己重新載入，
   * 守衛只在 `RequireAdmin` 的 effect 裡跑，所以這條路徑是分開的。
   */
  test('session 失效之後會被請出後台', async ({ page }) => {
    await signIn(page);
    await gotoAdmin(page, '/admin/tags', '標籤管理');

    await signOut(page);
    await page.reload();

    await expect(page, '沒有 session 就不該留在 /admin').toHaveURL(/^https?:\/\/[^/]+\/(en|ja|ko|zh-cn)?\/?$/, {
      timeout: 15_000,
    });
  });
});
