# 公司记忆引擎部署 — cognee（本地，无 Docker）

> 统一记忆层 `@morpex/memory` 的权威知识图谱引擎。
> cognee：本地文件存储（SQLite + LanceDB + KuzuDB）+ 图核心 + 本体生成 + 双时间（TEMPORAL）。
> 无 Docker、无数据库部署、无额外服务。引擎=Python 本地进程，业务层=TS（经 HTTP 调用）。

---

## 1. 一键启动

```bash
# 后台启动（推荐）
COGNEE_PORT=8001 ./scripts/start-cognee.sh --bg

# 前台启动（调试）
COGNEE_PORT=8001 ./scripts/start-cognee.sh

# 验证
curl http://localhost:8001/health
curl http://localhost:8001/api/v1/datasets
```

首次启动会：建 venv → 装 `cognee[fastembed]` → 下载本地嵌入模型（BAAI/bge-small-en-v1.5）。

## 2. 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `COGNEE_PORT` | 8001 | 服务端口 |
| `DEEPSEEK_API_KEY` / `LLM_API_KEY` | — | LLM key（必需） |
| `LLM_PROVIDER` | custom | OpenAI 兼容端点用 custom |
| `LLM_MODEL` | deepseek/deepseek-chat | litellm 格式 |
| `LLM_ENDPOINT` | https://api.deepseek.com | OpenAI 兼容 base_url |
| `EMBEDDING_PROVIDER` | fastembed | 本地嵌入，免 key |
| `EMBEDDING_MODEL` | BAAI/bge-small-en-v1.5 | 本地嵌入模型 |
| `COGNEE_DATA_DIR` | ~/.morpex/cognee | 数据目录（含图/向量/缓存） |

本地/离线：LLM 可指向 Ollama/LM Studio（`LLM_ENDPOINT=http://localhost:11434/v1`，模型 `ollama/...`），完全离线运行。

## 3. 后台常驻（生产）

### systemd（Linux 服务器）
```ini
# /etc/systemd/system/morpex-cognee.service
[Unit]
Description=MorPex Company Memory Engine (cognee)
After=network.target

[Service]
User=youruser
WorkingDirectory=/path/to/morpex
Environment=COGNEE_PORT=8001
Environment=DEEPSEEK_API_KEY=xxx
ExecStart=/bin/bash /path/to/morpex/scripts/start-cognee.sh
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
systemctl enable --now morpex-cognee
```

### PM2（已有 configs/pm2-ecosystem.config.cjs 可扩展）
```js
// 在 pm2 ecosystem 加一条：
{
  name: 'morpex-cognee',
  script: 'scripts/start-cognee.sh',
  interpreter: 'bash',
  env: { COGNEE_PORT: 8001, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
  autorestart: true,
}
```

## 4. 与统一记忆层（TS）对接

```typescript
import { createMemoryApi, createEngine } from '@morpex/memory';

const api = createMemoryApi({
  engine: createEngine({ baseUrl: process.env.COGNEE_URL ?? 'http://localhost:8001' }),
});

// 强制检索（空/低置信 → need_human=true，禁止模型补全）
const r = await api.query({ text: '报表产品定价多少', domain: 'product' });
if (r.need_human) { /* 询问用户 */ } else { /* 用 r.hits（纯图证据）回答 */ }

// 写入（高置信写图；低置信/冲突进确认队列）
const u = await api.upsert({ name: 'MorPex 报表产品', entityType: 'Product',
  facts: ['定价 899 元/月'], confidence: 0.95 });
// u.status === 'written' | 'pending_confirm'
```

引擎离线时：`MemoryAPI.query` 返回 `need_human=true`（不伪造）；`upsert` 转确认队列。**引擎故障不会导致幻觉。**

## 5. 端到端验证

```bash
npx tsx scripts/e2e-cognee.ts
# 预期：upsert written → 查询 need_human=false（命中图证据）→ 空检索 need_human=true
```

## 6. 选型备忘（为什么 cognee）

| 候选 | 结论 |
|---|---|
| MemoryJS | ✗ npm 包损坏（缺 package.json）+ 4★ 单人维护 + Windows 编译失败 |
| supermemory | ✗ 官方 CLI 不支持 Windows（有 exe 但版本早 v0.0.6 未验证） |
| mem0 | 🟡 最通用但图弱 + 需向量库（部署重） |
| agentmemory | 🟡 TS 原生最轻但 coding 专用（多领域非主场） |
| **cognee** | ✅ 29.6k★、TS SDK、图核心+本体生成+双时间、本地文件存储无 Docker、Windows 可跑 |
