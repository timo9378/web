// E2E 用的完整 stack：真的後端 binary + 真的 nitro server + 一層 /api 反向代理。
//
// 為什麼需要代理這一層：生產環境是 **nginx** 在分流（`/api` → 後端、其餘 → nitro），
// 專案裡沒有任何地方複製那個行為——vite 沒設 proxy，nitro 只有 server/routes/ 那幾支。
// 而前端取 API 位址有兩種寫法（`apiUrl()` 回相對 `/api`、部分元件讀 VITE_API_URL），
// 只有「真的把兩個 server 併在同一個 origin 下」才能兩種都照生產的樣子跑到。
//
// 起法：後端（跑 migrations、建空 DB）→ 等 health → 灌種子資料 → nitro → 代理。
// Playwright 的 webServer 指向代理的 /api/health。
//
// 用法：node tests/e2e/stack.mjs        （前景，Ctrl-C 收掉全部）

import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.mjs';
import { CSP_POLICY, SECURITY_HEADERS } from '../../scripts/csp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PORTS = {
  proxy: Number(process.env.E2E_PORT ?? 13996),
  nitro: Number(process.env.E2E_NITRO_PORT ?? 13997),
  backend: Number(process.env.E2E_BACKEND_PORT ?? 13999),
};
const DB_PATH = process.env.E2E_DB ?? '/tmp/koimsurai-e2e.db';
/** 後端與 nitro 都要拿到同一組，`/_revalidate` 才會放行（沒設 = 那支回 404）。 */
const REVALIDATE_SECRET = 'e2e-revalidate-secret';

