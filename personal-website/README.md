# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript and enable type-aware lint rules. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Docker 設定 (含 SSL)

此專案包含使用 Docker Compose 在 Docker 容器中運行開發伺服器的設定，並支援使用提供的 SSL 憑證啟用 HTTPS。

**先決條件：**

*   已安裝 Docker 和 Docker Compose。
*   SSL 憑證檔案 (`privkey.pem` 和 `fullchain.pem`) 已放置在 `personal-website` 目錄的根目錄下。**重要：** 這些檔案已包含在 `.gitignore` 中，**不應**被提交到版本控制系統。

**使用 Docker Compose 運行：**

1.  在您的終端機中，切換到 `personal-website` 目錄。
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
