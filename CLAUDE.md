# koimsurai / sora-to-ki — 給 AI 助手的工作守則

## 工具選擇

這一節不是「請節省 token」這種空話，而是「哪件事該用哪個工具」。
會寫下來是因為實際踩過：某次 session 裡 Bash 佔了 22 萬 token（全對話的 30%），
而其中檔案編輯的部分本來就該用 `Edit`，繞道 Bash 還造成了三個 bug。

| 要做的事 | 用這個 | 不要用 |
|---|---|---|
| 搜尋程式碼、跨檔找字串 | `ctx_batch_execute`（一次多個指令 + `queries`，原始輸出留沙箱） | `Bash grep`（整份輸出進 context） |
| 分析單一檔案內容 | `ctx_execute_file`（跑程式、只印結論） | `Bash sed/head`（猜著看，還要自己讀） |
| 找符號定義／型別／引用 | `LSP`（`documentSymbol`、`findReferences`、`hover`） | `Bash grep`（字串比對有雜訊，型別會猜錯） |
| **改檔案** | **`Edit`**（精確匹配，匹配不到會報錯） | **Bash + 內嵌 python `s.replace()`** |
| 產生新檔 | `Write` | Bash heredoc |
| 執行指令（docker / git / cargo / curl / nginx） | `Bash` | — |
| 量 CWV / 效能 / 網路 / 記憶體 | `chrome-devtools` MCP | 手刻 CDP 腳本 |
| 需要隔離環境或自訂儀器的瀏覽器測試 | `playwright` MCP | — |

### 瀏覽器工具：兩個都留，分工不同

機器上只有 **Edge**（Chromium 核心），沒有 Chrome。兩個 MCP 都用 `/usr/bin/microsoft-edge`。

**`chrome-devtools` 用在標準問題**——`emulate`（CPU/網路節流、viewport、UA 一次搞定）、
`performance_start_trace`（直接吐 LCP/INP/CLS）、`performance_analyze_insight`、
`lighthouse_audit`、`list_network_requests`、12 個 heap snapshot 工具。
這些以前要手刻 CDP：光「節流 + 注入 PerformanceObserver + 算 session window + 歸因」
就是 80 行,現在是 3~4 個工具呼叫。

**`playwright` 只在一件事上不可取代**：**獨立 context**（`browser.newContext()`）。
chrome-devtools 只有 `new_page`、共用 profile。曾經因此誤判：量到「CLS 3/4 歸零」以為修好了，
用全新 context 重測才發現那是 **history 與快取造成的假象**，真實情況完全沒改善。要量
「首次造訪」就必須有乾淨環境。（`--isolated` 只在 server 生命週期層級隔離，不是每次測試。）

> 導覽前注入腳本不是差異點——`navigate_page` 有 `initScript` 參數，等同 `addInitScript`。

⚠️ **`performance_start_trace` 的 `reload: true` 有陷阱。** 它自己的重載**不帶捲動還原**，
量文章頁只會得到 0.03；要重現「捲在深處按 F5」必須 `reload: false` + `autoStop: false`，
自己 `evaluate_script` 捲好、`navigate_page(type: reload)`、再 `performance_stop_trace`。
用對之後它量到 0.4252，跟手刻 CDP 的數字一致。

⚠️ **它測得到、不一定解釋得了。** 同一筆 0.4252 它回「No potential root causes identified」——
CLSCulprits 認得的是字體、圖片無尺寸、動態插入這類標準模式，而這頁的成因是「瀏覽器在
SSR HTML 還沒解析完（docH 2792 → 最終 7109）就還原捲動位置」，不在它的分類裡。
遇到它答不出來的，還是得自己逐幀追 docH / scrollY / 各區塊高度。
反過來它也抓到過我漏掉的：TASA Explorer 那支 latin webfont 造成 0.0337 位移。

