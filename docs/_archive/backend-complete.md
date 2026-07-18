# MorPex v3.0 — 后端完整架构手册

> 覆盖 `packages/core/` + `packages/memory/` 全部源文件，含 Autonomous Planning Engine + Three-Layer Interception Gateway + OpenSpace Fusion (ToolQualityManager / TemplateEvolutionEngine / TemplateFileSystem / ExecutionRecordingEngine)
> 最后更新: 2025-07-12

---

## 目录

1. [物理分区总览](#1-物理分区总览)
2. [Kernel 启动全流程](#2-kernel-启动全流程)
3. [四平面 + Gateway 架构](#3-四平面--gateway-架构)
4. [端到端数据流全链路](#4-端到端数据流全链路)
5. [核心层 Core](#5-核心层-core)
6. [AgentFactory — Agent 唯一工厂](#6-agentfactory--agent-唯一工厂)
7. [路由系统 Router](#7-路由系统-router)
8. [Control Plane — 编排器](#8-control-plane--编排器)
9. [MetaPlanner — 自主规划引擎](#9-metaplanner--自主规划引擎)
10. [7-Stage Planning Pipeline](#10-7-stage-planning-pipeline)
11. [Hierarchical Planning Engine（层次规划）](#11-hierarchical-planning-engine层次规划)
12. [TopologyExplorer（零Token拓扑探索）](#12-topologyexplorer零token拓扑探索)
13. [PlanningIntelligenceEngine（自主学习回路）](#13-planningintelligenceengine自主学习回路)
14. [Runtime Reflex Exception System](#14-runtime-reflex-exception-system)
15. [AgentReasoningInterceptor（三层拦截网关）](#15-agentreasoninginterceptor三层拦截网关)
16. [SessionErrorExtractor（会话错误提取）](#16-sessionerrorextractor会话错误提取)
17. [Runtime Kernel — 运行时平面](#17-runtime-kernel--运行时平面)
18. [Agent Plane — 智能体平面](#18-agent-plane--智能体平面)
19. [Knowledge Plane — 知识平面](#19-knowledge-plane--知识平面)
20. [MemoryBus v2 — 三维一体记忆总线](#20-memorybus-v2--三维一体记忆总线)
21. [事件系统 + 溯源](#21-事件系统--溯源)
22. [三级分封安全体系](#22-三级分封安全体系)
23. [提示词系统](#23-提示词系统)
24. [工具系统](#24-工具系统)
25. [协商系统 + 事务隔离](#25-协商系统--事务隔离)
26. [管道可观测性](#26-管道可观测性)
27. [红队故障注入](#27-红队故障注入)
28. [强制收敛唯一路径](#28-强制收敛唯一路径)

---

## 1. 物理分区总览

```
MorPex/
├── packages/
│   ├── core/          ← 核心引擎 (四平面 + 路由器 + Planning Layer)
│   │   ├── core/              Kernel, EventBus, PluginSystem, ExecutionIdentity
│   │   ├── router/            CrossDomainRouter, DomainDispatcher, ArbitrationHandler
│   │   ├── domains/           DomainCluster, DomainClusterManager
│   │   ├── planes/
│   │   │   ├── control-plane/     ExecutionOrchestrator, IntentResolver
│   │   │   ├── agent-plane/       AgentOrchestrator, SwarmEngine
│   │   │   ├── runtime-kernel/    DAGEngine, FSMEngine, SchedulerEngine, ExecutionGraph
│   │   │   └── knowledge-plane/   KnowledgeGraph, ArtifactRegistry, VectorStore
│   │   ├── extensions/            MetaPlanner v3.1 ★, LineageTracker, ContextPruner
│   │   └── planning/            ToolQualityManager ★, TemplateEvolutionEngine ★,
│   │                             TemplateFileSystem ★, HierarchicalPlanningEngine,
│   │                             TopologyExplorer, PlanningIntelligenceEngine,
│   │                             SessionErrorExtractor, ThoughtInterceptor,
│   │                             PipelineLogger, DeviationGuard
│   │   ├── gateway/              ExecutionGateway, AgentReasoningInterceptor ★, PiAdapter
│   │   └── ★ ExecutionRecordingEngine (四维录制回放)
│   │   ├── services/          AgentFactory, AgentService, LLMProvider
│   │   ├── tool(s)/           AgentCreateTool, ForkExecuteTool, ReadArtifactTool, TeamSayTool
│   │   ├── mirror/            ExecutionMirror, JSONLStorage
│   │   ├── memory/            MemoryBusListener, MemoryHooks, VectorStoreAdapter
│   │   ├── event/             EventStore, EventStoreSubscriber
│   ├── negotiation/       NegotiationEngine
│   │   ├── permission/        PermissionEngine
│   │   └── prompts/           leader-prompt, expert-prompt
│   │
│   ├── memory/        ← 三维一体记忆总线 (MemoryBus v2 + ZVec + ECL)
│   │   └── src/
│   │       ├── core/          MemoryBus, ECLCognifyEngine, ChatMemoryExtractor
│   │       ├── storage/       ZVecStorage, JSONLWriter, HistoryStore
│   │       └── vector/        EmbeddingClient, ZVecLockRecovery
│   │
│   ├── studio/        ← Web UI + 开发服务器
│   └── workflows/     ← 工作流定义
│
├── data/              ← 运行时持久化
│   ├── planning/              PlanExperienceStore + Pipeline Traces
│   ├── knowledge/             entities.jsonl + relations.jsonl
│   ├── artifacts/             ArtifactRegistry
│   ├── mirror/                ExecutionMirror 全量日志
│   ├── zvec/                  向量分片 + ID 映射
│   └── memory-bus/            MemoryBus 溯源层
│
└── logs/              ← 运行日志
```

---

## 2. Kernel 启动全流程

> 来源：`packages/core/core/Kernel.ts` — `MorPexKernel.start()`

```
MorPexKernel.start()
  │
  ├─ 1. JSONLStorage.initialize()           ← 存储层初始化
  │
  ├─ 2. PiAdapter 注册                       ← 外部 AgentRuntime 桥接
  │     └─ ExecutionGateway.registerAdapter('pi', piAdapter, true)
  │
  ├─ 3. ExecutionMirror.start()              ← 事件镜像 (全量 JSONL 记录)
  │     └─ EventBus.on(type, handler) 订阅
  │
  ├─ 4. PluginSystem.startAll()              ← 启动全部已注册插件
  │     │
  │     ├─ KnowledgeGraph 插件                ← entities.jsonl + relations.jsonl
  │     ├─ ArtifactRegistry 插件              ← artifact 生命周期管理
  │     ├─ VectorStore 插件                   ← zvec 向量存储 (BGE-M3/1024)
  │     ├─ MetaPlanner 插件 (v3.0) ★          ← 7-Stage Pipeline + TemplateEvolutionEngine
  │     ├─ LineageTracker 插件                ← 谱系追踪
  │     ├─ ContextPruner 插件                 ← 上下文剪枝
  │     ├─ CheckpointManager 插件             ← 检查点管理
  │     ├─ McpProcessGuard 插件               ← MCP 进程守护
  │     ├─ ToolQualityManager 初始化 ★         ← 逐工具质量追踪 + 退化检测
  │     └─ ExecutionRecordingEngine 初始化 ★   ← 四维录制回放引擎
  │
  └─ 5. EventBus.emit('kernel.started')       ← 发射启动完成事件
```

---

## 3. 四平面 + Gateway 架构

> v3.0: ExecutionGateway 层新增 AgentReasoningInterceptor 统一三层拦截 + ExecutionRecordingEngine 四维录制

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MorPex 核心引擎                                  │
│                                                                          │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐    │
│  │  CONTROL PLANE           │  │  AGENT PLANE                      │    │
│  │  (战略规划层)              │  │  (多 Agent 执行层)                 │    │
│  │                          │  │                                   │    │
│  │  IntentResolver          │  │  AgentOrchestrator                │    │
│  │  ExecutionOrchestrator    │  │   ├─ CEO Agent (1 个)            │    │
│  │   ├─ CrossDomainRouter   │  │   ├─ Manager Agent (1+ 个)       │    │
│  │   └─ DomainDispatcher    │  │   └─ Worker Agent (1+ 个)        │    │
│  │                          │  │      ├─ coder / reviewer          │    │
│  │  ★ MetaPlanner v3.0      │  │      ├─ tester / designer         │    │
│  │   ├─ 7-Stage Pipeline    │  │      └─ researcher                │    │
│  │   ├─ DynamicReflexEngine │  │                                   │    │
│  │   ├─ DeviationGuard      │  │  SwarmEngine                      │    │
│  │   ├─ PipelineLogger      │  │   └─ 群体协作 + 共识              │    │
│  │   └─ FaultInjector       │  │                                   │    │
│  │                          │  │                                   │    │
│  ├──────────────────────────┤  ├───────────────────────────────────┤    │
│  │  RUNTIME KERNEL          │  │  KNOWLEDGE PLANE                   │    │
│  │  (可靠执行层)              │  │  (知识记忆层)                       │    │
│  │                          │  │                                   │    │
│  │  DAGEngine                │  │  KnowledgeGraph                   │    │
│  │   ├─ addNode/removeNode  │  │   ├─ entities.jsonl              │    │
│  │   ├─ insertAfter         │  │   ├─ relations.jsonl             │    │
│  │   ├─ rerouteNode         │  │   └─ 邻接表路径搜索               │    │
│  │   ├─ hotPatch() ★        │  │                                   │    │
│  │   └─ validate()          │  │  ArtifactRegistry                 │    │
│  │                          │  │   ├─ URI: artifact://...         │    │
│  │  FSMEngine                │  │   ├─ 版本管理 + 领域索引         │    │
│  │   └─ 状态机：IDLE →       │  │   └─ 资源令牌预留                 │    │
│  │      PLANNING → RUNNING   │  │                                   │    │
│  │      → WAITING_TOOL → ... │  │  VectorStore (zvec)               │    │
│  │                          │  │   └─ BGE-M3 / 1024 维嵌入         │    │
│  │  SchedulerEngine          │  │                                   │    │
│  │   └─ 拓扑调度 + 并行执行   │  │  ★ MemoryBus v2                   │    │
│  │                          │  │   ├─ ECL Cognify 管道              │    │
│  │  ExecutionGraph           │  │   ├─ 三层存储引擎                  │    │
│  │   └─ 全局执行图追踪       │  │   └─ 竞争淘汰 + 反馈闭环           │    │
│  └──────────────────────────┘  └───────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  CORE INFRASTRUCTURE (跨平面基础设施)                               │   │
│  │                                                                   │   │
│  │  EventBus (同步事件总线)        ExecutionIdentity (ID 生成)         │   │
│  │  PluginSystem (插件注册/生命周期) ExecutionMirror (JSONL 全量镜像)   │   │
│  │  ExecutionGateway (适配器注册)   JSONLStorage (磁盘持久化)           │   │
│  │  EventStore (事件溯源)           AsyncResourceLocker (资源锁)        │   │
│  │  EngineSubscriber (引擎→事件桥接)  MorPexConfig (全局配置)           │   │
│  │  ★ ToolQualityManager (退化检测)  ★ ExecutionRecordingEngine (录制)  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 端到端数据流全链路

> 从用户输入到产物落盘，每一步均来自真实代码调用链

```
USER INPUT: "构建 AI 推荐系统并部署到 AWS"
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Kernel 入口                                              │
│   bootstrapMorPexCore(runtime, config) → kernel.start()          │
│   → EventBus 就绪，PluginSystem 全部启动                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: ExecutionOrchestrator.orchestrate(userInput, sessionCtx) │
│   (已被 MetaPlanner.wrapOrchestrate() 包装)                       │
│                                                                  │
│   ┌─── MetaPlanner v2.6 Wrapper ────────────────────────────┐   │
│   │                                                           │   │
│   │  Phase A: onPrePlan 扩展链                                │   │
│   │   ├─ V1CapabilityAdapter       → extractTags() 标签提取   │   │
│   │   └─ StrategicDeconstructor    → KnowledgeGraph 交叉引用  │   │
│   │                                                           │   │
│   │  Phase B: ★ 7-Stage Planning Pipeline                    │   │
│   │   S1: 意图分析                                            │   │
│   │     extractTags() + KnowledgeGraph.searchEntities()       │   │
│   │     → SemanticTag[] + confidenceScore                     │   │
│   │     → abort if confidenceScore < 0.3                      │   │
│   │                                                           │   │
│   │   S2: 经验检索                                            │   │
│   │     PlanExperienceStore.queryByTags()  (结构布局匹配)      │   │
│   │     + VectorStore.search()            (余弦相似度)         │   │
│   │     → Positive Samples + Negative Samples                 │   │
│   │                                                           │   │
│   │   S3: 候选计划生成                                        │   │
│   │     modelRegistry.generate() (LLM 结构化 JSON 输出)        │   │
│   │     → 3 策略: aggressive / defensive / fallback            │   │
│   │     → Zod 校验失败 → 预编译防御性模板                      │   │
│   │                                                           │   │
│   │   S4: DES 离散事件模拟                                    │   │
│   │     3× ShadowContext (纯内存隔离副本)                      │   │
│   │     随机波动率矩阵 (负样本种子)                            │   │
│   │     0-3 微重试 + 级联故障传播                             │   │
│   │     → IShadowSimulationReport[]                           │   │
│   │                                                           │   │
│   │   S5: MCDA 多准则决策评估                                 │   │
│   │     Score = Σ(w_i · S_i), 权重归一化 1.0                   │   │
│   │     6 维度: stability/latency/security/alignment          │   │
│   │            /healing/knowledge                              │   │
│   │     → IEvaluationScorecard + winner                       │   │
│   │                                                           │   │
│   │   S6: 决策追踪                                            │   │
│   │     → MemoryBus Local Map Cache (内存写入)                 │   │
│   │     → JSONL 追加 (磁盘持久化, 谱系审计)                    │   │
│   │                                                           │   │
│   │   S7: 最佳计划选择 + 激活                                 │   │
│   │     deviationCount=0 → 效率权重 (S_latency 优先)           │   │
│   │     deviationCount>0 → 稳定性权重 + aggressive 覆写        │   │
│   │     → ArtifactRegistry 资源令牌预留                        │   │
│   │     → PlanActivationResult (winner DAG)                   │   │
│   │                                                           │   │
│   │  Phase C: 执行 Winner DAG                                 │   │
│   │   pipelineActivation.activatedPlan.dag                    │   │
│   │   → originalOrchestrate(userInput, sessionCtx)            │   │
│   │                                                           │   │
│   └───────────────────────────────────────────────────────┘   │
│                                                                  │
│   原始流程: router.dispatch() → dispatcher.executeDAG()          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: CrossDomainRouter.dispatch(userInput)                    │
│   LLMProvider.generate(compileLeaderPrompt(...))                 │
│   → 单次 LLM 调用：领域判定 + 任务拆解 + DAG 拓扑                │
│   → ExecutionDAG { nodes: DAGNode[], involvedDomains, ... }      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: DomainDispatcher.executeDAG(dag.nodes, sessionCtx)      │
│   拓扑排序 → 按就绪状态逐批并行执行                               │
│   L3 事务隔离: AsyncResourceLocker + NegotiationEngine           │
│   → DAGExecutionResult { results: NodeResult[], ... }            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: AgentOrchestrator (多 Agent 执行)                        │
│   CEO Agent     → 子目标分解 + 策略制定                          │
│   Manager Agent → 任务分配 + 进度追踪                            │
│   Worker Agent  → AgentService (pi-agent-core)                  │
│     ├─ coder      → LLM 代码生成                                 │
│     ├─ reviewer   → 代码审查                                     │
│     ├─ tester     → 测试执行                                     │
│     └─ researcher → 调研分析                                     │
│   → artifacts (代码 / 文档 / 模型 / 报告)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Knowledge Plane — 产物持久化                              │
│                                                                  │
│   ArtifactRegistry.register(artifact)                            │
│   → URI: artifact://{domain}/{type}/{id}                         │
│   → EventBus.emit('artifact.created')                            │
│                                                                  │
│   KnowledgeGraph.addEntity() + addRelation()                     │
│   → entities.jsonl + relations.jsonl                             │
│                                                                  │
│   MemoryBus.remember(content, meta)                              │
│   → ECL Cognify 管道 → 三层存储                                  │
│   → VectorStore.index() (zvec 向量化)                            │
│                                                                  │
│   EventBus 事件流:                                                │
│   ├─ FSMEngine.setState() → emit('fsm.transition')               │
│   │    └─ EventStoreSubscriber → EventStore → JSONL              │
│   ├─ ToolCallTracker.transition() → emit('tool.state_change')    │
│   │    └─ EventStoreSubscriber → EventStore → JSONL              │
│   ├─ agent.end → emit('agent.end')                               │
│   │    └─ MemoryBusListener → VectorStore.upsert()               │
│   └─ artifact.updated → emit('artifact.updated')                 │
│        └─ MemoryBusListener → VectorStore.upsert()               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. 核心层 Core

### 5.1 Kernel — 内核生命周期

- **文件**: `packages/core/core/Kernel.ts`
- **导出**: `MorPexKernel`, `KernelConfig`

```typescript
interface KernelConfig {
  piRuntime?: any;
  mirrorBasePath?: string;
  plugins?: MorPexPlugin[];
}

type KernelStatus = {
  phase: 'init' | 'starting' | 'running' | 'stopping' | 'stopped';
  uptime: number;
  pluginCount: number;
  activeExecutions: number;
};
```

**唯一入口**: `bootstrapMorPexCore(runtime, config)` → `kernel.start()`

### 5.2 EventBus — 同步事件总线

- **文件**: `packages/core/core/EventBus.ts`
- **导出**: `EventBus`

```typescript
class EventBus {
  emit(event: MorPexEvent): void;
  on(type: string, handler: EventHandler): () => void;
  clear(): void;
}
```

### 5.3 PluginSystem — 插件生命周期

- **文件**: `packages/core/core/PluginSystem.ts`
- **导出**: `PluginSystem`

插件生命周期: `register → initialize → start → stop`

### 5.4 ExecutionIdentity — 全链路 ID

- **文件**: `packages/core/core/ExecutionIdentity.ts`
- **导出**: `ExecutionIdentity`

生成: `executionId / traceId / sessionId / eventId / artifactId`

---

## 6. AgentFactory — Agent 唯一工厂

- **文件**: `packages/core/services/AgentFactory.ts`
- **导出**: `AgentFactory`, `SecurityBoundaryException`, `AgentSpawnContext`

```typescript
interface AgentSpawnContext {
  identityToken: string;       // 必填 — 调用方身份令牌
  cgroupQuota: {               // 必填 — Cgroup 配额引用
    tokenLimit: number;
    usedTokens: number;
  };
  ring: 0 | 1 | 2;            // 特权级
  tools?: AgentTool[];
  systemPrompt?: string;
}
```

**数据流**: `spawn(context) → 校验 identityToken + cgroupQuota → getModel() → AgentHarness`

---

## 7. 路由系统 Router

### 7.1 CrossDomainRouter — Single-Shot 路由

- **文件**: `packages/core/router/CrossDomainRouter.ts`
- **导出**: `CrossDomainRouter`

```
dispatch(userInput)
  → buildRoutingPrompt()     ← Single-Shot Prompt
  → LLMProvider.get()(prompt) ← 一次 LLM 调用
  → extractJson(response)
  → 单领域: 快速路径 (跳过二次 LLM)
  → 多领域: buildNodes() → ExecutionDAG
```

LLM 调用失败直接 throw，无降级路径。

### 7.2 DomainDispatcher — DAG 执行调度

- **文件**: `packages/core/router/DomainDispatcher.ts`
- **导出**: `DomainDispatcher`, `NodeResult`, `DAGExecutionResult`
- **v3.0 集成**: `setToolQualityManager()` — 每个节点执行后自动调用 `ToolQualityManager.recordToolCall()` 记录成功/失败/延迟，用于退化检测

### 7.3 ArbitrationHandler

- **文件**: `packages/core/router/ArbitrationHandler.ts`
- **导出**: `ArbitrationHandler`

---

## 8. Control Plane — 编排器

### 8.1 ExecutionOrchestrator

- **文件**: `packages/core/planes/control-plane/orchestrator/ExecutionOrchestrator.ts`
- **导出**: `ExecutionOrchestrator`, `ExecutionDAG`

```typescript
interface ExecutionDAG {
  nodes: DAGNode[];
  isMultiDomain: boolean;
  involvedDomains: string[];
  domainDependencies: Array<{ domain: string; dependsOn: string[] }>;
  globalIntent: string;
  reasoning: string;
}
```

### 8.2 IntentResolver

- **文件**: `packages/core/planes/control-plane/intent/IntentResolver.ts`
- **导出**: `IntentResolver`

---

## 9. MetaPlanner v3.0 — 规划智能层（★ 新增）

> 文件: `packages/core/kernel-extensions/planning/`

### 9.1 定位

MetaPlanner 是 Control Plane 的"大脑皮层"，作为 `ExecutionOrchestrator` 的**非侵入式生命周期拦截器**运行。通过 `wrapOrchestrate()` 包装原始编排函数，注入 7-Stage Planning Pipeline。

### 9.2 内部组件关系

```
MetaPlanner (implements ExtensionDefinition, 插件优先级 0)
  │
  ├── 核心数据层 (v1 保留)
  │   ├── PlanExperienceStore      ← JSONL 经验存储
  │   ├── PlanEvaluator            ← 多维度质量评估
  │   └── PlanOptimizer            ← 历史驱动优化引擎
  │
  ├── v2.6 管道基础设施 (★ 新增)
  │   ├── PipelineLogger           ← 彩色终端 Trace + JSONL 持久化
  │   ├── PipelineTypes.ts         ← 14 接口 + 3 配置常量 (契约先行)
  │   └── prompts.config.ts        ← 外部化 LLM Prompt (3 个, Prompt 分离)
  │
  ├── v2 扩展引擎 (插件链, 按 priority 排序)
  │   ├── V1CapabilityAdapter      ← priority 0: 标签提取 + 模板匹配
  │   ├── StrategicDeconstructor   ← priority 10: 知识图谱里程碑拆解
  │   ├── LookAheadSimulator       ← priority 30: 死锁检测 + 风险节点
  │   └── DynamicReflexEngine ★    ← priority 50: 运行时反射 + 重规划
  │
  ├── 守卫系统
  │   └── DeviationGuard           ← 熔断: max 3 deviations/session
  │
  └── 外部依赖 (构造注入)
      ├── MemoryBus                ← 进程内单例 (Local Map Cache + JSONL)
      ├── DAGEngine                 ← 运行时内核 DAG 引擎
      ├── KnowledgeGraph            ← 知识图谱
      ├── ArtifactRegistry          ← 产物注册中心
      ├── VectorStore               ← zvec 向量存储
      ├── EventBus                  ← 同步事件总线
      └── ModelRegistry             ← LLM Provider (Stage 3)
```

### 9.3 公开 API

```typescript
class MetaPlanner {
  // 核心 API (签名向下兼容)
  wrapOrchestrate(orchestrateFn): WrappedOrchestrateFn;

  // 扩展管理
  registerExtension(ext: IPlanningExtension): void;
  unregisterExtension(name: string): void;
  getExtensions(): IPlanningExtension[];

  // 运行时重规划入口 ★
  replanPipeline(sessionId, executionId, failureContext): Promise<ReplanResult>;

  // 查询 API (v1 保留)
  getRecommendation(userInput: string): RecommendationResult;
  getFailureReport(): FailurePattern[];
  getPlanStats(): PlanStoreStats;
}
```

---

## 10. 7-Stage Planning Pipeline（★ 新增）

> 注入于 `MetaPlanner.wrapOrchestrate()` 内，在 onPrePlan 扩展链之后、DAG 执行之前

### 10.1 完整管道规格

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1: Intent Analysis (意图分析)                              │
│  ─────────────────────────────────────────────────────────────── │
│  输入: raw user input, regex tags                                │
│  逻辑: extractTags() + KnowledgeGraph.searchEntities()           │
│  输出: IntentAnalysisResult {                                    │
│    tags: SemanticTag[]      ← 结构化语义标签                      │
│    targetStateMatrix: {}    ← 目标状态矩阵 (S_target)             │
│    explicitConstraints      ← 显式环境约束 (workspace, window)    │
│    implicitConstraints      ← 隐式推断约束                        │
│    confidenceScore: 0-1     ← 低于 0.3 → ABORT 管道               │
│  }                                                               │
│  文件: MetaPlanner.stage1IntentAnalysis()                         │
│  Prompt: STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT (prompts.config.ts) │
├─────────────────────────────────────────────────────────────────┤
│  Stage 2: Experience Retrieval (经验检索)                         │
│  ─────────────────────────────────────────────────────────────── │
│  输入: userInput, tags, IntentAnalysisResult                     │
│  逻辑:                                                            │
│    PlanExperienceStore.queryByTags() → 结构布局匹配               │
│    VectorStore.search()            → 余弦相似度 (向量化输入)      │
│  输出: ExperienceQueryResult {                                    │
│    positiveSamples: PlanExecutionRecord[]  ← 成功 DAG              │
│    negativeSamples: PlanExecutionRecord[]  ← 失败/偏差样本         │
│    vectorMatches: VectorMatch[]           ← 相似度 + 关键洞察      │
│  }                                                               │
│  文件: MetaPlanner.stage2ExperienceRetrieval()                    │
├─────────────────────────────────────────────────────────────────┤
│  Stage 3: Candidate Plan Generation (候选方案生成)                 │
│  ─────────────────────────────────────────────────────────────── │
│  输入: IntentAnalysisResult, ExperienceQueryResult               │
│  逻辑:                                                            │
│    modelRegistry.generate(STAGE3_CANDIDATE_GENERATION_PROMPT)    │
│    → 单次 LLM 调用, 强制 JSON Schema 输出                         │
│    → 利用对比注意力生成 3 个截然不同的策略:                         │
│      aggressive: 优化路径效率, 剥离冗余安全检查点                   │
│      defensive:  注入环境消毒脚本 + Florence-2 视觉对齐            │
│      fallback:   绕过 Frida/MinHook, 纯原生 API + 视觉坐标追踪     │
│  校验: parseAndValidateCandidates() → Zod 结构验证                 │
│  降级: 校验/截断失败 → generateFallbackCandidates() → 预编译模板    │
│  输出: ICandidatePlansOutput {                                    │
│    candidates: [aggressive, defensive, fallback]  ← 严格 3 个     │
│    validationPassed: boolean                                      │
│    fallbackTemplateUsed?: boolean                                 │
│  }                                                               │
│  文件: MetaPlanner.stage3CandidateGeneration()                    │
│  Prompt: STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT                │
├─────────────────────────────────────────────────────────────────┤
│  Stage 4: Plan Simulation / DES (离散事件模拟)                     │
│  ─────────────────────────────────────────────────────────────── │
│  输入: ICandidatePlansOutput, ExperienceQueryResult               │
│  逻辑:                                                            │
│    对每个 profile:                                                 │
│      创建 3 个完全隔离的 ShadowContext (纯内存拷贝)                  │
│      沿虚拟时间轴步进每个 DAG 节点                                  │
│      每次步进: 基于负样本种子 + 文件系统锁定热图的随机概率检查      │
│      失败节点: 最多 3 次微重试 (模拟 Self-Healing Runtime 缓冲)    │
│      仍失败: 向下游传播级联故障                                    │
│      3 次运行取平均 (随机平均)                                     │
│  输出: IShadowSimulationReport[] (每个 profile 一份) {             │
│    survivalProbability: 0-1                                       │
│    totalSimulatedLatencyMs: number                                │
│    nodeResults: DESNodeResult[]  ← 每个节点的模拟结果              │
│    resourceBottlenecks: []       ← 资源竞争瓶颈                   │
│    simulatedExceptionTraces: []  ← 模拟异常堆栈                   │
│    overallAssessment: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL'       │
│  }                                                               │
│  文件: MetaPlanner.stage4PlanSimulation()                          │
├─────────────────────────────────────────────────────────────────┤
│  Stage 5: Plan Evaluation / MCDA (多准则决策评估)                  │
│  ─────────────────────────────────────────────────────────────── │
│  输入: IShadowSimulationReport[], ICandidatePlansOutput           │
│  逻辑:                                                            │
│    加权线性组合评分模型:                                            │
│      Score = w1·S_stability + w2·S_latency + w3·S_security       │
│            + w4·S_alignment + w5·S_healing + w6·S_knowledge       │
│    权重归一化到 1.0                                                │
│    从 simulation 数据 + candidate 特征计算 6 维度原始分数           │
│  输出: IEvaluationScorecard {                                     │
│    profiles: { aggressive, defensive, fallback: ProfileScore }    │
│    weightConfiguration: WeightConfiguration                       │
│    winner: 'aggressive' | 'defensive' | 'fallback'               │
│    winnerScore: number                                            │
│    scoreBreakdown: ScoreBreakdownEntry[]  ← 完整审计轨迹          │
│  }                                                               │
│  文件: MetaPlanner.stage5PlanEvaluation()                          │
├─────────────────────────────────────────────────────────────────┤
│  Stage 6: Decision Trace (决策追踪)                                │
│  ─────────────────────────────────────────────────────────────── │
│  输入: IEvaluationScorecard, IShadowSimulationReport[]            │
│  逻辑:                                                            │
│    为每个淘汰候选方案序列化淘汰原因                                  │
│    为获胜方案序列化选择理由                                        │
│    → 同步写入 MemoryBus Local Map Cache                           │
│    → 同步追加到 JSONL 磁盘文件 (谱系审计)                           │
│  输出: DecisionTrace {                                            │
│    candidateEliminations: [{ profile, reason, score }]            │
│    winnerSelection: { profile, rationale, riskAdjustedWeights }   │
│    deviationCount: number                                         │
│    riskAppetite: 'efficiency' | 'balanced' | 'stability'         │
│    writtenToDisk: boolean                                         │
│  }                                                               │
│  文件: MetaPlanner.stage6DecisionTrace()                           │
├─────────────────────────────────────────────────────────────────┤
│  Stage 7: Best Plan Selection & Activation (最佳计划选择+激活)      │
│  ─────────────────────────────────────────────────────────────── │
│  输入: IEvaluationScorecard, DecisionTrace, ICandidatePlansOutput │
│  逻辑:                                                            │
│    读取 MemoryBus 中的 deviationCount                              │
│    风险偏好调节器:                                                  │
│      deviationCount === 0 → 效率权重 (S_latency 优先)             │
│      deviationCount > 0   → 稳定性权重 + aggressive 赢家覆写:      │
│        aggressive 胜出 → 检查 defensive 得分是否 ≥ 70%?           │
│          YES → 覆写为 defensive                                    │
│          NO  → 检查 fallback 得分是否 ≥ 50%?                      │
│            YES → 覆写为 fallback                                   │
│    ArtifactRegistry.reserveToken() → 防止工作区冲突                │
│  输出: PlanActivationResult {                                     │
│    activatedPlan: CandidatePlanProfile  ← 最终胜出 DAG            │
│    resourceTokens: string[]              ← ArtifactRegistry 令牌  │
│    readyForExecution: boolean            ← 可以转发执行            │
│  }                                                               │
│  文件: MetaPlanner.stage7BestPlanSelection()                       │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 类型契约 (契约先行)

> 文件: `packages/core/kernel-extensions/planning/PipelineTypes.ts` — 14 接口 + 3 配置常量

| 接口 | 阶段 | 用途 |
|:--|:--|:--|
| `SemanticTag` | S1 | 结构化语义标签 (score + category + source) |
| `IntentAnalysisResult` | S1 | 意图分析输出 (置信度 + 约束 + 状态矩阵) |
| `ExperienceQueryResult` | S2 | 经验检索输出 (正/负样本 + 向量匹配) |
| `CandidatePlanProfile` | S3 | 单个策略候选 (DAG + 风险画像 + 理由) |
| `ICandidatePlansOutput` | S3 | LLM 结构化输出 (严格 3 个 profiles) |
| `ShadowContext` | S4 | 纯内存隔离克隆 (DES 沙盒) |
| `DESNodeResult` | S4 | 单节点模拟结果 (通过/失败/重试/级联) |
| `IShadowSimulationReport` | S4 | 完整 DES 模拟输出 (生存率 + 瓶颈 + 异常) |
| `ProfileScore` | S5 | 6 维度评分 (每个维度 0-1) |
| `IEvaluationScorecard` | S5 | MCDA 记分卡 (权重 + 胜者 + 分解) |
| `DecisionTrace` | S6 | 决策追踪 (淘汰原因 + 胜出理由) |
| `PlanActivationResult` | S7 | 最终激活输出 (胜出 DAG + 资源令牌) |
| `PipelineStageResult` | ALL | 单阶段结果 (stage/status/duration/output/error) |
| `PipelineTrace` | ALL | 完整 7 阶段追踪 (审计用) |

### 10.3 Prompt 分离 (微粒化)

> 文件: `packages/core/kernel-extensions/planning/prompts.config.ts`

| Prompt | 用途 |
|:--|:--|
| `STAGE1_INTENT_ANALYSIS_SYSTEM_PROMPT` | 意图分析 (S1) — 目标状态矩阵推理 + 约束提取 |
| `STAGE3_CANDIDATE_GENERATION_SYSTEM_PROMPT` | 三策略 JSON 生成 (S3) — 对比注意力合成 |
| `FALLBACK_DEFENSIVE_TEMPLATE_DESCRIPTION` | 预编译防御性模板说明 (S3 降级用) |

**设计红线**: 调整 LLM 博弈风格 → 只编辑 `prompts.config.ts`；调整管道编排逻辑 → 只编辑 `MetaPlanner.ts`。两者永不碰撞。

---

## 11. Runtime Reflex Exception System（★ 新增）

> 文件: `packages/core/kernel-extensions/planning/extensions/DynamicReflexEngine.ts`

### 11.1 反射回路完整流程

```
运行时异常触发:
  Runtime Kernel (DAGEngine / FSMEngine / SchedulerEngine)
    │
    ├── 'runtime.node.failed'       → EventBus
    ├── 'runtime.deviation'         → EventBus
    ├── 'runtime.self_heal.failed'  → EventBus
    └── 'runtime.node.deviation'    → EventBus
            │
            ▼
  MetaPlanner.bridgeMemoryBusEvent(rawEvent)
    │
    ▼
  DynamicReflexEngine.onRuntimeEvent(context, controller)
    │
    ├── Step 1: DeviationGuard.isAllowed(sessionId)
    │   └── 若已熔断 → { action: 'circuit_broken' }
    │
    ├── Step 2: calculateSeverity(eventType, payload)
    │   └── 若 < 0.3 → { action: 'ignored' }
    │
    ├── Step 3: calculateAffectedNodes(payload)
    │   └── 若无受影响节点 → { action: 'ignored' }
    │
    ├── Step 4: deviationCount >= 3?
    │   └── YES → 全局熔断, 交由 Self-Healing Runtime 全局兜底
    │
    ├── Step 5: replanPipeline(sessionId, executionId, context) ★
    │   │
    │   ├── controller.pause()                    ← 挂起 DAG 调度器
    │   ├── MetaPlanner.replanPipeline()           ← 触发完整 7-Stage Pipeline
    │   │   → 返回 PlanActivationResult (新 DAG + Patch)
    │   ├── controller.patchDAG(patchedSubDAG)     ← DAGEngine.hotPatch()
    │   │   └── 无缝替换内存中待执行 DAG 节点指针
    │   ├── controller.resume()                   ← 恢复 DAG 调度器
    │   ├── DeviationGuard.recordDeviation()       ← JSONL 偏差追踪
    │   └── MemoryBus.appendLog()                  ← JSONL 干预审计
    │
    └── Step 6: (降级) generatePatch() 本地 DAG 修补
        └── remove_node / reroute / insert_after
```

### 11.2 DeviationGuard — 熔断守卫

- **文件**: `packages/core/kernel-extensions/planning/guards/DeviationGuard.ts`

```
约束:
  maxDeviationsPerSession: 3
  超过 → 熔断 (circuitBreaker = true)
  熔断后 → 不再执行重规划, 交给 Self-Healing Runtime 全局兜底
  
方法:
  isAllowed(sessionId)    → 检查是否允许重规划
  recordDeviation(record) → 记录一次偏差 + JSONL 写入
  getDeviationCount()     → 获取当前偏差计数
  reset(sessionId)        → 重置 (正常完成时调用)
```

### 11.3 RuntimeController — 影子控制句柄

- **文件**: `packages/core/kernel-extensions/planning/RuntimeController.ts`

```typescript
class RuntimeController implements IRuntimeController {
  pause(): void;                              // 挂起 DAG 执行
  patchDAG(patch: DAGPatch): Promise<boolean>; // 应用热修补
  resume(): void;                              // 恢复 DAG 执行
  getDeviationCount(sessionId): number;        // 查询偏差计数
}
```

---

## 12. Runtime Kernel — 运行时平面

### 12.1 DAGEngine — DAG 执行引擎

- **文件**: `packages/core/planes/runtime-kernel/dag/DAGEngine.ts`
- **导出**: `DAGEngine`

```typescript
class DAGEngine {
  addNode(node: DAGNode): boolean;
  removeNode(nodeId: string): boolean;
  insertAfter(afterNodeId: string, newNode: DAGNode): boolean;
  rerouteNode(nodeId: string, alternateId?: string): boolean;
  hotPatch(sessionId: string, patchedSubDAG: ExecutionDAG): boolean; // ★ v2.5
  validate(): ValidationResult;
  getNode(nodeId: string): DAGNode | undefined;
  getAllNodes(): DAGNode[];
}
```

### 12.2 FSMEngine — 运行时状态机

- **文件**: `packages/core/planes/runtime-kernel/fsm/FSMEngine.ts`
- **导出**: `FSMEngine`, `FSMState`

```
状态流:
  IDLE → PLANNING → RUNNING ──→ WAITING_TOOL → RUNNING
                    │                       │
                    └──→ WAITING_USER ──────┘
                    │
                    └──→ SUSPENDED → RUNNING
                    │
                    └──→ VERIFYING → COMPLETED / FAILED
  (任意状态) ──→ CANCELLED
```

调度逻辑: `feed(event) → _check_next_action(event)` — 动态推导, 无硬编码 TRANSITIONS 表

### 12.3 SchedulerEngine

- **文件**: `packages/core/planes/runtime-kernel/scheduler/SchedulerEngine.ts`
- **导出**: `SchedulerEngine`

### 12.4 ExecutionGraph

- **文件**: `packages/core/planes/runtime-kernel/execution-graph/ExecutionGraph.ts`
- **导出**: `ExecutionGraph`

---

## 13. Agent Plane — 智能体平面

### 13.1 AgentOrchestrator — 多 Agent 编排

- **文件**: `packages/core/planes/agent-plane/orchestrator/AgentOrchestrator.ts`
- **导出**: `AgentOrchestrator`

层级: **CEO (1) → Manager (1+) → Worker (1+)**

Worker 类型: `coder / reviewer / tester / designer / researcher`

### 13.2 SwarmEngine — 群体协作

- **文件**: `packages/core/planes/agent-plane/swarm/SwarmEngine.ts`
- **导出**: `SwarmEngine`

---

## 14. Knowledge Plane — 知识平面

### 14.1 KnowledgeGraph — 知识图谱

- **文件**: `packages/core/planes/knowledge-plane/knowledge/KnowledgeGraph.ts`
- **导出**: `KnowledgeGraph`

持久化: `entities.jsonl` + `relations.jsonl`
查询: `searchEntities() / getNeighborhood() / findPath()`

### 14.2 ArtifactRegistry — 产物注册中心

- **文件**: `packages/core/planes/knowledge-plane/artifacts/ArtifactRegistry.ts`
- **导出**: `ArtifactRegistry`

URI 格式: `artifact://{domain}/{artifactType}/{artifactId}`

### 14.3 VectorStore — 向量存储

- **文件**: `packages/core/planes/knowledge-plane/memory/VectorStore.ts`
- **导出**: `VectorStore`

嵌入: BGE-M3 / 1024 维, 存储: zvec 分片

---

## 15. MemoryBus v2 — 三维一体记忆总线

> 文件: `packages/memory/src/core/MemoryBus.ts`

### 15.1 三层存储引擎

```
MemoryBus.remember(content, meta)
  │
  ├── Layer 0: ECL Cognify 管道
  │   ├── Extract    → 实体/关系抽取
  │   ├── Classify   → memType 分类 (knowledge/identity/summary/correction)
  │   └── Link       → 与已有记忆建立引用
  │
  ├── Layer 1: Provenance (溯源层)
  │   ├── JSONL 索引 → data/memory-bus/provenance.jsonl
  │   └── MD5 去重
  │
  ├── Layer 2: Semantic (语义层)
  │   └── ZVecStorage → BGE-M3 / 1024 维
  │       ├── data/zvec/0/      ← 向量分片
  │       └── data/zvec/idmap.0/ ← ID 映射
  │
  └── Layer 3: Topology (拓扑层)
      ├── KnowledgeGraph.addEntity()
      ├── KnowledgeGraph.addRelation()
      └── 邻接表 (内存中)
```

### 15.2 核心 API

```typescript
class MemoryBus {
  remember(content, meta): Promise<void>;           // ECL 管道 + 竞争写入
  recall(query, strategy): Promise<MemoryItem[]>;   // 混合检索 (hybrid-rag)
  forget(id): Promise<void>;                        // 三层联合删除
  feedback(id, useful): Promise<FeedbackResult>;    // 闭环反馈
  compactMemories(): Promise<CompactResult>;        // 记忆压缩
  stageComplete / summary / output: Promise<void>;  // 阶段管理
  planStages(stages): void;                         // 预绑定门控标签
  interceptInput(query): Promise<GateSignal>;       // Layer 2 输入拦截
}
```

---

## 16. 事件系统 + 溯源

### 16.1 EventStore — 事件溯源

- **文件**: `packages/core/event/EventStore.ts`
- **导出**: `EventStore`, `SourcingEvent`

9 种事件类型: `tool_call_state_change / fsm_transition / artifact_created / artifact_updated / negotiation_ticket_created / negotiation_ticket_resolved / worker_spawned / worker_terminated / dag_node_status_change`

### 16.2 EventStoreSubscriber — 自动持久化

- **文件**: `packages/core/event/EventStoreSubscriber.ts`
- **导出**: `EventStoreSubscriber`

订阅 `fsm.transition` + `tool.state_change` → 自动写入 EventStore JSONL

### 16.3 MemoryBusListener — 事件驱动记忆归档

- **文件**: `packages/core/memory/MemoryBusListener.ts`
- **导出**: `MemoryBusListener`

订阅 `agent.reflection_created / artifact.updated / agent.end` → VectorStore.upsert()

---

## 17. 三级分封安全体系

```
Ring 0 · Leader (ExecutionOrchestrator + CrossDomainRouter)
  ├── 唯一入口: ExecutionOrchestrator.orchestrate(userInput)
  ├── 工具: AgentCreateTool · TeamSayTool
  └── 红线: 禁止直接操作底层工具 (Bash/Write/file)
        │
        ▼ AgentCreate(domain, goal, vfsMountUri)
Ring 1 · Expert (DomainCluster.spawnSubAgent → AgentFactory → AgentHarness)
  ├── 唯一入口: AgentFactory.spawn(context) — 强制 identityToken + cgroupQuota
  ├── 工具: ForkExecuteTool · ReadArtifactTool · TeamSayTool
  └── 红线: 禁止 AgentCreate / 禁止主线程执行物理操作
        │
        ▼ ForkExecute(script_type, payload)
Ring 2 · Fork (ToolExecutionProxy → worker_threads)
  ├── 无提示词 (纯代码执行器)
  ├── 生命周期: 创建 → 执行 → 终止 (短命、无状态)
  └── 防御: timeout 120s / OOM 512MB / 降级重试一次
```

### 17.1 PermissionEngine

- **文件**: `packages/core/permission/PermissionEngine.ts`
- **导出**: `PermissionEngine`, `PermissionMode`

5 种模式: `default | explore | accept_edits | bypass | dont_ask`

### 17.2 ToolExecutionProxy

- **文件**: `packages/core/tool/ToolExecutionProxy.ts`
- **导出**: `ToolExecutionProxy`

Worker 隔离执行 + 超时/OOM 自动 terminate

---

## 18. 提示词系统

| 层级 | 角色 | 模板文件 | 约束 |
|:--|:--|:--|:--|
| Ring 0 | Leader | `prompts/leader-prompt.ts` | 禁止直接操作底层工具 |
| Ring 1 | Expert | `prompts/expert-prompt.ts` | 惰性灌水 + ForkExecute + 脏日志阻断 |
| Ring 2 | Fork | 无提示词 | 纯代码执行器 |
| S1 | Intent Analysis | `planning/prompts.config.ts` ★ | 目标状态矩阵 + 约束提取 |
| S3 | Candidate Gen | `planning/prompts.config.ts` ★ | 三策略对比注意力合成 |

---

## 19. 工具系统

| 工具 | 文件 | 说明 |
|:--|:--|:--|
| `AgentCreateTool` | `tool/AgentCreateTool.ts` | Leader → Expert 派生 |
| `ForkExecuteTool` | `tool/ForkExecuteTool.ts` | Expert → Fork 隔离执行 |
| `TeamSayTool` | `tool/TeamSayTool.ts` | harness.steer() 跨域通信 |
| `ReadArtifactTool` | `tool/ReadArtifactTool.ts` | 惰性 VFS 按 section 读取 |
| `write_file` | `tools/builtin-tools.ts` | 写入/覆盖文件 |
| `read_file` | `tools/builtin-tools.ts` | 读取文件内容 |
| ~~`exec_command`~~ | ❌ 已移除 | v2.4 安全约束 |

---

## 20. 协商系统 + 事务隔离

### 20.1 NegotiationEngine

- **文件**: `packages/core/negotiation/NegotiationEngine.ts`
- **导出**: `NegotiationEngine`

### 20.2 AsyncResourceLocker

- **文件**: `packages/core/utils/AsyncResourceLocker.ts`
- **导出**: `AsyncResourceLocker`

三层事务隔离:
- **L1**: AsyncResourceLocker (内存异步互斥锁)
- **L2**: ArtifactRegistry expectedVersion (乐观锁)
- **L3**: NegotiationEngine (协商锁, LLM 仲裁)

---

## 21. 管道可观测性（★ 新增）

> 文件: `packages/core/kernel-extensions/planning/PipelineLogger.ts`

### 21.1 设计原则 (可观测性驱动)

每个管道阶段 MUST 产生可见 trace。开发者 MUST 能在终端中看到:
- 每个阶段输出了什么
- 哪个 profile 被淘汰及原因
- 分数构成 (6 维度柱状图)
- 最终胜者选择

### 21.2 输出示例

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Stage 1: Intent Analysis
 ✓ Status: COMPLETED  Duration: 12ms

 Tags:    ai_ml(regex,0.70), devops(regex,0.70), build(regex,0.70)
 Confidence: 0.850
 Explicit Constraints: (none)
 Implicit Constraints: Model artifact integrity verification required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Stage 5: Plan Evaluation (MCDA)
 ✓ Status: COMPLETED  Duration: 3ms

 Weights: stability=0.20 | latency=0.20 | security=0.15 | alignment=0.15 | healing=0.15 | knowledge=0.15
 Winner:  DEFENSIVE (score: 0.6325)
   AGGRESSIVE   composite: 0.5812
   🏆 DEFENSIVE composite: 0.6325
      stability   ████████████████████░ 0.857
      latency     ████████████░░░░░░░░ 0.531
      security    ████████████████████░ 0.500
   FALLBACK     composite: 0.5233
 Elimination Insights:
   aggressive: weak in security=0.500, healing=0.333
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 22. 红队故障注入（★ 新增）

> 文件: `packages/core/kernel-extensions/planning/__tests__/FaultInjector.ts`

### 22.1 设计原则 (断裂点红队注入测试)

执行流启动 100ms 后，强行向 MemoryBus 同步发射 `SELF_HEALING_FAILED` 伪事件，验证:

```
内核挂起 → Meta 层瞬间滚完 7 步管道 → 内存中执行 hotPatch → 工作流无缝恢复
```

目标: 50ms 内完成完整闭环。

### 22.2 使用方式

```typescript
import { FaultInjector, createFaultInjectionTest } from './FaultInjector.js';

const injector = new FaultInjector(memoryBus, { sessionId, executionId });
injector.subscribeToEvents();
await injector.injectSelfHealingFailed({ failedNodeId: 'node_2' });
const result = await injector.verifyReflexLoop({ expectedPatchDurationMs: 50 });

// result.withinTarget → true/false (是否在 50ms 内完成)
// result.patchApplied → true/false (是否应用了热修补)
// result.eventTrace → 完整事件时间线
```

---

## 23. 强制收敛唯一路径

| 能力 | 唯一入口 | 校验/约束 | 删除的旧路径 |
|:--|:--|:--|:--|
| **系统启动** | `bootstrapMorPexCore(runtime)` | 门面模式 | ~~`createKernel()`~~ |
| **Agent 创建** | `AgentFactory.spawn(context)` | `identityToken` + `cgroupQuota` 强校验 | ~~`AgentService.createHarness()`~~ |
| **任务编排** | `ExecutionOrchestrator.orchestrate()` | Router 只分析 → Dispatcher 只执行 | ~~WorkflowPlanner~~ |
| **规划智能** ★ | `MetaPlanner.wrapOrchestrate()` | 7-Stage Pipeline (确定性) | ~~pass-through wrapper~~ |
| **候选生成** ★ | `MetaPlanner.stage3CandidateGeneration()` | LLM JSON Schema + Zod + Fallback 模板 | 无 (新增) |
| **DES 模拟** ★ | `MetaPlanner.stage4PlanSimulation()` | 3× ShadowContext, 0-3 微重试 | 无 (新增) |
| **MCDA 评估** ★ | `MetaPlanner.stage5PlanEvaluation()` | 6 维加权, 风险偏好调节 | 无 (新增) |
| **运行时反射** ★ | `DynamicReflexEngine.onRuntimeEvent()` | 偏差 >3 → 全局熔断 | 无 (新增) |
| **DAG 热修补** ★ | `DAGEngine.hotPatch(sessionId, patch)` | 只对 pending/ready 节点操作 | 无 (新增) |
| **路由+拆解** | `CrossDomainRouter.dispatch()` | Single-Shot LLM, 失败直接 throw | ~~`decompose()` / `buildDAG()`~~ |
| **FSM 调度** | `feed()` → `_check_next_action(event)` | 无 TRANSITIONS 表, 无降级 | ~~TRANSITIONS 表~~ |
| **bash 执行** | `ForkExecuteTool` → `ToolExecutionProxy` | Worker 隔离, 全局无 `exec_command` | ~~`exec_command`~~ |
| **状态持久化** | `EventBus.emit('fsm.transition')` → `EventStoreSubscriber` | EventBus 中介完全解耦 | ~~FSMEngine 直接写 EventStore~~ |
| **记忆归档** | `MemoryBusListener` → `VectorStore.upsert()` | 异步非阻塞 | ~~手动 `remember()`~~ |
| **事务隔离** | `AsyncResourceLocker.withLock()` + expectedVersion + NegotiationEngine | L1+L2+L3 三层隔离 | 无 (新增能力) |
| **管道观测** ★ | `PipelineLogger.logStage()` + `logPipelineTrace()` | 彩色终端 + JSONL | 无 (新增) |
| **会话错误提取** ★ | `SessionErrorExtractor.extractSessionErrors()` | 实时会话错误 + 因果链 + 根因 | 无 (新增) |
| **层次规划** ★ | `HierarchicalPlanningEngine.generateAllCandidates()` | 策略×变异 = 6-15候选 | ~~3-profile~~ |
| **零Token拓扑探索** ★ | `TopologyExplorer.exploreAndOptimize()` | DES模拟排列 → 预测最优 | 无 (新增) |
| **自主学习回路** ★ | `PlanningIntelligenceEngine.executeAndLearn()` | 执行→分析→学习→适应 | 无 (新增) |
| **思考拦截** ★ | `ThoughtInterceptor.createStreamInterceptor()` | 实时Token扫描 → abort+steer | 无 (新增) |
| **行动拦截** ★ | `ActionInterceptor.checkBeforeExecution()` | 工具调用前安全检查 | 无 (新增) |
| **观测桥接** ★ | `ObservationCorrectionBridge.processObservation()` | 错误→correction记忆闭环 | 无 (新增) |
| **统一网关拦截** ★ | `AgentReasoningInterceptor.wrap()` | Thought+Action+Observation三合一 | 无 (新增) |
| **工具质量管理** ★ | `ToolQualityManager.recordToolCall()` | 滑动窗口退化检测 + 自动修复 | 无 (新增) |
| **模板演化** ★ | `TemplateEvolutionEngine.captureFromExecution()` | CAPTURED/DERIVED/FIXED + Lineage | 替换 `extractTemplate()` |
| **模板文件系统** ★ | `TemplateFileSystem.exportTemplate()` | TEMPLATE.md + lineage.json 双向同步 | 无 (新增) |
| **执行录制回放** ★ | `ExecutionRecordingEngine.startRecording()` | Thought/Action/Observation/DAG 四维录制 | 无 (新增) |

---

## 29. 新增模块速查

### ToolQualityManager — 逐工具质量追踪 + 退化检测 ★ v3.0
- **文件**: `packages/core/kernel-extensions/planning/ToolQualityManager.ts` (486 行)
- **定位**: 每个 DAG 节点执行后由 DomainDispatcher 调用 `recordToolCall()`
- **退化检测**: 滑动窗口 20 次，`recentRate < historicalRate × 0.7` → 触发退化告警
- **自动修复**: `onDegradationDetected` 回调 → `TemplateEvolutionEngine.fixTemplate()` 闭环
- **Action 层集成**: `AgentReasoningInterceptor.checkAction()` Tier 2.5 退化拦截

### TemplateEvolutionEngine — 三种演化模式 + Lineage 追踪 ★ v3.0
- **文件**: `packages/core/kernel-extensions/planning/TemplateEvolutionEngine.ts` (630 行)
- **CAPTURED**: 从成功执行中捕获新模板 (评分 ≥0.7, 去重相似度 >80%)
- **DERIVED**: 从父模板派生变体 (最大 5 个派生/模板)
- **FIXED**: 6 种错误分类启发式修复 (token_exhaustion/timeout/validation_failure/dependency_missing/tool_error/mcp_crash)
- **Lineage**: `recordLineage()` + `getLineage()` + `getAncestors()` 完整演化链

### TemplateFileSystem — 模板文件系统化 ★ v3.0
- **文件**: `packages/core/kernel-extensions/planning/TemplateFileSystem.ts` (645 行)
- **格式**: `TEMPLATE.md` (YAML frontmatter + DAG 骨架表) + `lineage.json` + `stats.json` + `.skill_id`
- **操作**: `exportTemplate()` / `loadTemplate()` / `syncAll()` / `diffTemplates()`
- **双向同步**: 与 `PlanExperienceStore` 双向同步，`TemplateEvolutionEngine` 演化后自动导出

### ExecutionRecordingEngine — 四维录制回放 ★ v3.0
- **文件**: `packages/core/mirror/ExecutionRecordingEngine.ts` (586 行)
- **四维录制**: Thought (思考流) / Action (工具调用) / Observation (结果观测) / DAGSnapshot (拓扑快照)
- **集成**: `ExecutionGateway.execute()` 包装 `startRecording()` / `stopRecording()`
- **能力**: `replayActions()` 回放 + `extractTemplateFromRecording()` 模板提取 + `findRecordingsBySession()` 查询

### AgentReasoningInterceptor — 统一三层拦截网关
- **文件**: `packages/core/gateway/AgentReasoningInterceptor.ts` (947 行)
- **定位**: ExecutionGateway 内部中间件，所有 adapter.execute() 的唯一拦截点
- **三层**: Thought (流扫描) + Action (工具阻断) + Observation (错误提取闭环)
- **特点**: 一个类、一套 config、一份 stats，对所有 Agent 类型 (Coder/Tester/Researcher) 统一生效

### SessionErrorExtractor — 会话错误提取管道
- **文件**: `packages/core/kernel-extensions/planning/SessionErrorExtractor.ts`
- **能力**: 实时捕获错误 → 富化上下文 → 因果链关联 → 根因分类 → 预防建议
- **输出**: `SessionErrorReport` (summary + chains + rootCauses + recommendations)

### HierarchicalPlanningEngine — 层次规划引擎
- **文件**: `packages/core/kernel-extensions/planning/extensions/HierarchicalPlanningEngine.ts`
- **两级生成**: 第一层 Strategy (3-5 策略) × 第二层 Mutation (2-3 变异) = 6-15 候选
- **统计模拟**: 不用 Agent 执行，纯统计评分 (历史成功率 + 复杂度 + 能力匹配 + 失败模式 + 资源估算)
- **加权评估**: 0.30/0.20/0.15/0.15/0.10/0.10

### TopologyExplorer — 零 Token 拓扑探索器
- **文件**: `packages/core/kernel-extensions/planning/extensions/TopologyExplorer.ts`
- **原理**: 生成 DAG 拓扑排列 → DES 模拟每个 → 预测最优排序 → 只执行胜者
- **约束**: 最大 24 排列、最大 7 节点、改进 >5% 才替换

### PlanningIntelligenceEngine — 自主学习回路
- **文件**: `packages/core/kernel-extensions/planning/PlanningIntelligenceEngine.ts`
- **七阶段回路**: Plan → Execute → Record → Analyze → Learn → Adapt → Evolve
- **自适应**: Gap 分析 → 自动调权重 → 波动率校准 → 模板进化

### ThoughtInterceptor — 思考流拦截器
- **文件**: `packages/core/kernel-extensions/planning/extensions/ThoughtInterceptor.ts`
- **原理**: 句子级缓冲 → MemoryBus correction 查询 → >0.92 阈值 → abort() + steer()
- **pi 原生**: 使用 pi-agent-core 的 `abort()` + `steer()` + `streamFn`

---

## 30. 全部测试汇总

| 脚本 | 测试数 | 覆盖维度 |
|:--|:--:|:--|
| `test-full-pipeline.ts` | 59 | VectorStore / KG / ArtifactRegistry / 7-Stage / DAG / FSM / DeviationGuard / Reflex / PipelineLogger |
| `test-cross-domain-agents.ts` | 32 | 跨领域 + 三段Agent + Meta智能 + SecurityBoundary |
| `test-multi-round.ts` | 30 tasks | 10并发 × 3轮 (BASELINE/ADVERSARIAL/STRESS) |
| `test-hierarchical-planning.ts` | 39 | 层次策略生成 + 统计模拟 + 加权评估 |
| `test-topology-explorer.ts` | 18 | 拓扑排列生成 + DES模拟对比 + 零Token验证 |
| `test-topology-optimizer.ts` | 18 | 历史拓扑变体对比 + reorder建议 |
| `test-autonomous-engine.ts` | 19 | 自主学习回路 + Gap分析 + 权重自调 |
| `test-session-error-extractor.ts` | 51 | 错误捕获 + 富化 + 因果链 + 根因 + 报告 |
| `test-thought-interceptor.ts` | 30 | Token扫描 + 熔断 + 阈值 + 注入 + 统计 |
| `test-three-layer-interception.ts` | 15 | Action拦截 + Observation桥接 + 闭环验证 |
| **总计** | **311+** | **全部通过，零回归** |

---

*此文档覆盖 `packages/core/` + `packages/memory/` 全部源文件。v3.0 新增: ToolQualityManager, TemplateEvolutionEngine, TemplateFileSystem, ExecutionRecordingEngine (OpenSpace Fusion 4 Phase 全交付)。v2.6 新增: AgentReasoningInterceptor (统一三层拦截网关), SessionErrorExtractor, HierarchicalPlanningEngine, TopologyExplorer, PlanningIntelligenceEngine, ThoughtInterceptor。所有旧代码、降级路径、向后兼容层已完全清除。*
