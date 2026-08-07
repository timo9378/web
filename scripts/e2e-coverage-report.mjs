/**
 * 把 e2e 收到的 V8 coverage 轉成 lcov，給 Codecov 上報（flag = e2e）。
 *
 * 資料來源是 `tests/e2e/fixtures.ts` 在每個測試結束時倒出來的 dump
 * （設了 `E2E_COVERAGE_DIR` 才會收）。這裡負責合併、映回原始檔、輸出 lcov。
 *
 * 用法：
 *   E2E_COVERAGE_DIR=.e2e-coverage pnpm e2e
 *   node scripts/e2e-coverage-report.mjs .e2e-coverage lcov-e2e.info
 *
 * 為什麼要有這支：單元測試的覆蓋率分母有**八成是 React 元件**（5477/6923 行），
 * 而元件的渲染路徑本來就是 e2e 在守。只看單元覆蓋率會得到 6% 這種數字，
 * 看起來像「幾乎沒測」，實際上 e2e 走過的原始碼是它的十倍。兩個數字要並排才看得懂。
 *
 * ⚠ 三個踩過的坑，改這支之前先讀：
 *   1. vite 用 `sourcemap: 'hidden'`——產物裡**沒有** sourceMappingURL 註解，
 *      v8-to-istanbul 自己找不到 map，必須照 `<檔名>.map` 的慣例手動餵。
 *      不餵它不會報錯，只會安靜地回 0 個檔。
 *   2. 多份 dump 的 V8 range **不能直接串接**：v8-to-istanbul 是依序套用的，
 *      後面某個測試裡 count=0 的 range 會把前面 count>0 的蓋回 0。
 *      症狀很好認——載入檔數變多、覆蓋率反而掉。
 *
 *      ⚠ 但「逐 range 相加」也是錯的，這是第二次踩：**同一個函式在不同 dump 裡的
 *      range 數量不一樣**。V8 只為「count 與父層不同」的區塊額外開一個 range，
 *      所以「完全沒跑到」是 1 個 range、「跑到而且走了幾個分支」是好幾個——
 *      位置對不起來，相加會把不同區塊的數字加在一起。
 *
 *      舊版遇到形狀不同就 `continue` 跳過（「寧可保守」），而**先到先贏**：
 *      早跑的測試多半只是把元件載入、沒互動（1 個 range、count 0），於是後面真正
 *      操作過它的 dump 整筆被丟掉。實測 191 份 dump 裡有 114461 筆因此被丟，
 *      其中 105664 筆帶著實際命中（合計 1.5 億次），整體覆蓋率被壓低 21.5 個百分點：
 *
 *        Comments.tsx     7% → 82%      Unsubscribe.tsx  12% → 95%
 *        PhotoViewer.tsx 41% → 93%      Bookshelf.tsx    15% → 83%
 *        整體          55.7% → 77.2%
 *
 *      而這種錯法**不會有任何症狀**——數字看起來只是「偏低」，還會讓人根據它去補
 *      根本不缺的測試（差點就這樣做了）。
 *
 *      正解是 `@bcoe/v8-coverage` 的 `mergeScriptCovs`：c8 / nyc 用的同一套，
 *      它會先把 range 展開成樹再合併，形狀不同也對得起來。不要自己寫。
 *   3. 過濾自家檔案要用**絕對路徑**。曾經寫成 `'src/' + abs.split('/src/').pop()`，
 *      結果第三方套件底下的 src 目錄也被重組成看似自家的路徑，排除規則永遠比對不到。
 */
import fs from 'node:fs';
import path from 'node:path';
import v8toIstanbul from 'v8-to-istanbul';
import { mergeScriptCovs } from '@bcoe/v8-coverage';

const [, , dumpDirArg, outArg] = process.argv;
const DUMP_DIR = path.resolve(dumpDirArg ?? '.e2e-coverage');
const OUT = path.resolve(outArg ?? 'lcov-e2e.info');

const REPO = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO, '.output/public');
const SRC_ROOT = path.join(REPO, 'src') + path.sep;
const SKIP = /routeTree\.gen|\/ui\/|\/animate-ui\//;

if (!fs.existsSync(DUMP_DIR)) {
  console.error(`找不到 ${DUMP_DIR}——e2e 跑的時候有設 E2E_COVERAGE_DIR 嗎？`);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) {
  console.error(`找不到 ${OUT_DIR}——要先 pnpm build（source map 是從那裡讀的）。`);
  process.exit(1);
}

