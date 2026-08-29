/**
 * 生產站安全標頭巡檢。
 *
 * ## 為什麼是「打線上」而不是 e2e 斷言
 *
 * 這些標頭是 **nginx** 加的，不是應用程式加的。而 e2e（tests/e2e/stack.mjs）起的是
 * nitro + backend + 一個很小的反向代理，裡面根本沒有 nginx。在那裡斷言標頭只會驗到
 * 我自己寫的假代理，不是線上真正在跑的設定——那種測試綠了也不代表什麼。
 *
 * 所以這支直接打 https://koimsurai.com。它在排程的 content job 裡跑（每天一次），
 * 不擋 PR：nginx 設定不在這個 repo 裡，PR 改不到它，拿它擋 PR 只會製造無關的紅燈。
 *
 * ## 它在防什麼
 *
 * nginx 的 `add_header` 繼承規則是「子層一旦有任何一條，父層的就**全部**不繼承」。
 * 這個坑實際踩過：/uploads/ 與 /nas-images/ 為了設 Cache-Control 而加了 add_header，
 * 只記得補回 nosniff，於是 HSTS / X-Frame-Options / Referrer-Policy 三條在那兩條
 * 路徑上靜靜地不見了（2026-07-31 實測確認）。這種缺失不會有任何症狀，
 * 沒有東西在看就永遠不會被發現。
 *
 * 用法：
 *   pnpm check:headers                       # 預設打正式站
 *   BASE_URL=https://example.com pnpm check:headers
 */

import { CSP_POLICY, SECURITY_HEADERS } from './csp.mjs';

interface Rule {
  /** 要打的路徑 */
  path: string;
  /** 給人看的說明 */
  label: string;
  /** 這條路徑必須要有的標頭；值為 undefined 代表「有就好，不檢查內容」 */
  required: Record<string, string | undefined>;
  /** 預期的 HTTP 狀態。省略＝必須是 2xx。 */
  expectStatus?: number;
}

const BASE = process.env.BASE_URL ?? 'https://koimsurai.com';

/**
 * 全站都該有的四條。內容也一起比對——只檢查「有沒有」的話，值被改壞看不出來。
 *
 * 定義在 `csp.mjs`（與 CSP 同一個單一來源），因為 `tests/e2e/stack.mjs` 的代理層
 * 也要用同一份：兩邊各寫一份的話，測試環境會悄悄地比正式站寬鬆。
 */
const BASELINE: Record<string, string | undefined> = SECURITY_HEADERS;

/** 靜態檔那兩條 location 額外要有 CSP——原因見 nginx 設定裡的註解（SVG 直接開啟會執行 script）。 */
const STATIC_FILE = { ...BASELINE, 'content-security-policy': "default-src 'none'" };

/**
 * HTML 頁面額外要有 CSP（只加在 nginx 的 `location /`，不在 /assets/ 或 /api/）。
 *
 * ⚠ 值直接跟 `scripts/csp.mjs` 逐字比對，因為 nginx 那份是**手抄**的（nginx 讀不到 JS）。
 *   抄漏一個網域的症狀是某類圖片變破圖，抄錯一條 directive 則可能整個功能消失，
 *   兩者都不會有錯誤訊息。這條斷言就是那份手抄的守門——e2e 驗的是「政策不擋自家東西」，
 *   這裡驗的是「線上送出去的真的是那份政策」。
 */
const HTML_PAGE = { ...BASELINE, 'content-security-policy': CSP_POLICY };

const RULES: Rule[] = [
  { path: '/', label: '首頁（location /）', required: HTML_PAGE },
  { path: '/blog', label: '文章列表', required: HTML_PAGE },
  { path: '/api/health', label: '後端 API（location /api/）', required: BASELINE },
  {
    path: '/assets/../favicon.ico',
    label: '靜態資源（location /assets/，靠繼承）',
    required: BASELINE,
  },

  // 這兩條刻意打**不存在的檔**，回 404。
  //
  // 為什麼不打真檔：/uploads/ 底下的 56 個檔沒有穩定的公開連結可以推導——文章內文與
  // 相簿 manifest 都撈不到，硬寫死一個檔名則會在檔案被刪掉的那天變成假紅。
  //
  // 為什麼 404 是有效的樣本：這些 add_header 都帶 `always`，意思就是「錯誤回應也要送」。
  // 實測 404 與真檔 200 的標頭集合完全一致，所以 404 探針量到的就是真檔會拿到的。
  {
    path: '/uploads/__probe_does_not_exist__.webp',
    label: '上傳檔案（location /uploads/，404 探針）',
    required: STATIC_FILE,
    expectStatus: 404,
  },
  {
    path: '/nas-images/__probe_does_not_exist__.webp',
    label: '相簿圖片（location /nas-images/，404 探針）',
    required: STATIC_FILE,
    expectStatus: 404,
  },
];

interface Failure {
  label: string;
  path: string;
  detail: string;
}

async function checkRule(rule: Rule): Promise<Failure[]> {
  const url = `${BASE}${rule.path}`;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    return [{ label: rule.label, path: rule.path, detail: `請求失敗：${(e as Error).message}` }];
  }

  const statusOk =
    rule.expectStatus === undefined ? res.status >= 200 && res.status < 300 : res.status === rule.expectStatus;
  if (!statusOk) {
    const want = rule.expectStatus ?? '2xx';
    return [{ label: rule.label, path: rule.path, detail: `預期 ${want}，實際 ${res.status}（無法據此判斷標頭）` }];
  }

  const out: Failure[] = [];
  for (const [name, expected] of Object.entries(rule.required)) {
    const got = res.headers.get(name);
    if (got === null) {
      out.push({ label: rule.label, path: rule.path, detail: `缺少 ${name}` });
    } else if (expected !== undefined && got !== expected) {
      out.push({
        label: rule.label,
        path: rule.path,
        detail: `${name} 值不符\n      預期: ${expected}\n      實際: ${got}`,
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`巡檢 ${BASE}，共 ${RULES.length} 條路徑\n`);

  const failures: Failure[] = [];
  for (const rule of RULES) {
    const bad = await checkRule(rule);
    console.log(`  ${bad.length === 0 ? '✓' : '✗'} ${rule.label}  ${rule.path}`);
    failures.push(...bad);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} 項不符：\n`);
    for (const f of failures) {
      console.error(`  ${f.label}  ${f.path}\n    ${f.detail}`);
    }
    console.error(
      '\n可能的原因：' +
        '\n  1. 該 location 裡有 add_header 但沒 include snippet——nginx 的繼承規則是' +
        '\n     「子層有任何一條 add_header，父層就全部不繼承」，不是逐條合併。' +
        '\n     檢查有沒有 include /etc/nginx/snippets/koimsurai-security.conf。' +
        '\n  2. add_header 少了 `always`——那樣 4xx/5xx 不會帶標頭，上面的 404 探針會紅' +
        '\n     而真檔正常。真檔正常不代表沒問題：錯誤頁一樣需要這些標頭。',
    );
    process.exit(1);
  }

  console.log('\n全部通過。');
}

await main();
