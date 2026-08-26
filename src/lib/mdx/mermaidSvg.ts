// mermaid 語法 → SVG 字串。單獨一個模組是為了讓它能被「只在伺服器用」地引用：
// 元件裡的 SSR 分支靜態 import 它，client 分支改成動態 import，rollup 才切得開。
import { renderMermaidSVG } from 'beautiful-mermaid';

/**
 * 產出**不含顏色**的 SVG：幾何交給 beautiful-mermaid，配色全部留給 CSS。
 *
 * 它的輸出本來就用 `var(--fg)` / `var(--surface, …)` 這類變數上色，只是把值寫在根元素的
 * inline style 上。把那段 style 拔掉之後，變數改由外層 `.mm-theme-*` 提供 —— 於是換主題
 * 只是換一個 class，不需要重新渲染，client 端也就不需要渲染器。
 *
 * ⚠ 另外要剝掉它無條件注入的 `@import url('https://fonts.googleapis.com/…')`：
 * 那個關不掉（傳任何 font 值都照樣注入），而本站有嚴格 CSP、字型一律自架。
 * 剝完 SVG 裡只剩 xmlns 宣告，沒有任何對外請求。
 */
export function renderMermaidSvg(body: string): string {
  return renderMermaidSVG(body, { bg: 'transparent', fg: '#e5e5f5', transparent: true, font: 'MiSans' })
    .replace(/@import\s+url\([^)]*\);?/g, '')
    .replace(/(<svg[^>]*?)\sstyle="[^"]*"/, '$1');
}
