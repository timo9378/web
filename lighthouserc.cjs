/**
 * Lighthouse CI 設定。
 *
 * ## 先講它**抓不到**什麼
 *
 * 這個專案實地最嚴重的一次 CLS（0.52）Lighthouse 量到的是 **0**，開了節流也還是 0。
 * 原因是它永遠冷啟動、無 history、單頁直接載入，而那個位移只在「捲在文章深處按 F5、
 * 瀏覽器還原捲動位置時 SSR HTML 還沒解析完」才出現。細節見 CLAUDE.md 與
 * `tests/e2e/cls.spec.ts` 的檔頭——那條路徑由 Playwright 守著，不是這裡。
 *
 * 所以這份設定**不拿 performance 分數當門檻**。共用 runner 上那個分數的變異
 * 大到只能製造假紅：同一個 commit 連跑三次可能是 0.72 / 0.85 / 0.79。
 * 這裡守的是三件變異小、退步了又真的會痛的事：
 *
 *   1. **可及性與 SEO 的分數** —— 這兩類是靜態規則比對（有沒有 alt、對比度夠不夠、
 *      有沒有 meta description），不受機器忙不忙影響，跑幾次都一樣。
 *   2. **資源預算** —— JS/圖片/總位元組。這是最容易在「加個小套件」時無聲膨脹的東西，
 *      而它直接決定手機使用者的等待時間。數字是實測值加餘裕，不是猜的。
 *   3. **幾個一定是 bug 的稽核** —— 例如圖片沒尺寸、有 console error、用了棄用 API。
 *
 * ## 為什麼打 e2e stack 而不是正式站
 *
 * 打正式站量到的是「那一刻的網路與 CDN」，而且擋不住還沒部署的退步——那時候已經來不及。
 * e2e stack（`tests/e2e/stack.mjs`）跑的是真的 nitro build + 真的後端 binary，
 * 只有資料是種子。絕對值因此跟線上不同（種子文章比較短），但這裡要的是**相對變化**。
 */

