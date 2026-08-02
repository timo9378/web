/**
 * 後台 e2e 的共用 session 架設。
 *
 * 原本住在 admin.spec.ts 裡；post-editor.spec.ts 也要用，抽出來共用而不是抄一份
 * ——抄一份的下場是其中一份會慢慢跟另一份不一樣，而沒有人會發現。
 * 下面每一段註解都是實際踩過的坑，搬過來時逐字保留。
 *
 * ## 為什麼是塞 token 而不是走登入畫面
 *
 * 站上**沒有密碼登入 UI**：`/admin/login` 只是舊書籤的轉址，實際登入走 OAuth
 * （留言區那組 provider 按鈕），而 OAuth 需要真的 provider。
 * 登入本身另有覆蓋：`backend/tests/auth.rs` 測密碼登入與 JWT 簽發，
 * `backend/tests/oauth.rs` 用 mock provider 跑完整條 OAuth 流程。
 * 這些檔要測的是**後台介面**，所以直接給它一個合法的 session。
 *
 * 用 `node:crypto` 自己簽而不是 `jsonwebtoken`：HS256 就是 HMAC-SHA256，
 * 八行的事，測試不必因此多一個相依。secret 與 tests/e2e/stack.mjs 給後端的一致。
 */

import { createHmac } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

export const JWT_SECRET = 'e2e-secret';
export const TOKEN_KEY = 'koimsurai_user_token';

export function ownerToken(): string {
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
export async function signIn(page: Page) {
  await page.goto('/');
  await page.evaluate(([key, value]) => { window.localStorage.setItem(key, value); }, [TOKEN_KEY, ownerToken()] as const);
}

export async function signOut(page: Page) {
  await page.evaluate((key) => { window.localStorage.removeItem(key); }, TOKEN_KEY);
}

/**
 * 進後台並等某個元素出現，**失敗就重來**。
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
export async function gotoAdmin(page: Page, path: string, heading: string | RegExp) {
  await expect(async () => {
    await page.evaluate(
      ([key, value]) => { window.localStorage.setItem(key, value); },
      [TOKEN_KEY, ownerToken()] as const,
    );
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 60_000 });
}

/**
 * 同 `gotoAdmin`，但等的是任意 locator 而不是標題。
 * 文章編輯器沒有 `<h1>`——標題那格是 `<input>`，用 heading 等不到。
 *
 * ⚠ 開頭那個 about:blank 判斷不是多餘的：分頁還沒導覽過任何頁面時碰 `localStorage`
 * 會拋 SecurityError，而它發生在 `toPass` 迴圈裡 → 一路重試到 60 秒逾時，
 * 訊息只說「predicate 逾時」，完全看不出真正的原因（實際上就這樣卡過一次）。
 * `gotoAdmin` 沒有這個保護是因為它的呼叫端都先 `signIn` 過了；這支給呼叫端少一件要記的事。
 */
export async function gotoAdminUntil(page: Page, path: string, ready: (p: Page) => ReturnType<Page['locator']>) {
  if (page.url() === 'about:blank') await signIn(page);
  await expect(async () => {
    await page.evaluate(
      ([key, value]) => { window.localStorage.setItem(key, value); },
      [TOKEN_KEY, ownerToken()] as const,
    );
    await page.goto(path);
    await expect(ready(page)).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 60_000 });
}
