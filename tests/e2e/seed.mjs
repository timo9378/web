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
export const PUBLISHED_POSTS = 3;

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

/** 固定日期，讓「x 天前」這種相對時間在測試裡也穩定。 */
const T = (daysAgo = 0) =>
  new Date(Date.UTC(2026, 0, 15, 3, 0, 0) - daysAgo * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

/**
 * 產生一篇夠長的文章給 CLS 測試用（見下方 id=4）。
 *
 * 目標是渲染後的頁面高度落在生產文章的量級（實地量到的最終 docH 約 7100px）。
 * 段落長度刻意固定、不隨機——CLS 是量測，輸入每次不一樣的話數字就沒得比。
 */
function longArticle() {
  const SECTIONS = 36;
  const para =
    '這一段是為了把頁面撐高而存在的內文。它的長度固定，因為 CLS 是量測而不是斷言字串，' +
    '輸入每次不一樣的話跑出來的數字就沒有可比性。實際的文章段落大約就是這個長度，' +
    '一段三到四行，這樣頁面高度才會接近線上真正的文章頁。';
  const out = ['# CLS 量測用的長文', '', '這篇文章不是給人讀的，是給 tests/e2e/cls.spec.ts 捲的。', ''];
  for (let i = 1; i <= SECTIONS; i++) {
    out.push(`## 第 ${i} 節`, '', para, '', para, '');
  }
  return out.join('\n');
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

  // ── 在看什麼 ───────────────────────────────────────────────────
  run(
    `INSERT INTO anime_history (anime_sn, video_sn, title, cover_url, episode, last_watched_at)
     VALUES (1001, 2001, '測試動畫', NULL, '[01]', ?)`,
    T(4),
  );
  run(
    `INSERT INTO film_history (title, watched_date, rating, source, release_year, genres)
     VALUES ('測試電影', '2026-01-10', 8, 'trakt', 2024, '劇情, 科幻')`,
  );
  run(
    `INSERT INTO tv_history (series_name, episode_label, watched_date, source)
     VALUES ('測試影集', 'S01E01', '2026-01-12', 'trakt')`,
  );
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

  db.close();
}
