import { defineConfig, type Plugin } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import viteReact from '@vitejs/plugin-react';
// Tailwind v4 走專屬的 vite plugin 而不是 PostCSS 外掛：官方在 vite 專案推薦這條，
// 而且它讓整個 postcss.config.js 可以消失（v4 自己處理 @import 與 vendor prefix，
// postcss-import 與 autoprefixer 都不需要了）。
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * 把 monaco 的 `min/vs` 複製進 `public/monaco/vs`，讓編輯器從**自己的網域**載入。
 *
 * 原本是走 `@monaco-editor/loader` 的預設值，也就是
 * `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`。三個問題：
 *
 *   1. **版本對不上**。`package.json` 原本釘的是 `monaco-editor@0.53.0`（型別用），
 *      CDN 送的卻是 0.55.1——型別檢查看到的 API 跟實際跑的差兩個 minor 版。
 *      這種落差不會有編譯錯誤，只會在某個 API 改了行為時變成執行期的怪現象。
 *
 *      ⚠ 自架時**必須把版本對齊成「線上原本在跑的那個」**（0.55.1），而不是
 *        package.json 當時釘的 0.53.0。第一版就是搞錯這件事：改成送 0.53.0 之後
 *        monaco 的 `language/css/monaco.contribution` 在初始化時丟
 *        `TypeError: Property description must be an object: undefined`，
 *        所有請求都 2xx、編輯器外框也畫得出來，只有 console 裡有那一行。
 *        自架要換的是**來源**，不是版本——換版本是另一件事，要另外驗。
 *   2. **第三方相依**。jsdelivr 掛掉或被擋（企業網路、某些地區）就打不開編輯器。
 *   3. **擋住 CSP**。要收緊 `script-src` 就得把 jsdelivr 放進白名單，
 *      等於為了一個後台功能在全站開一個外部來源。
 *
 * 為什麼複製整個 `min/vs`（約 15 MB）而不是挑需要的語言：monaco 是按需 lazy load 的，
 * 挑漏一個語言的症狀是「某種程式碼區塊的語法高亮突然沒了」，而那不會報錯。
 * 這些檔只在後台開編輯器時才會被抓，前台讀者一個 byte 都不會下載。
 *
 * 用 plugin 而不是 `prebuild` script：`pnpm dev` 也要有這些檔，而 dev 不跑 build script。
 */
function copyMonacoAssets(): Plugin {
  return {
    name: 'copy-monaco-vs',
    // buildStart 在 build 與 dev server 啟動時都會跑
    buildStart() {
      const require = createRequire(import.meta.url);
      // 用 resolve 而不是寫死 node_modules 路徑——pnpm 的實際位置在 .pnpm/ 底下
      const pkgPath = require.resolve('monaco-editor/package.json');
      const version = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
      const src = path.join(path.dirname(pkgPath), 'min/vs');
      const destRoot = path.resolve(import.meta.dirname, 'public/monaco');
      const stamp = path.join(destRoot, '.version');

      // 版本沒變就跳過。整份複製約 15 MB，每次 dev 重啟都做一次是白等。
      if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) return;

      fs.rmSync(destRoot, { recursive: true, force: true });
      fs.mkdirSync(destRoot, { recursive: true });
      fs.cpSync(src, path.join(destRoot, 'vs'), { recursive: true });
      fs.writeFileSync(stamp, version);
      this.info(`monaco-editor@${version} → public/monaco/vs`);
    },
  };
}

/**
 * Excalidraw 的字體自架。
 *
 * 為什麼需要：它預設從 `https://esm.sh/@excalidraw/excalidraw@<ver>/dist/prod/` 抓字體，
 * 而 CSP 的 `font-src 'self' data:` 會擋掉——**而且擋掉時前台是靜默的**，圖照樣畫出來，
 * 只是文字退回系統字型。這件事是 CSP report 上線後幾分鐘內自己回報的
 * （`Blocked 'font' from 'esm.sh'`，來源 /blog/crowdsec-replacing-fail2ban），
 * 在那之前沒有任何人會發現。
 *
 * ⚠️ SketchBlock 的 `skipInliningFonts: true` **不能解決這件事**。那個選項只擋
 *   「把字體內嵌進匯出的 SVG」，渲染／量測時該抓的還是會抓。
 *
 * 路徑對應：base 是 dist/prod/，字體在它底下的 ./fonts/ →
 * 設 EXCALIDRAW_ASSET_PATH='/excalidraw/' 就要 public/excalidraw/fonts/。
 */
