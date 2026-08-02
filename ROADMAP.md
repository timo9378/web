# sora-to-ki 剩餘工作 Roadmap

> 2026-07-15 盤點。大遷移（P1 全TS / P2 SSG / P3 Rust / Express 退役）已完成。
> 本檔＝剩餘工作總覽，含 Nitro/specta 兩份既有計畫 + 生產強化清單的**誠實分級**。
> 原則：對**個人站**分級，不照搬企業級 checklist。標 ❌ 的是刻意不做（附理由）。

---

## 2026-07-20/21 全專案架構審查 + 一輪還債（安全/清理/測試/備份）

4-agent 平行架構審查（前端 / Rust 後端 / 建置部署 / 程式碼品質）→ 綜評 **7.2/10（B+）**。
拉分項＝測試幾近零 + 一個現行 SSRF；其餘多是「遷移收尾沒清戰場」的殭屍檔/死依賴。
下列全部已 commit（8 個，未推送；trailer 已依要求剝除）：

**安全**
- **image-proxy SSRF 堵**（`net_guard` 模組）：scheme 白名單 + 私網/迴環/CGNAT/IPv6-ULA 封鎖 +
  連線後對 peer IP 再驗（防 DNS rebinding）+ 僅代理圖片 Content-Type + 20MB 上限 + 回應加 CSP/nosniff
  （堵惡意 SVG）。link-preview 的既有防護抽成共用模組。
- **JWT 強制 exp**：移除 `required_spec_claims.clear()`，不帶 exp 的 token 一律拒絕（原本永不過期）。
- **DB 錯誤原文不外洩**：`AppError` 的 Database/Upstream/Anyhow 改回泛用訊息、原文只進 log；75 處手排
  `e.to_string()` 外洩改用 `internal_error` helper（`#[track_caller]` 記呼叫點）。
- **整合測試第一天抓到真漏洞**：`http://[::1]/` IPv6 字面量 `host_str()` 帶方括號 → parse 失敗 → IP 檢查
  被靜默跳過（v6 SSRF 繞過）。已修（剝括號再 parse）+ 測試釘住。

**測試安全網（Express 對拍 oracle 退役後的接棒）**
- **sqlx migrations**：`backend/migrations/0001_init.sql` baseline（Express `database.js` DDL + 歷次 ALTER
  折疊 + Rust 期新表，全 `IF NOT EXISTS`）——退役後首個 schema 管理。main.rs 開機自動跑 + WAL + `create_if_missing`。
- **router 抽取**：120 端點路由表 → `backend/src/router.rs::build_router(state)`，測試與正式同一條組裝路徑。
- **15 個後端整合測試**（`backend/tests/api.rs`，in-memory SQLite + tower `oneshot`）：公開讀寫、admin 守衛、
  JWT exp/錯 secret、newsletter 全流程、SSRF 防護。
- **18 個前端 vitest**（`src/start-i18n.test.ts`）：locale 解析/hreflang/Accept-Language/bot 偵測/五語 key
  集合一致性/SSR instance 隔離。CI 加 `pnpm test`。

**清理**
- 刪 10 死依賴（prism 全家 4 / tsparticles×2 / @react-spring core+web / exif-reader v2 / dayjs）；重複的
  頂層 `overrides`（pnpm 不讀、且與 pnpm.overrides 矛盾）刪；殭屍檔刪（vite.config.js 12.5KB /
  stats.html 2.8MB / favicon.ico.bak / builder.config.ts / postcss.config.cjs）。
- `src/i18n.ts` 退役（LOCALE_LABELS 併入 start-i18n）；`src/pages/BlogPostPage.tsx` 退役（Tier-2 後無人
  render，seoMeta 的 PostData 直接別名 api-types）；手寫 useInView 併入 react-intersection-observer。
- 文件歸檔 → `docs/archive/`（NOW / Setup / NITRO_MIGRATION_PLAN / TS_MIGRATION_HANDOFF）。

**基建**
- CI 補 `pnpm build`（build 壞了原本要到部署才知道）+ eslint `--max-warnings 404` ratchet（擋新增警告）；
  前端容器加 healthcheck（node fetch，slim 無 curl）。
- **DB 每日備份 sidecar**（`db-backup` service，alpine + sqlite）：`VACUUM INTO` 快照（WAL-safe、不阻塞
  後端寫入）→ gzip → HDD bind mount（`/mnt/hdd16tb_01/Blog/db-backups`，與 DB volume 不同碟），14 天輪替。
  **已實測還原**（integrity ok、22 表資料完整）。還原＝`gzip -dc db-*.sqlite.gz > db.sqlite`。
