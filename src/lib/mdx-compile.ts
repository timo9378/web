import { createServerFn } from '@tanstack/react-start';

// MDX 編譯是 server-only（@mdx-js/mdx 的 compiler = micromark + acorn，很重，不進 client bundle）。
// 用 createServerFn：SSR 時 in-process 跑；client 端導覽時走 RPC 回 server 拿編譯結果。
// 產出是 `function-body` 字串（可序列化、可 dehydrate），前端用 runSync 執行成 React 元件。
//
// ⚠️ 只給 format='mdx' 的文章用；內容是站長本人審過的（Agent 產 + 人工 review）。
// 實際的編譯設定在 ./mdx-compile-core（沒有框架相依），這樣 scripts/check-mdx.ts
// 能用**同一組 plugin** 檢查已發布的文章，不會兩邊各抄一份而漂掉。
export const compileMdx = createServerFn({ method: 'POST' })
  .validator((source: string) => source)
  .handler(async ({ data: source }): Promise<string> => {
    const { compileMdxSource } = await import('./mdx-compile-core');
    return compileMdxSource(source);
  });
