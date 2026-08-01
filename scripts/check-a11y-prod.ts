/**
 * 正式站的無障礙巡檢（每天一次，不擋 PR）。
 *
 * ## 為什麼需要「另一份」a11y 檢查
 *
 * tests/e2e 已經有一道 moderate 門檻了，但它跑在 e2e stack 上，而那個環境
 * **沒有任何第三方金鑰**。沒金鑰時 Steam / WakaTime / GitHub 那些區塊整段不 render，
 * 於是它們裡面的標題、圖片、對比通通不在 DOM 裡——本機測試看不見的東西當然守不住。
 *
 * 實際發生過：`/activity` 在本機是乾淨的，部署後對正式站一掃就報 heading-order，
 * 因為 `<h2 class="steam-profile-name">` 只有在真的抓得到 Steam 資料時才出現。
 * 同一頁在兩個環境是兩份不同的 DOM，這不是測試寫得不夠好，是環境本質的差異。
 *
 * 內容也是同理：文章存在 DB 裡不在 repo 裡，某篇文章的表格少個表頭、某張圖沒有 alt，
 * PR 一次都不會碰到。
 *
 * ## 判準
 *
 * 只擋 **moderate 以上**，跟 e2e 那道門一致。`minor` 多半是單篇文章的內容問題
 * （例如 empty-table-header），擋在這裡只會逼人去改舊文章，而那不是 CI 該做的事。
 *
 * 已知且無解的例外走 KNOWN 白名單，每一條都要寫理由——沒有理由的白名單過幾個月
 * 就沒有人記得為什麼在那裡，等於永久靜音。
 */

import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser } from '@playwright/test';

const BASE = process.env.A11Y_BASE_URL ?? 'https://koimsurai.com';

/** 巡檢的頁面。挑的是「有實際資料才看得出差異」的那些，而不是全部。 */
const PAGES = [
  '/',
  '/blog',
  '/thinking',
  '/bookshelf',
  '/watch',
  '/activity', // 第三方資料只有正式站才有 → 這頁是這支腳本存在的主因
  '/setup',
  '/portfolio',
  '/music',
  '/about-site',
  '/photos',
];

/**
 * 已知例外。key 是頁面路徑，值是允許的 rule id。
 *
 * `/photos`：masonic 的 `<Masonry>` 直接輸出 role="grid" > role="gridcell"，
 * 中間少了 ARIA 要求的 role="row"，而它沒有開放覆寫 role 的 prop。
 * 要修只有 fork masonic 或換掉瀑布流套件兩條路。與 tests/e2e/smoke.spec.ts 的
 * A11Y_KNOWN 是同一筆，改的時候兩邊要一起改。
 */
const KNOWN: Record<string, string[]> = {
  '/photos': ['aria-required-children', 'aria-required-parent'],
};

interface Finding {
  page: string;
  impact: string;
  id: string;
  count: number;
  sample: string;
}

async function scan(browser: Browser, path: string): Promise<Finding[]> {
  // 每頁一個獨立 context，不是 `browser.newPage()`。兩個理由：
  //   1. @axe-core/playwright 明確要求 context（newPage 會直接拋 Error）
  //   2. 獨立 context 才是「首次造訪」——共用 profile 會帶著上一頁的快取與
  //      localStorage，量到的是回訪者看到的畫面而不是新訪客的
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || resp.status() >= 400) {
      throw new Error(`${path} 回 ${resp?.status() ?? '無回應'}`);
    }
    // 第三方區塊是 client 端非同步抓的——不等它就會掃到「還沒 render」的版本，
    // 而那正好是本機環境的樣子，等於白掃。
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
      /* 有輪詢的頁面永遠不會 idle，等到上限就好 */
    });
    const { violations } = await new AxeBuilder({ page }).analyze();
    const allowed = KNOWN[path] ?? [];
    return violations
      .filter((v) => v.impact !== 'minor' && !allowed.includes(v.id))
      .map((v) => ({
        page: path,
        impact: v.impact ?? '?',
        id: v.id,
        count: v.nodes.length,
        sample: (v.nodes[0]?.html ?? '').replace(/\s+/g, ' ').slice(0, 110),
      }));
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
let findings: Finding[] = [];
try {
  for (const path of PAGES) {
    const found = await scan(browser, path);
    const mark = found.length === 0 ? '✓' : '✗';
    console.log(`${mark} ${path.padEnd(14)} ${found.map((f) => `${f.impact}:${f.id}`).join(', ') || '乾淨'}`);
    findings = findings.concat(found);
  }
} finally {
  await browser.close();
}

if (findings.length > 0) {
  console.error(`\n正式站有 ${findings.length} 項 moderate 以上的無障礙問題：\n`);
  for (const f of findings) {
    console.error(`  ${f.page}  ${f.impact}:${f.id}（${f.count} 處）`);
    console.error(`      ${f.sample}`);
  }
  console.error('\n（只有正式站看得到的，多半是「有真實資料才會 render」的區塊——');
  console.error('  本機的 e2e 環境沒有第三方金鑰，那些區塊整段不存在。）');
  process.exit(1);
}
console.log('\n正式站無障礙巡檢通過（moderate 以上零違規）。');
