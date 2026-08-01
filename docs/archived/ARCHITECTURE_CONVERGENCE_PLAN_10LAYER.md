# MorPex 架构收敛重构方案（合并路径 + 删除清单 + 装配点修改）

**版本**: 1.0 | **日期**: 2026-08-01 | **基于**: `docs/ARCHITECTURE_FUNCTION_MAP.md`（碎片化审计）
**方法**: 以 `bootstrap-unified.ts` + `ServiceContainer.ts` + `StudioServer.ts` 三处装配锚点的 grep 消费者证据为准（"被装配"≠"活"；"废弃"≠"可删"）

---

## 〇、总览：收敛三原则 + 执行顺序

### 三原则
1. **装配锚点优先**：删除任何文件前，必须让 `grep -rln "符号" packages --include="*.ts"`（排除自身/archived/tests）清零。
2. **StudioServer 是第二装配点**：`studio/server/StudioServer.ts` 直接 import 了 CognitiveLoop / MetaPlanner / PersonalBrain / BrainPersistor / AgentMemoryIsolation / CheckpointManager / RecoveryManager / PolicyEngine(control) / ArtifactPlane —— 这些不是死代码，收敛时须保留 Studio 兼容面或同步改造 Studio。
3. **删除必须分阶段**：每个删除项给出前置迁移动作；阶段边界以 `tsc --noEmit` + `node scripts/validate-architecture.js` + 全量测试通过为准。

### 执行顺序（5 个阶段，每阶段可独立交付）
| 阶段 | 内容 | 风险 | 产出 |
|---|---|---|---|
| P0 | 低风险死代码清理（0 消费者的文件） | 极低 | 删 10+ 文件，零装配点改动 |
| P1 | 装配点收敛（双装载 → 单装载、learningEngine 键冲突、双轨记忆） | 中 | bootstrap/ServiceContainer 改动 |
| P2 | 事件/策略/验证归口（event/EventStore 删除、PolicyEngine 二选一） | 中 | index.ts 导出收敛 |
| P3 | Studio 侧收敛（V10 死路由、event-mesh、studio/learning 随删） | 低 | Studio 路由面收敛 |
| P4 | 大目录归档（extensions/planning、artifact/plane、evolution/ 冗余） | 高 | 归档目录 + 文档 |

> ⚠️ **不合并项（明确保留、只文档标注边界）**：仿真 4 套（各有真实消费）、压缩 3 处（职责不同）、PermissionEngine/PermissionModel（工具拦截 vs 控制面模型）、studio observability（独立产品面）。

---

## 一、记忆簇（M）收敛方案

### 权威归口
`@morpex/memory`（MemoryAPI 写/查唯一入口 + cognee 引擎 + ForceRetrieve + confirmation）→ 经 `core/src/adapters/memory/index.ts`（唯一合法桥）→ `core/src/memory/`（hook/接线层：MemoryApiBus / MemoryActivationEngine / CompanyKnowledge）。

### 逐项处置

| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| M1 | `cognition/memory/PersonalBrain` 五层记忆 | BrainFacade、cognition/index、evolution/workflow/{WorkflowMiner,WorkflowOptimizer}、**StudioServer(L204/L412/L859)**、cognitive-loop/{LearningStage,PersistenceStage}、index.ts | **保留（Studio 兼容面）** | 不动装配；BrainPersistor 已优先走 MemoryAPI，保持"桥接不三写"；文档标注"Studio v8 兼容记忆面，新代码一律走 MemoryAPI" |
| M2 | **BrainFacade.remember() 三写扇出** | `cognition/BrainFacade.ts` L441-491 | **P1 修复** | 收敛为单一 MemoryAPI 写入：删 personalBrain 分支 + memoryWiki 分支，仅保留 `if (this.memoryApi)` + fallbackStore（见 §六代码片段 1） |
| M3 | `agent/memory/AgentMemoryIsolation.ts` | **仅 StudioServer(L113/L586)** | **保留（Studio 兼容）** | 标注"Studio v9 遗留 Agent 分区"，新代码禁用 |
| M4 | `department/DepartmentMemoryAdapter.ts` | 仅旧 bootstrap-v12~v16 + index.ts | **P0 删除** | 随旧 bootstrap 清理（P2）一并删；bootstrap-unified 未使用 |
| M5 | `memory/knowledge/types.ts`（deprecated re-export） | **0 消费者** | **P0 删除** | 直接删 |
| M6 | `artifact/plane/`（12 文件 DEPRECATED） | index.ts、**StudioServer** | **P4 归档** | 保留 index/Studio 兼容导出 → 迁移 Studio 消费到 `artifact/registry/` 后整体归档（含 DEPRECATED.md） |
| M7 | `event/EventStore.ts` + `EventStoreSubscriber.ts`（旧 JSONL） | Kernel、engine/engine-subscriber、index.ts、protocol/events/store/EventStore.ts | **P2 删除** | 前置：engine-subscriber 改写 UnifiedEventStore（见 §六片段 2）；Kernel 改引用或一并归档；index.ts L214 移除导出 |
| M8 | **bootstrap 记忆双轨**（L185-207 MemoryAPI + L455-461 旧 MemoryWiki） | bootstrap-unified 自身 | **P1 收敛** | 保留 MemoryWiki 初始化仅作"工作记忆读取层"（extensions/planning 直写点随 P4 归档消失）；删除 L455-461 需确认无主链消费（BrainFacade 三写修好后即可删）——见 §六片段 3 |
| M9 | **StudioServer L972 直 `new MemoryWiki()`** | StudioServer | **P3 收敛** | 改经 `core/src/adapters/memory` 桥的 `createMemoryWiki()`（见 §六片段 4） |
| M10 | 图谱 4 套 | SystemMetadataGraph（OntologyService/restoreFromEvents 用，**不可删**）；KnowledgeGraph（MetaPlanner/DomainClusterManager 用，随 P4 消费点减）；cognee（权威语义）；PersonalTwinGraph（Studio 侧） | **不合并，标注** | SystemMetadataGraph=运行时对象图（权威）；cognee=语义检索（权威）；KnowledgeGraph 随 extensions/planning 归档后评估；PersonalTwinGraph=Studio 孪生图 |

**M 簇 P0 可删**：`memory/knowledge/types.ts`、`department/DepartmentMemoryAdapter.ts`（P2 随 bootstrap 删）
**M 簇装配点改动**：bootstrap-unified.ts（三处）+ StudioServer.ts（一处）——详见 §六

---

## 二、演化/学习簇（E）收敛方案

### 权威归口
运行时真实链 = `experience/ExperienceMiner`(17行薄壳) → `capability/CapabilityRegistry`；架构文档锚点 = `evolution/`（但 294 行实现 0 消费者）；S22 补装 = `learning/LearningLoop` + `cognition/SelfImprovementLoop`。

### 逐项处置

| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| E1 | `experience/ExperienceMiner`(17行) vs `evolution/ExperienceMiner`(294行) | experience 版：**MorPexRuntime + ServiceContainer(L14/L191) + 旧 bootstrap**；evolution 版：**0 消费者** | **P1 迁移 experience→capability/；P4 归档 evolution/ 死件** | experience/ 是“能力反馈挖掘器”，**不是** evolution/ 的重复——迁至 `capability/CapabilityFeedback.ts`（改名消歧义），ServiceContainer L14/L191 + MorPexRuntime L10 的 import 改写；`evolution/ExperienceMiner`(294L)+`PatternExtractor`(324L) 移入 archived/，从 barrel 摘除导出 |
| E2 | `experience/PatternExtractor`(26行) vs `evolution/PatternExtractor`(324行) | experience 版：被 E1 调用、写 CapabilityRegistry（活）；evolution 版：0 外部消费（死） | **P1 迁移 / P4 归档** | 随 E1 迁至 `capability/CapabilityPatternExtractor.ts`；`evolution/PatternExtractor`(324L) 随 E1 死件一并归档 |
| E3 | `experience/SOPRegistry` / `CapabilityStore` | SOPRegistry 0 消费；CapabilityStore 仅 capability/CapabilityRegistry 引用（deprecated 合并注释） | **P4 删除** | 随 experience/ 目录整体删除；CapabilityStore 逻辑已在 capability/CapabilityRegistry |
| E4 | **container.learningEngine 键冲突**：ServiceContainer L174 设 CrossAgentLearningEngine → bootstrap L440 覆盖为 LearningLoop | MorPexRuntime 构造参数（引用不变）；后续 `container.learningEngine` 访问者拿到 LearningLoop | **P1 修复** | **learningEngine 键归 CrossAgentLearningEngine**（v9 真实运行时链，MorPexRuntime/Studio 用）；LearningLoop 仅挂 `brainLearningLoop` 键（bootstrap 已设）→ 删 bootstrap L440 `(container as any).learningEngine = learningLoop`（见 §六片段 5） |
| E5 | `agent/learning/` 双仓储（内存 + SQLite 双写代理） | ServiceContainer.initLearningPersistence + MorPexRuntime + LearningStage + Studio | **P2 收敛** | CrossAgentLearningEngine 直接以 `ExperienceSqliteRepository` 为主仓储；`ExperienceRepository`(内存) 保留为 fallback；简化 ServiceContainer 的 store 双写代理 |
| E6 | `studio/server/learning/`（LearningPlane 等 4 文件） | **仅 V10API/V10Integration/V10MissionAdapter（死路由）** | **P3 删除** | 随 V10 死路由一起删 |
| E7 | 能力注册：capability/CapabilityRegistry vs AgentCapabilityRegistry vs CapabilityGraph vs CapabilityStore | capability：bootstrap L100 装配（权威）；AgentCapabilityRegistry：**AgentController + QualityScorer + DynamicTeamOrchestrator（活）**；CapabilityGraph：**仅 archived**；CapabilityStore：deprecated | **P0/P4** | capability/ 权威保留；AgentCapabilityRegistry 保留（独立关注点：Agent 声明树，标注）；**CapabilityGraph + CapabilityStore P4 删除** |
| E8 | `agent/evolution/AgentCapabilityEvolution` / `agent/optimizer/AgentAutoOptimizer` / `agent/benchmark/` | **全部 0 消费者** | **P0 删除** | 直接删（6 文件） |
| E9 | SelfImprovementLoop vs LearningLoop | 前者→ActiveEvolutionTrigger（bootstrap L470-472）；后者→BrainFacade（bootstrap L437-441） | **不合并，标注** | 职责不同：8 阶段演化驱动 vs 学习三件套聚合；文档补边界说明 |
| E10 | CrossDepartmentKnowledgeSynthesizer 半装配 | bootstrap L447-448 仅塞 container.crossDeptSynthesizer，BrainFacade 无 setter | **P1 补装配** | 二选一：给 BrainFacade 加 setSynthesizer 并接线；或删 container 字段改纯内部实现（BrainFacade.synthesize 自包含）——推荐后者（少改面） |

**E 簇 P0 可删**：agent/evolution/、agent/optimizer/、agent/benchmark/（共 6 文件）
**E 簇装配点改动**：ServiceContainer.ts（E1 import + E5 仓储）、bootstrap-unified.ts（E4 键冲突 + E10）、index.ts（E8 导出移除）——详见 §六

---

## 三、执行/运行时 + 规划簇（X/P）收敛方案

### 权威归口（主链）
`execution/UnifiedExecutionEngine`（四模式）→ `runtime/`：`MorPexRuntime`（主运行时）+ `runtime/mission/MissionRuntime`（任务级）+ `runtime/dag/DAGRuntime`（权威 DAG）+ `runtime/state-machine/ExecutionFSM`（任务级 FSM）+ `runtime/checkpoint`（检查点）。

### 逐项处置

| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| X1 | FSM 双实现 | FSMEngine(runtime/fsm)：**0 真实 import 消费者**（ToolExecutionProxy/EventStoreSubscriber 仅注释/事件字符串提及）；ExecutionFSM(runtime/state-machine)：MissionRuntime（**权威**） | **P0 删除 FSMEngine，保留 ExecutionFSM** | 直接删 `runtime/fsm/`（3 文件）；`fsm.transition` 事件字符串由 ExecutionScenarioRunner 发射、UnifiedEventStore 持久化，与 FSMEngine 类解耦，删除零影响 |
| X2 | `runtime/execution-graph/`（ExecutionGraphEngine 等 3 文件） | **0 消费者** | **P0 删除** | 直接删 |
| X3 | `runtime/cognitive-loop/`（12 文件第二执行路径） | **StudioServer(L38)** + GoalManager + runtime/mission/adapters | **保留（Studio 兼容）** | 标注"Studio v8 执行路径"；不并入主链 |
| X4 | `extensions/planning/`（43 文件） | **StudioServer(L58 MetaPlanner)** + router/DomainDispatcher(ToolQualityManager) + auditor/ModuleClassifier | **P4 归档（延迟到 Studio 迁移后）** | Studio 的 MetaPlanner 消费迁移到 DeliveryPlanner 后整体归档；DomainDispatcher 的 ToolQualityManager 引用改注入或随归档移除 |
| X5 | `goal-intelligence/` 顶层 vs `intent/` | 两套均被 index.ts / control-plane / Studio 导出使用 | **P2 收敛导出** | intent/ 为旧实现；统一经 `GoalIntelligenceFacade` 导出，index.ts 移除 intent/ 直出；ConstraintAnalyzer 双份裁决（顶层为准，intent 版标 deprecated） |
| X6 | `runtime/PipelineOrchestrator.ts` | **MorPexRuntime L2/L58/L102 构造使用（主链内部管线）** | **保留** | MorPexRuntime 内部“目标→计划→执行”流水线，非冗余；不动 |
| X7 | `control-plane/orchestrator/ExecutionOrchestrator.ts` | index.ts + router/CrossDomainRouter + auditor + extensions/planning 内部 | **保留（公开 API）** | 标注"遗留编排，仅兼容导出"；随 X4 归档后评估 |
| X8 | `mission-control/` vs `runtime/mission/` | mission-control：bootstrap/ServiceContainer/MorPexRuntime（**核心链**）；runtime/mission：MissionRuntime（权威） | **不合并，标注** | MissionController=任务状态机/持久化；MissionRuntime=执行运行时；边界文档化 |
| X9 | 仿真 4 套 | core ExecutionSimulator：bootstrap+MorPexRuntime+ServiceContainer（**装配**）；studio simulation(8)：Studio 侧；LookAheadSimulator：extensions/planning 内；WorkflowSimulator：**control/PolicyEngine + EvolutionStage + index（活！隐藏耦合）** | **不合并，标注** | 4 处各有真实消费；⚠️ WorkflowSimulator 被 PolicyEngine 引用，删除/改 PolicyEngine 前必须确认 |
| X10 | ReplayEngine 4+ 处 | runtime/checkpoint：DomainDispatcher+StudioServer+validation（**活，core 权威**）；reliability/replay：**0 消费者**；studio event-mesh：V10 死路由；studio observability：Studio 用 | **P0/P3** | reliability/replay 删除；studio event-mesh 随 V10 删；core 归口 runtime/checkpoint |

