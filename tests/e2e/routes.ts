import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 受測路由**從 TanStack 生成的 routeTree.gen.ts 推導**，不手寫清單。
 *
 * 手寫清單的問題是它只涵蓋「寫的時候想到的」——新增一頁不會有任何測試提醒你它沒被測。
 * 從生成檔推導等於「有路由就會被掃到」，加頁面自動納入。
 *
 * 這裡用 regex 讀生成檔而不是 import 那個模組：import 會把整棵路由樹連同所有頁面元件
 * 拉進 node 行程（含只能在瀏覽器跑的東西）。
 *
 * ⚠ 讀的是 `FileRoutesByFullPath` 這個介面，**不是**散落各處的 `path: '...'`。
 * 差別是致命的：生成檔裡每個 route 物件的 `path` 是「相對於父路由的片段」，
 * 巢狀路由會生出 `path: '/books'`（實際網址是 /admin/books）。後台從單一 splat
 * 改成 13 條 file route 時就踩到了——`/^\/admin/` 這條 SKIP 一條都沒擋到，
 * 於是 /books、/dashboard、/users 這些被當成公開頁去測，而且因為 404 頁面
 * 「也沒有壞值」所以全部**假綠**。用完整路徑就不會受路由樹形狀影響。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 需要條件才進得去、或本來就不是頁面的，明確排除（每條都要有理由）。 */
const SKIP = [
  { re: /^\/admin/, why: '要登入' },
  { re: /^\/auth/, why: 'OAuth callback，需要 provider' },
  { re: /unsubscribe/, why: '需要退訂 token' },
  { re: /^\/\$locale/, why: '參數化語系路由；下面用實際語系另外抽樣' },
  { re: /^\/$/, why: '首頁會依 Accept-Language 302 導向，另外測' },
];

/** 帶參數的路由 → 用種子資料裡真的存在的 id。沒列到的參數路由會被跳過。 */
const PARAM_FIXTURES: Record<string, string> = {
  '/blog/$id': '/blog/1',
  '/thinking/$id': '/thinking/1',
};

export interface RouteCase {
  path: string;
  /** 該頁「有 render 成功」的證據；沒指定就只要求非空 */
  expect?: RegExp;
}

/** 有把握的內容斷言（其餘只驗「不是空的」）。種子資料見 seed.mjs。 */
const CONTENT: Record<string, RegExp> = {
  '/blog': /第一篇測試文章/,
  '/blog/1': /這是內文/,
  '/thinking': /純文字碎念/,
  '/bookshelf': /測試書名/,
  '/watch': /測試電影|測試影集|測試動畫/,
  '/en/blog': /The first test post/,
};

function rawPaths(): string[] {
  const src = readFileSync(path.join(ROOT, 'src/routeTree.gen.ts'), 'utf8');
  const start = src.indexOf('export interface FileRoutesByFullPath {');
  if (start < 0) {
    throw new Error(
      'routeTree.gen.ts 裡找不到 FileRoutesByFullPath。' +
        '\nTanStack 生成檔的格式可能變了——請確認新的完整路徑來源，' +
        '\n**不要**退回去讀 `path:`，那個是相對片段，巢狀路由會被算成公開頁。',
    );
  }
  const block = src.slice(start, src.indexOf('}', start));
  const found = new Set<string>();
  for (const m of block.matchAll(/^\s*'([^']+)':/gm)) found.add(m[1]);
  if (found.size === 0) throw new Error('FileRoutesByFullPath 解析出 0 條路由，抽取邏輯壞了');
  return [...found];
}

/**
 * 後台路由（登入後才進得去），同樣從生成檔推導。
 *
 * 為什麼要有這一支：在它之前，e2e 對後台十四頁只驗過「未登入進不去」，
 * 而其中**七頁連「登入後打得開」都沒被走過**（dashboard / categories / books /
 * subscribers / notes / article-generator / users）。後台是站長每天在用的介面，
 * 而「某頁一打開就白畫面」正是沒有人會發現的那種——直到剛好要用那頁。
 *
 * 一樣不手寫清單：新增後台頁會自動被掃到。
 */
const ADMIN_SKIP = [
  { re: /^\/admin\/login$/, why: '只是舊書籤的轉址頁，沒有內容可驗' },
];

/** 後台的參數化路由 → 種子資料裡真的存在的 id。 */
const ADMIN_PARAM_FIXTURES: Record<string, string> = {
  '/admin/posts/edit/$id': '/admin/posts/edit/1',
};

export function discoverAdminRoutes(): RouteCase[] {
  const paths = new Set<string>();
  for (const raw of rawPaths()) {
    if (!raw.startsWith('/admin')) continue;
    if (ADMIN_SKIP.some((s) => s.re.test(raw))) continue;
    const p = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const resolved = p.includes('$') ? ADMIN_PARAM_FIXTURES[p] : p;
    if (resolved) paths.add(resolved);
  }
  return [...paths].sort((a, b) => a.localeCompare(b)).map((path) => ({ path }));
}

export function discoverRoutes(): RouteCase[] {
  // 去重要在正規化**之後**：生成檔裡目錄型路由會同時出現 '/blog' 與 '/blog/'，
  // 兩者會收斂成同一條，直接用原字串去重會留下重複的測試名稱。
  const paths = new Set<string>();
  for (const raw of rawPaths()) {
    if (SKIP.some((s) => s.re.test(raw))) continue;
    const p = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!p.startsWith('/')) continue;
    const resolved = p.includes('$') ? PARAM_FIXTURES[p] : p;
    if (resolved) paths.add(resolved); // 沒給 fixture 的參數路由：跳過
  }
  // 語系路由抽一條驗 i18n（全 5 語 × 全頁面太慢，且問題模式一樣）
  paths.add('/en/blog');
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, expect: CONTENT[path] }));
}
