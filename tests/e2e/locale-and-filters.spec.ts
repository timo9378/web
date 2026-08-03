import { expect, test } from '@playwright/test';

import { E2E_POST_PREFIX } from './seed.mjs';

/**
 * 語言切換與文章篩選——兩批「使用者最常按、但一條測試都沒有」的互動。
 *
 * 語言切換那批特別要緊：`LanguagePicker.tsx` 的檔頭註解自己留了一張字條——
 *
 *   ⚠ 一定要「導航到帶前綴的網址」而不是只 changeLanguage：頁面內容由 LocaleProvider
 *     依 **URL** 建的獨立 i18n instance 驅動，只呼叫 changeLanguage 只會換到外殼
 *     那顆 instance → 內容（含今日訊號）不會跟著換。
 *
 * 也就是說這裡壞過一次，而且壞的樣子是「網址對、外殼的字換了、內文沒換」。
 * 所以下面每一條都**斷言內容真的變了**，不是只看網址——只看網址的測試在那個
 * bug 重演時會全綠。
 */

const PICKER = '.lang-picker-trigger';
const ITEM = '.lang-picker-item';

/** 打開語言選單並選一個。 */
async function pickLanguage(page: import('@playwright/test').Page, label: string) {
  // footer 在頁面底部，先捲下去（不捲的話 Playwright 會自己捲，但捲動本身也是一次
  // 使用者行為，明確寫出來比較好讀）
  await page.locator(PICKER).scrollIntoViewIfNeeded();
  await expect(async () => {
    await page.locator(PICKER).click();
    await expect(page.locator('.lang-picker-popup')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 }); // hydration 之前那一下會被吃掉，理由同 interactions.spec.ts
  await page.locator(ITEM).filter({ hasText: label }).click();
}

test.describe('語言切換', () => {
  /**
   * 切到英文之後，**內容**要真的是英文。
   *
   * 種子資料裡同一篇文章的中英標題不同（第一篇測試文章 / The first test post），
   * 所以「內文有沒有跟著換」是驗得出來的。這正是註解裡那個 bug 的判準。
   */
  test('切語言會連內容一起換，不只是外殼', async ({ page }) => {
    await page.goto('/blog');
    await expect(page.locator('main').first()).toContainText('第一篇測試文章');

    await pickLanguage(page, 'English');

    await expect(page).toHaveURL(/\/en\/blog\/?$/);
    await expect(page.locator('main').first(), '內文必須跟著換——只換外殼就是那個舊 bug').toContainText(
      'The first test post',
    );
    await expect(page.locator('main').first()).not.toContainText('第一篇測試文章');
  });

  /** 切語言要留在同一頁，不是跳回首頁。 */
  test('切語言保留當前路徑（含帶參數的）', async ({ page }) => {
    await page.goto('/blog/1');
    await pickLanguage(page, 'English');
    await expect(page, '應該是 /en/blog/1 而不是 /en').toHaveURL(/\/en\/blog\/1$/);
  });

  /**
   * 切回預設語系 → **沒有前綴**。
   *
   * `LOCALE_PREFIX['zh-TW']` 是空字串，為的是保留已被索引的舊網址。
   * 少了那個特例會產生 `/zh-tw/blog` 這種不存在的路徑。
   */
  test('切回預設語系不會多出前綴', async ({ page }) => {
    await page.goto('/en/blog');
    await pickLanguage(page, '繁體中文');
    await expect(page).toHaveURL(/\/blog\/?$/);
    await expect(page).not.toHaveURL(/zh-tw/i);
    await expect(page.locator('main').first()).toContainText('第一篇測試文章');
  });

  /** 目前語系要標 `aria-current`——沒有它，用報讀器的人不知道現在是哪一個。 */
  test('目前語系有標記出來', async ({ page }) => {
    await page.goto('/en/blog');
    await page.locator(PICKER).scrollIntoViewIfNeeded();
    await expect(async () => {
      await page.locator(PICKER).click();
      await expect(page.locator('.lang-picker-popup')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    const current = page.locator(`${ITEM}[aria-current="true"]`);
    await expect(current, '應該只有一個被標成目前語系').toHaveCount(1);
    await expect(current).toContainText('English');
  });

  /** Esc 關掉選單（元件有掛 keydown，但沒有人測過）。 */
  test('Esc 關得掉語言選單', async ({ page }) => {
    await page.goto('/blog');
    await page.locator(PICKER).scrollIntoViewIfNeeded();
    await expect(async () => {
      await page.locator(PICKER).click();
      await expect(page.locator('.lang-picker-popup')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator('.lang-picker-popup')).toBeHidden();
    await expect(page.locator(PICKER)).toHaveAttribute('aria-expanded', 'false');
  });
});

/**
 * 首頁 `/` 依 `Accept-Language` 在 **server 端** 302 到對應語系（src/routes/index.tsx）。
 *
 * 這條路徑決定的是「第一次來的人看到什麼」，而它從來沒有任何測試守著。三個容易壞的點：
 *
 *   · 導錯或不導 —— 日本讀者打開首頁看到中文，而他不會知道有 /ja 可以去
 *   · cookie 沒有優先於瀏覽器設定 —— 使用者明明選過語言，下次回來又被打回去
 *   · **對爬蟲也導** —— 這個最貴：Google 從 `/` 被 302 到 `/en`，等於宣告首頁的
 *     正規版本是英文的，各語系的 hreflang 索引整組錯掉。而站上完全看不出異狀。
 *
 * ⚠ 這一組每個 test 都要自己的 context（Accept-Language 是 context 級的），
 *   所以用 test.use() 開獨立的 describe，不能塞進上面那組。
 */
test.describe('首頁的語言自動導向', () => {
  for (const [locale, expected] of [
    ['ja-JP', '/ja'],
    ['ko-KR', '/ko'],
    ['en-US', '/en'],
  ] as const) {
    test.describe(`${locale} 的瀏覽器`, () => {
      test.use({ locale });
      test(`打開首頁會被送到 ${expected}`, async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL(new RegExp(`${expected}$`), { timeout: 15_000 });
        await expect(page.locator('html')).toHaveAttribute('lang', expected.slice(1));
      });
    });
  }

  test.describe('zh-TW 的瀏覽器', () => {
    test.use({ locale: 'zh-TW' });
    test('留在沒有前綴的首頁', async ({ page }) => {
      await page.goto('/');
      // 預設語系不該多一層 /zh-tw 前綴——多了的話正規網址就變成兩個
      await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    });
  });

  test.describe('選過語言的人', () => {
    test.use({ locale: 'en-US' });
    test('cookie 優先於瀏覽器的 Accept-Language', async ({ page, context, baseURL }) => {
      // 使用者在語言選單選過日文 → 之後即使瀏覽器仍宣稱 en-US，也該回到日文
      expect(baseURL, 'playwright.config.ts 應該有設 baseURL').toBeTruthy();
      await context.addCookies([{ name: 'koim_locale', value: 'ja', url: String(baseURL) }]);
      await page.goto('/');
      await expect(page, 'cookie 沒有蓋過 Accept-Language').toHaveURL(/\/ja$/, { timeout: 15_000 });
    });
  });

  test.describe('爬蟲', () => {
    test.use({
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    test('不導向，停在預設語系的首頁', async ({ page }) => {
      await page.goto('/');
      await expect(
        page,
        '爬蟲被 302 走的話，首頁的正規版本就會變成別的語系，hreflang 整組錯掉',
      ).toHaveURL(/\/$/, { timeout: 15_000 });
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    });
  });
});

test.describe('文章篩選', () => {
  const SEARCH = '.blog-search-input';
  // ⚠ 必須是 `.note-card`，不能用 `main a[href^="/blog/"]`——側邊欄的「精選」與
  // 「導航」也是指向 /blog/ 的連結，用寬選擇器會把它們算成文章，於是
  // 「搜尋不到時應該是 0 筆」永遠不成立（第一版就是這樣紅的）。
  //
  // 排掉測試自己建的文章：post-editor.spec.ts 有一條會真的發佈一篇，而跨檔是平行跑的。
  // 下面幾條都是「先數一次 before，做點事，再數一次」——中間插進來一篇就會紅，
  // 而且是那種跑十次紅一次、最難查的紅。改成從來源就不看它們，比縮短競爭窗口可靠。
  const cards = (page: import('@playwright/test').Page) =>
    page.locator('.note-card').filter({ hasNotText: E2E_POST_PREFIX });

  /** 搜尋只留下符合的文章。 */
  test('搜尋會縮小清單', async ({ page }) => {
    await page.goto('/blog');
    const before = await cards(page).count();
    expect(before, '種子資料應該有多篇文章，否則這條測不出東西').toBeGreaterThan(1);

    await page.locator(SEARCH).fill('第一篇');
    await expect.poll(() => cards(page).count(), { message: '搜尋後應該變少' }).toBeLessThan(before);
    await expect(page.locator('.notes-timeline')).toContainText('第一篇測試文章');
    await expect(page.locator('.notes-timeline')).not.toContainText('第二篇測試文章');
  });

  /** 清掉搜尋 → 全部回來（`.search-clear` 那顆按鈕只有有輸入時才出現）。 */
  test('清除搜尋會把清單還原', async ({ page }) => {
    await page.goto('/blog');
    const before = await cards(page).count();

    await page.locator(SEARCH).fill('第一篇');
    await expect.poll(() => cards(page).count()).toBeLessThan(before);

    await page.locator('.search-clear').click();
    await expect(page.locator(SEARCH)).toHaveValue('');
    await expect.poll(() => cards(page).count(), { message: '清除後應該全部回來' }).toBe(before);
  });

  /** 搜尋不到 → 顯示空狀態，而不是一片空白讓人以為壞了。 */
  test('搜尋不到會顯示空狀態', async ({ page }) => {
    await page.goto('/blog');
    await page.locator(SEARCH).fill('這串字不可能存在於任何一篇文章裡');
    await expect(page.locator('.blog-empty')).toBeVisible();
    await expect.poll(() => cards(page).count()).toBe(0);
  });

  /** 點分類 → 只剩該分類，而且會出現「已套用的篩選」讓人知道現在被篩過。 */
  test('點分類會篩選，而且看得出來正在篩選', async ({ page }) => {
    await page.goto('/blog');
    const before = await cards(page).count();

    // 第一個是「全部」，取第二個才是真的分類
    const cat = page.locator('.category-item').nth(1);
    await expect(cat).toBeVisible();
    const name = (await cat.innerText()).trim();
    await cat.click();

    await expect(cat).toHaveClass(/active/);
    await expect(page.locator('.active-filters'), '要讓使用者看得出來清單被篩過').toBeVisible();
    await expect(page.locator('.active-filter-chip').first()).toContainText(name.split('\n')[0]);
    expect(await cards(page).count(), '篩選後不該比原本多').toBeLessThanOrEqual(before);
  });

  /**
   * 搜尋與分類是**交集**不是聯集。
   *
   * 三個 state（searchTerm / selectedTag / selectedCategory）在同一個 `filter` 裡
   * 用 `&&` 串起來。改成 `||` 的話畫面看起來「有東西」所以不容易察覺，
   * 但使用者篩了兩個條件卻拿到更多結果。
   */
  test('搜尋與分類同時套用時取交集', async ({ page }) => {
    await page.goto('/blog');

    const cat = page.locator('.category-item').nth(1);
    await cat.click();
    const afterCat = await cards(page).count();

    await page.locator(SEARCH).fill('第一篇');
    await expect
      .poll(() => cards(page).count(), { message: '再加搜尋條件不該讓結果變多（那是 || 不是 &&）' })
      .toBeLessThanOrEqual(afterCat);
  });
});