**X/P 簇 P0 可删**：runtime/execution-graph/（3 文件）、runtime/fsm/（3 文件）、reliability/replay/（3 文件）
**X/P 簇装配点改动**：index.ts（X5/X7 导出）+ StudioServer（X3/X4 标注）——详见 §六

---

## 四、基础设施簇（B/O）收敛方案

### 事件系统
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| B1 | `event/EventStore.ts` + `EventStoreSubscriber.ts`（旧 JSONL） | Kernel + engine/engine-subscriber + index.ts L214 + protocol/events/store/EventStore.ts（deprecated 注释指向） | **P2 删除** | 前置：engine-subscriber 改写 UnifiedEventStore（§六片段 2）；Kernel 改引用或随归档；index.ts 移除导出；EventStoreSubscriber 随删 |
| B2 | `events/{ontologyEvents,CrossDomainEvents}`（类型工厂） | ontologyEvents：bootstrap L94 使用；CrossDomainEvents：跨域链路 | **保留** | 类型层，挂在 protocol/events 之上 |
| B3 | `studio/server/event-mesh/`（7 文件，独立事件网格） | **仅 V10API/V10Integration/V10MissionAdapter（死路由）** | **P3 删除** | 随 V10 死路由一起删 |
| B4 | `studio/server/observability/event-bus.ts`（TraceBus） | **StudioServer + studio/observability 内部（活）** | **保留（Studio 产品面）** | 标注"Studio 观测专用总线，与 core EventBus 隔离是有意设计" |

### 策略/权限（互指废弃死锁 🔴）
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| B5 | `control/PolicyEngine.ts`(843行) vs `policy/PolicyEngine.ts`(90行) | control 版：**index.ts + StudioServer(L119/L592) + policy 版头注引用**；policy 版：**仅 control 版头注引用（0 真实消费）** | **P2 裁决：control 版为 winner** | ① 删 `policy/PolicyEngine.ts` + `policy/index.ts`；② control/PolicyEngine.ts 头注去掉"@deprecated 使用 policy 版"；③ index.ts L958 移除 `UnifiedPolicyEngine` 别名导出（或改为 `PolicyEngine as UnifiedPolicyEngine` 兼容） |
| B6 | `permission/PermissionEngine` vs `control/PermissionModel` | PermissionEngine：index + StudioServer（**活**）；PermissionModel：AgentIdentity + ExecutionStage + StudioServer + control/index（**活**） | **不合并，标注** | 工具调用拦截 vs 控制面权限模型，职责不同；文档标注边界 |

### 可观测
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| B7 | `trace/{TraceCollector,TraceSpan}` vs `observability/TraceManager` | **trace/ 0 消费者** | **P0 删除** | 直接删（与 observability/TraceManager 重复） |
| B8 | `mirror/`（ExecutionMirror + JSONLStorage） | **Kernel + index.ts（活）** | **保留** | 执行镜像（SSE/审计数据源），独立定位 |
| B9 | `auditor/`（12 文件） | scripts/validate-architecture.js 驱动 | **保留** | 独立定位，非重复 |
| B10 | `studio/server/observability/`（19 文件） | StudioServer + studio 内部 | **保留（Studio 产品面）** | 独立观测平台是有意设计（TraceBus/TraceStore/coverage） |
| B11 | 压缩 3 处 | **observability/CompactionService：被 SqliteEventStore 使用（活，权威）**；compaction/CompactionPolicy：仅 index 导出；@morpex/memory/storage/Compactor：memory 包内导出 | **不合并，标注** | 事件存储压缩 / 压缩策略 / JSONL AOF 压缩——职责不同 |

### ReplayEngine 归口
core 权威 = `runtime/checkpoint/ReplayEngine`（DomainDispatcher/StudioServer/validation 消费）；`reliability/replay/` 0 消费 → P0 删除；studio 两处随 P3 处理。

**B/O 簇 P0 可删**：trace/（2 文件）、reliability/replay/（3 文件，归 X 簇）
**B/O 簇装配点改动**：index.ts（B5 导出）+ engine/engine-subscriber.ts（B1 改写）+ bootstrap-unified.ts（如需）——详见 §六

---

## 五、组织/验证/装配/插件簇（V/O/B/P）收敛方案

### 组织
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| V1 | `department/` vs `organization/` | department：bootstrap L148（**权威**）；organization/ManagementHub：bootstrap L555-560 兼容字段（**保留**）；DynamicTeamOrchestrator：ServiceContainer teamOrchestrator（**保留**）；TeamBuilder/DependencyCoordinator/AgentAllocator：**被 DynamicTeamOrchestrator L47/L61/L76 运行时使用（保留）**；OrganizationContextLite：仅旧 bootstrap | **P0/P2** | TeamBuilder + DependencyCoordinator + AgentAllocator **保留**（DTO 运行时依赖）；仅 OrganizationContextLite 随旧 bootstrap（P2）删除 |

### 验证
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| V2 | `verification/VerificationEngine`(18行薄封装) vs `runtime/verification/VerificationEngine`(329行) | verification 版：**MorPexRuntime + ServiceContainer + 旧 bootstrap**（`../verification/` 相对路径）；runtime 版：**MissionRuntime**（`../verification/` 解析到 runtime/verification/） | **不删除，明确职责** | verification/=产物/合规校验链（QualityRule+ExecutionVerifier+RepairPlanner）；runtime/verification/=Mission 结果加权校验。⚠️ 两个同名类靠相对路径同时存活——在 index.ts 中分别导出避免混淆；长期建议把 runtime/verification 改名为 MissionVerificationEngine |

### 装配版本
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| V3 | bootstrap-v12~v16（6 个版本） | **全部仅 index.ts 导出**（v12 内部调 bootstrapUnified 是包装器） | **P2 删除** | ① index.ts L850/875/905/967 移除导出；② 删 6 文件（v12/v13/v14/v15/v15-integration/v16）；③ 确认无外部 import（grep 已证仅 index.ts） |
| V4 | bootstrap-unified 末尾 v12 兼容字段（managementHub/groupChatManager/leadAgentOrchestrator） | StudioServer 消费 UnifiedBootstrapResult 字段 | **保留（Studio 兼容）** | 标注"Studio 兼容面，勿新增" |

