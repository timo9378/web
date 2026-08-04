-- 撤掉 0014 加的 image_expires_at。
--
-- 0014 那支不能刪、也不能改一個字：sqlx 啟動時會把 _sqlx_migrations 裡的紀錄跟檔案
-- 對照，少一支報 "previously applied but is missing"，內容變了報 "previously applied
-- but has been modified"，兩種都是直接拒絕啟動。我兩種都撞了一次才寫下這段。
-- 已經跑過的 migration 只能往前疊，這支就是那個「往前」。

-- 為什麼加了又拿掉：那一欄記的是「這張預覽圖什麼時候到期」，但那個值本來就是
-- link_previews.image 這個網址本身的函數（?X-Amz-Date + ?X-Amz-Expires 之類），
-- 存起來只是同一件事的第二份真相。改成在 handlers/link_preview.rs 讀取時現算之後：
--
--   1. 不必回填——0014 之前就寫進去的列（欄位是 NULL）一樣會被正確判定為已過期。
--      這才是實際踩到的問題：只加欄位的話，改動前存進去的 GitHub 連結會繼續供應
--      401 的死網址，直到它的 7 天 TTL 到期。
--   2. 少一個「寫入時算對、讀取時才發現算錯」的縫。
--
-- 欄位加進去到現在只有這台機器寫過，而且從來沒有被讀取路徑依賴過，移除是安全的。
ALTER TABLE link_previews DROP COLUMN image_expires_at;