function copyExcalidrawFonts(): Plugin {
  return {
    name: 'copy-excalidraw-fonts',
    buildStart() {
      const require = createRequire(import.meta.url);
      // ⚠️ 不能用 require.resolve('@excalidraw/excalidraw/package.json')——它的 exports
      //   沒有開放 ./package.json（ERR_PACKAGE_PATH_NOT_EXPORTED）。從主入口反推。
      const entry = require.resolve('@excalidraw/excalidraw');
      const pkgRoot = entry.slice(0, entry.indexOf(`${path.sep}dist${path.sep}`));
      const version = (
        JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as { version: string }
      ).version;
      const src = path.join(pkgRoot, 'dist/prod/fonts');
      const destRoot = path.resolve(import.meta.dirname, 'public/excalidraw');
      const stamp = path.join(destRoot, '.version');

      if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) return;

      fs.rmSync(destRoot, { recursive: true, force: true });
      fs.mkdirSync(destRoot, { recursive: true });
      // 14 MB，其中 13 MB 是 Xiaolai（CJK 手寫體，234 個 woff2 子集）。
      // 不砍它：子集是按 unicode-range 需要才下載，佔磁碟不佔頻寬，
      // 而砍掉的後果是圖裡的中文變成豆腐——同樣是靜默的。
      fs.cpSync(src, path.join(destRoot, 'fonts'), { recursive: true });
      fs.writeFileSync(stamp, version);
      this.info(`@excalidraw/excalidraw@${version} fonts → public/excalidraw/fonts`);
    },
  };
}

// 不做 prerender,改走 ISR(見下方 routeRules)。理由是實測出來的,不是偏好:
//   在 nitro/vite + TanStack Start 下,prerender 產出的 HTML 寫進 .output/public 後
//   *不會被 nitro 註冊成靜態資產* —— /assets/*.css 與 /favicon.ico 都 200,唯獨
//   /blog/index.html、/en/index.html 一律 404,實際請求每次都重新 SSR(連打兩次 md5 不同)。
//   等於 prerender 生出 111 個檔案卻沒有任何一個被送出過,純粹浪費 build 時間。
// 拿掉它同時消滅:build 期打 https://koimsurai.com 撈文章清單(build 依賴線上站活著),
// 以及為了 prerender 內部 crawler 而綁 server/preview host 的 hack。
// ISR 已實測能給出同樣完整的 HTML(/blog 有文章標題與連結、/blog/$id 有內文與 meta)。

const LOCALE_PREFIXES = ['en', 'ja', 'ko', 'zh-cn'];
// UI 頁(全 5 語都有)。加新頁只要加名字,ISR 規則會自動涵蓋 5 個語系路徑。
const UI_PAGES = ['about', 'setup', 'bookshelf', 'activity', 'music', 'thinking', 'messages', 'portfolio', 'friends', 'watch/library', 'watch', 'blog', 'unsubscribe', 'about-site', 'history', 'photos'];

// ── ISR / SWR route rules ───────────────────────────────────────────────────
// 一頁 → 該頁 5 個語系路徑(/x + /en/x …)。
const localeVariants = (page: string): string[] => [`/${page}`, ...LOCALE_PREFIXES.map((l) => `/${l}/${page}`)];
// 這裡只設 swr（伺服器端 ISR 快取），HTML 的 Cache-Control 不在這層管。
//
// 原因：nitro 的 `swr: n` 會吐出 `public, max-age=n, s-maxage=n`，那個 max-age 是**瀏覽器**端的，
// 而部署後 assets 全換 hash、舊檔消失 → 這 n 秒內的回訪者從磁碟快取讀到舊 HTML → 動態 import
// 去要已刪除的 chunk → 404 → mermaid／SketchBlock 整塊不渲染（2026-07-28 實測：10 支 chunk 404、
// 圖表全空）。在 routeRules 加 `headers: { 'cache-control': ... }` 沒有用——SWR 會把整個回應連同
// 自己算出的 header 存進快取、命中時重放，實測會覆蓋掉這裡設的值。
//
// 所以改在 nginx 處理（/etc/nginx/sites-available/koimsurai）：HTML 降到 max-age=60，
// /assets/ 獨立一個 location 保住 immutable。改那邊時記得 nginx 的 add_header 不繼承，
// 安全標頭要在該 block 內補齊。
const swrRules = (paths: string[], seconds: number) =>
  Object.fromEntries(paths.map((p) => [p, { swr: seconds }]));

