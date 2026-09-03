# ScholarForge 多阶段构建：单镜像同时包含后端与已构建的前端
# 架构说明：生产模式下 server 会托管 client/dist 静态资源（见 server/src/index.js）

# ---------- Stage 1: 构建前端 ----------
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- Stage 2: 安装后端依赖（含原生模块编译工具） ----------
FROM node:22-slim AS server-deps
WORKDIR /app/server
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
# 本地 vendored 依赖（SheetJS 本地化）：package.json 以 file:vendor/xlsx-0.20.3.tgz 引用，必须先拷入
COPY server/vendor/ ./vendor/
# 仅安装生产依赖；better-sqlite3 / sharp 等原生模块在此阶段编译/下载
RUN npm ci --omit=dev

# ---------- Stage 3: 运行时 ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/server

# tini 作为 PID 1，确保 SIGTERM 正确传递给 node，触发优雅关闭（见 index.js 的 shutdown）
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/ ./

# 前端构建产物放置到 server 预期的 ../../client/dist 路径
RUN mkdir -p /app/client
COPY --from=client-build /app/client/dist /app/client/dist

# 运行时可变目录（建议挂卷持久化）
RUN mkdir -p /app/server/data /app/server/uploads /app/server/logs

EXPOSE 3001
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/index.js"]
