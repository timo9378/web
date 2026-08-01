-- Simkl 同步一開始會把自家 CDN 的海報寫進 poster_url，那擋掉了 films_recent /
-- tv_recent 的 TMDb 補圖（那段的條件是「poster_url 是空的」），而補圖除了 w342 海報
-- 還會補 original 的橫式 backdrop。結果 backdrop 永遠是 NULL，「在看什麼」的橫幅 hero
-- 只好拿直式海報拉寬——Simkl 給的是 `_m` 中等尺寸，拉寬就糊了。
--
-- 寫入端已經改成「有 tmdb_id 就不寫海報」（handlers/simkl.rs 的 poster_for），這裡把
-- 已經寫進去的那些清掉，讓它們下次被讀到時走同一條補圖路徑。
--
-- 條件刻意收得很緊：只動 source='simkl'、URL 確實是 simkl.in、而且有 tmdb_id 可以補的列。
-- 沒有 tmdb_id 的留著 Simkl 的圖——那種情況 TMDb 補不了，有圖總比沒有好。

UPDATE film_history
   SET poster_url = NULL
 WHERE source = 'simkl'
   AND tmdb_id IS NOT NULL
   AND poster_url LIKE '%simkl.in%';

UPDATE tv_history
   SET poster_url = NULL
 WHERE source = 'simkl'
   AND tmdb_id IS NOT NULL
   AND poster_url LIKE '%simkl.in%';
