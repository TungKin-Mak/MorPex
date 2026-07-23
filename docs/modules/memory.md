# 模块名称：记忆系统 v2 (MemoryBus)

> 路径: `packages/memory/` | 入口: `packages/memory/src/index.ts` | 版本: 3.0.0
>
> 设计文档: `docs/architecture/memory-system-v2.md`
>
> **v9.2.1 (2026-07-14)**：createMemoryBus() 惰性初始化 — ConfigStore、WorkspaceIndexer、ChatMemoryExtractor、MarkdownIndexer 改为 getter 按需创建。DocWatcher、DocTopology、MemoryRetriever、Compactor、LogRotator 加入 barrel export。
>
> **v9.2 (2026-07-13)**：MemoryRetriever 接入 Gateway 三层拦截 (THOUGHT/ACTION/OBSERVATION)。search_memory AgentTool 供 LLM 主动检索。DocWatcher 文档自维护、DocTopology 关系拓扑。
>
> **v3.0 (2026-07-13)**：MemoryWiki SQLite 统一持久化层上线。15 张领域表、16 个高层 API、9 条 setWiki 注入链路。
>
> **v2.1 (2026-07-12)**：JSONLWriter 微批处理已推广至全部 7 个子系统（20 个 JSONL 文件）。VectorStore 增加 Embedding LRU 缓存。文件 I/O 减少 ~80%。

---

## 1. 模块职责 (Responsibility)

### 本模块负责

| 职责 | 说明 |
|------|------|
| **MemoryWiki** | SQLite 统一持久化层：15 张领域表、16 个高层 API、自动类型路由 (`buildDomainInsert`) |
| **MemoryRetriever** | 记忆优先检索层：task/docs/error/kg 四维检索 | Gateway 三层拦截 + search_memory 工具 |
| **DocWatcher** | 文件监听自动索引：docs/ 变更 5s 防抖 | 增量更新 memory_entries |
| **DocTopology** | 文档关系拓扑：解析交叉引用 | 构建 kg_relations (REFERENCES) |
| **MemoryBus 记忆总线** | 三维一体记忆总线：remember / recall / forget / feedback / improve |
| **Main Pool 竞争池** | Score 公式排名，容量满时低分逐出到 Archive，knowledge 类型受保护 |
| **Archive 归档池** | 无限容量被动存储，`recall({ includeArchive: true })` 可打捞 |
| **Temp Pool 临时池** | 阶段级临时输出缓存，任务完成后清理 |
| **按类型遗忘** | correction 30天删除 / summary 30天归档 90天删除 / profile 90天归档 / knowledge 永不过期 |
| **Memory Gating 门控** | 5 维门控信号 (sessionSummaryChain / tempPoolLastOutput / userGlobalProfile / uiVisualStandards / errorCorrectionRules) |
| **阶段管理** | stageComplete / planStages / audit — 预绑定门控标签 |
| **Layer 2 输入拦截** | 每次 query 前检索 memType=correction，注入 ≤3 条到系统 prompt |
| **WriteGate 写闸门** | 重要性阈值过滤，低于阈值不写入 |
| **ECLCognifyEngine** | ECL 流水线：实体/关系抽取（异步 LLM） |
| **UserProfileEngine** | 用户画像增量抽取、置信度管理、System Prompt 注入 |
| **ChatMemoryExtractor** | 对话结束自动提取记忆 + 修正 + 画像更新 |
| **DocumentIngestion** | 文档摄入 → 切片 → 向量索引 |
| **ZVecStorage** | zvec 向量存储适配器（BGE-M3 / 1024 维） |
| **JSONLStorage** | JSONL 追加读写存储 |
| **TaskCheckpointManager** | Agent 任务检查点保存/加载（注意与 core/extensions 的 `CheckpointManager`（DAG 快照回滚）区分）|
| **ConfigStore** | 系统配置持久化 |
| **MarkdownIndexer** | Markdown 知识库索引 |

### 本模块【绝不】负责

