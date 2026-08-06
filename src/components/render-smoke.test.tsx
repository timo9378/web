// @vitest-environment jsdom
//
// 全元件的掛載煙霧測試：把每個元件用預設 props 掛起來，斷言它不會炸。
//
// 這支存在的理由是**數量**：`src/components` 佔前端覆蓋率分母的 79%（5477/6923 行），
// 一支一支手寫測試追不上。這裡用一支參數化測試涵蓋全部，成本是一個檔。
//
// ⚠ 它抓得到什麼、抓不到什麼，講清楚免得誤會它的價值：
//   ✅ import 期就炸（循環相依、頂層取 window / document）
//   ✅ 掛載期就炸（缺 provider、預設 props 沒防呆、effect 裡取用不存在的東西）
//   ❌ 任何**行為**錯誤——那要斷言輸出，不是這支的工作
//
//   對 e2e 走得到的元件，它的邊際價值不高（e2e 本來就在渲染它們）。
//   真正的收穫在 **e2e 碰不到的那批**：後台子面板、錯誤狀態、
//   以及量覆蓋率時發現「從頭到尾沒被載入過」的那些檔案。

import type React from 'react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test-utils/renderWithProviders';

/**
 * ⚠ glob 的字串必須是**字面值**，vite 靠靜態分析它才展得開——
 * 不能抽成變數，也不能用樣板字串拼。
 */
const MODULES = import.meta.glob('/src/components/**/*.tsx', { eager: false });

/** shadcn 與 animate-ui 產生的檔（CLAUDE.md：這兩個路徑不手動整理），還有測試自己。 */
const EXCLUDE = /\/(ui|animate-ui)\/|\.test\.tsx$/;

const entries = Object.entries(MODULES)
  .filter(([path]) => !EXCLUDE.test(path))
  .sort(([a], [b]) => a.localeCompare(b));

afterEach(cleanup);

describe('全元件掛載煙霧測試', () => {
  it('找得到元件檔（glob 沒展開的話這支等於沒跑）', () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  for (const [path, load] of entries) {
    const name = path.replace('/src/components/', '');
    it(`${name} 掛得起來`, async () => {
      const mod = (await load()) as { default?: unknown };
      const Comp = mod.default as React.ComponentType<Record<string, never>> | undefined;
      // 沒有 default export 的（純型別檔、具名匯出集合）只驗 import 不炸
      if (typeof Comp !== 'function') return;
      await renderWithProviders(<Comp />);
    });
  }
});
