# P3 — 後端 Rust strangler（接力筆記）

> 把 Rust（axum + sqlx）擺在 Express 前面當前置代理，端點**逐個搬**、其餘原樣 proxy 回 Express。
> 動機＝正確性 + 技術棧一致 + 爽，**不是效能**（blog 非效能瓶頸）。
> 計畫全文：`web-ssg-poc/MIGRATION_PLAN.md` Phase 3。

## 架構

```
                 ┌─────────────────────────────────────────┐
  nginx /api/ ──►│ Rust (axum, :3002)                       │
                 │   ├─ 已接管端點 → sqlx → sqlite           │
                 │   └─ fallback  → reqwest 代理 → Express   │──► Express (:3001)
                 └─────────────────────────────────────────┘         │
                                  共用同一個 sqlite（WAL）◄───────────┘
```

- **🚀 已上線（2026-07-14）**：`nginx /api/ → Rust:3002`。指紋確認（接管端點無 X-Powered-By、
  未接管經 proxy 有）、/uploads//rss 完好、線上 body byte-identical、瀏覽器煙測 0 error。
  rollback：`sites-available/koimsurai.bak-enabled-20260714` 還原 + reload。
  ⚠️ 坑：`sites-enabled/koimsurai` 曾是**實體檔非 symlink**（與 available 漂移），已收斂回 symlink。
  ⚠️ 更正：enabled 版有 `location = /rss → Express`——線上 RSS 一直是活的（先前「前端 404」判斷
  是直打 13588 所測，經 nginx 不同）。`/rss` 為 app-level 路由，退役 Express 前要遷。
- **切換方式**：把 nginx `location /api/` 的 `proxy_pass` 從 `:3001` 改成 `:3002`，reload。
  Rust 沒接管的全部 fallback 回 Express，行為不變；接管的走 sqlx。可隨時 revert。
- **DB 共用**：Rust 與 Express 開同一個 sqlite。`/etc/.../web_backend-db-data` volume
  掛到 `/usr/src/app/db/db.sqlite`。Rust 容器化後要掛**同一個 named volume**。
- **DB 並發（已決策）**：單寫者-per-域（非真雙寫）。任一張表同時只有一個 process 寫、
  讀可重疊（WAL 罩）；兩邊都設 `busy_timeout`（Rust 端已設 5s）。schema migration 歸 Express
  一邊，避免 schema 雙頭。`/api/tags` 是純讀，零寫入競爭。

## 已接管端點（120 條，全部 byte-identical 對拍 + 指紋確認真接管）