// backend 是 workspace member（根目錄的 Cargo.toml 是 [workspace] members = ["backend"]），
// 所以產物在 web/target/ 而不是 web/backend/target/。debug 優先——CI 就是建那個。
function findBackendBin() {
  if (process.env.E2E_BACKEND_BIN) return process.env.E2E_BACKEND_BIN;
  const candidates = ['target/debug', 'target/release'].map((d) => path.join(ROOT, d, 'koimsurai-web-backend'));
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
const BACKEND_BIN = findBackendBin();

const children = [];

function run(name, cmd, args, env) {
  const c = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' });
  children.push(c);
  // 子行程的輸出加前綴轉出來：測試掛掉時看得到是哪一邊的問題
  for (const stream of [c.stdout, c.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      for (const line of d.split('\n')) if (line.trim()) console.log(`[${name}] ${line}`);
    });
  }
  c.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] 意外結束 code=${code}`);
      shutdown(1);
    }
  });
  return c;
}

async function waitFor(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      /* 還沒起來 */
    }
    if (Date.now() > deadline) throw new Error(`${label} 在 ${timeoutMs}ms 內沒起來（${url}）`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// 1×1 透明 PNG。相簿的 fixture 指到 /nas-images/*，那些檔在生產是 nginx 從 NAS 送的；
// 測試環境沒有它們，不補的話每張圖都 404，會把「console 不該有錯誤」這條斷言變成雜訊。
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * 依檔名裡的 `-<寬>x<高>` 造一張該尺寸的 PNG，給 `/uploads/` 的假圖用。
 *
 * ⚠ 為什麼不能沿用上面那張 1×1：這個 stub 存在的目的是讓 CLS 測試碰得到
 * 「圖片沒有預留版面就會塌掉」那條路徑。1×1 的圖載入後只撐開 1px，位移小到量不出來，
 * 測試會**安靜地通過**——而那正是這個守門原本漏掉那個 bug 的方式（見 seed.mjs 的說明）。
 *
 * 尺寸寫在**路徑**而不是 fragment：fragment 不會隨 HTTP 請求送出，伺服器看不到。
 * 正式環境是真的檔案，所以那裡沒有這個問題。
 */
const sizedPngCache = new Map();
async function sizedPng(w, h) {
  const key = `${w}x${h}`;
  if (!sizedPngCache.has(key)) {
    const { default: sharp } = await import('sharp');
    sizedPngCache.set(
      key,
      await sharp({ create: { width: w, height: h, channels: 3, background: '#334' } })
        .png()
        .toBuffer(),
    );
  }
  return sizedPngCache.get(key);
}

/** 生產是 nginx 做這件事；這裡用最小的等價物，讓 /api 與頁面同源。 */
function startProxy() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/nas-images/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PIXEL_PNG.length });
      res.end(PIXEL_PNG);
      return;
    }
    // 上傳的圖：生產是 nginx 從磁碟送，測試環境沒有那些檔。
    // 檔名帶 `-<寬>x<高>` 的就照那個尺寸造一張，其餘退回 1×1。
    if (req.url.startsWith('/uploads/')) {
      const m = /-(\d+)x(\d+)\.png/.exec(req.url);
      if (m) {
        void sizedPng(Number(m[1]), Number(m[2])).then((buf) => {
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length });
          res.end(buf);
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PIXEL_PNG.length });
      res.end(PIXEL_PNG);
      return;
    }
    // 分析腳本（Plausible）。生產是 nginx 的 `location ^~ /s/js/` 與 `location = /s/event`
    // 代理過去的，測試環境沒有那一層——不補的話 nitro 會回整份 SPA 的 HTML，而
    // **`nosniff` 會讓瀏覽器拒絕執行它**，於是 admin-smoke 的「console 不該有錯誤」變紅。
    //
    // ⚠ 只有在 build 時有帶 `VITE_PLAUSIBLE_SCRIPT` 才會走到（值在未提交的 .env）。
    //   CI 沒有那個檔所以不會輸出腳本標籤，但本機建置過就會——這個樁讓兩邊都乾淨。
    //   回空腳本而不是真的去打 Plausible：e2e 不該送出任何分析事件。
    if (req.url.startsWith('/s/js/')) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': 0 });
      res.end();
      return;
    }
    if (req.url.startsWith('/s/event')) {
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const toBackend = req.url.startsWith('/api/');
    const port = toBackend ? PORTS.backend : PORTS.nitro;
    const upstream = http.request(
      { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        // CSP 在正式環境是 nginx `location /` 加的，而這一層代理存在的目的就是
        // 模擬 nginx。加在這裡，e2e 就會替我們踩到違規——放 nginx 的話
        // e2e 完全碰不到它，只能等部署後才發現某個功能被擋掉。
        // 政策本身在 scripts/csp.mjs（單一來源，check-security-headers 也讀它）。
        //
        // ⚠ `/assets/` 要排除，因為**正式站的 nginx 也沒加**（`location /assets/` 是
        //   獨立的 block，裡面沒有 add_header CSP）。這不是無關緊要的細節：
        //   **module worker 套用的是它自己那個回應的 CSP，不是文件的**。多加在這裡的話
        //   worker 會比正式站更嚴，而 e2e 就會報出線上根本不存在的問題。
        //
        //   實際踩過：excalidraw 的字形 subsetting worker 需要 `Function()`。
        //   正式站的 worker 沒有 CSP → 正常；代理層加了 → worker 一啟動就死、主執行緒
        //   等 1000ms 逾時後走後備、後備又被文件的 CSP 擋掉 → subsetting 整個跳過，
        //   行內 SVG 從 55 KB 變成 1472 KB（同一張圖實測）。花了很久才查出來兩邊
        //   差在哪，就是因為這一層跟正式站不一致。
        //
        //   ⚠ 反過來說：哪天真的想在 nginx 幫 `/assets/` 補上 CSP，`<Sketch>` 就會
        //   以上面那個方式壞掉——那是刻意的取捨，不是可以順手加的硬化。
        //
        //   文件自己的 CSP 不受影響：主執行緒的 eval 照樣被擋（csp.spec.ts 就靠這個
        //   守著 Zod 那筆已知的 eval 探測）。
        const headers = { ...up.headers };
        if (!toBackend && !req.url.startsWith('/assets/')) {
          headers['content-security-policy'] = CSP_POLICY;
        }
        // 四條安全標頭：nginx 的 snippet 是 include 在 **server 層**的，所以正式站
        // 每個回應（HTML / assets / API）都帶著它們——這裡也要全部套上。
        //
        // ⚠ 加這個**不是**為了在 e2e 裡斷言標頭存不存在。那種測試只驗到這支假代理，
        //   綠了也不代表線上是對的（`scripts/check-security-headers.ts` 的檔頭把這件事
        //   講得很清楚，它才是打正式站的那道守門）。這裡要的是**環境等價**：
        //   `nosniff` 會改變瀏覽器的行為，少了它，MIME 給錯的回應在 e2e 照樣跑得動、
        //   上線才被擋 —— 測試環境比正式站寬鬆，給的就是假綠燈。
        //
        //   政策與這四條都從 scripts/csp.mjs 讀，代理層與 check 腳本不可能各自漂移。
        Object.assign(headers, SECURITY_HEADERS);
        res.writeHead(up.statusCode ?? 502, headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${e.message}`);
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(PORTS.proxy, '127.0.0.1', () => resolve(server)));
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));