- 刪 legacy Express profile（`./server` 原始碼退役時已刪、build context 不存在、回滾路徑早失效）+ 孤兒
  `backend-db-backup` volume。

**修 bug**：相簿圖片管線在 EXIF 旋轉**前**讀寬高 → 直式照片（orientation 5~8）manifest `aspectRatio`
顛倒 → 瀑布流版面錯位。Rust gallery sync + TS builder 兩管線都修（TS 順手修 `size` 欄位＝輸入原檔 → 輸出 webp）。

---

## 已在做 / 已規劃（獨立計畫）
- **Nitro v3 遷移**：✅ **已完成並上線（2026-07-17）**。詳見 `NITRO_MIGRATION_PLAN.md`。
- **specta 型別遷移**：✅ **完成（2026-07-19）**。所有 typed-able 讀取端點 typed 化 + 生成型別，
  前端「當 typed data 讀」的手寫 interface → 零。剩下刻意不 typed 的透傳/動態端點（watch
  favorites/heartbeat/now、github/wakatime/steam proxy、gallery manifest、quote/daily、寫入
  mutation 回應）保留手寫型別（後端回動態 `Value`、serde_json feature 沒開）。詳 `backend/SPECTA_PLAN.md`。
- **B7 TanStack Query 全面導入**：✅ **完成（2026-07-19）**。見下方 B7。
- **collection 收藏站退役**：✅ **完成（2026-07-19）**。後端 handler+路由 + 前端 CollectionManager+nav
  全刪，/api/collection/* 現 404（`collection_items` 空表保留）。
- **3D 背景 WebGPU/TSL 重寫**：✅ **完成並轉正（2026-07-19，單日 strangler）**。舊 pmndrs 雙 canvas
  棧退役（五檔刪除 + @react-three/offscreen 下船）。新架構：單 canvas、three r185 WebGPURenderer
  （WebGL2 自動 fallback）、自製 worker entry（純命令式無 React）、26k 顆 Sprite-instancing 星
  （全 shader 閃爍/柔光）、mrtNode selective bloom、土星完整移植。成果：**GPU 85-90% → 25%、
  眼測 99% 相似、亮核保留 114%**。詳 vault「web 3D 背景 — WebGPU 重寫決策」（含踩坑錄）。
  ⏳ 殘留：ZeroGravityLibrary（書櫃零重力）仍用 fiber/drei/pmndrs——該四依賴待其遷移後移除。
- **Express strangler 死鷹架清理 + newsletter 遷移補完**：✅ **完成（2026-07-19）**。稽核發現 Express
  雖已退役，但程式碼留大量死 proxy 鷹架（proxy 模組 + 96 個 `.fallback(proxy_to_express)` + `upstream`
  plumbing），且「發佈即推送 newsletter」是**漏接的遷移**——`admin_create/update_post` 仍整包委派死
  Express（→ 404），儘管 Rust mailer 早已存在。→ 補完 newsletter（改呼叫 Rust `dispatch_newsletter`）、
  刪盡 proxy 鷹架（未接管方法改回標準 405 + Allow header、全域 not_found）。詳 git `fix(newsletter)` /
  `refactor(backend)`。
- **Bun 化**：延後至 Rust 版 stable（見 vault 決策；現在青黃不接期）。

---

## 交接：Nitro 遷移收尾後的未完事項（2026-07-17）

遷移本身已完成上線（serve.mjs 退役、ISR + on-demand revalidation 運作中、image 3.35GB → 759MB）。
過程順手修掉三個**無聲失效**的既有缺陷：全站 `<title>` 重複且無 description、og 標籤從沒進過
SSR（社群預覽一直是壞的）、`public/sitemap.xml` 是 2026-02-11 的 0 篇文章死清單。

### 仍未做（有意識的決定，不是遺漏）

| 項目 | 狀態與理由 |
|---|---|
| **`/watch/library` 補 loader** | **決定不做**。全量 1,174 筆（anime 997 + film 96 + tv 81）、JSON 279KB；照 `/watch` 的 ~360 bytes/筆推估，SSR 會產出 ~420KB HTML + 279KB 水合資料 ≈ 700KB。這是有分頁/排序的瀏覽 UI，SEO 增益相對 `/watch`（已 SSR 最近 200 筆）很邊際。title/og 已有。 |
| **`/activity` 補 loader** | **決定不做**。抓的是 Steam/health 即時儀表板，baked 進 HTML 只會是過期快照，SEO 無價值。 |
| **`/music` 的 now-playing** | **刻意排除在 loader 外**。30 秒輪詢的即時狀態，配 ISR 1h TTL 會讓爬蟲與首屏永遠看到錯的「正在播放」。其餘（recently-played/top-genres/top-tracks）已 SSR。 |
| **ISR 快取在記憶體** | 未掛 fs driver。**每次部署／重啟快取歸零**，之後首批請求要冷 render（實測 40–190ms）。流量不大時無感；要跨重啟存活需掛 unstorage fs driver + volume。 |
| ~~**後台 CollectionManager + 後端 `/api/collection`**~~ | ✅ **2026-07-19 全退役**（使用者拍板「刪」）。後端 handler/路由/mod + 前端 CollectionManager/route/nav 全移，/api/collection/* + /api/sync/collection 現 404。`collection_items` 空表保留（drop 是另支破壞性 migration）。 |
| **`nitro-migration` 分支** | 已 merge 進 main，分支保留當歷史紀錄；worktree 已移除。 |
| **GitHub dependabot 警告** | push 時 GitHub 回了安全警告連結，沒看過。 |

### 已知的既有缺陷（未修）

- ~~**其餘頁面的 `<SEOHead>` 仍是 helmet**~~ ✅ **2026-07-18 全面退休**：所有 16 個 `<SEOHead>`
  用法清除、`SEOHead.tsx` 與 `HelmetProvider` 刪除、`react-helmet-async` 依賴移除。
  所有頁面的 title/description/og 一律走 `head()` 進 SSR；文章頁的 BlogPosting JSON-LD 也搬進
  `head().scripts`（首次進 SSR）。順手補了兩個原本沒 SSR meta 的頁：首頁（原本 head() 只出 links、
  SSR 零 og/description）、404。
- ~~**`friends`/`messages`/`history`/`about-site` 沒進 `pageSeo` 表**~~ ✅ **2026-07-18**：四頁補進
  `PAGE_SEO`（用 `info.*.title` / `info.*.subtitle`，五語系齊全）。
- **`/watch/library`、`/activity` 等頁 SSR 仍是空殼**（見上，刻意）。
- **`no-unnecessary-type-assertion` eslint error ×4**（Music/Thinking/ThinkingDetail/Watch）：
  跟 Blog.tsx 同一個 `(useLoaderData({strict:false}) as {...})` 慣例。**但不是每個都能移除**——
  strict:false 回傳跨路由 union，斷言在 narrow 到本頁 loader 形狀。Blog（`posts` 別頁沒有）已安全移除；
  Bookshelf（`stats` 會跟 Watch 的 `WatchStats` 混）驗出斷言**必要**、加了 eslint-disable 註解。
  剩下 4 個要各自 probe（移除後跑 tsc，若別頁 loader 有同名欄位就是必要的、不能移）。
- **未做：`WebSite`/`Organization` JSON-LD（root head）** —— TanStack SEO 文件建議在 `__root` 出
  站台級結構化資料，正好對應 `[[project_koimsurai_seo_brand]]`（Koimsurai 被辨識成 Katsurai）的解法。
  這次只搬了文章級 BlogPosting，站台級留待品牌 SEO 那批一起做。

### 驗證方法的坑（吃過大虧，寫給下一個 session）

- **SSR 輸出含 null byte** → `grep` 當 binary 處理、**靜靜輸出空字串（不是 0）** → 大量假陰性。
  查 SSR 內容一律 `grep -a`。
- **`grep -c` 在單行 JSON 上只會回 0/1**（它數的是「符合的行數」），別拿來當筆數。
- **管線會吃掉 exit code**：`cmd | head` 的 `$?` 是 `head` 的。`pnpm exec tsc … | head` 會讓失敗看起來像成功。
- 別拿兩個可能為空的變數互比（`[ "$A" = "$B" ]` 對兩個空字串成立 → 印出假的「✓ 通過」）。

---

## 生產強化清單（分級）

### 🟢 A — 真缺口 + 高價值低成本（優先做）

> **✅ A1 大半完成（2026-07-21）**：HSTS + nosniff + X-Frame-Options + Referrer-Policy 已上（nginx
> server block，並在 `/uploads/`、`/nas-images/` 補 nosniff——nginx 的 add_header 不被自帶 add_header 的
> location 繼承）。**剩 CSP 未 enforce**：`__root` 有 inline intro/no-flash script，要先 nonce 化才能上
> CSP（否則打壞站），到時 `Content-Security-Policy-Report-Only` 先觀察。Permissions-Policy 可隨 CSP 批次補。

**A1. nginx security headers** — ✅ **HSTS + 4 零風險 header 已上（2026-07-21）**，CSP 待 nonce 化
原況：只有 cache-control + SSL。現已補 HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy。
剩 CSP（耦合 __root inline script，需 nonce）+ Permissions-Policy（隨 CSP 批次）。

**A2. i18n ja/ko 補完 — ✅ 完成（2026-07-19）**
盤點結果：`common.json` 五語系（zh-TW/zh-CN/en/ja/ko）**391 個 leaf key 全齊、零缺零多**；組件
內嵌翻譯（History 的 MILESTONE_TEXTS/UPTIME_UNITS/HISTORY_EXTRAS 等）也早補齊 ja/ko——原 ROADMAP
的「不完整」已過時（那之後補過）。全掃唯一真缺口：`seoMeta.ts` 的 `LOCALE_TO_OG` 漏 `ko → ko_KR`
（韓文頁 og:locale 會 fallback 錯）→ 已補。**價值：中高（5 語一致性）已達成。**

### 🟡 B — 真缺口 + 中價值（值得做，不急）

**B1. CI（GitHub Actions）+ E2E**——注意是 CI 不是 CD
現況：web repo 無 workflow（anigamer 有）。
做法（分層，跑的頻率不同）：
- **每 push（快、必過）**：`tsc --noEmit` + `eslint` + `cargo test`（backend+anigamer）+ `cargo clippy` + build 驗證。
- **E2E（全覆蓋，Playwright）**：主要**本地一鍵跑**（改動後回歸）；若上 CI 則 PR/nightly（docker compose 起 stack + fixture DB），不放每 push（慢/flaky）。
- **deploy 維持手動**（self-host + 自主權，不做自動 CD）。
E2E 選型：**Playwright**（見下註）。成本：半天 CI + 持續補 E2E。價值：中。

> **E2E 選型（2026 查證）**：**Playwright 仍是預設最佳**（State of JS 2025 滿意度 91% vs Cypress 72%、免費並行、self-host CI 友善、8-core 跑 15-30 並發）。你**已有投資**（.mcp.json Edge 設定 + P2 用過 + 本 session 用 Playwright MCP 做過 koimsurai 煙測）。2026 的進步不是換框架，是 **Playwright + MCP（AI 輔助寫 locator，省 ~25% 寫測時間）——你已經在用**。新競品（Autonoma/Stagehand）偏 SaaS，不合自主權。**繼續 Playwright，不換。**

**B2. 測試分兩層（vitest 純邏輯 + Playwright E2E 全覆蓋）**
現況：後端有測試（og + anigamer 32），前端零。
- **vitest**：純邏輯（i18n locale 解析 / LocaleLink query·hash / captcha loose-eq / 日期）。不測 UI 渲染。
- **Playwright E2E 全覆蓋**（使用者定調，修正原「只 smoke」）：理由＝**AI 改重要 CSS 可能不去測其他頁**（AI 高頻改動的回歸保護網）。全頁覆蓋、**本地一鍵跑**取代手動點。已有 .mcp.json + 本 session 用過。
- **cargo test 後端擴充**（現在僅 og，補關鍵 handler）。
成本：持續累積。價值：中高（AI 改動保護）。

**B3. 內文圖片 WebP + 響應式 — ✅ 結案：實查後已滿足，無事可做（2026-07-19）**
全面稽核：內文上傳圖 **21/21 全 webp**（最大 93KB——編輯器貼上路徑本就產 webp）；照片牆
**494/494 全 webp + 每張 `-thumb.webp` + manifest**；文內 nas-images 引用全是 thumb（6-38KB）；
**待回溯舊圖 = 0 張**。srcset 對 ≤93KB 的 webp 無肉。原 ROADMAP 的「缺 auto-webp」不成立。
微殘留（備忘不做）：upload handler 收什麼存什麼——未來若真傳大 PNG/JPEG 才需要 server 端轉檔。

**B4. 前端 Core Web Vitals 埋點 — ✅ 完成（2026-07-19）**
`web-vitals` lib（LCP/CLS/INP/FCP/TTFB）→ sendBeacon → **自己的 Rust `POST /api/vitals`** →
SQLite `web_vitals` 表（啟動冪等建表）→ `GET /api/vitals/stats` 聚合自看（count/p75/rating 分佈，
`?days=N`）。無 auth beacon 但嚴格白名單+值域夾制、非法靜默 204（不給探測回饋）、零 PII
（無 IP/UA）。端到端驗證：真瀏覽器一訪五 metric 全落庫。
分工achieved：GlitchTip = error+後端 perf；web-vitals = 前端 CWV。兩塊都自主、不碰 GA4。

**B5. 字型子集化 🔸 降級（查證後，大半不需要）**
現況查證：**CJK 全靠系統 fallback**（`--cjk-font` per-locale：MiSans/Source Han/Noto/PingFang…系統字型），只有拉丁 TASA variable 自託管。
→ **webfont-dl 對你沒用**（你沒用 Google Fonts CDN，它沒東西可下載）；**CJK 不用分片**（沒自託管，cn-font-split/vite-plugin-font 用不到）。你的字型架構**已經對了**。
剩下：拉丁 TASA 子集化+preload（variable font 本來一檔，價值有限）。**小事，有空再說。**
（CJK 若哪天要自託管，正解=`vite-plugin-font`（cn-font-split，Rust 寫的）。）

**B6. API 文件 utoipa + Scalar — ✅ 完成（2026-07-19，全 120 端點）**
✅ 公開讀端點（11 個 GET）+ 23 個 response struct `utoipa::ToSchema`（與 specta::Type 並存、型別單一來源）→ `GET /api/openapi.json`（自架 spec）+ `GET /api/docs`（**utoipa-scalar 原生整合**）。
📌 **順帶把 axum 0.7 → 0.8 升掉了**：utoipa-scalar 綁 axum 0.8，我原本以為升 0.8「大破壞」→ **實測後發現是誤判**：0 個編譯錯誤，唯一 breaking = route param 語法 `/:id` → `/{id}`（26 條 route 字串機械替換）+ tower/tower-http 連動升版。全端點 runtime 實測（公開讀/{id}{name} 提取/admin token）都 200。教訓：**別憑印象講「大破壞」，先 build 一次量測**。
⚠️ Scalar UI 的 JS 仍走 jsDelivr CDN（utoipa-scalar 預設如此，非自架選擇）；spec 本身自架。要全自主可覆寫成自託管 Scalar JS（小事、待辦）。
✅ **全數完成**：admin/mutation/第三方 proxy 共 ~90 端點補齊（typed 給 schema、動態 Value 給 path-level +
security）。openapi.rs 的 paths/schemas 改由 annotations 機械收集重生。校準黃金樣板 → 5 subagent
平行標註 → 中央組裝 → clippy 一次過。/api/openapi.json 120 operations、/api/docs 正常。
成本：已付清。價值：中（自己 debug + 完整 API 面地圖）。

**B7. TanStack Query 導入 — ✅ 完成（2026-07-19）**
全公開/內容/admin 面的 page-data 讀取都改 useQuery（吃 specta 生成型別）：首波 7 頁 + widget 群
+ WatchLibrary/CommandPalette/Unsubscribe + BlogPost（消 loader×元件雙抓、淘汰 articleCache）+
LinkCard + 12 個 admin 管理頁（用 mint OWNER token Playwright 實測）。SSR 走 loader ensureQueryData
→ dehydrate → hydrate 模式，正式域每頁 `grep -a` 驗 SSR 內容還在。剩下純 useEffect+fetch 的只有合理
不遷的：AuthContext(session)、monaco(編輯器內部)、ImageLightbox(自帶快取 lib util)。下為原評估存查：

**（原評估 2026-07-18）— 一半好處 Router loader 已內建**
現況：前端**沒有** react-query（git 全歷史零命中，從沒裝過；`useQuery` 0 次）。資料抓取＝
Router loader（SSR 首屏）+ 元件內 raw `fetch`/`useEffect`（~30 個元件）+ 手寫 loading state（18 個）
+ setInterval 輪詢（資料相關 5 個：Activity/Music/Bookshelf/Watch/History）。

**關鍵拆分**（context7 查證 Router loader 快取）——想要的好處不是都要 Query：
- **返回瞬讀 + 保留捲動 + staleTime 省流量 → Router loader 已內建**。loader 有 `staleTime`/`gcTime`、
  跨導覽以 pathname+params 快取、`staleReloadMode:'background'`（stale 先 render、背景重抓）、scroll
  restoration。現在 `staleTime:0`；把常靜態頁（blog 列表/bookshelf…）設 `staleTime:5–10min` 即得。
  **設定改動，非重構。** ⚠️ 但元件自己的 useEffect 重抓 + setInterval 不受 loader 快取管，要真省流量
  得一併處理那部分（＝Query 或手動拆）。
- **切分頁回來背景更新（window focus refetch）→ Router 不內建**：~10 行 `focus → router.invalidate()`
  或 Query 的 `refetchOnWindowFocus`。且「作者改字讀者無感更新」伺服器端已有一半＝`revalidate.rs`
  發文清 ISR。
- **消 18 個 loading 樣板 + 5 個輪詢 → 只有 Query 給**（不可替代的 DX 贏）。

規模與風險：~30 個 `useState+useEffect+fetch` 改寫成 `useQuery`。**必須**走 loader 灌 queryClient →
dehydrate → hydrate 的 SSR 模式，**接錯 → SSR HTML 空掉（SEO 回歸）且瀏覽器看起來正常**（隱形回歸，
正是本輪吃過三次的失敗模式）→ 每頁 `grep -a` 驗 SSR 還有內容。

**排程（兩步）**：
1. **（低成本，可先做）** loader `staleTime` 調校 → 拿到返回瞬讀 + 導覽層省流量。
2. **（B 級，跟 specta 綁）** 全面 Query 導入 → 拿到 window-focus 更新 + 消樣板。與 specta 同批，
   因兩者都碰那 ~30 個 fetch 點；specta 先給 typed 回應 → Query hook 直接 typed，不必動兩遍。
成本：步驟 1 小、步驟 2 中大。價值：中（DX + 部分 UX；核心 SSR/SEO 已由 loader 達成）。

### 🔴 C — 個人站 cargo-cult（建議不做，附理由）

**C1. Sentry / LogRocket ❌ → 但 GlitchTip ✅（2026-07-15 修正）**
原否決 Sentry 理由＝第三方 SaaS 違自主權。使用者指正：**GlitchTip = self-host 版 Sentry**（Sentry SDK 相容、只 4 容器 vs Sentry 40+、1GB RAM 可跑），**破解自主權顧慮**。
→ 改為 **B 級可做**：GlitchTip 自架收 **error + 後端 transaction perf**。
**兩全方案（2026-07-15）**：用 Sentry 官方 **`sentry` Rust crate**（使用者喜歡的 DX）+ DSN 指向自架 GlitchTip（Sentry 協定相容）＝喜歡的 crate + 4 容器輕量，不忍 Sentry 40+。error 一定收、performance transaction 要實測。
⚠️ 但 GlitchTip 的 perf 是**後端 transaction 級，不含前端 Core Web Vitals（LCP/CLS/INP）**——那塊見 B4。
Sentry SaaS / LogRocket 仍 ❌（GlitchTip 已覆蓋且自主）。

**Uptrace ❌（2026-07-15 評估）**：OTel-native full observability（traces+metrics+logs，ClickHouse+Postgres）。錯配——① 你要 error+web-vitals，它是 distributed tracing（強在你沒有的微服務/billions spans）② 無前端 RUM/web-vitals ③ ClickHouse 比 GlitchTip 重（你嫌肥的顧慮更嚴重）。吸引點=OTel + Rust tracing crate 整合正統，但那條路本質要付 ClickHouse 成本，個人單體站不划算。同 Redis 判斷：能力遠超 problem 規模。留給未來真多服務。

**C2. CSRF 保護 ❌**
理由：你的 auth 是 **JWT Bearer token**（`Authorization` header），不是 cookie session。CSRF 攻擊利用「瀏覽器自動帶 cookie」，Bearer token 要 JS 主動加 header、跨站拿不到 → **Bearer 架構對 CSRF 天然免疫**。加 CSRF token 是對著不存在的攻擊面防禦。清單裡的 cargo-cult，**不做**。

**C3. helmet.js ❌**
理由：那是 Express 中介層，功能＝設 security headers。你的等價＝A1（nginx 層做，更該在那做）+ Rust 已有 CORS/nosniff。**不需要 helmet。**

**C4. husky + lint-staged + commitlint（整套）🔸 降級 → 極簡版 ✅ 完成（2026-07-19）**
理由：整套是團隊協作工具（強制多人遵守），單人 CP 值低。**採極簡版**：`scripts/hooks/pre-commit`
（**版控**、非 `.git/hooks` 隱形檔）條件觸發——動到前端 ts/tsx 才跑 `tsc --noEmit` + `eslint src --quiet`，
動到後端 rs 才跑 `cargo clippy -D warnings`；`git commit --no-verify` 可跳。以
`git config core.hooksPath scripts/hooks` 啟用（**重 clone 需重跑一次此指令**）。不裝 husky/commitlint 生態。

**C5. 自動 changelog ❌**
理由：你沒有 versioned release（個人站持續部署）。changelog 是給「有 release cycle + 使用者」的專案。你的「history」頁 + git log 已足夠。**不做。**

**C6. 應用層 rate limiting 🔸**
理由：**CrowdSec 機器層已 active**（入侵/掃描防護）。應用層 rate limit（如登入嘗試）可補一個薄的（Rust 端對 /auth/login 計數），但不是急件——你流量小 + CrowdSec 兜著。低優先。

---

## 架構還債 backlog（2026-07-21 盤點，審查後剩餘）

> 審查綜評 7.2 → 目標甜蜜點 **9.0–9.3**（有安全網、無已知漏洞、無殭屍；再往上是單人站的邊際保險）。
> **原則**：純拆檔若降不了耦合＝只是把行搬到別的檔，價值有限 → 優先解耦或修真問題。

### 🟢 高價值 + 需在場邊改邊看（下次一起做）
- **拆 BlogPost.tsx（1933 行 god-component）**：85 hook + ~18 個內部元件（Mermaid 三件組 / CodeBlock /
  TOC / Reactions / SeriesNav / SubscribeModal…）。審查最顯眼的單一 god-component。⚠️ 前端零元件測試 →
  拆分只有 tsc/build 接得住編譯錯、接不住 runtime UI 行為 → 需在場驗證（故不在無人看管時做）。
- **auth 守衛 extractor 化**：`require_admin` 現為 **46 個手動呼叫點**（忘了呼叫＝安全漏洞，審查點名的
  forget-prone）。轉成 axum `FromRequestParts` extractor → 編譯期保證有守衛。⚠️ 46 點樣態不統一
  （`?` / `if let Err` / 吃整個 Request 的 upload / macro / `parts.headers`），逐一轉需在場避免留半成品；
  已有 admin 守衛整合測試護著（401/200/exp/錯 secret）。

### 🟡 中價值 + 需先解耦再拆（不急）
- **後端 admin.rs（1554）god-module**：拆分價值仍在，但一樣要先找到獨立子域再動。
  ~~watch.rs（1162）~~ 已於 2026-08-02 隨 Trakt 移除縮到 **880 行**——當初判斷「最乾淨的切割邊界
  是 Trakt 整合（token 狀態機 + 輪詢 + 同步 ~400 行）」是對的，只是實際發生的是整段刪掉而不是搬走。
  剩下的部分（公開讀 / TMDb / favorites / heartbeat）耦合不重，暫時不值得再拆。
- **components/ 頂層 129 檔平鋪** → feature 資料夾分組。
- **狀態快取加 TTL**：`WatchState.tmdb_detail` / `SpotifyState.audio_features` 無 TTL 無淘汰（個人站流量下
  是慢性洩漏非災難，但該補 moka 或過期戳）。
- **blog/$id 兩對重複 loader**（default vs $locale，各 ~40 行近乎相同）抽共用。

### 🟢 低成本雜項（有空就清）
- **燒 eslint 警告**（現 404，`--max-warnings` ratchet 已擋新增）：大宗＝no-unnecessary-condition 143 /
  no-forward-ref 67（React 19 deprecation）/ set-state-in-effect 50 / 未清 setTimeout 13。分批降 max-warnings。
- **重啟 a11y lint**：jsx-a11y 因 ESLint 9 flat config 相容 crash 被停用 → 換相容 fork 或等上游修。
- **上 Prettier**（目前無 formatter，格式全靠人肉）。
- **collection_items 空表**：Rust 無端點使用，決定 drop（破壞性 migration）或留著對齊。
- **8.4MB `public/videos/Web_video.mkv` 進了 git** → 移 NAS/LFS（要你決定改由 nginx 直接服務還是 LFS）。
- **`heic-convert` / `jsonwebtoken` devDep**：repo 零引用，疑 `../ai-tagger` 用 → 確認後決定刪否。
- **`mutagen.yml`** 疑過期的開發同步設定（backend 現為編譯 binary、非 code-sync）→ 確認是否還用。

### 🔵 生產強化（階段四，持續投入）
- **可觀測性**：GlitchTip（error + 後端 perf，見 C1）尚未架；後端有 tracing 但無集中收集。
- **自動部署到 staging**（見「架構決策」）：CI 綠燈 → build + compose up；prod 仍手動 promote。
- **backend Dockerfile cargo-chef 快取層**（現在改一行原始碼全量重編所有 crate）。
- **Nitro 脫離 beta 釘選**（`3.0.260610-beta` 被 yank 會斷 `--frozen-lockfile` build）。
- **Renovate/Dependabot** 自動依賴更新（取代手動 overrides 打地鼠）。
- **型別契約收尾**：utoipa `schemas()` 與 specta register 是兩份手動平行清單 → 合一（只 specta 那份受 CI 守）。
- **Playwright E2E**：全頁覆蓋、本地一鍵跑（見 B2；本 session 只補了 vitest 純邏輯）。

---

## 建議施工順序

1. ~~**A1 security headers**~~ **⏸ 延後**（2026-07-19 使用者決定：等架構定案；HSTS 已批准、CSP 待評估）
2. ~~**Nitro 遷移**（Phase A→E，含 OG/PWA/ISR 收尾）~~ ✅ 2026-07-17 完成上線
3. **specta ✅ 完成（2026-07-19）／ utoipa（B6）未動**
   - ✅ specta 全 typed-able 端點：posts/admin/comments/books/newsletter/watch/home/stats/series，
     前端全面 useQuery 吃生成型別（見 B7）。多輪抓到「build 過、200、但功能從沒生效」的既有缺陷
     （allow_comments、列表 excerpt 全空、後台按鈕、summary 死路、github private commit 洩漏…）。
   - ⏳ **utoipa 還沒動**（原計畫跟 specta derive 同批，目前只做了 specta）→ 這是 B6，剩下的一半。
4. ~~**A2 i18n 補完**~~ ✅ **完成（2026-07-19）**（原已幾乎補齊，只差 seoMeta `ko→ko_KR`）
5. ~~**B1 CI + C4 極簡 pre-commit**~~ ✅ **完成（2026-07-19）**（B1 GitHub Actions 兩 job 全綠；C4 版控 pre-commit hook）
6. ~~B3 圖片~~ ✅ 2026-07-19 實查結案（全站圖早已 webp 化，零舊圖待轉）；~~B4 vitals~~ ✅ 2026-07-19；B5 字型幾乎免做
   另：~~dependabot 漏洞~~ ✅ 2026-07-19 清零（11→0，幽靈依賴 vite-plugin-purgecss 移除 + overrides）
7. **B2 前端測試**（持續累積，不衝刺）

**2026-07-19 大掃除後現況**：A1 安全 header 為唯一剩下的成塊工程項（架構已定案可解凍）；
utoipa(B6)/vitals(B4)/圖片(B3)/i18n(A2)/漏洞 全清。B2 測試為持續型。ZeroGravity 拔除待決。

**明確不做**：Sentry SaaS（改自架 GlitchTip）、C2 CSRF、C3 helmet、C5 changelog、husky/commitlint 生態、**Redis（見下）**。

---

## 架構決策（2026-07-15）

### Staging 測試環境 + CD-to-staging ✅（修正原「不做 CD」）
原「不做 CD」講太死——那是指「不自動部署 prod」。正確模式：**CD 到 staging（自動）+ 手動 promote prod**。
- dev 子網域（CF）+ 獨立 docker compose（frontend+backend-rs+DB）
- E2E 跑 staging 不碰 prod；prod 控制權不失
- ⚠️ **真工程＝DB 資料策略**（不用 prod DB：seed fixture 或定期 sanitized 複製）——基礎設施不難，資料策略要想
- prod 仍手動 cutover（自主權）

### Redis ❌（現在不引入）
無非 Redis 不可的需求：JWT stateless（無 session store）、in-process cache 單機夠、Nitro ISR 用 **fs driver** 持久化、rate limit CrowdSec。
引入＝多養服務+故障點+破壞 SQLite 單機哲學。
**何時值得**：真多實例 / ISR 量大到 fs 不夠 / 要 pub/sub。現在都不是。
