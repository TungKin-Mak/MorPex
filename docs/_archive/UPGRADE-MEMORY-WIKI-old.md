# MemoryWiki 升级指南 — JSONL → SQLite + Zvec

> **版本**: v2.1 | **日期**: 2026-07-13  
> **状态**: ✅ 已完成  
> **依赖**: `better-sqlite3` `lru-cache` `@zvec/zvec`  
> **Gateway 集成**: AgentReasoningInterceptor 三层拦截

---

## 1. 目标

将 31 个 JSONL 文件的分散持久化统一到 **SQLite + Zvec** 双层架构（15 张表，16 个高层 API，9 条注入链路）。

---

## 2. 最终架构

```
                         StudioServer
                              │
                    initMetaPlanner()  initMemoryStorage()
                              │              │
                   new MemoryWiki(dbPath, embedder)
                     │         │         │
              setWiki()   setWiki()   setWiki()
                     │         │         │
              HistoryStore  MetaPlanner  KnowledgeGraph  MemoryBus
                              │
          ┌───────────────────┼───────────────────┐
          │ setWiki()         │ setWiki()          │ setWiki()
          ▼                   ▼                    ▼
   PlanExperienceStore  SessionErrorExtractor  PlanningIntelEngine
          │
          │ setWiki()
          ▼
   TemplateManager     PipelineExecutor(wiki)
                              │
                    stage2ExperienceRetrieval()
                              │
                    store.queryByTags()
                              │
              ┌───────────────┴──────────────┐
              ▼                              ▼
    wiki.getById / queryByField       memory index
        / queryByTags                  [JSONL 回退]
         [SQLite]

┌─────────────────────────────────────────────────┐
│                  MemoryWiki                      │
│  remember() ──→ buildDomainInsert() ──→ 15 表   │
│  query() / queryByTags() / getById() / ...      │
├──────────┬──────────┬──────────┬────────────────┤
│  SQLite  │  Zvec    │  LRU×2   │  Embedding     │
│  (WAL)   │  (HNSW)  │  缓存    │  Provider      │
│  15 张表 │  1024 维 │  L1:查询 │  VectorStore   │
│  索引    │  COSINE  │  L2:嵌入 │  .getEmbedding │
├──────────┴──────────┴──────────┴────────────────┤
│  高层 API (16 个方法)                              │
│  通用: queryByTags | getById | queryByField      │
│        getRecentEpisodes | getFullEntity         │
│        queryByTimeRange                          │
│  领域: getErrorLogs | getTemplateLineages        │
│        getPlanTemplates | getToolQuality         │
│        getErrorReports | getDecisionTraces       │
│        getDeviationLogs | getMemoryEntries       │
│        getCheckpointsByExecution                 │
│        getIntelligenceState                      │
├─────────────────────────────────────────────────┤
│  兼容层（过渡期保留旧 API）                         │
│  PlanExperienceStore / KnowledgeGraph / ...       │
│  所有模块已接入 setWiki() → SQLite 优先读取         │
└─────────────────────────────────────────────────┘
```

---

### 2.1 Gateway 集成

MemoryWiki 通过 MemoryRetriever 注入到 `AgentReasoningInterceptor`，实现三层自动拦截：

```
StudioServer.initMetaPlanner()
  │
  ├── MemoryWiki → MemoryRetriever
  │
  ├── AgentReasoningInterceptor(memoryBus, eventBus)
  │     └── setMemoryRetriever(retriever)
  │     └── wrap(piAdapter.execute)  ← 接管所有 Agent-LLM 通信
  │
  └── DomainClusterManager
        └── builtinTools: [search_memory]  ← LLM 主动检索工具
```

---

## 3. 依赖安装

```bash
npm install better-sqlite3 lru-cache
npm install --save-dev @types/better-sqlite3
```

| 依赖 | 版本 | 用途 |
|------|:---:|------|
| `better-sqlite3` | ^11.x | SQLite 嵌入式数据库（同步、快速、WAL） |
| `lru-cache` | ^11.x | L1 查询缓存 + L2 Embedding 缓存 |
| `@zvec/zvec` | ^0.5 | 已有 — 向量相似搜索 |

---

## 4. 文件结构

```
packages/memory/src/wiki/
├── index.ts          # Barrel export
├── types.ts          # 类型契约
├── schema.ts         # SQLite DDL（15 张表 + 索引）
├── MemoryWiki.ts     # 核心类（~800 行）
└── migrate.ts        # JSONL → SQLite 迁移

scripts/
├── migrate-to-sqlite.ts    # 迁移入口脚本
└── verify-memorywiki.ts    # 全链路验证脚本（46 项）
```

