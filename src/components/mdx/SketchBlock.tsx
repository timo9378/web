// MDX <Sketch>：讓 agent 只寫 mermaid，就得到 Excalidraw 真手繪風（rough.js）的 SVG。
// 兩個重套件（@excalidraw/excalidraw ~1MB＋mermaid-to-excalidraw）→ 只在 client、
// 且只有文章真的用到才進 bundle：本檔由 mdx-blocks 以 lazy + ClientOnly 載入，
// effect 內再動態 import excalidraw，SSR 完全不碰這些套件。
//
// skipInliningFonts: true —— 不去 CDN（esm.sh/unpkg）抓 Excalifont 內嵌，
//   避開 blog 路由 CSP（只允許 self + unsafe-eval）會擋外部字型的問題；
//   手繪「形狀」靠 rough.js 不需字型，文字退回系統字型仍可讀。
import { useEffect, useRef, useState } from 'react';

interface SketchBlockProps {
  /** mermaid 圖定義（graph/flowchart/sequenceDiagram/classDiagram…）。 */
  chart?: string;
  /** 圖說（選填），顯示在圖下方。 */
  title?: string;
}

// excalidraw 動態 import 的最小型別（tsc 對它的 exports 型別解析不穩 → 明確標型別避免 no-unsafe-*）。
interface MermaidToExcalidrawApi {
  parseMermaidToExcalidraw: (
    definition: string,
    config?: Record<string, unknown>,
  ) => Promise<{ elements: unknown[]; files: unknown }>;
}
interface ExcalidrawApi {
  convertToExcalidrawElements: (elements: unknown[]) => unknown[];
  exportToSvg: (opts: {
    elements: unknown[];
    files: unknown;
    appState: Record<string, unknown>;
    skipInliningFonts?: boolean;
  }) => Promise<SVGSVGElement>;
}

export default function SketchBlock({ chart = '', title }: SketchBlockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const def = chart.trim();

  useEffect(() => {
    if (!def) return;
    // 物件屬性存取不被 TS 流程分析收窄成字面值 → 不觸發 no-unnecessary-condition（let cancelled 會）。
    const alive = { current: true };
    const host = hostRef.current;

    void (async () => {
      try {
        // ⚠️ 一定要在 import excalidraw **之前**設。它在模組初始化時就會讀這個值決定
        //   字體的 base URL，設晚了就已經指向 esm.sh 了。
        //
        //   不設的話它抓 https://esm.sh/@excalidraw/excalidraw@<ver>/dist/prod/fonts/…，
        //   被 CSP 的 font-src 擋掉——而擋掉是**靜默的**：圖照樣畫出來，只是文字退回
        //   系統字型。這件事是 CSP report 上線後幾分鐘自己回報的，在那之前沒人發現。
        //
        //   字體由 vite.config.start.ts 的 copyExcalidrawFonts() 複製到 public/excalidraw/fonts。
        //   base 對應的是套件的 dist/prod/（字體在其下的 ./fonts/）。
        (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

        const [m2eMod, excalMod] = await Promise.all([
          import('@excalidraw/mermaid-to-excalidraw'),
          import('@excalidraw/excalidraw'),
        ]);
        const { parseMermaidToExcalidraw } = m2eMod as unknown as MermaidToExcalidrawApi;
        const { convertToExcalidrawElements, exportToSvg } = excalMod as unknown as ExcalidrawApi;

        // mermaid → excalidraw skeleton（含 mermaid 自動排版算好的座標）
        const { elements, files } = await parseMermaidToExcalidraw(def);
        const built = convertToExcalidrawElements(elements);

        const svg = await exportToSvg({
          elements: built,
          files: files ?? null,
          appState: {
            exportBackground: false,
            exportWithDarkMode: true,
            viewBackgroundColor: 'transparent',
          },
          skipInliningFonts: true,
        });

        if (!alive.current || !host) return;
        // mermaid 預設 render 尺寸很大 → 用 max-width 收斂；保留 viewBox 依比例縮放，
        // 小圖不放大（max-width 不足以觸發才顯示原尺寸）。height 去掉讓它隨寬度等比。
        svg.removeAttribute('height');
        svg.setAttribute('style', 'max-width:min(100%, 440px);height:auto;display:block;margin:0 auto;');
        host.replaceChildren(svg);
        setReady(true);
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      alive.current = false;
    };
  }, [def]);

  if (!def) {
    return (
      <div className="mdx-sketch-error">
        <strong>⚠ Sketch</strong>
        <pre>chart 為空</pre>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mdx-sketch-error">
        <strong>⚠ Sketch 轉換失敗</strong>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <figure className="mdx-sketch">
      <div className={ready ? 'mdx-sketch-canvas' : 'mdx-sketch-canvas mdx-sketch-canvas--loading'} ref={hostRef} />
      {title ? <figcaption className="mdx-sketch-caption">{title}</figcaption> : null}
    </figure>
  );
}
