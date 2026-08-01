import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * 後台。在這個檔之前，e2e 對後台只驗過一件事：**未登入進不去**。
 * 登入之後的每一個操作——發標籤、審留言——一次都沒被走過，而那是站長每天在用的介面。
 *
 * ## 為什麼是塞 token 而不是走登入畫面
 *
 * 站上**沒有密碼登入 UI**：`/admin/login` 只是舊書籤的轉址，實際登入走 OAuth
 * （留言區那組 provider 按鈕），而 OAuth 需要真的 provider。
 * 登入本身另有覆蓋：`backend/tests/auth.rs` 測密碼登入與 JWT 簽發，
 * `backend/tests/oauth.rs` 用 mock provider 跑完整條 OAuth 流程。
 * 這個檔要測的是**後台介面**，所以直接給它一個合法的 session。
 *
 * 用 `node:crypto` 自己簽而不是 `jsonwebtoken`：HS256 就是 HMAC-SHA256，
 * 八行的事，測試不必因此多一個相依。secret 與 tests/e2e/stack.mjs 給後端的一致。
 */

const JWT_SECRET = 'e2e-secret';
const TOKEN_KEY = 'koimsurai_user_token';

function ownerToken(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  // 沒有 userId → /api/auth/me 走 legacy admin 分支 → role OWNER
  const body = b64({ id: 1, username: 'e2e-owner', role: 'OWNER', iat: now, exp: now + 7200 });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * 登入：先開一個公開頁，把 token 寫進 localStorage，之後再進後台。
 *
 * ⚠ 刻意**不用** `addInitScript`。第一版用了，結果兩條測試紅：
 *   · init script 每次載入都重塞 token → 留言表單一直是「已登入」版本，
 *     匿名那兩顆按鈕根本不存在（Comments 用 isLoggedIn 分兩套 UI）
 *   · 「清掉 token 後應該被請出去」永遠不成立——reload 時又被塞回來
 * 改成「在某一頁上寫 localStorage」跟真正的登入行為一致（AuthContext 就是這樣寫的），
 * 也才登得出去。
 */
async function signIn(page: Page) {
  await page.goto('/');
  await page.evaluate(([key, value]) => { window.localStorage.setItem(key, value); }, [TOKEN_KEY, ownerToken()] as const);
}

async function signOut(page: Page) {
  await page.evaluate((key) => { window.localStorage.removeItem(key); }, TOKEN_KEY);
}

/**
 * 進後台並等標題出現，**失敗就重來**。
 *
 * 為什麼要重試：`AuthContext` 在掛載時打 `/api/auth/me` 決定身分，而完整套件
 * 同時有 axe 掃描與 CLS trace 在壓伺服器，那一支偶發會失敗 → `RequireAdmin`
 * 直接 `window.location.replace('/')` 把人踢回首頁（call log 裡看得到
 * 「navigated to /en」——那是首頁的 Accept-Language 轉址）。
 *
 * 一開始以為是「後台 lazy chunk 載得慢」，把逾時從 20s 加到 45s——結果**更糟**
 * （5 次跑有 4 次紅），因為 config 的單條測試逾時是 30s，locator 的 45s 根本到不了，
 * 而且測試掛得更久反而增加彼此的排擠。量過才知道單獨平行時標題 600~975ms 就出來，
 * 根本不是載入慢。
 *
 * 每次重試都重寫一次 token：舊版的 AuthContext 會在 /me 失敗時把 token 刪掉
 * （那個行為本身也修掉了，見 contexts/AuthContext.tsx），重寫是為了不依賴那個修正。
 */
async function gotoAdmin(page: Page, path: string, heading: string | RegExp) {
  await expect(async () => {
    await page.evaluate(
      ([key, value]) => { window.localStorage.setItem(key, value); },
      [TOKEN_KEY, ownerToken()] as const,
    );
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 60_000 });
}

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

    const posted = page.waitForResponse(
      (r) => r.url().includes('/comments') && r.request().method() === 'POST',
    );
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
