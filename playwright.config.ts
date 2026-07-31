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
