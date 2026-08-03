/**
 * 全站 HTML 的 Content-Security-Policy —— **這裡是唯一的來源**。
 *
 * 三個地方讀它，所以三邊不可能各自漂移：
 *
 *   1. `tests/e2e/stack.mjs` 的代理層（模擬 nginx）→ 165 條 e2e 會踩到違規
 *   2. `scripts/check-security-headers.ts` → 打正式站比對，CI 每次跑
 *   3. nginx `location /`（/etc/nginx/sites-available/koimsurai）→ 真正送出去的那份
 *
 * 第 3 點是手抄的（nginx 讀不到 JS）。抄錯不會沒人發現：第 2 點會紅。
 *
 * ## 為什麼 script-src 還留著 'unsafe-inline'
 *
 * 這一版**刻意不處理 inline script**，因為那件事牽動架構決策：
 *
 *   · 每頁有 5 個 inline script，其中 3 個是 TanStack SSR 產的（hydration payload、
 *     串流收尾、捲動還原），內容隨路由變動。
 *   · nonce 需要「每個回應都不同」，但 HTML 走 ISR 快取（blog/** 一小時），
 *     同一份 HTML 發給所有人 → nonce 也被共用一小時 → 攻擊者抓一次就知道，
 *     幾乎等於沒有。
 *   · hash 需要「內容固定」，跟快取相容，但要在 render 完之後才算得出來，
 *     而串流 SSR 的 header 先於 body 送出。
 *   · 真正乾淨的解是 islands（build 時算 hash、HTML 完全靜態），那是換架構。
 *
 * 所以先把**不需要那個決策、而且跟快取零衝突**的那幾條上掉。它們擋的是
 * base 標籤劫持、表單外送、外掛物件、點擊劫持與任意外連——這些跟 inline script
 * 是不同的攻擊面，不會因為 'unsafe-inline' 還在就失效。
 *
 * ## 外部來源怎麼來的
 *
 * 不是抄別人的模板，是拿 Playwright 掃正式站 15 個頁面收集實際請求的 origin
 * （2026-08-03）。加新的外部來源時請照同樣方式重掃，不要憑印象加。
 */

/**
 * 圖片：TMDb（影劇海報）、Spotify、YouTube 縮圖、巴哈（動畫封面）、Steam。
 *
 * ⚠ 後兩個**不是**掃正式站掃到的，是 e2e 的違規測試抓出來的：掃站當下那幾頁剛好
 *   沒有帶 GitHub 頭像的留言。OAuth 有 github 與 google 兩家（backend/handlers/oauth.rs），
 *   兩家的頭像都直接用原網址（`<img src={comment.avatar_url}>`，沒有走 image-proxy），
 *   所以兩個網域都要放行——只放 GitHub 的話，Google 登入者的頭像會變破圖，
 *   而那要等到真的有 Google 使用者留言才會被發現。
 */
const IMG = [
  'https://image.tmdb.org',
  'https://media.themoviedb.org',
  'https://i.scdn.co',
  'https://img.youtube.com',
  'https://p2.bahamut.com.tw',
  'https://cdn.cloudflare.steamstatic.com',
  'https://community.akamai.steamstatic.com',
  'https://shared.akamai.steamstatic.com',
  'https://avatars.githubusercontent.com',
  'https://lh3.googleusercontent.com',
];

/** 影片：Steam 商店頁的遊戲預告。 */
const MEDIA = ['https://shared.akamai.steamstatic.com'];

/** iframe：文章內嵌（MediaEmbed / LinkCard）與作品集。 */
const FRAME = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://player.bilibili.com',
];

const DIRECTIVES = {
  // 沒有列出的資源類型一律只能同源
  'default-src': ["'self'"],

  // ── 以下四條是這一版的重點：不需要 nonce/hash，跟 ISR 快取零衝突 ──
  // <base href> 被注入就能把所有相對路徑導去別的網域，而畫面上完全看不出來
  'base-uri': ["'none'"],
  // <object>/<embed>：老舊的 script 執行管道
  'object-src': ["'none'"],
  // 表單只能送回自己家——擋的是「把留言/訂閱表單的 action 改掉」這種資料外送
  'form-action': ["'self'"],
  // 點擊劫持。與既有的 X-Frame-Options: SAMEORIGIN 同義，但 frame-ancestors 才是現行標準
  'frame-ancestors': ["'self'"],

  // ── 暫時寬鬆的兩條（理由見檔頭）──
  //
  // 'unsafe-inline'：SSR 的 hydration payload 等 inline script，見檔頭。
  //
  // 'wasm-unsafe-eval'：shiki 的 oniguruma 正則引擎是 WebAssembly
  //   （assets/wasm-*.js，608 KB 的 base64 內嵌 wasm），沒有它程式碼區塊不會高亮。
  //   這條是**窄的**——只允許編譯 wasm，不允許 JS 的 eval。它會一直留著。
  //
  // ✅ `'unsafe-eval'` 已經拿掉了。它原本是給 MDX 用的：server 編譯成 JS 字串、
  //    前端 `runSync`（底層 `new Function`）執行成元件。現在改成 server 產序列化的
  //    hast 樹、前端用 `hast-util-to-jsx-runtime` 走訪，沒有任何字串轉程式碼。
  //    代價是 MDX 只能「叫元件、餵資料」——界線由 `@koimsurai/mdx-core` 的
  //    `literalValue` 執行，並在發布前由 `validate_mdx` 與 `check:mdx` 擋下。
  //    ⚠ 要加回去之前請先確認是誰在 eval：那多半代表有東西在執行期編譯字串。
  'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
  // React 的 inline style 屬性每頁 26~81 個，拿掉 'unsafe-inline' 等於整站樣式崩掉。
  // 風險等級遠低於 script-src。
  'style-src': ["'self'", "'unsafe-inline'"],

  'img-src': ["'self'", 'data:', 'blob:', ...IMG],
  'media-src': ["'self'", 'blob:', ...MEDIA],
  'frame-src': FRAME,
  // 字體全部自帶（@fontsource-variable），data: 給 inline 的圖示字體留活口
  'font-src': ["'self'", 'data:'],
  // API 與 vitals 上報都是同源（nginx 把 /api 併到同一個 origin）。
  //
  // ⚠ Steam 的遊戲預告片要**同時**放進 media-src 與 connect-src。掃正式站時抓到的：
  //   `/activity` 上那支 .mp4 是被 fetch 抓的（不是 <video src> 直接載），
  //   而 fetch 走的是 connect-src。只放 media-src 的話影片不會播，
  //   畫面上就是一格空的播放器——不會報錯，只有 console 有一行違規。
  'connect-src': ["'self'", ...MEDIA],
  // 星空背景用 Worker；bundler 產的 worker 走 blob:
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
};

/** 送進 header 的字串（單行，directive 之間用 `; ` 分隔）。 */
export const CSP_POLICY = Object.entries(DIRECTIVES)
  .map(([k, v]) => `${k} ${v.join(' ')}`)
  .join('; ');

/** nginx 設定用的多行版本，方便人讀。用 `node scripts/csp.mjs` 印出來。 */
export function nginxLine() {
  return `add_header Content-Security-Policy "${CSP_POLICY}" always;`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(nginxLine());
}
