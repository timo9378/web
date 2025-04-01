# 個人作品集網站 (Personal Portfolio Website)

這是一個使用 React 和 Vite 建置的個人作品集網站，展示了我的技能、經歷和專案。

## ✨ 主要功能

*   **英雄區塊 (Hero Section):** 引人入勝的首頁介紹。
*   **專業技能 (Expertise):** 展示我的技術專長。
*   **工作經歷 (Work Experience):** 列出相關的工作經驗。
*   **學術/社團經歷 (School Clubs):** 展示在校期間的活動參與。
*   **作品集 (Portfolio):** 展示個人專案和作品。
*   **照片集 (Photo Gallery):** 精選照片展示。
*   **聯絡方式 (Contact):** 提供聯絡表單或資訊。
*   **互動效果:**
    *   滑鼠軌跡效果 (Cursor Trail)
    *   載入動畫 (Loading Screen)
    *   轉場動畫 (Transition Animation)
    *   隨機彗星、流星、UFO 動畫
    *   閃爍星空背景
    *   3D 土星模型 (使用 Three.js)
    *   回到頂部按鈕 (Back To Top)

## 🚀 使用技術

*   **前端框架:** React
*   **建置工具:** Vite
*   **樣式:** CSS (搭配 CSS Modules 或一般 CSS)
*   **JavaScript**
*   **3D 圖形:** Three.js (用於土星模型)
*   **版本控制:** Git
*   **容器化:** Docker, Docker Compose

## 🛠️ 本地開發設定 (使用 npm)

1.  **複製儲存庫:**
    ```bash
    git clone https://github.com/timo9378/web.git
    cd web-1
    ```
2.  **安裝依賴套件:**
    ```bash
    npm install
    ```
3.  **啟動開發伺服器:**
    ```bash
    npm run dev
    ```
    開發伺服器預設會在 `http://localhost:5173` (或其他可用埠號) 啟動。

## 🐳 Docker 設定 (含 SSL)

此專案包含使用 Docker Compose 在 Docker 容器中運行開發伺服器的設定，並支援使用提供的 SSL 憑證啟用 HTTPS。

**先決條件：**

*   已安裝 Docker 和 Docker Compose。
*   SSL 憑證檔案 (`privkey.pem` 和 `fullchain.pem`) 已放置在專案根目錄下 (與 `Dockerfile` 同層)。**重要：** 這些檔案已包含在 `.gitignore` 中，**不應**被提交到版本控制系統。

**使用 Docker Compose 運行：**

1.  在您的終端機中，確認您位於專案根目錄 (`web-1`)。
2.  建置並在背景模式 (detached mode) 啟動容器：
    ```bash
    docker-compose up -d --build
    ```
3.  開發伺服器將可透過 `https://localhost:13579` 訪問。由於使用的是本地憑證，您的瀏覽器可能會顯示安全警告，您需要手動確認才能繼續訪問。

**停止容器：**

```bash
docker-compose down
```

**查看日誌：**

```bash
docker-compose logs -f