⚠️ **Lighthouse 測不出實地才有的問題。** 同一頁在無節流本機跑是 CLS 0，開了節流還是 0
（LCP 卻爆到 4.2s，證明節流有生效）——因為它永遠是冷啟動、無 history、單頁直接載入。
文章頁真正的 CLS 只在「重新整理且捲在深處」時出現，任何「載入一次量一次」的工具都抓不到。
實地歸因靠 `web_vitals` 表的 `target` / `shift_path` 兩欄（見 migration 0010/0011）。

### 為什麼「改檔案一定要用 Edit」

用 shell + python 改檔繞過了 `Edit` 的保護，實際造成過：

- **heredoc 吃掉行尾兩個空白** → MDX 歌詞的硬換行全沒了，整段併成一行
- **`$remote_addr` 寫在雙引號 `echo` 裡** → bash 當成自己的變數展開，`set -u` 讓腳本中止
- **`replace(..., 1)` 打到錯的 struct** → 欄位加進 `TagBody` 而不是 `CategoryBody`（發生兩次）

`Edit` 要求精確匹配、不經過 shell 也不經過 python 的字串逸出，這三類錯都不會發生。
多處修改就多呼叫幾次 `Edit`，不要為了「一次改完」而繞道。

### 寫進 /etc 或系統設定的腳本

字面內容一律走**引號 heredoc**（`<<'EOF'`），它不做變數展開。
在雙引號 `echo` 裡寫 nginx／其他系統的 `$變數` 會被 bash 搶走。

## CI 門檻（跟這些指令一字不差，不要自己改寫）

前端：

```bash
pnpm exec tsc --noEmit
pnpm --filter @koimsurai/mcp-server typecheck
pnpm typecheck:server
pnpm typecheck:scripts
pnpm exec oxlint --type-aware --tsconfig=tsconfig.json src --max-warnings 0
pnpm exec oxlint scripts server packages --max-warnings 0
pnpm test          # vitest
pnpm build         # vite + nitro
```

後端（`cd backend`）：

```bash
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo llvm-cov nextest --locked --fail-under-regions 78   # 門檻以 ci.yml 為準
# specta：改過會進 API 的 struct 就要重跑 export_types 並提交，否則 drift gate 會擋
```

⚠️ **跑測試一律用 `cargo nextest run --no-fail-fast`。`cargo test` 在這個專案是壞的，
不要拿它的結果下任何判斷。**

差別不是輸出好不好看：nextest 是**一個測試一個行程**，`cargo test` 是同一個行程平行跑
執行緒。而這裡有十幾個測試檔直接寫 process 全域的 `std::env::set_var`（gallery 的輸出
目錄、bahamut 的 cookie、mailer/oauth/watch/simkl 的金鑰…），外加 `QUOTE_CACHE`、
`STARS_CACHE`、`GALLERY_SYNC_LOCK` 這些全域 static。同行程平行跑就是互相蓋。

症狀是**隨機幾條紅、每次紅的還不一樣**，看起來完全像「測試本身會抖」。我為此誤判過
三次，還向使用者回報了三組不存在的「既有失敗」。實際上 nextest 下是 580/580，連跑
三次全綠。

`--no-fail-fast` 也不是可選的：少了它，nextest 第一個失敗就中止，`580 tests run` 會變成
`470/580`、每次的數字還不同——那個變動本身又會被誤讀成不穩定。

沒有任何地方需要 `cargo test`：CI 走 `cargo llvm-cov nextest`，cargo-mutants 也已經在
`.cargo/mutants.toml` 設了 `test_tool = "nextest"`（那份設定裡就記著同一個坑）。

⚠️ **還有兩道在 repo 根目錄跑、很容易漏掉的門檻**（Backend job 裡排在 fmt 之前）：

```bash
cd .. && typos          # 錯字；白名單在 .typos.toml
cd .. && cargo shear    # 未使用的 Rust 相依
```

`typos` 會掃**變數名**，不是只掃註解與字串。實際擋過：把 `NaiveDate` 的區域變數取了個
兩字母縮寫名，它判定那是某個英文字漏字母 → Backend job 直接紅，而 fmt/clippy/測試全綠。
命名時避開看起來像英文字缺字母的兩字母縮寫，寫完整的字。

