/**
 * 後台全頁煙霧測試：**登入之後**每一頁都要 render 得出來、沒有 console error、
 * 沒有失敗的請求。
 *
 * 在這支之前，e2e 對後台十四頁只驗過「未登入進不去」，而其中七頁連
 * 「登入後打得開」都沒被走過（dashboard / categories / books / subscribers /
 * notes / article-generator / users）。後台是站長每天在用的介面，
 * 而「某頁一打開就白畫面」正是沒有人會發現的那種——直到剛好要用那頁。
 *
 * 路由從 `routeTree.gen.ts` 推導（同公開頁那支），不手寫清單：新增後台頁自動納入。
 *
 * ⚠ 這支刻意**只驗「打得開」**，不驗互動。互動有各自的檔（admin.spec.ts 的標籤與
 * 留言、post-editor.spec.ts 的編輯器）。把互動塞進煙霧測試會讓它變慢又難查，
 * 而煙霧測試的價值正是「便宜到可以每一頁都跑」。
 */

import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';

import { gotoAdminUntil, signIn } from './admin-session';
import { discoverAdminRoutes } from './routes';

/** 這些字出現在畫面上，幾乎一定是某個值沒處理好漏出來的（同公開頁那支）。 */
const LEAKED_VALUES = ['Invalid Date', 'NaN', 'undefined', '[object Object]', 'null null'];

/**
 * 第三方整合在 e2e 沒有金鑰，端點會回 500 +「未配置」——刻意的降級路徑，不是壞掉。
 * ⚠️ 只排這幾支，別擴大：這條 allowlist 一長，這個測試就沒有意義了。
 */
const UNCONFIGURED = ['/api/steam/', '/api/wakatime/', '/api/spotify/', '/api/github/'];
const isUnconfigured = (url: string) => UNCONFIGURED.some((p) => url.includes(p));

interface PageProbe {
  errors: string[];
  failed: string[];
}

function probe(page: Page): PageProbe {
  const p: PageProbe = { errors: [], failed: [] };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) p.errors.push(m.text());
  });
  page.on('pageerror', (e: Error) => p.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r: Request) => {
    const err = r.failure()?.errorText ?? '?';
    if (err.includes('ERR_ABORTED')) return;
    if (!isUnconfigured(r.url())) p.failed.push(`${r.url()} — ${err}`);
  });
  page.on('response', (r) => {
    if (isUnconfigured(r.url())) return;
    if (r.url().includes('/api/') && r.status() >= 500) p.failed.push(`${r.url()} → ${r.status()}`);
  });
  return p;
}

test.describe('後台每一頁都打得開', () => {
  // 序列執行，理由同 admin.spec.ts：後台是 lazy + ClientOnly 的重元件，
  // 跟 axe 掃描、CLS trace 那些同時搶伺服器時會明顯變慢。
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  for (const route of discoverAdminRoutes()) {
    test(`${route.path} 登入後 render 得出來`, async ({ page }) => {
      const p = probe(page);
      await signIn(page);
      // 等 <main> 有內容而不是等某個標題：各頁的標題文字不一樣，
      // 而這支要驗的是「有沒有東西」，不是「是哪一頁」。
      await gotoAdminUntil(page, route.path, (pg) => pg.locator('main'));

      const main = page.locator('main').first();
      await expect(main, `${route.path} 應該 render 出內容`).toContainText(/\S/, { timeout: 15_000 });
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {
        /* 有輪詢的頁面永遠不會 idle */
      });

      const text = await main.innerText();
      for (const bad of LEAKED_VALUES) {
        expect(text, `${route.path} 畫面上出現「${bad}」`).not.toContain(bad);
      }
      expect(p.errors, `${route.path} 的 console error`).toEqual([]);
      expect(p.failed, `${route.path} 的請求失敗`).toEqual([]);
    });
  }
});
