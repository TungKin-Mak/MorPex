# @morpex/memory — 记忆系统

> **统一记忆层**：MemoryWiki（SQLite-only 图/元数据持久化）+ MemoryAPI（cognee 权威知识图谱引擎 + 白名单 + 确认队列 + 强制门禁）。
> zvec 向量库与 BGE-M3 embedding 已废弃移除（S17），语义检索由 cognee 统一记忆层接管。

---

## 组成

| 模块 | 职责 | 状态 |
|------|------|------|
| **MemoryAPI** (`api/`) | 统一记忆契约：`upsert`（写图）/ `query`（强制检索，空/低置信 → `need_human`）/ `rememberEpisode` / 确认队列 | ✅ 权威层 |
| **cognee 引擎** (`engines/cognee/`) | 本地知识图谱（图核心 + 本体生成 + 双时间），HTTP 接入，无 Docker | ✅ |
| **MemoryWiki** (`wiki/`) | SQLite 统一后端：kg 实体/关系 + 领域表 + 事件日志 + 查询缓存；**已剥离 zvec/BGE-M3** | ✅ SQLite-only |
| **MemoryRetriever** (`wiki/`) | 关键词/标签检索（`retrieveForTask`），供 Studio 记忆搜索工具 | ✅ |
| **HistoryStore / JSONL / Compactor / LogRotator** (`storage/`) | 执行历史与运维工具 | ✅ |
| **门禁** (`gate/`) | `ForceRetriever`：空检索/低置信 → `need_human`，禁止模型补全（防幻觉） | ✅ |
| **本体白名单** (`ontology/`) | 实体/关系类型白名单 + 校验 | ✅ |

## MemoryAPI 使用

```typescript
import { createMemoryApi, createEngine } from '@morpex/memory';

const api = createMemoryApi({
  engine: createEngine({ baseUrl: process.env.COGNEE_URL ?? 'http://localhost:8001' }),
});

// 写（高置信直接进图；低置信/冲突进确认队列）
const u = await api.upsert({
  name: 'MorPex 报表产品', entityType: 'Product',
  facts: ['定价 899 元/月'], confidence: 0.95,
});
// u.status === 'written' | 'pending_confirm'

// 查（强制检索：空/低置信 → need_human=true，不伪造）
const r = await api.query({ text: '报表产品定价多少', domain: 'product' });
if (r.need_human) { /* 询问用户 */ } else { /* 用 r.hits（纯图证据）回答 */ }
```

## MemoryWiki 使用（SQLite-only）

```typescript
import { MemoryWiki } from '@morpex/memory';

const wiki = new MemoryWiki({ dbPath: './data/memory.db' });
await wiki.initialize();
await wiki.remember({ id: 'e1', type: 'PlanRecord', name: '...', data: { ... }, relations: [] });
const stats = wiki.getStats(); // kgEntities / kgRelations / ...
wiki.close();
```

## 引擎部署（cognee）

```bash
COGNEE_PORT=8001 ./scripts/start-cognee.sh --bg   # 一键启动（建 venv → 装 cognee → 起 :8001）
curl http://localhost:8001/health
npx tsx scripts/e2e-cognee.ts                     # 端到端验证（写 → 图检索 → need_human）
```

引擎离线时 `MemoryAPI.query` 返回 `need_human=true`（不伪造）；`upsert` 转确认队列。**引擎故障不会导致幻觉。**

## 文件结构

```
packages/memory/
├── src/
│   ├── index.ts              # 入口 — 导出所有组件
│   ├── memory-types.ts       # 统一记忆契约类型（MemoryAPI/EngineHit/...）
│   ├── api/                  # MemoryApi + createMemoryApi + 确认队列
│   ├── engines/              # cognee / mock 引擎适配器
│   ├── gate/                 # ForceRetriever（need_human 门禁）
│   ├── ontology/             # 公司知识本体白名单 + 校验
│   ├── wiki/                 # MemoryWiki(SQLite) + DocWatcher/Topology + MemoryRetriever
│   └── storage/              # HistoryStore / JSONLWriter / Compactor / LogRotator
├── __tests__/unified-memory.spec.ts   # 统一记忆层测试（mock 引擎）
└── README.md
```

## 历史（已移除组件）

- **zvec**（`@zvec/zvec`）：HNSW 向量库。被 cognee 图+向量能力取代（S17 移除）。
- **BGE-M3 embedding**（`tools-python/embedding-server.py` + `data/models/bge-m3`）：本地嵌入服务。被 cognee fastembed 取代（S17 移除）。
- **MemoryBus v2**（`core/MemoryBus.js`）：已不存在的旧实现，相关 e2e 一并删除。