| # | 端點 | handler | 驗證 |
|---|---|---|---|
| 1 | `GET /api/tags` | `handlers/tags.rs` | byte-identical |
| 2 | `GET /api/categories` | `handlers/categories.rs` | byte-identical |
| 3 | `GET /api/series` | `handlers/series.rs` | byte-identical（回應無 message 欄位）|
| 4 | `GET /api/series/:name` | `handlers/series.rs` | byte-identical |
| 5 | `GET /api/stats` | `handlers/stats.rs` | byte-identical（`days` 複製 JS 日期數學）|
| 6 | `GET /api/thoughts` | `handlers/thoughts.rs` | byte-identical（limit/offset 夾擠、`t.*` 顯式欄位、`edited`→bool、`ref`→parsed JSON）|
| 7 | `GET /api/thoughts/:id` | `handlers/thoughts.rs` | byte-identical + 404 `{"error":"not found"}` 一致 |
| 8 | `GET /api/posts` | `handlers/posts.rs` | byte-identical：分頁/搜尋/tag/category 過濾/sortBy/多語(`?lang=`) 全矩陣對拍 |
| 9 | `GET /api/posts/:id` | `handlers/posts.rs` | byte-identical：多語 + 2 種 404（找不到 / 該語無內容）|
| 10 | `GET /api/posts/:id/reactions` | `handlers/posts.rs` | byte-identical（空集合；型別 trivial）|
| 11 | `GET /api/posts/:id/comments` | `handlers/posts.rs` | byte-identical：**post 17 真實留言驗 14 欄 row 解碼** |
| 12 | `GET /api/thoughts/:id/comments` | `handlers/thoughts.rs` | byte-identical（重用 `posts::CommentRow`，post_id 改 Option 容 thought 留言的 NULL）|
| 13 | `GET /api/home/digest` | `handlers/home.rs` | byte-identical（純 DB；Express 60s 快取→資料同步時一致）|
| 14 | `GET /api/admin/tags` | `handlers/admin.rs` | **第一個 authed**：requireAdmin JWT 對拍，兩種 token 分支 + 各種錯誤全 byte-identical |
| 15 | `GET /api/admin/categories` | `handlers/admin.rs` | requireAdmin；裸陣列（含 created_at、JOIN 不過濾 status）|
| 16 | `GET /api/admin/users` | `handlers/admin.rs` | **requireOwner**；`{users}`。USER token→403「需要擁有者權限」、OWNER→200 全對 |
| 17 | `GET /api/admin/blacklist` | `handlers/admin.rs` | requireAdmin；`{blacklist}`（空表，型別 trivial）|
| 18 | `GET /api/admin/keyword-filters` | `handlers/admin.rs` | requireAdmin；`{filters}`（空表，型別 trivial）|
| 19 | `POST /api/auth/login` | `handlers/auth.rs` | bcrypt 驗 + 簽 7d JWT；錯誤路徑對拍、bcrypt $2a/$2b/$2y 相容、token 與 live Express 互通 |
| 20 | `GET /api/auth/me` | `handlers/auth.rs` | token 兩分支（OAuth→查 oauth_users+linked 解析 / legacy→admin 物件）；錯誤用 `{error}` key |
| 21 | `POST /api/auth/logout` | `handlers/auth.rs` | `{message:"ok"}` |
| 22 | `GET /api/auth/providers` | `handlers/auth.rs` | OAuth clientId/enabled（讀 env `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID`）|
| 23 | `GET /api/admin/posts` | `handlers/admin.rs` | 分頁；**動態 row→JSON**（`p.*` 全欄位 spread）+ tags/excerpt 覆寫（excerpt 用 UTF-16 substring）|
| 24 | `GET /api/admin/comments` | `handlers/admin.rs` | 分頁；動態 row→JSON（`c.*`+post_title）+ status counts |
| 25 | `POST /api/posts/:id/view` | `handlers/posts.rs` | view_count+1（**首個寫入**）|
| 26 | `POST /api/posts/:id/like` | `handlers/posts.rs` | likes+1 → 回新 likes |
| 27 | `POST /api/posts/:id/unlike` | `handlers/posts.rs` | likes-1（限 >0）|
| 28 | `POST /api/posts/:id/reactions` | `handlers/posts.rs` | emoji upsert（clamp 0；ALLOWED 6 emoji）|
| 29 | `POST /api/comments/:id/like` | `handlers/posts.rs` | comments.likes+1 |
| 30 | `POST /api/thoughts/:id/react` | `handlers/thoughts.rs` | 讚/倒讚 prev→next 差值（clamp 0）|
| 31 | `POST /api/posts/:id/comments` | `handlers/comments.rs` | **createComment**：author/content 必填→OAuth 偵測→captcha→IP 黑名單→關鍵字(reject/spam)→審核狀態→INSERT |
| 32 | `POST /api/thoughts/:id/comments` | `handlers/comments.rs` | 同 createComment（target=thought_id）⚠️ 見下方 broken-path |
| 33-35 | `POST/PUT/DELETE /api/admin/tags[/:id]` | `handlers/admin.rs` | tag CRUD（UNIQUE→409、404、`post_tags` 先刪）|
| 36-38 | `POST/PUT/DELETE /api/admin/categories[/:id]` | `handlers/admin.rs` | category CRUD（`gen_slug` 複製 JS 正則、改名同步 posts.category、刪除 set NULL）|
| 39-40 | `POST/DELETE /api/admin/blacklist[/:id]` | `handlers/admin.rs` | IP 黑名單（INSERT OR IGNORE）|
| 41-42 | `POST/DELETE /api/admin/keyword-filters[/:id]` | `handlers/admin.rs` | 關鍵字過濾（action 驗證預設 spam；Rust 不快取→天然等價 Express 的 invalidate）|
| 43 | `PATCH /api/admin/comments/:id/status` | `handlers/admin.rs` | 審核狀態（validStatuses；404）|
| 44 | `PUT /api/admin/comments/:id` | `handlers/admin.rs` | 改留言內容 |
| 45 | `DELETE /api/admin/comments/:id` | `handlers/admin.rs` | 永久刪除 |
| 46 | `POST /api/admin/comments/:id/reply` | `handlers/admin.rs` | 站長回覆（is_admin=1, author='站長', status=approved）|
| 47 | `POST /api/admin/thoughts` | `handlers/thoughts.rs` | 建碎念：refUrl→**unfurl**（regex 抽 og meta）、ref media→**TMDb enrich**、ref 直接覆寫 |
| 48 | `PUT /api/admin/thoughts/:id` | `handlers/thoughts.rs` | 編輯（edited=1）；clearRef／direct ref（**不** enrich）／refUrl 變更才重 unfurl |
| 49 | `DELETE /api/admin/thoughts/:id` | `handlers/thoughts.rs` | 連同留言刪；**Express 不回 404**（刪 0 列也 success），照抄 |
| 50 | `GET /api/admin/posts/:id` | `handlers/admin.rs` | 編輯器用：動態 row→JSON spread + source_language 覆寫 + available_locales + tags |
| 51 | `POST /api/admin/posts` | `handlers/admin.rs` | 建文：23 欄 INSERT（i18n×12/series/allow_comments）+ manageTags |
| 52 | `PUT /api/admin/posts/:id` | `handlers/admin.rs` | COALESCE/CASE-flag 語意逐字照抄；⚠️`category=?` 無 COALESCE（缺 key 也清 NULL）、tags 缺→清空關聯（Express 原樣）|
| 53 | `DELETE /api/admin/posts/:id` | `handlers/admin.rs` | 先清 post_tags 再刪；`{message:"文章已刪除",deleted}` |
| 54-60 | books 域：`GET /books` `GET/PUT/DELETE /books/:id` `POST /books` `GET /books/stats/summary` `GET /admin/books` | `handlers/books.rs` | 公開讀 `{message,books}`／admin 裸陣列；15 欄 COALESCE PUT；stats 的 average_rating（truthy→toFixed(1)→parseFloat）|
| 61-65 | collection 域：`GET /collection/:type` `POST /collection` `PUT/DELETE /collection/:id` `POST /collection/search-external` | `handlers/collection.rs` | **動態欄位** INSERT/UPDATE（欄名來自 body key，照抄）；search-external=501 stub 照抄 |
| 66-70 | posts 寫（/posts 路徑，requireAdmin）：`POST /posts` `PUT/DELETE /posts/:id` `PATCH /posts/:id/status` + `POST /posts/legacy`(**basicAuth**) | `handlers/posts.rs` | 簡版建/改文（無 i18n；錯誤回 **400** 非 500）；legacy 帶 WWW-Authenticate 的 Basic auth |
| 71-74 | newsletter：`POST /newsletter/{subscribe,unsubscribe}` `GET /newsletter/by-token/:token` `GET /newsletter/subscribers`(admin) | `handlers/newsletter.rs` | 訂閱/退訂/重新啟用/token 查詢/分頁列表；token=`crypto.randomBytes(16).hex` 等價（rand 32 hex）|
| 75 | `POST /api/auth/reset-admin` | `handlers/auth.rs` | 開發用密碼重置（bcrypt::hash cost10）；⚠️ 見下方安全備註 |
| 76-77 | `GET /github/{user,events}/:username` | `handlers/thirdparty.rs` | 純代理／token+enrich PushEvent commits（⚠️ 見 bug #4：Rust 修好了 Express 的亂碼）|
| 78-80 | `GET /wakatime/{today,week,projects}` | `handlers/thirdparty.rs` | Basic base64(key)；today=summaries+durations 並行合併 actualCodingTime（JS toISOString 毫秒版）|
| 81-84 | `GET /steam/{player,recent-games,owned-games,achievements/:appid}` | `handlers/thirdparty.rs` | https.get 式純代理（**不看上游狀態碼**、parse 後回 200，照抄）|
| 85 | `GET /books/search/external` | `handlers/thirdparty.rs` | Google Books→OpenLibrary fallback；cover upgrade（JS replace=首次出現）；encodeURIComponent 等價 |
| 86-92 | spotify×7：`GET /spotify/{login,recently-played,now-playing,top-genres,top-tracks,audio-features,me}` | `handlers/spotify.rs` | **首批 in-process 狀態**：token 快取（提前 1min 過期）、top-* 6h/1h 快取、403/429 熔斷 1h、audio-features per-track 24h 快取+優雅降級 |
| 93 | `GET /steam/profile` | `handlers/thirdparty.rs` | **SWR 快取**：30min 過期背景重抓（tokio spawn+try_lock dedup）、失敗 backoff 5min 保留舊快取、首抓持鎖去重；miniprofile HTML 4 regex 解析（`(?!_frame)` lookahead 因後接 `\s+` 恆真、等價移除）|
| 94-97 | watch 公開讀：`GET /anime/history` `/films/recent` `/tv/recent` `/watch/stats` | `handlers/watch.rs` | limit 的 `parseInt→Math.min`（NaN→LIMIT NULL 照抄）；NULLS LAST；stats 物件 spread 順序 |
| 98-101 | `GET/POST /watch/favorites` `PUT/DELETE /watch/favorites/:id` | `handlers/watch.rs` | TMDb 在地化（per kind:id:lang 快取無 TTL）＋DB 快照 fallback；`Cache-Control: no-store`；rating `Math.max(1,Math.min(5,ToNumber))`；quote UTF-16 slice 280；無 404（照抄）|
| 102 | `GET /watch/tmdb-search` | `handlers/watch.rs` | admin；fetch 不看狀態碼直接 parse（照抄）|
| 103 | `GET /watch/now` | `handlers/watch.rs` | 純讀記憶體 state。~~Trakt 按需+25s 節流輪詢~~ 已於 2026-08-02 移除（Trakt 刪掉了免費帳號的 app，那支呼叫必定失敗卻仍掛在公開路徑上：實測首發 513ms → 移除後 0.1ms）|
| 104 | `POST /admin/watch/now` | `handlers/watch.rs` | heartbeat：`bahamutPushAuth`（X-Bahamut-Token constant-time ∥ admin JWT）；videoSn 反查 anime_history enrich；同片保留 startedAt；90s TTL |
| 105 | `GET /admin/bahamut/status` | `handlers/bahamut.rs` | **anigamer crate**；`bahamutPushAuth`；純讀記憶體 jar+解碼 BAHARUNE。對**live Express** byte-identical（push-token / admin-JWT 兩路徑 + 401 拒絕全一致）|
| 106 | `POST /admin/bahamut/cookie` | `handlers/bahamut.rs` | cookie 熱抽換（`set_cookies` 內部短鎖，非換 client）+ 觸發 `sync_bahamut_history`。對 live-db 副本跑真 session：回應形狀一致、upsert **冪等**（879 entries / 0 new / 0 covers）、997 列 title/cover/episode **零差異**、enrich 47 填 0 退，剩 3 個 TVSP/劇場版 TMDb 本就無 TV 對應（與 Express 同）|
| 107 | `POST /admin/posts/:id/generate-zh-cn` | `handlers/opencc.rs` | **opencc 硬骨頭**；requireAdmin；`ferrous-opencc` `Tw2s`（純 Rust、內建字典、免 libopencc）繁台→簡。對 opencc-js `{from:tw,to:cn}` **byte-identical**（11 真實文章全欄 + 33 欄位 + 20 對抗案例含 著作/著手 語境消歧）；DB 寫 zh_cn 三欄+updated_at；404/400×2/401 全對拍 |
| 108 | `GET /api/thoughts/rss` | `handlers/thoughts.rs` | **XML 硬骨頭**；碎念 RSS（最新 30）。移植 `esc`(&<>)、`content.slice(0,60)`(UTF-16)、`ref` desc(link/media)、`new Date().toUTCString()`(自寫 days_from_civil+星期)。對 **express-test** 對抗 fixture byte-identical(4442B)：&<>轉義(內文/標題/URL)、emoji surrogate 截斷、剛好60字、link/media/壞JSON/空title、全 7 星期 |
| 109 | `GET /api/admin/stats` | `handlers/admin.rs` | requireAdmin；文章/留言 count + **`visitors=Math.floor(random*1000)+1000`（[1000,1999]，不可 byte 對拍）**。對 express-test 除 visitors 外 byte-identical（key 序 + 確定性欄位），visitors 兩邊皆 ∈[1000,1999]；401 對拍 |
| 110 | `POST /api/sync/collection` | `handlers/collection.rs` | n8n 批次匯入 collection_items（x-api-key）。Rust 已是該表寫者→併入單寫者。happy-path 回應 byte-identical、寫入列內容一致（`\|\|` 預設：year:0/rating:0→NULL、缺 source→n8n_import、缺 status→completed、is_favorite→1/0）、403/400×2 錯誤 byte-identical |
| 111 | `POST /api/admin/posts/:id/send-newsletter` | `handlers/mailer.rs` | **resend 硬骨頭**；reqwest 直打 Resend batch API（`emails/batch`）。移植 mailer.js HTML/text/subject 模板 + List-Unsubscribe headers。**驗證=只組請求不真寄**：兩邊 `RESEND_BASE_URL` 指本地 mock 容器→比對**實際 wire body byte-identical(13390B)**（含 escapeHtml 5 連轉義、excerpt slice(320)+省略號、named/unnamed greeting、encodeURIComponent token、per-email key 序 from/headers/html/subject/text/to）。response(dispatched/no-subscribers)+404/400/401 全 byte-identical。⚠️ 見 bug #6 |
| 112 | `GET /api/gallery/photos` | `handlers/gallery.rs` | 讀 manifest.json 回傳（零 sharp）。**byte-identical(245KB)**——揪出 serde_json 預設浮點解析有損（差 1 ULP）→ 開 `float_roundtrip` feature 對齊 V8 |
| 113 | `GET /api/image-proxy` | `handlers/gallery.rs` | 純串流代理（零 sharp；axios pipe → reqwest bytes_stream）。body byte-identical + CORS/Cache headers + 400/500 分支全對拍 |
| 114 | `GET /api/og/:id.png` | `handlers/og.rs` | **sharp 硬骨頭**：SVG 模板（`_wrapTitle` JS 混合語意=code point 迭代+UTF-16 計數，7 case node 真值單元測試）→ **resvg** 光柵化。ETag **byte-identical**、headers/304/404 全對拍、PNG 1200×630 視覺等價（省略號 glyph 字型 fallback 微差）。axum 不支援 `:id.png` → `:file`+strip 後綴、非 .png 轉 proxy |
| 115 | `POST /api/admin/upload` | `handlers/upload.rs` | multer→axum multipart（⚠️ Multipart 不能當參數 extractor，否則 401 順序反了）。檔案落地 bytes=原檔、YYYY/MM/ts-rand 檔名、**thumbhash 實測 2/5 byte 相同、3/5 差 ≤2 字元（±1 量化係數，解碼視覺零差異）**、txt→null、400/401 對拍 |
| 116 | `POST /api/admin/gallery/sync` | `handlers/gallery.rs` | **sharp 域最大塊**：掃描（@eaDir 等目錄排除）→ EXIF orientation rotate → resize 1920/400 → **lossy webp q85/80（`webp` crate=libwebp vendored）**→ exifr 9 欄抽取 → manifest。manifest 除 size 外**全一致**（exif 物件/aspectRatio 浮點/key 序/shootTime）；webp 尺寸 3/4 同、1 張差 1px（vips 兩步縮放捨入）；視覺 mean diff 1%；skip 冪等/409 guard/401 對拍 |
| 117-118 | `POST /api/auth/{google,github}/callback` | `handlers/oauth.rs` | **OAuth 硬骨頭**（底線=不壞現有 user）。`upsertOAuthUser` 8 分支逐字照抄。驗證：①原函數 node 腳本 vs Rust mock provider 全流程，**7 case 輸入矩陣 resolve 值+DB 終態（5 列含 linked_to/OWNER 升級）完全一致**——順帶證實 email 關聯**大小寫敏感**（Express 既有行為）②Rust 簽 30d JWT 對 live /auth/me 驗簽通過③Missing code 400 對 live byte-identical。github 特有：無 email→/user/emails primary、displayName=name\|\|login。provider URL 可 env 覆寫（僅測試；prod 預設同 Express 寫死）。spotify/callback 留 proxy |
| 119 | `PUT /api/admin/users/:id/role` | `handlers/admin.rs` | **全路由差集盤點揪出的漏網**。requireOwner；validRoles/「不能改自己」（`AdminUser` 加 `db_user_id`：OAuth=主帳號 id、legacy=None 跳過檢查=Express dbUser 語意）。6 分支（400×2/200×2/404/403）byte-identical + DB 終態一致 |
| 120 | `GET /api/health` | `handlers/home.rs` | 純文字 `OK`，byte-identical |

