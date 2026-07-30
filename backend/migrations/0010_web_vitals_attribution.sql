-- CLS 歸因欄位。
--
-- 為什麼要加：CLS 是「只在實地出現」的問題——Lighthouse 在無節流的本機跑同一頁是 CLS 0，
-- 因為頁面快到非同步內容在首次繪製前就到齊了。實地 p75 卻是 0.129（桌機、文章頁）。
-- 靜態讀碼只能盤點「哪些區塊沒預留高度」，答不出「實際上是哪一個在動」。
--
-- web-vitals 的 attribution build（onCLS）會給 largestShiftTarget：那一次最大位移的元素
-- CSS 選擇器字串。存下來之後，就能直接問「超標的那些 page view，動的是哪個元素」。
--
-- 只存選擇器字串與 loadState，無 PII（同 web_vitals 既有欄位的原則）。舊資料 NULL。
ALTER TABLE web_vitals ADD COLUMN target TEXT;
ALTER TABLE web_vitals ADD COLUMN load_state TEXT;

-- 查詢型態固定是「某 metric、某時間窗、target 非空」→ 這個索引直接覆蓋。
CREATE INDEX IF NOT EXISTS idx_web_vitals_target
  ON web_vitals(metric, created_at) WHERE target IS NOT NULL;
