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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PORTS = {
  proxy: Number(process.env.E2E_PORT ?? 13996),
  nitro: Number(process.env.E2E_NITRO_PORT ?? 13997),
  backend: Number(process.env.E2E_BACKEND_PORT ?? 13999),
};
const DB_PATH = process.env.E2E_DB ?? '/tmp/koimsurai-e2e.db';

// backend 是 workspace member（根目錄的 Cargo.toml 是 [workspace] members = ["backend"]），
// 所以產物在 web/target/ 而不是 web/backend/target/。debug 優先——CI 就是建那個。
function findBackendBin() {
  if (process.env.E2E_BACKEND_BIN) return process.env.E2E_BACKEND_BIN;
  const candidates = ['target/debug', 'target/release'].map((d) =>
    path.join(ROOT, d, 'koimsurai-web-backend'),
  );
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

/** 生產是 nginx 做這件事；這裡用最小的等價物，讓 /api 與頁面同源。 */
function startProxy() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/nas-images/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PIXEL_PNG.length });
      res.end(PIXEL_PNG);
      return;
    }
    const toBackend = req.url.startsWith('/api/');
    const port = toBackend ? PORTS.backend : PORTS.nitro;
    const upstream = http.request(
      { host: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
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
    ENABLE_TRAKT_SYNC: '',
    ENABLE_BAHAMUT_SYNC: '',
    RUST_LOG: process.env.RUST_LOG ?? 'warn',
  });
  await waitFor(`http://127.0.0.1:${PORTS.backend}/api/health`, '後端');

  console.log('▶ 灌種子資料…');
  seed(DB_PATH);

  console.log('▶ nitro…');
  run('nitro', process.execPath, ['.output/server/index.mjs'], {
    PORT: String(PORTS.nitro),
    HOST: '127.0.0.1',
    // SSR 端的 apiUrl() 直連後端（見 src/api.ts），不繞 koimsurai.com
    BACKEND_URL: `http://127.0.0.1:${PORTS.backend}`,
  });
  await waitFor(`http://127.0.0.1:${PORTS.nitro}/blog`, 'nitro');

  await startProxy();
  console.log(`✅ stack 起來了 → http://127.0.0.1:${PORTS.proxy}`);
}

main().catch((e) => {
  console.error('stack 啟動失敗:', e.message);
  shutdown(1);
});
