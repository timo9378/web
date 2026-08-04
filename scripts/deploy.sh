#!/usr/bin/env bash
# 部署。存在的理由是**順序**——這幾步分開手動做一定會出錯：
#
#   1. commit（release 標記要有意義）
#   2. build（VITE_RELEASE 烤進 bundle）
#   3. up -d
#   4. 上傳 source map（release 必須跟第 2 步烤進去的那個一樣）
#
# 第 2 與第 4 步的 release 對不上時，GlitchTip 找不到對應的 map——症狀是 stack trace
# 依然是 minify 的，**而且不會有任何錯誤訊息**。寫這支腳本的當天就踩了一次：
# build 用了 commit 前的 SHA、上傳用了 commit 後的。
#
# ⚠️ 為什麼不放 CI：CI 建的產物不是部署的那份。CI 上沒有 VITE_RELEASE 與
#   VITE_SENTRY_DSN，bundle 內容不同 → 檔名 hash 不同 → map 對不上。
#   要 CI 傳就得讓 CI 也負責部署，那是另一個決定。
#
# 用法：
#   ./scripts/deploy.sh              # 前後端都重建
#   ./scripts/deploy.sh frontend     # 只動前端
#   ./scripts/deploy.sh backend      # 只動後端（不碰 source map）

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"
case "$TARGET" in
  all | frontend | backend) ;;
  *)
    echo "用法: $0 [all|frontend|backend]" >&2
    exit 1
    ;;
esac

# 有未提交的變更時 release 標記是騙人的：它指向一個不含這些改動的 commit。
# 之後看 issue 會以為「那個版本沒這段程式碼」而找錯方向。
if [ -n "$(git status --porcelain -- ':!test2.md')" ]; then
  echo "⚠️  工作區有未提交的變更，release 標記會對不上實際部署的內容。" >&2
  git status --short -- ':!test2.md' >&2
  echo >&2
  read -r -p "還是要繼續嗎？(y/N) " ans
  [ "$ans" = "y" ] || exit 1
fi

RELEASE="$(git rev-parse --short HEAD)"
export VITE_RELEASE="$RELEASE"
echo "▶ release = $RELEASE"

# VITE_SENTRY_DSN 由 docker compose 自己從 ./.env 讀（compose 的變數替換會自動載入），
# 不必在這裡 export。

if [ "$TARGET" = "backend" ]; then
  docker compose up -d --build backend-rs
elif [ "$TARGET" = "frontend" ]; then
  docker compose up -d --build frontend
else
  docker compose up -d --build
fi

# 等 healthy 再往下——source map 要從**跑起來的容器**裡取產物。
if [ "$TARGET" != "backend" ]; then
  echo "▶ 等前端就緒…"
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://127.0.0.1:13588/; then break; fi
    sleep 2
  done

  if [ -f .env.sourcemaps ] || [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
    RELEASE="$RELEASE" ./scripts/upload-sourcemaps.sh
  else
    echo "⚠️  沒有 .env.sourcemaps，跳過 source map 上傳。" >&2
    echo "   GlitchTip 上的 stack trace 會是 minify 過的。" >&2
  fi
fi

echo "✅ 部署完成（release $RELEASE）"
