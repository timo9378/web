// MDX 自訂 block 的**單一真實來源**：`koimsurai_list_blocks`（結構化目錄）、
// `koimsurai_validate_mdx`（未知元件偵測）、撰寫指南第 4 節（由此生成）三者共用。
//
// ⚠️ 前台新增 block 時：在 src/components/mdx/mdx-blocks-registry.ts 的 MDX_BLOCKS 註冊後，這裡也要補一筆
//    （否則 validate 會把它誤報成「未知元件」，agent 也不會知道有這個 block 可用）。

export interface BlockDef {
  /** 標籤名，例如 'Chart' */
  name: string;
  category: 'prose' | 'code' | 'data' | 'media' | 'layout' | 'interactive';
  /** 一句話：這是什麼 */
  summary: string;
  /** 什麼情況該用它（給 agent 選型用，寫得具體） */
  whenToUse: string;
  /** props 說明 */
  props?: string;
  /** 可直接抄的範例 */
  example: string;
  /** 坑 / 注意事項 */
  note?: string;
  /** 這是某個容器的子元件（例如 Tab 之於 Tabs），列表時標示用 */
  childOf?: string;
}

export const BLOCKS: BlockDef[] = [
  // ── prose：文字表達 ───────────────────────────────────────────
  {
    name: 'Note',
    category: 'prose',
    summary: '站長旁白（極簡左側線條 + 引號圖標）',
    whenToUse: '想以作者身分插一段題外話、心境、事後補充；跟彩色 alert 的「提醒」語氣明確區隔。',
    props: 'title（標籤文字，預設「站長註」）',
    example: '<Note title="站長註">這段當初卡很久，後來才想通…</Note>',
  },
  {
    name: 'Annot',
    category: 'prose',
    summary: '行內註解：hover 某個詞冒出小卡',
    whenToUse: '文中出現讀者可能不懂的術語／縮寫時，就地科普，不打斷行文。科普向長文請多用。',
    props: 'note（註解內容，屬性字串）',
    example: '這條走 <Annot note="Server-Side Rendering，伺服器先把 HTML 渲染好再送出">SSR</Annot>。',
    note: '同一段落別塞太多（3 個以上會很吵）；程式碼區塊、mermaid、圖片 alt 內不要用。',
  },
  {
    name: 'Spoiler',
    category: 'prose',
    summary: '防劇透：內容模糊，點擊揭開',
    whenToUse: '劇情、答案、結論想讓讀者自己先想一下再看。',
    example: '兇手是 <Spoiler>管家</Spoiler>。',
  },
  {
    name: 'Kbd',
    category: 'prose',
    summary: '鍵盤按鍵樣式',
    whenToUse: '提到快捷鍵時。',
    example: '按 <Kbd>Ctrl</Kbd> + <Kbd>C</Kbd> 複製。',
  },
  {
    name: 'Ruby',
    category: 'prose',
    summary: 'CJK 注音（漢字上方標讀音）',
    whenToUse: '日文文章的難讀漢字／固有名詞；中文極少用。',
    props: 'text（漢字）、reading（讀音）',
    example: '<Ruby text="漢字" reading="かんじ" />',
  },
  {
    name: 'Mention',
    category: 'prose',
    summary: '社群帳號徽章（GitHub / X）',
    whenToUse: '提到某個人的帳號時。',
    props: 'platform（github|x）、user',
    example: '<Mention platform="github" user="innei" />',
  },
  {
    name: 'Math',
    category: 'prose',
    summary: 'KaTeX 數學公式',
    whenToUse: '需要真正的數學排版時。',
    props: 'tex（公式，屬性字串）、display（true = 區塊置中）',
    example: '行內 <Math tex="E=mc^2" />；區塊 <Math tex="\\\\int_0^1 x\\\\,dx" display />',
    note: 'tex 一定用屬性字串傳，否則公式裡的 { } 會被 MDX 當表達式。',
  },

  // ── code：程式碼呈現 ──────────────────────────────────────────
  {
    name: 'Diff',
    category: 'code',
    summary: '程式碼前後對比（+ 綠 / − 紅，仍有語法高亮）',
    whenToUse: '「這行改成那行」的修法對照——除錯文的主力，比貼兩份完整程式碼好讀太多。',
    props: 'code（屬性字串，行首 + 新增、- 刪除）、lang（base 語言）、title',
    example: '<Diff lang="ts" title="修法" code={`-const a = 1\\n+const a = 2`} />',
    note: '多行用範本字面值，\\n 分行。',
  },
  {
    name: 'CodeTabs',
    category: 'code',
    summary: '多檔程式碼分頁（依副檔名帶檔案圖示）',
    whenToUse: '同一份改動牽涉多個檔案時，讓讀者切著看。',
    props: 'files=[{ name, lang, code }]',
    example:
      "<CodeTabs files={[{ name: 'index.ts', lang: 'ts', code: '…' }, { name: 'test.ts', lang: 'ts', code: '…' }]} />",
  },
  {
    name: 'Install',
    category: 'code',
    summary: '套件安裝指令分頁（自動生 npm/pnpm/yarn/bun）',
    whenToUse: '要讀者裝某個套件時，別自己手打四種指令。',
    props: 'pkg（套件名）、dev（開發依賴）',
    example: '<Install pkg="react-compare-slider" />',
  },
  {
    name: 'FileTree',
    category: 'code',
    summary: '專案結構樹（資料夾／檔案圖示）',
    whenToUse: '介紹專案目錄結構、說明檔案放哪時。',
    props: 'tree（屬性字串；每 2 空格一層，結尾 / 為資料夾）',
    example: '<FileTree tree={`src/\\n  components/\\n    Button.tsx\\n  index.ts\\npackage.json`} />',
  },

  // ── data：數據視覺化 ──────────────────────────────────────────
  {
    name: 'Chart',
    category: 'data',
    summary: '各種圖表（line/area/bar/pie/donut/scatter/radar，色盲安全色盤）',
    whenToUse: '有多筆數據要比較或看趨勢時。',
    props: 'type、data、series（多序列的欄位名）、categoryKey、xKey/yKey（scatter）、stacked、title、unit、height',
    example:
      '<Chart type="line" data={[{ label:\'v1\', A:20, B:12 }]} series={[\'A\',\'B\']} title="吞吐趨勢" unit="tok/s" />',
    note: 'pie/donut 用 data={[{ label, value }]}；scatter 用 data={[{ x, y }]} 搭 xKey/yKey。',
  },
  {
    name: 'BarChart',
    category: 'data',
    summary: '單色階長條圖（Chart 的簡化版）',
    whenToUse: '只是幾個數字的單純對比（benchmark），不需要多序列時。',
    props: 'data=[{ label, value }]、title、unit',
    example:
      '<BarChart title="吞吐對比" unit="tok/s" data={[{ label: \'int8\', value: 42 }, { label: \'fp16\', value: 31 }]} />',
  },
  {
    name: 'InteractiveChart',
    category: 'data',
    summary: '互動圖表：讀者拉滑桿即時改值重繪',
    whenToUse: '想讓讀者自己試「如果參數變成 X 會怎樣」。',
    props: 'type（bar|line|area）、data=[{ label, value }]、title、unit、min/max/step',
    example: '<InteractiveChart type="bar" data={[{ label:\'方案A\', value:40 }]} title="延遲估算" unit="ms" />',
  },
  {
    name: 'Stats',
    category: 'data',
    summary: '數字磚容器（一排 KPI）',
    whenToUse: '想把幾個關鍵數字（前後對比、量測結果）做成醒目的一排。',
    example: '<Stats><Stat label="吞吐" value="42" unit="tok/s" trend="up" /></Stats>',
  },
  {
    name: 'Stat',
    category: 'data',
    childOf: 'Stats',
    summary: '單一數字磚',
    whenToUse: '放在 <Stats> 裡。',
    props: 'label、value、unit、trend（up|down|flat）、hint（小字補充）',
    example: '<Stat label="延遲" value="8" unit="ms" trend="down" hint="原 64ms" />',
    note: 'value 儘量短；「A → B」這種長字串改成 value="B" + hint="原 A"。',
  },

  // ── media：圖與影片 ───────────────────────────────────────────
  {
    name: 'ImageCompare',
    category: 'media',
    summary: '前後圖對比滑桿（拖曳分隔線）',
    whenToUse: 'UI 改版、修圖前後、破圖修復——兩張同構圖的對照。',
    props: 'before、after（圖片 URL）、beforeLabel、afterLabel、caption、alt',
    example:
      '<ImageCompare before="/uploads/a.png" after="/uploads/b.png" beforeLabel="修前" afterLabel="修後" caption="…" />',
    note: '圖片先用 koimsurai_upload_image 上傳拿 /uploads/… 網址。',
  },
  {
    name: 'Sketch',
    category: 'media',
    summary: 'Excalidraw 手繪風靜態圖（吃 mermaid 定義）',
    whenToUse: '**概念草圖／比喻／心智模型**——像在白板上隨手畫的示意圖。節點少（≤6）、不需要讀者操作時用它。',
    props: 'chart（mermaid 定義，單行用 ; 分隔）、title',
    example: '<Sketch chart="graph TD; A[想法] --> B[草稿]; B --> C[成品]" title="心智模型" />',
    note: '**精確的技術圖用 ```mermaid 圍籬，不要用這個**：流程／時序／狀態／ER／架構、節點多、讀者可能想放大細看或下載時——mermaid 有工具列（切配色、縮放平移、全螢幕、下載 SVG/PNG），Sketch 是靜態的、寬度上限 440px。手繪風只有 Sketch 有。',
  },
  {
    name: 'Video',
    category: 'media',
    summary: '自架影片播放器',
    whenToUse: '有錄好的操作示範／畫面錄影（先上傳到 /uploads）。',
    props: 'src、poster、caption',
    example: '<Video src="/uploads/demo.mp4" poster="/uploads/cover.png" caption="操作示範" />',
  },
  {
    name: 'YouTube',
    category: 'media',
    summary: 'YouTube 嵌入（點擊才載入，對隱私/CSP 友善）',
    whenToUse: '要引用 YouTube 影片時。',
    props: 'id（影片 ID）、title',
    example: '<YouTube id="dQw4w9WgXcQ" title="示範影片" />',
  },

  // ── layout：結構編排 ──────────────────────────────────────────
  {
    name: 'Steps',
    category: 'layout',
    summary: '編號要點／步驟（數字圈 + 標題 + 內文）',
    whenToUse:
      '**凡是「一、二、三」這種編號清單都用它**——教學流程、三個問題／發現／原因、依序拆解的分析。不要自己在正文打「**一、…**」粗體編號。',
    example: '<Steps><Step title="無樣式閃爍">…</Step><Step title="雙渲染">…</Step></Steps>',
  },
  {
    name: 'Step',
    category: 'layout',
    childOf: 'Steps',
    summary: '單一步驟／要點',
    whenToUse: '放在 <Steps> 裡。',
    props: 'title',
    example: '<Step title="裝依賴">…整段說明，可含 code、其他 block…</Step>',
    note: '內容要頂左寫、前後留空行才會被當 markdown 解析（縮排 4 空格會變程式碼區塊）。',
  },
  {
    name: 'Tabs',
    category: 'layout',
    summary: '內容分頁（藥丸切換，每頁一整段內容）',
    whenToUse: '同一件事的多種做法／取捨對照，讓讀者切著比較。',
    example: '<Tabs><Tab title="做法 A（推薦）">…</Tab><Tab title="做法 B">…</Tab></Tabs>',
  },
  {
    name: 'Tab',
    category: 'layout',
    childOf: 'Tabs',
    summary: '單一分頁',
    whenToUse: '放在 <Tabs> 裡。',
    props: 'title（藥丸標籤）',
    example: '<Tab title="做法 A">…</Tab>',
    note: '內容要頂左寫、前後留空行（同 Step）。',
  },
  {
    name: 'Details',
    category: 'layout',
    summary: '段落級收合（點 summary 展開）',
    whenToUse: '冗長的 log／完整證明／有趣但離題的旁支——想留著又不想打斷主線時。',
    props: 'summary（收合時顯示的標題）、open（預設展開）',
    example: '<Details summary="番外：完整錯誤 log">…</Details>',
  },
  {
    name: 'Refs',
    category: 'layout',
    summary: '文末參考連結區（依網域自動帶品牌 icon）',
    whenToUse: '有參考資料／延伸閱讀清單時。**別用裸網址的 markdown list**（那會每條都彈 hover 卡、很吵）。',
    props: 'items=[{ label, links: [{ text, href }] }]、title',
    example:
      "<Refs items={[{ label: 'TanStack Start', links: [{ text: '官網', href: 'https://tanstack.com/start' }] }]} />",
    note: '站內文章想要「卡片」樣式，改成讓整段只放一個 /blog/ 連結（會自動變站內文章卡）。',
  },

  // ── interactive：讀者互動 ─────────────────────────────────────
  {
    name: 'Poll',
    category: 'interactive',
    summary: '內嵌投票（真投票，票數存後端）',
    whenToUse: '想收集讀者意見／技術選型統計時，例如「你的專案用哪個方案？」。',
    props: 'id（全站唯一）、question、options=[{ key, label }]、showTotal',
    example:
      "<Poll id=\"blog-render\" question=\"你的部落格怎麼渲染？\" options={[{ key: 'ssr', label: '單次 SSR' }, { key: 'isr', label: 'SSG／ISR' }]} />",
    note: '⚠ id 與 option key 一旦發布就不可改（改了等於換一份投票、票數歸零）；label 才是顯示文字。同一瀏覽器只能投一次。',
  },
];

