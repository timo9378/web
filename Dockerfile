# 使用官方 Node.js LTS Alpine 映像作為基礎
FROM node:18-alpine AS builder

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json (或 yarn.lock)
COPY package*.json ./

# 安裝依賴套件
RUN npm install

# 複製專案的其餘檔案
COPY . .

# 設定環境變數 (如果需要)
# ENV NODE_ENV=production

# 建置應用程式 (如果您的應用程式需要建置步驟)
# RUN npm run build

# 暴露 Vite 開發伺服器使用的端口 (根據 vite.config.js)
EXPOSE 13579

# 執行 Vite 預覽伺服器 (會先執行 build，並在生產模式下提供服務)
# host 和 port 已在 vite.config.js 中配置
CMD ["npm", "run", "dev"]

# --- Production Stage (Optional Example) ---
# 如果您想建立一個更小的生產映像檔，可以考慮多階段建置
# FROM nginx:alpine
# COPY --from=builder /app/dist /usr/share/nginx/html
# COPY nginx.conf /etc/nginx/conf.d/default.conf # 假設您有 nginx 設定檔
# EXPOSE 80
# CMD ["nginx", "-g", "daemon off;"]
