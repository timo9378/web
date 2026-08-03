import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 前端單元測試（vitest）。與 vite.config.start.ts 分離：
// 測試不需要 TanStack Start/Nitro 插件，獨立 config 啟動快且零副作用。
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // CI 多產一份 JUnit 給 Codecov Test Analytics（每條測試的歷史失敗率 / flaky）。
    // 寫在這裡而不是在 workflow 裡改寫指令：`pnpm test` 是 CLAUDE.md 列的門檻指令，
    // 兩邊跑的必須是同一條，不然「本機綠 CI 紅」會多一個說不清的來源。
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: './junit-frontend.xml' },
  },
});
