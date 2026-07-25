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
# patchedDependencies 的 patch 檔:install 期就要讀得到，否則 frozen install 直接失敗
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .

# client runtime 走相對 /api(經 nginx proxy 到 backend-rs)
ENV VITE_API_URL=/api
RUN pnpm run build

# Stage 2: Production server
FROM node:26.5.0-bookworm-slim
WORKDIR /app

ENV TZ=Asia/Taipei
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

COPY --from=builder /app/.output ./.output

EXPOSE 13579
ENV PORT=13579
# 容器內要對外監聽(預設綁 [::] 雖多半可用,明確指定避免相依於 IPv6 行為)
ENV HOST=0.0.0.0
# 預設值對齊現況(compose 仍會覆寫);舊值 http://backend:3001 是 Express 時代的殘留
ENV BACKEND_URL=http://backend-rs:3002
ENV SITE_URL=https://koimsurai.com

CMD ["node", ".output/server/index.mjs"]
