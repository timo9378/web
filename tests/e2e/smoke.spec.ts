import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { ConsoleMessage, Page, Request } from '@playwright/test';
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
    // 給 3 秒上限。這一步只是讓 client 端補資料落定再讀 innerText／檢查 console error，
    // 內容是否 render 出來上面那個 15s 的 toContainText 已經保證了。
    // 沒有 timeout 時，永遠不會 idle 的頁面會一路等到預設逾時才被 catch 吞掉——
    // /portfolio 有 <video>，單獨跑實測 16.4s，其中絕大部分就是在這裡空等。
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {
      /* 有輪詢或影片的頁面永遠不會 idle */
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

  // ⚠ 原本這裡只有 `body` 不是空的。那條**幾乎擋不住任何東西**——版面全掛、
  // 場景一個元素都沒渲染出來，只要 header/footer 還在，body 就不是空的。
  // 404 又是最少人打開的頁面，壞了不會有人回報。所以改成釘三件實際的事：
  await expect(page.locator('.nf-eyebrow'), '要看得到 404 這個狀態碼').toContainText('404');
  // 把「你要找的位置」印出來是這一頁唯一有功能性的東西，印錯或沒印
  //（例如哪天改成讀 state 而不是 location）從畫面上看不出來
  await expect(page.locator('.nf-addr-path'), '要印出使用者要找的路徑')
    .toHaveText('/this-route-does-not-exist');
  // 前景濾鏡：少了它文字會壓在最亮的星空上。這條擋的是「新頁面忘記加 scrim」，
  // 而那正是這一頁前兩版都犯過的錯
  await expect(page.locator('.nf-scrim'), '要有壓暗星空的前景濾鏡').toBeAttached();

  // 搜尋鈕要真的打得開命令面板——手機沒有 ⌘K，這是它們唯一的入口
  await page.locator('.nf-btn').click();
  await expect(page.locator('.cmdk-wrap'), '搜尋鈕要打得開命令面板').toBeVisible();
});

test('草稿不會出現在公開清單', async ({ page }) => {
  await page.goto('/blog', { waitUntil: 'domcontentloaded' });
  // 先等清單真的出現，否則「沒看到草稿」可能只是因為整頁還沒 render
  await expect(mainOf(page)).toContainText('第一篇測試文章');
  await expect(mainOf(page)).not.toContainText('未發布草稿');
});

/**
 * 相簿的標籤要跟著語系走。
 *
 * 這條存在的原因是一個**資料早就齊備、卻從來沒被接上**的洞：manifest 同時有
 * `tags`（中文）與 `tagsEn`（英文），但 PhotoGallery 完全沒有 i18n，三個語系
 * 一律顯示中文標籤——而它周圍的介面文字（More／もっと）明明翻好了。
 * 那種「一半翻了一半沒翻」不會有人回報，只會讓非中文讀者覺得這站很粗糙。
 *
 * 驗兩件事：介面標籤（全部/All/すべて）有翻，而且**標籤本身**在非中文語系是英文。
 */
for (const [path, allLabel, expectEnglishTags] of [
  ['/photos', '全部', false],
  ['/en/photos', 'All', true],
  ['/ja/photos', 'すべて', true],
] as const) {
  test(`相簿標籤跟著語系：${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const tabs = page.locator('.category-tab');
    await expect(tabs.first()).toHaveText(allLabel);

    const texts = (await tabs.allInnerTexts()).map((s) => s.trim()).slice(1); // 跳過「全部」
    expect(texts.length, '種子 fixture 應該產出至少一個標籤篩選鈕').toBeGreaterThan(0);
    const hasChinese = texts.some((s) => /[一-鿿]/.test(s));
    if (expectEnglishTags) {
      expect(hasChinese, `${path} 的標籤仍是中文：${texts.join(', ')}`).toBe(false);
    } else {
      expect(hasChinese, `中文版的標籤應該是中文：${texts.join(', ')}`).toBe(true);
    }
  });
}

/**
 * 未登入者不該進得了後台的**任何**一條路徑。
 *
 * 原本這裡只驗「status < 500 且畫面上沒有草稿標題」——那太弱：一個什麼都不 render
 * 的空白頁也會通過，而「守衛其實沒生效、只是資料還沒載進來」同樣會通過。
 * 後台從 react-router island 改成 13 條 TanStack file route 時，守衛整個被重寫，
 * 那種斷言擋不住任何東西，所以改成驗真正的契約：**最後會停在首頁**。
 *
 * 逐條列而不是只測 /admin：守衛掛在版面層 route 上，漏掉某條子路由的話
 * 只測進入點是看不出來的。動態段（edit/$id）與純 redirect 路由（login）都要涵蓋。
 */
for (const path of ['/admin', '/admin/posts', '/admin/users', '/admin/login', '/admin/posts/edit/1']) {
  test(`未登入進不了後台：${path}`, async ({ page }) => {
    const resp = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBeLessThan(500);
    // 守衛是 client-side 的（後台整段 ClientOnly），所以要等它跑完才看得到結果。
    //
    // 落點是「首頁」而不是字面上的 '/'：站台首頁會依 Accept-Language 做 302 語系導向
    // （見 tests/e2e/routes.ts 的 SKIP 註解），瀏覽器語系不同就會停在 /en、/ja…。
    // 第一版寫死 '/' 時這五條全紅，而我手動用另一個語系的 context 測卻是綠的——
    // 差的就是這個導向，不是守衛。
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toMatch(/^\/(en|ja|ko|zh-cn)?$/);
    await expect(page.locator('body')).not.toContainText('未發布草稿');
  });
}