/** 所有合法標籤名（validate 用來偵測未知元件）。 */
export const BLOCK_NAMES = new Set(BLOCKS.map((b) => b.name));

const CATEGORY_LABEL: Record<BlockDef['category'], string> = {
  prose: '文字表達',
  code: '程式碼',
  data: '數據視覺化',
  media: '圖與影片',
  layout: '結構編排',
  interactive: '讀者互動',
};

/** 撰寫指南第 4 節：由 BLOCKS 生成，確保指南與目錄永遠同步。 */
export function renderBlocksForGuide(): string {
  const order: BlockDef['category'][] = ['prose', 'code', 'data', 'media', 'layout', 'interactive'];
  const lines: string[] = [];
  for (const cat of order) {
    const items = BLOCKS.filter((b) => b.category === cat && !b.childOf);
    if (!items.length) continue;
    lines.push(`### ${CATEGORY_LABEL[cat]}`);
    for (const b of items) {
      const children = BLOCKS.filter((c) => c.childOf === b.name);
      lines.push(`- **<${b.name}>** ${b.summary}`);
      lines.push(`  用時機：${b.whenToUse}`);
      if (b.props) lines.push(`  props：${b.props}`);
      lines.push(`  例：${b.example}`);
      if (b.note) lines.push(`  ⚠ ${b.note}`);
      for (const c of children) {
        lines.push(
          `  - **<${c.name}>**（${b.name} 的子元件）${c.summary}｜例：${c.example}${c.note ? `｜⚠ ${c.note}` : ''}`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