// 刻意採「白名單」而非 '/**' 全站包:全站包是 fail-open —— 日後新增任何讀 cookie/header 或
// render 使用者資料的頁面,都會被預設公開快取且沒人會察覺。白名單則是新頁預設不快取,最壞只是少個快取。
// 明確不快取(因此不列於此):
//   /              → createServerFn 讀 cookie/Accept-Language 做 302 導向,快取會把首位訪客的語言發給所有人
//   /admin/**      → 後台
//   /auth/**       → 登入流程
//   /unsubscribe   → 帶 token 的使用者專屬頁
// 可安全快取的前提:登入狀態只存在 client 的 localStorage(AuthContext 在 useEffect 才讀),
// 所以 SSR 一律 render 未登入外殼,HTML 對所有訪客相同。
const ISR_PAGES = UI_PAGES.filter((p) => p !== 'blog' && p !== 'unsubscribe');
const ISR_ROUTE_RULES = {
  ...swrRules(ISR_PAGES.flatMap(localeVariants), 3600),
  ...swrRules(localeVariants('blog'), 300), // 列表頁:發新文要早點出現 → 5 分鐘
  ...swrRules(localeVariants('blog').map((p) => `${p}/**`), 3600), // 文章頁:內容幾乎不動 → 1 小時
};

export default defineConfig({
  // Sentry 的 tree-shaking 旗標。這些是 SDK 內部拿來包住整段功能的常數，
  // 在 build 時替換成 false，那幾塊就會被搖掉。
  //
  // ⚠️ 但這幾個旗標只是**次要**的那一半。真正決定大小的是 import 的寫法：
  //   `const Sentry = await import('@sentry/browser')` 這種 namespace import 會讓
  //   bundler 不敢搖掉任何 export（理論上可以動態存取），整包 Replay(rrweb) +
  //   Feedback + browserTracing 都留著 → 135 KB gz。改成 `const { init } = await
  //   import(...)` 之後是 26 KB gz。見 src/lib/errorReporting.ts。
  //
  // ⚠️ 這幾個常數要**存在**才行（不然 SDK 裡的 `typeof __SENTRY_DEBUG__` 會炸），
  //   所以是 define 成 false 而不是刪掉。
  define: {
    __SENTRY_DEBUG__: 'false',
    __SENTRY_TRACING__: 'false',
    __RRWEB_EXCLUDE_CANVAS__: 'true',
    __RRWEB_EXCLUDE_IFRAME__: 'true',
    __RRWEB_EXCLUDE_SHADOW_DOM__: 'true',
  },
  build: {
    // 'hidden' = 產生 .map 檔，但**不在 bundle 結尾寫 sourceMappingURL**。
    //
    // 為什麼不是 true：那會在 bundle 結尾寫 sourceMappingURL，瀏覽器 devtools 會自動
    // 去抓——等於主動把原始碼推給每個開 devtools 的人。
    // 為什麼不是 false：那 GlitchTip 上的 stack trace 全是 minify 過的
    // （`t.f is not a function` 這種），幾乎讀不出東西——等於白裝。
    //
    // ⚠️ 'hidden' **只拿掉那行註解，不會阻止 .map 被供應**。實測過：
    //   /assets/AdminDashboard-*.js.map 直接 200，整站原始碼可下載。
    //   真正把它擋掉的是 Dockerfile 最後那步 `find ... -delete`（上傳完就刪），
    //   加上 nginx 的 `location ~ \.map$ { return 404; }`。
    sourcemap: 'hidden',
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      // recharts 依賴 decimal.js-light；rolldown 的 prod build 對它的 CJS 版做 interop 時把 default
      // 二次包裝（default.default）→ recharts 內 `new Decimal()` 變 `new G.default` 而爆
      // "G.default is not a constructor"（dev 的 esbuild 不會）。強制指向它的 ESM 版（乾淨的
      // export default Decimal）迴避。用 bare 子路徑當 replacement（從匯入者 recharts 的 context
      // 解析 → pnpm/Docker 下 decimal.js-light 不在頂層也找得到，不寫死絕對路徑）；
      // regex 精確匹配 decimal.js-light（不含子路徑）避免 replacement 被再次 alias。
      { find: /^decimal\.js-light$/, replacement: 'decimal.js-light/decimal.mjs' },
    ],
  },
  // react-helmet-async 是 CJS,要 vite 轉譯才能在 SSR 用具名匯出(過渡 bridge,之後 SEOHead→head() 可移除)
  ssr: { noExternal: ['react-helmet-async'] },
  plugins: [
    copyMonacoAssets(),
    copyExcalidrawFonts(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    nitro({
      config: {
        serverDir: './server', // 掃 server/routes/ 的檔案系統路由(預設不掃 → 404)
        // ISR：node-server preset 內建 SWR（TTL 過期先回舊、背景重生，不需 CDN）
        routeRules: ISR_ROUTE_RULES,
      },
    }),
  ],
});
