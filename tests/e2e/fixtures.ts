// e2e 的共用 test/expect。**所有 spec 都從這裡 import，不要直接 import '@playwright/test'。**
//
// 目前它只做一件事：在設了 `E2E_COVERAGE_DIR` 時收集 V8 的 JS coverage，
// 讓「203 條 e2e 到底走過多少原始碼」這件事變成 CI 上的一個數字，而不是每次要手動量。
//
// 為什麼值得為此改掉 19 支 spec 的 import：
// 單元測試的覆蓋率分母有**八成是 React 元件**（5477/6923 行），而元件的渲染路徑
// 本來就是 e2e 在守的。只看單元覆蓋率會得到 6% 這種數字，看起來像「幾乎沒測」，
// 實際上 e2e 走過的原始碼是它的十倍。兩個數字要並排才看得懂。
//
// ⚠ 沒設 `E2E_COVERAGE_DIR` 時**完全不做事**（直接 re-export 原本的 test），
//   本機跑 e2e 不會多付任何成本。
//
// ⚠ `page.coverage` 只有 Chromium 有。非 chromium 的 project 會直接跳過，
//   不是失敗——這樣未來要加 firefox/webkit 也不必動這裡。

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const COVERAGE_DIR = process.env.E2E_COVERAGE_DIR;

let seq = 0;

const withCoverage = base.extend({
  page: async ({ page }, use, testInfo) => {
    let started = false;
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
      started = true;
    } catch {
      /* 非 Chromium：沒有 coverage API，照常跑測試 */
    }

    await use(page);

    if (!started) return;
    try {
      const entries = await page.coverage.stopJSCoverage();
      // 只留自家的 JS，並丟掉 source（很大，聚合時從 .output 讀得到）
      const slim = entries
        .filter((e) => e.url.includes('/assets/') && e.url.endsWith('.js'))
        .map(({ url, functions }) => ({ url, functions }));
      if (!slim.length) return;
      const name = `${process.pid}-${seq++}-${testInfo.workerIndex}.json`;
      fs.writeFileSync(path.join(COVERAGE_DIR as string, name), JSON.stringify(slim));
    } catch {
      /* 收集失敗不該讓測試變紅——它不是被測的東西 */
    }
  },
});

if (COVERAGE_DIR) fs.mkdirSync(COVERAGE_DIR, { recursive: true });

export const test = COVERAGE_DIR ? withCoverage : base;
export { expect };
