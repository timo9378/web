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
  // 用 `taskset -c 0-3` 綁 4 核模擬 CI 實測（本機 16 核量不準）：
  //   workers=2  43.3s   ← 原本
  //   workers=3  35.7s
  //   workers=4  32.4s   ← 取這個
  //   workers=6  29.8s   多 2.5s 而已，爭用風險不划算
  // workers=4 連跑六次全綠、零 retry（這裡曾經有過 1/3 機率的 flaky，所以特地多跑幾次）。
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
