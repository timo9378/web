# koimsurai-web-backend（Rust）— anigamer 走 crates.io
# build context = web root（workspace：root Cargo.toml/lock + backend/）
#
# 用 cargo-chef 把「編 453 個相依」與「編自己那幾千行」拆成兩個 layer。
#
# 為什麼不再用 `--mount=type=cache`：cache mount 的內容**不會被任何** buildx cache
# backend 匯出（gha / registry / local / s3 都一樣，見 moby/buildkit#1512，2020-05
# 開到現在未解，維護者明確反對）。那不是 type=gha 的限制，是 cache mount 的設計。
#
# 這件事在「原始碼沒動」時看不出來——RUN 那一步的**結果層**本來就匯得出去，所以
# 整層命中只要 11s，看起來很健康。痛點在原始碼一改：RUN 的 cache key 失效、必須
# 真的執行，而此時 mount 是空的 → 453 個相依從零重編。
#
# 本機實測（全新 builder + cache-from，模擬 CI 的乾淨 runner）：
#                       舊(cache mount)   新(cargo-chef)
#   冷建（無快取）           150s            202s   ← 變慢，見下方
#   改過 .rs 後重建          127s             44s   ← 2.9×，這格才是常態
#   匯出的 cache 大小        351M            939M   ← 變大，見下方
#   runtime image            966MB           966MB  ← 不變
#
# 兩個退步是刻意換的：
#   冷建 +52s —— 其中 21.6s 是 `cargo install cargo-chef`（只在 rust 版本變動時重跑），
#                其餘是「相依在 cook 編一次、自己的 crate 再連結一次」的重疊成本。
#                冷建只在 Cargo.lock 變動或快取整個不見時發生。
#   cache +588M —— 相依的編譯產物現在真的落在 layer 裡（本來就是目的）。
#                  正因如此 CI 的快取才從 type=gha（硬性 10 GB/repo、LRU 淘汰）
#                  搬去 GHCR；那 10 GB 上限被撐爆正是 546s 冷建的成因。
FROM rust:1.97-slim AS chef
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*
# host 的 ~/.cargo/config.toml（jobs=6 散熱上限）進不了容器 →
# 這裡明確設,避免 Docker build 用滿 16 執行緒燒機（94°C 那次的成因）。
ENV CARGO_BUILD_JOBS=6
RUN cargo install cargo-chef --locked --version 0.1.77
WORKDIR /build

# planner 只負責產出 recipe.json（相依清單的正規化形式）。
# 它的輸入是全部原始碼所以每次都重跑，但只是解析 manifest，不編譯。
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY backend ./backend
# ⚠ 這行不是可有可無的清理。`cargo chef prepare` 會用 `cargo metadata` 正規化 manifest，
# 而 metadata 會**自動發現** tests/ benches/ examples/ 底下的檔案，把它們寫成明確的
#   [[test]] path = "tests/admin.rs" name = "admin" …
# 區塊塞進 recipe.json。結果是「新增一個測試檔」就讓 recipe 變了 → 下面的 cook 層失效
# → 453 個相依從零重編。實測 CI 上是 306s，而 cook 只編**正式相依**、根本用不到
# 測試 target。（追出來的方式：比對三次 CI，只有動過 Cargo.toml 的那次該重編，
# 但新增 backend/tests/*.rs 的那次也重編了；用 docker 跑兩次 prepare 對 diff 確認。）
#
# dev-dependencies 仍留在 Cargo.toml 文字裡、不受影響；builder 稍後會把完整的
# backend/ 再 COPY 一次，真正的建置看得到全部檔案。
RUN rm -rf backend/tests backend/benches backend/examples
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /build/recipe.json recipe.json
# 這層唯一的輸入是 recipe.json —— 只有 Cargo.toml / Cargo.lock 動過才會失效。
# 一般的後端 commit（只改 .rs）直接命中，453 個相依一個都不重編。
RUN cargo chef cook --release --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY backend ./backend
RUN cargo build --release -p koimsurai-web-backend \
    && cp target/release/koimsurai-web-backend /koimsurai-web-backend

# ⚠ 必須跟 builder 的 rust:1.97-slim 同一個 Debian 版本（現在是 trixie / glibc 2.41）。
# 上游 rust image 換 base 後這裡沒跟上，binary 會在啟動時死在
# `libc.so.6: version 'GLIBC_2.39' not found`——編得起來、跑不起來。
FROM debian:trixie-slim
# fonts-noto-cjk：OG 圖 SVG 光柵化字型；ca-certificates：對外 HTTPS；curl：healthcheck
# ffmpeg：上傳影片正規化（把 tkhd 旋轉矩陣烘進畫素，見 handlers/upload.rs）。
# 用 -no-install-recommends 只帶必要相依，image 約多 100 MB。
#
# `upgrade` 是為了吃到 base image 快照之後才發的安全更新：debian:trixie-slim 目前帶的
# libexpat1 是 2.7.1-2，而 2.8.2-1~deb13u1 已經修掉 5 個 HIGH（trivy --ignore-unfixed 掃到的）。
# 沒有這行的話，那 5 筆會一直掛在報告上，而它們其實一個 apt 就解決得掉。
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    fonts-noto-cjk ca-certificates curl tzdata ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY --from=builder /koimsurai-web-backend /usr/local/bin/koimsurai-web-backend
EXPOSE 3002
CMD ["koimsurai-web-backend"]