async function main() {
  if (!existsSync(BACKEND_BIN)) {
    throw new Error(`找不到後端 binary：${BACKEND_BIN}\n先跑 cargo build（或設 E2E_BACKEND_BIN）`);
  }
  // 每次都用乾淨的 DB：測試要能重跑而結果一樣
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });

  console.log('▶ 後端…');
  run('backend', BACKEND_BIN, [], {
    DATABASE_URL: `sqlite://${DB_PATH}?mode=rwc`,
    BIND_ADDR: `127.0.0.1:${PORTS.backend}`,
    JWT_SECRET: 'e2e-secret',
    // legacy 的 basic auth：沒設會走 fail-closed 的 503（正確但沒測到東西），
    // 給一組假的才會走真正的「憑證錯誤 → 401」路徑。測試不會拿到這組值。
    ADMIN_USERNAME: 'e2e-not-a-real-admin',
    ADMIN_PASSWORD: 'e2e-not-a-real-password',
    // 相簿讀既有的測試 fixture（形狀取自線上 manifest），不必準備真的圖片
    GALLERY_MANIFEST_PATH: path.join(ROOT, 'backend/tests/fixtures/gallery_manifest.json'),
    // 第三方同步器一律關掉：E2E 不該打外部 API
    // （Trakt 那支已整個移除，不再有對應的 flag）
    ENABLE_BAHAMUT_SYNC: '',
    ENABLE_SIMKL_SYNC: '',
    // ISR 快取失效：發文／改文之後後端會打 nitro 的 /_revalidate。
    //
    // 在這行之前 e2e 沒有接這條線，於是測試環境的 /blog 永遠停在 swr 快取上
    // （列表 300 秒、文章頁 3600 秒），「發佈之後讀者看得到」根本測不出來——
    // 而那正是這套機制存在的理由。整條路徑（後端發請求 → nitro 驗密鑰 → 清 route-rules）
    // 原本零覆蓋，壞掉的症狀是「我明明發了，讀者卻要等一小時」，沒有任何錯誤訊息。
    //
    // 指向 nitro 而不是 proxy：正式環境 nginx 也是把 /_revalidate 導到前端服務
    // （那支刻意不放 /api/*，因為 nginx 會把 /api/ 全導給 Rust）。
    FRONTEND_REVALIDATE_URL: `http://127.0.0.1:${PORTS.nitro}/_revalidate`,
    REVALIDATE_SECRET: REVALIDATE_SECRET,
    RUST_LOG: process.env.RUST_LOG ?? 'warn',
  });
  await waitFor(`http://127.0.0.1:${PORTS.backend}/api/health`, '後端');

  console.log('▶ 灌種子資料…');
  seed(DB_PATH);

  console.log('▶ nitro…');
  run('nitro', process.execPath, ['.output/server/index.mjs'], {
    PORT: String(PORTS.nitro),
    HOST: '127.0.0.1',
    // SSR 端的 apiUrl() 直連後端（見 src/lib/api.ts），不繞 koimsurai.com
    BACKEND_URL: `http://127.0.0.1:${PORTS.backend}`,
    // 兩邊要是同一組，否則 /_revalidate 會回 401；沒設的話它直接 404（功能停用）
    REVALIDATE_SECRET: REVALIDATE_SECRET,
  });
  await waitFor(`http://127.0.0.1:${PORTS.nitro}/blog`, 'nitro');

  await startProxy();
  console.log(`✅ stack 起來了 → http://127.0.0.1:${PORTS.proxy}`);
}

main().catch((e) => {
  console.error('stack 啟動失敗:', e.message);
  shutdown(1);
});