module.exports = {
  ci: {
    collect: {
      // 與 e2e 同一套 stack：真的 nitro build + 真的後端 binary + 種子資料。
      // 埠號跟 e2e 錯開，才能兩邊同時在本機跑。
      startServerCommand: 'node tests/e2e/stack.mjs',
      startServerReadyPattern: 'stack 起來了',
      startServerReadyTimeout: 180_000,
      url: [
        'http://127.0.0.1:13996/',
        'http://127.0.0.1:13996/blog',
        'http://127.0.0.1:13996/blog/4',
        'http://127.0.0.1:13996/bookshelf',
        'http://127.0.0.1:13996/photos',
      ],
      // 三次取中位數。跑一次的話 runner 偶爾的抖動就會變成一次假紅；
      // 再往上加對穩定度的邊際效益很小，時間卻是線性成長。
      numberOfRuns: 3,
      settings: {
        // 桌機預設。手機模擬會把 CPU 節流 4 倍，而共用 runner 本來就慢——
        // 兩層疊起來的數字跟任何真實裝置都對不上。要看手機請看實地的 web_vitals 表。
        preset: 'desktop',
        // 這些頁面有 Service Worker 與 localStorage 狀態，不清乾淨的話第二次跑
        // 量到的是快取命中，數字會莫名其妙變好
        disableStorageReset: false,
        chromeFlags: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          // 無頭環境沒有 GPU，走 SwiftShader 軟體渲染。少了這個旗標
          // Chromium 151 會直接拒絕初始化 WebGL 並在 log 裡吐一整片警告。
          '--enable-unsafe-swiftshader',
        ],
        // PWA 類別在 Lighthouse 12 已經移除，剩下四類全要
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },

    // 用 assertMatrix 而不是單一組 assertions，是為了讓資源預算貼著各頁的實測值。
    // 一個全站共用的寬鬆上限會讓首頁多出好幾百 KB 也照樣綠——而預算的意義就在於「貼身」。
    assert: {
      assertMatrix: [
        {
          // ── 每一頁都適用 ────────────────────────────────────────
          matchingUrlPattern: '.*',
          assertions: {
            // a11y / seo 是靜態規則比對，跑幾次都一樣（實測三次全同分），
            // 所以可以訂得貼近實測值。目前各頁是 0.96 ~ 1.00。
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:seo': ['error', { minScore: 0.9 }],
            // best-practices 會被第三方 cookie、console 內容這類影響，留多一點餘裕
            'categories:best-practices': ['warn', { minScore: 0.9 }],
            // ⚠ performance 只當**警告**。理由見檔頭：共用 runner 的變異大到
            //   訂成 error 只會製造假紅（本機無負載時是 0.74~0.75），而真正的效能
            //   回歸靠實地的 web_vitals 表與 tests/e2e/cls.spec.ts 抓。
            //   這條留著只為了擋「掉到 0.5 以下」這種數量級的退步。
            'categories:performance': ['warn', { minScore: 0.5 }],

            // 字型：實測各頁 31~63 KB。加一個新字重大約 +20 KB，所以 100 KB
            // 容得下一次正常的增加，但擋得住「不小心把整套 variable font 打包進來」。
            'resource-summary:font:size': ['error', { maxNumericValue: 100_000 }],

            // ── 一定是 bug 的稽核 ─────────────────────────────────
            // 圖片沒寫尺寸 → 版面在圖載入時跳動。CLS 最常見也最好修的成因。
            'unsized-images': 'error',
            // console 有錯誤代表有東西真的壞了，只是使用者沒看到
            'errors-in-console': 'error',
            // 棄用 API 會在某個 Chrome 版本直接消失，而那天不會有人預告
            deprecations: 'error',

            // ── 關掉的 ────────────────────────────────────────────
            // 這幾條在這個專案是已知且刻意的取捨，開著只會變成每次都要略過的雜訊。
            'valid-source-maps': 'off', // 生產刻意不出 source map
            'unused-javascript': 'off', // 路由層已做 code splitting，剩下的是框架本體
            'legacy-javascript': 'off', // 由 vite 的 target 決定，不是逐次可調的東西
            'uses-long-cache-ttl': 'off', // 快取標頭在 nginx 那層，e2e stack 沒有那一層
            'csp-xss': 'off', // CSP 是另外排程的工作，還沒做
          },
        },
        {
          // ── 文章內頁：多了 shiki（語法高亮）與 mermaid ──────────
          // 實測 /blog/4：script 2.18 MB、total 2.68 MB。這兩包是文章頁獨有的，
          // 所以它的上限本來就該比別頁高——用全站共用的數字就等於把別頁一起放寬。
          matchingUrlPattern: '.*/blog/\\d+.*',
          assertions: {
            'resource-summary:script:size': ['error', { maxNumericValue: 2_400_000 }],
            'resource-summary:total:size': ['error', { maxNumericValue: 2_900_000 }],
          },
        },
        {
          // ── 其餘頁面：不該載到文章頁那兩包 ──────────────────────
          // 實測最大的是 /photos（script 1.86 MB、total 2.25 MB，masonry + 圖片檢視器）。
          // 這組上限的另一個作用是**擋住 shiki/mermaid 洩漏到共用 chunk**——
          // 真的洩漏了，這幾頁會一起爆掉，而畫面上完全看不出來。
          matchingUrlPattern: '^(?!.*/blog/\\d).*$',
          assertions: {
            'resource-summary:script:size': ['error', { maxNumericValue: 2_000_000 }],
            'resource-summary:total:size': ['error', { maxNumericValue: 2_450_000 }],
          },
        },
      ],
    },

    upload: {
      // 傳到 Lighthouse 官方的暫存空間，PR 上就有一個可以點進去看的完整報告。
      // 沒有自架 LHCI server 的話這是最省事的做法；報告七天後過期。
      target: 'temporary-public-storage',
    },
  },
};
