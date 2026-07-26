-- 分類「描述」的多語系（文章頁的分類 tooltip 會顯示 short_description / description）。
-- 與 0004 的 name_* 同樣是純顯示欄位，不參與任何 join/比對；沒填就 fallback 回來源語言。
ALTER TABLE categories ADD COLUMN description_en TEXT;
ALTER TABLE categories ADD COLUMN description_ja TEXT;
ALTER TABLE categories ADD COLUMN description_ko TEXT;
ALTER TABLE categories ADD COLUMN description_zh_cn TEXT;
ALTER TABLE categories ADD COLUMN short_description_en TEXT;
ALTER TABLE categories ADD COLUMN short_description_ja TEXT;
ALTER TABLE categories ADD COLUMN short_description_ko TEXT;
ALTER TABLE categories ADD COLUMN short_description_zh_cn TEXT;
