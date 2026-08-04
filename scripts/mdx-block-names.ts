import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'src/components/mdx/mdx-blocks-registry.ts';

/**
 * 解出已註冊的 MDX block 名單。
 *
 * 為什麼是 regex 而不是 import：那個模組會拉進 React、27 個 block 元件與 CSS，
 * 在純 node 腳本裡跑不起來。而「regex 解得對不對」由
 * src/components/mdx/mdx-blocks-registry.test.ts 拿真的 `Object.keys(MDX_BLOCKS)` 對照，
 * 所以這個便宜做法有東西在保證它不會悄悄失準。
 */
export function readRegisteredBlocks(): string[] {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(path.join(root, REGISTRY), 'utf8');
  const m = /export const MDX_BLOCKS = \{([\s\S]*?)\};/.exec(src);
  if (!m) throw new Error(`在 ${REGISTRY} 裡找不到 MDX_BLOCKS —— 這支解析器該更新了`);
  return [...m[1].matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)].map((x) => x[1]);
}
