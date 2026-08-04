/* 後台編輯器的「所見即所得」預覽：跟前台文章頁走同一套渲染管線 —— MDX 走 compileMdx(RPC)
   + MdxContent(runSync)、Markdown 走 ReactMarkdown，兩者共用前台的 code/p/img/a 元件
   （shiki 高亮、mermaid、行內連結 hover 卡、圖片燈箱）。→ 預覽跟實際發布長得一樣。
   compileMdx 是 server-only（重編譯器不進 client bundle），這裡在 client 端 debounce 後 RPC 呼叫。 */
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import rehypeRaw from 'rehype-raw';
import { MdxContent } from '@/components/mdx/MdxContent';
import { CodeBlock, CustomParagraph } from '@/components/blog/BlogPost';
import { BlogImage } from '@/components/gallery/ImageLightbox';
import { LinkHoverPreview } from '@/components/common/LinkHoverPreview';
import { compileMdx } from '@/lib/mdx/mdx-compile';

// 行內連結 → hover 預覽卡（跟前台一致）；錨點（#foo）不預覽。
const Anchor = ({ href, children, ...rest }: { href?: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLAnchorElement>) => {
  const h = typeof href === 'string' ? href : '';
  if (!h || h.startsWith('#')) return <a href={h} {...rest}>{children}</a>;
  return <LinkHoverPreview href={h} className={(rest as { className?: string }).className}>{children}</LinkHoverPreview>;
};
const Img = ({ src, alt, ...rest }: { src?: string; alt?: string }) => <BlogImage src={src} alt={alt} {...rest} />;

// MDX：pre 透傳（CodeBlock 自出 wrapper，避免 div-in-pre）。Markdown：不覆蓋 pre，跟前台管線對齊。
const MDX_BASE = { code: CodeBlock, pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>, p: CustomParagraph, img: Img, a: Anchor };
const MD_BASE = { code: CodeBlock, p: CustomParagraph, img: Img, a: Anchor } as Components;

// 編譯結果：{ src } 記錄是哪份內容編出來的 → 內容變了但還沒編完時可顯示「準備預覽…」。
interface Compiled { src: string; code?: string; error?: string }

export function PostPreview({ content, format }: { content: string; format?: string }) {
  const isMdx = format === 'mdx';
  const [compiled, setCompiled] = useState<Compiled | null>(null);

  // MDX 才需要編譯；debounce 400ms 避免每次打字都 RPC。setState 都在 async callback 內（非 effect 同步體）。
  useEffect(() => {
    if (!isMdx) return;
    let cancelled = false;
    const t = setTimeout(() => {
      compileMdx({ data: content })
        .then((code) => { if (!cancelled) setCompiled({ src: content, code }); })
        .catch((e: unknown) => { if (!cancelled) setCompiled({ src: content, error: e instanceof Error ? e.message : String(e) }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [content, isMdx]);

  const body = useMemo(() => {
    if (!isMdx) {
      return (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkAlert]} rehypePlugins={[rehypeRaw]} components={MD_BASE}>
          {content || '*尚無內容*'}
        </ReactMarkdown>
      );
    }
    if (compiled?.error) {
      return (
        <div className="mdx-error">
          <strong>⚠ MDX 編譯失敗（發布前要修好，否則會退回純 Markdown）</strong>
          <pre>{compiled.error}</pre>
        </div>
      );
    }
    if (compiled?.code) return <MdxContent compiled={compiled.code} baseComponents={MDX_BASE} />;
    return <p className="text-muted-foreground text-sm">{content ? '準備預覽…' : '尚無內容'}</p>;
  }, [isMdx, content, compiled]);

  return <article className="post-content">{body}</article>;
}