> **watch 域要點**：
> - **bahamut cron 同步刻意留在 Express**——單寫者原則：`anime_history` 寫者=Express cron，Rust 只讀；
>   `watch_favorites` 寫者切為 Rust HTTP。`/admin/bahamut/*` 留 proxy（anigamer 輪）。
>   （`film/tv_history` 原本的寫者是 Trakt 同步，已移除；現在的寫者是 Rust 的 Simkl worker。）
> - **`GET /watch/now` 與 `POST /admin/watch/now` 成對接管**（now-watching 狀態在記憶體，拆開會狀態分裂）。
> - Trakt token file：Rust 端 `TRAKT_TOKEN_FILE` env（預設 DATABASE_URL 同目錄 `.trakt-token.json`）。
>   兩邊都「每次讀檔、<7 天才 refresh 寫回」→ 與 Express cron 相容（它也每次重讀檔）；併發 refresh
>   race 兩邊本就存在、機率極低（90 天 token）。**部署時 Rust 容器要掛同一個 db volume**（token/cookie 檔在裡面）。
> - A/B 全綠（favorites 寫入後兩邊 DB 完全一致、now-watching 全生命週期、Trakt poll null、401）。

### 🔄 cron 遷移 + ⚠️ Express bug #5：Trakt token 自毀設計（2026-07-10）

- **Trakt 歷史同步已移植 Rust**（`handlers/watch.rs::spawn_trakt_sync`，90s 首跑+6h 週期）：
  **`ENABLE_TRAKT_SYNC=1` 才啟動**（預設關）。單寫者切換流程：切換上線時 Express 設
  `DISABLE_WATCH_CRON=1`（watch.js 已加 kill-switch，inert 直到設 env）+ Rust 設 `ENABLE_TRAKT_SYNC=1`。
  bahamut sync 仍在 Express（等 anigamer crate，硬骨頭輪）。
- ⚠️ **bug #5（live 事故，2026-06-29 起）**：Trakt 現在發 **7 天壽命** token，Express 的「剩 <7 天就
  refresh」門檻 ≥ 壽命 → **每次 getValidTraktToken 都 refresh**；refresh token 是一次性的、Express
  無鎖——cron 與 /watch/now 輪詢併發搶刷 → race 斷鏈 → `invalid_grant` 永久死。live log 自 6/29 起
  全是 invalid_grant + 429（rate limit）＝**Trakt 同步與 trakt now-watching 已停擺**，需
  `scripts/trakt-device-auth.js` 重新授權。
- **Rust deviation（修法，非照抄）**：① refresh 門檻 = `min(7d, token 壽命/2)`（90d token 行為同
  Express；7d token 前 3.5 天直接用不 refresh）② refresh 全程 tokio Mutex 串行 + 進鎖 double-check
  重讀檔。Express 端同等修法**待使用者裁示**（動 live 行為）。
- **harness 鐵則（新增）**：**絕不把真實 Trakt token 檔放進 fixture**——fixture 端 refresh 成功會
  消耗一次性 refresh token、把 live 弄死。本次事故是 live 自己先死的（log 佐證），但此風險真實存在。
  Rust sync 的完整等價驗證推遲到重新授權後（且只在不觸發 refresh 的窗口內測）。

### 🦀 硬骨頭 1/N：anigamer Rust crate（2026-07-10）

- **`Server/anigamer-rs`**（獨立 crate、git init、可發 crates.io）——移植 TS SDK `Server/anigamer`：
  cookies（parse/serialize/merge-Set-Cookie 含刪除語意/validate）、jwt（BAHARUNE payload 解碼+到期）、
  errors（`BahamutApiError` + NO_LOGIN 偵測）、http（bahamut_get(_json) + cookie rotation callback）、
  endpoints（history 分頁去重 + animeRef og:image 抓取，extract_meta 手寫掃描免 regex）、client（`AniGamer`）。
- **測試 1:1 移植 TS 套件**：cookies 20 + jwt 6 + extract_meta 3 = `cargo test` 全綠（29 測試）。
- 差異記錄：CookieJar 用 `IndexMap`（保序 round-trip）；cookie 手動管理（非 reqwest cookie store，
  才能觸發 rotation callback + 磁碟持久化）；HTTP date 解析手寫（只需判過去/未來）。
- **✅ 已整合進 server-rs（2026-07-10）**：path 依賴 `anigamer = { path = "../../anigamer-rs" }`；
  AppState 放 `Arc<BahamutState>{ client: Arc<AniGamer>, sync_lock: tokio::Mutex, last_jwt_alert_at: AtomicI64,
  cookie_file }`——**不套外層 Arc<Mutex>**（使用者「不能無腦 Arc<Mutex>」）：AniGamer 內部已是
  `Mutex<CookieJar>`、方法全 `&self`、鎖不跨 await；cookie 熱抽換用 `set_cookies(&self, jar)` 換內容即可，
  無需 ArcSwap。`handlers/bahamut.rs`：`status`/`cookie` 端點 + `sync_bahamut_history` + `spawn_sync`
  worker（`ENABLE_BAHAMUT_SYNC=1` 才啟；預設 Express cron 仍為寫者）。移植 helpers：`notify_discord`
  /`maybe_alert_discord`（24h 節流 AtomicI64）/`check_bahamut_jwt_expiry`/`simplify_anime_title`（regex）
  /`tmdb_search_tv_id`/`enrich_null_anime`；`push_auth`（constant-time X-Bahamut-Token ∥ require_admin）。
- **真 session 端到端驗證**：使用者重抓 cookie（BAHARUNE 7/24 到期）→ status 對 live Express byte-identical；
  cookie→sync 對 live-db 副本跑：879 entries / **0 new** / 0 covers（冪等）、997 列內容零差異、enrich 收斂
  （47 填、0 退、剩 TVSP/劇場版本就無 TV 對應且 ⊆ live-null）。詳見端點表 #105-106。
- ⚠️ docker build context：anigamer-rs 在 server-rs 之外，path dep 跨 context → 部署需 workspace 或
  vendoring（P4 monorepo 一併處理）。
