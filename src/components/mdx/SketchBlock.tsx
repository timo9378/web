// MDX <Sketch>：讓 agent 只寫 mermaid，就得到 Excalidraw 真手繪風（rough.js）的 SVG。
// 兩個重套件（@excalidraw/excalidraw ~1MB＋mermaid-to-excalidraw）→ 只在 client、
// 且只有文章真的用到才進 bundle：本檔由 mdx-blocks 以 lazy + ClientOnly 載入，
// effect 內再動態 import excalidraw，SSR 完全不碰這些套件。
//
// ⚠️ Excalidraw 的字型有兩層處理，兩層都要，缺一不可：
//
//   1. `EXCALIDRAW_ASSET_PATH` —— 讓 createUrls() 把自架路徑放進候選（見下方 effect）
//   2. `stripCdnFontFallback()` —— 把候選裡的 esm.sh 拿掉（見該函式的說明）
//
//   只做第 1 步是不夠的：候選清單變成 [自架, esm.sh] 之後，瀏覽器仍然會去抓
//   esm.sh，全部被 CSP 的 font-src 擋掉。實測 138 次請求、0 次走自架。
//   加上第 2 步才會真的用本地的（0 次 esm.sh、21 次自架）。
//
//   這件事是 CSP report 上線幾分鐘後自己回報的（`Blocked 'font' from 'esm.sh'`）。
//   在那之前它安靜壞了很久——形狀靠 rough.js 照樣畫得出來，只有文字退回系統字型，
//   前台完全看不出異常。
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

/**
 * 把 excalidraw 產的 `FontFace` 裡那個 esm.sh 後備來源拿掉。
 *
 * ## 為什麼需要
 *
 * `EXCALIDRAW_ASSET_PATH` 有生效——`createUrls()` 產出的 src 是
 * `url(自架) format('woff2'), url(esm.sh) format('woff2')`，本地在前。
 * 但瀏覽器實際上**跳過本地那個直接抓 esm.sh**，全部被 CSP 的 `font-src` 擋掉。
 *
 * 實測（同一頁、同一份 build，只差這個 patch）：
 *
 *   |                | 沒 patch | 有 patch |
 *   |----------------|---------:|---------:|
 *   | esm.sh 請求    |      138 |        0 |
 *   | 本地字型請求   |        0 |       21 |
 *
 * 也就是說：**兩個來源都在時它用遠端，只剩本地時它用本地。**原因沒有查出來——
 * 手動 `new FontFace('x', 'url(本地) …, url(esm.sh) …').load()` 是成功的，
 * 本地檔案也 200。上游 issue #11639 是同一個症狀但被關成 not_planned
 * （那位回報者的 src 裡根本沒有本地網址，是他自己的時序問題，跟我們不同），
 * 而他最後採用的也是這個 workaround。
 *
 * ## 為什麼是這個做法
 *
 * 只在「同時含自架路徑與 esm.sh」時才動手，其餘 FontFace 一律原樣放行——
 * 站上還有 TASA Orbiter/Explorer 兩個字型走正常路徑，不能被波及。
 */
function stripCdnFontFallback(): void {
  const w = window as unknown as { FontFace: typeof FontFace; __excalidrawFontPatched?: boolean };
  if (w.__excalidrawFontPatched) return;
  w.__excalidrawFontPatched = true;

  const Original = w.FontFace;
  const Patched = function (this: unknown, family: string, source: string, descriptors?: FontFaceDescriptors) {
    let src = String(source);
    if (src.includes('/excalidraw/fonts/') && src.includes('esm.sh')) {
      // src 是 `url(a) format('woff2'), url(b) format('woff2')`——
      // 用「逗號後接 url(」切開，才不會切到網址裡本來就有的逗號
      const kept = src
        .split(/,\s*(?=url\()/)
        .filter((part) => !part.includes('esm.sh'))
        .join(', ');
      if (kept) src = kept;
    }
    return new Original(family, src, descriptors);
  } as unknown as typeof FontFace;
  Patched.prototype = Original.prototype;
  w.FontFace = Patched;
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
        stripCdnFontFallback();

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
          // 這裡原本是 true，註解寫著「避開 CSP 會擋外部字型」。實測那個假設是錯的：
          // true / false 對 esm.sh 的請求數沒有任何影響（兩者都是 138 次），真正
          // 決定性的是上面的 stripCdnFontFallback()。留 false（＝套件預設，字型內嵌
          // 成 data URL，而 font-src 本來就允許 data:）。
          skipInliningFonts: false,
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
