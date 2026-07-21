# MorPex v9.2 Deployment Guide

## Prerequisites

- Node.js >= 20.0.0
- Docker & Docker Compose (optional, for containerized deployment)
- SQLite 3.x (bundled via better-sqlite3)

## Quick Start (Local)

```bash
cp .env.example .env
# Edit .env: set DEEPSEEK_API_KEY
npm ci
npm run build
npx tsx packages/core/src/main.ts
```

## Docker Deployment

### Single Node

```bash
docker compose -f configs/docker-compose.yml up -d
```

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
