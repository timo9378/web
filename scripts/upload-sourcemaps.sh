#!/usr/bin/env bash
# 把前端的 source map 上傳到自架 GlitchTip，讓 issue 裡的 stack trace 還原成原始碼。
#
# 沒有這一步的話，GlitchTip 上看到的是 minify 後的東西（`t.f is not a function`、
# 行號指向某個 40 萬字元的單行），幾乎讀不出任何資訊——等於白裝。
#
# ## 為什麼從**容器裡**取檔而不是用本機的 .output
#
# 部署走 `docker compose up -d --build frontend`，build 發生在映像內。本機另外跑一次
# `pnpm build` 產出的檔名 hash 不保證一致（相依解析、環境變數、時間戳都可能差），
# 而 source map 的比對是**照檔名**做的——對不上就等於沒傳，而且不會有錯誤訊息。
# 所以一律從正在跑的容器裡把產物撈出來。
#
# ## 用法
#
#   ./scripts/upload-sourcemaps.sh              # 用當前 git commit 當 release
#   RELEASE=v1.2.3 ./scripts/upload-sourcemaps.sh
#
# release 名稱**必須跟前端 SDK 的 `release` 一致**（VITE_RELEASE），否則 GlitchTip
# 找不到對應的檔案。兩邊都預設用 git 的短 SHA。

set -euo pipefail
cd "$(dirname "$0")/.."

: "${GLITCHTIP_URL:=https://glitchtip.koimsurai.com}"
: "${GLITCHTIP_ORG:=koimsurai}"
: "${GLITCHTIP_PROJECT:=koimsurai-frontend}"
: "${CONTAINER:=personal-website-frontend}"
RELEASE="${RELEASE:-$(git rev-parse --short HEAD)}"

if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  # 沒帶就從未提交的 .env.sourcemaps 讀（權限 600，見 .gitignore）
  if [ -f .env.sourcemaps ]; then
    # shellcheck disable=SC1091
    . ./.env.sourcemaps
  else
    echo "缺 SENTRY_AUTH_TOKEN（或 .env.sourcemaps）" >&2
    exit 1
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▶ 從 $CONTAINER 取出建置產物…"
docker cp "$CONTAINER:/app/.output/public/assets/." "$TMP/" >/dev/null

MAPS=$(find "$TMP" -name '*.map' | wc -l)
if [ "$MAPS" -eq 0 ]; then
  echo "❌ 容器裡沒有 .map 檔。確認 vite.config.start.ts 的 build.sourcemap 是 'hidden'，" >&2
  echo "   而且**重新建置過映像**（改設定不會讓已經跑著的容器生出 map）。" >&2
  exit 1
fi
echo "  找到 $MAPS 個 .map"

echo "▶ 上傳到 $GLITCHTIP_URL（release=$RELEASE）…"
export SENTRY_URL="$GLITCHTIP_URL" SENTRY_ORG="$GLITCHTIP_ORG" SENTRY_PROJECT="$GLITCHTIP_PROJECT"
export SENTRY_AUTH_TOKEN

pnpm exec sentry-cli releases new "$RELEASE"
# ⚠️ 指令是 `sourcemaps upload`，不是舊版的 `releases files <ver> upload-sourcemaps`
#   ——後者在 sentry-cli v3 已經移除（會回 "unrecognized subcommand 'files'"）。
#
# --url-prefix 要對上瀏覽器實際載入的路徑，否則檔名比對不上，症狀同樣是
# 「沒有錯誤，但 stack 還是 minify 的」。assets 在 /assets/ 底下供應。
# rewrite 是預設行為（要關才加 --no-rewrite）。
pnpm exec sentry-cli sourcemaps upload "$TMP" \
  --release "$RELEASE" \
  --url-prefix '~/assets'
pnpm exec sentry-cli releases finalize "$RELEASE"

echo "✅ 完成。到 $GLITCHTIP_URL 開一個 issue 確認 stack 已還原成 .tsx 檔名與行號。"
