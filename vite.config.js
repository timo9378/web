import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'; // 引入 fs 模組來讀取憑證檔案
import { visualizer } from 'rollup-plugin-visualizer'; // 引入 visualizer
import purgeCss from 'vite-plugin-purgecss'; // <--- 修改為預設導入

// https://vite.dev/config/
export default defineConfig(({ command }) => { // 將 defineConfig 包裹在函式中，接收 command 參數
  // 只有在 serve 或 preview 指令時才嘗試讀取憑證
  const shouldEnableHttps = command === 'serve' || command === 'preview';
  let httpsConfig = false;
  if (shouldEnableHttps) {
    try {
      httpsConfig = {
        key: fs.readFileSync('/etc/certs/privkey.pem'),
        cert: fs.readFileSync('/etc/certs/fullchain.pem'),
      };
    } catch (e) {
      console.warn('無法讀取 HTTPS 憑證，將以 HTTP 模式啟動。錯誤:', e.message);
      // 如果在本機執行 serve/preview 且找不到 Docker 路徑的憑證，則退回 HTTP
      // 在 Docker 環境中，這些檔案應該存在
    }
  }


  return {
    plugins: [
      react(),
      // 只在 build 指令時啟用 visualizer
      ...(command === 'build' ? [visualizer({ open: true, gzipSize: true, brotliSize: true })] : []),
      // <--- 加入 PurgeCSS 插件設定
      purgeCss({
        content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'], // 指定掃描的檔案
        safelist: { // 保留可能被動態使用或 PurgeCSS 誤判的樣式
          // 例如：保留所有以 'fade-' 開頭的類別 (如果有的話)
          // greedy: [/fade-.*/]
          // 保留特定的類別
          // standard: ['active', 'modal-open']
        }
      })
    ],
    server: {
      host: true, // 監聽所有主機
      port: 13579,
      // 根據 httpsConfig 決定是否啟用 https
      ...(httpsConfig && { https: httpsConfig }),
      hmr: {
        // 因為使用了 https，WebSocket 協議應為 wss
        // 只在啟用 https 時設定
        ...(httpsConfig && { protocol: 'wss' }),
        // 客戶端應連線到與伺服器相同的端口
        clientPort: 13579
      }
    },
    preview: { // Add explicit preview server config
      host: true, // Listen on all hosts (important for Docker)
      port: 13579, // Match the desired port
      // 根據 httpsConfig 決定是否啟用 https
      ...(httpsConfig && { https: httpsConfig })
    },
    assetsInclude: ['**/*.JPG'], // 告訴 Vite 將 .JPG 視為靜態資源
    optimizeDeps: {
      include: ['tsparticles-slim', 'react-tsparticles'], // 同時包含引擎和 React 元件 (修正套件名稱)
    },
  }
})
