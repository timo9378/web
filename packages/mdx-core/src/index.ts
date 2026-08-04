/**
 * MDX 編譯與「可渲染性」檢查的**唯一一份實作**。
 *
 * 抽成套件的理由是這裡本來就已經抄了兩份：`src/lib/mdx/mdx-compile-core.ts` 的檔頭自己寫著
 * 「如果那支腳本自己抄一份選項，日後有人在這裡加 plugin，檢查器會用舊的那組編——
 * 過了也不代表線上過，那種檢查比沒有還糟」，而 `packages/mcp-server/src/validate.ts`
 * 正是又抄了一份。三個使用者：
 *
 *   · `src/lib/mdx/mdx-compile.ts`（createServerFn）→ 前台渲染
 *   · `scripts/check-mdx.ts`（CI 每日）→ 已發布文章
 *   · `packages/mcp-server/src/validate.ts` → agent 送出前的自檢
 *
 * ## 為什麼產出的是 hast 而不是 JS
 *
 * 以前是 `outputFormat: 'function-body'` → 前端 `runSync`（底層 `new Function`）。
 * 那需要 CSP 的 `'unsafe-eval'`，也就是把整個站的 `script-src` 打開。
 *
 * 改成輸出**序列化的 hast 樹**，前端用 `hast-util-to-jsx-runtime` 渲染，沒有任何
 * 字串轉程式碼。實測 15 篇 × 5 語系兩條路徑產出的 HTML **逐字相同**；
 * 傳輸量 gzip 後只差 2%（未壓縮 +53%，但 JSON 壓得比 minify 過的 JS 好）。
 *
 * ## 代價：MDX 只能「叫元件、餵資料」
 *
 * 屬性值必須是字面值（字串／數字／布林／陣列／物件），不能有運算式、import/export
 * 或展開屬性。這不是暫時的限制而是設計：文章內容由 agent 產出、人工 review，
 * 而「在文章裡寫一小段 JS」這個逃生口一旦開著，MDX 就變成沒人 review 得動的程式碼。
 *
 * 元件那一側完全不受限——想要計算機、圖表、股票元件，寫成 React 元件註冊進去即可。
 */
/**
 * 這裡刻意用**最小的結構型別**而不是 `@types/hast`。
 *
 * 理由：這個模組對樹的處理只有兩件事——走訪 children、認幾種 mdx 節點型別。
 * 拉進完整的 hast 型別會讓三個使用者（前端／scripts／MCP）都得裝 @types/hast，
 * 而它們對這棵樹的其餘部分本來就當成不透明的 JSON。
 */
export interface HastNode {
  type: string;
  children?: HastNode[];
  [k: string]: unknown;
}

/** 前端渲染不了的構造。訊息會直接被 agent 與 CI 看到，所以要講「怎麼改」而不只是「錯了」。 */
export class MdxUnsupportedError extends Error {
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'MdxUnsupportedError';
    this.line = line;
  }
}

/**
 * 抽掉只有編譯期才需要的欄位。**必做**：不抽的話 payload 是 3.8 倍。
 *
 * ⚠ `data.estree` **不能抽掉**。屬性值（`options={[…]}`）是靠它傳到前端的——
 *   `hast-util-to-jsx-runtime` 對 mdxJsx 節點就是讀 `attribute.value.data.estree`
 *   再交給 evaluater。第一版把它一起抽了，結果編譯正常、樹裡也有 `<Poll>`，
 *   但前端渲染出來是空的（屬性全不見）。抽掉的是 estree 裡的**位置資訊**，
 *   那些欄位佔大部分體積而 evaluater 一個都用不到。
 */
const POSITIONAL = new Set(['position', 'loc', 'range', 'start', 'end']);

function slim(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(slim);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (POSITIONAL.has(k)) continue;
    out[k] = slim(v);
  }
  return out;
}

interface EstreeNode {
  type: string;
  [k: string]: unknown;
}

/**
 * estree 字面值 → JS 值。碰到任何「要算才知道」的東西就丟錯。
 *
 * 這個函式就是那條界線。它決定了前端不需要 `'unsafe-eval'`——不是靠約定，
 * 是靠這裡把所有非字面值擋掉。
 */
export function literalValue(node: EstreeNode, where: string, line?: number): unknown {
  switch (node.type) {
    case 'Literal':
      return (node as unknown as { value: unknown }).value;
    case 'ArrayExpression':
      return (node.elements as EstreeNode[]).map((e) => literalValue(e, where, line));
    case 'ObjectExpression':
      return Object.fromEntries(
        (node.properties as EstreeNode[]).map((p) => {
          if (p.type !== 'Property') {
            throw new MdxUnsupportedError(`${where}：物件裡不支援 ${p.type}（例如展開 ...x）`, line);
          }
          const key = p.key as { type: string; name?: string; value?: unknown };
          const k = key.type === 'Identifier' ? (key.name ?? '') : String(key.value);
          return [k, literalValue(p.value as EstreeNode, where, line)];
        }),
      );
    case 'UnaryExpression': {
      const u = node as unknown as { operator: string; argument: EstreeNode };
      if (u.operator === '-') return -(literalValue(u.argument, where, line) as number);
      throw new MdxUnsupportedError(`${where}：不支援一元運算子 ${u.operator}`, line);
    }
    case 'TemplateLiteral': {
      const t = node as unknown as { expressions: unknown[]; quasis: { value: { cooked: string } }[] };
      if (t.expressions.length === 0) return t.quasis[0].value.cooked;
      throw new MdxUnsupportedError(
        `${where}：樣板字串裡有運算式。屬性值必須是寫得死的內容，把結果直接寫出來。`,
        line,
      );
    }
    default:
      throw new MdxUnsupportedError(
        `${where}：屬性值是運算式（${node.type}），前端不會執行它。` +
          `屬性只能放字面值——字串、數字、布林、陣列、物件。要算的東西請放進元件裡。`,
        line,
      );
  }
}