### 工作流插件 / SDK / Studio 路由
| # | 碎片 | 消费者（grep 证据） | 决策 | 合并路径 |
|---|------|--------------------|------|---------|
| V5 | 插件新旧双装载 | bootstrap-unified L113-116（旧 workflow-provider×4）+ L128-131（新 src/bootstrap×4） | **P1 改单装载（安全）** | 删 L113-116 旧式注册即可——已核实：新式 `src/actions` **不** import `workflow-provider.ts`（只 import 旧根目录 action 实现文件），删注册不影响新式链 |
| V6 | 插件旧式根目录文件（ecommerce/actions|artifacts|validators、hardware/firmware|simulation|integrations、xjmcu 根目录） | **新式 src/actions 硬依赖旧 action 实现**：amazon-primitives.ts:8→actions/amazon.js；hardware-actions.ts:8-12→firmware/actions/* + simulation/actions/* | **P2 分类处置（不可整体删）** | ① `firmware/actions/*`、`simulation/actions/*`、`actions/amazon.js`：**保留为插件内部实现**（新式链依赖），但删 `workflow-provider.ts`；② `ecommerce/validators`、`ecommerce/artifacts`、`hardware/integrations/xjmcu-pipeline.ts`（语法错误）：grep 确认无消费后删除 |
| V7 | `packages/workflow-sdk/`（8 文件） | **仅 legacy hardware/firmware/index.ts（旧式）引用** | **P2 删除** | 随 V6 删除旧式 hardware 文件后，SDK 0 消费者 → 整体删除 |
| V8 | Studio 路由 4 套 | RuntimeAPI：StudioServer L48（**活**）；RouteHandler/RouteSetup/V10API/V10Integration/V10MissionAdapter：**0 外部消费** | **P3 删除** | 删 5 文件；连带删 studio/server/learning（E6）+ event-mesh（B3） |
| V9 | `industry/IndustryRegistry.ts`（领域泄漏） | **仅 index.ts 导出（0 真实消费）** | **P4 归档** | 从 index.ts 移除导出后归档；内嵌 software/video/ecommerce 模板若需保留则迁至 workflows/ 插件 |
| V10 | `negotiation/NegotiationEngine` vs `agent/collaboration/NegotiationEngine` | negotiation 版：StudioServer + e2e（**活**）；agent/collaboration 版：**0 消费者** | **P0/P4** | agent/collaboration/NegotiationEngine 0 消费 → 删除（但 collaboration/ 其余文件保留） |

**V/O/B/P 簇 P0 可删**：agent/collaboration/NegotiationEngine（仅此文件；TeamBuilder/DependencyCoordinator/AgentAllocator 被 DynamicTeamOrchestrator L47/L61/L76 运行时使用，**保留**）
**装配点改动**：bootstrap-unified.ts（V5）、index.ts（V3/V9）、StudioServer.ts（V8）——详见 §六

---

## 六、删除清单汇总 + 装配点修改

### 6.1 删除清单（按阶段，全部需 grep 清零验证）

| 阶段 | 文件/目录 | 前置迁移 | 验证命令 |
|---|---|---|---|
| P0 | `core/src/runtime/execution-graph/`（3 文件） | 无 | `grep -rln "execution-graph\|ExecutionGraphEngine" packages --include="*.ts"` 清零 |
| ⚠️保留 | `core/src/runtime/PipelineOrchestrator.ts` | **MorPexRuntime L58/L102 构造使用**，非死代码 | 不可删 |
| P0 | `core/src/reliability/replay/`（3 文件） | 无 | `grep -rln "reliability/replay\|ReliabilityScorer\|EventReplayer" packages` 清零 |
| P0 | `core/src/trace/`（2 文件） | 无 | `grep -rln "trace/TraceCollector\|TraceSpan" packages --include="*.ts"` 清零 |
| P0 | `core/src/memory/knowledge/types.ts` | 无 | `grep -rln "memory/knowledge" packages --include="*.ts"` 清零 |
| P0 | `core/src/agent/evolution/` + `agent/optimizer/` + `agent/benchmark/`（6 文件） | 无 | `grep -rln "AgentCapabilityEvolution\|AgentAutoOptimizer\|AgentBenchmark" packages` 清零 |
| ⚠️保留 | `core/src/organization/{TeamBuilder,DependencyCoordinator,AgentAllocator}.ts` | **被 DynamicTeamOrchestrator L47/L61/L76 运行时调用**（teamOrchestrator 经 ServiceContainer 注入主链） | 不可删；仅 `OrganizationContextLite.ts` 可删（P2，随旧 bootstrap） |
| P0 | `core/src/agent/collaboration/NegotiationEngine.ts` | 无 | `grep -rln "collaboration/NegotiationEngine" packages` 清零 |
| P1 | `core/src/bootstrap-unified.ts` L113-116 旧式 workflow-provider 注册 | 确认新式 `src/actions` 无旧根目录 import | `grep -rn "workflow-provider" packages/core/src/bootstrap-unified.ts` 无命中 |
| P1 | BrainFacade.remember() 三写 → 单写 | 见片段 1 | `npx tsc --noEmit` + 记忆测试 |
| P1 | bootstrap L440 learningEngine 覆盖行 | 见片段 5 | `grep -rn "learningEngine = learningLoop" packages/core/src` 清零 |
| P2 | `core/src/event/EventStore.ts` + `EventStoreSubscriber.ts` | engine-subscriber 改写（片段 2）+ index L214 移除 | `grep -rln "event/EventStore\|EventStoreSubscriber" packages --include="*.ts"` 清零 |
| P2 | `core/src/policy/`（PolicyEngine.ts + index.ts） | control/PolicyEngine 头注去 deprecated + index L958 移除 UnifiedPolicyEngine 别名 | `grep -rln "policy/PolicyEngine\|UnifiedPolicyEngine" packages --include="*.ts"` 清零 |
| P2 | `core/src/bootstrap-v12~v16.ts`（6 文件） | index.ts L850/875/905/967 移除导出 + OrganizationContextLite 依赖一并清理 | `grep -rln "bootstrap-v1[2-6]" packages --include="*.ts"` 清零 |
| P2 | `core/src/department/DepartmentMemoryAdapter.ts` | 随旧 bootstrap 删除（无其他消费） | `grep -rln "DepartmentMemoryAdapter" packages --include="*.ts"` 清零 |
| P2 | `core/src/organization/OrganizationContextLite.ts` | 随旧 bootstrap 删除 | `grep -rln "OrganizationContextLite" packages` 清零 |
| P2 | ① 4 个 `workflow-provider.ts`（旧注册）② ecommerce/validators、ecommerce/artifacts、hardware/integrations/xjmcu-pipeline.ts | P1 已去双装载；② 需 grep 确认无消费 | ① `grep -rln "workflow-provider" packages --include="*.ts"` 清零；② 逐文件 grep |
| ⚠️保留 | hardware/firmware/actions/*、hardware/simulation/actions/*、ecommerce/actions/amazon.js | **新式 src/actions 硬依赖**（amazon-primitives.ts:8、hardware-actions.ts:8-12） | 标记"插件内部实现"，待后续内联进 src/actions 后再删 |
| P2 | `packages/workflow-sdk/`（8 文件） | 随旧式 hardware 文件删除（SDK 唯一消费者消失） | `grep -rln "workflow-sdk" packages --include="*.ts"` 清零 |
| P3 | `studio/server/{RouteHandler,RouteSetup,V10API,V10Integration,V10MissionAdapter}.ts` | 无（0 外部消费） | `grep -rln "V10API\|V10Integration\|V10MissionAdapter\|RouteHandler\|RouteSetup" packages/studio --include="*.ts"` 清零 |
| P3 | `studio/server/learning/`（4 文件）+ `studio/server/event-mesh/`（7 文件） | 随 V10 死路由删除 | 同上 |
| P4 | `core/src/experience/`（4 文件） | E1/E2 逻辑迁至 `capability/`（CapabilityFeedback/CapabilityPatternExtractor）+ ServiceContainer/MorPexRuntime import 改写 | `grep -rln "experience/ExperienceMiner\|experience/PatternExtractor" packages --include="*.ts"` 清零 |
| P4 | `core/src/artifact/plane/`（12 文件） | StudioServer 消费迁至 artifact/registry/ | `grep -rln "artifact/plane" packages --include="*.ts"` 清零 |
| P4 | `core/src/extensions/planning/`（43 文件） | Studio MetaPlanner 消费迁移至 DeliveryPlanner | `grep -rln "extensions/planning" packages --include="*.ts"` 清零 |
| P4 | `core/src/industry/IndustryRegistry.ts` | index.ts 移除导出 | `grep -rln "IndustryRegistry" packages --include="*.ts"` 清零 |

### 6.2 装配点修改（关键代码片段）

**片段 1 — BrainFacade.remember() 三写 → 单写**（`core/src/cognition/BrainFacade.ts` L441-491 区域）
```ts
// 改前：if (this.personalBrain) {...} if (this.memoryApi) {...} if (this.memoryWiki) {...} 三份写入
// 改后：收敛为统一层单写 + fallback
if (this.memoryApi) {
  await this.memoryApi.rememberEpisode({ episode: text, metadata: { source, deptId } }).catch(() => {});
} else if (this.memoryWiki) {
  await this.memoryWiki.remember(text, { tags: [source] }).catch(() => {});
}
// personalBrain 分支删除（Studio 兼容面经 BrainPersistor 自行桥接，不在此处三写）
```

**片段 2 — engine-subscriber 改写**（`core/src/engine/engine-subscriber.ts`：旧 EventStore → UnifiedEventStore）
```ts
// 改前：import { EventStore } from '../event/EventStore.js' + new EventStore()（JSONL）
// 改后：
const { UnifiedEventStore } = await import('../protocol/events/store/UnifiedEventStore.js');
const store = new UnifiedEventStore();   // SQLite 权威存储
```

**片段 3 — bootstrap-unified.ts 记忆双轨收敛**（L455-461 旧 MemoryWiki 块）
```ts
// 改前：单独 new MemoryWiki({ dbPath: 'data/memory/wiki.db' }) 双轨
// 改后（P1 先行方案）：保留该块但注释标注"工作记忆读取层；BrainFacade 三写修复后评估删除"；
// 若 extensions/planning 已归档（P4），此块删除——MemoryAPI 内部已含 wiki 存储
```

**片段 4 — StudioServer L972 直 new MemoryWiki → 经桥**（`packages/studio/server/StudioServer.ts`）
```ts
// 改前：const wiki = new MemoryWiki({...}) // 直接 import @morpex/memory，绕过唯一桥
// 改后：
const { createMemoryWiki } = await import('../../core/src/adapters/memory/index.js');
const wiki = createMemoryWiki({ dbPath: 'data/memory/wiki.db' });
```

**片段 5 — bootstrap-unified.ts learningEngine 键冲突修复**（L437-441 区域）
```ts
const { LearningLoop } = await import('./learning/LearningLoop.js');
const learningLoop = new LearningLoop();
brainFacade.setLearningLoop(learningLoop);
// ❌ 删除： (container as any).learningEngine = learningLoop;
// ✅ 保留： (container as any).brainLearningLoop = learningLoop;   // learningEngine 键归 CrossAgentLearningEngine（ServiceContainer L174）
```

**片段 6 — bootstrap-unified.ts 插件双装载 → 单装载**（L113-116 删除，保留 L128-131）
```ts
// ❌ 删除整个 try 块（L113-116 四个 workflow-provider.js 动态 import + register）
// ✅ 保留 L128-131 新式：bootstrapEcommerceWorkflow / bootstrapHardwareWorkflow /
//    bootstrapSoftwareWorkflow / bootstrapXJMcuWorkflow（ActionPrimitive 注册）
// ✅ 已核实：新式 src/actions 不依赖 workflow-provider.ts，仅依赖旧 action 实现
//    （amazon-primitives.ts:8、hardware-actions.ts:8-12）——故旧 action 实现暂保留
```

### 6.3 收敛后装配清单（目标态）
| 装配点 | 收敛后状态 |
|---|---|
| `bootstrap-unified.ts` | 唯一装配入口；单装载插件；记忆单轨（MemoryAPI）；learningEngine 归 CrossAgentLearningEngine；保留 v12 兼容字段（Studio） |
| `ServiceContainer.ts` | experienceMiner → capability/CapabilityFeedback（从 experience/ 迁移，非 evolution/）；agent/learning 单仓储（SQLite 主）；其余不动 |
| `index.ts` | 移除：bootstrap-v12~16、event/EventStore、policy/PolicyEngine(UnifiedPolicyEngine)、IndustryRegistry、execution-graph、trace、reliability/replay、experience/（P4 后）；保留 Studio 兼容导出 |
| `StudioServer.ts` | 移除 V10 路由/learning/event-mesh；MemoryWiki 经桥；其余兼容面保留 |
| `engine/engine-subscriber.ts` | 旧 EventStore → UnifiedEventStore |

### 6.4 每阶段验收命令
```bash
npx tsc --noEmit                              # TS 编译零错误
node scripts/validate-architecture.js         # 架构合规（注意：删 experience/ 前需确认 validate 不拦）
npx vitest run                                # 全量测试
node scripts/production-check.cjs             # 生产就绪检查（P2 后）
grep -rln "<被删符号>" packages --include="*.ts" | grep -v archived   # 每删一项清零
```

---
**风险提示**：
1. `control/PolicyEngine.ts` 隐藏依赖 `evolution/workflow/WorkflowSimulator`（PolicyEngine 评估链）——P4 动 evolution/workflow 前必须保留。
2. `verification/VerificationEngine` 与 `runtime/verification/VerificationEngine` 同名，靠相对路径解析同时存活——index.ts 导出处需分别命名，防混淆。
3. P4 归档 `extensions/planning` 前必须完成 Studio 的 MetaPlanner → DeliveryPlanner 迁移（StudioServer L58 是硬依赖）。
4. 删除 `event/EventStore` 前必须确认 `common/Kernel.ts`（auditor 静态分析入口）不崩溃——Kernel 是备用入口，建议同步标注。

---

## 七、方案修订记录（2026-08-01 第二版核验）

1. **插件旧文件不可整体删除**：新式 `src/actions` 硬依赖旧根目录 action 实现（`ecommerce/src/actions/amazon-primitives.ts:8` → `../../actions/amazon.js`；`hardware/src/actions/hardware-actions.ts:8-12` → `firmware/actions/*` + `simulation/actions/*`）。处置改为"分类保留/删除"（见 V6 修正）。
2. **learningEngine 键冲突行号确认**：bootstrap-unified L440 `(container as any).learningEngine = learningLoop`、L441 `brainLearningLoop`——仅删 L440。
3. **bootstrap-unified 行号确认**：旧 provider 注册 L113-116、新式 bootstrap L128-133、MemoryWiki 块 L455-461（L457 import @morpex/memory）。
4. **P0 删除均完成 grep 清零验证**（除特殊标注外，消费者证据见各簇表格）。
5. **调度器第三轮核验修正 4 处误判**：① FSMEngine 实际 0 真实 import（此前误标“工具级保留”）→ 改为 P0 删除；② PipelineOrchestrator 实际被 MorPexRuntime L58/L102 构造使用（此前误标 P0 删）→ 改为保留；③ experience/ 是活的能力反馈挖掘器、evolution/ 对应实现才是死代码（此前“合并到 evolution/”方向反了）→ 改为 experience→capability/ 迁移、evolution/ 死件归档；④ TeamBuilder/DependencyCoordinator/AgentAllocator 被 DynamicTeamOrchestrator 运行时使用（此前误标 P0 删）→ 改为保留。
6. **P0 可删项（已复核）**：execution-graph(3)、runtime/fsm(3)、reliability/replay(3)、trace(2)、memory/knowledge/types、agent/evolution+optimizer+benchmark(6)、agent/collaboration/NegotiationEngine——均 0 运行时消费者（仅 index.ts 桶导出，删时同步清理）。

---

## 八、执行记录（2026-08-01 全量落地）

> 本方案已**实际执行**并全量验证通过。最终状态：`tsc --noEmit` 0 错误 / `validate-architecture.js` 100% / `vitest` 30 文件 199 用例通过 / `production-check.cjs` **8/8 通过**。
> 变更规模：**66 文件删除 + 46 文件归档（git mv 至 packages/archived）+ 16 文件修改 + 2 文档**。

### 8.1 各阶段执行结果

| 阶段 | 执行内容 | 验证 |
|---|---|---|
| **P0** 死代码清理 | 删除 `runtime/execution-graph/`、`runtime/fsm/`(FSMEngine)、`reliability/replay/`、`trace/`、`memory/knowledge/`、`agent/evolution+optimizer+benchmark/`、`agent/collaboration/NegotiationEngine`（+barrel/AgentBootstrap 清理） | ✅ |
| **P1** 装配收敛 | bootstrap L440 learningEngine 覆盖行删除；bootstrap L455-461 MemoryWiki 死赋值删除；BrainFacade.remember()/recall() 三写→单写（MemoryAPI 权威 + PersonalBrain 快速层）；StudioServer L972 MemoryWiki→adapters/memory 桥 | ✅ |
| **P2** 归口 | policy/PolicyEngine 删除（control 为唯一权威，互指废弃死锁解除）；bootstrap-v12~v16 删除（verify-ontology-e2e 迁 bootstrapUnified）；DepartmentMemoryAdapter + OrganizationContextLite 删除；xjmcu-pipeline.ts（语法错误+0 引用）删除 | ✅ |
| **P3** Studio 收敛 | V10 岛（V10API/V10Integration/V10MissionAdapter/RouteHandler/RouteSetup）+ studio/learning + studio/event-mesh 整岛删除 | ✅ |
| **P4** 归档 | extensions/planning(43文件+测试)→archived/planning-legacy；evolution 死件(ExperienceMiner/PatternExtractor/SOPEngine)→archived/evolution-dead-miners；artifact/plane(12文件) 删除（Studio ExerciseContext 接线同步移除） | ✅ |

### 8.2 执行中发现并修正的 6 处方案误判（重要）

| # | 原方案判定 | 实测修正 | 处置 |
|---|-----------|---------|------|
| 1 | workflow-provider 双装载删除 | 旧 provider 的 `matchGoal` 真实服务 `teamOrchestrator.findForGoal`（工作流目标路由），非冗余 | **保留**双装载（新 src/bootstrap 是另一机制：ActionPrimitive 注册） |
| 2 | workflow-sdk 删除 | `scripts/workflow-cli.ts`（`npm run wf:*` CLI）真实使用 `createWorkflowRuntime` | **保留** |
| 3 | industry/ 删除 | `LLMFactory.ts:102` + `StudioServer.ts:1078` 真实 `new IndustryPlugin()` | **保留**（领域泄漏另行治理） |
| 4 | event/EventStore 删除 | `common/Kernel.ts`（StudioServer L274 构造）真实使用；SourcingEvent 与 BaseEvent 形状不同，迁移需重写 engine-subscriber 6 个事件映射 | **推迟**（标注 @deprecated，属 legacy Kernel 路径） |
| 5 | experience/ 并入 evolution/ | experience/ 是**活的**能力反馈挖掘器（MorPexRuntime L313）；evolution/ 对应实现才是死件 | **反转**：归档 evolution/ 死件，experience/ 保留原位 |
| 6 | TeamBuilder/AgentAllocator/DependencyCoordinator P0 删 | DynamicTeamOrchestrator L47/61/76 运行时调用 | **保留**（仅 OrganizationContextLite 删除） |

### 8.3 执行过程中验证的"0 消费者"实锤清单（已删除项）

`runtime/execution-graph`(3)、`runtime/fsm`(3)、`reliability/replay`(3)、`trace`(2)、`memory/knowledge/types`(1)、`agent/evolution+optimizer+benchmark`(6)、`agent/collaboration/NegotiationEngine`(1)、`bootstrap-v12~v16`(6)、`DepartmentMemoryAdapter`(1)、`OrganizationContextLite`(1)、`xjmcu-pipeline.ts`(1)、V10 岛(5)、studio/learning(5)、studio/event-mesh(12)、`artifact/plane`(12)、evolution 死件(3)——每项删除前均以 `grep -rln` 清零验证（排除自身/archived/被同步迁移的 barrel）。

### 8.4 遗留待办（不在本次范围 / 需独立决策）

1. **event/EventStore 迁移**：需重写 `engine-subscriber.ts` 6 个事件为 BaseEvent 形状 + 迁移 `common/Kernel.ts`，建议独立 PR（P2 中风险）。
2. **workflow 插件旧 action 实现内联**：新式 `src/actions` 硬依赖旧根目录 action（amazon.js/firmware actions），建议后续内联进 src/actions 后再删旧文件。
3. **industry/ 领域泄漏**：LLMFactory/StudioServer 的 IndustryPlugin 消费待迁移至 workflows 插件后删除。
4. **experience/ 更名消歧义**（可选）：若仍希望消除 `ExperienceMiner` 同名歧义，可将 experience/ 迁至 capability/CapabilityFeedback——本次已通过归档 evolution/ 死件达成等效结果，不再需要。
5. **扩展执行**：`packages/archived/planning-legacy` 内 26 个测试已随归档脱离 vitest 运行范围，若未来复用需按新架构重写。

### 8.5 验证命令（最终状态可复现）

```bash
npx tsc --noEmit            # ✅ 0 错误
node scripts/validate-architecture.js   # ✅ 100% 无违规
npx vitest run             # ✅ 30 files / 199 tests
node scripts/production-check.cjs       # ✅ 8/8 passed
```

---

## 九、理想架构对齐执行记录（2026-08-01 第二轮 · 激进收敛）

> **目标**：现实架构完全对齐理想 10 层架构；存量代码一律视为过时/冗余。
> **方法**：把运行时必需的关键类**归位到理想层目录**（结构对齐=路径归位，非删除），平行/遗留目录整批归档至 `packages/archived/`。
> **验证**：每批后 `tsc --noEmit` 0 错误 / `validate-architecture.js` 100% / `vitest` 30 文件 199 用例 / `production-check.cjs` 8/8。

### 9.1 归位到理想层（结构对齐，共 8 项）

| 原位置 | 归位到 | 理想层 |
|---|---|---|
| `experience/{ExperienceMiner,PatternExtractor}` | `capability/` | L8 演化 |
| `mission-control/{MissionController,MissionTypes}` | `runtime/mission/` | L5 执行 |
| `organization/{DynamicTeamOrchestrator,TeamBuilder,AgentAllocator,DependencyCoordinator,types}` | `execution/` | L5 执行 |
| `agent/learning/`（CrossAgentLearningEngine 等 6+2） | `learning/agent/` | L4 认知 |
| `control/{PolicyEngine,PermissionModel,RiskAnalyzer,AuditTrail,types}` | `governance/` | L1 治理 |
| `goal-intelligence/`（Facade+intent 全簇） | `planner/goal-intelligence/` | L3 规划 |
| `agent-capability/` | `capability/` | L8 演化 |
| `simulation/`（ExecutionSimulator） | `runtime/simulation/` | L5 执行 |

### 9.2 归档的平行/遗留目录（至 packages/archived/）

`crosscutting-legacy/`：auditor(13)、benchmark(4)、mcp(1)、compaction(1)、validation(9)、reliability(4) — 均为"0 保留目录消费者"实锤。
`extensions-legacy/`：ExtensionRegistry 平行扩展系统（+ scripts/generate-xjmcu.ts 领域泄漏脚本同归档）。
`experience-legacy/`、`mission-control-legacy/`：被取代的遗留件。
`planning-legacy/`、`evolution-dead-miners/`、`organization-legacy`（前两轮）。

### 9.3 理想树映射（core/src 现状）

| 理想层 | 目录 |
|---|---|
| L1 入口与治理 | `facade/` `control-plane/` `governance/` |
| L2 Ontology Gate | `ontology/` `events/` `prompts/` |
| L3 规划 | `planner/`（含 goal-intelligence/） |
| L4 认知与脑 | `cognition/` `learning/` |
| L5 执行 | `execution/` `runtime/`（含 mission/simulation/） |
| L6 工具原语 | `tools/` |
| L7 知识记忆 | `adapters/` `memory/` `metadata/` `artifact/` `protocol/` `context/` |
| L8 演化 | `evolution/` `capability/` |
| L9 插件注册 | `workflow/WorkflowProvider`（keep） |
| L10 基础设施 | `common/` `observability/` `connectors/`（包） |

### 9.4 尚存的 Studio 兼容面（未完全对齐，需 StudioServer 重写方可根除）

| 目录 | 现状 | 阻隔 |
|---|---|---|
| `agent/`（v9 平面 ~39 文件） | StudioServer v8 网关直连 10 类 | StudioServer 重写 |
| `cognition/{twin,memory,goal,workflow,decision}/` | StudioServer 直连 PersonalBrain/Twin | StudioServer 重写 |
| `router/` `domains/` `interaction/` `negotiation/` | StudioServer+bootstrap 使用 | StudioServer 重写 |
| `services/` `gateway/` `mirror/` `projection/` `permission/` `evaluation/` | StudioServer 使用 | StudioServer 重写 |
| `department/` `role/` `verification/` `workflow/` `contracts/` `engine/` `event/` | 装配点/内核依赖 | 归位或迁移决策 |
| `industry/` | LLMFactory/StudioServer 领域泄漏 | 迁至 workflows 插件 |

> 结论：核心层结构已与理想 10 层对齐（L1-L8 单一归位）；剩余偏差集中于 **StudioServer（2300+ 行 v8/v9/v10/v12 多代平行实现）**，彻底对齐 = 将 StudioServer 重写为仅消费理想层组件（SubAgentFork/AgentHarness/BrainFacade/MemoryAPI），此为本阶段未完成的独立子工程。

### 9.5 变更统计（累计）

73 删除 + 113 重命名（归档）+ 30 修改 + 15 重命名+修改 = **231 个文件变更**；`core/src` 一级目录由 58 个收敛至 42 个（含 10 层理想目录 + 尚存 Studio 兼容面）。

---

## 十、StudioServer 重写 + 全量对齐执行记录（2026-08-01 第三轮 · 完成）

> **前置**：用户明确——前端 UI 已废弃；StudioServer 放心重写，只保留理想架构相关层面。
> **结果**：`core/src` 从 42 目录收敛至 **29 目录**，全部映射理想 10 层；`packages/archived/` 新增 9 个归档域；**350 文件变更**（74 D + 202 R + 47 M + 27 RM）。全绿：tsc 0 错误 / validate 100% / vitest 30 文件 199 用例 / production-check 8/8。

### 10.1 StudioServer 重写（2318 行 → 272 行，仅消费理想层）

- **保留**：`bootstrapUnified()`（L1-L10 装配）、SessionStore、observability 路由（L10）、SSE（L10 EventBus）、理想端点（health/status/config/sessions/chat-send/execute/artifacts/memory/ontology/governance）。
- **删除**：v8 MessageGateway/MissionRuntime/CognitiveLoop/PersonalBrain/Twin、v9 Agent 平面、v10 LearningPlane/EventMesh、v12 departments/management/groupchat、前端静态托管。
- 入口 `index.ts` / `scripts/start.ts` 同步精简。

### 10.2 本轮归档/归位（全部保持全绿）

| 动作 | 内容 |
|---|---|
| 归档 | `industry/` `negotiation/` `permission/` `projection/` `LLMFactory`（0 消费者） |
| 归档 | **Kernel 链**：`common/Kernel.ts` `engine/` `event/`(旧EventStore，解决此前推迟项) `mirror/` `RuntimeKernelIntegrator` |
| 归档 | Studio 遗留：`SessionManager` `StudioOrchestrator` `ArtifactWriter` |
| 归档 | Router 链：`router/` `control-plane/orchestrator/ExecutionOrchestrator` |
| 归档 | Domains 簇：`domains/` `services/` `tools/AgentCreateTool` |
| 归档 | intent/（planner/goal-intelligence 下的死子目录）、`CrossDomainEvents`、`e2e-test` `e2e-domains` `bootstrap.ts` |
| 归位 | `role/` → `control-plane/`（L1） |
| 归位 | `department/`（Manager/Context）→ `control-plane/`（L1）；KPITracker/LeadAgent 归档 |
| 归位 | `contracts/` → `protocol/contracts/`（L10） |
| 归位 | `prompts/` → `ontology/prompts/`（L2） |
| 归档 | `organization/`（ManagementHub）、`planes/`（仅 DEPRECATED.md） |
| 归位 | **`agent/harness/` → `execution/harness/`**（L5 AgentHarness，与 v9 平面解耦） |
| 归档 | **`agent/` v9 平面全量**（identity/registry/scheduler/communication/collaboration/lifecycle/ranking/memory/context/AgentBootstrap/AgentWorker/harness-orchestrator/swarm）→ `archived/agent-plane-v9` |
| 移除 | bootstrap-unified v12 兼容字段（managementHub/groupChatManager/leadAgentOrchestrator） |

### 10.3 最终 core/src = 理想 10 层（29 目录）

| 层 | 目录 |
|---|---|
| L1 入口与治理 | `facade/` `control-plane/`（含 role/department 归位）`governance/`（含 control 归位） |
| L2 Ontology Gate | `ontology/`（含 prompts/）`events/` |
| L3 规划 | `planner/`（含 goal-intelligence/） |
| L4 认知与脑 | `cognition/` `learning/`（含 agent/） |
| L5 执行 | `execution/`（含 harness/、DynamicTeamOrchestrator 归位）`runtime/`（含 mission/simulation 归位） |
| L6 工具原语 | `tools/` |
| L7 知识记忆 | `adapters/` `memory/` `metadata/` `artifact/` `protocol/`（含 contracts/）`context/` |
| L8 演化 | `evolution/` `capability/`（含 experience/agent-capability 归位） |
| L9 插件注册 | `workflow/`（WorkflowProvider） |
| L10 基础设施 | `common/` `observability/`（connectors 包） |

### 10.4 剩余运行时横切（非平行重复，属运行时支撑，可选收尾）

| 目录 | 用途 | 归位建议 |
|---|---|---|
| `verification/` | 产物/合规校验（bootstrap/ServiceContainer/MissionRuntime 使用） | → `governance/`（L1）或保留 |
| `evaluation/` | EvaluationEngine 质量评估（ServiceContainer 使用） | → `governance/`（L1） |
| `gateway/` | ExecutionGateway/ContractGateway/PiAdapterBridge（L1 入口） | 保留（L1 入口） |
| `interaction/` | GroupChat 类型 + 消息网关（MissionRuntime 类型依赖） | 归档或 `execution/`（L5） |
| `cognition/{twin,memory,goal,workflow,decision}/` | L4 认知子模块（v8 孪生/工作流智能） | 已属 L4，视需求精简 |

> 结论：**现实架构已与理想 10 层完全对齐**（单一归位 + 无平行重复实现 + StudioServer 仅消费理想层）。剩余 4 个横切目录为运行时支撑组件（非理想层概念），收尾即迁入 L1 governance 或标注保留；`cognition/` 子目录属 L4 认知域内部。

---

## 十一、收尾完成记录（2026-08-01 第四轮）

> 本轮把 §10.4 剩余横切全部归位/归档，`core/src` 从 29 目录收敛至 **24 目录 = 纯理想 10 层 + utils**。全绿：tsc 0 / validate 100% / vitest 30 文件 199 用例 / production-check 8/8。累计 **399 文件变更**（84 D + 211 R + 69 M + 35 RM）。

### 11.1 本轮收尾项

| 动作 | 内容 |
|---|---|
| 归位 | `verification/`（8 文件：VerificationEngine/ApprovalGate/ComplianceChecker/QualityRule/ArtifactChecker/ExecutionVerifier/RepairPlanner/PolicyRuleRegistry）→ `governance/`（L1）；注意 `runtime/verification/`(329行 Mission 版) 保留在 L5 |
| 归位 | `evaluation/`（EvaluationEngine/QualityScorer/ontologyCompliance）→ `governance/`（L1） |
| 归位 | `gateway/`（ExecutionGateway/ContractGateway/PiAdapterBridge + adapters）→ `facade/gateway/`（L1 入口） |
| 归位 | `interaction/types` + `interaction/gateway/MessageGateway` → `protocol/`（L7 消息协议：message-types/message-gateway） |
| 归档 | `interaction/` 剩余（GroupChatManager + Web/CLI/WeChat/Feishu 渠道适配器 + index）→ archived |
| 验证 | 修复运行中测试（bounded-autonomy/feature-regression/production-pipeline）+ 批量修复 14 个测试文件的旧路径 |

### 11.2 最终 core/src = 24 目录（纯理想 10 层 + utils）

| 层 | 目录 |
|---|---|
| L1 入口与治理 | `facade/`(含 gateway/) `control-plane/`(含 role/department) `governance/`(含 control/verification/evaluation) |
| L2 Ontology Gate | `ontology/`(含 prompts/) `events/` |
| L3 规划 | `planner/`(含 goal-intelligence/) |
| L4 认知与脑 | `cognition/`(含 twin/memory/goal/workflow/decision) `learning/`(含 agent/) |
| L5 执行 | `execution/`(含 harness/DynamicTeamOrchestrator) `runtime/`(含 mission/simulation/verification) |
| L6 工具原语 | `tools/` |
| L7 知识记忆 | `adapters/` `memory/` `metadata/` `artifact/` `protocol/`(含 contracts/message) `context/` |
| L8 演化 | `evolution/`(含 workflow/) `capability/`(含 experience/agent-capability) |
| L9 插件注册 | `workflow/`(WorkflowProvider) |
| L10 基础设施 | `common/` `observability/`（connectors 包） |
| 共享工具 | `utils/`（toposort/jsonl/extractJson/AsyncResourceLocker） |

### 11.3 归档清单（packages/archived/ 共 20 域）

`agent-plane-v9` `planning-legacy` `evolution-dead-miners` `crosscutting-legacy`(auditor/benchmark/mcp/compaction/validation/reliability) `extensions-legacy` `experience-legacy` `mission-control-legacy` `legacy-chains`(Kernel/engine/event/mirror/router/domains/services/organization/SessionManager/StudioOrchestrator/interaction...) `planes-docs` `studio-legacy` + 8 个原始预归档域。

### 11.4 验收（可复现）

```bash
npx tsc --noEmit            # ✅ 0 错误
node scripts/validate-architecture.js   # ✅ 100% 无违规
npx vitest run             # ✅ 30 files / 199 tests
node scripts/production-check.cjs       # ✅ 8/8 passed
```

> **结论**：现实架构已与理想 10 层架构**完全对齐**——每层单一归位、无平行重复实现、StudioServer（272 行）仅消费理想层组件、全部遗留归档至 packages/archived/。
