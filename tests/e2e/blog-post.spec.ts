/**
 * 文章頁的互動。`BlogPost.tsx` 是全站互動點最多的元件（45 個 onClick/onChange），
 * 也是最多人看的頁型，而在這個檔之前 e2e 對它只有：能不能 render（smoke）、
 * Emoji 反應（interactions.spec.ts）、以及捲動還原的 CLS 量測。
 *
 * 這裡挑的是「壞了讀者會遇到、但沒有任何東西會告訴你」的幾條：
 *
 *   · **程式碼複製鈕** —— 技術文章的主要互動。壞掉時按鈕還在、按下去沒反應。
 *   · **圖片燈箱** —— 圖片點不開就只能看縮圖。
 *   · **MDX 區塊真的被編譯** —— 這條最重要：`blogList.ts` 在編譯失敗時**靜默退回
 *     markdown**，讀者看到的是一行裸的 `<Poll ... />` 文字，而 API 照樣回 200。
 *     沒有 log、沒有告警、沒有錯誤頁。
 *   · **文章裡的投票會寫 DB** —— 它是文章頁唯一會改變伺服器狀態的互動。
 *   · **上一篇／下一篇** —— 壞了讀者就走不到相鄰的文章。
 */

import { expect, test, type Page } from '@playwright/test';

/** 種子第 5 篇：有程式碼區塊與圖片（見 seed.mjs）。 */
const RICH = '/blog/5';
/** 種子第 6 篇：format='mdx'，內含 <Poll id="demo" />。 */
const MDX = '/blog/6';

const article = (page: Page) => page.locator('article.post-content');

/**
 * 「按下去，直到真的有效果為止」。
 *
 * ⚠ 這不是為了掩蓋 race，是因為 race 真的存在且無法從外部觀測：SSR 出來的
 * `<button>` 在 React 接上 onClick **之前**就已經可見、可聚焦、可點擊——
 * Playwright 的 actionability 檢查全部會過，但那一下點擊不會觸發任何事情。
 * 沒有任何 DOM 屬性可以拿來等「這顆按鈕已經 hydrate 了」。
 *
 * 這一版是實測逼出來的：第一版直接 `click()` 然後斷言，本機八輪跑紅了一輪
 * （燈箱沒開）。CI 上同一類問題也發生過兩次（run #222/#223 的 reaction 測試，
 * 錯誤是 waitForResponse 逾時——同樣是點擊掉了）。
 *
 * 反過來說，如果功能**真的**壞了，這個包裝只是讓它慢 20 秒才紅，不會讓它變綠。
 */
/**
 * ⚠ `alreadyDone` 不是可選的裝飾，是**正確性的一部分**：重試一個有破壞性副作用的
 * 點擊會製造出新的失敗模式。實測踩過——燈箱的 overlay 自己掛了 `onClick={關閉}`，
 * 於是「第一次點擊有效但慢」時重試會點在已經打開的 overlay 上把它關掉，
 * 而 AnimatePresence 的離場動畫期間 overlay 還在、裡面的 `<img>` 已經被移除，
 * 錯誤訊息變成「.image-lightbox-img 找不到」，完全指不到真正的原因。
 * 會重試的動作一定要先問「是不是已經成了」。
 */
async function clickUntil(
  click: () => Promise<void>,
  effect: () => Promise<void>,
  alreadyDone?: () => Promise<boolean>,
) {
  await expect(async () => {
    if (!(await alreadyDone?.())) await click();
    await effect();
  }).toPass({ timeout: 20_000, intervals: [200, 400, 800, 1500] });
}

