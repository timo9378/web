// E2E 的種子資料。目標不是「像正式站」，而是**每個頁面都有東西可 render**——
// 空清單也會過的斷言等於沒斷言，所以每張表都給到至少能撐起一區的量。
//
// 用 node:sqlite（Node 22+ 內建）直接寫，不引第三方 driver：schema 已經由後端啟動時
// 跑完的 migrations 建好，這裡只負責塞資料。

import { DatabaseSync } from 'node:sqlite';

/**
 * 種子裡「已發布」的文章數（草稿不算）。
 *
 * 讓斷言 import 這個常數而不是寫死數字：這個檔案本來就會因為別的需求增減文章
 * （id=4 就是為了 CLS 測試加的），而寫死的那一版每加一篇就會讓一個不相干的
 * API 契約測試變紅，讀的人還得回頭猜「這個 2 是哪來的」。
 */
export const PUBLISHED_POSTS = 6;

/**
 * 測試自己建立的文章一律用這個前綴命名。
 *
 * 放在這裡是因為它跟 `PUBLISHED_POSTS` 是同一件事的兩面：這個檔案知道「e2e 的 DB
 * 裡有哪些資料」。post-editor.spec.ts 用它命名（並在收尾時據此刪除），
 * api-contract.spec.ts 用它把那些文章從精確篇數的斷言裡排掉——跨檔是平行跑的，
 * 不排掉的話那條斷言會依執行順序間歇性變紅。
 *
 * ⚠ 兩邊都 import 這個常數而不是各寫一份字串；改名要改這裡。
 */
export const E2E_POST_PREFIX = 'e2e-post-';

/**
 * 種子訂閱者的退訂 token。退訂信裡的連結長這樣：`/unsubscribe?token=…`。
 *
 * 寫死一個值是必要的：token 只有在真的訂閱時才生成，而 API **不會**把它回給
 * 呼叫端（那正是它的意義——只有收到信的人才知道）。沒有這個常數，退訂頁就完全
 * 測不了，也就是說「讀者點了退訂連結卻看到錯誤畫面」不會有任何東西擋得住。
 */
export const UNSUB_TOKEN = 'e2e-unsub-token-0123456789abcdef';

