-- 外部同步的游標／狀態（key-value，值是字串）。
--
-- 為什麼不用 site_counters：那張表的 `count` 是 INTEGER，而這裡要存的是 ISO 時間戳
-- （Simkl 的 /sync/activities 回 "2026-08-01T17:32:03Z"），塞不進去。
--
-- 為什麼不用檔案：Trakt 那套把 token 存成 .trakt-token.json，結果是「檔案在、程式讀不到」
-- 這種問題要花時間排除（權限？路徑？內容壞了？），而且備份/還原時容易漏。
-- 放進同一顆 SQLite 就跟其他資料一起備份，也能用 SQL 直接看。
--
-- 目前的 key：
--   simkl.activities_all   Simkl /sync/activities 的 `all` 時間戳，作為增量同步的游標。
--                          Simkl 明文要求「一定要帶 date_from，否則 client_id 會被停權」，
--                          所以這個值遺失時寧可從 Phase 1（全量、分型別、序列）重來，
--                          也不要無條件全量輪詢。
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
