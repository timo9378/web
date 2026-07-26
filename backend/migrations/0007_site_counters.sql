-- 站台層級的計數器（目前用於首頁的「留下印記」按讚）。
-- 與文章的 likes/reactions 分開：這是對「整個站」的心意，不綁任何一篇。
-- 防重複同樣在 client 以 localStorage 做（與 reactions/poll 同策略，不收 IP）。
CREATE TABLE IF NOT EXISTS site_counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
