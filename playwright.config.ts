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
  // ubuntu-latest 是 4 vCPU，worker 數對齊核心數。
  //
  // ⚠ 本機用 `taskset -c 0-3` 綁 4 核模擬，量到 workers 2→4 是 43.3s→32.4s，
  //   但**那個改善沒有轉移到 CI**（實測 57.0s → 58.1s，在雜訊範圍內）。
  //   綁核心綁不掉記憶體頻寬與磁碟，runner 的單核也慢得多，2 個 worker 就已經吃滿。
  //   留在 4 是因為它不比 2 差，而且六次跑下來零 retry；真正的瓶頸不在這裡——
  //   是 smoke.spec.ts 那個沒設 timeout 的 networkidle（見該檔註解）。
  workers: process.env.CI ? 4 : undefined,
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
