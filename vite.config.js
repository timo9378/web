import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'; // 引入 fs 模組來讀取憑證檔案

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 監聽所有主機
    port: 13579,
    https: {
      // 使用容器內的路徑，稍後會透過 volume mount 掛載
      key: fs.readFileSync('/etc/certs/privkey.pem'),
      cert: fs.readFileSync('/etc/certs/fullchain.pem'),
    },
    hmr: {
      // 因為使用了 https，WebSocket 協議應為 wss
      protocol: 'wss',
      // 客戶端應連線到與伺服器相同的端口
      clientPort: 13579
    }
  },
  preview: { // Add explicit preview server config
    host: true, // Listen on all hosts (important for Docker)
    port: 13579, // Match the desired port
    https: { // Enable HTTPS for preview as well
      key: fs.readFileSync('/etc/certs/privkey.pem'),
      cert: fs.readFileSync('/etc/certs/fullchain.pem'),
    }
  },
  assetsInclude: ['**/*.JPG'], // 告訴 Vite 將 .JPG 視為靜態資源
  optimizeDeps: {
    include: ['tsparticles-slim', 'react-tsparticles'], // 同時包含引擎和 React 元件 (修正套件名稱)
  },
})
