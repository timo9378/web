/* runtime MDX：元件由 server 編譯出的字串經 runSync 生成——本質上就是「執行期產生元件」，
   @eslint-react/static-components 會擋。以 compiled 為 memo key（只有文章內容變才重建、
   狀態重置不成問題），此檔專責這個模式 → 檔案層關該規則。 */
/* eslint-disable @eslint-react/static-components */
import { useMemo } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { runSync } from '@mdx-js/mdx';
import { MDX_BLOCKS } from './mdx-blocks-registry';
import './MdxContent.css';

interface MdxContentProps {
  compiled: string;
  // 基礎元素 override（code/pre/p/a/img/h1-h4）由 BlogPost 傳入，與 markdown 管線共用同一批
  // 元件（shiki 高亮、mermaid、連結卡、圖片燈箱、標題錨點）→ MDX 文不比 markdown 文遜。
  baseComponents?: Record<string, unknown>;
}

// 把 server 端 compileMdx 產出的 function-body 字串，用 runSync 執行成 React 元件。
// runSync 同步 → SSR 與 hydration 都能在 render 期直接跑（無 Suspense 破口）。
// ⚠️ runSync 底層是 new Function → client 端需 CSP 允許 'unsafe-eval'（blog 路由）。
export function MdxContent({ compiled, baseComponents }: MdxContentProps) {
  return useMemo(() => {
    try {
      const { default: Content } = runSync(compiled, {
        ...jsxRuntime,
        baseUrl: 'https://koimsurai.com/',
      });
      // 自訂 block 覆蓋在 base 之上（同名以 block 為準）。
      const components = { ...baseComponents, ...MDX_BLOCKS };
      return <Content components={components} />;
    } catch (e) {
      return (
        <div className="mdx-error">
          <strong>⚠ MDX 渲染失敗</strong>
          <pre>{e instanceof Error ? e.message : String(e)}</pre>
        </div>
      );
    }
  }, [compiled, baseComponents]);
}
