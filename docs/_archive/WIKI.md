# MorPex MemoryWiki — 知识库

> MemoryWiki: SQLite + Zvec 统一记忆后端，替代 31 个 JSONL 文件。

---

## 快速导航

| 你想… | 看这里 |
|-------|--------|
| 了解架构和设计理念 | [升级指南](UPGRADE-MEMORY-WIKI.md) |
| 查 API 方法签名 | [API 参考](#api-参考) |
| 知道有哪些表和字段 | [Schema 参考](#schema-参考) |
| 看数据怎么流动 | [数据流](#数据流) |
| 接入新模块 | [接入指南](#接入指南) |
| 排查问题 | [故障排除](#故障排除) |

---

## API 参考

### 写入

```typescript
// 记住一条知识（自动按 type 路由到领域表）
await wiki.remember({
  id: string,           // 唯一 ID
  type: string,         // PlanRecord | ErrorLog | HistoryRecord | Checkpoint | ...
  name: string,         // 人类可读名称
  embedding?: number[], // 可选 1024 维向量
  data?: Record<string, unknown>,  // 结构化数据（自动映射到表列）
  relations?: Array<{ toId: string; type: string; properties?: Record<string, unknown> }>,
});

// 批量写入
await wiki.rememberMany(items: MemoryItem[]);
```

### 通用查询

| 方法 | 签名 | 用途 |
|------|------|------|
| `getById` | `(table, id) → Record \| undefined` | 按 ID 查单条 |
| `queryByField` | `(table, field, value, opts?) → Record[]` | 按任意字段查 |
| `queryByTags` | `(table, tags[], opts?) → Record[]` | 按标签过滤（LIKE 匹配） |
| `getRecentEpisodes` | `(table, limit) → Record[]` | 最近 N 条 |
| `queryByTimeRange` | `(table, fromTs, toTs, limit?) → Record[]` | 时间范围查询 |
| `getFullEntity` | `(id, hops) → { entity, relations[] }` | 实体 + N 跳关系图 |
| `query` | `(embedding, opts?) → { vectors, graph, ts }` | 向量语义 + 图遍历混合检索 |

### 领域专用查询

| 方法 | 签名 | 查哪张表 |
|------|------|----------|
| `getErrorLogs` | `(errorType?, limit) → Record[]` | `error_logs` |
| `getTemplateLineages` | `(templateId?, limit) → Record[]` | `template_lineages` |
| `getPlanTemplates` | `(tags?, limit) → Record[]` | `plan_templates` |
| `getToolQuality` | `(toolName?, limit) → Record[]` | `tool_quality` |
| `getErrorReports` | `(sessionId?, limit) → Record[]` | `error_reports` |
| `getDecisionTraces` | `(executionId?, limit) → Record[]` | `decision_traces` |
| `getDeviationLogs` | `(sessionId?, limit) → Record[]` | `deviation_logs` |
| `getCheckpointsByExecution` | `(executionId) → Record[]` | `checkpoints` |
| `getMemoryEntries` | `(pool?, limit) → Record[]` | `memory_entries` |
| `getIntelligenceState` | `() → Record \| null` | `intelligence_state` |

### 统计

```typescript
wiki.getStats()          // → { planRecords, errorLogs, kgEntities, ... }
wiki.getScoreTrend(id?)  // → [{ round, avg_score, count }]
wiki.sql('SELECT ...')   // 原始 SQL（复杂查询）
```

---

## Schema 参考

### 类型 → 表路由

调用 `wiki.remember({type: 'Xxx', ...})` 时，数据自动写入对应表：

| type 值 | 目标表 | 关键列 |
|---------|--------|--------|
| `PlanRecord` | `plan_records` | execution_id, task_id, plan_score, s3_method, duration_ms, input_tags |
| `PlanTemplate` | `plan_templates` | name, tags, success_rate, usage_count, version |
| `TemplateLineage` | `template_lineages` | template_id, parent_template_id, evolution_type |
| `HistoryRecord` | `history_records` | type, execution_id, task_id, data_json |
| `ErrorLog` | `error_logs` | session_id, error_type, error_message, retry_count |
| `ErrorReport` | `error_reports` | session_id, total_errors, categories_json, root_cause |
| `ToolQuality` | `tool_quality` | tool_name, call_success, latency_ms |
| `DecisionTrace` | `decision_traces` | execution_id, winner_strategy, winner_score |
| `DeviationLog` | `deviation_logs` | session_id, deviation_type, circuit_broken |
| `Checkpoint` | `checkpoints` | execution_id, dag_snapshot, node_states |
| `IntelligenceState` | `intelligence_state` | execution_count, score_history, weights_json (单例) |
| `MemoryEntry` | `memory_entries` | mem_type, content, pool, importance, score |
| `KgEntity` | `kg_entities` | type, name, domain, tags (始终写入) |

### 完整 DDL

见 `packages/memory/src/wiki/schema.ts`（15 张表 + 索引）。

---

## 数据流

```
运行时事件
  │
  ├── MetaPlanner.wrapOrchestrate()       → wiki.remember(PlanRecord)
  ├── SessionErrorExtractor.recordError() → wiki.remember(ErrorLog)
  ├── KnowledgeGraph.upsertEntity()       → wiki.remember(KgEntity)
  ├── MemoryBus.remember()                → wiki.remember(MemoryEntry)
  ├── CheckpointManager.saveCheckpoint()  → wiki.remember(Checkpoint)
  ├── ToolQualityManager.recordToolCall() → wiki.remember(ToolQuality)
  ├── DeviationGuard.recordDeviation()    → wiki.remember(DeviationLog)
  └── PipelineExecutor.stage6()           → wiki.remember(DecisionTrace)
         │
         ▼
    MemoryWiki.remember()
         │
         ├── kg_entities (通用，始终写入)
         ├── buildDomainInsert() ─→ 按 type 路由到 12 张领域表
         └── event_log (审计日志)
         │
         ▼
    SQLite WAL (data/memory.db)
         │
         ▼
    查询层 (16 个高层 API)
         │
         ├── PlanExperienceStore.getRecord / queryByTags()
         ├── HistoryStore.getTasksByExecution()
         ├── SessionErrorExtractor.loadRecentErrors()
         ├── TemplateManager.loadLineages()
         └── ...
```

---

## Gateway 三层拦截

MemoryWiki 通过 `AgentReasoningInterceptor` 接入 Gateway，在每次 Agent-LLM 通信时自动检索：

```
PiAdapter.execute()
  │
  └── AgentReasoningInterceptor.wrap()
        │
        ├── Layer 1: THOUGHT (推理流扫描)
        │     LLM 推理时 → retrieveForUncertainty()
        │     命中文档 → 标记，供后续注入
        │
        ├── Layer 2: ACTION (工具调用前置检查)
        │     工具执行前 → retrieveForError(toolName)
        │     历史失败率 ≥50% + ≥2条 → 阻止
        │
        └── Layer 3: OBSERVATION (错误修正闭环)
              错误发生后 → retrieveForError(errorMsg)
              历史修复方案 → 自动注入重试 prompt
```

| 层级 | 触发时机 | 检索方法 | 行为 |
|:---:|---------|---------|------|
| L1 | LLM 输出推理 token | `retrieveForUncertainty` | 命中标记，不拦截 |
| L2 | 工具调用前 | `retrieveForError(tool, 'tool_error')` | 高失败率→阻止 |
| L3 | 工具/节点错误后 | `retrieveForError(msg, category)` | 注入修复方案 |

### LLM 主动检索

Agent 还可以通过 `search_memory` 工具主动检索：

```
search_memory({ query: "STM32 GPIO", category: "docs" })
search_memory({ query: "串口超时", category: "errors" })
```

---

## 接入指南

### 新模块接入 MemoryWiki（3 步）

**步骤 1**: 在模块中添加 `setWiki()` 注入点

```typescript
import { MemoryWiki } from '...';

class YourModule {
  private wiki: MemoryWiki | null = null;

  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }
}
```

**步骤 2**: 在写入点调用 `wiki.remember()`

```typescript
// 在数据产生的地方
if (this.wiki?.ready) {
  this.wiki.remember({
    id: `your_${Date.now()}`,
    type: 'YourType',   // 如果 schema 中有对应表，自动路由
    name: '...',
    data: { /* 字段需匹配目标表列名 */ },
  }).catch(() => {});   // 不阻塞主流程
}
```

**步骤 3**: 在 StudioServer 或 MetaPlanner 中接线

```typescript
this.yourModule.setWiki(this.wiki);
```

### 添加新表

1. 在 `schema.ts` 中添加 `CREATE TABLE IF NOT EXISTS`
2. 在 `MemoryWiki.ts` 的 `buildDomainInsert()` 中添加 `case 'YourType':`
3. 可选：添加领域专用查询方法

---

## 故障排除

| 症状 | 原因 | 解决 |
|------|------|------|
| `wiki.ready === false` | 未调用 `wiki.initialize()` | `await wiki.initialize()` |
| 写入成功但查询为空 | type 不匹配，路由到了 kg_entities 而非领域表 | 检查 `item.type` 值是否在 `buildDomainInsert` 的 case 列表中 |
| `UNIQUE constraint failed` | ID 冲突 | 给 ID 加随机后缀 |
| zvec 不可用 | 原生库未安装 | 向量搜索降级，SQLite 查询正常 |
| 模块写入绕过 wiki | 旧代码未接入 | 检查模块是否有 `setWiki()` 并在构造函数调用 |

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [UPGRADE-MEMORY-WIKI.md](UPGRADE-MEMORY-WIKI.md) | 完整升级指南、架构图、对比表 |
| [modules/memory.md](modules/memory.md) | 记忆系统整体文档（MemoryBus + MemoryWiki） |
| [../data/README.md](../data/README.md) | 运行时数据目录结构 |
| [../packages/memory/src/wiki/schema.ts](../packages/memory/src/wiki/schema.ts) | DDL 源码 |
| [../packages/memory/src/wiki/MemoryWiki.ts](../packages/memory/src/wiki/MemoryWiki.ts) | 核心实现 |
