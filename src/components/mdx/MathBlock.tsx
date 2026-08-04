// MDX <Math>：KaTeX 數學公式。tex 用「屬性字串」傳（<Math tex="\\frac{a}{b}" />），
// 這樣公式裡的 { } 不會被 MDX 當成表達式解析（屬性引號內是字面字串）。
// katex 較重 → 本檔由 mdx-blocks 以 lazy import 載入，只有文章用到才進 bundle。
import 'katex/dist/katex.min.css';
import katex from 'katex';

interface MathBlockProps {
  tex?: string;
  display?: boolean;
}

export default function MathBlock({ tex = '', display = false }: MathBlockProps) {
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false });
  } catch {
    html = tex;
  }
  if (display) {
    // katex.renderToString 的可信 HTML（作者輸入的 tex，throwOnError:false）
    // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
    return <div className="mdx-math mdx-math-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
  return <span className="mdx-math mdx-math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}
