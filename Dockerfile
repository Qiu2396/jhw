# 聚搜王 生产镜像：前端构建 + 后端一体，单容器运行
# 免费托管（Render / Koyeb / Back4App / HF Spaces 等）通用
FROM node:22-slim

WORKDIR /app

# 先装依赖（利用层缓存）
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN cd server && npm ci --omit=dev \
    && cd ../client && npm ci

# 再拷源码并构建前端
COPY client ./client
RUN cd client && npm run build

# server/data 由后端启动时自动创建（首次启动灌入种子源）
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# 健康检查: /api/health
CMD ["node", "server/src/index.js"]
