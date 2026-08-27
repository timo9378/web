import { createContext, use } from 'react';

/**
 * 伺服器端預先渲染好的 mermaid SVG 對照表（鍵見 `lib/mdx/mermaidFences.ts` 的 mermaidKey）。
 *
 * 為什麼要 context：渲染圖的 `MermaidBlock` 是被 markdown/MDX 的元件表掛上去的，
 * 中間隔著 ReactMarkdown 的內部結構，沒有辦法用 prop 一路傳下去。
 * 而 `CodeBlock` 是頂層 export（後台預覽也重用同一顆），所以也不能靠閉包。
 */
export const MermaidSvgContext = createContext<Record<string, string>>({});

export function useMermaidSvgs(): Record<string, string> {
  return use(MermaidSvgContext);
}
