// 前端 Core Web Vitals 上報（ROADMAP B4）。
//
// 哲學：量測用 Google 官方 `web-vitals` lib（CWV 的業界標準實作、不可避免），
// 但**資料送自己的 Rust 端點、存自己的 SQLite**——用它的尺、不進它的家（不碰 GA4）。
// 聚合自看：GET /api/vitals/stats。
//
// 不送任何 PII：只有 metric 名/值/rating/pathname/是否行動裝置。
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';

import { isBotUserAgent } from './bot';

function send(m: Metric) {
  const body = JSON.stringify({
    metric: m.name,
    value: m.value,
    rating: m.rating,
    path: window.location.pathname,
    isMobile: window.matchMedia('(max-width: 768px)').matches,
  });
  // sendBeacon：頁面卸載期也保證送達（LCP/CLS 在 pagehide 才定稿）。
  // Blob 帶 content-type 讓 axum 的 Json extractor 收得進。
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.('/api/vitals', blob)) {
    void fetch('/api/vitals', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => { /* 量測丟失無妨，不干擾使用者 */ });
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
  onCLS(send);
  onINP(send);
  onLCP(send);
  onFCP(send);
  onTTFB(send);
}