- **Trakt 重授權完成**（2026-07-10）：使用者跑 device-auth，新 token 壽命 **7.0 天**＝**硬證實 bug #5**
  （門檻 7d ≥ 壽命 → 每 call refresh）。live Express 同步暫恢復；長久靠 Rust（已修 refresh）。

> **有狀態第三方輪要點**：
> - **in-process 狀態正式引入**：`state.spotify`/`state.steam`（Arc）——短臨界區用 **parking_lot::Mutex**
>   （無 poison；讀寫皆 clone 出來、**絕不跨 await 持鎖**）、熔斷用 AtomicI64、steam 首抓/背景重抓
>   dedup 用 **tokio::sync::Mutex**（需跨 await）。與先前 lock 選型討論一致。
> - A/B 已證的非決定性（非實作差）：**Spotify 上游 key 序每次不同**（Express 連打兩次同 offset byte 不同、
>   jq 語意等）；now-playing `progress_ms` 播放中時變；steam/profile `_cachedAt`=各自抓取時間戳。
>   其餘（me/top-genres/top-tracks/audio-features/login 302+Location+body）byte-identical。
> - **最終留 proxy（僅 2 條）**：`/spotify/callback`（一次性 setup 大 HTML）、`/quote/daily`（隨機外部
>   名言＋每日快取；opencc 部分已證可移植、來源非決定性故留）。加上刻意不註冊的
>   `PATCH /admin/comments/batch/status`（bug #2 死路由）。**其餘 120 條全部接管**。
>   ⚠️ cutover 清單另有：nginx `location /uploads/` 直達 Express:3001（static 檔），切換時要改；
>   ②備份 db 後跑 `scripts/migrate-comments-post-id-nullable.sh`（修 bug #1，Rust 同樣需要）；
>   ③live 動畫瘋同步現正停擺（bug #9，記憶體 jar 掏空）——不處置，Rust 起來讀磁碟好檔第一輪自癒。
>   （`admin/stats` #109 已接管——visitors 用 `Math.random` 除該欄外 byte-identical；`sync/collection` #110 已接管。）
>   ⚠️ **`/sitemap.xml` `/rss` 不在 strangler 範圍**：nginx `location /` → 前端(13588)、只有 `/api/` → 後端。
>   Express 的 `app.get('/sitemap.xml'|'/rss')` 是 app-level（非 `/api/`），前端服（sitemap）或前端 404（`/rss`
>   現況 = 前端沒這條路由 → 線上 `koimsurai.com/rss` 是 **404**，pre-existing 前端 bug，跟後端遷移無關）。
>   碎念 RSS 走 `/api/thoughts/rss`（已接管 #108）。

> **第三方輪要點**：
> - **JS number 正規化（關鍵）**：外部 API 回 `100.0` 這種整值 float，JS `JSON.parse→res.json` 會輸出
>   `100`，serde 預設保留 `100.0` → 新增 `util::js_normalize_numbers`（遞迴、整值 float→int）套在所有
>   第三方 parse 點。修完 wakatime 三支從 ❌ 轉 byte-identical。
> - **留 proxy（有狀態/硬骨頭）**：`/steam/profile`（SWR 快取+miniprofile HTML 解析）、`/quote/daily`
>   （**每日快取讓隨機名言穩定一天**＝必要狀態＋zh-TW 需 opencc）、spotify 全部（token refresh 狀態）、
>   watch 域（Trakt/TMDb+anigamer）。
>
> ⚠️ **Express bug #6（本 session 揪出）：newsletter reply_to 沒送出**。`mailer.js` 建 payload 用
> `reply_to`（snake_case），但 `resend` SDK v6 的 `parseEmailToApiOptions` 讀 `email.replyTo`（camelCase）
> → `reply_to` 恆 `undefined` → **wire body 不含 reply_to**，即使 `NEWSLETTER_REPLY_TO` 有設也白搭。
> 用 mock（`RESEND_BASE_URL` 指本地容器）攔實際 wire body 證實。Rust 遷移期**一併省略 reply_to**
> 保 byte-equivalence（13390B 對拍全同）。**修法（行為清理版）**：mailer.js 改用 `replyTo`。
>
> ⚠️ **Express bug #4（本 session 揪出）：ghFetch 亂碼**。`https.get` 的 `data += chunk` 逐 chunk 隱式
> Buffer→string，multi-byte UTF-8 字元跨 TCP chunk 邊界時產生 U+FFFD（`���`）。實測 `/github/events`
> 兩次呼叫亂碼數不同（14 vs 12，**非決定性**）、集中在 enrich 的中文 commit message；Rust reqwest
> 整段解碼＝0 亂碼。**Rust 版嚴格更正確**，此端點不可能（也不應）byte 對齊；排除 commits 後其餘結構
> 完全一致已驗。（Express 修法＝ghFetch 收集 Buffer 最後再 toString，或 res.setEncoding('utf8')。）

> 本輪驗證重點：`/posts` 系列（Express 錯誤回 400、admin 版回 500 的差異照抄）；legacy Basic auth
> 三情境（正確/錯誤/無 header + `WWW-Authenticate: Basic`）；newsletter 全生命週期
> （訂→重複 400→退→**重新啟用**→token 查詢）；subscribe 的 UNIQUE 檢查是**特定欄位**
> （`newsletter_subscribers.email`）非通用；**bcrypt 雙向相容實證**（Rust `bcrypt::hash` 產出
> 被 bcryptjs `compareSync` 驗過、$2b$10$ 前綴一致）。unsubscribe_token 為隨機值→A/B 只驗格式
> （32 hex）與語意，不 byte 比。
>
> ⚠️ **安全發現 #3：`/auth/reset-admin` 在正式環境是活的**。Express 用 `NODE_ENV==='production'`
> 擋，但**容器沒設 NODE_ENV** → 任何人可 POST 觸發把 admin 密碼重置成 env `ADMIN_PASSWORD` 值
> （env 有設所以攻擊者不能自訂密碼，但可未授權觸發重置）。Rust 照抄行為（等價優先）；
> **建議**：compose 給 backend 加 `NODE_ENV=production`（Express 與 Rust 都會因此關閉此端點）。

> books/collection A/B 全過。要點：
> - **REAL 欄位的 JS number 序列化**：`row_to_json` 對整值 REAL 輸出整數（`4.0`→`4`），對齊
>   `JSON.stringify`；books.rating(4.9/4.1)、collection.rating(4.5) 驗過。`bind_val`/`js_num_value` 進 util。
> - **動態欄位 SQL（collection POST/PUT）**：欄名直接插進 SQL——Express 既有寫法（admin-only 緩解），
>   非法欄名兩邊都 500（僅 driver 錯誤字串不同：`SQLITE_ERROR: no such column` vs sqlx `(code: 1)`）。
> - `/books/search/external`（Google Books/OpenLibrary）已接管（#85）。`/sync/collection`（n8n 批次）**已接管**（#110，
>   Rust 已是 collection_items 寫者→併入單寫者）。`/books/search/external`、`/books/stats/summary` 是雙段路徑、不會撞 `/books/:id`。
> - 測試 token 鑄造腳本固定放 `scripts/mint.cjs`（.cjs 因上層 web/package.json 是 ESM；scratchpad 會被清）。

> **admin posts CRUD A/B 全過**，含最細的 JS 語意：
> - `data` 回應物件的 **undefined-key 省略**（body 沒帶 excerpt/category → 回應無該 key；JSON.stringify 語意）。
> - PUT 的 **toNullable**（缺 key→不動、`''`→NULL、值→覆寫）用 CASE-flag 綁定複製；`series_order` 的
>   `Number()` 強制轉換（`js_number`：null/''→0、字串 parse、NaN→NULL）。
> - **manageTags**：先刪關聯→INSERT OR IGNORE tags→查 id→建關聯（順序照抄）。
> - **newsletter 條件委派**：`send_newsletter && status==='published'` 的 POST/PUT **整包（原 bytes）轉發
>   給 Express** 處理。已驗：委派回應帶 Express 指紋、文章由 Express 寫入。
>   ⚠️ **resend 已遷移（#111）→ 此委派現可收回**：讓 Rust 建文後自己呼叫 `mailer::send_newsletter`
>   （待辦：admin_create_post/admin_update_post 加自動寄送分支，取代委派）。
> - `/admin/posts/:id/generate-zh-cn`（opencc）**已接管**（ferrous-opencc Tw2s）；
>   `…/send-newsletter`（resend）**已接管**（#111，reqwest 直打 batch API）。
>
> **harness 安全改良（重要）**：寫入測試時 Rust 的 `EXPRESS_UPSTREAM` 改指 **express-test(3003)** 而非
> live——委派/proxy 的寫入絕不落在 live DB；且 fixtures 先 `DELETE FROM newsletter_subscribers`，
> 就算 dispatch 被觸發也寄不出信。之後所有寫入輪都照此配置。

