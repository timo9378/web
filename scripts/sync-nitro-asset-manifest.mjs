/**
 * 把 nitro 的靜態資產清單重新對齊磁碟上的實際檔案。
 *
 * ## 為什麼需要
 *
 * `pnpm build` 產生 `.output/server/index.mjs`，裡面內嵌一份清單，每支資產記著
 * `size` 與 `etag`。nitro 供應檔案時 **content-length 是照清單寫的，不是 stat 出來的**。
 *
 * 而 Dockerfile 在 build **之後**才跑 `sentry-cli sourcemaps inject`——它會在每支 JS
 * 尾端塞進一段 `_sentryDebugIds` 與 `//# debugId=`（實測 +358 bytes）。於是清單裡的
 * size 比實際檔案短，nitro 就照著短的長度把回應切斷。
 *
 * 症狀是整站白畫面加一行
 *
 *     Uncaught SyntaxError: Unexpected end of input (at index-XXXX.js:48:226866)
 *
 * 而**容器裡那份檔案是完好的**——切斷發生在供應階段，所以 `docker exec` 進去看檔案
 * 只會覺得一切正常。實地驗證方式是比對 `curl | wc -c` 與 `wc -c < 檔案`。
 *
 * 同一個根因還有一個已知的兄弟症狀：清單是在「刪 .map」之前產生的，所以刪掉之後
 * 那些路徑會回 500（nitro 去 open 一個清單裡有、磁碟上沒有的檔案）而不是 404。
 * 這支腳本一併把不存在的條目移除，那條路徑就回 404 了。
 *
 * ## 為什麼是改清單，而不是調整順序
 *
 * inject 沒辦法搬到 build 之前——那時候檔案還不存在。而 nitro 沒有提供「執行期改用
 * stat」的開關。所以正確的位置就是「所有後處理都做完之後，再讓清單追上現況」。
 *
 * etag 公式取自 nitro 自己的產出，並以未被 inject 動過的 .css 檔驗證過相符：
 *     "<size 的十六進位>-<sha1(內容) 的 base64 前 27 字>"
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SERVER_ENTRY = '.output/server/index.mjs';

// 清單條目長這樣（縮排是 tab）：
//   "/assets/index-XXXX.js": {
//     "type": "text/javascript; charset=utf-8",
//     "etag": "\"147f4f-lAtSDu45Z3RFyIvFv4+xymtpUj0\"",
//     "mtime": "2026-08-04T10:25:12.958Z",
//     "size": 1343311,
//     "path": "../public/assets/index-XXXX.js"
//   },
const ENTRY = /"(?<key>\/[^"]*)":\s*\{\s*"type":\s*"(?<type>[^"]*)",\s*"etag":\s*"(?<etag>(?:[^"\\]|\\.)*)",\s*"mtime":\s*"(?<mtime>[^"]*)",\s*"size":\s*(?<size>\d+),\s*"path":\s*"(?<path>[^"]*)"\s*\}(?<comma>,?)/g;

const entryPath = path.resolve(SERVER_ENTRY);
if (!fs.existsSync(entryPath)) {
  console.error(`找不到 ${SERVER_ENTRY} —— 這支腳本要在 pnpm build 之後跑`);
  process.exit(1);
}

const serverDir = path.dirname(entryPath);
const source = fs.readFileSync(entryPath, 'utf8');

let resized = 0;
let removed = 0;
let matched = 0;

const patched = source.replace(ENTRY, (whole, ...args) => {
  const g = args.at(-1);
  matched++;
  const file = path.resolve(serverDir, g.path);

  if (!fs.existsSync(file)) {
    // 後處理刪掉的檔案（.map）。留著會讓那條路徑回 500 而不是 404。
    removed++;
    return '';
  }

  const buf = fs.readFileSync(file);
  if (buf.length === Number(g.size)) return whole; // 沒被後處理動過

  const etag = `${buf.length.toString(16)}-${createHash('sha1').update(buf).digest('base64').slice(0, 27)}`;
  const mtime = fs.statSync(file).mtime.toISOString();
  resized++;
  return (
    `"${g.key}": {\n\t\t"type": "${g.type}",\n\t\t"etag": "\\"${etag}\\"",\n` +
    `\t\t"mtime": "${mtime}",\n\t\t"size": ${buf.length},\n\t\t"path": "${g.path}"\n\t}${g.comma}`
  );
});

if (matched === 0) {
  // 清單格式變了就當場停下來。靜靜跳過的話症狀是「部署後整站白畫面」，
  // 而那跟這支腳本的關聯不會有人第一時間想到。
  console.error('清單一個條目都沒配到 —— nitro 的產出格式可能變了，這支腳本該更新');
  process.exit(1);
}

fs.writeFileSync(entryPath, patched);
console.log(`nitro 資產清單已對齊：掃描 ${matched} 筆，修正大小 ${resized} 筆，移除已刪除的 ${removed} 筆`);