| 不负责 | 正确归属 |
|--------|----------|
| ❌ EventBus 事件通信 | `packages/core/core/EventBus.ts` |
| ❌ 知识图谱的图数据库 | `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts` — MemoryBus 通过 `getGraph()` 集成 |
| ❌ zvec 向量数据库引擎 | `@zvec/zvec` 外部包 — ZVecStorage 是适配层 |
| ❌ Embedding 向量推理 | `tools-python/embedding-server.py` — EmbeddingClient 是 HTTP 客户端 |
| ❌ LLM 推理调用 | `packages/ai/pi-ai` 或降级 fetch — ECLCognifyEngine/ChatMemoryExtractor 通过 HTTP 调用 Ollama |
| ❌ HTTP REST 端点 | `packages/studio/server/StudioServer.ts` — 10 个 v2 端点代理到 MemoryBus |

### 跨子系统 JSONL → MemoryWiki 迁移状态 (v3.0)

`MemoryWiki` 现已作为**统一 SQLite 持久化层**，替代了原来 31 个 JSONL 文件中的大部分。
JSONL 数据已备份至 `data/backup/jsonl-20260713/`。

| 子系统 | 包 | JSONL 文件数 | MemoryWiki | 备注 |
|--------|------|:----------:|:---------:|------|
| **MemoryWiki** | `packages/memory` | 0 | ✅ 16 API | 15 张 SQLite 表，自动类型路由 |
| **MemoryBus** | `packages/memory` | 4 | ✅ setWiki | 通过 `wiki.remember()` 持久化记忆条目 |
| **KnowledgeGraph** | `packages/core` | 2 | ✅ setWiki | 通过 `wiki.remember()` 持久化实体/关系 |
| **PlanExperienceStore** | `packages/core` | 2 | ✅ setWiki | 通过 `wiki.remember()` 持久化计划记录 |
| **HistoryStore** | `packages/memory` | 4 | ✅ setWiki | 通过 `wiki.remember()` 持久化历史记录 |
| **PipelineExecutor** | `packages/core` | 2 | ✅ setWiki | 保留 JSONL 输出（人类可读管道日志） |
| **DeviationGuard** | `packages/core` | 1 | ❌ 独立 | 保留 JSONL（偏差追踪） |
| **ToolQualityManager** | `packages/core` | 1 | ❌ 独立 | 保留 JSONL（工具质量记录） |
| **JSONLStorage** | `packages/core` | 3 | ❌ 独立 | 保留 JSONL（Mirror 录制） |
| **EventStore** | `packages/core` | 1 | ❌ 独立 | 保留 JSONL（EventBus 事件） |
| **合计** | | **20** | **6/10** | |

### VectorStore Embedding 缓存 (v2.1)

`packages/core/src/planes/knowledge-plane/memory/VectorStore.ts` 增加内嵌 LRU 缓存：

```typescript
private embedCache = new Map<string, Float32Array>();      // 已计算向量
private embedPending = new Map<string, Promise<...>>();    // 并发请求去重

// 相同文本 → 缓存命中（零 HTTP）
// 并发相同请求 → 去重合并（一次 HTTP）
```

---

## 2. 文件结构树 (File Structure)

