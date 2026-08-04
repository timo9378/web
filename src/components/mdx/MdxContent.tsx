import { Fragment, useMemo, type ReactElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { literalValue } from '@koimsurai/mdx-core';
import { MDX_BLOCKS } from './mdx-blocks-registry';
import './MdxContent.css';

interface MdxContentProps {
  /** server 端 `compileMdxSource` 產出的**序列化 hast 樹**（JSON 字串）。 */
  compiled: string;
  // 基礎元素 override（code/pre/p/a/img/h1-h4）由 BlogPost 傳入，與 markdown 管線共用同一批
  // 元件（shiki 高亮、mermaid、連結卡、圖片燈箱、標題錨點）→ MDX 文不比 markdown 文遜。
  baseComponents?: Record<string, unknown>;
}

/**
 * 渲染 server 編譯好的 MDX。
 *
 * ## 為什麼不是 `runSync`
 *
 * 以前是 server 產 `function-body` 字串、前端 `runSync` 執行成元件——而 `runSync`
 * 底層是 `new Function`，需要 CSP 的 `'unsafe-eval'`，等於把整站的 `script-src` 打開。
 *
 * 現在 server 產的是序列化的 hast 樹，這裡用 `hast-util-to-jsx-runtime` 走訪成 React
 * 元素。**沒有任何字串轉程式碼**。這支 util 就是 react-markdown 底層那個，所以
 * JSX 的空白規則、hast 屬性到 React props 的對應全都跟既有的 markdown 管線一致——
 * 自己重寫那套會在細節上跟 MDX 不同（實測過，表格與段落的換行會各差一種）。
 *
 * 仍然是**同步**的，所以 SSR 與 hydration 都能在 render 期直接跑，沒有 Suspense 破口。
 *
 * ## `createEvaluater` 是那條界線
 *
 * util 碰到 `items={[…]}` 這種屬性、以及大寫開頭的元件名時會呼叫 evaluater。
 * 官方的實作是 eval；這裡換成：
 *
 *   · 元件名 → **只從註冊表解析**（比 eval 嚴格，可解析的名字是封閉集合）
 *   · 屬性值 → 只接受字面值（`literalValue`，非字面值一律丟錯）
 *
 * 實際上這條路徑不太會丟錯，因為 server 端 `compileMdxSource` 已經先擋過一次；
 * 這裡是第二道，防的是「舊快取裡還留著用新規則編不出來的內容」。
 */
export function MdxContent({ compiled, baseComponents }: MdxContentProps) {
  return useMemo(() => {
    // 自訂 block 覆蓋在 base 之上（同名以 block 為準）。
    const components = { ...baseComponents, ...MDX_BLOCKS } as Record<string, unknown>;
    try {
      const tree = JSON.parse(compiled) as Parameters<typeof toJsxRuntime>[0];
      // 明確標成 ReactElement：`toJsxRuntime` 宣告的回傳是 `JSX.Element`，
      // 而 type-aware lint 在這個 monorepo 的解析下把它判成 unresolved（no-unsafe-return）。
      const rendered: ReactElement = toJsxRuntime(tree, {
        Fragment,
        jsx: jsxRuntime.jsx,
        jsxs: jsxRuntime.jsxs,
        components: components as never,
        createEvaluater: () => ({
          // 參數型別來自 @types/estree（util 的介面），這裡只讀 type/name，
          // 其餘交給 mdx-core 的 literalValue 判斷，所以收窄成最小的結構型別。
          evaluateExpression: (node: unknown): unknown => {
            const n = node as { type?: string; name?: string };
            // ⚠ 大寫開頭的元件名**不走** components 查表：這支 util 會做成一個
            //   Identifier 節點交給 evaluater（官方版靠 eval 從模組作用域取值）。
            if (n.type === 'Identifier') {
              const c = components[n.name ?? ''];
              if (!c) throw new Error(`<${n.name}> 沒有註冊（見 mdx-blocks-registry）`);
              return c;
            }
            return literalValue(n as { type: string }, '屬性值');
          },
          evaluateProgram: (): never => {
            throw new Error('MDX 裡不支援 import / export');
          },
        }),
      }) as ReactElement;
      return rendered;
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
