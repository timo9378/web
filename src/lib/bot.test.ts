import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './bot';

// 這個判斷有兩個都會安靜出錯的方向，所以兩邊都要測：
//   - 漏判（爬蟲被當成人）→ Web Vitals 收進爬蟲的數字，污染 p75；且 Googlebot 的
//     POST /api/vitals 會在 GSC 變成一筆「其他錯誤」。
//   - 誤判（真人被當成爬蟲）→ 那個人的 Vitals 全部被丟掉，而且語系導向不會生效。
//     誤判特別危險，因為線上完全看不出來——只會覺得「怎麼資料變少」。

const REAL_BROWSERS = [
  // 桌機
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  // 手機（站上的主要流量）
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
];

const BOTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'TelegramBot (like TwitterBot)',
  'WhatsApp/2.23.20.0 A',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome-Lighthouse',
];

describe('isBotUserAgent', () => {
  it('認得出常見爬蟲與預覽抓取器', () => {
    for (const ua of BOTS) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('真人的瀏覽器一個都不能被誤判', () => {
    for (const ua of REAL_BROWSERS) expect(isBotUserAgent(ua), ua).toBe(false);
  });

  it('沒有 UA 一律當成不是爬蟲（寧可收進來，也不要靜靜丟掉真實資料）', () => {
    expect(isBotUserAgent(undefined)).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
    expect(isBotUserAgent('')).toBe(false);
  });

  it('大小寫不影響判斷', () => {
    expect(isBotUserAgent('GOOGLEBOT/2.1')).toBe(true);
    expect(isBotUserAgent('googlebot/2.1')).toBe(true);
  });
});
