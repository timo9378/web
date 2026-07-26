// MCP 工具定義：每個工具 = 一段對 admin REST 端點的封裝。
// inputSchema 用原始 JSON Schema（不綁 zod，避免 SDK 內建 zod 與 repo zod 版本摩擦）。
import type { ApiClient } from './api.js';
import { BLOCKS, renderBlocksForGuide } from './blocks.js';
import { validateContent } from './validate.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const EMPTY = { type: 'object' as const, properties: {}, additionalProperties: false };

/** 從 args 挑出有值的鍵組成 body（省略 undefined/null，''/false/0 保留）。 */
function pick(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (args[k] !== undefined && args[k] !== null) out[k] = args[k];
  }
  return out;
}

// i18n 欄位（4 語 × 3 欄）。zh-TW 是來源（存在 title/content/excerpt），這裡是譯文欄。
const I18N_FIELDS = [
  'title_en', 'content_en', 'excerpt_en',
  'title_ja', 'content_ja', 'excerpt_ja',
  'title_ko', 'content_ko', 'excerpt_ko',
  'title_zh_cn', 'content_zh_cn', 'excerpt_zh_cn',
] as const;

const POST_WRITE_FIELDS = [
  'title',
  'content',
  'excerpt',
  'category',
  'status',
  'format',
  'layout_type',
  'tags',
  'series_name',
  'series_order',
  'allow_comments',
  'send_newsletter',
  'source_language',
  'slug',
  ...I18N_FIELDS,
] as const;

const postWriteProps = {
  title: { type: 'string', description: '標題' },
  content: { type: 'string', description: '內文（Markdown）' },
  excerpt: { type: 'string', description: '摘要；省略=NULL' },
  category: { type: 'string', description: '分類名（需已存在於 categories）' },
  status: { type: 'string', enum: ['draft', 'published'], description: '狀態；建立時預設 draft' },
  format: {
    type: 'string',
    enum: ['markdown', 'mdx'],
    description:
      "內容格式。用到自訂 block（<Note>/<Annot>/<Spoiler>/<BarChart>）或行內 JS {…} → 'mdx'；純文字/markdown → 'markdown'（預設）。用 mdx 前務必先讀 koimsurai_authoring_guide（有 <、{ 的跳脫規則）。",
  },
  slug: {
    type: 'string',
    description:
      "網址用的**英文** slug（例 'blog-post-rendering-strategy'）。省略時後端會自動從 title_en（沒有就 title）產生。" +
      '文章網址是 /blog/<slug>，所以請給精簡好讀的英文短語（3~8 個詞、全小寫、連字號分隔）。' +
      '⚠ 之後改 slug 沒關係——舊網址會自動 301 到新的，不會斷。',
  },
  layout_type: { type: 'string', description: "版面型別，預設 'record'" },
  tags: { type: 'array', items: { type: 'string' }, description: '標籤名陣列（不存在的會自動建立）' },
  series_name: { type: 'string', description: '系列名（可選）' },
  series_order: { type: 'number', description: '系列內排序（可選）' },
  allow_comments: { type: 'boolean', description: '是否開放留言，預設 true' },
  send_newsletter: {
    type: 'boolean',
    description: '⚠️ 若同時 status=published，會寄電子報給所有訂閱者——請先確認再設 true',
  },
  source_language: {
    type: 'string',
    enum: ['zh-TW', 'zh-CN', 'en', 'ja', 'ko'],
    description: "來源語言（title/content 用哪一語寫的），預設 'zh-TW'。其餘語言放 *_en/*_ja/*_ko/*_zh_cn 欄。",
  },
  ...i18nProps(),
};

/** 4 語 × 3 欄的 i18n 屬性。zh-TW 是來源（存 title/content/excerpt）；這裡放各譯文語言。 */
function i18nProps(): Record<string, { type: 'string'; description: string }> {
  const langLabel: Record<string, string> = { en: '英文', ja: '日文', ko: '韓文', zh_cn: '簡體中文' };
  const fieldLabel: Record<string, string> = { title: '標題', content: '內文', excerpt: '摘要' };
  const out: Record<string, { type: 'string'; description: string }> = {};
  for (const lang of ['en', 'ja', 'ko', 'zh_cn'] as const) {
    for (const field of ['title', 'content', 'excerpt'] as const) {
      const zhcnNote = lang === 'zh_cn' ? '；簡體通常改用 generate_post_zh_cn 自動轉，不必手填' : '';
      out[`${field}_${lang}`] = {
        type: 'string',
        description: `${langLabel[lang]}${fieldLabel[field]}（譯文，可選）${zhcnNote}`,
      };
    }
  }
  return out;
}

