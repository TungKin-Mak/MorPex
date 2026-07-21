# MorPex v3.2 架构文档

> **最后更新**：2026-07-17  
> **版本**：v3.2  
> **状态**：✅ 多 Session 架构改造完成，全链路可运行

---

## 1. 架构全景

### 1.1 核心定位

MorPex 是一个**高自治、可观测、可演化的多 Agent 工程化系统**，核心目标是实现可靠的长期自主任务执行。

### 1.2 功能模块

**规划智能层 (Planning Intelligence)**

| 模块 | 文件 | 职责 |
|------|------|------|
| **MetaPlanner** | `MetaPlanner.ts`（865 行） | 编排器：扩展生命周期、wrapOrchestrate、replanPipeline、事件桥接 |
| **PipelineExecutor** | `pipeline/PipelineExecutor.ts`（1975 行） | 7-Stage 管道执行器：S1 意图分析 → S2 经验检索 → S3 候选生成 → S4 DES 模拟 → S5 MCDA 评估 → S6 决策追溯 → S7 计划激活 |
| **PlanExperienceStore** | `PlanExperienceStore.ts` | 计划经验持久化（JSONL），模板/记录 CRUD，失败模式统计 |
| **PlanAnalyzer** | `PlanAnalyzer.ts` | 事后复盘评分（成功率/效率/Token/产物/鲁棒性/复用性），模板推荐，拓扑签名 |
| **PipelineLogger** | `PipelineLogger.ts` | 7-Stage 结构化 Trace 日志（终端彩色 + JSONL 持久化） |
| **PlanEvaluator** | ❌ 已删除 — 统一为 `PlanAnalyzer.ts` | 原 barrel 别名已移除 |
| **PlanOptimizer** | ❌ 已删除 — 统一为 `PlanAnalyzer.ts` | 原 barrel 别名已移除 |

**规划引擎 (engines/)**

| 模块 | 文件 | 职责 | 接入方式 |
|------|------|------|---------|
| **V1CapabilityAdapter** | `engines/V1CapabilityAdapter.ts` | v1 六项能力适配，onPrePlan/onPostPlan 扩展 | `extensions.push()` |
| **StrategicDeconstructor** | `engines/StrategicDeconstructor.ts` | 层次化战略拆解 → 里程碑 | `extensions.push()`（条件启用） |
| **LookAheadSimulator** | `engines/LookAheadSimulator.ts` | 前瞻模拟与风险拒绝 | `extensions.push()`（条件启用） |
| **DynamicReflexEngine** | `engines/DynamicReflexEngine.ts` | 运行时反射重规划 → replanPipeline | `extensions.push()` + wired |
| **TopologyExplorer** | `engines/TopologyExplorer.ts` | 零 Token 拓扑探索（DAG 排列 → DES 模拟 → 预测最优） | PipelineExecutor S4 调用 |
| **HierarchicalPlanningEngine** | `engines/HierarchicalPlanningEngine.ts` | 统计候选生成（策略×变异 = 6-15 候选，零 LLM Token） | PipelineExecutor S3 调用（有历史数据时） |
| **IPlanningExtension** | `engines/IPlanningExtension.ts` | 扩展生命周期接口 | 被所有引擎实现 |

**守卫 (guards/)**

| 模块 | 文件 | 职责 |
|------|------|------|
| **DeviationGuard** | `guards/DeviationGuard.ts` | 防无限规划死循环，偏差计数 + 熔断 |

**v3.0 OpenSpace Fusion 组件**

| 模块 | 文件 | 职责 |
|------|------|------|
| **ToolQualityManager** | `ToolQualityManager.ts` | 逐工具质量追踪 + 滑动窗口退化检测 + 自动修复模板 |
| **TemplateManager** | `TemplateManager.ts` | 模板捕获/派生/修复 + 双向同步 |
| **TemplateEvolutionEngine** | ❌ 已删除 — 统一为 `TemplateManager.ts` | 原 barrel 别名已移除 |
| **TemplateFileSystem** | ❌ 已删除 — 统一为 `TemplateManager.ts` | 原 barrel 别名已移除 |

**v2.6 自学习与观测组件**

| 模块 | 文件 | 职责 |
|------|------|------|
| **PlanningIntelligenceEngine** | `PlanningIntelligenceEngine.ts` | 自主学习回路：Gap 分析 → 权重自调 → 模板演化 |
| **SessionErrorExtractor** | `SessionErrorExtractor.ts` | 实时错误捕获 → 富化 → 因果链 → 根因报告 |
| **RuntimeController** | `RuntimeController.ts` | 运行时影子控制句柄（供 DynamicReflexEngine 使用） |

