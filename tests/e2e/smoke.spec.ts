import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';
import { discoverRoutes } from './routes';

/**
 * 全站煙霧測試：每條路由都要能 render，而且不能把「壞掉的值」漏到畫面上。
 *
 * 這一支的存在理由很具體——這個 repo 近期三個使用者看得到的 bug（EXIF 拍攝時間顯示
 * Invalid Date、光圈顯示 f/f/1.4、焦距顯示 132 mmmm）全都是**手動開瀏覽器**才發現的；
 * 單元測試照定義抓不到「後端回的形狀變了，前端還照舊讀」這一類。
 *
 * 路由清單從 routeTree.gen.ts 推導（見 routes.ts），不手寫——新增頁面會自動被掃到。
 */

/** 這些字出現在畫面上，幾乎一定是某個值沒處理好漏出來的。 */
const LEAKED_VALUES = ['Invalid Date', 'NaN', 'undefined', '[object Object]', 'null null'];

/**
 * 第三方整合在 CI 沒有金鑰，端點會回 500 +「未配置」。那是**刻意的降級路徑**，
 * 不是壞掉，所以從「不該有錯誤」這條斷言裡排掉；降級後的形狀由 api-contract 單獨驗。
 * ⚠️ 只排這幾支，別擴大：這條 allowlist 一長，這個測試就沒有意義了。
 */
const UNCONFIGURED = ['/api/steam/', '/api/wakatime/', '/api/spotify/', '/api/github/'];
const isUnconfigured = (url: string) => UNCONFIGURED.some((p) => url.includes(p));

interface PageProbe {
  errors: string[];
  failed: string[];
}

/** 掛上 console error 與請求失敗的收集器（要在 goto 之前掛）。 */
function probe(page: Page): PageProbe {
  const p: PageProbe = { errors: [], failed: [] };
  // 瀏覽器對每個 4xx/5xx 都會印 "Failed to load resource" 但不帶 URL，無法逐條對應，
  // 所以那類交給下面的 response 監聽自己判斷，這裡只收真正的 JS 錯誤。
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) p.errors.push(m.text());
  });
  page.on('pageerror', (e: Error) => p.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r: Request) => {
    const err = r.failure()?.errorText ?? '?';
    // ERR_ABORTED 是瀏覽器**主動取消**，不是失敗：影片／預取常常載到一半就不要了
    // （實測 /portfolio 的 <video> 每次都會出現一次）。真的抓不到會是別的錯誤碼。
    if (err.includes('ERR_ABORTED')) return;
    if (!isUnconfigured(r.url())) p.failed.push(`${r.url()} — ${err}`);
  });
  page.on('response', (r) => {
    if (isUnconfigured(r.url())) return;
    if (r.url().includes('/api/') && r.status() >= 500) p.failed.push(`${r.url()} → ${r.status()}`);
    if (!r.url().includes('/api/') && r.status() === 404) p.failed.push(`${r.url()} → 404`);
  });
  return p;
}

const mainOf = (page: Page) => page.locator('main').first();

for (const route of discoverRoutes()) {
  test(`${route.path} render 得出來且沒有壞值`, async ({ page }) => {
    const p = probe(page);
    const resp = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), `${route.path} 的 HTTP 狀態`).toBeLessThan(400);

    // 用會自動重試的斷言：這些頁多半是「SSR 外殼 + client 補資料」，
    // 直接讀 innerText 會讀到還沒填內容的空殼（實測 /photos 讀到 0 字，但頁面其實是好的）
    const main = mainOf(page);
    await expect(main, `${route.path} 應該 render 出內容`).toContainText(route.expect ?? /\S/, {
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle').catch(() => {
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

/**
 * a11y 用 axe-core 掃，不自己刻規則。門檻只擋 critical——先把最嚴重的釘住不讓它回頭，
 * 之後再往下收到 serious（同 oxlint `--max-warnings 0` 的 ratchet 做法）。
 */
const A11Y_PAGES = ['/blog', '/blog/1', '/thinking', '/bookshelf', '/photos'];

/**
 * 已知、目前修不掉的違規。**每一條都要寫清楚為什麼**，而且清單只能變短。
 *
 * masonic 的 <Masonry> 直接輸出 role="grid" > role="gridcell"，中間少了 ARIA 規範
 * 要求的 role="row"，而它沒有開放覆寫 role 的 prop（d.ts 裡沒有 role/as/itemAs）。
 * 要修只有兩條路：fork masonic，或換掉瀑布流套件。在那之前先擋住「不要再多」。
 */
const A11Y_KNOWN: Record<string, string[]> = {
  '/photos': ['aria-required-children', 'aria-required-parent'],
};

for (const path of A11Y_PAGES) {
  test(`${path} 沒有新的 critical a11y 問題`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(mainOf(page)).toContainText(/\S/, { timeout: 15_000 });
    const { violations } = await new AxeBuilder({ page }).analyze();
    const known = A11Y_KNOWN[path] ?? [];
    const critical = violations.filter((v) => v.impact === 'critical' && !known.includes(v.id));
    expect(
      critical.map((v) => `${v.id}（${v.nodes.length} 處）— ${v.help}｜${v.nodes[0]?.html.slice(0, 80)}`),
      `${path} 的 critical a11y 問題`,
    ).toEqual([]);
  });
}

test('不存在的路由回 404 而不是白畫面', async ({ page }) => {
  const resp = await page.goto('/this-route-does-not-exist', { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBe(404);
  await expect(page.locator('body'), '404 頁也該有內容').not.toBeEmpty();
});

test('草稿不會出現在公開清單', async ({ page }) => {
  await page.goto('/blog', { waitUntil: 'domcontentloaded' });
  // 先等清單真的出現，否則「沒看到草稿」可能只是因為整頁還沒 render
  await expect(mainOf(page)).toContainText('第一篇測試文章');
  await expect(mainOf(page)).not.toContainText('未發布草稿');
});

test('未登入進不了後台', async ({ page }) => {
  const resp = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBeLessThan(500);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('body')).not.toContainText('未發布草稿');
});
