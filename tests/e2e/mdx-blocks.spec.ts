import { expect, test } from '@playwright/test';

/**
 * 每一個註冊過的 MDX block 都要真的渲染成元件。
 *
 * 為什麼需要這一支：MDX 編譯失敗時前台是**靜默退回 markdown**（見 src/data/blogList.ts
 * 的 catch），讀者看到一行裸的 `<BarChart … />`，而 API 照樣回 200——沒有任何東西會
 * 告訴你它壞了。在這之前只有 `<Poll>` 有這層保護（種子文章 id=6）。
 *
 * 量 e2e 覆蓋率時發現有 6 個 block 的檔案**從頭到尾沒有被載入過**
 * （BarChart / Chart / ImageCompare / InteractiveChart / Math / Sketch），
 * 也就是說它們整個壞掉，整套 e2e 也不會有一條變紅。種子文章 id=7 就是為此加的。
 *
 * ⚠ 斷言的是「有沒有出現這個 block 專屬的 class」，不是「畫面長怎樣」。
 *   長相由 computed-style.spec.ts 守，這裡守的是「有沒有被編譯成元件」——
 *   兩件事的失敗模式不同，混在一起會讓兩邊都難讀。
 *
 * ⚠ 全部 block 在**同一次載入**裡驗完，不是一個 block 一條測試。/blog/7 是全站最重的
 *   頁面（excalidraw + recharts + katex 一次到齊），載 28 次只是把 CI 時間換成一份
 *   一樣的資訊——失敗時列出「缺了哪幾個」的訊息跟拆成 28 條一樣精確。
 */

const POST = '/blog/7';

/** block 名 → 它渲染出來後一定會有的 class。 */
const BLOCKS: [string, string][] = [
  ['Note', '.mdx-note'],
  // ⚠ 這兩個的 class 沒有 `mdx-` 前綴，跟其他 block 不一致。不是筆誤，是既有命名；
  //    照實寫，不要「順手統一」——那會動到 CSS 與 computed-style 的基準。
  ['Annot', '.annot'],
  ['Spoiler', '.spoiler'],
  ['Ruby', '.mdx-ruby'],
  ['Mention', '.mdx-mention'],
  ['Kbd', '.mdx-kbd'],
  ['BarChart', '.mdx-chart'],
  ['Chart', '.mdx-chart-title'],
  ['InteractiveChart', '.mdx-chart-interactive'],
  ['Math', '.mdx-math-block'],
  ['Math（行內）', '.mdx-math-inline'],
  ['Sketch', '.mdx-sketch'],
  ['ImageCompare', '.mdx-imgcompare'],
  ['CodeTabs', '.mdx-codetabs'],
  ['Diff', '.mdx-diff'],
  ['Install', '.mdx-install'],
  ['Tabs', '.mdx-tabs'],
  ['Tab', '.mdx-tab'],
  ['Steps', '.mdx-steps'],
  ['Step', '.mdx-step'],
  ['Stats', '.mdx-stats'],
  ['Stat', '.mdx-stat'],
  ['Details', '.mdx-details'],
  ['FileTree', '.mdx-filetree'],
  ['Video', '.mdx-video'],
  ['YouTube', '.mdx-youtube'],
  ['Poll', '.mdx-poll'],
  ['Refs', '.mdx-refs'],
];

test.describe('MDX block 全覆蓋', () => {
  test('每個 block 都渲染成元件，而不是裸標籤', async ({ page }) => {
    const cspBlocked: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (!/violates the following Content Security Policy/.test(t)) return;
      cspBlocked.push(t.slice(0, 160));
    });
    // excalidraw 的字形 subsetting 曾經在這裡噴一堆 unsafe-eval 錯誤，一度被當成
    // 「第三方的既有行為」排除掉。實際上那是 **e2e 代理層對 /assets/ 多加了 CSP**
    // 造成的，正式站沒有這回事（見 tests/e2e/stack.mjs 的說明）。代理層對齊之後
    // 錯誤歸零，所以這裡不再排除任何 CSP 違規——留著排除規則等於把那條路徑重新弄壞
    // 的時候沒有人會發現。順帶一提，壞掉時的代價是行內 SVG 從 9 KB 變成 285 KB。

    await page.goto(POST);
    // 有幾個 block 是 lazy 的（chart / sketch / math），捲到底逼它們載入
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // 等到所有 block 的 class 都出現，或逾時——逐一 waitFor 才不會把 lazy 的誤判成缺席
    const missing: string[] = [];
    for (const [name, selector] of BLOCKS) {
      try {
        await page.locator(selector).first().waitFor({ state: 'attached', timeout: 20_000 });
      } catch {
        missing.push(`<${name}> (${selector})`);
      }
    }
    expect(missing, '這些 block 沒渲染出來——多半是 MDX 編譯失敗後靜默退回 markdown 了').toEqual([]);

    // 退回 markdown 的另一個症狀：標籤以純文字出現在畫面上
    const body = await page.locator('body').innerText();
    const raw = BLOCKS.map(([n]) => n.replace(/（.*/, '')).filter((n) => body.includes(`<${n}`));
    expect(raw, '這些 block 以純文字出現在畫面上 = MDX 沒編譯').toEqual([]);

    // CSP 由 server 下發，e2e stack 與正式站是同一份（實測逐條相同），所以這裡擋得住
    // 「新加的 block 引用了不在允許清單裡的網域」——那種錯在畫面上只是「圖沒出來」。
    expect(cspBlocked, '這些資源被 CSP 擋掉了').toEqual([]);
  });
});
