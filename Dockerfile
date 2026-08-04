# ─────────────────────────────────────────────────────────────
# TanStack Start + Nitro v3(node-server preset)。
# Stage 1 build 出 .output;Stage 2 只要 node + .output 就能跑。
#
# 相較 serve.mjs 版少了一整串東西,都是實測後確認不需要的:
#   - pnpm install --prod + node-linker=hoisted hack
#     → nitro 的 .output 是自足 bundle(.output/server/node_modules 為空,
#       單獨複製到空目錄即可啟動),不需要 runtime node_modules。
#   - sharp + fonts-noto-cjk(~18MB 字型 + 原生模組)
#     → OG 圖改由後端 resvg 產(/api/og/:id.png);預設 OG 圖與 PWA icons 已預先生成進 public/,
#       不必每次 build 重跑 SVG→PNG。
#   - prerender 相關(host 綁 127.0.0.1 的 hack、build 期打 koimsurai.com 撈文章)
#     → 改走 ISR(nitro routeRules swr)。實測 prerender 產物不會被 nitro 註冊成靜態資產,
#       生出來也沒人送,純浪費。
# 舊版見 git 歷史(serve.mjs / serve.cjs)。
# ─────────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:26.5.0-bookworm AS builder
WORKDIR /app
# pnpm 釘版:對齊 host/CI(packageManager 欄位 = pnpm@11.17.0)。
# 不釘的話 build 會抓到當下最新 pnpm,版本漂移。overrides 已移到 pnpm-workspace.yaml
# (pnpm 11 不讀 package.json 的 pnpm 欄位);minimumReleaseAge 預設保留(供應鏈防護)。
RUN npm config set script-shell sh && npm install -g pnpm@11.17.0

# overrides 現在在 pnpm-workspace.yaml(pnpm 11 不讀 package.json 的 pnpm 欄位),
# 且 root 依賴 @koimsurai/api-types(workspace:*):install 前需備妥 workspace 定義
# 與各 member 的 package.json,frozen 才對得上 lock。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/mcp-server/package.json ./packages/mcp-server/
# 這裡原本有 `COPY patches ./patches`——patchedDependencies 的 patch 檔在 install 期就要
# 讀得到。@types/three 那個 patch 已經被上游 0.185.3 吸收，patches/ 整個沒了，這行就會
# 讓 build 直接失敗（"/patches": not found）。之後若再需要 patch，記得把這行加回來。
RUN pnpm install --frozen-lockfile

COPY . .

# client runtime 走相對 /api(經 nginx proxy 到 backend-rs)
ENV VITE_API_URL=/api

# 錯誤上報用的（假）DSN 與版本標記。兩個都是 build 時就會烤進 bundle 的。
# compose 沒帶 build arg 時會是空的（SDK 就不帶 release、也不啟用上報）。
ARG VITE_SENTRY_DSN=
ARG VITE_RELEASE=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_RELEASE=$VITE_RELEASE
RUN pnpm run build

# ── source map：烙 debug id → 上傳 → 從映像裡刪掉 ──────────────────────────
#
# 為什麼要在這裡做，而不是部署後另外跑一支腳本：那支腳本要記得下、要記得先 commit
# 再 build 再上傳，而順序錯了的症狀是「stack trace 依然 minify，且沒有任何錯誤訊息」。
# 綁在 build 裡就沒有順序可言——產物與上傳必然是同一份。
#
# 用 @sentry/cli 而不是 @glitchtip/cli：前者已是既有 devDependency 且實測可用，
# GlitchTip 的 find_source_files 本來就優先比對 debug_id，兩者相容。要換成
# glitchtip-cli 的話這裡改指令名即可。

# 1) inject：在每支 JS 與它的 .map 裡烙一個 UUID。純本機操作，不碰網路。
#    有了它，比對不再依賴檔名或 release 名稱——那是先前最容易錯的一環。
RUN pnpm exec sentry-cli sourcemaps inject .output/public/assets

# 2) upload。token 走 BuildKit secret 而不是 ARG——ARG 會留在映像歷史裡。
#    位址用**公開網址**：build 容器不在 observability 網路上，連不到 glitchtip:8000。
#    ⚠️ 沒帶 secret 時整步跳過（例如 CI 只想驗 build 過不過）。有帶就必須成功——
#      刻意讓它會擋下部署，因為靜靜跳過等於錯誤追蹤白裝，而那不會有人發現。
ARG SENTRY_URL=https://glitchtip.koimsurai.com
ARG SENTRY_ORG=koimsurai
ARG SENTRY_PROJECT=koimsurai-frontend
RUN --mount=type=secret,id=sentry_token \
    if [ -s /run/secrets/sentry_token ]; then \
      SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_token)" \
      SENTRY_URL="$SENTRY_URL" SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" \
      pnpm exec sentry-cli sourcemaps upload .output/public/assets \
        --release "${VITE_RELEASE:-unknown}" --url-prefix '~/assets'; \
    else \
      echo "⚠️  沒有 sentry_token secret，跳過 source map 上傳"; \
    fi

# 3) 刪掉 .map。
#    ⚠️ 這步是必要的，而且原因跟直覺相反：vite 的 `sourcemap: 'hidden'` **只拿掉
#      bundle 結尾的 sourceMappingURL 註解，不會阻止檔案被供應**。實測過——
#      /assets/AdminDashboard-*.js.map 直接 200，整站原始碼可下載。
#      GlitchTip 已經有了自己那份，production 映像不需要留。
RUN find .output/public/assets -name '*.map' -delete

# 4) 讓 nitro 的靜態資產清單追上前面兩步。
#    ⚠️ 這步不是可有可無的收尾——少了它整站是白畫面。
#    清單在第 48 行的 build 就定稿了，記著每支資產的 size；nitro 供應時 content-length
#    照清單走而不是 stat，所以 inject 把 JS 加長 358 bytes 之後，每一支都會被切掉尾巴：
#      Uncaught SyntaxError: Unexpected end of input (at index-XXXX.js:…)
#    而容器裡的檔案是完好的——切斷發生在供應階段，exec 進去看檔案完全看不出問題。
#    順帶把上一步刪掉的 .map 條目移除，那些路徑才會回 404 而不是 500。
RUN node scripts/sync-nitro-asset-manifest.mjs

# Stage 2: Production server
FROM node:26.5.0-bookworm-slim
WORKDIR /app

ENV TZ=Asia/Taipei
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# node 官方 image 內建的 npm 自己帶一包 node_modules，而那包目前有 5 個
# HIGH/CRITICAL 且**都有修版**（tar 7.5.16、brace-expansion 5.0.6、undici 6.26.0）。
# 升 node patch 版清不掉（26.5.0 與 26.5.1 掃出來一模一樣）——它們是 npm bundle 的。
#
# 而這個 stage 只有 `node .output/server/index.mjs`，npm / npx / corepack 一次都不會執行。
# 留著等於扛著五個永遠不會被觸發、卻會一直出現在掃描報告上的 CVE：
# 報告裡的雜訊會讓真正要看的東西被淹掉。
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && node --version

COPY --from=builder /app/.output ./.output

EXPOSE 13579
ENV PORT=13579
# 容器內要對外監聽(預設綁 [::] 雖多半可用,明確指定避免相依於 IPv6 行為)
ENV HOST=0.0.0.0
# 預設值對齊現況(compose 仍會覆寫);舊值 http://backend:3001 是 Express 時代的殘留
ENV BACKEND_URL=http://backend-rs:3002
ENV SITE_URL=https://koimsurai.com

CMD ["node", ".output/server/index.mjs"]
