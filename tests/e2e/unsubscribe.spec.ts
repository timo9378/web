/**
 * 退訂頁（`/unsubscribe?token=…`）。
 *
 * 這一頁在此之前完全沒有 e2e——`routes.ts` 把它 SKIP 掉，理由是「需要退訂 token」。
 * 那個理由是對的（token 只有真的訂閱時才生成、API 不會回給呼叫端），
 * 但正確的做法是**種一個**而不是不測：讀者點了信裡的退訂連結卻看到錯誤畫面，
 * 是這整條路徑上最糟的結果，而且他不會回報，只會把整封信標成垃圾郵件。
 *
 * 這條測的是完整往返：信裡的連結 → 頁面查得到是誰 → 按確認 → 後端真的改了狀態。
 */

import { expect, test, type Page } from '@playwright/test';

import { UNSUB_TOKEN } from './seed.mjs';

const card = (page: Page) => page.locator('.unsubscribe-card');

test.describe('退訂頁', () => {
  // 序列：這幾條共用同一筆種子訂閱者，而「確認退訂」會改它的狀態。
  test.describe.configure({ mode: 'serial' });

  test('沒有 token 時說明要去信裡點連結，而不是一片空白', async ({ page }) => {
    await page.goto('/unsubscribe');
    await expect(card(page)).toContainText('連結缺少 token');
    // 不該出現確認按鈕——沒有 token 就沒有可退訂的對象
    await expect(page.getByRole('button', { name: '確認退訂' })).toHaveCount(0);
  });

  test('token 無效時說連結過期，不是卡在驗證中', async ({ page }) => {
    await page.goto('/unsubscribe?token=這個token不存在');
    // 「驗證連結中…」是 loading 態；停在那裡等於畫面永遠轉圈
    await expect(card(page)).toContainText('連結無效或已過期', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: '確認退訂' })).toHaveCount(0);
  });

  test('有效 token：顯示是哪個信箱，按確認之後真的退訂', async ({ page, request }) => {
    await page.goto(`/unsubscribe?token=${UNSUB_TOKEN}`);

    // 要顯示「你正在用 <email> 退訂」——顯示錯的信箱比顯示不出來更糟
    await expect(card(page)).toContainText('確認退訂', { timeout: 15_000 });
    await expect(card(page)).toContainText('reader@example.com');

    await page.getByRole('button', { name: '確認退訂' }).click();
    await expect(card(page), '按了確認要走到成功畫面').toContainText('已退訂', { timeout: 15_000 });
    await expect(card(page)).toContainText('reader@example.com');

    // 畫面說成功不代表真的改了——回頭問後端
    const r = await request.get(`/api/newsletter/by-token/${UNSUB_TOKEN}`);
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { status?: string; email?: string };
    expect(body.status, '畫面顯示已退訂但後端狀態沒變').toBe('unsubscribed');
    expect(body.email).toBe('reader@example.com');
  });

  test('已經退訂過的連結直接顯示成功，不會再問一次', async ({ page }) => {
    // 上一條已經把它退訂了（serial）。使用者重複點信裡的連結是很常見的。
    await page.goto(`/unsubscribe?token=${UNSUB_TOKEN}`);
    await expect(card(page)).toContainText('已退訂', { timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: '確認退訂' }),
      '已經退訂了還問一次「確認退訂?」會讓人以為上次沒成功',
    ).toHaveCount(0);
  });
});
