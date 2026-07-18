# MorPex v3.1 — 后端全功能手册与架构流程

> **版本**: 3.1.0 | **日期**: 2026-07-12 | **覆盖**: 57 个 API 端点 + 27 个引擎模块

---

## 目录

- [一、功能全景图](#一功能全景图)
- [二、57 个 REST API 端点总览](#二57-个-rest-api-端点总览)
- [三、引擎模块清单（按平面分层）](#三引擎模块清单按平面分层)
- [四、全链路架构流程图](#四全链路架构流程图)
- [五、关键数据结构速查](#五关键数据结构速查)

---

## 一、功能全景图

```
用户 HTTP 请求 (REST + SSE)
         │
    ┌────▼─────────────────────────────────────────────┐
    │              StudioServer (Express :8080)          │
    │  57 个 API 端点  │  2 路 SSE  │  引擎初始化       │
    └────┬─────────────────────────────────────────────┘
         │
    ┌────▼─────────────────────────────────────────────┐
    │                  MorPexCore Kernel                │
    │                                                   │
    │  ┌─────────┐ ┌──────────┐ ┌──────────┐           │
    │  │ Control │ │ Runtime  │ │ Agent    │           │
    │  │ Plane   │ │ Kernel   │ │ Plane    │           │
    │  │         │ │          │ │          │           │
    │  │ 意图解析│ │ 状态机   │ │ Agent    │           │
    │  │ 任务规划│ │ DAG 执行 │ │ 编排调度 │           │
    │  │ 产物蓝图│ │ 优先级   │ │ 群集拍卖 │           │
    │  └─────────┘ │ 调度     │ └──────────┘           │
    │              └──────────┘                         │
    │  ┌──────────────┐ ┌──────────────────────┐       │
    │  │ Knowledge    │ │ CrossDomain          │       │
    │  │ Plane        │ │ (跨领域协同)          │       │
    │  │              │ │                      │       │
    │  │ MemoryBus v2 │ │ CrossDomainRouter    │       │
    │  │ Knowledge    │ │ DomainClusterManager │       │
    │  │ Graph        │ │ NegotiationEngine    │       │
    │  │ Artifact     │ │ DomainDispatcher     │       │
    │  │ Registry     │ │ ArbitrationHandler   │       │
    │  │ VectorStore  │ │                      │       │
    │  └──────────────┘ └──────────────────────┘       │
    │                                                   │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │
    │  │ EventBus │ │ Mirror   │ │ Gateway  │          │
    │  │ (领域    │ │ (观察者  │ │ (薄桥→   │          │
    │  │  作用域) │ │  记录)   │ │  PiAdapter│          │
    │  └──────────┘ └──────────┘ └──────────┘          │
    └──────────────────────────────────────────────────┘
         │                    │
    ┌────▼────┐          ┌────▼────────────┐
    │ Memory  │          │ AI 推理引擎 (pi) │
    │ System  │          │ pi-ai +         │
    │ v2      │          │ pi-agent-core   │
    │         │          │ → DeepSeek API  │
    │ ZVec    │          └─────────────────┘
    │ JSONL   │
    └─────────┘
```

---

## 二、57 个 REST API 端点总览

### 2.1 系统状态 (4)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 1 | GET | `/api/status` | 内核状态：phase、uptime、plugin 数量 |
| 2 | GET | `/api/health` | 健康检查：内核就绪、插件列表 |
| 3 | GET | `/api/engine/check` | 引擎诊断：Mirror 统计、Gateway 适配器、事件类型列表 |
| 4 | GET | `/api/config` | 读取配置：版本、引擎类型、thinkingLevel、模型名 |

### 2.2 Chat 对话 (6)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 5 | POST | `/api/chat/send` | **★ 主对话端点** — 意图解析 → 规划 → 多任务执行 → 产物生成 |
| 6 | POST | `/api/chat/agent-send` | AgentHarness 对话（pi-agent-core 原生通道） |
| 7 | GET | `/api/chat/agent-status` | AgentService 状态：活跃 Zone、模型 ID |
| 8 | GET | `/api/chat/load` | 加载全部会话列表 |
| 9 | POST | `/api/chat/save` | 保存会话（兼容） |
| 10 | POST | `/api/chat/cross-domain` | **跨领域对话** — LLM 拆解 → DAG → 多领域分发执行 |

### 2.3 Session 会话管理 (6)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 11 | GET | `/api/sessions` | 列出全部会话（含摘要名） |
| 12 | POST | `/api/sessions` | 创建新会话 |
| 13 | GET | `/api/sessions/:id/messages` | 获取指定会话的消息历史 |
| 14 | DELETE | `/api/sessions/:id` | 删除会话 |
| 15 | POST | `/api/ai/new-session` | 创建 AI 会话（兼容旧 API） |
| 16 | POST | `/api/ai/abort` | 中止全部执行 |

### 2.4 Cycle 周期执行 (7)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 17 | POST | `/api/cycle/run` | **周期执行** — CEO→PM→Worker 团队、4 任务流水线、LLM 调用、产出入库 |
| 18 | POST | `/api/cycle/scan` | 市场扫描 — 返回 5 个趋势分析 |
| 19 | POST | `/api/cycle/design` | 产品设计 — 生成产品方案 |
| 20 | POST | `/api/cycle/evaluate` | 产品评估 — 打分 + 反馈 |
| 21 | GET | `/api/cycle/history` | 查询周期执行历史 |
| 22 | GET | `/api/history` | **统一历史** — 聚合 4 路存储（HistoryStore + Mirror + MemoryBus + KG） |
| 23 | GET | `/api/history/:executionId` | 按 executionId 聚合查询 4 路存储 |

### 2.5 Memory 记忆系统 (14)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 24 | GET | `/api/memory/stats` | 内存记忆统计（兼容旧 API） |
| 25 | GET | `/api/memory/search` | 记忆搜索（向量 + 关键词） |
| 26 | POST | `/api/memory/write` | 写入单条记忆 |
| 27 | POST | `/api/memory/write-many` | 批量写入记忆 |
| 28 | POST | `/api/memory/feedback` | 记忆反馈 — 权重调整 |
| 29 | POST | `/api/memory/stage-complete` | 阶段完成标记 |
| 30 | POST | `/api/memory/plan-stages` | 规划记忆阶段 |
| 31 | POST | `/api/memory/audit` | 记忆审计 — 过期/垃圾清理 |
| 32 | POST | `/api/memory/intercept` | 用户输入拦截 — 记忆上下文注入 |
| 33 | POST | `/api/memory/compact` | 记忆压缩 — 长短期记忆整理 |
| 34 | GET | `/api/memory/summary-chain` | 摘要链查询 |
| 35 | GET | `/api/memory/temp-pool` | 临时池查询 — Main/Archive/Temp 三池状态 |
| 36 | GET | `/api/memory-bus/stats` | **MemoryBus v2 统计** — 索引/归档/纠错/阶段数量 |
| 37 | POST | `/api/memory-bus/remember` | **MemoryBus v2 写入** — 三维一体记忆（语义+向量+图谱） |

### 2.6 Knowledge 知识图谱 (8)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 38 | POST | `/api/knowledge/entity` | 添加实体 |
| 39 | POST | `/api/knowledge/relation` | 添加关系 |
| 40 | POST | `/api/knowledge/import-skills` | 从 skills 目录导入 |
| 41 | POST | `/api/knowledge/import-memory` | 从 MemoryBus 导入 |
| 42 | GET | `/api/knowledge-graph/data` | 获取全量图谱数据 |
| 43 | GET | `/api/knowledge/neighborhood` | 实体邻域查询（指定深度） |
| 44 | GET | `/api/knowledge/path` | 实体间路径查询 |
| 45 | GET | `/api/knowledge/search` | 知识搜索（类型过滤） |

### 2.6b MemoryBus v2 专用 (3)

| #   | 方法   | 路径                        | 功能                                  |
| --- | ---- | ------------------------- | ----------------------------------- |
| 46  | GET  | `/api/memory-bus/recall`  | 记忆召回（hybrid-rag / vector / keyword） |
| 47  | POST | `/api/memory-bus/forget`  | 遗忘指定记忆                              |
| 48  | POST | `/api/memory-bus/improve` | 记忆增强反馈                              |

### 2.7 跨领域 Domains (6)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 49 | GET | `/api/domains` | 列出全部已注册领域（domain_id、skills、artifacts、状态） |
| 50 | POST | `/api/domains/reload` | 热加载领域清单 — 重新扫描 data/domains/*.json |
| 51 | GET | `/api/domains/:domainId/status` | 查询指定领域的清单 + 运行时状态 |
| 52 | GET | `/api/domains/events` | 获取跨领域事件类型列表 |
| 53 | GET | `/api/artifacts` | 查询产物列表（按 executionId 过滤或全部） |
| 54 | POST | `/api/execute` | 直接调用 Execution Gateway 执行 |

### 2.8 Agent/Worker/Observability (6)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| 55 | GET | `/api/orchestrator/status` | Orchestrator 状态 |
| 56 | GET | `/api/orchestrator/agents` | 全部 Agent 列表 |
| 57 | GET | `/api/observability/workers` | Worker 状态（id/role/state/specialty） |

### 2.9 辅助 (6)

| #   | 方法   | 路径                           | 功能                |
| --- | ---- | ---------------------------- | ----------------- |
| —   | GET  | `/api/business-units`        | 业务单元结构            |
| —   | GET  | `/api/departments`           | 部门 + Agent 结构     |
| —   | GET  | `/api/agents`                | 全部 Agent 详情       |
| —   | GET  | `/api/prompt`                | 快速 LLM 对话         |
| —   | GET  | `/api/dag/history`           | DAG 执行历史          |
| —   | GET  | `/api/reports`               | 报告列表              |
| —   | GET  | `/api/search/*`              | 搜索统计/缓存/查询        |
| —   | GET  | `/api/observability/traces`  | Mirror 追踪数据       |
| —   | GET  | `/api/observability/metrics` | 可观测性指标            |
| —   | POST | `/api/tasks/run`             | 单任务执行 + 记忆存储      |
| —   | GET  | `/api/v6/startup-state`      | 兼容旧版 StartupState |
| —   | GET  | `/api/ai/status`             | AI 引擎状态           |
| —   | PUT  | `/api/config`                | 更新配置              |

### 2.10 SSE 实时流 (2)

| # | 方法 | 路径 | 功能 |
|---|------|------|------|
| — | GET | `/api/stream/global` | **全局 SSE 流** — EventBus 所有事件实时推送，15s 心跳 |
| — | GET | `/api/stream/execution/:executionId` | 按 executionId 过滤的 SSE 流 |

---

## 三、引擎模块清单（按平面分层）

### 3.1 Control Plane（控制面）— 意图理解 + 任务规划

| 模块                    | 文件                                                  | 职责                                                                                            |
| --------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **IntentResolver**    | `planes/control-plane/intent/IntentResolver.ts`     | 调用 LLM 进行意图分类（directive/query/ambiguous/chat），输出置信度和领域标签。`<0.6` 拒绝，`0.6-0.85` 澄清，`≥0.85` 直接执行 |
| **WorkflowPlanner**   | `planes/control-plane/planner/WorkflowPlanner.ts`   | 将 IntentResult 转为 Plan（任务列表 + 产物蓝图 + 依赖关系）。调用 LLM 生成结构化 JSON，两阶段 ID 映射确保引用正确                  |
| **ArtifactBlueprint** | `planes/control-plane/planner/ArtifactBlueprint.ts` | 产物蓝图工厂函数 + 依赖验证 + 拓扑排序 + 12 种模板（软件/视频/通用）                                                     |
| **IntentPlugin**      | `planes/control-plane/intent/plugin.ts`             | EventBus 插件，监听 `intent.input` 事件触发意图解析                                                        |
| **PlannerPlugin**     | `planes/control-plane/planner/plugin.ts`            | EventBus 插件，监听 `plan.request` 事件触发规划                                                          |

### 3.2 Runtime Kernel（运行时内核）— 执行调度 + 状态管理

| 模块                  | 文件                                                        | 职责                                                                                                                                        |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **FSMEngine**       | `planes/runtime-kernel/fsm/FSMEngine.ts`                  | 10 状态有限状态机（IDLE→PLANNING→RUNNING→WAITING_TOOL/USER→VERIFYING→INTERROGATING→COMPLETED/FAILED/CANCELLED），pi-agent-core AgentHarness 集成，阶段驱动 |
| **DAGEngine**       | `planes/runtime-kernel/dag/DAGEngine.ts`                  | 有向无环图执行引擎：构建/验证/拓扑排序/执行。支持 retry + reroute + 变更历史 + 不可变快照                                                                                 |
| **SchedulerEngine** | `planes/runtime-kernel/scheduler/SchedulerEngine.ts`      | 优先级调度器：ROI×0.5 + Cost×0.2 + Latency×0.3 综合评分。并发控制 + 背压检测（80% 阈值）                                                                          |
| **ExecutionGraph**  | `planes/runtime-kernel/execution-graph/ExecutionGraph.ts` | 执行图追踪引擎：节点创建/状态变更/完成                                                                                                                      |

### 3.3 Agent Plane（Agent 平面）— 智能体编排

| 模块 | 文件 | 职责 |
|------|------|------|
| **AgentOrchestrator** | `planes/agent-plane/orchestrator/AgentOrchestrator.ts` | Agent 生命周期编排：createCEO/createManager/createDefaultWorkers/assignTask/completeTask |
| **AgentService** | `services/AgentService.ts` | AgentHarness 创建与管理：按 Zone（chat/code/research）创建隔离的 AgentHarness 实例 |
| **SwarmEngine** | `planes/agent-plane/swarm/SwarmEngine.ts` | 多 Agent 拍卖机制：创建拍卖/投标/决策 |

### 3.4 Knowledge Plane（知识平面）— 记忆 + 图谱 + 产物

| 模块 | 文件 | 职责 |
|------|------|------|
| **MemoryBus v2** | `memory/src/core/MemoryBus.ts` | **三维一体记忆总线**：remember/recall/forget/feedback。Main Pool（竞争）/Archive（归档）/Temp Pool（临时）三池架构。ECL 流水线抽取实体/关系 |
| **WriteGate** | `memory/src/core/WriteGate.ts` | 写闸门：评分过滤低质量记忆。阈值可配置 |
| **ECLCognifyEngine** | `memory/src/core/ECLCognifyEngine.ts` | ECL 抽取流水线：实体识别 + 关系抽取 |
| **UserProfileEngine** | `memory/src/core/UserProfileEngine.ts` | 用户画像：增量抽取/置信度管理 |
| **ChatMemoryExtractor** | `memory/src/core/ChatMemoryExtractor.ts` | 聊天记忆自动提取 |
| **KnowledgeGraph** | `planes/knowledge-plane/knowledge/KnowledgeGraph.ts` | 知识图谱：实体 CRUD + 关系管理 + 邻域查询 + 路径查找。JSONL 持久化 |
| **ArtifactRegistry** | `planes/knowledge-plane/artifacts/ArtifactRegistry.ts` | **产物唯一入口**：register/update/get/search。不可变版本快照 + 2s 防抖自动刷盘。支持 URI 解析（artifact://domain/type/id） |
| **VectorStore** | `planes/knowledge-plane/memory/VectorStore.ts` | ZVector 向量存储：index/search/delete。BGE-M3 1024 维。锁恢复 + 优雅关闭 |

### 3.5 CrossDomain（跨领域协同）— Phase 8-14

| 模块 | 文件 | 职责 |
|------|------|------|
| **CrossDomainRouter** | `router/CrossDomainRouter.ts` | LLM 拆解复合意图为跨领域 DAG。extractJson + topologicalSort 统一工具 |
| **DomainClusterManager** | `domains/DomainClusterManager.ts` | 领域集群管理器：注册/唤醒/休眠/执行。LRU 自动休眠 + LLM/关键词双路意图匹配 |
| **DomainDispatcher** | `router/DomainDispatcher.ts` | DAG 执行分发器：按拓扑顺序逐领域分发任务。v3.x 新增 per-domain 锁（同领域串行，跨领域并行） |
| **NegotiationEngine** | `negotiation/NegotiationEngine.ts` | 智能体协商协议：InterrogationTicket 结构化质询 + 反驳升级 + 全局限流 |
| **ArbitrationHandler** | `router/ArbitrationHandler.ts` | 仲裁处理器：跨领域冲突裁决 |
| **DomainManifestLoader** | `domains/DomainManifestLoader.ts` | 领域清单加载：从 JSON 文件读取 DomainManifest，支持热加载 |

### 3.6 Core Infrastructure（核心基础设施）

| 模块 | 文件 | 职责 |
|------|------|------|
| **Kernel** | `core/Kernel.ts` | 生命周期管理：start/stop/registerPiRuntime/registerPlugin。DI 容器 |
| **EventBus** | `core/EventBus.ts` | 唯一通信通道：emit/on/once/off。通配符 + 领域作用域 + 跨领域广播 + 历史追溯 |
| **ExecutionIdentity** | `core/ExecutionIdentity.ts` | 全链路 ID 生成：executionId/traceId/sessionId/eventId/artifactId。uuidv7 时间有序。父子链追踪 |

### 3.7 Kernel Extensions（内核扩展层 v3.1）— 非侵入式升级

| 模块 | 文件 | 职责 |
|------|------|------|
| **ExtensionRegistry** | `extensions/ExtensionRegistry.ts` | 扩展注册中心：register / startAll / stopAll / getStatus |
| **LineageTracker** | `extensions/LineageTracker.ts` | 产物血缘追踪器：BFS 查询 upstream/downstream/both |
| **ContextPruner** | `extensions/ContextPruner.ts` | 上下文智能引擎：四阶段剪枝 + Token 预算控制 |
| **McpProcessGuard** | `extensions/McpProcessGuard.ts` | MCP 看门狗：心跳巡检 + 自愈重启 + 熔断保护 |
| **CheckpointManager** | `extensions/CheckpointManager.ts` | DAG 快照回滚：executeWithCheckpoints() HOC |

### 3.8 Planning Intelligence Layer（规划智能层 v3.1）

**编排器**

| 模块 | 文件 | 职责 |
|------|------|------|
| **MetaPlanner** | `extensions/planning/MetaPlanner.ts`（865 行） | 编排器：wrapOrchestrate、replanPipeline、扩展生命周期、事件桥接。7-Stage Pipeline 委派给 PipelineExecutor |
| **PipelineExecutor** | `extensions/planning/pipeline/PipelineExecutor.ts`（1975 行） | 7-Stage 管道执行器：S1 意图分析→S2 经验检索→S3 候选生成→S4 DES 模拟→S5 MCDA 评估→S6 决策追溯→S7 计划激活 |

**规划引擎**

| 模块 | 文件 | 职责 |
|------|------|------|
| **V1CapabilityAdapter** | `engines/V1CapabilityAdapter.ts` | v1 六项能力适配，onPrePlan/onPostPlan 扩展 |
| **StrategicDeconstructor** | `engines/StrategicDeconstructor.ts` | 执行前战略拆解 → 里程碑 |
| **LookAheadSimulator** | `engines/LookAheadSimulator.ts` | 前瞻模拟与风险拒绝 |
| **DynamicReflexEngine** | `engines/DynamicReflexEngine.ts` | 运行时反射重规划 → replanPipeline |
| **TopologyExplorer** | `engines/TopologyExplorer.ts` | 零 Token 拓扑探索（DAG 排列 → DES 模拟 → 预测最优） |
| **HierarchicalPlanningEngine** | `engines/HierarchicalPlanningEngine.ts` | 统计候选生成（策略×变异 = 6-15 候选，零 LLM Token）。S3 有历史数据时优先使用 |

**守卫**

| 模块 | 文件 | 职责 |
|------|------|------|
| **DeviationGuard** | `guards/DeviationGuard.ts` | 防无限规划死循环 + 熔断 |

**v3.0 OpenSpace Fusion**

| 模块 | 文件 | 职责 |
|------|------|------|
| **ToolQualityManager** | `extensions/planning/ToolQualityManager.ts` | 逐工具质量追踪 + 退化检测 + 自动修复 |
| **ask_user Tool** | `tools/ask-user-tool.ts` | 🆕 Agent 调用此工具向用户提问。执行挂起等待回复，通过 pi 核 `harness.steer()` 注入用户回应 |
| **save_artifact Tool** | `tools/artifact-registry-skill.ts` | Agent 调用此工具注册产物文件，推送到前端左侧栏 |
| **TemplateManager** | `extensions/planning/TemplateManager.ts` | 模板演化+文件系统（合并原 TemplateEvolutionEngine + TemplateFileSystem） |

**v2.6 自学习与观测**

| 模块 | 文件 | 职责 |
|------|------|------|
| **PlanningIntelligenceEngine** | `extensions/planning/PlanningIntelligenceEngine.ts` | 自主学习回路：Gap 分析 → 权重自调 → 模板演化 |
| **SessionErrorExtractor** | `extensions/planning/SessionErrorExtractor.ts` | 实时错误捕获 → 富化 → 因果链 → 根因报告 |
| **PipelineLogger** | `extensions/planning/PipelineLogger.ts` | 7-Stage 结构化 Trace 日志 |
| **PlanExperienceStore** | `extensions/planning/PlanExperienceStore.ts` | 计划经验持久化（JSONL） |
| **PlanAnalyzer** | `extensions/planning/PlanAnalyzer.ts` | 计划分析（评估+优化，合并原 PlanEvaluator + PlanOptimizer） |
| **RuntimeController** | `extensions/planning/RuntimeController.ts` | 运行时影子控制句柄 |

**录制与观测**

| 模块 | 文件 | 职责 |
|------|------|------|
| **ExecutionGateway** | `gateway/ExecutionGateway.ts` | 统一执行网关 + 录制引擎注入 |
| **AgentReasoningInterceptor** | `gateway/AgentReasoningInterceptor.ts` | 三层拦截（Thought/Action/Observation） |
| **ExecutionRecordingEngine** | `mirror/ExecutionRecordingEngine.ts` | 四维录制回放（Thought/Action/Observation/DAG） |
| **ExecutionMirror** | `mirror/ExecutionMirror.ts` | EventBus 被动录制 |

### 3.9 工具函数 (utils)

| 模块 | 文件 | 职责 |
|------|------|------|
| **extractJson** | `utils/extractJson.ts` | 逐字符括号匹配算法提取 LLM 响应中的 JSON。支持转义引号、代码块 |
| **topologicalSort** | `utils/toposort.ts` | Kahn 算法拓扑排序。去重依赖 + 环检测降级 |
| **readJSONLLines** | `utils/jsonl.ts` | JSONL 行解析，容错跳过损坏行 |

---

## 四、全链路架构流程图

### 4.1 主对话链路：`POST /api/chat/send`

```
用户消息: "帮我写一个 Python 爬虫"
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  StudioServer.handleChatSend()                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. 生成 executionId (ExecutionIdentity)                     │ │
│  │ 2. 加载会话历史 (JsonlSessionRepo)                          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬────────────────────────────────────┘
                              │
         ┌────────────────────▼─────────────────────┐
         │  IntentResolver.resolve(message)          │
         │  ┌─────────────────────────────────────┐  │
         │  │ → LLMProvider.get()(prompt)         │  │
         │  │ → DeepSeek API (completeSimple)     │  │
         │  │ → extractJson(raw)                  │  │
         │  │ → parseJsonWithRepair(jsonStr)      │  │
         │  │ → IntentResult {type, confidence,   │  │
         │  │      domain, goal}                  │  │
         │  └─────────────────────────────────────┘  │
         └────────────────┬─────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   confidence<0.6    chat/query     confidence≥0.85
   ┌──────────┐   ┌──────────┐   ┌──────────────┐
   │ 拒绝     │   │ 直聊回复 │   │ 进入规划执行 │
   │ rejected │   │ LLM 同步 │   │              │
   └──────────┘   └──────────┘   └──────┬───────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  WorkflowPlanner.plan()    │
                          │  ┌─────────────────────┐   │
                          │  │ → LLM 生成 Plan     │   │
                          │  │ → createBlueprint() │   │
                          │  │ → sortBlueprints()  │   │
                          │  │ → sortTasksTopo()   │   │
                          │  │ → Plan {tasks,      │   │
                          │  │      blueprints}    │   │
                          │  └─────────────────────┘   │
                          └─────────────┬─────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  DAG 执行循环              │
                          │  (Top-3 高优先任务)        │
                          │                           │
                          │  for each task:           │
                          │  ┌─────────────────────┐  │
                          │  │ 构建 Prompt         │  │
                          │  │ + 上游交接 handoff  │  │
                          │  │ + 下游交接指令      │  │
                          │  └──────┬──────────────┘  │
                          │         ▼                 │
                          │  ┌─────────────────────┐  │
                          │  │ LLM 调用            │  │
                          │  │ → taskResult        │  │
                          │  └──────┬──────────────┘  │
                          │         ▼                 │
                          │  ┌─────────────────────┐  │
                          │  │ 提取 handoff 段落   │  │
                          │  │ → accumulatedContext │  │
                          │  └──────┬──────────────┘  │
                          │         ▼                 │
                          │  ┌─────────────────────┐  │
                          │  │ classifyArtifact()  │  │
                          │  │ → LLM 判断文件类型  │  │
                          │  └──────┬──────────────┘  │
                          │         ▼                 │
                          │  ┌─────────────────────┐  │
                          │  │ 写入磁盘            │  │
                          │  │ → data/workspace/    │  │
                          │  │   projects/{execId}/ │  │
                          │  └──────┬──────────────┘  │
                          │         ▼                 │
                          │  ┌─────────────────────┐  │
                          │  │ ArtifactRegistry    │  │
                          │  │ .register()         │  │
                          │  │ → 版本快照          │  │
                          │  │ → 2s 防抖刷盘       │  │
                          │  └─────────────────────┘  │
                          └─────────────┬─────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  保存会话 + MemoryBus 记忆 │
                          │  ┌─────────────────────┐   │
                          │  │ Session.appendMsg() │   │
                          │  │ MemoryBus.remember()│   │
                          │  └─────────────────────┘   │
                          └─────────────┬─────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  返回 JSON:                │
                          │  { ok, output, plan,      │
                          │    artifacts, intent }    │
                          └───────────────────────────┘

全程伴随 EventBus 事件广播:
  intent.resolved → plan.generated → runtime.task.started
  → runtime.task.completed → artifact.created
  → runtime.execution.completed

双路消费:
  ExecutionMirror → JSONLStorage → disk
  SSE /api/stream/global → 前端 EventSource
```

### 4.2 跨领域链路：`POST /api/chat/cross-domain`

```
"设计硬件 + 商业计划"
        │
        ▼
CrossDomainRouter.decompose()
  ├── DomainClusterManager.getDomainContextText()
  │     → "hardware_engineering: 硬件工程\nbusiness_finance: 商业金融"
  ├── LLMProvider.get()(prompt) → DeepSeek
  ├── extractJson(raw) → JSON.parse
  └── → TaskDecomposition { tasks: [
        { domain:"hardware_engineering", goal:"设计硬件", deps:[] },
        { domain:"business_finance", goal:"商业计划", deps:["task_0"] }
      ]}
        │
        ▼
CrossDomainRouter.buildDAG(decomposition)
  └── topologicalSort(nodes, n=>n.deps, n=>n.taskId)
        │
        ▼
DomainDispatcher.executeDAG(dag, domainManager)
  ├── 按拓扑顺序逐个领域执行
  ├── DomainClusterManager.execute(domainId, goal)
  │     ├── DomainCluster.wake() → 激活领域集群
  │     └── AgentHarness.prompt(goal) → 真实 LLM 调用
  └── → 结果汇总
        │
        ▼
EventBus.broadcastCrossDomain(event)
  ├── 所有领域监听器收到 cross_domain.dag_created
  └── 全局监听器 + SSE 推送
```

### 4.3 Cycle 执行链路：`POST /api/cycle/run`

```
{ domain, trend, prompt }
        │
        ▼
FSMEngine.start(execId, goal)
  └── IDLE → PLANNING
        │
        ▼
Orchestrator 创建团队:
  CEO-AI + PM-AI + 4 Workers (researcher/planner/coder/reviewer)
        │
        ▼
4 任务流水线执行:
  task_1: 市场扫描 (researcher) → LLM 调用 → 输出
  task_2: 需求分析 (planner)   → LLM 调用 + 上游上下文 → 输出
  task_3: 架构设计 (coder)     → LLM 调用 + 上游交接 → 输出
  task_4: 评估报告 (reviewer)  → LLM 调用 + 全部上下文 → 输出
        │
        ├── 每个任务产出写入 data/workspace/projects/{execId}/
        ├── 每个任务产出写入 MemoryBus.remember()
        └── 上下文在任务间通过 accumulatedContext 传递
        │
        ▼
生成汇总 REPORT.md → 写入磁盘 + WorkspaceIndexer 索引
        │
        ▼
FSMEngine.feed('agent_end') → COMPLETED
HistoryStore.updateCycle() → 记录完成
```

### 4.4 MemoryBus v2 记忆数据流

```
memoryBus.remember({ content, source, tags, importance })
  │
  ├── 1. WriteGate.decide(content, importance)
  │      → score < threshold → 丢弃（写闸门过滤）
  │      → score ≥ threshold → 继续
  │
  ├── 2. ECLCognifyEngine 抽取
  │      → 实体识别: 人名/技术栈/项目名...
  │      → 关系抽取: 依赖/包含/前置...
  │
  ├── 3. 向量索引 (ZVecStorage)
  │      → EmbeddingClient.getEmbedding(content)
  │      → zvec.upsertSync({ id, vectors, fields })
  │
  ├── 4. 知识图谱 (KnowledgeGraph)
  │      → addEntity/updateEntity (抽取的实体)
  │      → addRelation (抽取的关系)
  │
  └── 5. JSONL 持久化
         → JSONLWriter.append(memoryEntry)
         → 500ms/50条 微批刷盘

recall({ text, topK, strategy })
  ├── strategy='hybrid-rag' (默认):
  │     ├── 向量搜索 (语义相似)
  │     ├── 关键词 BM25 (精确匹配)
  │     └── 图谱邻域扩展 (关系推理)
  │
  ├── strategy='vector': 纯向量搜索
  └── strategy='keyword': 纯关键词匹配

三池架构:
  Main Pool (竞争池) → 最新/高频记忆
  Archive (归档池)  → 沉淀后的稳定记忆
  Temp Pool (临时池) → 会话级临时上下文
```

### 4.5 EventBus 事件传播拓扑

```
EventBus.emit(event)
  │
  ├── 1. 验证: executionId 必填, type 格式检查
  ├── 2. 写入 history (FIFO 1000 条)
  │
  ├── 3. 精确匹配: listeners.get(event.type)
  │     └── 逐个 handler(event) + try-catch 隔离
  │
  ├── 4. 全局通配符: listeners.get('*')
  │     └── 所有事件触发
  │
  ├── 5. 命名空间通配符: listeners.get('runtime.*')
  │     └── 匹配 'runtime.tool.called', 'runtime.task.started' 等
  │
  └── 6. 一次性监听: onceListeners.get(event.type)
        └── 触发后自动删除

领域作用域:
  emitToDomain('hardware_engineering', event)
    └── 仅 onDomain('hardware_engineering', ...) 的监听器收到

  broadcastCrossDomain(event)
    ├── 全局 emit(event)
    └── 所有领域的 onDomain(domainId, type) 监听器
```

---

## 五、关键数据结构速查

### 5.1 MorPexEvent（事件协议）

```typescript
interface MorPexEvent {
  id: string;            // "evt_20260710_a81f92cd"
  type: string;          // "runtime.tool.called"
  timestamp: number;     // Unix 毫秒
  executionId: string;   // 必填，全链路追踪
  source: string;        // "gateway", "fsm", "studio"
  payload: any;          // 事件载荷
}
```

### 5.2 IntentResult（意图解析结果）

```typescript
interface IntentResult {
  rawInput: string;      // 用户原始输入
  type: 'directive' | 'query' | 'ambiguous' | 'chat';
  confidence: number;    // 0-1
  domain: 'software' | 'video' | 'ecommerce' | 'general';
  goal: string;          // 提炼后的目标
  entities?: Record<string, any>;
  metadata?: Record<string, any>;
}
```

### 5.3 Plan（规划结果）

```typescript
interface Plan {
  id: string;
  goal: string;
  blueprints: ArtifactBlueprint[];   // 产物蓝图
  tasks: Task[];                     // 任务列表
  status: 'draft' | 'confirmed' | 'executing' | 'done';
  riskLevel: 'low' | 'medium' | 'high';
  estimatedDuration: number;
  createdAt: number;
}
```

### 5.4 TaskDecomposition（跨领域拆解）

```typescript
interface TaskDecomposition {
  tasks: DecomposedTask[];
  reasoning: string;
}
interface DecomposedTask {
  id: string;
  domain: string;         // 目标领域 ID
  goal: string;           // 子任务目标
  deps: string[];         // 依赖的 taskId 列表
  expected_artifacts?: string[];
}
```

### 5.5 DAGNode（DAG 节点）

```typescript
interface DAGNode {
  taskId: string;
  domain: string;
  goal: string;
  deps: string[];
  status: 'pending' | 'running' | 'success' | 'failed' | 'rerouting' | 'skipped';
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}
```

### 5.6 ArtifactInstance（产物实例）

```typescript
interface ArtifactInstance {
  id: string;             // "art_20260710_..."
  name: string;
  type: 'code' | 'document' | 'config' | 'schema' | 'report' | 'plan' | 'structured_data';
  content: any;
  version: number;
  status: 'draft' | 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  metadata?: Record<string, any>;
}
```

### 5.7 事件域映射表

| 域 | 前缀 | 覆盖范围 |
|----|------|---------|
| kernel | `kernel.*` | 内核生命周期 |
| gateway | `gateway.*` | 适配器注册 |
| runtime | `runtime.*` | 执行/任务/Agent 运行 |
| fsm | `fsm.*` | 状态机转换 |
| dag | `dag.*` | DAG 构建/执行/死锁 |
| scheduler | `scheduler.*` | 任务调度/背压 |
| memory | `memory.*` | 记忆 CRUD/反馈/阶段 |
| knowledge | `knowledge.*` | 图谱实体/关系 |
| artifact | `artifact.*` | 产物创建/更新 |
| orchestrator | `orchestrator.*` | Agent 编排 |
| swarm | `swarm.*` | 多 Agent 拍卖 |
| intent | `intent.*` | 意图解析/澄清 |
| plan | `plan.*` | 工作流规划 |
| llm | `llm.*` | LLM 请求/响应/流式 |
| tool | `tool.*` | 工具调用 |
| cross_domain | `cross_domain.*` | 跨领域 DAG/产物流转 |

---

> **关联文档**:
> - 全局架构基准 → [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
> - 技术白皮书（测试矩阵+数据结构深度剖析）→ [`docs/whitepaper-morpex-core-v2.3.md`](whitepaper-morpex-core-v2.3.md)
> - Phase 3-4 审计报告 → [`docs/assessments/phase3-4-delivery.md`](assessments/phase3-4-delivery.md)
> - 可扩展性评估 → [`docs/assessments/phase4-extensibility-assessment.md`](assessments/phase4-extensibility-assessment.md)