```text
packages/memory/
├── package.json
├── tsconfig.json
├── README.md
│
└── src/
    ├── index.ts                    # 入口：导出所有公共 API + createMemoryBus() 工厂
    ├── types.ts                    # v2 类型：MemType, MemoryGateConfig, StageDefinition, ...
    │
    ├── wiki/                       # ★ v3.0: MemoryWiki SQLite 统一持久化层
    │   ├── index.ts                # Barrel export
    │   ├── types.ts                # 类型契约
    │   ├── schema.ts               # SQLite DDL（15 张表 + 索引）
    │   ├── MemoryWiki.ts           # 核心类（~800 行）
    │   ├── MemoryRetriever.ts      # ★ v9.2: 记忆优先检索层
    │   ├── DocWatcher.ts           # ★ v9.2: 文档自维护监听
    │   ├── DocTopology.ts          # ★ v9.2: 文档关系拓扑
    │   └── migrate.ts              # JSONL → SQLite 迁移
    │
    ├── core/                       # 核心引擎
    │   ├── MemoryBus.ts            # ★ 三维一体记忆总线 (~1400 行)
    │   │                            #   - remember()  ECL 流水线 + 竞争写入
    │   │                            #   - recall()   混合检索 (vector/graph/hybrid)
    │   │                            #   - forget()   三层联合删除
    │   │                            #   - feedback() 闭环反馈
    │   │                            #   - compactMemories()  按类型遗忘 + 竞争淘汰
    │   │                            #   - stageComplete() / planStages() / audit()
    │   │                            #   - interceptInput()  Layer 2 拦截
    │   │                            #   - improve()  自我进化（反思循环）
    │   │
    │   ├── WriteGate.ts            # 写闸门：重要性阈值判定
    │   ├── ECLCognifyEngine.ts     # ECL 流水线：LLM 实体/关系抽取
    │   ├── UserProfileEngine.ts    # 用户画像引擎
    │   ├── ChatMemoryExtractor.ts  # 聊天记忆自动提取
    │   ├── DocumentIngestion.ts    # 文档摄入 → 切片 → 索引
    │   ├── TaskCheckpointManager.ts # Agent 任务检查点保存/加载（区别于 core 的 DAG 回滚 CheckpointManager）
    │   ├── ConfigStore.ts          # 系统配置持久化 (JSON)
    │   ├── WorkspaceIndexer.ts     # 工作区文件索引
    │   └── MarkdownIndexer.ts      # Markdown 知识库索引
    │
    ├── storage/                    # 存储适配器
    │   ├── ZVecStorage.ts          # zvec 向量存储 (MemoryBus 后端)
    │   ├── JSONLStorage.ts         # JSONL 追加读写（已由 MemoryWiki 替代大部分场景）
    │   ├── JSONLWriter.ts          # 微批 JSONL 写入器（500ms/50 行缓冲）
    │   ├── Compactor.ts            # ★ JSONL 状态压缩（类似 AOF 重写：按 key 去重，只留最新）
    │   ├── LogRotator.ts           # ★ JSONL 日志轮转（超 10MB 自动重命名+清理旧日志）
    │   └── HistoryStore.ts         # 执行历史存储
    │
    └── vector/                     # 向量工具
        ├── EmbeddingClient.ts      # BGE-M3 Embedding HTTP 客户端
        └── ZVecLockRecovery.ts     # zvec 锁恢复
```

---

## 3. 核心 API

### 3.1 MemoryBus — 主 API

```typescript
// 工厂函数（推荐）
import { createMemoryBus } from '@morpex/memory';
const { bus } = createMemoryBus({ dataDir: './data/memory-bus' });
await bus.initialize();
```

> **惰性初始化**：`createMemoryBus()` 返回的 `configStore`、`workspaceIndex`、`chatExtractor`、`markdownIndexer` 使用 getter 模式，**首次访问时才实例化**，启动时不创建。避免系统启动一次性加载过多未用实例。
> ```typescript
> bus.configStore   // 首次访问 → [MemoryBus] 惰性初始化: ConfigStore
> bus.chatExtractor // 首次访问 → [MemoryBus] 惰性初始化: ChatMemoryExtractor
> ```

#### 记忆写入

```typescript
// 基本写入
const entry = await bus.remember({
  content: 'React 19 使用 use() hook',
  source: 'chat',
  sourceId: 'session_123',
  tags: ['react', 'hooks'],
  importance: 4,          // 1-5
  memType: 'knowledge',   // ★ v2: knowledge | profile | summary | correction | stage_output
  references: ['mem_xxx'], // 关联其他记忆
});

// 批量写入
const entries = await bus.rememberMany([...]);
```

#### 记忆检索

```typescript
// 混合检索 (默认 hybrid-rag)
const result = await bus.recall({
  text: 'React hooks 用法',
  strategy: 'hybrid-rag',  // 'vector-first' | 'graph-walk' | 'hybrid-rag'
  topK: 10,
  includeArchive: true,    // ★ v2: 是否检索归档池
});

// result.items: MemoryPayload[]
// result.source: 'vector' | 'graph' | 'hybrid'
// result.entities: KnowledgeEntity[]  (图谱关联实体)
```

#### v2 新增方法

```typescript
// 闭环反馈
const fb = bus.feedback(entryId, true);  // useful: boolean
// → { id, useful, scoreDelta, newScore }

// 阶段管理
bus.planStages([
  { name: '需求分析', goal: '...', output: '...', memoryGates: { ... } },
]);
bus.setCurrentStage('需求分析');
await bus.stageComplete('摘要文本', '完整输出JSON');
const output = bus.getTempPoolOutput('需求分析');
const chain = bus.getSummaryChain();

// 门控审计
const signal = bus.audit('继续昨天的硬件选型', '需求分析');
// → { intent, targetStage, memoryGates: { sessionSummaryChain, ... } }

// Layer 2 输入拦截
const corrections = await bus.interceptInput('EC芯片型号是什么');
// → MemoryPayload[] (最多 3 条 memType=correction)
```