⚠️ 它掃**整個 repo**，`.md` 也在內——包含用來說明這件事的文件本身。所以這裡刻意不把
那些會被判定成錯字的字面寫出來；要寫就得進 `.typos.toml` 白名單，而那個白名單只放
真正被誤報的字，不該為了寫說明而放寬。**一定要 `cd` 到 repo 根目錄跑**，在 `backend/`
底下跑會漏掉根目錄的 `.md` 與 workflow 檔（這個錯我犯過一次）。

⚠️ **`cargo audit` 要在 repo 根目錄跑，不是 `backend/`。** `Cargo.lock` 在 workspace root
（根目錄的 `Cargo.toml` 是 `[workspace] members = ["backend"]`），在 `backend/` 下跑會得到
`error: not found: Couldn't load Cargo.lock`。

```bash
cd .. && cargo audit    # 目前有 3 個既有的 allowed warnings（unmaintained 類），exit 0
```

**覆蓋率不等於測試有效。** `cargo mutants --file <單檔>` 約 4 分鐘，判準是「錯了會不會安靜
地錯」——實例：`handlers/vitals.rs` 覆蓋率 98.67%，變異分數卻只有 43%，抓出「驗證鏈的 `&&`
全部可換成 `||` 而測試照樣綠」與「p75 的 offset 算式可任意改動」兩個洞。設定與使用時機寫在
`.cargo/mutants.toml`。**不要全 repo 跑**（三個半小時，且結果會被沒打算測的整合層稀釋）。

⚠️ **這個專案用 oxlint，不是 eslint。** 跑 `pnpm exec eslint` 會失敗（沒有 eslint config），
而且曾經有人（AI）一整個 session 都在跑錯的 linter 卻以為自己在驗證。

⚠️ **`--max-warnings 0`。** 存量警告已經清空，不要讓它回頭長回來。
`pnpm lint` 這個 script 沒帶門檻，別拿它當 CI 的代理指標。

`scripts/hooks/pre-commit` 會依暫存檔類型條件觸發上面最常爆的那幾項（ts/tsx → tsc + oxlint；
`backend/*.rs` → clippy）。commit 前不必自己重跑一遍。

## 部署

```bash
./scripts/deploy.sh            # 前後端都重建
./scripts/deploy.sh frontend   # 只動前端時
./scripts/deploy.sh backend    # 只動後端
```

使用者已授權助手直接執行部署，不需要每次徵詢。

⚠️ **不要直接下 `docker compose up -d --build`**。那樣 `VITE_RELEASE` 會是空的，
而且不會上傳 source map —— GlitchTip 上的前端 stack trace 就全是 minify 過的
（`t.f is not a function`、行號指向某個 40 萬字元的單行），等於錯誤追蹤白裝。

腳本管的是**順序**：commit → build（release 烤進 bundle）→ up -d → 上傳 source map。
第 2 與第 4 步的 release 對不上時，GlitchTip 找不到對應的 map，而**不會有任何錯誤訊息**。
寫這支腳本的當天就踩過一次（build 用 commit 前的 SHA、上傳用 commit 後的）。

source map 刻意**不放 CI**：CI 建的產物不是部署的那份（CI 上沒有 VITE_RELEASE 與
VITE_SENTRY_DSN，bundle 內容不同 → 檔名 hash 不同 → 對不上）。

⚠️ 資產檔名帶 content hash，重新部署後舊 hash 會 404。目前 CDN 沒有快取 HTML 所以無妨；
**若哪天讓 CDN 快取 HTML，部署後必須清 CDN 快取**（等新容器 healthy 之後才清）。

## 內容管理

部落格 CMS 一律透過 `koimsurai_*` MCP 工具操作，不要直接 curl admin API。
送出 MDX 前先跑 `koimsurai_validate_mdx` —— MDX 編譯失敗在前台是**靜默退回 markdown**
（讀者看到裸標籤），而 create/update 仍然回 success，不驗就沒人知道寫壞了。