> **admin thoughts A/B 全過（第一批含外部 fetch 的寫入）**：unfurl `https://example.com` 兩邊 ref_json
> **byte-equal**（`{"title":"Example Domain","desc":null,"image":null,"site":"example.com"}`——regex 移植
> ＋key 順序都對）；TMDb enrich（tmdbId=550 movie）**531B ref_json byte-equal**（zh-TW title/overview/
> rating(toFixed(1) 字串)/genres/year/poster、spread→source→url→… 插入順序用 serde Map 對齊 JS 物件賦值語意）。
> unfurl 的 `html.slice(0,200000)` 用 UTF-16 code unit 截斷對齊 JS。TMDb 需 `TMDB_API_TOKEN` env。
> 已知細節差：JS `toFixed(1)` 半數進位 vs Rust `{:.1}` banker's rounding——TMDb vote_average 本身只有
> 一位小數，實務不觸發。timestamps（created_at/updated_at）跨秒可能差 1s，不列對拍。

> comments moderation A/B 全過（status/PUT/DELETE/reply + auth 401 + 404 + 400）；reply id 一致（comments 未 startup-seed）。
>
> ⚠️ **既有 bug #2（本 session 揪出）：`PATCH /admin/comments/batch/status` 是死路由**。Express 按
> **註冊順序**匹配，`:id/status`（index.js:2164）註冊在 `batch/status`（2178）之前 → `batch/status`
> 被當成 `id="batch"` → `UPDATE … WHERE id='batch'` → 0 列 → **404 "Comment not found"**，batch 端點永遠打不到。
> 為等價，Rust **刻意不註冊** `batch/status`，讓它落到 `:id/status`(id="batch") → 同樣 404。
> 意涵：前端若有「批次審核」功能，在 Express 就已失效；修法是把 batch 路由移到 `:id/status` **之前**註冊。

> admin CRUD A/B 全過（含 auth 401、UNIQUE 409、404、400、`gen_slug` 產 `hello-world-測試`）。
> **`gen_slug`**（`util.rs`）逐字複製 Express `name.toLowerCase().replace(/\s+/g,'-').replace(/[^\w\-一-龥]+/g,'')`。
> **`is_unique_violation`** 對齊 Express `err.message.includes('UNIQUE constraint failed')`。
>
> ⚠️ **A/B 對 AUTOINCREMENT 回傳 id 的注意**：`categories` 在 Express **啟動時** `INSERT OR IGNORE` seed
> 預設分類（database.js:321），即使被 IGNORE 也會 bump `sqlite_sequence`。故 express-test 每次啟動其
> categories 序列比 rust fixture 快（本次差 3）→ POST category 回傳的 id 差 3，**但其餘欄位全 byte-identical**。
> 已查證（sqlite_sequence 差=seed 數、tags 未被 seed 故 id 一致=對照組、restart 又 re-seed）。
> **正式環境單一共享 DB、Rust 直接 INSERT 取下一 id，無此分歧**——純 A/B-雙實例 artifact。
> tags/comments/blacklist/keyword 未被 startup-seed，A/B id 完全一致。

> 寫入端用 `get(h).post(h2).fallback(proxy)` 在同路徑掛多方法（如 `/posts/:id/reactions`、`/posts/:id/comments` GET+POST）。
>
> **createComment A/B 全過**（8 情境 response byte-identical + DB 列一致）：anon→pending、
> **OAuth→approved**（真 token）、缺 author→400、黑名單 IP→403、關鍵字 reject→400、spam→spam、
> captcha mismatch→400、captcha match→pending。IP 取自 `X-Forwarded-For` 最左（生產 nginx 設 XFF；
> `app.set('trust proxy',1)`）；`js_loose_eq` 近似 JS `==`（captcha 比對）。
>
> ⚠️ **既有 bug（本 session 揪出）：thought 留言發不出來**。`comments.post_id` 是 **NOT NULL**，
> createComment 插 thought 留言時沒給 post_id → 約束失敗。**Express 與 Rust 都回 400**（行為等價、
> 用戶都無法發 thought 留言），但錯誤字串因 driver 不同（node-sqlite3 `SQLITE_CONSTRAINT: …` vs
> sqlx `error returned from database: (code: 1299) …`）。屬既有 schema 限制，非遷移引入；若日後把
> `post_id` 改 nullable，兩邊都會正常運作。已保留 Rust 接管（一致性），修 schema 後即生效。

> **動態 row→JSON（`src/util.rs::row_to_json`）**：給 Express 端直接 spread 整列（`SELECT *`/`p.*`/`c.*`）的端點用——
> 依 sqlx 實際欄位順序+儲存類別（INTEGER/REAL/TEXT）建 JSON、保留 DB 欄位序（serde preserve_order），
> 免枚舉欄位、不依賴記住的實體順序、抗 schema 變動。已驗：`/admin/posts` 322KB 全 i18n 欄位 byte-identical。
> 另含 `js_substring_prefix`（UTF-16 對齊 JS `substring`）、`parse_int`、`split_tags`。

> `require_admin`/`require_owner` 共用 `authorize(.., owner_only)`：owner_only 決定角色門檻
> （OWNER vs ADMIN∨OWNER）與不足訊息（「需要擁有者權限」vs「需要管理員權限」）。
> ⚠️ requireOwner 拒絕「ADMIN（非 OWNER）」這條路徑邏輯有實作，但**資料無 ADMIN 角色列、未正向對拍**
> （現有 oauth_users 只有 OWNER×2、USER×1）。`/admin/{blacklist,keyword-filters}` 為空表→只驗空集合。

> posts 多語邏輯（`parseLocale`/`getLocaleContent`/`availableLocales`、12 個 i18n 欄位 `title_en`/
> `content_zh_cn`/… + `source_language`）逐字照抄 Express；`!t` 的 truthy 檢查（null 與 '' 都當無內容）
> 用 `nonempty()` 對齊。list/single 都用 `SELECT p.*` 取（FromRow 依名對應、忽略多餘欄位）。

## 本 session 進度（2026-06-26 ~ 06-27）

- ✅ 盤點完整端點（下表）+ DB schema。
- ✅ 搭好 Rust 骨架：`src/{main,state,error,proxy}.rs` + `handlers/`，`cargo build` 綠、零 warning。
- ✅ proxy fallback 透傳：method / body / query / 狀態碼 / 上游 header / 404 fallthrough 全對。
- ✅ 接管上表 7 個公開純讀端點，全部對拍 byte-identical。

### 關鍵踩雷 / 學到的 pattern（接力必看）

1. **假陽性防呆**：proxy 也會讓對拍 byte-identical（因為兩邊都來自 Express）。
   → 每接管一個端點，用 **header 指紋**確認是 Rust 自處理：Rust 自處理無 `X-Powered-By`、
   `content-type` 無 `charset`；proxy 會保留 Express 的 `x-powered-by: Express` + charset。
2. **`SELECT *` / `t.*` 的欄位順序**：別信 `database.js` 的 CREATE TABLE 順序——ALTER 後加欄位
   排在**最後**（live `thoughts` 的 `dislikes`、`comments` 的 status/ip… 都在尾巴）。
   要 byte-identical 就**從 live 回應實際 key 順序**反推，用顯式欄位 SELECT（別用 `t.*`）。
3. **method 層 fallback**：axum 對「路徑命中但方法沒命中」預設回 **405**，但 Express 是 **404**
   （catch-all）。→ 每個接管路由都掛 `.fallback(proxy_to_express)`（或 `any(proxy)`），
   非 GET 方法轉回 Express，保留 404 行為。
4. **static vs param 碰撞**：`/thoughts/rss` 必須在 `/thoughts/:id` **之前**顯式註冊（這裡是
   `any(proxy)` 讓它留在 Express），否則會被當成 `id="rss"` 進到 Rust handler。
5. **serde_json `preserve_order`**：thoughts 的 `ref`（解析 ref_json 再序列化）若用預設 serde_json
   會把物件 key 排序 → 跟 Express 的 `JSON.parse→res.json`（保留原順序）不一致。
   已在 Cargo.toml 開 `preserve_order` 修正。
6. **驗證前重撈 DB 副本**：Rust 讀的是 `docker cp` 出的副本、Express 讀 live，會漂移
   → 每次驗證前重撈（含 `-wal`/`-shm`）。

### 🔑 auth 里程碑（requireAdmin JWT 驗章，2026-06-27）

`src/auth.rs` 的 `require_admin(&headers, &state)` 對齊 Express `createRequireAdmin`：
- HS256 Bearer JWT，secret 共用 Express `JWT_SECRET`（AppState 啟動載入、fail-fast）。
- **Validation 設定（context7 查證後對齊 node jwt.verify）**：`leeway=0`（node clockTolerance=0）、
  `required_spec_claims.clear()`（node 不強制 exp，有 exp 才驗）、僅 HS256。
  → 已驗：`noexp` token（無 exp）兩邊都放行；過期 token 兩邊都 401。
- 兩種 token 分支：① OAuth（`userId`）→ 查 `oauth_users`→`linked_to` 解析主帳號→`role∈{ADMIN,OWNER}`；
  ② legacy（非空 `username`、無 userId）→ 視為 OWNER。
- 錯誤回應逐字對齊（**注意：requireAdmin 用 `{"message":...}` 不是 `{"error":...}`**）：
  無/非 Bearer→401「未提供有效的授權令牌」、驗章失敗→401「無效的授權令牌」、
  user 不存在→401「使用者不存在」、角色不足→403「權限不足，需要管理員權限」、
  皆無→403「權限不足」。AppError 新增 `Unauthorized`/`Forbidden` 變體（body 用 message key）。
