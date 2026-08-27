import { createServerFn } from '@tanstack/react-start';
import { extractMermaidFences, mermaidKey } from './mermaidFences';

// mermaid 渲染是 server-only（beautiful-mermaid 打包後約 1.5 MB，不進 client bundle）。
// 手法與 `mdx-compile.ts` 的 compileMdx 相同：**動態 import 放在 handler 裡**，模組頂層
// 不能有靜態 import——同一個模組若同時被靜態與動態 import，rollup 會把它併回主 chunk
// （實測 BlogPost 路由 chunk 從 127 KB 變成 1613 KB）。
//
// 產出是「圍籬內容的 hash → SVG 字串」的對照表，可序列化、可 dehydrate，
// 前端 MermaidBlock 直接查表拿現成 SVG，client 端完全不需要渲染器。
export const renderMermaidSvgs = createServerFn({ method: 'POST' })
  .validator((content: string) => content)
  .handler(async ({ data: content }): Promise<Record<string, string>> => {
    const fences = extractMermaidFences(content);
    if (fences.length === 0) return {};
    const { renderMermaidSvg } = await import('./mermaidSvg');
    const out: Record<string, string> = {};
    for (const body of fences) {
      const key = mermaidKey(body);
      if (out[key]) continue; // 同一張圖在文章裡重複出現時只渲染一次
      try {
        out[key] = renderMermaidSvg(body);
      } catch {
        // 單張圖語法壞掉不該讓整篇文章失敗——查不到的那張會退回 client 端顯示錯誤訊息。
      }
    }
    return out;
  });
