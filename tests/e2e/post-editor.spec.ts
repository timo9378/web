/**
 * 文章編輯器（`/admin/posts/create`、`/admin/posts/edit/$id`）。
 *
 * 這是後台最大的一支元件（PostEditor.tsx 約 1400 行），也是站長真正花時間的地方，
 * 但在這個檔之前 e2e 對它只驗過「未登入進不去」。
 *
 * 挑的是**壞了不會有錯誤訊息**的那幾條。其中兩條的成因就寫在元件的註解裡，
 * 表示已經發生過一次：
 *
 *   1. 「共用 controller/Monaco model 造成第二次切回顯示舊內容」
 *      —— 多語系文章寫到一半切分頁，回來內容變成別的語系的。
 *   2. 「後端 create 回 { data: { id } }；沒抓到就會每次都 POST → 重複建立草稿」
 *      —— 存兩次草稿就變成兩篇文章，而且畫面上完全看不出來。
 *
 * ## Monaco 怎麼操作
 *
 * `.monaco-editor textarea` 會選到 `.ime-text-area`（readonly + aria-hidden），
 * 點它一定逾時。要點的是 `.view-lines`，點完再用 `keyboard.type()`。
 * 讀內容也是讀 `.view-lines` 的 innerText（Monaco 是虛擬捲動，長文只會有可視範圍，
 * 所以測試用的內容都刻意保持短）。
 *
 * ⚠️ Monaco 是從 **jsdelivr CDN** 載入的（`@monaco-editor/loader` 的預設
 * `paths.vs = https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`，
 * repo 裡沒有任何 `loader.config` 覆蓋它）。所以這個檔的每一條測試都依賴外網，
 * 而且實際跑的版本是 CDN 上的 0.55.1，不是 package.json 釘的 0.53.0（那份只當型別用）。
 * 實測載入 1.2s / 13 個請求。這件事本身值得修（自帶 monaco），但那是 build 設定的變更。
 *
 * ## 為什麼標題都帶 `e2e-post-` 前綴而且用完要刪
 *
 * `api-contract.spec.ts` 有一條 `/api/posts` 的**精確篇數**斷言。跨檔是平行跑的，
 * 這裡發布一篇文章就會讓那條紅。所以：固定前綴 + 測試結束刪掉，
 * 而那條斷言也改成排除這個前綴（見 api-contract.spec.ts 的註解）。
 */

import { expect, test, type Page } from '@playwright/test';

import { gotoAdminUntil, signIn } from './admin-session';
import { E2E_POST_PREFIX } from './seed.mjs';

const titleInput = (p: Page) => p.getByPlaceholder('輸入文章標題...');
const viewLines = (p: Page) => p.locator('.monaco-editor .view-lines').first();

/** 進編輯器並等 Monaco 真的掛好（CDN 載入，比其他後台頁慢）。 */
async function gotoEditor(page: Page, path = '/admin/posts/create') {
  await gotoAdminUntil(page, path, (p) => p.locator('.monaco-editor').first());
  await expect(titleInput(page)).toBeVisible();
}

/** 點進 Monaco 打字。`clear` 用全選再覆蓋，比逐字退格穩。 */
async function typeContent(page: Page, text: string, opts: { clear?: boolean } = {}) {
  await viewLines(page).click();
  if (opts.clear) {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
  }
  await page.keyboard.type(text);
}

async function contentText(page: Page): Promise<string> {
  return (await viewLines(page).innerText()).replace(/ /g, ' ').trim();
}

/**
 * 語系分頁鈕。**不能用 exact**：原文那顆會多一個「原文」徽章
 * （accessible name 變成「繁體 原文」），已填內容的那顆會多一個小圓點
 * （span 沒有文字，名字不變，但別依賴這點）。用開頭錨定的 regex 最穩，
 * 也不會誤中旁邊的「自動產生简中」。
 */
const localeTab = (p: Page, label: string) => p.getByRole('button', { name: new RegExp(`^${label}`) });

