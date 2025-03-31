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
    }
  },
  assetsInclude: ['**/*.JPG'], // 告訴 Vite 將 .JPG 視為靜態資源
  optimizeDeps: {
    include: ['tsparticles-slim', '@tsparticles/react'], // 同時包含引擎和 React 元件
  },
})