**执行与运行时层**

- **ExecutionGateway** — 统一执行网关，适配器注册/路由
- **AgentReasoningInterceptor** — 三层拦截：Thought / Action / Observation（统一网关中间件）
- **DAGEngine + hotPatch** — DAG 执行与热修补
- **FSMEngine + SchedulerEngine** — 状态机 + 调度
- **ExecutionRecordingEngine** — 四维录制回放：Thought/Action/Observation/DAG（已接入 ExecutionGateway）

**记忆与知识层**

- **MemoryBus v2** — ECL Cognify + 三层存储：Provenance / Semantic / Topology
- **KnowledgeGraph + ArtifactRegistry + VectorStore**

**编排与路由**

- **MetaPlanner** — 包装 ExecutionOrchestrator，7-Stage Pipeline 委派给 PipelineExecutor
- **CrossDomainRouter + DomainDispatcher** — 跨领域路由
- **CEO → Manager → Worker** — 多 Agent 层级

**基础设施**

- **Kernel + PluginSystem + EventBus**
- **三级分封安全体系 + 权限控制**
- **NegotiationEngine + AsyncResourceLocker** — 事务隔离
- **LineageTracker + ContextPruner + CheckpointManager**

**可观测性**

- **PipelineLogger** — 7-Stage 结构化日志（终端 + JSONL）
- **ExecutionMirror** — EventBus 事件录制
- **ExecutionRecordingEngine** — 四维主动录制（Thought/Action/Observation/DAG）
- **SessionErrorExtractor** — 会话级错误报告
- **PlanningIntelligenceEngine** — 自主学习闭环

---

## 2. 文件树（实际结构）