- 對拍矩陣（`/api/admin/tags`，用 server node 鑄 token）：legacy/oauth-owner(id3)/oauth-linked(id5)
  →200 裸陣列；oauth-user(id4)→403；無 token/Basic/壞簽/過期→401，全 **byte-identical**。

> ✅ **JWT_SECRET 收斂（2026-06-27 已修）**：先前看到的「容器 secret ≠ `server/.env`」其實**不是換密鑰，
> 是 `.env` 的 CRLF 行尾雜訊**——`.env` 為 mixed CRLF/LF，JWT_SECRET 那行尾多一個 `\r`（len 59 vs 58）。
> Docker env_file 會 strip `\r`，所以容器跑的一直是正確的 58 字元值；只有 CRLF-unaware 的工具
> （shell、Rust `dotenvy`）會誤讀成 59 字元。**修法**：`sed -i 's/\r$//' server/.env` 正規化成 LF
> （內容除行尾 CR 外一字未動），現 `.env` 與容器 sha256 完全一致（`12f08c…`）。**無需重啟、不登出**。
> 教訓：部署/驗證 Rust 前確認 `.env` 是 LF，或直接以 `docker exec … printenv JWT_SECRET` 為準。
### 🔐 login 驗證（`POST /auth/login`，bcrypt，2026-06-27）

`handlers/auth.rs`：查 `users`→`bcrypt::verify`（crate 0.19，相容 bcryptjs `$2a/$2b/$2y`）→ 簽
`{id,username,role}+iat+exp` 的 7d HS256 JWT。回應 `{message:"登入成功",token,user}`，錯誤逐字照抄
（缺欄位→400「請提供用戶名和密碼」、查無/密碼錯→401「用戶名或密碼錯誤」、DB 錯→500「伺服器錯誤」）。
- **驗證**：① 錯誤路徑 Rust(copy) vs Express(live) **byte-identical**（含拿真實 `$2b$10$` hash 驗錯密碼→401）；
  ② **bcrypt 跨相容**：用 server 的 bcryptjs 產 `$2b` hash + 改前綴成 `$2a`/`$2y`，插副本測試帳號，
  三種前綴 `knownpass` 都 200、錯密碼 401；③ 解碼簽出的 token：claims 正確、exp−iat=7 天；
  ④ **互通性**：Rust-login 簽的 token 拿去打 **live Express 的 requireAdmin → 200**（同 secret 同格式）。
- 驗證手法（**可複用於所有寫入域**）：副本插測試列（不碰 live）+ 第三方 lib 產 fixture。
- 邊角：body 非合法 JSON / 空字串 body 時 axum 回 4xx 與 Express 的 400 訊息可能不同（前端必送合法 JSON，未對齊）。

### 🧪 寫入域 A/B 驗證 harness（2026-06-28，可複用）

寫入會改 DB，無法拿 Rust(副本) 直接比 live Express。改用**隔離 A/B**：
1. 撈 live DB 副本當 base，複製成兩份 fixture：`$SC/fix_express/`、`$SC/fix_rust/`（含 `-wal`/`-shm`）。
2. 用同一個 `web-backend` image 起**第二個 Express 容器**掛 fix_express：
   `docker run -d --name express-test -v $SC/fix_express:/usr/src/app/db --env-file server/.env -p 127.0.0.1:3003:3001 web-backend`
3. Rust 指 fix_rust（port 3002）。兩邊起點相同。
4. **同序列**寫入請求送兩邊 → 比 ① response byte-identical ② 事後用 python sqlite3 dump 受影響的列、比 DB 狀態。
5. 測完 `docker rm -f express-test`，不碰 live volume。

已驗（計數寫入全過）：view/like/unlike/reactions(upsert+clamp+delta+❤️多碼位)/comment-like/thought-react，
含 404（Post/Comment not found）、400（invalid emoji / bad reaction）、找不到 id 仍回 success 等邊角；
最終 DB 狀態（post17/thought5/comment17/post_reactions）express==rust。createComment 亦以此 harness 全過。

**harness 踩雷（接力必看）**：
- ⚠️ **別用 `pkill -f 'target/debug/koimsurai-web-backend'`**——pattern 字串會出現在正在跑的 bash
  指令列裡，pkill -f 會匹配並殺掉**腳本自己的 shell**（自殺→無輸出、exit 1）。改用
  `for pid in $(pgrep -f koimsurai-web-backend); do [ "$pid" != "$$" ] && kill -9 $pid; done`。
- 背景 Rust 用 Bash tool 的 `run_in_background`（`&`+`kill %1` 只殺當前 shell 的 job、跨 Bash call
  的孤兒殺不到→撞 3002 bind 失敗→測到舊 fixture）。每次測試前確認 3002 free、reap 孤兒。
- seed fixture：docker cp 帶 `-wal`/`-shm` 後先 `PRAGMA wal_checkpoint(TRUNCATE)` 再改，避免 table locked。
- `JWT_SECRET`/mint 要在**同一個 Bash block** export（每個 Bash call 是新 shell、env 不留存）。

### proxy 透傳對拍（骨架驗證，仍有效）

| 項目 | 結果 |
|---|---|
| `/api/health` `/api/posts?query` `/api/thoughts/:id/comments`（proxy） | body 全一致 |
| `/api/thoughts/rss`（**已接管** #108） | `application/rss+xml` XML byte-identical（含對抗 fixture）|
| POST `/api/auth/login`（假帳密，proxy） | 401 + `{"message":"用戶名或密碼錯誤"}` 一致 |
| POST `/api/stats`（method-fallback→proxy） | 404（非 axum 405），與 Express 一致 |
| 未知路由 `/api/__x__`（proxy） | 404 一致（走 Express 的 404 handler） |

**已知 header 差異（接管端點，刻意）**：
- Express：`Content-Type: application/json; charset=utf-8` + `X-Powered-By: Express`
- Rust：`content-type: application/json`（無 charset）、**不送 X-Powered-By**
- 評估：JSON 一律 UTF-8、前端 `fetch().json()` 不看 charset → 功能等價；
  `X-Powered-By` 是 Express 的資訊洩漏，本就該移除，**刻意不複製**。
  header name 小寫是 hyper 正常行為（HTTP header 大小寫不敏感）。

> 驗證用的 DB 是 `docker cp` 出來的 live 副本（**含 `-wal`/`-shm`**，WAL 當下有 4.2MB 未 checkpoint
> 資料，只 copy `.sqlite` 會少資料）。正式切換時 Rust 直接開 volume 內同一檔，無此問題。

### 本機重跑驗證

```bash
cd web/server-rs
# 1. 撈 live DB 副本（含 WAL/SHM）
docker cp personal-website-backend:/usr/src/app/db/db.sqlite      /tmp/dbcopy/db.sqlite
docker cp personal-website-backend:/usr/src/app/db/db.sqlite-wal  /tmp/dbcopy/db.sqlite-wal
docker cp personal-website-backend:/usr/src/app/db/db.sqlite-shm  /tmp/dbcopy/db.sqlite-shm
# 2. 跑 Rust（proxy 回正在跑的 Express container:3001）
DATABASE_URL=sqlite:///tmp/dbcopy/db.sqlite \
EXPRESS_UPSTREAM=http://127.0.0.1:3001 BIND_ADDR=127.0.0.1:3002 \
  cargo run
# 3. 對拍
diff <(curl -s :3001/api/tags) <(curl -s :3002/api/tags)   # 應無輸出
```

## 端點盤點（共 ~111 條，按計畫搬遷順序 = 自包含→高整合）

> 來源：`web/server/index.js`（掛在 `apiRouter`，prefix `/api`）+ `routes/{thoughts,watch,home}.js`。
> 「硬骨頭」標記＝需 Rust 重寫第三方依賴，非單純 SQL 翻譯。

### ① thoughts（碎念，`routes/thoughts.js`）— 部分接管中
- ✅ **已接管**：`GET /thoughts`（列表）`GET /thoughts/:id`（單篇）
- ✅ **已接管（靜態路由優先於 :id）**：`GET /thoughts/rss`（#108，XML byte-identical，含對抗 fixture）
- ⏳ **未接管（proxy）**：`GET /thoughts/:id/comments` —— 目前無任一 thought 有留言。
  但 comments row 解碼已透過 `/posts/:id/comments`（post 17 真實留言）驗過 byte-identical，
  **可低風險接管**（重用 `posts::CommentRow`，把 `post_id` 換 `thought_id`）；只差 thoughts 自身
  無資料做正向 byte 對拍。列為最易接的下一個。
- ⏳ 寫入（需先做 auth/createComment 里程碑）：`POST /thoughts/:id/{comments,react}`、
  `POST/PUT/DELETE /admin/thoughts[/:id]`
- 表：`thoughts`、`comments`（thought_id）。comments 實際欄位序：
  `id,post_id,author,content,likes,created_at,is_admin,email,website,status,ip,parent_id,avatar_url,thought_id`