// ── 合併：同一支 script 在各測試裡的 coverage（見檔頭第 2 點，別自己寫）──
const byPath = new Map(); // pathname -> ScriptCov[]
let dumps = 0;
for (const f of fs.readdirSync(DUMP_DIR)) {
  if (!f.endsWith('.json')) continue;
  dumps++;
  for (const e of JSON.parse(fs.readFileSync(path.join(DUMP_DIR, f), 'utf8'))) {
    const p = new URL(e.url, 'http://x').pathname;
    if (!byPath.has(p)) byPath.set(p, []);
    // scriptId 是 mergeScriptCovs 的必填欄位，但我們是依 URL 分組的，同一組本來就是
    // 同一支 script —— 給固定值即可（它只用來排序，不影響合併結果）。
    byPath.get(p).push({ scriptId: '0', url: e.url, functions: e.functions });
  }
}
const merged = new Map(); // pathname -> functions[]
for (const [p, covs] of byPath) {
  merged.set(p, mergeScriptCovs(covs)?.functions ?? []);
}

// ── 映回原始檔，累計每一行的命中次數 ──
const lineHits = new Map(); // repo 相對路徑 -> Map<行號, 命中數>
for (const [p, functions] of merged) {
  const file = path.join(OUT_DIR, p);
  const mapFile = `${file}.map`;
  if (!fs.existsSync(file) || !fs.existsSync(mapFile)) continue;
  const conv = v8toIstanbul(file, 0, {
    source: fs.readFileSync(file, 'utf8'),
    sourceMap: { sourcemap: JSON.parse(fs.readFileSync(mapFile, 'utf8')) },
  });
  try {
    await conv.load();
  } catch {
    continue;
  }
  conv.applyCoverage(functions);
  for (const [abs, data] of Object.entries(conv.toIstanbul())) {
    if (!abs.startsWith(SRC_ROOT) || abs.includes('node_modules')) continue;
    const rel = path.relative(REPO, abs);
    if (!/\.tsx?$/.test(rel) || SKIP.test(rel)) continue;
    if (!lineHits.has(rel)) lineHits.set(rel, new Map());
    const lines = lineHits.get(rel);
    for (const [id, count] of Object.entries(data.s ?? {})) {
      const line = data.statementMap?.[id]?.start?.line;
      if (typeof line !== 'number') continue;
      lines.set(line, (lines.get(line) ?? 0) + count);
    }
  }
  conv.destroy();
}

// ── 補上「一次都沒被載入」的檔案，否則分母只算有載入的，覆蓋率會灌水 ──
const allSrc = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!/\/(ui|animate-ui)$/.test(p)) walk(p);
      continue;
    }
    if (!/\.tsx?$/.test(ent.name) || /routeTree\.gen|\.test\.|\.d\.ts$/.test(p)) continue;
    allSrc.push(path.relative(REPO, p));
  }
})(path.join(REPO, 'src'));

// ── 輸出 lcov ──
// ⚠ 路徑寫**repo 相對**，不是絕對路徑。Codecov 靠這個對應到 repo 裡的檔案，
//   絕對路徑會讓每個檔案都變成「找不到」。（後端的 cargo-llvm-cov 寫絕對路徑，
//   ci.yml 有一步在改寫它——這裡直接寫對，省掉那一步。）
const out = [];
let covered = 0;
let total = 0;
for (const rel of allSrc) {
  const lines = lineHits.get(rel) ?? new Map();
  const entries = [...lines.entries()].sort((a, b) => a[0] - b[0]);
  const hit = entries.filter(([, c]) => c > 0).length;
  out.push('TN:');
  out.push(`SF:${rel}`);
  for (const [line, count] of entries) out.push(`DA:${line},${count}`);
  out.push(`LF:${entries.length}`);
  out.push(`LH:${hit}`);
  out.push('end_of_record');
  covered += hit;
  total += entries.length;
}
fs.writeFileSync(OUT, out.join('\n') + '\n');

const loaded = lineHits.size;
console.log(`dump ${dumps} 份｜有載入的檔 ${loaded}/${allSrc.length}`);
console.log(`行覆蓋 ${covered}/${total} = ${total ? ((covered / total) * 100).toFixed(1) : '0.0'}%`);
console.log(`已寫入 ${path.relative(REPO, OUT)}`);