#### 生命周期

```typescript
await bus.initialize();   // 加载索引 + 归档 + 图谱
await bus.compactMemories(); // → CompactResult { evicted, archived, merged, deleted }
await bus.improve();      // 自我进化 → ImproveResult
await bus.shutdown();     // 保存快照 + 关闭
```

### 3.2 Score 竞争公式

```typescript
// 权重可配置
const bus = new MemoryBus({
  scoreWeights: {
    recency: 0.25,      // w1: 最近访问时间（小时级衰减）
    frequency: 0.30,    // w2: 访问次数（log 增长）
    relation: 0.25,     // w3: 图谱关联数（log 增长）
    importance: 0.20,   // w4: 写入时的重要性评分
  },
  mainPoolCapacity: 1000, // 主池容量上限
});
```

### 3.3 记忆类型与遗忘策略

| memType | 产生频率 | 生命周期 | 遗忘策略 |
|---------|----------|----------|----------|
| `knowledge` | 低频 | 永久 | 不遗忘，版本覆盖 |
| `profile` | 每次对话 | 长期 | 新旧更替，>90天归档 |
| `summary` | 每次对话 1-N | 中期 | 30天归档 → 90天删除 |
| `correction` | 每次对话 0-N | 短期 | 30天直接删除 |
| `stage_output` | 每阶段 1 份 | 任务周期 | 任务完成后择要归档 |

---

### 3.4 MemoryRetriever — 记忆优先检索层 (v9.2)

```typescript
const retriever = new MemoryRetriever(wiki);

// 任务检索：查 docs + past plans + KG
retriever.retrieveForTask("单片机程序", ["embedded", "c"]);

// 错误检索：查历史错误 + 修复方案
retriever.retrieveForError("Connection timeout", "timeout");

// 不确定时检索
retriever.retrieveForUncertainty("波特率怎么设");

// 代码生成前检索
retriever.retrieveForCode("STM32 GPIO", "c");
```

#### Gateway 三层拦截集成

`ExecutionGateway` 在每次 Agent-LLM 通信时自动调用 MemoryRetriever：

| 层级 | 触发 | 方法 | 行为 |
|------|------|------|------|
| L1 THOUGHT | LLM 推理流 | `retrieveForUncertainty(sentence)` | 命中文档则标记 |
| L2 ACTION | 工具执行前 | `retrieveForError(fingerprint)` | 高失败率→阻止 |
| L3 OBSERVATION | 错误发生后 | `retrieveForError(msg, cat)` | 注入历史修复方案 |

#### search_memory AgentTool

LLM 可主动调用：
```
search_memory({ query: "STM32 GPIO", category: "docs" })
search_memory({ query: "串口超时", category: "errors" })
```

#### DocWatcher (文档自维护)

监听 `docs/` 目录的 `.md` 文件变更，5 秒防抖后自动索引到 `memory_entries`。

```typescript
const watcher = new DocWatcher(wiki, { dir: './docs', debounceMs: 5000 });
await watcher.start(); // 启动监听
```

#### DocTopology (文档关系拓扑)

解析所有 `.md` 文件中的 `[text](path.md)` 链接，构建 `kg_relations` (type=REFERENCES)。

```typescript
const topology = new DocTopology(wiki, './docs');
await topology.buildTopology(); // → { nodes: 16, edges: 6 }
```

---

## 4. 依赖关系

### 4.1 本模块依赖

| 依赖 | 用途 |
|------|------|
| `@zvec/zvec` | 向量数据库引擎 |
| `packages/core/.../KnowledgeGraph` | 图谱层集成（MemoryBus 内嵌） |
| `crypto` (Node.js) | MD5 内容哈希去重 |
| `fs` / `path` (Node.js) | JSONL 文件持久化 |
| BGE-M3 Embedding Server | HTTP `POST /embed` → 1024 维向量 |

### 4.2 谁依赖本模块

| 消费者 | 方式 |
|--------|------|
| `packages/core/.../memory/plugin.ts` | MemoryPlugin 通过 EventBus 包装 MemoryBus |
| `packages/studio/server/StudioServer.ts` | 直接创建 MemoryBus 实例 + 10 个 REST 端点 |
| `packages/core/.../knowledge/plugin.ts` | 依赖 `memory-plugin`（KnowledgeGraphPlugin） |
| `packages/core/.../artifacts/plugin.ts` | 依赖 `knowledge-graph-plugin`（传递依赖） |

