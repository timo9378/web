-- Trakt 同步每 6 小時把整份觀看歷史重插一次，累積出四萬多筆重複。
--
-- 程式端寫的是 `INSERT OR IGNORE`，但 OR IGNORE 只在「真的違反約束」時才有作用。
-- 有兩個洞讓它形同虛設：
--
--   ① 0001_init 用 `CREATE TABLE IF NOT EXISTS` 宣告了 UNIQUE(title, watched_date)，
--      但正式庫的這兩張表是 Express 時代就存在的 —— IF NOT EXISTS 對既有表
--      不會套用新定義，那個 UNIQUE 從來沒生效過。
--   ② 就算生效，watched_date 可能是 NULL（clean_watched_date 對空值或 ≤1970-01-02
--      回 None），而 SQLite 的 UNIQUE 視每個 NULL 為相異值 —— NULL 日期的列
--      每次同步都會再插一筆。
--
-- 這裡用獨立的 CREATE UNIQUE INDEX（不管表當初怎麼建的都會生效）+ COALESCE
-- 把 NULL 折成空字串（讓它們互相衝突）。建索引前必須先去重，否則會失敗。

-- ── film_history ──
-- 保留每組鍵值最早的那筆（MIN(id)），保住原本的 synced_at。
DELETE FROM film_history
WHERE id NOT IN (
  SELECT MIN(id) FROM film_history
  GROUP BY title, COALESCE(watched_date, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_film_history_uniq
  ON film_history (title, COALESCE(watched_date, ''));

-- ── tv_history ──
DELETE FROM tv_history
WHERE id NOT IN (
  SELECT MIN(id) FROM tv_history
  GROUP BY series_name, COALESCE(episode_label, ''), COALESCE(watched_date, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_history_uniq
  ON tv_history (series_name, COALESCE(episode_label, ''), COALESCE(watched_date, ''));
