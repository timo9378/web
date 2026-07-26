-- 標籤的多語系「顯示名」。
--
-- ⚠️ 與分類同樣的設計：`name` 仍是**資料鍵**（post_tags 關聯、前台標籤篩選都比對它），
-- 這裡新增的欄位只影響「顯示」，不參與任何 join/比對 → 加譯名不會動到既有的文章標籤關聯。
-- 沒填譯名時前端 fallback 回 name（來源語言）。
ALTER TABLE tags ADD COLUMN name_en TEXT;
ALTER TABLE tags ADD COLUMN name_ja TEXT;
ALTER TABLE tags ADD COLUMN name_ko TEXT;
ALTER TABLE tags ADD COLUMN name_zh_cn TEXT;