```
MorPex/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── index.ts                       # 公共 API 出口
│   │   │   │
│   │   │   ├── common/                        # 基础设施
│   │   │   │   ├── Kernel.ts                  # 内核（创建 ExecutionGateway、注册扩展）
│   │   │   │   ├── EventBus.ts
│   │   │   │   ├── PluginSystem.ts
│   │   │   │   ├── ExecutionIdentity.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── gateway/                       # 统一执行网关
│   │   │   │   ├── ExecutionGateway.ts        # 适配器路由 + 录制引擎注入
│   │   │   │   ├── AgentReasoningInterceptor.ts # 三层拦截（Thought/Action/Observation）
│   │   │   │   └── adapters/
│   │   │   │
│   │   │   ├── mirror/                        # 可观测性
│   │   │   │   ├── ExecutionMirror.ts         # 被动 EventBus 录制
│   │   │   │   ├── ExecutionRecordingEngine.ts # 四维主动录制
│   │   │   │   └── storage/
│   │   │   │
│   │   │   ├── planes/                        # 四大平面
│   │   │   │   ├── control-plane/             # 编排器
│   │   │   │   ├── runtime-kernel/            # DAGEngine + FSMEngine + SchedulerEngine
│   │   │   │   ├── agent-plane/               # Agent 执行
│   │   │   │   └── knowledge-plane/           # KnowledgeGraph + ArtifactRegistry + VectorStore
│   │   │   │
│   │   │   ├── extensions/                    # 内核扩展
│   │   │   │   ├── index.ts                   # barrel export
│   │   │   │   ├── types.ts                   # 扩展类型契约
│   │   │   │   ├── ExtensionRegistry.ts
│   │   │   │   ├── LineageTracker.ts
│   │   │   │   ├── ContextPruner.ts
│   │   │   │   ├── McpProcessGuard.ts
│   │   │   │   ├── CheckpointManager.ts
│   │   │   │   │
│   │   │   │   └── planning/                  # Planning Intelligence Layer
│   │   │   │       ├── index.ts               # barrel export
│   │   │   │       ├── types.ts               # 统一类型契约（1850+ 行）
│   │   │   │       ├── MetaPlanner.ts          # 编排器（865 行）
│   │   │   │       ├── PipelineLogger.ts       # 结构化 Trace 日志
│   │   │   │       ├── PlanExperienceStore.ts  # 经验持久化
│   │   │   │       ├── PlanAnalyzer.ts         # 计划分析（评估+优化，合并原 PlanEvaluator/PlanOptimizer）
│   │   │   │       ├── ToolQualityManager.ts   # 工具质量追踪
│   │   │   │       ├── TemplateManager.ts      # 模板演化+文件系统（合并原 TemplateEvolutionEngine/TemplateFileSystem）
│   │   │   │       ├── PlanningIntelligenceEngine.ts # 自主学习回路
│   │   │   │       ├── SessionErrorExtractor.ts # 会话错误提取
│   │   │   │       ├── RuntimeController.ts    # 运行时控制句柄
│   │   │   │       ├── prompts.config.ts       # Prompt 外部化配置
│   │   │   │       │
│   │   │   │       ├── pipeline/
│   │   │   │       │   └── PipelineExecutor.ts # 7-Stage 管道执行器（1975 行）
│   │   │   │       │
│   │   │   │       ├── engines/
│   │   │   │       │   ├── V1CapabilityAdapter.ts
│   │   │   │       │   ├── StrategicDeconstructor.ts
│   │   │   │       │   ├── LookAheadSimulator.ts
│   │   │   │       │   ├── DynamicReflexEngine.ts
│   │   │   │       │   ├── TopologyExplorer.ts
│   │   │   │       │   ├── HierarchicalPlanningEngine.ts
│   │   │   │       │   └── IPlanningExtension.ts
│   │   │   │       │
│   │   │   │       └── guards/
│   │   │   │           └── DeviationGuard.ts
│   │   │   │
│   │   │   ├── router/                        # 跨领域路由
│   │   │   ├── domains/                       # 领域定义
│   │   │   ├── negotiation/                   # 事务隔离
│   │   │   ├── services/                      # LLM Provider 等
│   │   │   ├── tools/                         # 工具系统
│   │   │   ├── mcp/                           # MCP 进程管理
│   │   │   ├── memory/                        # MemoryBus 内部
│   │   │   ├── prompts/                       # 共享 Prompt
│   │   │   ├── compaction/                    # 上下文压缩
│   │   │   ├── projection/                    # 会话投影
│   │   │   ├── permission/                    # 权限控制
│   │   │   ├── industry/                      # 行业模板
│   │   │   └── utils/                         # 工具函数
│   │   │
│   │   └── package.json
│   │
│   ├── memory/                                # 独立记忆包
│   │   └── src/
│   │
│   └── studio/                                # Web 服务
│       └── server/
│           ├── StudioServer.ts                # 启动入口（集成 SessionManager）
│           ├── SessionManager.ts              # ★ v3.2 pi Session 生命周期管理器
│           ├── SessionStore.ts                # ★ v3.2 会话持久化（文件 I/O）
│           ├── StudioOrchestrator.ts          # Agent 路由分发
│           └── ArtifactWriter.ts              # 产物文件系统落盘
│
├── scripts/                                   # 测试脚本
├── data/                                      # 运行时数据
├── configs/                                   # 配置文件
├── docs/                                      # 文档
├── package.json
└── tsconfig.json
```

---

## 3. 架构设计

### 3.1 职责边界

```
suo
```

### 3.2 运行时数据流

```
User Input
  │
  ▼
MetaPlanner.wrapOrchestrate()
  │
  ├── Phase 1: extractTags() + onPrePlan 扩展链
  │     ├── StrategicDeconstructor → 里程碑
  │     └── V1CapabilityAdapter → 上下文富化
  │
  ├── Phase 2: PipelineExecutor.execute()
  │     ├── S1 意图分析 ← knowledgeGraph
  │     ├── S2 经验检索 ← store + vectorStore
  │     ├── S3 候选生成
  │     │     ├── 有历史数据 → HierarchicalPlanningEngine（统计，零 Token）
  │     │     └── 新任务 → LLM（modelRegistry.generate）
  │     ├── S4 DES 模拟 ← TopologyExplorer.exploreAndOptimize()
  │     ├── S5 MCDA 评估 ← PlanAnalyzer + deviationGuard
  │     ├── S6 决策追溯 → memoryBus + JSONL
  │     └── S7 计划激活 → artifactRegistry
  │
  ├── Phase 3: DAG 执行
  │     └── ExecutionGateway.execute()
  │           ├── ExecutionRecordingEngine.startRecording()
  │           ├── AgentReasoningInterceptor（Thought/Action/Observation）
  │           ├── Runtime Kernel（DAGEngine + FSMEngine）
  │           └── ExecutionRecordingEngine.stopRecording()
  │
  ├── Phase 4: onPostPlan 扩展链
  │     └── LookAheadSimulator → 风险拒绝
  │
  ├── Phase 5: 事后处理
  │     ├── PlanAnalyzer.evaluate() → 评分
  │     ├── store.saveRecord() → JSONL 持久化
  │     ├── TemplateManager.captureFromExecution() → 模板捕获
  │     ├── PlanningIntelligenceEngine.evolveTemplates() → 自主学习（异步）
  │     └── deviationGuard.reset()
  │
  └── return { dag, result }

错误路径：
  onWorkflowFailed()
    ├── failureDetails 记录
    └── SessionErrorExtractor.recordError() → 错误管道

  DynamicReflexEngine → replanPipeline()
    └── PipelineExecutor.execute() → DAGPatch → DAGEngine.hotPatch()
```