---

## 5. 配置

### 5.1 MemoryBusConfig

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `dataDir` | `./data/memory-bus` | 持久化根目录 |
| `embedUrl` | `http://localhost:3100` | BGE-M3 Embedding 服务 |
| `vectorDimension` | `1024` | 向量维度 |
| `writeGateThreshold` | `2` | 写闸门重要性阈值 (1-5) |
| `mainPoolCapacity` | `1000` | 主竞争池最大容量 |
| `enableGraphPersistence` | `true` | 是否持久化知识图谱 |
| `enableAutoCognify` | `false` | 是否自动运行 ECL 实体抽取 |

### 5.2 持久化文件

**MemoryBus 内存文件**：
```
data/memory-bus/
├── index.jsonl           # Provenance 索引 (一行一个 IndexEntry)  [JSONLWriter]
├── archive.jsonl         # 归档池条目                       [JSONLWriter]
├── gate-log.jsonl        # 写闸门决策日志                    [JSONLWriter]
├── compaction-log.jsonl  # 压缩/合并日志                    [JSONLWriter]
├── zvec/                 # zvec 向量数据库文件
└── knowledge/            # 知识图谱快照
    └── snapshots/
```

**跨子系统 JSONL 文件（全部使用 JSONLWriter 微批处理）**：
```
data/planning/
├── experiences/plan-records.jsonl     # PlanExperienceStore
├── templates/plan-templates.jsonl     # PlanExperienceStore
├── traces/pipeline-traces.jsonl       # PipelineLogger + PipelineExecutor
├── traces/decision-traces.jsonl       # PipelineExecutor S6
├── traces/deviation-traces.jsonl      # DeviationGuard
└── traces/tool-quality.jsonl          # ToolQualityManager

data/history/
├── cycles.jsonl                       # HistoryStore
├── tasks.jsonl                        # HistoryStore
└── executions.jsonl                   # HistoryStore

data/mirror/
├── executions.jsonl                   # ExecutionRecordingEngine
├── events.jsonl                       # ExecutionMirror
└── snapshots.jsonl                    # DAG 快照

data/knowledge/
├── entities.jsonl                     # KnowledgeGraph
└── relations.jsonl                    # KnowledgeGraph
```

> **v2.1**: 全部 20 个 JSONL 文件统一使用 `JSONLWriter`（500ms/50 行缓冲窗口）。
> 对比裸 `fsp.appendFile`，文件 I/O 减少 ~80%。

---

## 6. 事件协议

MemoryPlugin 通过 EventBus 暴露以下事件：

| 事件类型 | 方向 | 触发时机 |
|----------|------|----------|
| `memory.store` | 监听 | 外部请求存储记忆 |
| `memory.query` | 监听 | 外部请求查询记忆 |
| `memory.feedback` | 监听 | 外部提交闭环反馈 |
| `memory.stage_complete` | 监听 | 外部通知阶段完成 |
| `memory.plan_stages` | 监听 | 外部提交阶段规划 |
| `memory.audit` | 监听 | 外部请求门控审计 |
| `memory.intercept_input` | 监听 | 外部请求输入拦截 |
| `memory.get_stats` | 监听 | 外部请求统计 |
| `memory.stored` | 广播 | 记忆写入成功 |
| `memory.recalled` | 广播 | 检索完成 |
| `memory.rejected` | 广播 | 写闸门拦截 |
| `memory.stats` | 广播 | 统计信息 |
| `memory.query_results` | 广播 | 查询结果 |
| `memory.feedback_result` | 广播 | 反馈处理结果 |
| `memory.stage_completed` | 广播 | 阶段完成处理 |
| `memory.stages_planned` | 广播 | 阶段规划已记录 |
| `memory.audit_result` | 广播 | 门控审计结果 |
| `memory.intercept_result` | 广播 | 拦截结果 |

---

## 7. 与旧版（5 层记忆引擎）的区别

| 维度 | 旧版 (MemoryEngine) | v2 (MemoryBus) |
|------|---------------------|----------------|
| 组织方式 | 按认知距离分 L1-L5 层 | 按数据形态 (memType) 分类 |
| 存储模型 | 短期+长期双层 | Main Pool (竞争) + Archive (归档) + Temp Pool (临时) |
| 淘汰策略 | 固定容量 FIFO | Score 竞争公式 + 按类型遗忘 |
| 检索方式 | 向量搜索 | 三维混合：向量 + 图谱 + 时间线 |
| 上下文管理 | 无门控 | 5 维记忆门控 + 阶段预绑定 |
| 阶段感知 | 无 | stageComplete / planStages / audit |
| 闭环反馈 | 无 | feedback() 影响 Score |
| 破坏性变化 | — | `compactMemories()` 签名变更 |

