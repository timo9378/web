/**
 * 計算後樣式的回歸守門。
 *
 * ## 為什麼不是截圖比對
 *
 * 截圖比對在這個專案測不準。實測噪音底線（同一份 build 跑兩次）：
 *   /blog/43   7810 px   ← mermaid 渲染時序
 *   /history    228 px
 * 而 /music 的專輯圖來自 Spotify CDN，根本固定不了。真正的 CSS 變化會被這些淹掉，
 * 設成門檻只會製造假紅——跟 lighthouserc.cjs 拒絕拿 performance 分數當門檻同一個理由。
 *
 * `getComputedStyle` 沒有這個問題：它是 cascade 的最終結果，跟圖片載到第幾張無關。
 *
 * ## 基準檔為什麼存 hash 而不是原值
 *
 * 8560 個元素 × 34 個屬性直接存是好幾 MB，每次改樣式都會產生巨大 diff。
 * 存 hash 之後基準檔只有幾十 KB，而「哪個元素變了」照樣指得出來——
 * 要知道「變成什麼」再跑一次本機比對即可。
 *
 * ## 動畫屬性為什麼排除
 *
 * transform / opacity / box-shadow / filter 在有動畫的元素上每一幀都不同，
 * 收進來就變成隨機紅。這幾個屬性的回歸靠人眼與 Lighthouse，不靠這支。
 *
 * ## 更新基準
 *
 *   UPDATE_STYLE_BASELINE=1 pnpm exec playwright test computed-style
 *
 * 改了樣式就要更新，並在 PR 裡說明「為什麼這些元素該變」。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

// 專案是 ESM（package.json 的 "type": "module"），沒有 __dirname。
//
// 一頁一個基準檔，不是全部塞一個 json：playwright 預設多 worker 平行跑，
// 共用一個檔案的話 afterAll 會互相覆蓋（第一版就是這樣，靠運氣才對）。
// 順帶的好處是改樣式時 diff 只會動到真正受影響的那幾頁。
const BASELINE_DIR = path.join(import.meta.dirname, 'computed-style.baseline');
const fileFor = (route: string) => path.join(BASELINE_DIR, `${route.replace(/\//g, '_') || '_root'}.json`);
const UPDATE = process.env.UPDATE_STYLE_BASELINE === '1';

const ROUTES = [
  '/', '/about', '/blog', '/photos', '/setup',
  '/history', '/friends', '/bookshelf', '/watch', '/messages', '/about-site',
];

/** 會被 !important / cascade 影響、且不隨動畫逐幀改變的屬性 */
const PROPS = [
  'background-color', 'background-image', 'color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-radius', 'outline-color', 'outline-width', 'outline-style',
  'display', 'visibility', 'font-family', 'font-size', 'font-weight', 'line-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'text-decoration-line', 'text-align', 'flex-direction', 'justify-content', 'align-items',
];

/**
 * 排除隨機產生的裝飾背景。
 *
 * RandomComets / RandomShootingStars / RandomUFOs 產生的元素**數量本身是隨機的**，
 * 所以 DOM 路徑每次載入都不一樣——收進來的話首頁每跑必紅（實測 700 個元素）。
 * 這份清單跟 index.css 裡 `html.fs-active` 那條隱藏規則的對象一致。
 */
const DECORATIVE = [
  '.css-starfield', '.nebula-bg', '.nebula-dust', '.nebula-dim-overlay',
  '.foreground-stars-container', '.comet', '.shooting-star', '.ufo',
  '.cursor-trail-canvas', '.intro-overlay', '.starfield-gpu',
];

/**
 * 等 DOM 不再變動。
 *
 * `networkidle` + 固定 sleep 不夠：首頁的 Hero 有 JS 打字機（useTypingEffect，
 * 延遲 900ms 開始、每字 80ms），而**CSS 的 `animation:none` 停不掉 setInterval**。
 * 早收的話會抓到打到一半的 DOM，元素路徑跟著位移——實測首頁因此間歇性報 34~688
 * 個「變化」，而那是純粹的假紅。
 *
 * 用「連續 N 次快照相同」而不是固定等待：慢的機器等久一點，快的機器不用白等。
 */
async function waitForDomStable(page: Page, { stableFor = 3, interval = 250, timeout = 15000 } = {}) {
  const started = Date.now();
  let last = '';
  let stable = 0;
  while (Date.now() - started < timeout) {
    const now = await page.evaluate(() => `${document.body.innerHTML.length}:${document.querySelectorAll('body *').length}`);
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= stableFor) return;
    await page.waitForTimeout(interval);
  }
}

async function collect(page: Page): Promise<Record<string, string>> {
  return page.evaluate(({ props, skip }) => {
    const out: Record<string, string> = {};
    const pathOf = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 12; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.tagName}:${i}`);
      }
      return parts.join('>');
    };
    const skipSel = skip.join(',');
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest(skipSel)) continue;
      const cs = getComputedStyle(el);
      out[pathOf(el)] = props.map((p) => cs.getPropertyValue(p)).join('|');
    }
    return out;
  }, { props: PROPS, skip: DECORATIVE });
}

/**
 * 純十進位的 hash。
 *
 * ⚠ 不要改回 base64url 或 hex。那兩種編碼會在基準檔裡湊出看起來像英文單字的片段，
 * 而 `typos` 掃整個 repo（含這些 json），會把它們判成拼錯讓 Backend job 變紅——實際
 * 發生過。加白名單可以解決，但那等於為了一個純機械產物去放寬錯字檢查。
 * 十進位數字結構上就撞不到任何字母。
 */
const hash = (s: string) => BigInt(`0x${createHash('sha1').update(s).digest('hex').slice(0, 16)}`).toString();

test.describe('計算後樣式沒有非預期的變化', () => {
  for (const route of ROUTES) {
    test(`${route} 的計算後樣式與基準一致`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      // 動畫關掉：不關的話 transition 中途的值會混進來
      await page.addStyleTag({
        content: '*,*::before,*::after{transition:none!important;animation:none!important}',
      });
      await waitForDomStable(page);

      const raw = await collect(page);
      const hashed: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) hashed[k] = hash(v);

      const file = fileFor(route);
      if (UPDATE) {
        fs.mkdirSync(BASELINE_DIR, { recursive: true });
        // 排序後輸出：元素順序不影響語意，但排過的檔案 diff 才讀得懂
        const sorted = Object.fromEntries(Object.entries(hashed).sort(([a], [b]) => a.localeCompare(b)));
        fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
        return;
      }

      expect(fs.existsSync(file), `${route} 沒有基準檔——新增頁面要先跑一次更新`).toBe(true);
      const want = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;

      const changed: string[] = [];
      for (const k of new Set([...Object.keys(want), ...Object.keys(hashed)])) {
        if (want[k] !== hashed[k]) changed.push(k);
      }
      expect(
        changed.slice(0, 20),
        `${route}：${changed.length} 個元素的計算後樣式變了。若是預期中的改動：\n` +
          `  UPDATE_STYLE_BASELINE=1 pnpm exec playwright test computed-style\n` +
          `並在 PR 說明為什麼這些元素該變。`,
      ).toEqual([]);
    });
  }
});
