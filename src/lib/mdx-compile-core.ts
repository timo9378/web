// MDX 編譯的**唯一**一份設定。
//
// 為什麼要獨立成一個沒有框架相依的模組：`scripts/check-mdx.ts` 要在 node 裡用同一組
// plugin 編一遍已發布的文章。如果那支腳本自己抄一份選項，日後有人在這裡加 plugin，
// 檢查器會用舊的那組編 —— 過了也不代表線上過，那種檢查比沒有還糟。
//
// mdx-compile.ts（createServerFn 包裝）與 check-mdx.ts 都只呼叫這裡。

/** 產出 `function-body` 字串：可序列化、可 dehydrate，前端用 runSync 執行成 React 元件。 */
export async function compileMdxSource(source: string): Promise<string> {
  const { compile } = await import('@mdx-js/mdx');
  const remarkGfm = (await import('remark-gfm')).default;
  const { remarkAlert } = await import('remark-github-blockquote-alert');
  const compiled = await compile(source, {
    outputFormat: 'function-body',
    development: false,
    // GFM（表格/刪除線/腳註）+ GitHub 式彩色 alert（`> [!WARNING]` 等），與 markdown 管線對齊。
    remarkPlugins: [remarkGfm, remarkAlert],
  });
  return String(compiled);
}
