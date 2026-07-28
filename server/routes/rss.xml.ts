import { defineEventHandler, getQuery, sendRedirect } from 'nitro/h3';

// /rss.xml → 301 /rss。
//
// 站上原本就有 /rss（後端 handlers/rss.rs，nginx `location = /rss` 指過去），Google 從 2026-05
// 就在抓它。我一度只探了 /rss.xml、/feed.xml、/atom.xml、/feed 四個路徑就誤判「站上沒有 feed」，
// 因此多做了一份——兩份內容重疊的 feed 會分散訂閱者、也讓搜尋引擎看到重複內容。
// 收斂回既有的正規網址；這支只留 301，讓短暫期間抓到 /rss.xml 的閱讀器自動跟過去。
export default defineEventHandler((event) => {
  const lang = getQuery(event).lang;
  const target = typeof lang === 'string' && lang ? `/rss?lang=${encodeURIComponent(lang)}` : '/rss';
  return sendRedirect(event, target, 301);
});
