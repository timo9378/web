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
cargo llvm-cov nextest --locked --fail-under-regions 12
cargo audit
# specta：改過會進 API 的 struct 就要重跑 export_types 並提交，否則 drift gate 會擋
```

⚠️ **這個專案用 oxlint，不是 eslint。** 跑 `pnpm exec eslint` 會失敗（沒有 eslint config），
而且曾經有人（AI）一整個 session 都在跑錯的 linter 卻以為自己在驗證。

⚠️ **`--max-warnings 0`。** 存量警告已經清空，不要讓它回頭長回來。
`pnpm lint` 這個 script 沒帶門檻，別拿它當 CI 的代理指標。

`scripts/hooks/pre-commit` 會依暫存檔類型條件觸發上面最常爆的那幾項（ts/tsx → tsc + oxlint；
`backend/*.rs` → clippy）。commit 前不必自己重跑一遍。

## 部署

```bash
docker compose up -d --build            # 前後端都重建
docker compose up -d --build frontend   # 只動前端時
```

使用者已授權助手直接執行部署，不需要每次徵詢。

⚠️ 資產檔名帶 content hash，重新部署後舊 hash 會 404。目前 CDN 沒有快取 HTML 所以無妨；
**若哪天讓 CDN 快取 HTML，部署後必須清 CDN 快取**（等新容器 healthy 之後才清）。

## 內容管理

部落格 CMS 一律透過 `koimsurai_*` MCP 工具操作，不要直接 curl admin API。
送出 MDX 前先跑 `koimsurai_validate_mdx` —— MDX 編譯失敗在前台是**靜默退回 markdown**
（讀者看到裸標籤），而 create/update 仍然回 success，不驗就沒人知道寫壞了。