// 完整撰寫指南——寫一篇文章前先讀。目標：Agent 一次產出結構完整、格式正確、可直接發布的文章。
const AUTHORING_GUIDE = `# koimsurai 文章撰寫指南（給 AI）

寫「一篇完整文章」前先讀這份。目標：一次到位——結構完整、格式正確、站長只要審不用大改。

## 1. 動手前
- 先 koimsurai_list_categories 看現有分類，用既有的（或明確跟站長確認要新分類）。
- 先 status='draft'。發布交給站長（審過再 set_post_status 或 send_newsletter）。
- 不確定該用哪個 block／忘記語法 → \`koimsurai_list_blocks\`（結構化目錄，比翻這份指南快）。
- **送出前一定先跑 \`koimsurai_validate_mdx\`**：MDX 編譯失敗在前台是**靜默退回 markdown**（讀者會看到裸露的標籤原始碼），而 create/update 仍回 success——不驗就沒人知道寫壞了。

## 2. 文章欄位（create_post 參數）
- **title**：想要副標就用全形冒號分隔「主標：副標」，前端自動把冒號後段渲染成副標。
  例：關掉翻譯器，程式卻關不掉：一個躺了兩年的 thread_local 死鎖
- **excerpt**：會渲染成文章開頭的「🔑 關鍵洞察」框 → 寫 2~4 句**真正的重點摘要**，不是複製第一段。
- **category**：必須是已存在的分類名。
- **tags**：3~5 個；不存在的會自動建立。
- **format**：用到下面「自訂 block / 圖表 / 行內 JS」→ 'mdx'；純文字 → 'markdown'（預設）。
- **status**：預設 draft。

## 3. 內文格式（純 markdown，兩種 format 都能用）
- 標題 \`##\` \`###\`（自動生 TOC 錨點，hover 出 #）
- 程式碼 \`\`\`語言 …\`\`\`（自動 shiki 高亮 + emoji 語言標頭 + 行號 + 複製鈕；超過 15 行自動「展開程式碼」收合）
- Mermaid 圖 \`\`\`mermaid …\`\`\`
- **GitHub 彩色提示框**（善用，別通篇純引用 \`>\`）：
  \`> [!NOTE]\` 藍｜\`> [!TIP]\` 綠｜\`> [!IMPORTANT]\` 紫｜\`> [!WARNING]\` 琥珀｜\`> [!CAUTION]\` 紅
  ⚠ **不支援自訂標題**（標題固定顯示型別名）。\`[!NOTE]\` 要**單獨一行**，內容寫在下一行起——
  在同一行接字（\`> [!NOTE] 我還沒開 CSP\`）那串字會被併進內文，讀起來會怪。正確：
  \`> [!NOTE]\` 換行 \`> 其實我到現在還沒開 CSP——這個 eval 目前是可控的…\`
- 表格 / 清單 / 粗體 / 行內連結（行內連結自動有 hover 預覽卡）
- 圖片：先呼叫 \`koimsurai_upload_image\`（path / url / base64 三擇一）拿到 \`/uploads/…\` url，再用 \`![說明](url)\` 引用。別直接貼外部熱連結。

## 4. MDX 自訂 block（**只在 format='mdx'**）

完整結構化目錄（含 props / 何時用）可隨時呼叫 \`koimsurai_list_blocks\` 取得。

${renderBlocksForGuide()}

其他：行內算式（在文章裡求值，少用）\`今天 {new Date().getFullYear()} 年\`。
**圖表怎麼挑**：精確的技術圖（流程／時序／狀態／ER／架構）一律用 \`\`\`mermaid 圍籬——有工具列（切 theme/look/layout/方向、縮放平移、下載 SVG/PNG）。只有「概念草圖／比喻」且節點少時才用 <Sketch>。
mermaid 可用 frontmatter 預設外觀，例如手繪風：\`\`\`mermaid 後接 \`---\` / \`config:\` / \`  look: handDrawn\` / \`  theme: dark\` / \`---\`。

## 5. ⚠️ MDX 的坑（format='mdx' 一定遵守，寫錯會編譯失敗）
在**一般段落文字**裡，\`<\` 和 \`{\` 會被當成 JSX/表達式 → 編譯失敗（會退回醜醜的純文字）。
- 要寫字面的角括號/大括號/泛型/JSON/指令 → **一律包反引號變 inline code**：
  ✅ \`Vec<String>\`、\`{ "key": 1 }\`、\`a < b\`、\`npm run <script>\`
  ❌ 正文直接寫 Vec<String> 或 { "key": 1 }
- 程式碼區塊 \`\`\` 裡的一切都安全，不用跳脫。
- 不需要自訂 block/行內 JS → 直接 format='markdown'，完全沒這個坑。

## 6. 多語系（i18n）——站台支援 5 語（zh-TW 來源／zh-CN／en／ja／ko）
- **來源**：title/content/excerpt 即來源語言（預設 zh-TW；非繁中寫的用 source_language 指定）。
- **簡體 zh-CN**：別手翻。建立/更新繁體後呼叫 \`koimsurai_generate_post_zh_cn\`（OpenCC 自動繁→簡）即可。
- **英/日/韓 en/ja/ko**：要出多語就翻好填進對應欄位（create_post / update_post 都能帶）——
  \`title_en\`/\`content_en\`/\`excerpt_en\`、\`title_ja\`/\`content_ja\`/\`excerpt_ja\`、\`title_ko\`/\`content_ko\`/\`excerpt_ko\`。
  - content_* 與來源共用同一 format（全篇一種）；自訂 block／程式碼區塊照用，第 5 點的 MDX 跳脫規則一樣要守。
  - 某語譯文留空 → 前端該語自動 fallback 回來源，不會壞頁。可先發繁體、之後再 update_post 補譯文。
- 只想單發繁體 → 這段整段略過。

## 7. 一次寫好的檢查清單
1) 分類存在　2) title 決定要不要副標（冒號）　3) excerpt 是真的關鍵洞察
4) 內文穿插彩色 alert / 程式碼 / 圖表，別通篇純引用　5) format='mdx' 的話正文 \`<\`/\`{\` 都跳脫了
6) tags 3~5　7) status='draft' 交站長審　8) 要多語？zh-CN 用 generate 工具、en/ja/ko 填譯文欄
9) **跑過 koimsurai_validate_mdx 且 errors 為空**（多語系的話每個 content_* 都要驗）`;