### 3.3 观测闭环

```
执行 → PipelineLogger（结构化 Trace）
     → ExecutionRecordingEngine（四维录制）
     → ExecutionMirror（EventBus 录制）

错误 → SessionErrorExtractor（捕获 → 富化 → 因果链 → 根因 → 建议）

学习 → PlanningIntelligenceEngine（Gap 分析 → 权重自调 → 模板演化）
     → ToolQualityManager（退化检测 → 自动修复模板）
```

### 3.4 依赖注入（PipelineExecutor）

```
MetaPlanner 构造函数
  ├── new PipelineLogger(...)
  ├── new PlanExperienceStore(...)
  ├── new PlanAnalyzer(store)
  ├── new DeviationGuard(...)
  ├── new TopologyExplorer(...)
  ├── new HierarchicalCandidateGenerator(...)
  ├── new StatisticalPlanSimulator(store, ...)
  ├── new WeightedPlanEvaluator(...)
  ├── new PipelineExecutor({
  │     pipelineLogger, modelRegistry, desConfig,
  │     store, knowledgeGraph, vectorStore,
  │     topologyExplorer, analyzer, deviationGuard,
  │     traceLogPath, artifactRegistry, memoryBus,
  │     hierarchicalPlanner: { candidateGenerator, simulator, evaluator }
  │   })
  ├── new SessionErrorExtractor()
  └── new PlanningIntelligenceEngine(this)
```

### 3.5 多 Session 架构（v3.2）

#### 3.5.1 SessionManager — pi Session 生命周期管理器

**路径**: `packages/studio/server/SessionManager.ts`

SessionManager 统一管理所有 pi Session 的创建、路由、回收。与 SessionStore（文件 I/O 持久化）分工明确：

| 职责 | SessionManager | SessionStore |
|------|:--------------:|:------------:|
| pi Session 生命周期 | ✅ 管理 | ❌ |
| 聊天历史 JSONL 读写 | ❌ | ✅ |
| 节点执行历史 JSONL | ❌ | ✅ |
| harness 懒创建/释放 | ✅ | ❌ |
| 引用计数 + 定时 GC | ✅ | ❌ |

**核心方法**:

```typescript
class SessionManager {
  async create(mode: SessionMode, opts?: { taskId?, executionId?, domainId?, systemPrompt? }): Promise<string>
  async ensureHarness(sessionId: string): Promise<AgentHarness>
  async releaseHarness(sessionId: string): Promise<void>
  async send(sessionId: string, content: string): Promise<SendResult>
  async close(sessionId: string): Promise<void>
  getAll(): SessionHandle[]
  get(sessionId: string): SessionHandle | undefined
}
```

#### 3.5.2 Harness 依赖分层

只有 task session 需要 AgentHarness。编排/规划/检索层直接调用 LLMProvider 或存储层，不经过 harness：

```
SessionManager.send(sessionId, content)
  │
  ├─ mode=chat:
  │   LLMProvider.get()(prompt)                          ❌ 不需 harness
  │
  ├─ mode=luban:
  │   CrossDomainRouter.dispatch(content)                ❌ 不需 harness
  │     → DAG 节点创建 task session
  │     → setImmediate → executeDag()
  │       → 每个节点: ensureHarness(taskSessionId)       ✅ 这里才创建
  │
  ├─ mode=simq:
  │   MemoryBus.recall({ text, topK })                   ❌ 不需 harness
  │
  └─ mode=task:
      ensureHarness(sessionId) → harness.prompt(content) ✅ 需要 harness
```

#### 3.5.3 DomainCluster 改造

DomainCluster 不再拥有 `_master` harness。职责变为：

- `buildTools()` — 返回完整工具链数组（skillPool + askUserTool + AgentCreateTool + TeamSayTool + ReadArtifactTool）
- `execute(goal, harness)` — 接收外部 `AgentHarness` 作为参数，调用 `harness.prompt(goal)`
- 保留 `loadSkills()` / `spawnSubAgent()`