### ② watch（觀影，`routes/watch.js`）— ⚠️ 含硬骨頭 anigamer
- 公開讀：`GET /anime/history` `/films/recent` `/tv/recent` `/watch/stats` `/watch/favorites` `/watch/now`
- admin：`GET /watch/tmdb-search`、`POST/PUT/DELETE /watch/favorites[/:id]`、`POST /admin/watch/now`
- **anigamer（硬骨頭）**：`GET /admin/bahamut/status` `POST /admin/bahamut/cookie` — 巴哈動畫瘋爬蟲。
  → 拆獨立 Rust crate，可發 crates.io。
- 第三方：Trakt / TMDb（reqwest）
- 表：`anime_history` `film_history` `tv_history` `watch_favorites`

### ③ posts / comments / reactions / tags / categories — 站核心
- ✅**已接管（公開讀）**：`/tags` `/categories` `/stats` `/series` `/series/:name`
  `/posts`(分頁+多語) `/posts/:id`(多語) `/posts/:id/reactions` `/posts/:id/comments`
- 互動（寫）：`POST /posts/:id/{view,like,unlike,reactions,comments}` `/comments/:id/like`
- 公開寫（疑舊）：`POST/PUT/PATCH/DELETE /posts[/:id][/status]`、`POST /posts/legacy`
- admin posts：`GET /admin/posts[/:id]` `/admin/stats`、`POST/PUT/DELETE /admin/posts[/:id]`、
  `POST /admin/posts/:id/generate-zh-cn`（✅ **opencc 已接管**：ferrous-opencc）、`/admin/posts/:id/send-newsletter`（✅ **resend 已接管** #111）
- admin tags/categories：`GET/POST/PUT/DELETE /admin/{tags,categories}[/:id]`
- admin comments：`GET /admin/comments`、`PATCH …/:id/status` `…/batch/status`、
  `PUT/DELETE /admin/comments/:id`、`POST /admin/comments/:id/reply`
- admin 黑名單/關鍵字：`GET/POST/DELETE /admin/{blacklist,keyword-filters}[/:id]`
- **opencc-js（硬骨頭）✅ 完成**：簡繁轉換。改用純 Rust `ferrous-opencc`（內建 OpenCC 字典、**免 libopencc C 依賴**，docker build 乾淨）；`Tw2s` 對 opencc-js `{from:tw,to:cn}`、`S2tw` 對 `{from:cn,to:tw}` 皆實測 byte-identical。`generate-zh-cn` 已接管（#107）；`quote/daily` 的阻塞是隨機外部名言來源+每日快取（非 opencc），故仍留 proxy。
- 表：`posts` `categories` `tags` `post_tags` `post_reactions` `comments` `ip_blacklist` `keyword_filters`

### ④ auth / oauth — 高整合，謹慎搬（argon2 + jwt）
- `POST /auth/login`、`GET /auth/me` `/auth/providers`、`POST /auth/logout`
- OAuth：`POST /auth/google/callback` `/auth/github/callback`
- admin：`GET /admin/users`、`PUT /admin/users/:id/role`、`POST /auth/reset-admin`
- 表：`users` `oauth_users`。對照 NAS 樣板的 argon2 + jwt + middleware。
  ⚠️ Express 現用 **bcryptjs**（非 argon2）——搬遷要驗 hash 相容或規劃 rehash。

### ⑤ books / collection — 自包含
- `GET /books[/:id]` `/books/search/external` `/books/stats/summary`、`POST/PUT/DELETE /books[/:id]`
- `GET /collection/:type`、`POST /collection[/search-external]`、`PUT/DELETE /collection/:id`、
  `POST /sync/collection`
- 表：`books` `collection_items`。第三方：Google Books / 外部 API（reqwest）

### ⑥ newsletter — ⚠️ 硬骨頭 resend
- `POST /newsletter/{subscribe,unsubscribe}`、`GET /newsletter/by-token/:token`
- admin：`GET /newsletter/subscribers`、`POST /admin/posts/:id/send-newsletter`
- 表：`newsletter_subscribers`。**resend（→ reqwest）**、`mailer.js`

### ⑦ 第三方整合（純 reqwest，無自家 DB 寫）— 可較晚搬
- Steam：`/steam/{profile,player,recent-games,owned-games,achievements/:appid}`
- Spotify：`/spotify/{login,callback,recently-played,now-playing,top-genres,top-tracks,audio-features,me}`
- WakaTime：`/wakatime/{today,week,projects}`
- GitHub：`/github/{user,events}/:username`
- home：`GET /quote/daily`（外部 quote）`/home/digest`

### ⑧ media / 雜項 — ⚠️ 硬骨頭 sharp
- `POST /admin/upload`、`GET /gallery/photos`、`POST /admin/gallery/sync`（**sharp/thumbhash/exifr → image crate**，NAS 已驗）
- `GET /image-proxy`、`GET /og/:id.png`（**sharp 產 OG 圖**）
- app-level（**非 strangler 範圍**：nginx `/` → 前端，非 `/api/`）：`GET /sitemap.xml`（前端服）、
  `/rss`（前端目前 404＝pre-existing bug）、`GET /api/health`（純文字 `OK`，`/api/` 底下→經 strangler，仍 proxy）

## 硬骨頭彙整（→ Rust 重寫）

| 依賴 | 用途 | 端點 | 計畫 |
|---|---|---|---|
| `anigamer` | 巴哈動畫瘋 SDK | watch bahamut/now | ✅ **完成**：獨立 crate（`anigamer-rs`，29 測試）+ 整合 server-rs（端點 #105-106，真 session 驗證冪等）|
| `opencc-js` | 簡繁轉換 | `/admin/posts/:id/generate-zh-cn` | ✅ **完成**：`ferrous-opencc`（純 Rust）Tw2s 對 opencc-js byte-identical（雙向 S2tw 也驗過）；generate-zh-cn 已接管，quote/daily 因隨機來源留 proxy |
| `sharp`/`thumbhash`/`exifr` | 圖片處理 | upload/gallery/og | ✅ **完成**（#112-116）：`image`+`resvg`+`thumbhash`+`webp`(libwebp vendored)+`kamadak-exif`；分層驗證=確定性 byte 對拍+圖片視覺等價 |
| `resend` | 寄信 | newsletter | ✅ **完成**（#111，reqwest 直打 batch API，wire body byte-identical；⚠️ 復刻 bug #6 reply_to）|

## 下一步建議

1. **✅ JWT requireAdmin 中介層已完成**（見上）。接續可搬更多 **read-only admin** 端點驗骨架：
   `/admin/categories` `/admin/posts`(分頁,需對齊 admin 版欄位) `/admin/comments` `/admin/users`
   `/admin/blacklist` `/admin/keyword-filters` `/admin/books`。（`/admin/stats` 有 `Math.random()`
   訪客數→非確定性，**不可 byte 對拍**，要嘛跳過要嘛只比結構。）
2. **✅ login + auth 讀（me/logout/providers）已完成**。**✅ admin 分頁讀（posts/comments）已完成**。
3. **剩餘讀端點**：`/admin/posts/:id`（編輯器用，回全 locale 欄位，可用動態 row→JSON）、
   `/admin/stats`（⚠️ `Math.random()` 訪客數，不可 byte 對拍）、`/og/:id.png`(sharp)。（`/admin/books` `/books`
   `/thoughts/rss` 均已接管。）
4. **寫入域**（用 JWT 中介層）：`POST /thoughts/:id/{react,comments}`（createComment：黑名單+
   關鍵字過濾）、admin thoughts/posts/comments/tags/categories CRUD、reactions/view/like、newsletter。
   **寫入端對拍要建測試 fixture DB（如本檔 login 驗證的手法：副本插測試列），別對 live 變更。**
5. **第三方（reqwest）**：steam/spotify/wakatime/github。**硬骨頭**：anigamer/opencc/sharp/resend。
3. 切 nginx 前：對每個接管端點做 body 對拍 + header 指紋（本檔驗證流程）。
4. 型別（P4 前置可先鋪）：DTO 加 `utoipa::ToSchema` + `specta::Type` 雙 derive（已決策並存）。
   本骨架先用 plain serde，待端點數量起來再導入，避免一開始就背依賴。

## async I/O audit（2026-07-03，使用者要求檢查）

- **I/O 全 async**：sqlx / reqwest（非 blocking 變體）/ axum body 皆 `.await`；無 `std::fs`、`std::net`、
  `reqwest::blocking`、手開 thread。proxy 的 body 為**有界緩衝**（10MB，對齊 `express.json limit`）——
  刻意選擇；日後接 image-proxy/upload 再改 streaming。
- **修正：bcrypt 包進 `spawn_blocking`**（login 的 `verify`、reset-admin 的 `hash`）。cost-10 ≈ 數十 ms
  純 CPU，原本 inline 會卡 tokio worker。修後功能重驗：login 200/401、token 打 requireAdmin 200、
  reset-admin hash 仍被 bcryptjs 驗過。
- 不動的（評估過）：jsonwebtoken HMAC（µs 級，慣例 inline）；unfurl/email regex per-call 編譯
  （µs~ms、admin-only 低頻，改了還要重驗不划算）。