// 圖片 mime ↔ 副檔名（後端用「原始檔名的副檔名」決定存檔 ext、用 mimetype 判斷是否算 thumbhash）。
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
};
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};
function extOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

/** 從 path / url / data(base64) 三擇一解析出圖片 bytes + 檔名 + mimetype。 */
async function resolveImage(a: {
  path?: string;
  url?: string;
  data?: string;
  filename?: string;
}): Promise<{ bytes: Uint8Array; filename: string; mime: string }> {
  let bytes: Uint8Array;
  let name = a.filename;
  let mime: string | undefined;

  if (a.path) {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    bytes = new Uint8Array(await readFile(a.path));
    name ??= basename(a.path);
  } else if (a.url) {
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`下載圖片失敗 (${res.status})：${a.url}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    mime = res.headers.get('content-type')?.split(';')[0]?.trim() || undefined;
    name ??= new URL(a.url).pathname.split('/').pop() || 'image';
  } else if (a.data) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(a.data.trim());
    mime = m ? m[1] : mime;
    bytes = new Uint8Array(Buffer.from(m ? m[2] : a.data.trim(), 'base64'));
    name ??= 'image';
  } else {
    throw new Error('請提供 path、url 或 data（base64）其中之一');
  }

  // 確保檔名有副檔名（後端靠它決定存檔 ext）；沒有就用 mimetype 推。
  if (!extOf(name)) {
    const ext = (mime && MIME_EXT[mime.toLowerCase()]) || 'png';
    name = `${name}.${ext}`;
  }
  // mimetype 沒拿到就用副檔名推（後端只看 starts_with('image/') 決定 thumbhash）。
  mime ??= EXT_MIME[extOf(name)] || 'application/octet-stream';
  return { bytes, filename: name, mime };
}

export function makeTools(api: ApiClient): Tool[] {
  return [
    // ── 撰寫指南 ────────────────────────────────────────────────
    {
      name: 'koimsurai_authoring_guide',
      description:
        '取得 koimsurai 文章撰寫指南（欄位慣例、可用 block、彩色 alert、MDX 語法坑、檢查清單）。' +
        '寫「一篇完整文章」前先呼叫這個，尤其要用 format=mdx / 圖表 / 自訂 block 時。',
      inputSchema: EMPTY,
      handler: () => Promise.resolve(AUTHORING_GUIDE),
    },

    // ── 圖片上傳 ────────────────────────────────────────────────
    {
      name: 'koimsurai_upload_image',
      description:
        '上傳圖片到後台（storage/uploads），回傳可直接放進文章的相對 URL 與 markdown。' +
        '來源三擇一：path（MCP server 本機檔案路徑）/ url（遠端圖片，下載後轉存）/ data（base64，可含 data: 前綴）。' +
        '回傳 url 形如 /uploads/YYYY/MM/xxx.png#th=…（#th 是模糊佔位 thumbhash，原樣保留即可）。文章裡用 ![alt](url) 引用。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '本機圖片檔案路徑（三擇一）' },
          url: { type: 'string', description: '遠端圖片 URL，會下載後上傳（三擇一）' },
          data: { type: 'string', description: '圖片 base64，可含 data:image/…;base64, 前綴（三擇一）' },
          filename: {
            type: 'string',
            description: '檔名（決定副檔名）。path/url 可省略自動推斷；data 建議提供以帶正確副檔名',
          },
          alt: { type: 'string', description: '圖片替代文字，用於回傳的 markdown ![alt](url)' },
        },
        additionalProperties: false,
      },
      handler: async (a) => {
        const { bytes, filename, mime } = await resolveImage(
          a as { path?: string; url?: string; data?: string; filename?: string },
        );
        const result = await api.uploadFile<{
          url: string;
          filename: string;
          thumbhash?: string | null;
        }>('/api/admin/upload', bytes, filename, mime);
        const alt = typeof a.alt === 'string' ? a.alt : '';
        return {
          url: result.url,
          filename: result.filename,
          thumbhash: result.thumbhash ?? null,
          markdown: `![${alt}](${result.url})`,
        };
      },
    },

    // ── 文章 CRUD ──────────────────────────────────────────────
    {
      name: 'koimsurai_list_posts',
      description: '列出後台文章（含草稿）。可依狀態/關鍵字過濾、分頁。回 AdminPostsResponse。',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['published', 'draft'], description: '省略=全部狀態' },
          search: { type: 'string', description: '標題/內文關鍵字' },
          page: { type: 'number', description: '頁碼，預設 1' },
          limit: { type: 'number', description: '每頁筆數，預設由後端決定' },
        },
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('GET', '/api/admin/posts', {
          query: { status: a.status, search: a.search, page: a.page, limit: a.limit },
        }),
    },
    {
      name: 'koimsurai_get_post',
      description: '讀單篇文章完整內容（含全部 i18n 欄位與 tags）。回 AdminPostDetailResponse。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number', description: '文章 id' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('GET', `/api/admin/posts/${a.id}`),
    },
    {
      name: 'koimsurai_list_blocks',
      description:
        '列出所有可用的 MDX 自訂 block（結構化目錄：名稱／何時用／props／範例／坑）。' +
        '寫 format=mdx 的文章、不確定該用哪個 block 或忘記語法時查這個，比翻整份指南快。',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['prose', 'code', 'data', 'media', 'layout', 'interactive'],
            description: '只列某一類（省略=全部）。prose 文字表達｜code 程式碼｜data 數據視覺化｜media 圖與影片｜layout 結構編排｜interactive 讀者互動',
          },
        },
        additionalProperties: false,
      },
      handler: (a) => {
        const cat = typeof a.category === 'string' ? a.category : undefined;
        const list = cat ? BLOCKS.filter((b) => b.category === cat) : BLOCKS;
        return Promise.resolve({ count: list.length, blocks: list });
      },
    },
    {
      name: 'koimsurai_validate_mdx',
      description:
        '⭐ 驗證文章內容（**建議 create_post / update_post 前一定先跑**）。' +
        '會真的跑一次 MDX 編譯 + 檢查未知 block、alert 語法、手打編號、裸網址清單、外部熱連結。' +
        '重要：MDX 編譯失敗在前台是**靜默退回 markdown**（讀者看到裸露的標籤原始碼），而 create/update 仍回 success ' +
        '——不先驗就不會有人知道寫壞了。回 { ok, summary, errors, warnings, hints }，errors 非空就別送出。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要驗的文章內文（也可拿來驗某個語系的譯文）' },
          format: { type: 'string', enum: ['markdown', 'mdx'], description: "內容格式，預設 'mdx'" },
        },
        required: ['content'],
        additionalProperties: false,
      },
      handler: (a) => validateContent(String(a.content ?? ''), typeof a.format === 'string' ? a.format : 'mdx'),
    },
    {
      name: 'koimsurai_create_post',
      description:
        '建立文章。title/content 必填，其餘可選。預設 status=draft（不會直接公開）。' +
        '⭐ 寫「完整文章」前先呼叫 koimsurai_authoring_guide（副標/關鍵洞察/彩色 alert/自訂 block/MDX 坑/檢查清單）。' +
        '⭐ format=mdx 時，送出前先用 koimsurai_validate_mdx 驗過（編譯失敗會靜默退回 markdown，這裡仍會回 success）。' +
        'title 用「主標：副標」冒號分隔會自動出副標；excerpt 會變成開頭的「關鍵洞察」框。' +
        '用到 <Note>/<Annot>/<Spoiler>/<BarChart> 或行內 JS → format=\'mdx\'。' +
        '多語系：zh-CN 用 generate_post_zh_cn 自動轉；en/ja/ko 填 title_en/content_en…等譯文欄（見指南第 6 點）。' +
        '注意 send_newsletter=true 且 published 會寄電子報。',
      inputSchema: {
        type: 'object',
        properties: postWriteProps,
        required: ['title', 'content'],
        additionalProperties: false,
      },
      handler: (a) => api.request('POST', '/api/admin/posts', { body: pick(a, [...POST_WRITE_FIELDS]) }),
    },
    {
      name: 'koimsurai_update_post',
      description: '更新文章。只送想改的欄位（其餘不動）。id 必填。改到 mdx 內文時，送出前先用 koimsurai_validate_mdx 驗過。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number', description: '文章 id' }, ...postWriteProps },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('PUT', `/api/admin/posts/${a.id}`, { body: pick(a, [...POST_WRITE_FIELDS]) }),
    },
    {
      name: 'koimsurai_set_post_status',
      description: "只改文章狀態（draft ⇄ published），不動內容。發布請優先用這個。",
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          status: { type: 'string', enum: ['draft', 'published'] },
        },
        required: ['id', 'status'],
        additionalProperties: false,
      },
      handler: (a) => api.request('PATCH', `/api/posts/${a.id}/status`, { body: { status: a.status } }),
    },
    {
      name: 'koimsurai_delete_post',
      description: '⚠️ 刪除文章（連同 post_tags）。不可復原——請先確認。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('DELETE', `/api/admin/posts/${a.id}`),
    },
    {
      name: 'koimsurai_generate_post_zh_cn',
      description: '由繁體來源自動生成該篇的簡體（zh-CN）欄位（opencc Tw2s）。id 必填。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('POST', `/api/admin/posts/${a.id}/generate-zh-cn`),
    },

    // ── 統計與健康 ─────────────────────────────────────────────
    {
      name: 'koimsurai_site_stats',
      description: '後台總覽：文章數/已發布/草稿/本月新文/留言數/本週留言/瀏覽數。',
      inputSchema: EMPTY,
      handler: () => api.request('GET', '/api/admin/stats'),
    },
    {
      name: 'koimsurai_vitals_stats',
      description: '前端 Core Web Vitals 聚合（LCP/CLS/INP/FCP/TTFB 的 count/p75/rating 分佈）。',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'number', description: '回看天數，預設 7' } },
        additionalProperties: false,
      },
      handler: (a) => api.request('GET', '/api/vitals/stats', { query: { days: a.days }, auth: false }),
    },
    {
      name: 'koimsurai_health',
      description: '後端健康檢查（回 OK）。用來確認服務在跑。',
      inputSchema: EMPTY,
      handler: () => api.request('GET', '/api/health', { auth: false }),
    },

    // ── 分類 ──────────────────────────────────────────────────
    {
      name: 'koimsurai_list_categories',
      description: '列出所有分類（含各分類文章數 post_count）。',
      inputSchema: EMPTY,
      handler: () => api.request('GET', '/api/admin/categories'),
    },
    {
      name: 'koimsurai_create_category',
      description: '建立分類。name 必填；slug 省略時由 name 生成。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '分類名（同時是資料鍵：文章的 category 存的就是它）' },
          description: { type: 'string' },
          slug: { type: 'string' },
          short_description: { type: 'string' },
          name_en: { type: 'string', description: '英文顯示名（可選；不影響資料鍵）' },
          name_ja: { type: 'string', description: '日文顯示名（可選）' },
          name_ko: { type: 'string', description: '韓文顯示名（可選）' },
          name_zh_cn: { type: 'string', description: '簡中顯示名（可選）' },
          short_description_en: { type: 'string', description: '英文簡述（可選；分類 tooltip 用）' },
          short_description_ja: { type: 'string', description: '日文簡述（可選；分類 tooltip 用）' },
          short_description_ko: { type: 'string', description: '韓文簡述（可選；分類 tooltip 用）' },
          short_description_zh_cn: { type: 'string', description: '簡中簡述（可選；分類 tooltip 用）' },
          description_en: { type: 'string', description: '英文描述（可選）' },
          description_ja: { type: 'string', description: '日文描述（可選）' },
          description_ko: { type: 'string', description: '韓文描述（可選）' },
          description_zh_cn: { type: 'string', description: '簡中描述（可選）' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('POST', '/api/admin/categories', {
          body: pick(a, ['name', 'description', 'slug', 'short_description', 'name_en', 'name_ja', 'name_ko', 'name_zh_cn', 'short_description_en', 'short_description_ja', 'short_description_ko', 'short_description_zh_cn', 'description_en', 'description_ja', 'description_ko', 'description_zh_cn']),
        }),
    },
    {
      name: 'koimsurai_update_category',
      description: '更新分類。id 必填，其餘只送要改的。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          description: { type: 'string' },
          slug: { type: 'string' },
          short_description: { type: 'string' },
          name_en: { type: 'string', description: '英文顯示名（可選；不影響資料鍵）' },
          name_ja: { type: 'string', description: '日文顯示名（可選）' },
          name_ko: { type: 'string', description: '韓文顯示名（可選）' },
          name_zh_cn: { type: 'string', description: '簡中顯示名（可選）' },
          short_description_en: { type: 'string', description: '英文簡述（可選；分類 tooltip 用）' },
          short_description_ja: { type: 'string', description: '日文簡述（可選；分類 tooltip 用）' },
          short_description_ko: { type: 'string', description: '韓文簡述（可選；分類 tooltip 用）' },
          short_description_zh_cn: { type: 'string', description: '簡中簡述（可選；分類 tooltip 用）' },
          description_en: { type: 'string', description: '英文描述（可選）' },
          description_ja: { type: 'string', description: '日文描述（可選）' },
          description_ko: { type: 'string', description: '韓文描述（可選）' },
          description_zh_cn: { type: 'string', description: '簡中描述（可選）' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('PUT', `/api/admin/categories/${a.id}`, {
          body: pick(a, ['name', 'description', 'slug', 'short_description', 'name_en', 'name_ja', 'name_ko', 'name_zh_cn', 'short_description_en', 'short_description_ja', 'short_description_ko', 'short_description_zh_cn', 'description_en', 'description_ja', 'description_ko', 'description_zh_cn']),
        }),
    },
    {
      name: 'koimsurai_delete_category',
      description: '⚠️ 刪除分類（不影響文章本身的 category 字串）。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('DELETE', `/api/admin/categories/${a.id}`),
    },

    // ── 標籤 ──────────────────────────────────────────────────
    {
      name: 'koimsurai_list_tags',
      description: '列出所有標籤（含使用篇數 post_count）。',
      inputSchema: EMPTY,
      handler: () => api.request('GET', '/api/admin/tags'),
    },
    {
      name: 'koimsurai_create_tag',
      description: '建立標籤。name 必填。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '標籤名（同時是資料鍵：文章的標籤關聯與前台篩選都比對它）' },
          name_en: { type: 'string', description: '英文顯示名（可選；不影響資料鍵）' },
          name_ja: { type: 'string', description: '日文顯示名（可選）' },
          name_ko: { type: 'string', description: '韓文顯示名（可選）' },
          name_zh_cn: { type: 'string', description: '簡中顯示名（可選）' },
          short_description_en: { type: 'string', description: '英文簡述（可選；分類 tooltip 用）' },
          short_description_ja: { type: 'string', description: '日文簡述（可選；分類 tooltip 用）' },
          short_description_ko: { type: 'string', description: '韓文簡述（可選；分類 tooltip 用）' },
          short_description_zh_cn: { type: 'string', description: '簡中簡述（可選；分類 tooltip 用）' },
          description_en: { type: 'string', description: '英文描述（可選）' },
          description_ja: { type: 'string', description: '日文描述（可選）' },
          description_ko: { type: 'string', description: '韓文描述（可選）' },
          description_zh_cn: { type: 'string', description: '簡中描述（可選）' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('POST', '/api/admin/tags', {
          body: pick(a, ['name', 'name_en', 'name_ja', 'name_ko', 'name_zh_cn']),
        }),
    },
    {
      name: 'koimsurai_update_tag',
      description: '重新命名標籤 / 補多語系顯示名。id + name 必填。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string', description: '標籤名（同時是資料鍵）' },
          name_en: { type: 'string', description: '英文顯示名（可選；不影響資料鍵）' },
          name_ja: { type: 'string', description: '日文顯示名（可選）' },
          name_ko: { type: 'string', description: '韓文顯示名（可選）' },
          name_zh_cn: { type: 'string', description: '簡中顯示名（可選）' },
        },
        required: ['id', 'name'],
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('PUT', `/api/admin/tags/${a.id}`, {
          body: pick(a, ['name', 'name_en', 'name_ja', 'name_ko', 'name_zh_cn']),
        }),
    },
    {
      name: 'koimsurai_delete_tag',
      description: '⚠️ 刪除標籤（連同 post_tags 關聯）。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('DELETE', `/api/admin/tags/${a.id}`),
    },

    // ── 碎念 thoughts ─────────────────────────────────────────
    {
      name: 'koimsurai_create_thought',
      description: '發一則碎念（短想法 feed）。content 必填；refUrl 給連結會自動抓 OG 卡片。',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          refUrl: { type: 'string', description: '附帶連結（可選，會 unfurl）' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      handler: (a) => api.request('POST', '/api/admin/thoughts', { body: pick(a, ['content', 'refUrl']) }),
    },
    {
      name: 'koimsurai_update_thought',
      description: '更新碎念。id 必填；clearRef=true 可清掉原本的連結卡片。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          content: { type: 'string' },
          refUrl: { type: 'string' },
          clearRef: { type: 'boolean' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) =>
        api.request('PUT', `/api/admin/thoughts/${a.id}`, { body: pick(a, ['content', 'refUrl', 'clearRef']) }),
    },
    {
      name: 'koimsurai_delete_thought',
      description: '⚠️ 刪除碎念。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (a) => api.request('DELETE', `/api/admin/thoughts/${a.id}`),
    },

    // ── gallery ───────────────────────────────────────────────
    {
      name: 'koimsurai_gallery_sync',
      description:
        '觸發 NAS 相簿同步：掃來源 → 產 webp（1920/400）+ EXIF + thumbhash → 寫 manifest。' +
        '耗時（視新增照片數），同時只跑一個。',
      inputSchema: EMPTY,
      handler: () => api.request('POST', '/api/admin/gallery/sync'),
    },
  ];
}
