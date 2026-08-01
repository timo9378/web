import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * 使用者真的會**做**的事。
 *
 * 在這個檔之前，整個 e2e 套件裡 `click(` / `fill(` / `press(` 出現次數是 **0**——
 * 每一條測試都是「goto 一個網址、讀文字」。也就是說站上每個按鈕、每張表單、
 * 以及點連結的 client-side 導覽（跟直接 SSR 載入是完全不同的程式碼路徑）
 * 全都沒有端對端保護。render 得出來不等於按得動。
 *
 * 這裡只收**公開面**的互動（後台另計）：留言、emoji 反應、站內導覽。
 */

/** 留言表單：切到匿名模式並填好欄位（含算式驗證碼）。 */
async function fillAnonymousComment(page: Page, author: string, content: string, correctCaptcha = true) {
  await page.locator('.mode-btn--anon').click();

  await page.locator('input[name="author"]').fill(author);
  await page.locator('textarea[name="content"]').fill(content);

  // 驗證碼是畫在 DOM 裡的算式（`{num1} + {num2} = `）——刻意從畫面讀而不是繞過它，
  // 這樣「哪天改成別種驗證方式」這條測試會誠實地紅掉而不是假綠。
  const question = (await page.locator('.captcha-q').innerText()).trim();
  const [a, b] = question.match(/\d+/g)!.map(Number);
  await page.locator('.captcha-input').fill(String(correctCaptcha ? a + b : a + b + 1));
}

// ── 留言 ──────────────────────────────────────────────────────────────────

test.describe('留言', () => {
  test('匿名留言送得出去，而且因為要審核所以不會馬上出現在列表上', async ({ page }) => {
    const content = `e2e 測試留言 ${Date.now()}`;
    await page.goto('/blog/1');

    const posted = page.waitForResponse(
      (r) => r.url().includes('/comments') && r.request().method() === 'POST',
    );
    await fillAnonymousComment(page, 'e2e 訪客', content);
    await page.locator('button.submit-btn').click();

    const resp = await posted;
    expect(resp.status(), '留言 API 應該收下').toBeLessThan(400);
    await expect(page.locator('.form-success'), '應該顯示送出成功').toBeVisible();

    // 待審核 → 公開列表上看不到。這條守的是「新留言不會直接見客」這個審核前提；
    // 壞掉的話任何人都能讓任意內容立刻出現在文章底下。
    await expect(page.locator('.comments-list, .comment-item').first()).not.toContainText(content);
  });

  test('驗證碼答錯就不送出', async ({ page }) => {
    await page.goto('/blog/1');

    let posted = false;
    page.on('request', (r) => {
      if (r.url().includes('/comments') && r.method() === 'POST') posted = true;
    });

    await fillAnonymousComment(page, 'e2e 訪客', `不該送出 ${Date.now()}`, false);
    await page.locator('button.submit-btn').click();

    await expect(page.locator('.form-error')).toBeVisible();
    expect(posted, '驗證碼錯的時候不該打 API——擋在前端才不會浪費一次寫入').toBe(false);
  });

  /// 必填欄位靠的是**原生 `required`**，不是 React 的 setError。
  ///
  /// 差別是實際的：瀏覽器擋在 submit 之前，`handleSubmit` 根本不會執行，所以畫面上
  /// 不會出現 `.form-error`（會出現的是瀏覽器自己的提示泡泡）。第一版測試我照抄了
  /// 驗證碼那條的寫法去等 `.form-error`，結果是紅的——擋下來的機制不一樣。
  /// 這裡改成驗真正的機制：欄位進入 invalid 狀態、而且沒有任何請求送出去。
  test('內容空白：原生驗證擋下，不會打 API', async ({ page }) => {
    await page.goto('/blog/1');

    let posted = false;
    page.on('request', (r) => {
      if (r.url().includes('/comments') && r.method() === 'POST') posted = true;
    });

    await page.locator('.mode-btn--anon').click();
    await page.locator('input[name="author"]').fill('e2e 訪客');
    await page.locator('button.submit-btn').click();

    const contentValid = await page
      .locator('textarea[name="content"]')
      .evaluate((el: HTMLTextAreaElement) => el.checkValidity());
    expect(contentValid, '空內容應該是 invalid').toBe(false);
    expect(posted, '被原生驗證擋下時不該送出').toBe(false);
  });

  test('沒填暱稱：原生驗證擋下，不會打 API', async ({ page }) => {
    await page.goto('/blog/1');

    let posted = false;
    page.on('request', (r) => {
      if (r.url().includes('/comments') && r.method() === 'POST') posted = true;
    });

    await page.locator('.mode-btn--anon').click();
    await page.locator('textarea[name="content"]').fill(`有內容沒名字 ${Date.now()}`);
    await page.locator('button.submit-btn').click();

    const authorValid = await page
      .locator('input[name="author"]')
      .evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(authorValid, '空暱稱應該是 invalid').toBe(false);
    expect(posted).toBe(false);
  });
});

// ── emoji 反應 ────────────────────────────────────────────────────────────

