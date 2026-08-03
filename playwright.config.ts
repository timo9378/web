import { defineConfig, devices } from '@playwright/test';

// E2E 打的是**真的** stack：後端 binary（temp SQLite + seed）＋ nitro server，
// 中間一層最小代理把 /api 併到同一個 origin（生產是 nginx 做這件事）。
// 起法見 tests/e2e/stack.mjs。
const PORT = Number(process.env.E2E_PORT ?? 13996);

export default defineConfig({
  testDir: './tests/e2e',
  // 只跑 .spec.ts；stack.mjs / seed.mjs 是工具不是測試
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // ubuntu-latest 是 4 vCPU。這裡**不**對齊核心數，用 2——原因是瀏覽器會崩。
  //
  // 症狀：`browser.newContext: Target page, context or browser has been closed`。
  // 不是產品的 bug，是 chromium 行程整個死掉；CI 上被 retry 接住所以是綠的 flaky，
  // 但它會蓋掉真正的失敗訊號。本機 `taskset -c 0-3` 綁 4 核模擬，每種設定跑
  // 8 輪 × 137 條：
  //
  //     workers=4                    3/8 輪崩潰    137s/輪
  //     workers=4 + --disable-gpu    2/8           136s   ← 沒用，別再試了
  //     workers=3                    1/8           147s
  //     workers=2                    0/8           176s
  //
  // 是單調斜坡不是閾值，跟 GPU 無關（`--disable-gpu` 那組證明了；而且 headless
  // 的 UA 會被判成 bot，SpaceBackdropShell 直接 return null，three.js 根本沒載，
  // 所以那個旗標連覆蓋率都沒省到——純粹無效）。
  //
  // ⚠ 本機那個 +28% 不要當成 CI 的成本：`taskset` 只限制 CPU，而 runner 真正吃滿的
  //   是記憶體頻寬與磁碟。舊測（66 條時）在真 CI 上 workers 2 vs 4 是 57.0s vs 58.1s，
  //   也就是**多開 worker 在 CI 上根本沒買到東西**。若之後 CI 時間明顯變長再回頭看。
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/e2e/stack.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    // 本機重跑時沿用已起的 stack；CI 一律重起
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
