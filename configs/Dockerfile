# ═══════════════════════════════════════════════════════════════
# Morpex v1.8 — Docker 多阶段构建
#
# 构建:
#   docker build -t morpex:latest .
#
# 运行:
#   docker run -d \
#     -p 8080:8080 \
#     -v morpex-data:/app/data \
#     -e DEEPSEEK_API_KEY=your_key \
#     --name morpex \
#     morpex:latest
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: 前端构建 ─────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# 安装前端依赖
COPY studio/ui/package.json studio/ui/package-lock.json ./studio/ui/
RUN cd studio/ui && npm ci --only=production

# 构建前端
COPY studio/ui/ ./studio/ui/
RUN cd studio/ui && npm run build

# ── Stage 2: 后端构建 ──────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /app

# 安装系统依赖（zvec 需要编译工具）
RUN apk add --no-cache python3 make g++ git

# 安装后端依赖
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild @zvec/zvec

# TypeScript 类型检查（编译前）
COPY tsconfig.json ./
COPY src/ ./src/

# ── Stage 3: 最终运行镜像 ─────────────────────────────
FROM node:22-alpine

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache \
    python3 \
    tini \
    curl \
    ca-certificates \
  && rm -rf /var/cache/apk/*

# 添加非 root 用户
RUN addgroup -S morpex && adduser -S morpex -G morpex

# 复制依赖
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/tsconfig.json ./

# 复制后端源码
COPY src/ ./src/

# 复制前端构建产物（由 backend 静态服务）
COPY --from=frontend-builder /app/studio/ui/dist ./studio/ui/dist

# 创建数据目录
RUN mkdir -p /app/data/zvec /app/data/sessions /app/data/workspace \
  && chown -R morpex:morpex /app/data

# 健康检查脚本
COPY scripts/health-check.sh /app/scripts/health-check.sh
RUN chmod +x /app/scripts/health-check.sh

# 环境变量
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV EMBEDDING_URL=
ENV DEEPSEEK_API_KEY=
ENV LLM_MODEL=deepseek-chat
ENV CONFIG_PATH=
ENV SKIP_EMBEDDING=1  # Docker 内默认跳过 Python embedding

# 暴露端口
EXPOSE 8080

# 使用 tini 作为 init 进程（正确处理信号）
ENTRYPOINT ["/sbin/tini", "--"]

# 启动命令
CMD ["node", "--experimental-specifier-resolution=node", "--loader", "tsx/esm", "src/main.ts"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["/app/scripts/health-check.sh", "--json"]
