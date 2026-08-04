// 一般 CodeBlock 與 CodeTabs 共用的程式碼呈現，確保兩者視覺一致：
//   CodeBody：shiki 高亮輸出（或 fallback）+ 長碼「展開程式碼」收合（平滑過場）。行號由 CSS counter 加。
// 語言 emoji（標頭用）在 ../lib/langEmoji（單獨成檔，避免與元件同檔觸發 fast-refresh 警告）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 超過這行數的程式碼才可收合。
const COLLAPSE_THRESHOLD = 15;
// 收合時露出的高度（px，≈ 20rem）。兩個態都用 inline max-height，過場才有具體起點（不會從 none 瞬跳）。
const COLLAPSED_PX = 320;
// useLayoutEffect 只在 client 用（SSR 用 useEffect 避免警告）。
const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function CodeBody({ highlighted, code }: { highlighted: string | null; code: string }) {
  const lineCount = code.split('\n').length;
  const collapsible = lineCount > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;
  const clipRef = useRef<HTMLDivElement>(null);

  // 平滑展開/收合：展開時把 max-height 設成實際內容高度（收合態的固定高由 CSS class 提供），
  // 過場交給 .code-surface-clip 的 CSS transition。用 useLayoutEffect 在 class 變更後、paint 前
  // 設好 inline max-height → 從 20rem 平順長到實際高度（或反向），不會先跳到全高再收。
  useIsoLayoutEffect(() => {
    const el = clipRef.current;
    if (!el || !collapsible) return;
    // 兩個態都設 inline：收合 320px、展開實際內容高。class 變更移除 CSS 的收合高時，
    // inline 仍是上一個具體值 → transition 從 320px 平順長到實際高（或反向），不會從 none 瞬跳。
    el.style.maxHeight = expanded ? `${el.scrollHeight}px` : `${COLLAPSED_PX}px`;
  }, [expanded, collapsible, highlighted]);

  return (
    <div className={collapsed ? 'code-surface-body code-surface-body--collapsed' : 'code-surface-body'}>
      <div className="code-surface-clip" ref={clipRef}>
        {highlighted ? (
          // shiki 產生的可信 HTML（作者內容 + shiki 高亮）
          // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
          <div className="shiki-output" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="shiki-fallback">
            <code>{code}</code>
          </pre>
        )}
      </div>
      {collapsible ? (
        <button
          type="button"
          className="code-surface-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="code-surface-toggle-chevron" aria-hidden>
            {expanded ? '▲' : '▼'}
          </span>
          {expanded ? '收合程式碼' : `展開程式碼（共 ${lineCount} 行）`}
        </button>
      ) : null}
    </div>
  );
}