#### 3.5.4 DomainDispatcher 回调

```typescript
class DomainDispatcher {
  onGetHarness: ((domainId: string, taskId: string, goal: string) => Promise<AgentHarness>) | null = null;
  onReleaseHarness: ((taskId: string) => Promise<void>) | null = null;
}
```

StudioServer 接线 `onGetHarness` → `SessionManager.ensureHarness()`，`onReleaseHarness` → `SessionManager.releaseHarness()`。

#### 3.5.5 前端三模式架构

| 模式 | 图标 | 后端路由 | 用途 |
|:----:|:----:|----------|------|
| chat | 💬 | LLMProvider.get() | 单次对话 |
| luban | 🔧 | CrossDomainRouter → DAG | 任务规划与执行 |
| simq | 📖 | MemoryBus.recall() | 记忆检索 |

前端 store (`stores.ts`) 为每个模式维护独立的 `ModeState`（含 `sessionId`、`liveStream`、`executionId`），通过 `activeMode` 切换。

ZoneB 左侧面板支持多 tab：日志 tab 保持现有外观，节点 tab 使用 `NodeShell` 组件显示任务消息流、awaiting_input 选项、interrupted/failed 恢复输入框。

---

## 4. 决策规则

| 决策点 | 规则 | 位置 |
|--------|------|------|
| S3 候选生成 | `store.queryByTags(tags, 5).length > 0` → 统计引擎；否则 LLM | PipelineExecutor S3 |
| S4 拓扑探索 | `nodes.length ≤ 7` → TopologyExplorer；否则跳过 | PipelineExecutor S4 |
| S5 风险偏好 | `deviationCount == 0` → efficiency；`≤ 2` → balanced；`> 2` → stability | PipelineExecutor S5 |
| S7 风控 | `deviationCount > 0 && winner == 'aggressive'` → 降级到 defensive/fallback | PipelineExecutor S7 |
| 熔断 | `deviationCount ≥ maxDeviationsPerSession` → circuit_broken | DeviationGuard |
| 退化修复 | `recentRate < historicalRate × 0.7` → fixTemplate() | ToolQualityManager |
| 自主学习 | 每次成功执行后异步触发 | wrapOrchestrate |

---

## 5. Barrel 导出链

```
planning/index.ts
  ├── MetaPlanner, PlanExperienceStore, PlanAnalyzer
  ├── PipelineExecutor + types
  ├── SessionErrorExtractor + types
  ├── PlanningIntelligenceEngine
  ├── 所有引擎 (V1Adapter, StrategicDeconstructor, LookAheadSimulator,
  │              DynamicReflexEngine, TopologyExplorer, Hierarchical*)
  ├── DeviationGuard, RuntimeController
  ├── PipelineLogger, TemplateManager, ToolQualityManager
  └── 全部类型 (50+ type exports)

extensions/index.ts
  ├── 重新导出 planning/ 模块
  └── LineageTracker, ContextPruner, McpProcessGuard, CheckpointManager

src/index.ts
  └── 重新导出 extensions/ + gateway/ + mirror/ + common/
       → 外部通过 @morpex/core 访问
```

---

## 6. 编译状态

```
tsc --noEmit → packages/core/src/ + packages/memory/src/ 零错误
scripts/ 目录下测试脚本有残留旧路径引用（不影响运行时）
```

---

> **制定日期**：2026-07-17  
> **适用规范**：Forge 铁律 v3.2  
> **维护规则**：重大变更必须同步更新本文档

---

## 7. 记忆系统优化 (v3.1.1 — 2026-07-12)

### 7.1 优化概览

| 阶段 | 优化项 | 文件 | 效果 |
|:---:|--------|------|------|
| P0 | Embedding 缓存 + 请求去重 | `VectorStore.ts` | R2+ S2 向量检索 0 HTTP 调用 |
| P2 | 写入串行队列 | `PlanExperienceStore.ts` | 零并发写入竞争 |
| P3 | S2 并行查询 | `PipelineExecutor.ts` | S2 延迟 -30~50% |
| J1 | JSONL 微批处理统一 | 7 文件 | 文件 I/O 减少 ~80% |

### 7.2 Embedding 缓存 (P0)