/** 固定日期，讓「x 天前」這種相對時間在測試裡也穩定。 */
const T = (daysAgo = 0) =>
  new Date(Date.UTC(2026, 0, 15, 3, 0, 0) - daysAgo * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

/**
 * 產生一篇夠長的文章給 CLS 測試用（見下方 id=4）。
 *
 * 目標是渲染後的頁面高度落在生產文章的量級（實地量到的最終 docH 約 7100px）。
 * 段落長度刻意固定、不隨機——CLS 是量測，輸入每次不一樣的話數字就沒得比。
 */
/**
 * 上傳圖片的網址形狀，與正式環境一致：`#th=<hash>&w=<寬>&h=<高>`。
 *
 * ⚠ 這幾張圖不是裝飾，是 cls.spec 的**受測對象**。
 *
 * 原本這篇長文是純文字，於是「圖片沒有預留版面就塌掉」這條路徑從來沒進過測試資料——
 * CLS 守門寫得好好的（連「捲不到深處＝沒測到東西」都防了），卻整整漏掉一個
 * 上了正式站的回歸：實地量到「捲到 4000px 後重整」CLS 0.3362，而 CI 全綠。
 * 詳細的歸因見 BlogImage.tsx 的 `decodeSizeFromSrc`。
 *
 * 三個細節都不能省：
 *   · 檔名要帶 `-<寬>x<高>`——stack.mjs 靠它造出**真的那麼大**的圖。用 1×1 的話
 *     載入後只撐開 1px，位移量不出來，測試會安靜地通過。
 *   · fragment 要帶 `w`/`h`——那是前端寫出 `<img width height>` 的唯一來源。
 *   · 尺寸要夠大且長寬比各異，塌陷才明顯、也才像真實文章。
 * `#th=` 的雜湊借用正式站某張圖的，只是為了讓佔位圖那條路徑也一起走到。
 */
const TH = 'ivcFDIIJTMeGeYmGeXb8esqvpw';
const img = (n, w, h) => `![測試圖 ${n}](/uploads/2026/08/cls-fixture-${n}-${w}x${h}.png#th=${TH}&w=${w}&h=${h})`;

function longArticle() {
  const SECTIONS = 36;
  const para =
    '這一段是為了把頁面撐高而存在的內文。它的長度固定，因為 CLS 是量測而不是斷言字串，' +
    '輸入每次不一樣的話跑出來的數字就沒有可比性。實際的文章段落大約就是這個長度，' +
    '一段三到四行，這樣頁面高度才會接近線上真正的文章頁。';
  const out = ['# CLS 量測用的長文', '', '這篇文章不是給人讀的，是給 tests/e2e/cls.spec.ts 捲的。', ''];
  for (let i = 1; i <= SECTIONS; i++) {
    out.push(`## 第 ${i} 節`, '', para, '', para, '');
    // 圖片散在各節之間，而且**要落在捲動目標的附近**——cls.spec 捲到文章深處才重整，
    // 位移只有在「重整後那些圖正好在視窗內」時才算進 CLS（畫面外的不計）。
    // 全塞在開頭的話捲下去就看不到了，等於沒測到。
    if (i % 7 === 0) {
      const n = i / 7;
      const [w, h] = [[1142, 724], [1145, 305], [704, 85], [651, 183], [900, 600]][n - 1] ?? [800, 450];
      out.push(img(n, w, h), '');
    }
  }
  return out.join('\n');
}

/**
 * 用到**每一個**已註冊 MDX block 的文章（見下方 id=7）。
 *
 * 為什麼需要它：MDX 編譯失敗時前台是**靜默退回 markdown**（見 blogList.ts 的 catch），
 * 讀者看到一行裸的 `<BarChart … />`，而 API 照樣回 200——沒有任何東西會告訴你它壞了。
 * id=6 那篇只用了 `<Poll>`，所以那條保護一次只涵蓋一個 block。
 *
 * 量 e2e 覆蓋率時發現有 6 個 block 的檔案**從頭到尾沒被載入過**
 * （BarChart / Chart / ImageCompare / InteractiveChart / Math / Sketch），
 * 也就是說它們就算整個壞掉，整套 e2e 也不會有任何一條變紅。
 *
 * ⚠ 用 `join('\n')` 而不是樣板字串：內文裡有 markdown 的三個反引號，
 *   包在樣板字串裡要逐個逸出，是製造錯誤的好方法。
 * ⚠ 圖片與影片一律指向 public/ 底下真的存在的檔案——smoke.spec.ts 會把任何
 *   非 /api 的 404 收集起來報錯。
 */
function allBlocksArticle() {
  return [
    '# 每個 MDX block 都在這裡',
    '',
    '這篇不是給人讀的，是給 `tests/e2e/mdx-blocks.spec.ts` 檢查「每個 block 都真的渲染成元件」。',
    '',
    '<Note title="這是 Note">提示區塊的內文。</Note>',
    '',
    '一段內文，裡面有 <Annot note="這是註解的內容">帶註解的字</Annot>，',
    '也有 <Spoiler>被遮住的雷</Spoiler>，還有日文的 <Ruby text="請求書" reading="せいきゅうしょ" />。',
    '按 <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> 開命令面板。提到 <Mention platform="github" user="timo9378" />。',
    '',
    '<BarChart title="語言分佈" unit="%" data={[{label:"Rust",value:48},{label:"TypeScript",value:37},{label:"CSS",value:15}]} />',
    '',
    '<Chart type="line" title="每週建置時間" unit="s" categoryKey="week" series={[{key:"build",name:"建置"}]} data={[{week:"W1",build:42},{week:"W2",build:37},{week:"W3",build:29}]} />',
    '',
    '<InteractiveChart type="bar" title="可調整的示範" unit="ms" min={0} max={100} step={5} data={[{label:"A",value:20},{label:"B",value:60}]} />',
    '',
    '<Math tex="E = mc^2" display />',
    '',
    '行內的 <Math tex="a^2 + b^2 = c^2" /> 也要能渲染。',
    '',
    '<Sketch title="流程" chart={"graph TD\\n  A[開始] --> B[結束]"} />',
    '',
    '<ImageCompare before="/og-default-v2.png" after="/pwa-512.png" beforeLabel="修之前" afterLabel="修之後" alt="對照圖" caption="拉桿可以左右拖" />',
    '',
    '<CodeTabs files={[{name:"a.ts",lang:"ts",code:"export const a = 1;"},{name:"b.rs",lang:"rust",code:"fn main() {}"}]} />',
    '',
    '<Diff lang="ts" title="修好之後" code={"- const x = 1\\n+ const x = 2"} />',
    '',
    '<Install pkg="v8-to-istanbul" dev />',
    '',
    '<Tabs>',
    '  <Tab title="第一頁">分頁一的內容。</Tab>',
    '  <Tab title="第二頁">分頁二的內容。</Tab>',
    '</Tabs>',
    '',
    '<Steps>',
    '  <Step title="第一步">先做這個。</Step>',
    '  <Step title="第二步">再做那個。</Step>',
    '</Steps>',
    '',
    '<Stats>',
    '  <Stat label="e2e 覆蓋率" value="53.7" unit="%" trend="up" hint="statement" />',
    '  <Stat label="單元測試" value="102" trend="up" />',
    '</Stats>',
    '',
    '<Details summary="展開看細節">被摺疊起來的內容。</Details>',
    '',
    '<FileTree tree={"src/\\n  lib/\\n    blogContent.ts\\n  components/"} />',
    '',
    '<Video src="/videos/Web_video.mkv" caption="影片區塊" />',
    '',
    '<YouTube id="dQw4w9WgXcQ" title="外嵌影片（點了才載）" />',
    '',
    '<Poll id="all-blocks" question="這篇渲染正常嗎?" options={[{key:"y",label:"正常"},{key:"n",label:"壞了"}]} />',
    '',
    '<Refs title="延伸閱讀" items={[{label:"MDN",links:[{text:"getComputedStyle",href:"https://developer.mozilla.org/"}]}]} />',
    '',
    '## 一般 markdown 也要照常運作',
    '',
    '```rust',
    'fn main() {',
    '    println!("hello");',
    '}',
    '```',
    '',
    '結尾的一段內文。',
    '',
  ].join('\n');
}

export function seed(dbPath) {
  const db = new DatabaseSync(dbPath);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  // ── 分類 / 標籤 ────────────────────────────────────────────────
  for (const [name, slug, desc] of [
    ['技術', 'tech', '工程筆記'],
    ['生活', 'life', '雜記'],
  ]) {
    run('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)', name, slug, desc);
  }
  for (const t of ['rust', 'typescript', '測試']) run('INSERT INTO tags (name) VALUES (?)', t);

  // ── 文章 ───────────────────────────────────────────────────────
  // 一篇有完整譯文（驗語系切換）、一篇只有中文、一篇草稿（不該出現在公開清單）
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, view_count, likes,
       created_at, source_language, title_en, content_en, excerpt_en, allow_comments)
     VALUES (1, ?, ?, ?, '技術', 'published', 'Koimsurai', 42, 7, ?, 'zh-TW', ?, ?, ?, 1)`,
    '第一篇測試文章',
    '# 標題\n\n這是內文，長度要夠讓詳情頁真的有東西。\n\n- 一\n- 二\n',
    '這是摘要',
    T(3),
    'The first test post',
    '# Heading\n\nBody text for the English variant.\n',
    'English excerpt',
  );
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, created_at, allow_comments)
     VALUES (2, '第二篇測試文章', '第二篇的內文。', '第二篇摘要', '生活', 'published', 'Koimsurai', ?, 1)`,
    T(1),
  );
  run(
    `INSERT INTO posts (id, title, content, status, created_at)
     VALUES (3, '未發布草稿', '草稿內文（不該出現在公開清單）', 'draft', ?)`,
    T(0),
  );
  // 第 4 篇存在的唯一理由是 CLS 測試（tests/e2e/cls.spec.ts）。
  //
  // 真正會出事的 CLS 情境是「捲在文章深處按 F5」：瀏覽器在 SSR 的 HTML 還沒解析完
  // （docH 一路長大）就把捲動位置還原回去，於是後面每一段解析進來都算一次位移。
  // 上面那三篇各只有幾行，頁面根本捲不動，這個情境重現不了——所以需要一篇真的長文。
  //
  // 內容用產生的而不是寫死一大段：長度是這篇唯一的重點，寫死幾百行假文字只會讓
  // 這個檔難讀。SECTIONS 調大調小就等於調頁面高度。
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, created_at, allow_comments)
     VALUES (4, ?, ?, ?, '技術', 'published', 'Koimsurai', ?, 1)`,
    'CLS 量測用的長文',
    longArticle(),
    '這篇存在的唯一理由是讓 CLS 測試有夠長的頁面可以捲',
    T(2),
  );
  // 第 5、6 篇存在的理由是**文章頁的互動**——前四篇都是純文字，
  // 程式碼複製鈕、圖片燈箱、MDX 區塊在它們身上一個都碰不到。
  //
  // 日期給得很舊（T(10)/T(11)）是刻意的：它們只在自己的網址被打開，
  // 排在清單最後就不會動到別的測試對「第一張卡是哪篇」的假設。
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, created_at, allow_comments)
     VALUES (5, ?, ?, ?, '技術', 'published', 'Koimsurai', ?, 1)`,
    '有程式碼與圖片的文章',
    // 圖片指向站上真的存在的資產——隨便編一個路徑會讓 smoke 的「不該有 404」紅掉
    //
    // ⚠ mermaid 那塊是後補的，理由跟 #77 的圖片一模一樣：**種子裡從來沒有圖表**，
    // 所以那 575 行（渲染、工具列、主題／版面切換、全螢幕、ELK 延遲載入）整個
    // 沒有任何一條 e2e 走過——它就算完全不渲染，整套測試也還是綠的。
    // 用 `graph TD` 而不是更複雜的圖：這裡釘的是「mermaid 有被載入並畫成 SVG」，
    // 不是 mermaid 自己的排版能力（那是它的測試該做的事）。
    '# 互動元素\n\n```rust\nfn main() {\n    println!("hello");\n}\n```\n\n' +
      '```mermaid\ngraph TD\n  A[開始] --> B[結束]\n```\n\n' +
      '![一張測試圖片](/og-default-v2.png)\n',
    '有程式碼區塊、圖表與圖片',
    T(10),
  );
  // MDX 路徑：`format='mdx'` 會讓 src/data/blogList.ts 在 server 端編譯成 React 元件。
  //
  // ⚠ 編譯失敗時它**靜默退回 markdown**（見 blogList.ts 的 catch），讀者看到的是
  // 一行裸的 `<Poll ... />` 文字，而 API 仍然回 200。所以這篇的價值不只是「測投票」，
  // 是釘住「MDX 真的有被編譯」——那條降級沒有任何東西會告訴你它發生了。
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, created_at, format, allow_comments)
     VALUES (6, ?, ?, ?, '技術', 'published', 'Koimsurai', ?, 'mdx', 1)`,
    'MDX 區塊測試文',
    '# MDX\n\n<Poll id="demo" question="你偏好哪一種渲染?" ' +
      'options={[{key:"a",label:"單次 SSR"},{key:"b",label:"CSR"}]} />\n\n' +
      '一段普通內文。\n',
    'MDX 區塊',
    T(11),
  );
  // 用到每一個已註冊 block 的文章（理由見 allBlocksArticle 的說明）。
  run(
    `INSERT INTO posts (id, title, content, excerpt, category, status, author, created_at, format, allow_comments)
     VALUES (7, ?, ?, ?, '技術', 'published', 'Koimsurai', ?, 'mdx', 1)`,
    '每個 MDX block 都在這裡',
    allBlocksArticle(),
    '把所有 MDX block 放在同一頁，用來確認沒有任何一個安靜地退回純文字',
    T(12),
  );
  run('INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1), (1, 2), (2, 3)');
  run("INSERT INTO post_reactions (post_id, emoji, count) VALUES (1, '👍', 5)");

  // ── 留言（approved 才會公開）────────────────────────────────────
  run(
    `INSERT INTO comments (post_id, author, content, status, created_at, is_admin)
     VALUES (1, '路過的讀者', '寫得不錯', 'approved', ?, 0)`,
    T(2),
  );
  run(
    `INSERT INTO comments (post_id, author, content, status, created_at, is_admin)
     VALUES (1, '待審核的人', '這則還沒過審', 'pending', ?, 0)`,
    T(1),
  );

  // ── 碎念（含 link ref，驗 ThoughtRef 的形狀）─────────────────────
  run(
    `INSERT INTO thoughts (id, content, ref_type, ref_url, ref_json, likes, created_at)
     VALUES (1, '純文字碎念', NULL, NULL, NULL, 3, ?)`,
    T(2),
  );
  run(
    `INSERT INTO thoughts (id, content, ref_type, ref_url, ref_json, created_at)
     VALUES (2, '帶連結的碎念', 'link', 'https://example.com/a', ?, ?)`,
    JSON.stringify({ title: '範例連結', desc: '一段簡介', image: null, site: 'example.com' }),
    T(1),
  );
  run(
    `INSERT INTO comments (thought_id, author, content, status, created_at)
     VALUES (1, '讀者', '碎念的留言', 'approved', ?)`,
    T(0),
  );

  // ── 書櫃 ───────────────────────────────────────────────────────
  run(
    `INSERT INTO books (isbn, title, authors, publisher, description, cover_url, page_count,
       reading_status, rating, date_added)
     VALUES ('9781234567890', '測試書名', '某作者', '某出版社', '書籍簡介', NULL, 320, 'read', 5, ?)`,
    T(30),
  );
  run(
    `INSERT INTO books (isbn, title, authors, reading_status, date_added)
     VALUES ('9780987654321', '在讀的書', '另一位作者', 'reading', ?)`,
    T(5),
  );
  // 下面兩本是給 bookshelf.spec.ts 的篩選／排序用的。少了它們那些測試會「綠得沒有意義」：
  // 兩本書的時候，狀態篩選剩一本、排序反轉只有兩個元素，任何實作都會過。
  // 這裡刻意讓四本書涵蓋三種 reading_status、有評分與沒評分、以及 ASCII 與中日文標題
  // （localeCompare 對這兩類的處理不同，排序若改成 `<` 比較就會露餡）。
  run(
    `INSERT INTO books (isbn, title, authors, reading_status, rating, date_added)
     VALUES ('9784000000000', 'Zero to One', 'Peter Thiel', 'read', 3, ?)`,
    T(20),
  );
  run(
    `INSERT INTO books (isbn, title, authors, reading_status, date_added)
     VALUES ('9784111111111', '海邊的卡夫卡', '村上春樹', 'to-read', ?)`,
    T(1),
  );

  // ── 在看什麼 ───────────────────────────────────────────────────
  // 每個分頁至少三筆，理由同上：片庫的搜尋與排序在只有一筆的時候測不出東西。
  for (const [sn, title, ep, days] of [
    [1001, '測試動畫', '[01]', 4],
    [1002, '另一部動畫', '[12]', 9],
    [1003, 'Angel Beats', '[03]', 2],
  ]) {
    run(
      `INSERT INTO anime_history (anime_sn, video_sn, title, cover_url, episode, last_watched_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      sn,
      sn + 1000,
      title,
      ep,
      T(days),
    );
  }
  for (const [title, date, rating, year, genres] of [
    ['測試電影', '2026-01-10', 8, 2024, '劇情, 科幻'],
    ['另一部電影', '2025-11-02', 6, 2019, '喜劇'],
    ['Arrival', '2026-02-14', 9, 2016, '劇情, 科幻'],
  ]) {
    run(
      `INSERT INTO film_history (title, watched_date, rating, source, release_year, genres)
       VALUES (?, ?, ?, 'simkl', ?, ?)`,
      title,
      date,
      rating,
      year,
      genres,
    );
  }
  for (const [series, ep, date] of [
    ['測試影集', 'S01E01', '2026-01-12'],
    ['另一部影集', 'S02E05', '2025-12-20'],
    ['Severance', 'S01E09', '2026-02-01'],
  ]) {
    run(
      `INSERT INTO tv_history (series_name, episode_label, watched_date, source)
       VALUES (?, ?, ?, 'simkl')`,
      series,
      ep,
      date,
    );
  }
  // favorites 的標題/海報是打 TMDb 即時補的；E2E 沒有 token → 會退成 "#<tmdbId>"，
  // 那條 fallback 路徑本身也值得被走到一次
  run(
    `INSERT INTO watch_favorites (tmdb_id, kind, rating, quote, sort_order, created_at)
     VALUES (693134, 'film', 5, '私心第一名', 0, ?)`,
    T(10),
  );

  // ── 投票 / 計數器 ──────────────────────────────────────────────
  run("INSERT INTO poll_votes (poll_id, option_key, count) VALUES ('demo', 'a', 3), ('demo', 'b', 1)");
  run("INSERT INTO site_counters (key, count) VALUES ('visits', 1234)");

  // ── 電子報訂閱者 ────────────────────────────────────────────────
  // 退訂頁（/unsubscribe?token=…）沒有這個就完全測不了：token 是真的訂閱時才生成的，
  // 而 API 不會把它回給呼叫端（那正是它的意義）。固定值讓測試不必先讀 DB。
  run(
    `INSERT INTO newsletter_subscribers (email, name, status, unsubscribe_token)
     VALUES ('reader@example.com', '訂閱的讀者', 'active', ?)`,
    UNSUB_TOKEN,
  );

  db.close();
}
