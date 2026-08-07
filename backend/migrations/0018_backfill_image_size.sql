-- 既有文章的圖片網址補上原始尺寸（&w=&h=）。
--
-- 上傳端從 2026-08 起才寫入尺寸；在那之前的圖片只有 `#th=<hash>`，
-- 前端因此寫不出 `<img width height>`，而那是文章頁 CLS 的唯一解藥：
-- 圖片外層是 `width: fit-content`，圖載入前固有寬度是 0 → aspect-ratio
-- 反推的高度也是 0 → 盒子塌掉 → 圖載入時底下內容整片位移。
-- 實測正式站「捲到 4000px 後重整」CLS 0.3362，補上尺寸後歸零。
--
-- 每一條都帶 `NOT LIKE` 守衛 → 重跑不會把 &w=&h= 疊上去（migration 只跑一次，
-- 但手動重放或還原後重跑是真的會發生的事）。

UPDATE posts SET content = REPLACE(content, '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg', '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=1024&h=576')
  WHERE content LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg%' AND content NOT LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg', '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=1024&h=576')
  WHERE content_en LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg%' AND content_en NOT LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg', '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=1024&h=576')
  WHERE content_ja LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg%' AND content_ja NOT LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg', '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=1024&h=576')
  WHERE content_ko LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg%' AND content_ko NOT LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg', '/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=1024&h=576')
  WHERE content_zh_cn LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg%' AND content_zh_cn NOT LIKE '%/uploads/2026/05/1778072147198-78186979.webp#th=WugJFISXiGt_mXaKdndocGUGZg&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg', '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=1024&h=576')
  WHERE content LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg%' AND content NOT LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg', '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=1024&h=576')
  WHERE content_en LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg%' AND content_en NOT LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg', '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=1024&h=576')
  WHERE content_ja LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg%' AND content_ja NOT LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg', '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=1024&h=576')
  WHERE content_ko LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg%' AND content_ko NOT LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg', '/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=1024&h=576')
  WHERE content_zh_cn LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg%' AND content_zh_cn NOT LIKE '%/uploads/2026/05/1778072170280-613278581.webp#th=VfgJFIIrRWebaIV_d3hpgJgJNg&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c', '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=988&h=899')
  WHERE content LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c%' AND content NOT LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c', '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=988&h=899')
  WHERE content_en LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c%' AND content_en NOT LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c', '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=988&h=899')
  WHERE content_ja LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c%' AND content_ja NOT LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c', '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=988&h=899')
  WHERE content_ko LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c%' AND content_ko NOT LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c', '/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=988&h=899')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784734044437-295323330.webp#th=S-cJDoJsJWeFeHlgiKt2iYioxHmPq_c&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA', '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=1053&h=983')
  WHERE content LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA%' AND content NOT LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA', '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=1053&h=983')
  WHERE content_en LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA%' AND content_en NOT LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA', '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=1053&h=983')
  WHERE content_ja LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA', '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=1053&h=983')
  WHERE content_ko LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA', '/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=1053&h=983')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784734046826-870929386.webp#th=TjgOH4ZZWWiGeIhweph4eHeJumgHnHYA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A', '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=2000&h=1057')
  WHERE content LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A%' AND content NOT LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A', '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=2000&h=1057')
  WHERE content_en LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A%' AND content_en NOT LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A', '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=2000&h=1057')
  WHERE content_ja LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A%' AND content_ja NOT LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A', '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=2000&h=1057')
  WHERE content_ko LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A%' AND content_ko NOT LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A', '/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=2000&h=1057')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784734048935-117811498.webp#th=jvcJDIJqEIhnmXdCuGSweC2--A&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA', '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=1168&h=686')
  WHERE content LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA%' AND content NOT LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA', '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=1168&h=686')
  WHERE content_en LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA%' AND content_en NOT LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA', '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=1168&h=686')
  WHERE content_ja LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA', '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=1168&h=686')
  WHERE content_ko LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA', '/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=1168&h=686')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784734050983-706149930.webp#th=EokKJIwIJ1eMhndyiXgLjbPASA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk', '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=1358&h=612')
  WHERE content LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk%' AND content NOT LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk', '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=1358&h=612')
  WHERE content_en LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk%' AND content_en NOT LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk', '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=1358&h=612')
  WHERE content_ja LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk%' AND content_ja NOT LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk', '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=1358&h=612')
  WHERE content_ko LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk%' AND content_ko NOT LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk', '/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=1358&h=612')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784734052791-509420121.webp#th=yhcGC4KGUGqSuCh6Q5AxBBk&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw', '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=1998&h=1046')
  WHERE content LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw%' AND content NOT LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw', '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=1998&h=1046')
  WHERE content_en LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw%' AND content_en NOT LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw', '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=1998&h=1046')
  WHERE content_ja LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw', '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=1998&h=1046')
  WHERE content_ko LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw', '/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=1998&h=1046')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784740173855-293328923.jpg#th=FQgSDIBYeJiPiHiJiHcu9_K1bw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA', '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=1998&h=1046')
  WHERE content LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA%' AND content NOT LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA', '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=1998&h=1046')
  WHERE content_en LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA%' AND content_en NOT LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA', '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=1998&h=1046')
  WHERE content_ja LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA', '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=1998&h=1046')
  WHERE content_ko LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA', '/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=1998&h=1046')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784740175640-560102197.png#th=DvgBBIBvQnasaHZ1qYgGRUZvqA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw', '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=907&h=534')
  WHERE content LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw%' AND content NOT LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw', '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=907&h=534')
  WHERE content_en LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw%' AND content_en NOT LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw', '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=907&h=534')
  WHERE content_ja LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw', '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=907&h=534')
  WHERE content_ko LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw', '/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=907&h=534')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784740177369-404101719.png#th=SQcCBICfVzJJiIlTd3b_5vk9xw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg', '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=1100&h=700')
  WHERE content LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg%' AND content NOT LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg', '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=1100&h=700')
  WHERE content_en LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg%' AND content_en NOT LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg', '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=1100&h=700')
  WHERE content_ja LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg%' AND content_ja NOT LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg', '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=1100&h=700')
  WHERE content_ko LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg%' AND content_ko NOT LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg', '/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=1100&h=700')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784742695824-613208229.png#th=_vcBBIAFWXugtZWjpZKaoKMJSg&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn', '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=1200&h=800')
  WHERE content LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn%' AND content NOT LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn', '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=1200&h=800')
  WHERE content_en LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn%' AND content_en NOT LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn', '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=1200&h=800')
  WHERE content_ja LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn%' AND content_ja NOT LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn', '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=1200&h=800')
  WHERE content_ko LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn%' AND content_ko NOT LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn', '/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=1200&h=800')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784742698054-76632279.png#th=ewgGHYJ3d3dwd3dxdzd3dYd_fvjn&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA', '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=812&h=502')
  WHERE content LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA%' AND content NOT LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA', '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=812&h=502')
  WHERE content_en LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA%' AND content_en NOT LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA', '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=812&h=502')
  WHERE content_ja LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA', '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=812&h=502')
  WHERE content_ko LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA', '/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=812&h=502')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784810475680-773926033.png#th=ywcGBIBFe2eGeHegWnkEeDdwWA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW', '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=1096&h=738')
  WHERE content LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW%' AND content NOT LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW', '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=1096&h=738')
  WHERE content_en LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW%' AND content_en NOT LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW', '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=1096&h=738')
  WHERE content_ja LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW%' AND content_ja NOT LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW', '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=1096&h=738')
  WHERE content_ko LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW%' AND content_ko NOT LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW', '/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=1096&h=738')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784810477466-59238127.png#th=CAgGBYBPlmePeId8eIeIhD-N-1NW&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA', '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=838&h=58')
  WHERE content LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA%' AND content NOT LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA', '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=838&h=58')
  WHERE content_en LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA%' AND content_en NOT LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA', '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=838&h=58')
  WHERE content_ja LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA', '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=838&h=58')
  WHERE content_ko LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA', '/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=838&h=58')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784810479064-7744532.png#th=DAgGAYB5iHmKhwiH__8OAAA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw', '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=1024&h=536')
  WHERE content LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw%' AND content NOT LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw', '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=1024&h=536')
  WHERE content_en LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw%' AND content_en NOT LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw', '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=1024&h=536')
  WHERE content_ja LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw', '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=1024&h=536')
  WHERE content_ko LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw', '/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=1024&h=536')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784813011350-752926059.jpg#th=hgcGDIIHmHd4iHeEeniHlHBhBw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT', '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=1260&h=946')
  WHERE content LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT%' AND content NOT LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT', '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=1260&h=946')
  WHERE content_en LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT%' AND content_en NOT LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT', '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=1260&h=946')
  WHERE content_ja LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT%' AND content_ja NOT LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT', '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=1260&h=946')
  WHERE content_ko LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT%' AND content_ko NOT LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT', '/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=1260&h=946')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784817031125-309466953.png#th=tucFDYJHFwaYiIhxiKh4cAey1gcT&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY', '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=1260&h=334')
  WHERE content LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY%' AND content NOT LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY', '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=1260&h=334')
  WHERE content_en LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY%' AND content_en NOT LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY', '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=1260&h=334')
  WHERE content_ja LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY%' AND content_ja NOT LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY', '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=1260&h=334')
  WHERE content_ko LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY%' AND content_ko NOT LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY', '/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=1260&h=334')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784817034005-226786899.png#th=ufcJEoI4GAeEiXiHCIaJAWY&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw', '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=1544&h=992')
  WHERE content LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw%' AND content NOT LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw', '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=1544&h=992')
  WHERE content_en LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw%' AND content_en NOT LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw', '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=1544&h=992')
  WHERE content_ja LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw', '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=1544&h=992')
  WHERE content_ko LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw', '/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=1544&h=992')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784860537871-888555279.jpg#th=hQcGBIBneEqKh4eQeXQHVeOcnw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA', '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA%' AND content NOT LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA', '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA%' AND content_en NOT LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA', '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA', '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA', '/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784860539598-869427383.webp#th=wwcCBICmdliJiIiAhnYHJsyfnA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw', '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw%' AND content NOT LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw', '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw%' AND content_en NOT LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw', '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw', '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw', '/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784860541222-292247630.webp#th=hAcCBICmdliKiIiAhna3UMmdrw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw', '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=1544&h=992')
  WHERE content LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw%' AND content NOT LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw', '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=1544&h=992')
  WHERE content_en LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw%' AND content_en NOT LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw', '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=1544&h=992')
  WHERE content_ja LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw', '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=1544&h=992')
  WHERE content_ko LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw', '/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=1544&h=992')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784860542848-605657426.jpg#th=hQcGBIBneDqKh4eQeXQGZOSsnw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg', '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg%' AND content NOT LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg', '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg%' AND content_en NOT LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg', '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg%' AND content_ja NOT LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg', '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg%' AND content_ko NOT LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg', '/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784865444080-850758908.webp#th=wwcCBIDGdliJiIiAhnYHJvyvzg&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw', '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw%' AND content NOT LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw', '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw%' AND content_en NOT LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw', '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw', '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw', '/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784865447216-570239058.webp#th=xAcCBIC3dliJiXiAhnUGFu2fnw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA', '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA%' AND content NOT LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA', '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA%' AND content_en NOT LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA', '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA%' AND content_ja NOT LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA', '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA%' AND content_ko NOT LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA', '/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784920366112-849143089.webp#th=hQcGBIAIxnl6dnh3iHf3c3qPmA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw', '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw%' AND content NOT LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw', '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw%' AND content_en NOT LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw', '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw%' AND content_ja NOT LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw', '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw%' AND content_ko NOT LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw', '/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1784920368607-442610017.webp#th=hQcGBIAHx3h3iHd2iHenc4-AZw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM', '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=1612&h=1177')
  WHERE content LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM%' AND content NOT LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM', '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=1612&h=1177')
  WHERE content_en LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM%' AND content_en NOT LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM', '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=1612&h=1177')
  WHERE content_ja LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM%' AND content_ja NOT LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM', '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=1612&h=1177')
  WHERE content_ko LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM%' AND content_ko NOT LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM', '/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=1612&h=1177')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1785486282102-400230502.png#th=xfcBBYCO_WdIk1l-lzl5igF9WTwM&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ', '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=1999&h=975')
  WHERE content LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ%' AND content NOT LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ', '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=1999&h=975')
  WHERE content_en LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ%' AND content_en NOT LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ', '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=1999&h=975')
  WHERE content_ja LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ%' AND content_ja NOT LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ', '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=1999&h=975')
  WHERE content_ko LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ%' AND content_ko NOT LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ', '/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=1999&h=975')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1785486286423-914732916.png#th=xfcBA4B9iImfiEioKPQLJbQ&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug', '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug%' AND content NOT LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug', '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug%' AND content_en NOT LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug', '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug%' AND content_ja NOT LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug', '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug%' AND content_ko NOT LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug', '/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1785486549371-632201987.webp#th=RAgCBIAIWLaKZoeDangJm4ZQug&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA', '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA%' AND content NOT LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA', '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA%' AND content_en NOT LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA', '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA%' AND content_ja NOT LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA', '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA%' AND content_ko NOT LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA', '/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA%' AND content_zh_cn NOT LIKE '%/uploads/2026/07/1785486552881-912573021.webp#th=xPcBBIC-d5ifeZh8iGp32EAFNA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ', '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=394&h=935')
  WHERE content LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ%' AND content NOT LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ', '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=394&h=935')
  WHERE content_en LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ%' AND content_en NOT LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ', '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=394&h=935')
  WHERE content_ja LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ%' AND content_ja NOT LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ', '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=394&h=935')
  WHERE content_ko LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ%' AND content_ko NOT LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ', '/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=394&h=935')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785723392705-85635547.png#th=SgcGCwAMhFmYiIdYiH_6SXQ&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk', '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=646&h=787')
  WHERE content LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk%' AND content NOT LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk', '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=646&h=787')
  WHERE content_en LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk%' AND content_en NOT LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk', '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=646&h=787')
  WHERE content_ja LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk%' AND content_ja NOT LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk', '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=646&h=787')
  WHERE content_ko LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk%' AND content_ko NOT LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk', '/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=646&h=787')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785723398445-356679043.png#th=SQcGBgBvQ3aId3d3iId4d3d31o_3nDk&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y', '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=395&h=552')
  WHERE content LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y%' AND content NOT LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y', '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=395&h=552')
  WHERE content_en LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y%' AND content_en NOT LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y', '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=395&h=552')
  WHERE content_ja LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y%' AND content_ja NOT LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y', '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=395&h=552')
  WHERE content_ko LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y%' AND content_ko NOT LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y', '/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=395&h=552')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785723404557-940773918.png#th=TwcGBQJvWJiIh3iXd3WXOPqP7J-Y&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw', '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=1142&h=724')
  WHERE content LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw%' AND content NOT LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw', '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=1142&h=724')
  WHERE content_en LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw%' AND content_en NOT LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw', '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=1142&h=724')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw', '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=1142&h=724')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw', '/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=1142&h=724')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835791237-188292879.png#th=ivcFDIIJTMeGeYmGeXb8esqvpw&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI', '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=1145&h=305')
  WHERE content LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI%' AND content NOT LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI', '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=1145&h=305')
  WHERE content_en LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI%' AND content_en NOT LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI', '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=1145&h=305')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI', '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=1145&h=305')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI', '/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=1145&h=305')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835800331-181477027.png#th=yfcBCoBLb7eEWZpn7j_3umI&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY', '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=651&h=183')
  WHERE content LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY%' AND content NOT LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY', '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=651&h=183')
  WHERE content_en LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY%' AND content_en NOT LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY', '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=651&h=183')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY', '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=651&h=183')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY', '/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=651&h=183')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835818113-894733130.png#th=TvcBAoCJaHaXaAeGJmnAkwY&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA', '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=2560&h=1392')
  WHERE content LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA%' AND content NOT LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA', '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=2560&h=1392')
  WHERE content_en LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA%' AND content_en NOT LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA', '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=2560&h=1392')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA', '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=2560&h=1392')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA', '/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=2560&h=1392')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835831599-310214880.png#th=S_cBBIAuDVp3eHdleIj1iXn8eA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY', '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=1789&h=869')
  WHERE content LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY%' AND content NOT LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY', '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=1789&h=869')
  WHERE content_en LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY%' AND content_en NOT LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY', '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=1789&h=869')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY', '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=1789&h=869')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY', '/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=1789&h=869')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835837638-265190399.png#th=TPcBA4AJhal4dwe4pnWPUCY&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g', '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=2560&h=1392')
  WHERE content LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g%' AND content NOT LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g', '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=2560&h=1392')
  WHERE content_en LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g%' AND content_en NOT LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g', '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=2560&h=1392')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g', '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=2560&h=1392')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g', '/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=2560&h=1392')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835844293-768423241.png#th=S_cBBIDKnah6iHaAaKSTT_lI2g&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY', '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=1213&h=133')
  WHERE content LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY%' AND content NOT LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY', '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=1213&h=133')
  WHERE content_en LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY%' AND content_en NOT LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY', '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=1213&h=133')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY', '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=1213&h=133')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY', '/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=1213&h=133')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835853024-770413466.png#th=TfcBAYCPqmWGlvhncHcCiGY&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs', '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=501&h=118')
  WHERE content LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs%' AND content NOT LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs', '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=501&h=118')
  WHERE content_en LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs%' AND content_en NOT LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs', '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=501&h=118')
  WHERE content_ja LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs%' AND content_ja NOT LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs', '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=501&h=118')
  WHERE content_ko LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs%' AND content_ko NOT LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs', '/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=501&h=118')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785835860768-117275861.png#th=jfcBCoDiFBmOSTUf0obATgs&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc', '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=704&h=85')
  WHERE content LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc%' AND content NOT LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc', '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=704&h=85')
  WHERE content_en LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc%' AND content_en NOT LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc', '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=704&h=85')
  WHERE content_ja LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc%' AND content_ja NOT LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc', '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=704&h=85')
  WHERE content_ko LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc%' AND content_ko NOT LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc', '/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=704&h=85')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785841620997-180022715.png#th=T_cFAYB_dXhqiKd3_YYLZTc&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4', '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=424&h=313')
  WHERE content LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4%' AND content NOT LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4', '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=424&h=313')
  WHERE content_en LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4%' AND content_en NOT LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4', '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=424&h=313')
  WHERE content_ja LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4%' AND content_ja NOT LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4', '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=424&h=313')
  WHERE content_ko LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4%' AND content_ko NOT LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4', '/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=424&h=313')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785841626496-165162709.png#th=yfcBDYLzU3aGpZethTeHZmd_g_U4&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc', '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=900&h=749')
  WHERE content LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc%' AND content NOT LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc', '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=900&h=749')
  WHERE content_en LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc%' AND content_en NOT LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc', '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=900&h=749')
  WHERE content_ja LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc%' AND content_ja NOT LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc', '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=900&h=749')
  WHERE content_ko LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc%' AND content_ko NOT LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc', '/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=900&h=749')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785841633499-792405236.png#th=jfcBBoC_lomKiHd4iIeHp4Z5EHYWYGc&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg', '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=900&h=749')
  WHERE content LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg%' AND content NOT LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg', '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=900&h=749')
  WHERE content_en LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg%' AND content_en NOT LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg', '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=900&h=749')
  WHERE content_ja LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg%' AND content_ja NOT LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg', '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=900&h=749')
  WHERE content_ko LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg%' AND content_ko NOT LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg', '/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=900&h=749')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785841640715-564459143.png#th=jPcBBoDfiHeNaIiLiJh3mHdqIIUFMkg&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x', '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=1536&h=1094')
  WHERE content LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x%' AND content NOT LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x', '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=1536&h=1094')
  WHERE content_en LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x%' AND content_en NOT LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x', '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=1536&h=1094')
  WHERE content_ja LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x%' AND content_ja NOT LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x', '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=1536&h=1094')
  WHERE content_ko LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x%' AND content_ko NOT LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x', '/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=1536&h=1094')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1785846636601-647315242.png#th=kPcBBYAwY6epmIitm4mJrO9E-w7x&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA', '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA%' AND content NOT LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA', '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA%' AND content_en NOT LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA', '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA%' AND content_ja NOT LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA', '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA%' AND content_ko NOT LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA', '/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1786012665844-932113702.webp#th=jRcGFII2eGZ4inaGdoC4j5QFqA&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w', '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w%' AND content NOT LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w', '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w%' AND content_en NOT LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w', '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w%' AND content_ja NOT LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w', '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w%' AND content_ko NOT LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w', '/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1786012667857-794850722.webp#th=x_cFBIAjv-CZiZiJh2qGan959w&w=%';

UPDATE posts SET content = REPLACE(content, '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw', '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=2000&h=1047')
  WHERE content LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw%' AND content NOT LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=%';
UPDATE posts SET content_en = REPLACE(content_en, '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw', '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=2000&h=1047')
  WHERE content_en LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw%' AND content_en NOT LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=%';
UPDATE posts SET content_ja = REPLACE(content_ja, '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw', '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=2000&h=1047')
  WHERE content_ja LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw%' AND content_ja NOT LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=%';
UPDATE posts SET content_ko = REPLACE(content_ko, '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw', '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=2000&h=1047')
  WHERE content_ko LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw%' AND content_ko NOT LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=%';
UPDATE posts SET content_zh_cn = REPLACE(content_zh_cn, '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw', '/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=2000&h=1047')
  WHERE content_zh_cn LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw%' AND content_zh_cn NOT LIKE '%/uploads/2026/08/1786012669825-665473631.webp#th=yQcKDIIIp5eHeId1ioQHiIGjBw&w=%';

