// 前端 Core Web Vitals 上報（ROADMAP B4）。
//
// 哲學：量測用 Google 官方 `web-vitals` lib（CWV 的業界標準實作、不可避免），
// 但**資料送自己的 Rust 端點、存自己的 SQLite**——用它的尺、不進它的家（不碰 GA4）。
// 聚合自看：GET /api/vitals/stats。
//
// 不送任何 PII：只有 metric 名/值/rating/pathname/是否行動裝置。
import { onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';
// CLS 單獨從 attribution build 取：它多回一個 largestShiftTarget（那次最大位移元素的 CSS
// 選擇器）。這是唯一能回答「到底是哪個元素在動」的東西——CLS 只在實地出現（同一頁在無節流
// 的本機跑 Lighthouse 是 CLS 0），所以只能靠真實讀者的瀏覽器指認。
// 其餘四個 metric 仍走精簡版，不必為它們付 attribution 的 bundle 成本。
import { onCLS, type CLSMetricWithAttribution } from 'web-vitals/attribution';

import { isBotUserAgent } from './bot';

/* ── 最大位移發生在哪一頁 ──
 *
 * `send()` 讀的 pathname 是「回報當下」的，而 CLS 在 SPA 裡累加整個 page lifecycle、
 * 要到 pagehide 才定稿。實測過：在 /blog 列表產生 0.0326 的位移（側欄某段高度 229→0px），
 * 讀者接著點進文章再離開，那筆 CLS 就記在文章頁上。
 * → 資料表裡的 `path` 其實是「讀者最後停在哪」，不是「位移發生在哪」。
 *
 * 這一欄補上真正的位置。不改 CLS 本身的算法（要跟 CrUX 可比就得照樣累加整個 lifecycle），
 * 只是多帶一個診斷欄位。 */
let largestShift = { value: 0, path: '' };

function trackShiftPath() {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (e.hadRecentInput) continue;
        if (e.value > largestShift.value) largestShift = { value: e.value, path: location.pathname };
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* 不支援 layout-shift 就少一個診斷欄位，不影響上報 */
  }
}

function send(m: Metric, attr?: { target?: string; loadState?: string; shiftPath?: string }) {
  const path = window.location.pathname;
  // 後台不上報：/admin 有 auth、robots.txt 也 Disallow，不是讀者體驗的一部分；而編輯器
  // （大量 textarea + 即時預覽 + 非同步載入的清單）天生就會位移，混進來會蓋掉文章頁的真實
  // 數字——實測 /admin/posts 的 CLS p75=0.173、93% 超標，一個人在編輯就足以主導全站 p75。
  //
  // 擋在 send() 而不是 initWebVitals()：這是 SPA，init 整個 session 只跑一次，但每個 metric
  // 是在自己定稿時機才讀當下的 pathname。擋在 init 的話，從首頁進站再切到後台照樣會上報；
  // 反過來從後台進站再去看文章，連文章的數字都會一起丟掉。
  if (path === '/admin' || path.startsWith('/admin/')) return;
  const body = JSON.stringify({
    metric: m.name,
    value: m.value,
    rating: m.rating,
    path,
    isMobile: window.matchMedia('(max-width: 768px)').matches,
    ...attr,
  });
  // sendBeacon：頁面卸載期也保證送達（LCP/CLS 在 pagehide 才定稿）。
  // Blob 帶 content-type 讓 axum 的 Json extractor 收得進。
  const blob = new Blob([body], { type: 'application/json' });
  // sendBeacon 全瀏覽器都有，?. 是死碼；但回傳 false（佇列滿/payload 過大）要退 fetch，! 保留。
  if (!navigator.sendBeacon('/api/vitals', blob)) {
    void fetch('/api/vitals', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {
      /* 量測丟失無妨，不干擾使用者 */
    });
  }
}

let initialized = false;

/** client-only、每頁面生命週期一次。各 metric 由 web-vitals 在定稿時機自行回呼。 */
export function initWebVitals() {
  if (initialized) return;
  // 爬蟲不上報：它的渲染環境沒有真實使用者互動、又常跑在受限機器上，測出來的數字會污染 p75。
  // 另外 Googlebot 渲染時對 /api/vitals 發的 POST 會在 GSC 網址審查裡變成一筆「其他錯誤」。
  if (isBotUserAgent(navigator.userAgent)) return;
  initialized = true;
  trackShiftPath();
  onCLS((m: CLSMetricWithAttribution) => {
    const a = m.attribution;
    send(m, {
      target: a.largestShiftTarget,
      loadState: a.loadState,
      // 空字串（沒有任何位移）不送，讓後端存 NULL 而不是 ''
      shiftPath: largestShift.path || undefined,
    });
  });
  onINP(send);
  onLCP(send);
  onFCP(send);
  onTTFB(send);
}
