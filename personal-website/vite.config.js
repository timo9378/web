import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.JPG'], // 告訴 Vite 將 .JPG 視為靜態資源
  optimizeDeps: {
    include: ['tsparticles-slim', '@tsparticles/react'], // 同時包含引擎和 React 元件
  },
})