/** 用 admin API 撈出所有 e2e 建立的文章，收尾時刪掉。 */
async function cleanupPosts(page: Page) {
  await page.evaluate(async ({ key, prefix }) => {
    const token = window.localStorage.getItem(key);
    const headers = { Authorization: `Bearer ${token ?? ''}` };
    const r = await fetch('/api/admin/posts?limit=200', { headers });
    if (!r.ok) return;
    const body = await r.json() as { posts?: { id: number; title: string }[] };
    for (const p of body.posts ?? []) {
      if (p.title?.startsWith(prefix)) {
        await fetch(`/api/admin/posts/${p.id}`, { method: 'DELETE', headers });
      }
    }
  }, { key: 'koimsurai_user_token', prefix: E2E_POST_PREFIX });
}

/** 目前有幾篇標題等於 name 的文章（含草稿）——驗「有沒有重複建立」用。 */
async function countPostsNamed(page: Page, name: string): Promise<number> {
  return page.evaluate(async ({ key, name }) => {
    const token = window.localStorage.getItem(key);
    const r = await fetch('/api/admin/posts?limit=200', { headers: { Authorization: `Bearer ${token ?? ''}` } });
    if (!r.ok) return -1;
    const body = await r.json() as { posts?: { title: string }[] };
    return (body.posts ?? []).filter((p) => p.title === name).length;
  }, { key: 'koimsurai_user_token', name });
}

