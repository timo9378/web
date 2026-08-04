-- 清掉被截斷的 og:image 網址。
--
-- decode_entities 以前結尾有 `.chars().take(400)`——那是給標題／摘要的顯示長度上限，
-- 但 meta_content 是文字欄位和 og:image 共用的，所以網址也被砍。實例：GitHub repo 頁的
-- og:image 是 719 個字的預簽章網址，砍到 400 剛好把 X-Amz-SignedHeaders 從中間切斷，
-- 簽章失效 → 圖一律 401。程式已經修好（截斷只留給文字欄位），但 DB 裡存的仍是斷掉的
-- 那半截，而 link_previews 的 TTL 是 7 天。
--
-- 只清 image，不刪整列：標題／摘要／站名都是好的，沒必要連帶重抓。image 設成 NULL
-- 會讓那些連結先顯示降級卡（favicon + 站名），下次過了 TTL 重抓時就有圖了。
--
-- 判準用「長度剛好 400」：那是舊上限的邊界，正常網址落在這個數字的機率極低，而且
-- 就算誤傷，代價也只是那一列的圖晚一輪才回來。
UPDATE link_previews
   SET image = NULL
 WHERE image IS NOT NULL
   AND length(image) = 400;