- **panic-safety audit（同日）**：全專案**零 Mutex/RwLock**（AppState=sqlx Pool+reqwest Client+Arc<str>，
  handler 全 stateless）→ 無 poison 疑慮、parking_lot 不適用；日後若加 in-process cache 再選型
  （持鎖跨 await 必須 tokio::sync）。**guarded unwrap 全清**（~15 處 `contains_key` 檢查後
  `get().unwrap()` 的兩行分離寫法 → `if let`/`unwrap_or` 單一表達式，消除 guard-drift panic 風險）；
  煙霧 A/B 11 條全 byte-identical。殘留 panic 點僅：main.rs 啟動 expect×2（fail-fast，刻意）、
  靜態 email regex unwrap（常數 pattern 不可能失敗）。

## 模組結構

```
src/
  main.rs              路由註冊（接管端點 + 各自 method-fallback + 全域 proxy fallback）
  state.rs             AppState { pool, http(reqwest), upstream }
  error.rs             AppError → IntoResponse（{"error":msg}；404 用 not_found()）
  proxy.rs             proxy_to_express：未接管請求原樣轉回 Express
  handlers/
    tags.rs categories.rs series.rs stats.rs thoughts.rs
```


## 統一 audit（2026-07-11，端點遷移完成後）

依使用者提供的 20 條反模式表 + 自補維度全面掃過（server-rs + anigamer-rs）。基線：clippy 僅 7 warnings。

### A 級（真 bug，已修）
1. **CORS 缺失**：Express `app.use(cors())` 全回應帶 `Access-Control-Allow-Origin: *`；Rust 原本沒有
   → 補 `CorsLayer`（Any origin、六 methods、`AllowHeaders::mirror_request()` 對齊 cors 套件 reflect 行為）。
   已知微差：preflight Rust 200 vs Express 204（瀏覽器語意等價）；Rust 多 `Vary` header（更正確）。
2. **body limit**：axum 預設 2MB vs Express `json({limit:'10mb'})`/multer 50MB → 長文 PUT 會 413
   → 全域 `DefaultBodyLimit::max(10MB)` + `/admin/upload` route_layer 50MB。驗證：3MB POST 兩邊同回 400（業務層）。
3. **graceful shutdown 缺**：docker stop 硬殺 → `with_graceful_shutdown`（SIGTERM/Ctrl-C），實測 SIGTERM 正常退。
4. **🔥 Express bug #9（live 事故 + Rust 同洞預修）**：Bahamut 偶發 `deleted; Max-Age=0` 掏空 cookie，
   TS SDK 守門只護「檔案」不護「記憶體 jar」→ live 記憶體 jar 被清空、每 6h sync 全 skip（log:
   "rotation dropped BAHARUNE — NOT persisting" 之後 historyAll 0 筆→missing 全部）；磁碟檔完好（BAHARUNE 7/24），
   **Express 無重載機制，重啟容器才會恢復**。Rust 端 anigamer crate 加 `merge_with_destructive_guard`：
   merge 後必要 cookie「從齊變缺」→ 還原快照、不觸發 persist（+3 單元測試）。

### B 級（idiom，已修）
- regex 每呼叫重編譯 ×6（newsletter email 熱路徑/bahamut simplify+ep/watch rfc3339/thirdparty isbn）→ `std::sync::LazyLock`
  （順帶抓到自己抄錯：simplify 第 3 pattern replacement `""` 誤寫 `" "`，trim 恰好遮掩——已修）
- clippy 7：redundant closure/map identity/sort_by_key(Reverse)/clamp×3（f64 但 JSON 來源無 NaN → 與 JS min/max 鏈等價，安全改）
- async 內 std::fs：gallery scan→spawn_blocking、mtime→tokio::fs、bahamut cookie 寫→tokio::fs、watch chmod→tokio::fs
- `let _ =` 吞錯 ×6 → `tracing::warn/error`（Express 有 console.error 的地方尤其補齊）
- 「安全 unwrap」重構為編譯器保證（og/gallery/thoughts 的 if-let）
- anigamer：callback 型別 alias（消 complex-type）、clippy 0

### C 級（刻意照抄 Express，記錄不修 → 行為清理版）
- collection 動態欄名 SQL（body key 直接進 SQL；admin-only；值全 bind）
- N+1（bahamut cover per-sn、enrich 迴圈——有 sleep 節流，照抄）
- handler 直接回 `Response` 而非 `Result<_, AppError>`（byte 對齊需逐端點細控 body key）
- in-process 快取狀態用 `Arc<Mutex>`（已 review：短臨界區、不跨 await、無 poison；channel 不適合快取型狀態）

### D 級（不適用/不動）
- 每 request 重建 client（無）、&String/&Vec 簽名（無）、C 風格 index loop（無）、serde borrow（payload 小）
- rand 0.8/thiserror 1/axum 0.7：非幻覺 API、現行維護；P4 monorepo 時一併升版

### 驗證
- 修復後冒煙：tags/thoughts-rss/home-digest/gallery-photos/posts 五端點 **body byte-identical 不變**；
  CORS/preflight/3MB/SIGTERM 全過。兩 crate clippy 0、測試全綠（server-rs 2 + anigamer 30）。


## 行為清理版（2026-07-11，commit f27f514）

byte-equivalence 階段照抄的爛行為統一修正（自此起 Rust 與 Express 在這些點**刻意不同**）：

| Bug | 修法 | 驗證 |
|---|---|---|
| #1 thought 留言發不出（post_id NOT NULL） | `scripts/migrate-comments-post-id-nullable.sh`（12-step 重建+index 重建） | fixture 演練：列數不變/fk OK/index 在；修復後 thought 留言 201。**⚠️ 約束在 db.sqlite 裡（非 Express 碼）——Rust 也需要；使用者裁示併入 cutover 一起跑** |
| #2 batch/status 死路由 | Rust 實作正確版（靜態段優先於 :id） | 400 分支/批次 UPDATE affected/單筆不受影響 |
| #3 reset-admin 正式環境是活的 | fail-safe：預設 404，`ENABLE_RESET_ADMIN=1` 才開 | 未設 flag → 404 |
| collection 欄名注入面 | 14 欄白名單（忽略未知、全非法 400） | id/evil_column 注入被擋 |
| PUT posts 缺 key 誤刪 | category CASE-flag、tags contains_key | 只帶 title 時 category/tags 不動 |

已在移植期修掉：#4 ghFetch 亂碼、#5 Trakt refresh race、#7 multer 500 stack trace、#9 記憶體 jar 掏空（anigamer 守門）。
Express 端一律不修（將拋棄）。前端相容性：PostEditor 恆送全欄位，以上變更零影響。


## 上線記錄（2026-07-14）

- compose `backend-rs` 上線：nginx `/api/` → Rust:3002。Express 仍服務：proxy 目標（quote/daily、
  spotify/callback）、`/uploads/` static、`= /rss`、cron workers（Trakt/bahamut 寫者）。
- **前端 SSR 仍直連 Express**（serve.mjs `BACKEND_URL=http://backend:3001` 容器直連不經 nginx）——
  瀏覽器端 fetch 走 nginx→Rust、SSR 走 Express，混合但行為一致（byte-identical 保證）。
- **退役 Express 前的殘留清單**：①quote/daily ②spotify/callback ③/uploads static（建議 nginx 直接
  serve 檔案）④/rss ⑤SSR BACKEND_URL 改指 rust ⑥workers 切換（ENABLE_*_SYNC=1 + DISABLE_WATCH_CRON=1，
  同時做避免雙寫）⑦db migration（bug #1）⑧sites-available/enabled 已收斂 symlink。


## 🪦 Express 退役（2026-07-14，commit 611eabd）

- **最後三端點移植**：quote/daily（四語系+opencc S2tw+當日快取+fallback pool）、/rss（app-level；
  pubDate 修正為 UTC 解析——原 Express 在 TZ 下偏 8h）、spotify/callback（簡版 setup HTML）。
- **退役模式**：EXPRESS_UPSTREAM 未設 → fallback 回 404 'Not Found'（對齊原 catch-all）。
- **執行序列**：db 備份（db-backup volume `db.sqlite.bak-pre-express-retire-20260714`）→
  **live migration（bug #1）**：comments.post_id 已 nullable、index 重建、fk OK →
  compose：backend 移入 legacy profile、frontend SSR→backend-rs:3002、workers 開 →
  Express stop → nginx：/rss→3002、/uploads→**alias 直 serve**（仿 /nas-images）。
- **驗證**：13 端點 200、/rss 8 items、/uploads 200、退役 404、**Trakt sync Rust 首跑成功（151 列）**。
- ⚠️ **bahamut session 死**（NO_LOGIN；7/11 的 deleted Set-Cookie 是真註銷，守門保住的 jar 已無效）
  ——待使用者瀏覽器擴充重推 cookie（`POST /admin/bahamut/cookie` 就緒、收到即同步）。
- **Rollback**：`docker compose --profile legacy up -d backend` + nginx 備份檔還原。
- **現況**：koimsurai.com 全站（/api、/rss、SSR）由 Rust 服務；Express 容器停用保留定義；
  純靜態（/uploads、/nas-images）nginx 直 serve。