---

## 5. 使用方法

### 5.1 初始化

```typescript
import { MemoryWiki } from '@morpex/memory';

const wiki = new MemoryWiki({
  dbPath: './data/memory.db',
  zvecPath: './data/zvec_wiki',
  embedder: vectorStore,  // VectorStore.getEmbedding 作为依赖注入
});

await wiki.initialize();
```

### 5.2 写入（自动路由到领域表）

```typescript
// ★ v2.0: buildDomainInsert() 按 item.type 自动路由到对应领域表
await wiki.remember({
  id: 'plan_001',
  type: 'PlanRecord',      // → plan_records 表
  name: 'Build REST API with JWT',
  data: {
    execution_id: 'exec_001',
    task_id: 'T1',
    s3_method: 'hierarchical',
    plan_score: 0.85,
    execution_success: 1,
    duration_ms: 5000,
    total_tokens_used: 1500,
    artifact_count: 3,
  },
});

// 类型 → 表路由映射:
// PlanRecord       → plan_records
// PlanTemplate     → plan_templates
// TemplateLineage  → template_lineages
// HistoryRecord    → history_records
// ErrorLog         → error_logs
// ErrorReport      → error_reports
// ToolQuality      → tool_quality
// DecisionTrace    → decision_traces
// DeviationLog     → deviation_logs
// IntelligenceState → intelligence_state
// Checkpoint       → checkpoints
// MemoryEntry      → memory_entries
// 未知类型          → kg_entities（仅通用表）
```

### 5.3 高层 API（16 个方法）

#### 通用查询
```typescript
// 按 ID 查询
wiki.getById('plan_records', 'plan_001')

// 按字段查询
wiki.queryByField('plan_records', 'execution_id', 'exec_001')
wiki.queryByField('history_records', 'execution_id', 'exec_001')

// 按标签查询
wiki.queryByTags('plan_records', ['k8s', 'deploy'], { limit: 10, orderBy: 'plan_score DESC' })

// 最近记录
wiki.getRecentEpisodes('plan_records', 50)

// 时间范围查询
wiki.queryByTimeRange('error_logs', Date.now() - 86400000, Date.now(), 100)

// 实体 + 关系图遍历
wiki.getFullEntity('plan_001', 2)  // → { entity, relations }
```

#### 领域专用查询
```typescript
wiki.getErrorLogs('timeout', 50)              // 错误日志
wiki.getTemplateLineages('tpl_web_api', 100)  // 模板血统
wiki.getPlanTemplates('k8s', 100)             // 计划模板
wiki.getToolQuality('bash_tool', 100)         // 工具质量
wiki.getErrorReports('sess_001', 100)         // 错误报告
wiki.getDecisionTraces('exec_001', 100)       // 决策追溯
wiki.getDeviationLogs('sess_001', 100)        // 偏差日志
wiki.getCheckpointsByExecution('exec_001')    // DAG 检查点
wiki.getMemoryEntries('main', 100)            // 记忆条目
wiki.getIntelligenceState()                   // 学习状态
```

#### 向量语义搜索
```typescript
const result = await wiki.query(queryEmbedding, {
  topK: 10,
  hops: 2,
  cacheTTL: 300,
});
// → { vectors: [...], graph: [...], timestamp }
```

#### 统计
```typescript
wiki.getStats()
// → { planRecords: 120, errorLogs: 45, kgEntities: 89, ... }
wiki.getScoreTrend('T8')
// → [{ round: 1, avg_score: 0.55, count: 10 }, ...]
```

---

## 6. 迁移路径（全部完成）

| Phase | 内容 | 状态 |
|:---:|------|:---:|
| 1 | 安装依赖 `better-sqlite3` `lru-cache` | ✅ |
| 2 | 双写并行：`MetaPlanner.wrapOrchestrate()` → `wiki.remember()` | ✅ |
| 3 | 历史迁移：`scripts/migrate-to-sqlite.ts` | ✅ |
| 4 | 切换读取：6 文件 SQLite 优先 + JSONL 回退 | ✅ |
| 5 | 下线 JSONL：6 文件清理 + 数据备份至 `data/backup/` | ✅ |
| 6 | 高层 API 扩展：8→16 个方法 + 检查点路由 + KnowledgeGraph/MemoryBus 接入 | ✅ |

---

## 7. 缓存策略

