// E2E 的種子資料。目標不是「像正式站」，而是**每個頁面都有東西可 render**——
// 空清單也會過的斷言等於沒斷言，所以每張表都給到至少能撐起一區的量。
//
// 用 node:sqlite（Node 22+ 內建）直接寫，不引第三方 driver：schema 已經由後端啟動時
// 跑完的 migrations 建好，這裡只負責塞資料。

import { DatabaseSync } from 'node:sqlite';

/** 固定日期，讓「x 天前」這種相對時間在測試裡也穩定。 */
const T = (daysAgo = 0) =>
  new Date(Date.UTC(2026, 0, 15, 3, 0, 0) - daysAgo * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

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