```typescript
// VectorStore.ts — 内嵌 LRU 缓存
private embedCache = new Map<string, Float32Array>();    // 已计算向量缓存
private embedPending = new Map<string, Promise<...>>();  // 并发请求去重

async getEmbedding(text: string) {
  if (this.embedCache.has(text))       return this.embedCache.get(text);  // 命中
  if (this.embedPending.has(text))     return this.embedPending.get(text); // 去重
  const p = this._fetchEmbedding(text);
  this.embedPending.set(text, p);
  const vec = await p;
  this.embedCache.set(text, vec);
  return vec;
}
```

**效果**：T1-T10 输入在 10 轮中完全重复，R1 后所有 embedding 命中缓存 → R2-R10 零 HTTP 调用。

### 7.3 JSONL 微批处理统一 (J1)

**改造前**：16 个 JSONL 文件散落在 7 个子系统中，10 个使用裸 `fsp.appendFile`，4 个使用同步阻塞 `fs.appendFileSync`。

**改造后**：全部统一使用 `JSONLWriter`（500ms/50 行微批处理窗口）：

| 子系统 | JSONL 文件数 | 改造前 | 改造后 |
|--------|:----------:|:-----:|:-----:|
| PlanExperienceStore | 2 | `fsp.appendFile` | `JSONLWriter` |
| PipelineExecutor | 2 | `fsp.appendFile` | `JSONLWriter` |
| DeviationGuard | 1 | `fsp.appendFile` | `JSONLWriter` |
| ToolQualityManager | 1 | `fsp.appendFile` | `JSONLWriter` |
| HistoryStore | 4 | `fs.appendFileSync` 🚫 | `JSONLWriter` |
| JSONLStorage | 3 | `fsp.appendFile` | `JSONLWriter` |
| EventStore | 1 | `fsp.appendFile` | `JSONLWriter` |
| KnowledgeGraph | 2 | `JSONLWriter` ✅ | (已有) |
| MemoryBus | 4 | `JSONLWriter` ✅ | (已有) |
| **合计** | **20** | **14 裸写 → 0** | **全部批处理** |

**效果**：R1（10 并发任务）的写入风暴从 ~50 次独立磁盘 I/O 减少到 ~10 次批量刷新（-80%）。

### 7.4 S2 并行查询 (P3)

```typescript
// 优化前：串行
const records = this.store.queryByTags(tags, 20);     // 先查 PlanExperienceStore
const ids = await this.vectorStore.search(input, 15);  // 再查 VectorStore

// 优化后：并行
const [records, ids] = await Promise.all([
  this.store.queryByTags(tags, 20),
  this.vectorStore?.search?.(input, 15) ?? [],
]);
```

### 7.5 性能影响

```
指标              优化前     优化后     提升
─────────────────────────────────────────────
R1 冷启动          17.5s      14.3s     ⬇ 18%
R2-R10 平均        0.6~0.8s   0.0~0.3s  ⬇ 50~100%
文件 I/O (R1)      ~50 次     ~10 次    ⬇ 80%
Embedding HTTP     R2+ 全请求  R2+ 零    ⬇ 100%
```

### 7.6 重启存活修复 (G1/G2/G3)

三个关键学习状态从纯内存迁移到 JSONL 持久化：

| # | 模块 | 持久化内容 | 文件 |
|:--:|------|--------|------|
| G1 | `PlanningIntelligenceEngine` | executionCount + scoreHistory + 自动调优权重 | `intelligence-state.jsonl` |
| G2 | `SessionErrorExtractor` | 错误日志 + 会话级错误报告 | `errors.jsonl` + `error-reports.jsonl` |
| G3 | `TemplateManager` | 模板血统 (CAPTURED→DERIVED→FIXED) | `template-lineages.jsonl` |

**记忆系统最终状态：43/43 功能全部可重启存活。**

### 7.7 文件生命周期管理

三种 JSONL 文件采用三种不同的管理策略：

| 策略 | 适用文件 | 机制 | 触发条件 |
|------|----------|------|:--:|
| **LogRotator** | `errors.jsonl` | 文件级轮转：超 10MB 重命名为 `errors.2026-07-13.jsonl`，30 天后删除 | 每次写入前检查 |
| **JSONLCompactor** | `intelligence-state.jsonl` | 保留最新快照：读取全部 → 只留最后 1 行 → 原子替换 | 每 100 次写入 |
| **JSONLCompactor** | `template-lineages.jsonl` | 按 templateId 去重：每个模板只保留最新血统条目 | 每 50 次写入 |

```
新增文件:
  packages/memory/src/storage/LogRotator.ts    (124 行)
  packages/memory/src/storage/Compactor.ts     (130 行)
```