test.describe('文章編輯器', () => {
  // 序列執行，理由同 admin.spec.ts：這些測試會建立/刪除文章（共用狀態），
  // 而且編輯器是 lazy + Monaco 從 CDN 載，跟 axe 掃描搶資源時會明顯變慢。
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await cleanupPosts(page);
    await page.close();
  });

  /**
   * 存草稿的完整往返，外加**重複建立**的回歸。
   *
   * 元件註解：「後端 create 回 { data: { id } }；沒抓到就會每次都 POST → 重複建立草稿」。
   * 所以這裡按兩次儲存，然後數同名文章——第二次必須走 PUT 而不是再 POST 一篇。
   */
  test('存草稿：建立一次、轉到編輯網址，再存不會變成第二篇', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}draft-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '第一段內容。');

    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('草稿已儲存').first()).toBeVisible({ timeout: 15_000 });
    // 建立成功要帶著新 id 轉到編輯網址；停在 /create 就是沒抓到回傳的 id
    await expect(page, '存完要轉到 /admin/posts/edit/<id>').toHaveURL(/\/admin\/posts\/edit\/\d+$/, {
      timeout: 15_000,
    });
    expect(await countPostsNamed(page, name)).toBe(1);

    // 再存一次：此時有 id，應該走 PUT
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('草稿已儲存').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => countPostsNamed(page, name), { message: '第二次儲存不該再建一篇' })
      .toBe(1);
  });

  /** 草稿不該出現在公開清單——「還沒寫完就見客」是最不該發生的一種。 */
  test('存成草稿的文章讀者看不到', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}hidden-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '這是還沒寫完的草稿。');
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('草稿已儲存').first()).toBeVisible({ timeout: 15_000 });

    const listed = await page.evaluate(async (t) => {
      const r = await fetch('/api/posts');
      const b = await r.json() as { posts?: { title: string }[] };
      return (b.posts ?? []).some((p) => p.title === t);
    }, name);
    expect(listed, '草稿不該出現在 /api/posts').toBe(false);

    await page.goto('/blog');
    await expect(page.getByText(name)).toHaveCount(0);
  });

  /**
   * 發佈：站長按下去之後讀者要真的看得到。
   * 這條跨了編輯器 → admin API → 公開 API → 前台清單四層，中間任何一環壞掉
   * 都會變成「我明明發了」而沒有任何錯誤訊息。
   */
  test('發佈之後文章出現在公開清單', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}published-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '已經寫完可以見客了。');

    await page.getByRole('button', { name: '發佈文章' }).click();
    await expect
      .poll(async () => page.evaluate(async (t) => {
        const r = await fetch('/api/posts');
        const b = await r.json() as { posts?: { title: string }[] };
        return (b.posts ?? []).some((p) => p.title === t);
      }, name), { message: '發佈後應該出現在 /api/posts', timeout: 20_000 })
      .toBe(true);

    await page.goto('/blog');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  /**
   * **語系分頁切換不會串內容**——元件註解點名修過的 bug：
   * 「共用 controller/Monaco model 造成第二次切回顯示舊內容」。
   *
   * 所以不是切一次就好，要切回去**第二次**：zh-TW → en → zh-TW → en。
   * 壞掉的症狀是站長寫日文版寫到一半，切回來看到的是中文版的內容，
   * 然後在上面繼續打字——覆蓋掉原文。
   */
  test('語系分頁：切走再切回，各語系的標題與內容都不會互相污染', async ({ page }) => {
    const zh = `${E2E_POST_PREFIX}locale-${Date.now()}`;
    await gotoEditor(page);

    await titleInput(page).fill(zh);
    await typeContent(page, '繁體內容。');

    await localeTab(page, 'English').click();
    await expect(titleInput(page), '切到未填的語系應該是空白，不是沿用原文').toHaveValue('');
    await expect.poll(() => contentText(page)).toBe('');
    await titleInput(page).fill('english title');
    await typeContent(page, 'English body.');

    await localeTab(page, '繁體').click();
    await expect(titleInput(page)).toHaveValue(zh);
    await expect.poll(() => contentText(page)).toBe('繁體內容。');

    // 這一步才是回歸點：第二次切回 English
    await localeTab(page, 'English').click();
    await expect(titleInput(page), '第二次切回來不該顯示舊內容').toHaveValue('english title');
    await expect.poll(() => contentText(page), { message: '第二次切回來的內容要是 English 那份' })
      .toBe('English body.');

    // 再回繁體一次，確認來回多次都穩
    await localeTab(page, '繁體').click();
    await expect(titleInput(page)).toHaveValue(zh);
    await expect.poll(() => contentText(page)).toBe('繁體內容。');
  });

  /**
   * 標題或內容沒填時按儲存：要跳錯誤提示、**指出是哪一欄**，而且不能真的送出。
   *
   * 「指出哪一欄」是後來才有的：原本四個送出點都寫死「請先填寫標題與內容」，
   * 於是任何欄位驗不過都顯示同一句——`category` 為 null 讓整篇存不起來的時候，
   * 畫面卻叫站長去檢查標題與內容（那兩欄好好的）。所以這裡斷言欄位名有出現。
   */
  test('缺標題或內容時不會送出，而且說得出是哪一欄', async ({ page }) => {
    await gotoEditor(page);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/admin/posts')) posts.push(r.url());
    });

    // 只有內容沒有標題
    await typeContent(page, '有內容但沒標題。');
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('title：標題不能為空').first()).toBeVisible({ timeout: 10_000 });

    // 只有標題沒有內容
    await titleInput(page).fill(`${E2E_POST_PREFIX}invalid`);
    await typeContent(page, '', { clear: true });
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('content：內容不能為空').first()).toBeVisible({ timeout: 10_000 });

    expect(posts, '驗證沒過就不該打 admin API').toEqual([]);
    await expect(page, '也不該轉頁').toHaveURL(/\/admin\/posts\/create$/);
  });

  /**
   * 預覽走的是**跟前台同一套渲染**（元件註解：「MDX blocks / shiki / alert / 連結卡」）。
   * 若哪天預覽改用別的渲染器，站長看到的就不是讀者看到的——所見不是所得。
   */
  test('預覽把 markdown 渲染成跟前台一樣的 HTML', async ({ page }) => {
    await gotoEditor(page);
    await typeContent(page, '# 預覽標題\n\n一段**粗體**文字。\n');

    await page.getByRole('button', { name: '預覽', exact: true }).click();
    await expect(page.getByRole('heading', { name: '預覽標題' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('strong', { hasText: '粗體' })).toBeVisible();

    // 分割模式要同時看得到編輯器與預覽
    await page.getByRole('button', { name: '分割', exact: true }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '預覽標題' })).toBeVisible();

    // 回編輯模式，預覽收起來
    await page.getByRole('button', { name: '編輯', exact: true }).click();
    await expect(page.getByRole('heading', { name: '預覽標題' })).toBeHidden();
  });

  /**
   * localStorage 自動備份（debounce 1.2s）＋重新整理後提示還原。
   * 這是「瀏覽器當掉/誤關分頁」的保險，壞掉的話沒有任何症狀——直到真的需要它那一次。
   */
  test('自動備份草稿，重新整理後可以還原', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}autosave-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '還沒存就關掉的內容。');

    await expect(page.getByText('已自動備份'), 'debounce 1.2s 之後要出現備份提示')
      .toBeVisible({ timeout: 15_000 });

    // 直接重新整理（模擬誤關分頁後再打開）
    await page.reload();
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    const restore = page.getByRole('button', { name: '還原' });
    await expect(restore, '應該提示有未儲存的草稿').toBeVisible({ timeout: 15_000 });
    await restore.click();

    await expect(titleInput(page)).toHaveValue(name);
    await expect.poll(() => contentText(page)).toBe('還沒存就關掉的內容。');
  });

  /** Zen 模式：F11 進、Esc 出，靠 body class 讓側欄與 header 收起來。 */
  test('Zen 模式用 F11 進、Esc 出', async ({ page }) => {
    await gotoEditor(page);
    const zen = () => page.evaluate(() => document.body.classList.contains('zen-mode-active'));
    expect(await zen()).toBe(false);

    await page.keyboard.press('F11');
    await expect.poll(zen, { message: 'F11 應該進 Zen 模式' }).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(zen, { message: 'Esc 應該退出' }).toBe(false);
  });

  /**
   * 「存並回列表」跟「儲存草稿」的差別只在存完去哪裡——但那正是站長最常按的那顆，
   * 按了沒回列表會讓人以為沒存到，然後再按一次。
   */
  test('存並回列表：存完回到文章列表', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}exit-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '存完就走。');

    await page.getByRole('button', { name: '存並回列表' }).click();
    await expect(page).toHaveURL(/\/admin\/posts$/, { timeout: 20_000 });
    await expect(page.getByText(name).first(), '列表上要看得到剛存的那篇')
      .toBeVisible({ timeout: 15_000 });
  });

  /**
   * 編輯既有文章：載入既有內容 → 改 → 存 → 再開還是改過的。
   * 「打開編輯器結果是空白」與「改了存了但沒生效」都屬於沒有錯誤訊息的那類。
   */
  test('編輯既有文章：載得進來、改得掉、存得住', async ({ page }) => {
    const name = `${E2E_POST_PREFIX}edit-${Date.now()}`;
    await gotoEditor(page);
    await titleInput(page).fill(name);
    await typeContent(page, '原始內容。');
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page).toHaveURL(/\/admin\/posts\/edit\/(\d+)$/, { timeout: 20_000 });
    const editUrl = new URL(page.url()).pathname;

    // 重新開一次同一篇：內容要載回來
    await gotoEditor(page, editUrl);
    await expect(titleInput(page)).toHaveValue(name, { timeout: 15_000 });
    await expect.poll(() => contentText(page), { message: '既有內容要載進編輯器' })
      .toBe('原始內容。');

    await typeContent(page, '改過的內容。', { clear: true });
    await page.getByRole('button', { name: '儲存草稿' }).click();
    await expect(page.getByText('草稿已儲存').first()).toBeVisible({ timeout: 15_000 });

    await gotoEditor(page, editUrl);
    await expect.poll(() => contentText(page), { message: '改動要真的存進去' })
      .toBe('改過的內容。');
  });
});
