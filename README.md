# 宙と木 (Koimsurai) — Personal Site & Blog

[![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-EF4444?style=for-the-badge&logo=react&logoColor=white)](https://tanstack.com/start)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Axum](https://img.shields.io/badge/axum-5A5A5A?style=for-the-badge&logo=rust&logoColor=white)](https://github.com/tokio-rs/axum)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![前端覆蓋率](https://img.shields.io/codecov/c/github/timo9378/sora-to-ki/main?flag=frontend&label=frontend%20cov&style=for-the-badge&logo=codecov&logoColor=white)](https://app.codecov.io/gh/timo9378/sora-to-ki?flags%5B0%5D=frontend)
[![後端覆蓋率](https://img.shields.io/codecov/c/github/timo9378/sora-to-ki/main?flag=backend&label=backend%20cov&style=for-the-badge&logo=codecov&logoColor=white)](https://app.codecov.io/gh/timo9378/sora-to-ki?flags%5B0%5D=backend)

Koimsurai 的個人網站原始碼。一個 full-stack blog + portfolio + 多平台 activity dashboard，從 2025 年 4 月持續開發到現在。

> 2026-07：後端完成 **Express → Rust (axum)** strangler 遷移（120+ 端點逐一 byte-identical 對拍驗證），前端為 **TanStack Start SSG**。遷移全記錄見 [`backend/STRANGLER.md`](backend/STRANGLER.md)。

🌐 **Live**: <https://koimsurai.com>

---

## ✨ Features

### Blog（手記）

- **完整 CMS** — 自製管理後台、文章 / 分類 / 標籤 / 系列文 / 評論 / 訂閱者 / 圖片管理
- **Markdown 編輯器** — Monaco Editor + Vim 模式 + 自訂 snippets + 斜線指令 + 拖放上傳
- **語法高亮** — Shiki async highlight，零 client-side 庫 bundle
- **Mermaid 圖表** — 即時渲染 + 多主題 + zoom/pan/fullscreen
- **多語系 i18n** — 繁中 / 簡中 / English / 日本語，OpenCC 自動轉繁簡，每語系獨立 Monaco model
- **AI 輔助** — AI 摘要生成、AI 標籤建議、文章自動生成
- **Thumbhash** — 上傳圖片自動產 25-byte hash 作為模糊佔位圖防 CLS
- **Newsletter** — Resend 整合，published 時自動推送，前端持久化訂閱狀態 + 一鍵退訂
- **PWA** — vite-plugin-pwa autoUpdate，NetworkFirst posts API、CacheFirst 圖片

### Home / Portfolio

- **3D 互動** — Three.js + @react-three/fiber Saturn 場景，hyperspace canvas intro 動畫
- **多平台 Activity Dashboard** — 即時抓 WakaTime / GitHub / Steam / Spotify 數據
  - Steam 個人化卡片：動畫頭像 + 頭像框 + 等級徽章 + nameplate webm
  - Spotify circuit breaker：audio-features API 廢棄後改抓 metadata + cache
- **照片牆** — Masonry layout + EXIF 提取 + AI CLIP Tagger 自動標籤 + 全螢幕 PhotoViewer (zoom/pan/share)
- **3D 書櫃** — Zero Gravity Library，可拖曳 3D 書本互動
- **資訊頁** — 此站點 / 歷史 / 留言 / 友鏈，sticky TOC + scrollspy
- **OAuth 登入** — GitHub / Google，RBAC 用戶分權

### Infra

- **API Gateway** — Rust (axum) 後端，串接外部 API 並保護 keys
- **動態 Sitemap** — 每語系獨立 URL + hreflang alternates
- **OG 圖自動生成** — 文章發布時自動產 1200×630 OG card
- **Dependabot 緊跟** — 漏洞 < 24 小時內處理

---

## 🛠️ Tech Stack

### Frontend
- **React 19** + **TanStack Start**（SSG + SSR）+ **Vite**
- **Tailwind CSS** + 大量 scoped CSS modules
- **Three.js / @react-three/fiber** for 3D scenes
- **Framer Motion** + **React Spring** for animations
- **Monaco Editor** with monaco-vim for blog editing
- **Shiki** lazy-loaded code highlighting
- **Mermaid** with ELK layout
- **React-Markdown** + remark-gfm + remarkAlert + rehype-raw

### Backend（Rust）
- **axum** + **tokio** + **sqlx**（SQLite）
- **JWT (HS256)** + **bcrypt** authentication（與舊 bcryptjs hash 相容）
- **image / resvg / webp / thumbhash / kamadak-exif** — 圖片管線（取代 sharp）
- **ferrous-opencc** — 繁簡轉換（純 Rust）
- **[anigamer](https://github.com/timo9378/anigamer-rs)** — 自製巴哈動畫瘋 SDK（獨立 crate）
- **Resend**（reqwest 直打 API）transactional email
- **specta** — Rust struct → TS 型別（`packages/api-types`，前端型別單一來源）

### DevOps
- **Docker Compose**（`frontend` + `backend-rs` + 共用 volumes）
- **Nginx** reverse proxy（靜態圖 alias 直 serve）
- **pnpm workspace** + **Cargo workspace** monorepo

---

## ⚙️ Local Development

### Prerequisites
- Node.js v20+
- pnpm v10+
- Docker + Docker Compose（推薦走 Docker 跑）

### Setup

```bash
git clone https://github.com/timo9378/sora-to-ki.git
cd sora-to-ki

# 後端 .env
cp backend/.env.example .env.backend
# 編輯 .env.backend，填入 ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET /
# WAKATIME_API_KEY / STEAM_API_KEY / STEAM_ID / SPOTIFY_* / RESEND_API_KEY 等

# 安裝
pnpm install

# 開發模式（單獨跑 frontend，後端打 13588）
pnpm dev
```

### Docker (推薦)

```bash
docker compose up -d --build
# 站點：http://localhost:13588
docker compose logs -f frontend backend-rs
```

---

## 📂 Project Structure

```
/
├── backend/                 # Rust (axum) API — 全部業務邏輯
│   ├── src/main.rs          # 路由總表（120+ 端點）
│   ├── src/handlers/        # 按域拆分（posts/thoughts/watch/gallery/…）
│   ├── src/bin/export_types.rs  # specta → packages/api-types
│   └── STRANGLER.md         # Express→Rust 遷移全記錄
├── packages/
│   └── api-types/           # Rust struct 生成的 TS 型別（勿手改）
├── src/
│   ├── components/
│   │   ├── animate-ui/      # shadcn animate-ui icons
│   │   ├── article-preview/ # hover sidebar 文章 preview 卡片
│   │   ├── mega-menu/       # 三欄式 mega menu 系統
│   │   ├── BlogPost.jsx     # 主文章頁
│   │   ├── InfoPage.jsx     # 此站點 / 歷史 / 留言 / 友鏈 layout
│   │   └── admin/           # 後台
│   ├── hooks/
│   └── lib/
├── public/
├── Dockerfile
└── docker-compose.yml
```

---

## 📜 Scripts

```bash
pnpm dev           # frontend dev server
pnpm build         # production build
pnpm preview       # serve production build
pnpm build:photos  # 處理照片牆圖片（EXIF + thumbhash + CLIP tagger）

# 後端
cd backend && cargo run              # 本機跑（讀 .env）
cd backend && cargo run --bin export_types  # 重生 TS 型別
```

---

## 🌌 More

站點走過的路：<https://koimsurai.com/history>
此站點 Q&A：<https://koimsurai.com/about-site>

歡迎友鏈：<https://koimsurai.com/friends>
