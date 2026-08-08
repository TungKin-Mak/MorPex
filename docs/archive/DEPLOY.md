# MorPex Deployment Guide

> 2026-08 更新：**推荐本地直接部署（无需 Docker）**。Docker 方案保留但非主路径。

## Prerequisites

- Node.js >= 20.0.0
- SQLite 3.x (bundled via better-sqlite3)
- （可选）Python 3.12 + cognee venv（真实记忆引擎，mock 模式可省）

## 本地直接部署（推荐，无 Docker）

```bash
cp .env.example .env
# 编辑 .env: 设置 DEEPSEEK_API_KEY（LLM/记忆需要）

npm ci

# 方式 A：仅后端 API（mock 记忆，无需 cognee）
MEMORY_ENGINE=mock npx tsx packages/studio/server/index.ts
# → http://localhost:8080/api/health

# 方式 B：全栈（真实 cognee 记忆）
./scripts/run-all.sh    # 自动探测/复用 venv，起 cognee(:8001) + 后端(:8080)

# 生产模式（PM2）
npm start               # pm2 start configs/pm2-ecosystem.config.cjs
npm run start:status    # 查看进程状态
```

## 架构可观测（部署后必看）

后端启动后，可观测面板即用：

```bash
curl localhost:8080/api/observability/audit        # 绕过检测（8 层契约）
curl localhost:8080/api/observability/observations  # 真实执行事件链
curl localhost:8080/api/observability/modules-v2    # 每层模块健康
```

完整运维手册：`SESSION_LOG.md §6`。

## Docker Deployment（可选）

> ⚠️ 当前 `configs/Dockerfile` 已过时（引用 S23 已删的前端 + `src/main.ts`），需重写后再用；compose healthcheck 已修复为 `/api/health`。**本地直接部署为推荐路径**。

### Multi-Node (Distributed Mode)

```yaml
# configs/docker-compose.v9.yml
version: '3.8'
services:
  morpex-node1:
    build: .
    environment:
      - NODE_ID=node-1
      - MORPEX_DISTRIBUTED_ENABLED=true
      - MORPEX_NODE_ID=node-1
      - MORPEX_DISTRIBUTED_ADDRESS=0.0.0.0:9527
    ports: ["8080:8080", "9527:9527"]
    volumes: ["morpex-data-1:/app/data"]

  morpex-node2:
    build: .
    environment:
      - NODE_ID=node-2
      - MORPEX_DISTRIBUTED_ENABLED=true
      - MORPEX_NODE_ID=node-2
      - MORPEX_DISTRIBUTED_ADDRESS=0.0.0.0:9527
    ports: ["8081:8080", "9528:9527"]
    volumes: ["morpex-data-2:/app/data"]

volumes:
  morpex-data-1:
  morpex-data-2:
```

## PM2 Cluster Mode

```bash
pm2 start configs/pm2-ecosystem.config.cjs
pm2 status
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes | — | LLM API key |
| `MORPEX_DB_PATH` | No | `./data/morpex-events.db` | SQLite database path |
| `MORPEX_DISTRIBUTED_ENABLED` | No | `false` | Enable distributed mode |
| `MORPEX_NODE_ID` | No | `node-1` | Unique node identifier |
| `MORPEX_MARKETPLACE_ENABLED` | No | `false` | Enable Agent Marketplace |
| `MORPEX_ENCRYPTION_KEY` | No* | — | 32-byte hex key for sensitive field encryption |

See full list in `.env.example`.

## Health Check

```bash
curl http://localhost:8080/health
# {"status":"healthy","checks":{"sqlite_ping":{"status":"ok"}},...}

curl http://localhost:8080/metrics
# HELP process_uptime_seconds Time since process start
# TYPE process_uptime_seconds gauge
# process_uptime_seconds{pid="1234"} 42.0
```

## Backup & Restore

```bash
# Backup
cp data/morpex-events.db backups/morpex-$(date +%Y%m%d).db

# Restore
cp backups/morpex-20250101.db data/morpex-events.db
```

## Migration

```bash
npx tsx packages/core/src/scripts/migrate.ts
```