test.describe('emoji 反應', () => {
  // 這幾條會改到共用的計數器，所以**序列執行**：平行跑的話兩個 worker 對同一篇文章
  // 加減，斷言的 ±1 就不成立了。這不是測試寫得脆弱，是共用狀態的本質。
  //
  // ⚠ `configure` 必須寫在 describe **裡面**。放在檔案頂層會套用到整個檔案，
  // 於是任何一條失敗就會讓後面全部不執行（第一版就是這樣，5 條 did not run）。
  test.describe.configure({ mode: 'serial' });

  /**
   * 等畫面上的數字**跟伺服器一致**再開始操作。
   *
   * 第一版直接在 `goto` 之後就讀數字，結果偶發失敗（Expected 1, Received 6）：
   * 反應數是非同步載入的，還沒回來時畫面顯示 0，一點下去伺服器卻回真實的 6。
   * 用「等一下下」去繞開只是把 race 藏起來——這裡改成拿 API 當真值來源同步，
   * 順便多驗一件事：UI 顯示的數字本來就該等於伺服器的數字。
   */
  async function settledCount(page: Page, emoji: string) {
    const fromApi = async () => {
      const r = await page.request.get('/api/posts/1/reactions');
      const body = (await r.json()) as { reactions?: { emoji: string; count: number }[] };
      return body.reactions?.find((x) => x.emoji === emoji)?.count ?? 0;
    };
    const expected = await fromApi();
    const c = page.locator('.reaction-btn').first().locator('.reaction-count');
    await expect
      .poll(async () => ((await c.count()) === 0 ? 0 : Number((await c.innerText()).trim())), {
        message: `畫面上的 ${emoji} 數字應該跟 API 一致`,
      })
      .toBe(expected);
    return expected;
  }

  test('點一下會 +1 並標記成自己的，再點一下收回', async ({ page }) => {
    await page.goto('/blog/1');

    const btn = page.locator('.reaction-btn').first();
    await expect(btn).toBeVisible();
    await expect(btn, '一開始不該是已選狀態').toHaveAttribute('aria-pressed', 'false');

    const countOf = async () => {
      const c = btn.locator('.reaction-count');
      return (await c.count()) === 0 ? 0 : Number((await c.innerText()).trim());
    };
    const emoji = (await btn.locator('.reaction-emoji').innerText()).trim();
    const before = await settledCount(page, emoji);

    const posted = page.waitForResponse(
      (r) => r.url().includes('/reactions') && r.request().method() === 'POST',
    );
    await btn.click();
    await posted;

    await expect(btn, '點過之後要標記成自己的（aria-pressed 是給輔助技術看的）').toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(countOf, { message: '計數應該 +1' }).toBe(before + 1);

    // 再點一下收回
    const posted2 = page.waitForResponse(
      (r) => r.url().includes('/reactions') && r.request().method() === 'POST',
    );
    await btn.click();
    await posted2;
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(countOf, { message: '收回之後應該回到原本的數字' }).toBe(before);
  });

  test('重新整理之後，自己按過的反應還記得', async ({ page }) => {
    await page.goto('/blog/1');
    const btn = page.locator('.reaction-btn').first();

    const posted = page.waitForResponse(
      (r) => r.url().includes('/reactions') && r.request().method() === 'POST',
    );
    await btn.click();
    await posted;

    await page.reload();
    const after = page.locator('.reaction-btn').first();
    await expect(after, '重載後仍該記得是自己按的（存在 localStorage）').toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 收回，把共用計數器還原，不要留給下一條測試
    const undo = page.waitForResponse(
      (r) => r.url().includes('/reactions') && r.request().method() === 'POST',
    );
    await after.click();
    await undo;
  });
});

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

  /**
   * 整個 `landmark-*` 類別都必須是乾淨的。
   *
   * 上面那條只釘住 main 的數量，但同一次修正還處理了「兩個 `<nav>` 沒有可區分的
   * 名稱」（landmark-unique）。那個修法是給各個 nav 加 `aria-label`，很容易在
   * 後續重構時被順手拿掉而沒人發現——所以整類一起鎖。
   *
   * ⚠ 加標籤時要確認**各語系的字串真的不同**：`nav.menu` 與 `blog.sideNav` 在
   * ja / ko 都是同一個詞（ナビゲーション / 내비게이션），沿用的話中英文看起來好了、
   * 日韓文卻還是撞名。所以 posts-nav 另外開了 `blog.nearbyNav`。
   * 這條測試在 zh-TW 之外也跑，就是為了擋這種只在部分語系成立的修法。
   */
  for (const path of ['/blog/1', '/ja/blog/1', '/ko/blog/1']) {
    test(`${path} 沒有 landmark 類的 a11y 違規`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main').first()).toContainText(/\S/, { timeout: 15_000 });
      const { violations } = await new AxeBuilder({ page }).analyze();
      const landmark = violations.filter((v) => v.id.startsWith('landmark-'));
      expect(
        landmark.map((v) => `${v.id}（${v.nodes.length} 處）— ${v.nodes[0]?.html.slice(0, 90)}`),
        `${path} 的 landmark 違規`,
      ).toEqual([]);
    });
  }
});

// ── 站內導覽 ──────────────────────────────────────────────────────────────

test.describe('站內導覽', () => {
  test('從文章列表點進文章，走的是 client-side 導覽而不是整頁重載', async ({ page }) => {
    await page.goto('/blog');

    // 在 window 上做記號：整頁重載會把它清掉，SPA 導覽不會。
    // 這是唯一能從外部區分兩者的方法——兩種情況下網址與畫面都一樣。
    await page.evaluate(() => {
      (window as unknown as { __e2eMarker?: number }).__e2eMarker = 42;
    });

    const link = page.locator('main a[href^="/blog/"]').first();
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/blog\/[^/]+$/);
    await expect(page.locator('main').first()).not.toBeEmpty();

    const marker = await page.evaluate(
      () => (window as unknown as { __e2eMarker?: number }).__e2eMarker,
    );
    expect(marker, '記號不見了 → 發生了整頁重載，SPA 導覽壞掉').toBe(42);
  });

  test('上一頁回得到列表', async ({ page }) => {
    await page.goto('/blog');
    const link = page.locator('main a[href^="/blog/"]').first();
    await link.click();
    await expect(page).toHaveURL(/\/blog\/[^/]+$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/blog\/?$/);
    await expect(page.locator('main').first()).toContainText(/\S/);
  });
});
