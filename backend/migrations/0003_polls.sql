-- 文章內嵌投票（MDX <Poll>）的票數。
-- poll_id 由作者在文章裡自訂（不綁 post_id → 同一份投票可跨頁引用、改版文章也不會歸零）；
-- option_key 是選項的穩定鍵。只存聚合票數，不存投票者（防重複投票在 client 端以 localStorage 做，
-- 與站上 reactions 同策略；本站不做帳號級投票，不收 IP）。
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id TEXT NOT NULL,
  option_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (poll_id, option_key)
);