| 缓存 | 类型 | 大小 | TTL | 失效条件 |
|------|:---:|:---:|:---:|------|
| **L1** 查询结果 | LRU | 1000 | 5 min | 写操作后全清 |
| **L2** Embedding | LRU | 5000 | 2 h | 文本更新时手动清除 |

---

## 8. 15 张 SQLite 表（100% 覆盖）

| # | 表名 | 替代的 JSONL | 路由 | 查询 API |
|:--:|------|-------------|:---:|:---:|
| 1 | `plan_records` | plan-records.jsonl | ✅ | getById, queryByField, queryByTags |
| 2 | `plan_templates` | plan-templates.jsonl | ✅ | getPlanTemplates |
| 3 | `template_lineages` | template-lineages.jsonl | ✅ | getTemplateLineages |
| 4 | `history_records` | history/*.jsonl | ✅ | queryByField |
| 5 | `tool_quality` | tool-quality.jsonl | ✅ | getToolQuality |
| 6 | `intelligence_state` | intelligence-state.jsonl | ✅ | getIntelligenceState |
| 7 | `checkpoints` | DAG checkpoint files | ✅ | getCheckpointsByExecution |
| 8 | `error_logs` | errors.jsonl | ✅ | getErrorLogs |
| 9 | `error_reports` | error-reports.jsonl | ✅ | getErrorReports |
| 10 | `decision_traces` | decision-traces.jsonl | ✅ | getDecisionTraces |
| 11 | `deviation_logs` | deviation-traces.jsonl | ✅ | getDeviationLogs |
| 12 | `kg_entities` | entities.jsonl | ✅ | getFullEntity |
| 13 | `kg_relations` | relations.jsonl | ✅ | getFullEntity |
| 14 | `memory_entries` | index.jsonl, archive.jsonl | ✅ | getMemoryEntries |
| 15 | `event_log` | 事件审计 | ✅ | queryByField |

---

## 9. 注入链路（9 条 setWiki）

| # | 注入者 | 被注入者 | 方式 |
|:--:|--------|----------|------|
| 1 | StudioServer | MetaPlanner | 构造函数 `wiki:` 参数 |
| 2 | StudioServer | HistoryStore | `history.setWiki(wiki)` |
| 3 | StudioServer | KnowledgeGraph | `knowledgeGraph.setWiki(wiki)` |
| 4 | StudioServer | MemoryBus | `memoryBus.setWiki(wiki)` |
| 5 | MetaPlanner | PlanExperienceStore | `store.setWiki(wiki)` |
| 6 | MetaPlanner | SessionErrorExtractor | `sessionErrorExtractor.setWiki(wiki)` |
| 7 | MetaPlanner | PlanningIntelligenceEngine | `planningIntelligence.setWiki(wiki)` |
| 8 | MetaPlanner | TemplateManager | `templateManager.setWiki(wiki)` |
| 9 | MetaPlanner | PipelineExecutor | 构造函数 `wiki:` 参数 |
| 10 | StudioServer | AgentReasoningInterceptor | `interceptor.setMemoryRetriever(retriever)` |
| 11 | StudioServer | DomainClusterManager | `builtinTools: [search_memory]` |

---

## 10. 与旧系统的对比

| 维度 | JSONL (旧) | SQLite + Zvec (新) |
|------|-----------|-------------------|
| 写入方式 | `fsp.appendFile` (裸写) 或 JSONLWriter (微批) | SQLite WAL 事务 + buildDomainInsert 自动路由 |
| 查询方式 | 全文件读取 + 内存 filter | B-tree 索引 + 16 个高层 API |
| 跨表查询 | 不支持 | JOIN / 子查询 |
| 事务 | 无 | ACID |
| 向量搜索 | Zvec（已有） | Zvec（保留） |
| 图遍历 | 无（需手动遍历 JSONL） | SQLite CTE WITH RECURSIVE |
| 缓存 | Embedding LRU（VectorStore） | L1 查询 + L2 Embedding |
| 文件数量 | 31 个 JSONL | 1 个 .db + 1 个 zvec 目录 |
| 备份 | 复制 31 个文件 | 复制 2 个文件 |
| 并发安全 | JSONLWriter 串行队列 | SQLite WAL 多读单写 |

---

## 11. 验证

```bash
# 全链路验证（46 项）
npx tsx scripts/verify-memorywiki.ts

# 迁移历史数据
npx tsx scripts/migrate-to-sqlite.ts
```

---

> **制定日期**: 2026-07-13 | **完成日期**: 2026-07-13  
> **适用版本**: MorPex v3.2  
> **相关文档**: `docs/modules/memory.md` `docs/docsARCHITECTURE-v3.1-optimized.md`