/**
 * 走一遍樹，把渲染不了的構造挑出來。
 *
 * 在**編譯時**就檢查（而不是等前端渲染失敗）是刻意的：前端的失敗模式是
 * 「靜默退回 markdown、讀者看到裸標籤」，那種錯誤沒有人會發現。
 */
export function assertRenderable(tree: HastNode, knownComponents?: ReadonlySet<string>): void {
  const line = (n: HastNode): number | undefined =>
    (n as { position?: { start?: { line?: number } } }).position?.start?.line;

  const walk = (node: HastNode): void => {
    switch (node.type) {
      case 'mdxjsEsm':
        throw new MdxUnsupportedError(
          'MDX 裡不支援 import / export。要用的元件請註冊到 mdx-blocks-registry。',
          line(node),
        );
      case 'mdxFlowExpression':
      case 'mdxTextExpression': {
        const v = String((node as { value?: unknown }).value ?? '').slice(0, 40);
        throw new MdxUnsupportedError(
          `內文裡有運算式 {${v}}，前端不會執行它。把結果直接寫出來，或做成元件。`,
          line(node),
        );
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        const el = node as unknown as {
          name: string | null;
          attributes: { type: string; name?: string; value?: unknown }[];
        };
        const tag = el.name ?? '<>';
        if (el.name && /^[A-Z]/.test(el.name) && knownComponents && !knownComponents.has(el.name)) {
          throw new MdxUnsupportedError(
            `<${el.name}> 沒有註冊。可用的元件見 mdx-blocks-registry。`,
            line(node),
          );
        }
        for (const a of el.attributes ?? []) {
          if (a.type === 'mdxJsxExpressionAttribute') {
            throw new MdxUnsupportedError(`<${tag}>：不支援展開屬性 {...x}，請把屬性寫開。`, line(node));
          }
          const v = a.value;
          if (v && typeof v === 'object') {
            const estree = (v as { data?: { estree?: { body?: { expression?: EstreeNode }[] } } }).data
              ?.estree;
            const expr = estree?.body?.[0]?.expression;
            if (!expr) {
              throw new MdxUnsupportedError(`<${tag}> 的 ${a.name}：解不出屬性值`, line(node));
            }
            // 只是要它丟錯；值本身在渲染時才會用到
            literalValue(expr, `<${tag}> 的 ${a.name}`, line(node));
          }
        }
        break;
      }
      default:
        break;
    }
    for (const c of ((node as { children?: HastNode[] }).children ?? [])) walk(c);
  };
  walk(tree);
}

/**
 * MDX 原始碼 → hast 樹（尚未 slim，帶 position，給診斷用）。
 *
 * plugin 組合與 markdown 管線對齊：GFM（表格／刪除線／腳註）+ GitHub 式彩色 alert。
 */
export async function mdxToHast(source: string): Promise<HastNode> {
  const { createProcessor } = await import('@mdx-js/mdx');
  const remarkGfm = (await import('remark-gfm')).default;
  const { remarkAlert } = await import('remark-github-blockquote-alert');

  let captured: HastNode | null = null;
  const processor = createProcessor({
    outputFormat: 'function-body',
    development: false,
    remarkPlugins: [remarkGfm, remarkAlert],
    // ⚠ 掛在 rehype 階段的最後一支：`.run()` 會一路跑到 recma（產 estree），
    //   在這裡才攔得到「即將被轉成 JS 之前」的 hast，也就是我們要的那棵樹。
    rehypePlugins: [
      () => (tree: HastNode) => {
        captured = tree;
      },
    ],
  });
  // run() 的型別宣告是 Program（管線終點是 recma），但我們在 rehype 階段就攔走了樹
  await processor.run(processor.parse(source) as never);
  if (!captured) throw new Error('MDX 管線沒有產出 hast 樹');
  return captured;
}

/**
 * MDX 原始碼 → 可直接送到前端的 JSON 字串。
 *
 * 不可渲染的構造會在這裡丟 `MdxUnsupportedError`——呼叫端（blogList）接到之後
 * 退回 markdown 渲染，跟以前編譯失敗的行為一致。
 */
export async function compileMdxToHastJson(
  source: string,
  knownComponents?: ReadonlySet<string>,
): Promise<string> {
  const tree = await mdxToHast(source);
  assertRenderable(tree, knownComponents);
  return JSON.stringify(slim(tree));
}
