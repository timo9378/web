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
    // 覆蓋率同樣只在 CI 自動打開（本機跑 `pnpm test` 不該多付插樁的時間）。
    // 要在本機看就加 `--coverage`——CLI 旗標會蓋過這裡的 enabled。
    coverage: {
      enabled: !!process.env.CI,
      provider: 'v8',
      // lcov 給 Codecov，text 讓 CI log 直接看得到數字（紅了不用點進外部服務）
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // include 要寫死成 src/**，否則 v8 只會統計「被 import 過」的檔案——
      // 一個完全沒有測試碰過的元件會直接從分母消失，覆蓋率就變成假的高。
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // shadcn / animate-ui 產生的檔（CLAUDE.md：這兩個路徑不手動整理）
        'src/components/ui/**',
        'src/components/animate-ui/**',
        // 路由樹是 TanStack 產生的
        'src/routeTree.gen.ts',
        'src/**/*.test.{ts,tsx}',
        'src/vite-env.d.ts',
      ],
    },
  },
});
