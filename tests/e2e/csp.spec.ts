/**
 * Content-Security-Policy 的違規掃描。
 *
 * CSP 壞掉的方式很特別：**它不會讓頁面報錯，它讓功能安靜地消失**。一張被擋下的圖
 * 就是破圖、一個被擋下的 iframe 就是空白區塊、一個被擋下的 worker 就是背景不會動——
 * 全部沒有例外堆疊，只有 console 裡一行違規訊息，而沒有人會去看 console。
 *
 * 所以這個檔做的事只有一件：把每個頁面的 `securitypolicyviolation` 事件全部收起來，
 * 有任何一筆就紅，並且把「哪一條 directive、擋了哪個網址」印出來。
 *
 * ⚠ 這些測試依賴 `tests/e2e/stack.mjs` 的代理層有送 CSP（正式環境是 nginx 送的）。
 *   政策本身在 `scripts/csp.mjs`——三邊共用同一份，不會各自漂移。
 *
 * ⚠ 這裡**驗不到外部圖片**：e2e 環境沒有 TMDb / Spotify 的金鑰，那些網址根本不會被
 *   請求。`img-src` 的白名單是拿 Playwright 掃正式站得到的，維護方式見 csp.mjs 檔頭。
 *   換句話說這個檔擋的是「政策把自家東西擋掉了」，不是「白名單漏了外部來源」。
 */

import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

import { gotoAdminUntil } from './admin-session';

interface Violation {
  directive: string;
  blocked: string;
  source: string;
}

/**
 * 已知且無害的違規：**Zod 的 eval 能力探測**。
 *
 * `zod/v4/core/util.js` 的 `allowsEval()` 會在 try/catch 裡跑一次 `new Function('')`，
 * 用來決定要不要編譯「快一點的驗證器」。CSP 擋下來之後它走直譯路徑——功能完全正常，
 * 只是留下一筆違規回報。後台的表單（react-hook-form + zod resolver）會觸發它。
 *
 * 為什麼不乾脆放行 `'unsafe-eval'`：那等於為了一個「探測失敗也沒差」的東西，
 * 把整站最值錢的一條 CSP 打開。這裡改成明確列為例外——**其餘任何 eval 仍然會紅**，
 * 而列出來也讓下一個人知道這筆不是漏掉沒處理。
 */
function isKnownHarmless(v: Violation): boolean {
  return v.directive === 'script-src' && v.blocked === 'eval' && /\/assets\/PostEditor-/.test(v.source);
}

/** 在任何內容載入前掛上監聽——違規多半發生在第一批資源，晚掛就漏了。 */
async function watchViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Violation[] };
    interface Violation {
      directive: string;
      blocked: string;
      source: string;
    }
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile ?? ''}:${e.lineNumber ?? 0}`,
      });
    });
  });
  return async () =>
    page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp ?? []);
}

function report(path: string, v: Violation[]): string {
  return (
    `${path} 有 ${v.length} 筆 CSP 違規：\n` +
    v.map((x) => `      ${x.directive} 擋掉 ${x.blocked}  （來自 ${x.source}）`).join('\n')
  );
}

/** 前台：每一種頁型各取一個。 */
const PUBLIC_PAGES = [
  '/',
  '/blog',
  '/blog/4', // 長文（CLS 用的那篇）
  '/blog/5', // 有程式碼區塊與圖片
  '/blog/6', // format=mdx，內含 <Poll>
  '/thinking',
  '/photos',
  '/bookshelf',
  '/watch',
  '/watch/library',
  '/music',
  '/activity',
  '/friends',
  '/messages',
  '/portfolio',
  '/setup',
  '/about',
];

test.describe('CSP', () => {
  test('政策有真的送出來', async ({ page }) => {
    const resp = await page.goto('/');
    const csp = resp?.headers()['content-security-policy'];
    expect(csp, '首頁沒有 CSP 標頭').toBeTruthy();
    // 這一版刻意保留的與刻意排除的，都釘住——避免哪天有人「順手」放寬
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    // ⚠ `'unsafe-eval'` 已經拿掉（MDX 不再用 runSync）。這條釘住「不准回來」——
    //   它一旦回來就代表有東西在執行期編譯字串，那是要先問清楚是誰、能不能換掉的事。
    //   注意不能寫成 `not.toContain('unsafe-eval')`：那會連 'wasm-unsafe-eval'
    //   一起誤判（後者是子字串），而 wasm 那條是刻意留著的。
    expect(csp, "script-src 不該有 'unsafe-eval'").not.toContain("'unsafe-eval'");
    // wasm 那條是窄的、會一直留著（shiki 的 oniguruma 正則引擎）
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  for (const path of PUBLIC_PAGES) {
    test(`前台沒有 CSP 違規：${path}`, async ({ page }) => {
      const read = await watchViolations(page);
      await page.goto(path, { waitUntil: 'load' });
      // 捲到底讓 lazy 的東西（圖片、mermaid、留言區）也載進來
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
      const v = await read();
      expect(v, v.length ? report(path, v) : '').toEqual([]);
    });
  }

  /**
   * 後台的編輯器是整站最可能踩到 CSP 的地方：Monaco 自架之後 script 是同源了，
   * 但它會開 worker（語言服務），而 bundler 產的 worker 常常走 `blob:`。
   */
  test('後台編輯器沒有 CSP 違規（Monaco 的 worker）', async ({ page }) => {
    const read = await watchViolations(page);
    await gotoAdminUntil(page, '/admin/posts/create', (p) => p.locator('.monaco-editor').first());
    // 打字會觸發語言服務 → worker 真的被用到
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.type('# 標題\n\n```rust\nfn main() {}\n```\n');
    await page.waitForTimeout(2500);
    const all = await read();
    const v = all.filter((x) => !isKnownHarmless(x));
    expect(v, v.length ? report('/admin/posts/create', v) : '').toEqual([]);

    // 反面：Zod 那筆**應該**還在。哪天它不見了，代表要嘛 zod 換了做法、
    // 要嘛政策被放寬了——兩種都值得回來看一眼，而不是靜靜地變成綠燈。
    expect(all.length - v.length, 'Zod 的 eval 探測不見了，回頭確認是為什麼').toBe(1);
  });
});