test.describe('文章頁的互動', () => {
  test('程式碼區塊有複製鈕，按了會把原始碼放進剪貼簿', async ({ page, context }) => {
    // 讀剪貼簿要權限；沒給的話 navigator.clipboard.writeText 會被拒絕，
    // 而元件是 `.then()` 才切成「已複製!」——所以權限沒開時這條會自然地紅。
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(RICH);

    const block = article(page).locator('.code-block-wrapper').first();
    await expect(block, '程式碼區塊要 render 成 .code-block-wrapper').toBeVisible({ timeout: 15_000 });
    await expect(block.locator('.language-name')).toContainText('rust', { ignoreCase: true });

    const copy = block.locator('.copy-button');
    await expect(copy).toHaveText('複製');
    // 文字要切成「已複製!」——沒切代表 clipboard 那條 promise 沒 resolve
    await clickUntil(
      () => copy.click(),
      () =>
        expect(copy, '按下去之後要給回饋，不然使用者不知道有沒有複製到').toHaveText('已複製!', {
          timeout: 2_000,
        }),
    );

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip, '剪貼簿裡要是程式碼本身').toContain('println!');
    expect(clip, '不該把行號或語言標籤一起複製進去').not.toContain('rust\n1');
  });

  test('圖片點得開燈箱，Esc 關得掉', async ({ page }) => {
    await page.goto(RICH);
    // 圖片包在 <button> 裡（原本 onClick 掛在 <img> 上，不可聚焦也沒有鍵盤操作）
    const zoom = article(page).getByRole('button', { name: /放大檢視/ }).first();
    await expect(zoom, '圖片要包成可聚焦的按鈕').toBeVisible({ timeout: 15_000 });

    // 燈箱是 createPortal 出去的，不在 <article> 底下——用整頁的選擇器
    const lightbox = page.locator('.image-lightbox-overlay');
    const img = lightbox.locator('.image-lightbox-img');
    await clickUntil(
      () => zoom.click(),
      // 圖片一起驗：overlay 在、圖片不在 = 正在關閉的動畫中途，那不算開好了
      () => expect(img, '點圖片要開燈箱並顯示大圖').toBeVisible({ timeout: 2_000 }),
      () => img.isVisible(),
    );

    await page.keyboard.press('Escape');
    await expect(lightbox, 'Esc 要關得掉——關不掉的話讀者只能重新整理').toHaveCount(0, {
      timeout: 10_000,
    });

    // 關閉鈕也要能關（鍵盤與滑鼠兩條路都得在）。
    // 這裡不必再包 clickUntil：上面已經開關過一次，代表元件早就 hydrate 了。
    await zoom.click();
    await expect(lightbox).toBeVisible({ timeout: 10_000 });
    await page.locator('.image-lightbox-close').click();
    await expect(lightbox).toHaveCount(0, { timeout: 10_000 });
  });

  /**
   * MDX 區塊必須是**元件**，不是文字。
   *
   * `blogList.ts` 編譯失敗時會 catch 住並退回 markdown 渲染，於是整篇文章看起來
   * 「還在」，只是所有自訂區塊都變成裸標籤。API 回 200、沒有 console error、
   * 沒有任何告警——只有真的去看那一頁才會發現。這條就是那個守門。
   */
  test('MDX 文章的自訂區塊有被編譯成元件，不是裸標籤', async ({ page }) => {
    await page.goto(MDX);
    await expect(article(page)).toContainText('一段普通內文', { timeout: 15_000 });

    const poll = page.locator('.mdx-poll');
    await expect(poll, '<Poll> 應該渲染成投票元件').toBeVisible({ timeout: 15_000 });
    await expect(poll.locator('.mdx-poll-q')).toContainText('你偏好哪一種渲染');
    await expect(poll.locator('.mdx-poll-opt')).toHaveCount(2);

    // 反面：畫面上不該出現原始碼的痕跡
    const text = await article(page).innerText();
    expect(text, 'MDX 編譯失敗時會退回 markdown，讀者就會看到這串').not.toContain('<Poll');
    expect(text).not.toContain('options={[');
  });

  test('投票會寫進後端，重新整理之後記得投過哪一項', async ({ page }) => {
    const counts = async () => {
      const r = await page.request.get('/api/polls/demo');
      const b = (await r.json()) as { total?: number; options?: { option_key: string; count: number }[] };
      return { total: b.total ?? 0, a: b.options?.find((o) => o.option_key === 'a')?.count ?? 0 };
    };
    const before = await counts();

    await page.goto(MDX);
    const poll = page.locator('.mdx-poll');
    await expect(poll).toBeVisible({ timeout: 15_000 });

    // 投完要揭曉百分比（在那之前是藏著的，避免影響投票）。
    // 包 clickUntil 是安全的：元件的 `vote()` 有 `if (myVote || busy) return`，
    // 重試點擊不會變成投兩票——下面對票數的 ±1 斷言也會抓到萬一真的變成兩票。
    await clickUntil(
      () => poll.locator('.mdx-poll-opt').first().click(),
      () =>
        expect(poll.locator('.mdx-poll-pct').first(), '投完要顯示百分比').toBeVisible({
          timeout: 2_000,
        }),
      // 已經投過就別再點——雖然元件的 busy/myVote 守衛擋得住，
      // 但「重試前先確認還沒完成」是這個包裝的通則，不該有例外
      async () => (await poll.locator('.mdx-poll-opt--mine').count()) > 0,
    );
    await expect(poll.locator('.mdx-poll-opt--mine'), '要標出自己投的那一項').toHaveCount(1);

    await expect
      .poll(async () => (await counts()).a, { message: '投票應該寫進 DB' })
      .toBe(before.a + 1);

    // localStorage 記住 → 重新整理之後不該又變回「可投票」
    await page.reload();
    await expect(poll.locator('.mdx-poll-opt--mine'), '重新整理後要記得投過').toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(poll.locator('.mdx-poll-pct').first()).toBeVisible();

    // 已經投過就不能再投（不然一個人可以刷票）。
    // 元件的做法是把所有選項 disabled 掉——這比「點了但忽略」好，因為使用者
    // 看得出來為什麼點不動。所以這裡驗的是 disabled 而不是「點了沒反應」。
    for (const i of [0, 1]) {
      await expect(poll.locator('.mdx-poll-opt').nth(i), '投過之後所有選項都該鎖住').toBeDisabled();
    }
    expect((await counts()).a, '票數不該再變').toBe(before.a + 1);
  });

  test('上一篇／下一篇走得到相鄰的文章', async ({ page }) => {
    await page.goto('/blog/2');
    const nav = page.getByRole('navigation', { name: '上一篇與下一篇' });
    await expect(nav, '文章底部要有相鄰文章的導覽').toBeVisible({ timeout: 15_000 });

    const links = nav.locator('a');
    const n = await links.count();
    expect(n, '至少要有一個方向可以走').toBeGreaterThan(0);

    const href = await links.first().getAttribute('href');
    expect(href, '連結要指向另一篇文章').toMatch(/\/blog\/[^/]+$/);
    expect(href).not.toContain('/blog/2');

    await links.first().click();
    await expect(page).not.toHaveURL(/\/blog\/2$/, { timeout: 15_000 });
    await expect(article(page), '走過去要真的 render 出內容').toContainText(/\S/, { timeout: 15_000 });
  });
});
