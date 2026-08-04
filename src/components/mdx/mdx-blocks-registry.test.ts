import { expect, test } from 'vitest';
import { readRegisteredBlocks } from '@/../scripts/mdx-block-names';
import { MDX_BLOCKS } from './mdx-blocks-registry';

/**
 * `scripts/check-mdx.ts` 用 regex 從 mdx-blocks-registry.ts 解出 block 名單
 * （純 node 腳本 import 不動這個模組——會拉進 React 與 27 個元件）。
 *
 * 這支測試是那個便宜做法的保險：拿真的 `Object.keys(MDX_BLOCKS)` 對照 regex 的結果。
 * 哪天有人把註冊表改寫（換成陣列、拆檔、加條件），regex 會悄悄解出空的或殘缺的名單，
 * 而 check-mdx 就變成「永遠說沒問題」——那比沒有檢查更糟。這裡讓它當場紅。
 */
test('check-mdx 的 regex 解析結果 = 真正的 MDX_BLOCKS', () => {
  const parsed = readRegisteredBlocks();
  expect(parsed.length, 'regex 解不出東西＝解析器該更新了').toBeGreaterThan(0);
  expect([...parsed].sort()).toEqual(Object.keys(MDX_BLOCKS).sort());
});

test('每個註冊的 block 都真的是元件，不是 undefined', () => {
  const broken = Object.entries(MDX_BLOCKS)
    .filter(([, v]) => typeof v !== 'function' && typeof v !== 'object')
    .map(([k]) => k);
  expect(broken, '這些 key 對到的不是元件（多半是 import 打錯或檔案被刪）').toEqual([]);
});
