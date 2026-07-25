-- 分類名的多語系「顯示名」。
--
-- ⚠️ `name` 仍是唯一的**資料鍵**：posts.category 存的就是 name、前台的分類篩選也比對它。
-- 這裡新增的欄位只影響「顯示」，不參與任何 join/比對 → 加譯名不會動到既有資料關聯。
-- 沒填譯名時前端 fallback 回 name（來源語言）。
ALTER TABLE categories ADD COLUMN name_en TEXT;
ALTER TABLE categories ADD COLUMN name_ja TEXT;
ALTER TABLE categories ADD COLUMN name_ko TEXT;
ALTER TABLE categories ADD COLUMN name_zh_cn TEXT;