---

## 8. 测试

| 测试文件 | 覆盖 |
|----------|------|
| `packages/core/__tests__/morpex-core.test.ts` §19 | MemoryBus 基本 API (14 项) |
| `scripts/smoke-test-memory.ts` | 全组件冒烟 (10 项) |
| `scripts/e2e-memory-test.ts` | 端到端持久化测试 |

运行测试：

```bash
# 核心测试
npx tsx packages/core/__tests__/morpex-core.test.ts

# 冒烟测试
npx tsx scripts/smoke-test-memory.ts
```

---

---

## 9. 已知问题与故障排除 (Troubleshooting)

### 9.1 zvec 自动恢复：版本不兼容或损坏

**三级自动恢复流程**（无需手动干预）：

```
ZVecOpen()  ──成功──▶  📂 打开已有库（正常路径）
    │
    └──失败──▶  ZVecCreateAndOpen()  ──成功──▶  🆕 创建新库（首次启动）
                    │
                    └──失败──▶  fs.rename(备份到 .backup.<ts>)  ──▶  ZVecCreateAndOpen()  🆕 重建
                                   │
                                   └──rename失败──▶  fs.rmSync()  ──▶  ZVecCreateAndOpen()
```

旧数据被备份到 `data/zvec.backup.<timestamp>`，不会丢失。

> ⚠️ 如果备份数据也不兼容，恢复后仍会触发自动备份+重建。

### 9.2 内存降级已移除

zvec 初始化失败时**不再降级到内存存储**。系统会直接抛出异常并中断启动。
这是因为：
- zvec 经过暴力测试验证，在 SIGKILL 等极端场景下均能可靠恢复
- 降级导致静默数据丢失，隐藏问题
- 仅在 zvec 完全不可用时（如原生库缺失）系统才会失败

### 9.3 dataPath 是文件而非目录

`ZVecLockRecovery.ts` 自动检测并修复：删除文件，由 zvec 自行创建目录。

### 9.4 禁止手动删除 LOCK 文件

zvec 自带崩溃恢复机制，`ZVecOpen()` 自动检测 crash residue 并清理。手动删除 LOCK 反而破坏恢复流程。

### 9.5 SIGKILL 暴力测试验证

`scripts/violent-zvec-test.ts` 覆盖 12 个场景、30 项断言：

| # | 场景 | 验证点 |
|---|------|--------|
| 1 | 正常生命周期 | open→write→close→reopen 数据完整 |
| 2 | 进程崩溃恢复 | `exit(1)` 后 reopen，zvec 自动检测 crash residue |
| 3 | 伪造 LOCK 文件 | LOCK 不被删除，zvec 自行恢复 |
| 4 | dataPath 是文件 | 自动删除文件，后续正常创建 |
| 5 | 5 轮崩溃循环 | 连续崩溃 5 次，数据无损 (5/5) |
| **K1** | **SIGKILL 杀进程** | `taskkill /F` 后 reopen，100 条数据完整恢复 |
| **K2** | **5 轮 SIGKILL 循环** | 连续 kill 5 次，逐轮验证数据递增 (5/5) |
| 6 | 快速 open-close | 50 次无竞态 (50/50) |
| 7 | ZVecStorage 初始化 | 文件→删除→目录→第二次打开 |
| 8 | VectorStore 初始化 | 同上 |
| 9 | 损坏后重建 | 破坏 manifest→预期失败→删除→重建成功 |
| 10 | 统一启动集成 | LOCK 保持不动，zvec 自行管理 |

```bash
# 运行完整验证（约 85s，含 SIGKILL 测试）
npx tsx scripts/violent-zvec-test.ts
# 快速模式（跳过耗时项）
npx tsx scripts/violent-zvec-test.ts --quick
```

**结果：30 通过，0 失败。**

---

> **铁律提醒**：本文档修改需与 `docs/architecture/memory-system-v2.md` 设计文档保持一致。
> 代码变更后必须更新本文档中的 API 签名和配置参数。
