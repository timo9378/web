// 地標結構與 a11y 嚴格門檻。
//
// 為什麼從 interactions.spec.ts 拆出來：**CI 分片是按檔案切的，不看耗時**。
// 這批每一條要跑 axe 全頁掃描、約 11 秒，而 interactions.spec 其餘的互動測試都在
// 一兩秒級——兩者黏在同一個檔案時，拿到它的那一片會被整整拖慢一倍。
//
// 實測（分片上線那次 CI）：三片是 4m29s / **6m40s** / 3m40s，而 6m40s 那片正是
// 拿到 interactions.spec 的。拆開之後 playwright 才有機會把重的那批散到不同片。
//
// ⚠ 拆檔只動「測試住在哪個檔案」，一條都沒有增刪或改寫——`git log --follow` 追得到。
import AxeBuilder from '@axe-core/playwright';

import { expect, test } from './fixtures';

// ── 地標結構 ──────────────────────────────────────────────────────────────

/**
 * 每頁只能有一個 `<main>`。
 *
 * 這條是寫上面那些互動測試時**被 Playwright 逼出來的**：`locator('main')` 報
 * strict mode violation，說它解析到 2 個元素——AppShell 有一個 `<main>`，
 * Blog / MainPage 又在裡面各放了一個。
 *
 * axe 確認是真的缺陷，`/` 與 `/blog` 各報三條：
 *   landmark-no-duplicate-main · landmark-main-is-top-level · landmark-unique
 * 三條都是 **moderate**，而既有的 a11y 測試只擋 critical，所以一直沒被抓到。
 * 對螢幕閱讀器使用者的實際影響是「主要內容」地標有兩個，跳轉時不知道該去哪一個。
 *
 * 不把整個 a11y 門檻拉到 moderate 是刻意的——那會一次擋下 heading-order 等
 * 既有問題，變成大改動。這裡只釘住「main 唯一」這一條具體的不變量。
 */
const LANDMARK_PAGES = ['/', '/blog', '/blog/1', '/thinking', '/bookshelf'];

test.describe('地標結構', () => {
  for (const path of LANDMARK_PAGES) {
    test(`${path} 只有一個 main 地標`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main').first()).toContainText(/\S/, { timeout: 15_000 });
      const mains = await page.locator('main').count();
      expect(mains, `${path} 有 ${mains} 個 <main>；HTML 規範只允許一個非隱藏的 main`).toBe(1);
    });
  }

});

/**
 * **moderate 以上一律零違規。**
 *
 * smoke.spec.ts 的那條只擋 critical，是當時的現實水準。這次把地標與標題層級整理過
 * 之後，全站（除了 /photos）在 axe 的**所有等級**上都是乾淨的，所以趁現在把門檻鎖住
 * ——不然下一次改版又會慢慢長回來，而且因為只擋 critical，長回來時沒有人會知道。
 *
 * 這次修掉的東西（都在 moderate/serious，全部躲過了 critical 那道門）：
 *   landmark-no-duplicate-main   AppShell 之外 MainPage / Blog 又各放了一個 <main>
 *   landmark-unique              兩個 <nav> 沒有可區分的名稱
 *   heading-order                footer 從 h3 起跳；書卡 / 碎念嵌入卡 / 作品集也跳級
 *   page-has-heading-one         /activity 整頁沒有 h1
 *   color-contrast（serious）    /setup 的副標 3.32:1，AA 要 4.5:1
 *
 * 為什麼是 moderate 以上而不是全部：`minor` 多半是內容造成的（例如某篇文章的表格
 * 少了表頭），那不是程式的問題，擋在這裡只會逼人去改文章。
 *
 * ja / ko 一起跑是刻意的：nav 標籤那次差點只修好中英文——`nav.menu` 與
 * `blog.sideNav` 在日韓文是同一個字串，沿用的話那兩個語系還是撞名。
 */
const A11Y_STRICT = [
  '/',
  '/blog',
  '/blog/1',
  '/thinking',
  '/bookshelf',
  '/watch',
  '/activity',
  '/setup',
  '/portfolio',
  '/music',
  '/about-site',
  '/en/blog',
  '/ja/blog/1',
  '/ko/blog/1',
];

/**
 * 等進場動畫跑完再掃。
 *
 * 對比檢查是拿**當下算出來的顏色**去算的。framer-motion 的進場多半從 opacity 0 淡入，
 * 掃到一半的話文字比實際更淡，就會報出根本不存在的 color-contrast——CI 比本機慢，
 * 於是「本機綠、CI 紅」而且每次紅的節點還不一樣。實際踩過：/setup 有一張卡在 CI 上
 * 被判 serious:color-contrast，本機怎麼跑都是乾淨的。
 *
 * 判準是「沒有任何元素的 opacity 卡在 0 與 1 之間」——不用固定秒數，因為固定秒數在
 * 更慢的機器上一樣會輸。
 */
async function waitForSettledOpacity(page: import('@playwright/test').Page) {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLElement>('main *')].every((el) => {
          const o = Number.parseFloat(getComputedStyle(el).opacity);
          return Number.isNaN(o) || o === 0 || o >= 0.99;
        }),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {
      /* 有無限循環動畫的頁面永遠到不了靜止，等到上限就掃 */
    });
}

test.describe('a11y 嚴格門檻', () => {
  for (const path of A11Y_STRICT) {
    test(`${path} 沒有 moderate 以上的 a11y 違規`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main').first()).toContainText(/\S/, { timeout: 15_000 });
      await waitForSettledOpacity(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) => v.impact !== 'minor');
      expect(
        bad.map((v) => `${v.impact}:${v.id}（${v.nodes.length} 處）— ${v.nodes[0]?.html.slice(0, 90)}`),
        `${path} 的 a11y 違規`,
      ).toEqual([]);
    });
  }
});
