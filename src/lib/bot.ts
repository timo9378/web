// 粗略 bot 偵測。純資料 + 純函式，沒有任何相依，所以 SSR、client、Nitro route 都能用。
//
// 兩個用途：
//   1. 語系導向：爬蟲不自動導向，讓它看到預設 zh-TW + 靠 hreflang 索引各語言，避免只索引到一種。
//   2. Web Vitals：爬蟲的渲染環境（無真實使用者互動、常跑在受限的機器上）測出來的數字不是
//      真實體驗，收進來只會污染 p75；而且 Googlebot 渲染時對 /api/vitals 發 POST，會在 GSC
//      的網址審查裡變成一筆「其他錯誤」。
const BOT_UA_RE =
  /bot|crawl|spider|slurp|bing|google|baidu|yandex|duckduck|facebookexternalhit|embedly|quora|whatsapp|telegram|discord|slack|lighthouse|headless|preview/i;

export function isBotUserAgent(ua: string | undefined | null): boolean {
  return !!ua && BOT_UA_RE.test(ua);
}
