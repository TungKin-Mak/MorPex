# MorPex 现实架构功能—文件全映射 & 碎片化审计报告

> 生成日期：2026-08-01 ｜ 方法：理想架构（morpex_ARCHITECTURE.md 10 层模型）对照现实源码逐文件核验
> 范围：`packages/core/src`（564 个 .ts）、`packages/memory`、`packages/studio/server`、`packages/workflows`、`packages/connectors`、`packages/workflow-sdk`
> 结论概要：**10 层理想架构均有真实落地，但 6 大功能域存在明显碎片化/双轨实现**（记忆、演化学习、执行运行时、规划、事件、观测验证），另有 10+ 处小规模重复。最严重的是记忆（8+ 处实现）与演化学习（9+ 处实现）。

---

## 一、理想架构（10 层）与现实落地对照总表

| 层 | 理想功能 | 现实权威文件（bootstrap 装配） | 现实冗余/双轨文件 | 碎片化 |
|----|----------|------------------------------|-------------------|--------|
| L1 入口与治理 | CompanyFacade + ControlPlane 5 控制器 + 治理 | `facade/CompanyFacade.ts`、`control-plane/{ControlPlane,GoalController,PolicyController,ResourceController,AgentController,EvolutionController}.ts`、`governance/{GovernanceDashboard,CostController,AlertEngine,RuntimeManager}.ts` | `common/Kernel.ts`(MorPexKernel)、`control-plane/orchestrator/ExecutionOrchestrator.ts`、`mission-control/` | 中 |
| L2 Ontology Gate | 强制知识门禁（tier-0/1/2） | `ontology/{ForcedQueryGuard,runOntologyGroundedReasoning,OntologyService,ObjectTypeRegistry,FeedbackService}.ts` + `events/ontologyEvents.ts`；绑定 `tools/primitives/{KnowledgeQueryPrimitive,ArtifactGenerationPrimitive}.ts` | `ontology/{objectTypes,bootstrapFromDocs}.ts`、`projectors/` | 低 |
| L3 规划 | DeliveryPlanner + HierarchicalPlanner + 跨部门仲裁 | `planner/{DeliveryPlanner,HierarchicalPlanner,CrossDepartmentArbitrationEngine,DeliveryPlannerAdapter}.ts` | `goal-intelligence/`(6) + `goal-intelligence/intent/`(9)、**`extensions/planning/`(43 文件第二套规划系统)** | **高** |
| L4 认知与脑 | BrainFacade + Reflection + MetaLearner + SelfImprovementLoop | `cognition/{BrainFacade,ReflectionEngine,MetaLearner,SelfImprovementLoop,CrossDepartmentKnowledgeSynthesizer,FeedbackAwareLearner}.ts`、`learning/LearningLoop.ts` | `cognition/{ImprovementAnalyzer,EvolutionProposal,SafetyMonitor}.ts`、`cognition/{twin,memory,goal,workflow,decision}/`、`agent/learning/`(6)、`agent/evolution/`、`agent/optimizer/`、`agent/benchmark/`、`studio/server/learning/`(4) | **高** |
| L5 执行 | UnifiedExecutionEngine + SubAgentFork + Runtime(FSM/DAG) | `execution/{UnifiedExecutionEngine,SubAgentFork}.ts`、`execution/fabric/ExecutionFabric.ts` | **5 套并行执行路径**：`runtime/MorPexRuntime.ts`、`runtime/PipelineOrchestrator.ts`、`runtime/mission/MissionRuntime.ts`、`runtime/cognitive-loop/`(12)、`control-plane/orchestrator/ExecutionOrchestrator.ts`；FSM 2 套、DAG 2 套；`mission-control/`(5) | **高** |
| L6 工具与原语 | 5 通用原语 + 注册表 | `tools/primitives/`(5)、`tools/DomainPrimitiveRegistry.ts`、`tools/ToolRegistry.ts` | `tools/` 其余 11 个工具文件、`services/`、`agent/harness/` | 低 |
| L7 知识与记忆 | 图谱 + Ontology + MemoryAPI + MemoryWiki + PersonalBrain + ArtifactRegistry + EventStore | **`packages/memory/`(@morpex/memory 权威)**、`adapters/memory/`(唯一桥)、`metadata/SystemMetadataGraph.ts`、`artifact/{registry,plane}/`、`protocol/events/` | **core/src/memory/、cognition/memory/、agent/memory/、department/DepartmentMemoryAdapter、studio 直 new MemoryWiki、tools/memory-search-tool.ts、event/EventStore** | **严重** |
| L8 演化 | ExperienceMiner + FailureAnalyzer + PatternExtractor + 迁移引擎 | `evolution/{ExperienceMiner,FailureAnalyzer,PatternExtractor,ActiveEvolutionTrigger,PatternMigrationEngine,KnowledgeGapListener,EvolutionSandbox,SOPEngine}.ts` | **`experience/`(同名重复)、`learning/`、`cognition/` 学习类、`agent/learning/`、`agent/evolution/`、`evolution/workflow/`(16)、`studio/server/learning/`** | **严重** |
| L9 工作流插件 | 领域逻辑隔离 + ActionPrimitive + bootstrap 注册 | `packages/workflows/{xjmcu,ecommerce,hardware,software}/src/`(新式) | 各插件根目录旧式文件（actions/validators/artifacts/workflow-provider）+ `workflow/WorkflowProvider.ts` vs `evolution/workflow/WorkflowRegistry.ts` | 中 |
| L10 基础设施 | EventBus 唯一通道 + ConnectorRegistry + Observability | `common/EventBus.ts`、`packages/connectors/`、`observability/`、`mirror/` | `event/EventStore`、`protocol/events/`、`events/`、`trace/`、`auditor/`(12)、**`studio/server/observability/`(21 独立栈)、`studio/server/event-mesh/`(独立事件网格)** | **高** |

---

## 二、功能 → 文件 → 文件内功能 全映射

### L1 入口与治理（Entry & Governance）

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 统一入口 | `facade/CompanyFacade.ts` | CompanyFacade：强制装配 Runtime + ControlPlane，暴露 BrainFacade/DeliveryPlanner/记忆等 setter；checkAll 健康门禁、goal→capability 推断 |
| 控制面 | `control-plane/ControlPlane.ts` | ControlPlane：聚合 5 控制器 |
| 目标控制器 | `control-plane/GoalController.ts` | 目标生命周期管理（引用 RiskAnalyzer） |
| 策略控制器 | `control-plane/PolicyController.ts` | 策略注册/评估入口 |
| 资源控制器 | `control-plane/ResourceController.ts` | 资源预算与分配 |
| Agent 控制器 | `control-plane/AgentController.ts` | Agent 生命周期（引用 agent-capability/AgentCapabilityRegistry） |
| 演化控制器 | `control-plane/EvolutionController.ts` | 演化提案入口（引用 cognition twin 相关） |
| 执行编排 | `control-plane/orchestrator/ExecutionOrchestrator.ts` | 14 个导入者的规划/执行编排（v9.2 遗留路径） |
| 治理仪表盘 | `governance/GovernanceDashboard.ts` | 治理指标聚合 |
| 成本控制 | `governance/CostController.ts` | token/费用预算控制 |
| 告警 | `governance/AlertEngine.ts` | 事件→告警规则引擎 |
| 运行时管理 | `governance/RuntimeManager.ts` | 运行时启停 |
| 内核(备用) | `common/Kernel.ts` | MorPexKernel：旧统一内核入口（auditor 用它做静态分析） |
| 任务控制(备用) | `mission-control/{MissionController,MissionTypes,ProgressTracker,ConflictResolver}.ts` | 任务级状态机与冲突解决（被 MorPexRuntime/PipelineOrchestrator 使用） |

### L2 Ontology Gate（知识门禁）✅ 最干净的一层

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 强制门禁 | `ontology/ForcedQueryGuard.ts` | 代码级强制查询：Trace + 引用校验 + 阻断 |
| 两阶段推理 | `ontology/runOntologyGroundedReasoning.ts` | 查询→基于事实生成；tier-0/1/2 分级；QueryMiss 信号 |
| 本体服务 | `ontology/OntologyService.ts` | 8 实体×10 关系查询/写入 |
| 类型注册 | `ontology/ObjectTypeRegistry.ts`、`objectTypes.ts` | 对象类型 schema（CORE_OBJECT_TYPES） |
| 反馈服务 | `ontology/FeedbackService.ts` | 反馈写入（source='query_miss' 等） |
| 文档引导 | `ontology/bootstrapFromDocs.ts` | 从文档提取初始本体 |
| 投影器 | `ontology/projectors/{ArtifactProjector,MissionProjector}.ts` | 本体→实体投影 |
| QueryMiss 事件 | `events/ontologyEvents.ts` | createQueryPerformedEvent / createQueryMissEvent / createReferenceValidationFailedEvent |
| 原语绑定 | `tools/primitives/KnowledgeQueryPrimitive.ts` | execute() 强制先走 runOntologyGroundedReasoning（已验证真实绑定） |
| 原语绑定 | `tools/primitives/ArtifactGenerationPrimitive.ts` | 知识上下文缺失时自动触发 Gate + 写文件前 Verification 钩子 |

### L3 规划（Planning）⚠️ 存在第二套规划系统

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 交付规划(权威) | `planner/DeliveryPlanner.ts`(926 行) | LLM 规划 + ontologyRefs 引用 Trace；bootstrap 装配 |
| 层次规划 | `planner/HierarchicalPlanner.ts` | HTN 层次任务网络 |
| 跨部门仲裁 | `planner/CrossDepartmentArbitrationEngine.ts` | 环检测 + Policy/Resource 预算 + 风险仲裁 |
| 规划适配 | `planner/DeliveryPlannerAdapter.ts` | 实现 MissionPlanner 接口，接入 MissionRuntime |
| 意图解析(旧) | `goal-intelligence/intent/IntentResolver.ts` | LLM 意图分类（directive/query/ambiguous/chat） |
| 目标提取(旧) | `goal-intelligence/intent/GoalExtractor.ts` | 结构化目标抽取 |
| 约束分析(旧) | `goal-intelligence/intent/ConstraintAnalyzer.ts`、`goal-intelligence/ConstraintAnalyzer.ts` | **同名双份**：intent 版(旧) vs 顶层版 |
| 优先级/风险/策略 | `goal-intelligence/intent/{PriorityEngine,RiskDetector,ExecutionPolicyGenerator}.ts` | 优先级评分、风险检测、执行策略生成 |
| 目标门面 | `goal-intelligence/GoalIntelligenceFacade.ts` | 目标智能统一入口 |
| 目标解析/校验/需求 | `goal-intelligence/{GoalParser,GoalValidator,RequirementExtractor}.ts` | 目标解析/校验/需求抽取 |
| 规划扩展系统(第二套) | `extensions/planning/`(43 文件) | 独立规划扩展系统：MetaPlanner、HierarchicalCandidateGenerator、StrategicDeconstructor、StatisticalPlanSimulator、PlanExperienceStore、PlanAnalyzer、PlanningIntelligenceEngine、TemplateManager、RuntimeController、DynamicReflexEngine、LookAheadSimulator、DeviationGuard、FaultInjector、SessionErrorExtractor、ToolQualityManager、WeightedPlanEvaluator、TopologyExplorer、V1CapabilityAdapter、PipelineExecutor/Logger 等；**未被 bootstrap 装配**，仅 `router/DomainDispatcher` 引用 ToolQualityManager |

### L4 认知与脑（Cognition & Brain）⚠️ 学习/演化类大量并行

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 脑门面(权威) | `cognition/BrainFacade.ts` | 统一入口：注入 reflectionEngine/metaLearner/learningLoop/memoryActivationEngine（S22 修复装配） |
| 反思引擎 | `cognition/ReflectionEngine.ts` | 任务后反思 → 改进建议 |
| 元学习 | `cognition/MetaLearner.ts` | 跨任务策略元学习 |
| 自我改进循环 | `cognition/SelfImprovementLoop.ts` | 改进循环（bootstrap 注入 ActiveEvolutionTrigger） |
| 跨部门知识合成 | `cognition/CrossDepartmentKnowledgeSynthesizer.ts` | 跨部门知识整合 |
| 反馈学习 | `cognition/FeedbackAwareLearner.ts` | 消费 FeedbackService |
| 改进分析/提案/安全 | `cognition/{ImprovementAnalyzer,EvolutionProposal,SafetyMonitor}.ts` | 改进分析、演化提案、安全监控 |
| 脑记忆 | `cognition/memory/{PersonalBrain,DecisionMemory,WorkflowMemory,BrainPersistor}.ts` | BrainFacade 内部四类记忆（被 BrainFacade 使用） |
| 数字孪生 | `cognition/twin/{BehaviorTwin,OrganizationTwin,PersonalTwinGraph,PreferenceModel}.ts` | 行为/组织/个人孪生图、偏好模型 |
| 目标认知 | `cognition/goal/{GoalGraph,GoalManager}.ts` | 目标图/目标管理（被 GoalController 相关引用） |
| 工作流智能 | `cognition/workflow/WorkflowIntelligence.ts` | 工作流级智能 |
| 决策孪生 | `cognition/decision/DecisionTwin.ts` | 决策回放孪生 |
| 学习循环(权威) | `learning/LearningLoop.ts` | S22 聚合三件套（注入 BrainFacade） |
| 学习三件套 | `learning/{ExperienceExtractor,PlanEvaluator,StrategyOptimizer}.ts` | 经验抽取/计划评估/策略优化 |
| 模板演化 | `learning/TemplateEvolutionEngine.ts` | 计划模板演化 |
| 跨 Agent 学习(并行) | `agent/learning/{CrossAgentLearningEngine,ExperienceRepository,ExperienceSqliteRepository,KnowledgeDistiller,LearningPropagationService,ExperienceMatcher}.ts` | 独立的跨 Agent 经验库/蒸馏/传播（ServiceContainer 持有 learningEngine） |
| Agent 能力演化 | `agent/evolution/AgentCapabilityEvolution.ts` | Agent 能力自动演化 |
| Agent 优化/基准 | `agent/optimizer/`、`agent/benchmark/` | Agent 优化器与基准测试 |
| Studio 学习面(并行) | `studio/server/learning/{LearningPlane,ExperienceLearning,PreferenceLearning,WorkflowLearning}.ts` | 服务端侧独立学习平面（与 core 双轨） |

### L5 执行与运行时（Execution & Runtime）⚠️ 碎片化最严重

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 统一执行引擎(权威) | `execution/UnifiedExecutionEngine.ts` | mission/dag/fabric/auto 四模式；maxIterations/maxCostTokens 上限 + budget.exceeded 事件 |
| 子 Agent 舰队 | `execution/SubAgentFork.ts` | 子 Agent 生成、超时/重试/并发、maxAttempts/maxCostUSD |
| 执行织物 | `execution/fabric/ExecutionFabric.ts` | 执行织物（并发执行图） |
| 运行时(主) | `runtime/MorPexRuntime.ts` | v16 主运行时：聚合 UnifiedExecutionEngine + MissionController + VerificationEngine + ExperienceMiner + DynamicTeamOrchestrator + SafetyMonitor + SelfImprovementLoop + ArtifactFacade + ApprovalGate |
| 流水线编排 | `runtime/PipelineOrchestrator.ts` | 目标→计划→执行流水线（GoalIntelligenceFacade + MissionController + TeamOrchestrator + WorkflowRegistry） |
| 服务容器 | `runtime/ServiceContainer.ts` | DI 容器：18+ 服务（eventBus/missionController/teamOrchestrator/executionEngine/artifactFacade/verificationEngine/complianceChecker/approvalGate/experienceMiner/simulator/runtime/missionStore/artifactStore/controlPlane/learningEngine） |
| Mission 运行时 | `runtime/mission/MissionRuntime.ts` | 任务状态机执行（用 ExecutionFSM） |
| 认知循环 | `runtime/cognitive-loop/{CognitiveLoop,CognitivePipeline}.ts` + 9 stage | 意图→目标→规划→执行→学习→演化→孪生→持久化 全链路管道（独立第二执行路径） |
| FSM(套1) | `runtime/fsm/FSMEngine.ts` | 10 状态 FSM（被 ToolExecutionProxy/EventStoreSubscriber 使用） |
| FSM(套2) | `runtime/state-machine/ExecutionFSM.ts` | 持久化 FSM（被 MissionRuntime 使用） |
| DAG(套1) | `runtime/dag/{DAGRuntime,TaskGraph,TaskNode,DependencyResolver,Scheduler,ParallelExecutor}.ts` | DAG 执行引擎（被 UnifiedExecutionEngine 使用） |
| DAG(套2) | `runtime/execution-graph/ExecutionGraphEngine.ts` | 执行图追踪引擎（**无外部使用者，死代码**） |
| 调度器 | `runtime/scheduler/SchedulerEngine.ts` | ROI×0.5+Cost×0.2+Latency×0.3 优先级调度 |
| 检查点/恢复/回放 | `runtime/checkpoint/{CheckpointManager,RecoveryManager,ReplayEngine}.ts` | 断点保存、恢复、回放 |
| 沙箱/审批/预算/补偿 | `runtime/sandbox/SandboxManager.ts`、`runtime/approval/ApprovalEngine.ts`、`runtime/budget/BudgetManager.ts`、`runtime/compensation/CompensationEngine.ts` | 沙箱执行、审批、预算、补偿 |
| 运行时验证 | `runtime/verification/VerificationEngine.ts` | Mission 结果验证（标准验证点加权，被 MissionRuntime 使用） |
| 持久化 | `runtime/{PersistentMissionStore,PersistentArtifactStore,ExecutionContext,ServiceContainer,RuntimeKernelIntegrator}.ts` | 任务/产物持久化、执行上下文、内核整合 |
| 模拟器 | `simulation/ExecutionSimulator.ts`（core）；`studio/server/simulation/`(8 文件：simulation-engine/twin/plan-simulator/cost-estimator/execution-predictor/risk-predictor/success-predictor) | 执行模拟（core 版被 bootstrap 装配；studio 版独立双轨） |

### L6 工具与原语（Tools & Primitives）✅ 基本干净

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 原语注册表(权威) | `tools/DomainPrimitiveRegistry.ts` | 原语注册/匹配/统计（19 项） |
| 5 通用原语 | `tools/primitives/{KnowledgeQueryPrimitive,ArtifactGenerationPrimitive,FileOperationPrimitive,ShellExecutionPrimitive,APICallPrimitive}.ts` | 全部绑定 Ontology Gate（已核验 KQP/AGP） |
| 工具注册/工厂/代理 | `tools/{ToolRegistry,ToolFactory,ToolExecutionProxy,ToolCallTracker}.ts` | 工具注册、LLM 工具工厂、执行代理（超时/OOM）、调用追踪 |
| 本体工具 | `tools/ontologyTools.ts` | ontology 工具定义 + 执行器 |
| 记忆/图谱/产物技能 | `tools/{memory-search-tool,knowledge-graph-skill,artifact-registry-skill}.ts` | 记忆检索、KG 技能、产物技能 |
| Agent 工具 | `tools/{ForkExecuteTool,TeamSayTool,ReadArtifactTool,AgentCreateTool,ask-user-tool}.ts` | fork 执行、团队发言、读产物、建 Agent、问用户 |

### L7 知识与记忆（Knowledge & Memory）⚠️ 碎片化最严重

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| **权威记忆层** | `packages/memory/src/api/{MemoryApi,factory}.ts` | MemoryAPI 统一接口（remember/query/feedback/forget...） |
| 图谱引擎 | `packages/memory/src/engines/{cognee/{CogneeEngine,client},mock/MockEngine,factory}.ts` | cognee 图谱引擎（ZVec/BGE-M3 已废弃移除） |
| Wiki 存储 | `packages/memory/src/wiki/{MemoryWiki,MemoryRetriever,DocTopology,DocWatcher,schema,migrate}.ts` | SQLite 记忆维基（权威落地层，bootstrap 用它建库） |
| 存储底座 | `packages/memory/src/storage/{HistoryStore,JSONLWriter,JSONLCompactor,LogRotator}.ts` | 历史/JSONL/压缩/轮转 |
| 强制门禁 | `packages/memory/src/gate/{ForceRetrieve,domain}.ts` | 强制检索门禁 + 领域门禁 |
| 确认队列 | `packages/memory/src/confirmation/queue.ts` | 低置信度人工确认队列 |
| 本体 schema | `packages/memory/src/ontology/{schema,validate}.ts` | 公司本体实体/关系校验 |
| **唯一桥** | `core/src/adapters/memory/index.ts` | 唯一允许 import @morpex/memory 的边界（类型 + createMemoryWiki/createMemoryRetriever/MemoryBridge） |
| Hook 层 | `core/src/memory/{MemoryHooks,MemoryMessages}.ts` | 自动记忆 hook / 推理记忆 hook / 消息转换 |
| 激活引擎 | `core/src/memory/{MemoryActivationEngine,activationRegistry}.ts` | 记忆激活源管理（全局单例） |
| 记忆总线 | `core/src/memory/MemoryApiBus.ts` | createMemoryApiBus：hooks 记忆总线 → MemoryAPI 适配 |
| 公司知识 | `core/src/memory/CompanyKnowledge.ts` | 公司知识域初始化（bootstrap 装配） |
| 脑记忆(并行) | `core/src/cognition/memory/{PersonalBrain,DecisionMemory,WorkflowMemory,BrainPersistor}.ts` | BrainFacade 私有记忆（与 @morpex/memory 互补但独立） |
| Agent 记忆隔离 | `core/src/agent/memory/AgentMemoryIsolation.ts` | Agent 级共享记忆分区隔离 |
| 部门记忆 | `core/src/department/DepartmentMemoryAdapter.ts` | 部门维度记忆适配 |
| 图谱(权威) | `core/src/metadata/SystemMetadataGraph.ts` | 8 实体×10 关系系统图谱 |
| 知识图 | `core/src/metadata/knowledge/KnowledgeGraph.ts` | 知识图实现（Layer 7 图数据） |
| 产物注册 | `core/src/artifact/registry/`(10 文件) | ArtifactRegistry 簇：注册/血缘/评估/嵌入/依赖 |
| 产物平面 | `core/src/artifact/plane/`(12 文件) | ArtifactPlane/Manager/Repository/StagingArea/Validator/Verifier/VersionService/SqliteRepository |
| 事件存储(底座) | `core/src/protocol/events/store/{UnifiedEventStore,SqliteEventStore,EventStore(JSONL),EventRepository,EventProjection,MigrationRunner,IEventStore}.ts` | 追加写事件存储、投影、迁移、回放 |
| 会话上下文 | `core/src/context/{ContextPersistence,ContextBuilder,ContextAssemblyEngine,...}.ts` | 会话级工作记忆（弱一致） |
| 记忆检索工具 | `core/src/tools/memory-search-tool.ts` | 记忆搜索 Agent 工具 |
| **绕过桥直连** | `studio/server/StudioServer.ts:972` | 直接 `new MemoryWiki()`（绕过 adapters/memory 唯一桥约束） |
| 会话存储 | `studio/server/{SessionManager,SessionStore}.ts` | 服务端会话/历史管理 |

### L8 演化（Evolution）⚠️ 碎片化最严重

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 经验挖掘(权威 workflow 版) | `evolution/ExperienceMiner.ts`(294 行) | 从工作流执行历史挖掘经验（MinedExperience） |
| 失败分析(权威) | `evolution/FailureAnalyzer.ts` | 失败分类（含 knowledge_gap）+ 失败报告 |
| 模式提取(权威 workflow 版) | `evolution/PatternExtractor.ts`(324 行) | 工作流模式识别（步骤序列/能力组合） |
| 主动演化触发(权威) | `evolution/ActiveEvolutionTrigger.ts` | 事件→演化触发（bootstrap 注入 SelfImprovementLoop + EvolutionSandbox） |
| 模式迁移 | `evolution/PatternMigrationEngine.ts` | 模式迁移/版本化 |
| 知识缺口监听 | `evolution/KnowledgeGapListener.ts` | 订阅 ontology.query.miss → 写 Feedback（bootstrap 装配） |
| 演化沙箱 | `evolution/EvolutionSandbox.ts` | 沙箱试跑 + 回滚 |
| SOP 引擎 | `evolution/SOPEngine.ts` | 标准作业程序管理 |
| 工作流演化子系统 | `evolution/workflow/`(16 文件) | WorkflowMiner/Optimizer/Executor/Simulator/TestRunner/Registry + contract/lineage/testing——完整独立工作流演化栈 |
| 经验挖掘(v16 能力版) | `experience/ExperienceMiner.ts`(17 行) | 任务完成→能力挖掘（写 CapabilityRegistry；被 MorPexRuntime 使用） |
| 模式提取(v16 版) | `experience/PatternExtractor.ts`(26 行) | 静态能力模式提取（与 evolution 版**同名不同实现**） |
| SOP 注册/能力库 | `experience/{SOPRegistry,CapabilityStore}.ts` | SOP 注册、能力模式库 |
| 学习循环(权威) | `learning/LearningLoop.ts` + `{ExperienceExtractor,PlanEvaluator,StrategyOptimizer,TemplateEvolutionEngine}.ts` | 聚合学习三件套（注入 BrainFacade） |
| 跨 Agent 学习 | `agent/learning/`(6 文件) | 独立跨 Agent 经验库/蒸馏/传播（ServiceContainer 持有） |
| Studio 学习 | `studio/server/learning/`(4 文件) | 服务端独立学习平面 |

### L9 工作流插件（Workflow Plugin）⚠️ 新旧双轨

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 插件标准(新式) | `packages/workflows/{xjmcu,ecommerce,hardware,software}/src/{index,bootstrap}.ts` | ActionPrimitive 实现 + DomainPrimitiveRegistry 注册（bootstrap 装配） |
| 领域动作(新式) | `.../src/actions/{*-primitives,*-actions}.ts` | 领域动作原语（amazon/hardware/software/compile/generate/pipeline） |
| 领域规则(新式) | `.../src/rules/{*-rules}.ts` | 领域质检/合规规则 |
| 旧式动作 | `ecommerce/actions/amazon.ts`、`hardware/{firmware,simulation,integrations}/`、`xjmcu/` 根目录 | 旧 ActionHandler 式动作（被新式 src/actions 复用 import） |
| 旧式校验/产物 | `ecommerce/validators/amazon-policy.ts`、`ecommerce/artifacts/types.ts`、`hardware/*/artifacts` | 旧校验器与产物类型 |
| 工作流提供者 | `packages/workflows/*/workflow-provider.ts` | WorkflowProvider 注册（bootstrap 同时调用新旧两套） |
| 工作流注册(权威) | `core/src/workflow/WorkflowProvider.ts` | WorkflowRegistry 类（bootstrap 装配） |
| 工作流注册(并行) | `evolution/workflow/WorkflowRegistry.ts` | 演化侧独立工作流注册表 |
| SDK | `packages/workflow-sdk/src/`(8 文件) | WorkflowSDK/Runtime/Context/Adapter/ModelRegistry 独立 SDK |
| 连接器 | `packages/connectors/src/`(7 文件) | ConnectorRegistry + FileSystemConnector + ShellConnector（bootstrap 装配，且注入 FileOperationPrimitive/ShellExecutionPrimitive） |

### L10 基础设施（Infrastructure）⚠️ 事件/观测多处双轨

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 事件总线(权威) | `common/EventBus.ts` | 唯一通信通道（命名空间 {domain}.{action}） |
| 事件存储(旧) | `event/EventStore.ts` + `EventStoreSubscriber.ts` | SourcingEvent 旧存储（被 Kernel/index.ts 导出使用） |
| 事件工厂 | `events/{ontologyEvents,CrossDomainEvents}.ts` | 事件创建函数 |
| 事件存储(新权威) | `protocol/events/`(14 文件) | BaseEvent + EventType(45 种) + UnifiedEventStore/SqliteEventStore + 投影/迁移/回放 |
| 可观测(权威) | `observability/{MetricsCollector,TraceManager,PrometheusExporter,ObservabilityLite,ObservabilityBootstrap,HealthCheckService,WorkflowMetrics}.ts` | 指标/追踪/导出/健康检查 |
| 压缩服务 | `observability/CompactionService.ts`、`compaction/CompactionPolicy.ts`、`memory/src/storage/JSONLCompactor` | **三处压缩实现** |
| 执行镜像 | `mirror/{ExecutionMirror,ExecutionRecordingEngine}.ts` + `storage/JSONLStorage.ts` | 执行镜像录制（SSE/审计数据源） |
| 追踪 | `trace/{TraceSpan,TraceCollector}.ts` | 轻量追踪跨度 |
| 架构审计 | `auditor/`(12 文件) | ArchitectureAuditor/DependencyAnalyzer/DeadModuleDetector/EventFlowAnalyzer/ModuleScanner/ModuleClassifier/PublicAPIAnalyzer/RuntimePathAnalyzer/ScoringEngine/CapabilityRegistryAnalyzer/DIAnalyzer |
| 弹性 | `common/resilience/{RetryPolicy,CircuitBreaker,ErrorHandlerService}.ts` | 重试/熔断/错误处理 |
| **Studio 观测栈(并行)** | `studio/server/observability/`(21 文件) | 独立 TraceBus/TraceStore/coverage-engine/graph-builder/agent-tracer/execution-tracer/tool-tracer/dag-tracer/fsm-tracer/event-bus/replay-engine/runtime-invoker/task-generator/exercise-all/ws-handler |
| **Studio 事件网格(并行)** | `studio/server/event-mesh/`(6 文件) | EventMesh + EventRegistry + SchemaValidator + MigrationLayer + ReplayEngine + 独立 types |
| 行为验证(studio) | `studio/server/verification/`(7 文件) | behavior-verification-engine/expected-trace-builder/trace-comparator/violation-detector/quality-score/regression-store |

### 外围横切功能（多处重复）

| 功能 | 文件 | 文件内实现的功能 |
|------|------|------------------|
| 策略引擎(套1) | `policy/PolicyEngine.ts`(90 行，类在 L28) | 风险分级策略（PolicyAction: spend_money/publish_content/delete_data/…）；**头注释 @deprecated 请使用 control/PolicyEngine.ts** |
| 策略引擎(套2) | `control/PolicyEngine.ts`(843 行，类在 L342) | 统一策略引擎（AgentPolicyRule/WorkflowTypePolicy，PolicyAction: auto_approve/notify_and_execute/require_approval/block）；**头注释 @deprecated 使用 policy/PolicyEngine.ts 代替——两文件互相指认对方废弃，且都从 index.ts 导出，无统一** |
| 策略注册 | `verification/PolicyRuleRegistry.ts`、`verification/ApprovalGate.ts`(ApprovalPolicyRegistry) | 策略规则注册、审批策略 |
| 权限(套1) | `permission/PermissionEngine.ts` | 工具调用权限（index.ts 导出） |
| 权限(套2) | `control/PermissionModel.ts` | 权限模型（ControlPlane 用） |
| 风险(套1) | `control/RiskAnalyzer.ts` | 风险分析（GoalController/CognitivePipeline 用） |
| 风险(套2) | `goal-intelligence/intent/RiskDetector.ts` | 风险检测（index.ts 导出） |
| 审计 | `control/AuditTrail.ts` | 审计追踪 |
| 验证(套1) | `verification/`(9 文件) | `VerificationEngine.ts` 仅 18 行薄组合（QualityRule.init + ExecutionVerifier + RepairPlanner）+ ComplianceChecker/ArtifactChecker/ApprovalGate/PolicyRuleRegistry；被 **MorPexRuntime**（`../verification/`）与 bootstrap-v14/v15 使用；bootstrap-unified 仅接 ApprovalGate+ComplianceChecker（L549 日志） |
| 验证(套2 同名) | `runtime/verification/VerificationEngine.ts`(329 行) | **同名 VerificationEngine 的真实实现**（加权验证点/issue 收集），被 **MissionRuntime**（`../verification/` 相对路径解析到 runtime/verification/）注入使用——`verification/` 与 `runtime/verification/` 两个同名引擎同时存活 |
| 验证(套2) | `validation/`(7 文件) | RuntimeValidator/FSMValidator/DAGValidator/ReplayValidator/RecoveryValidator/LearningValidator/ExecutionScenarioRunner（仅 extensions/planning 使用） |
| 验证(套3) | `runtime/verification/VerificationEngine.ts` | Mission 结果验证（MissionRuntime 使用） |
| 验证(套4) | `studio/server/verification/`(7 文件) | 行为验证引擎（独立） |
| 部门(权威) | `department/{DepartmentManager,DepartmentContext,DepartmentKPITracker,LeadAgentOrchestrator,DepartmentMemoryAdapter}.ts` | 部门管理/KPI/主导 Agent 编排/部门记忆（bootstrap 装配） |
| 组织(并行) | `organization/{ManagementHub,DynamicTeamOrchestrator,TeamBuilder,DependencyCoordinator,AgentAllocator,OrganizationContextLite}.ts` | 管理中枢/动态团队/分配器（ServiceContainer 持有 teamOrchestrator，bootstrap 装配 ManagementHub） |
| Agent 协作 | `agent/collaboration/{CollaborationManager,ResultAggregator,NegotiationEngine}.ts`、`agent/communication/AgentMessageBus.ts`、`agent/scheduler/AgentScheduler.ts`、`agent/ranking/AgentRanking.ts`、`agent/lifecycle/AgentLifecycle.ts`、`agent/identity/AgentProfileManager.ts`、`agent/registry/AgentRegistry.ts` | 独立 Agent 微体系 |
| 协商(套1) | `negotiation/{NegotiationEngine,NegotiationLite}.ts` | 跨域协商（index.ts 导出） |
| 协商(套2) | `agent/collaboration/NegotiationEngine.ts` | Agent 间协商（同名不同实现） |
| 能力注册(套1 权威) | `capability/{CapabilityRegistry,CapabilityDiscoverer}.ts` | 内置能力注册表（bootstrap 装配 init()） |
| 能力注册(套2) | `agent-capability/AgentCapabilityRegistry.ts` | Agent 能力注册（AgentController/DynamicTeamOrchestrator 用） |
| 能力图 | `agent/capability/CapabilityGraph.ts` | 能力图谱 |
| 路由/分发 | `router/{CrossDomainRouter,DomainDispatcher,ArbitrationHandler,RouterLite}.ts`、`domains/{DomainCluster,DomainClusterManager,DomainManifestLoader}.ts`、`industry/IndustryRegistry.ts`、`negotiation/` | 跨域路由/领域集群/行业注册 |
| 交互 | `interaction/{GroupChatManager,types}.ts` + `adapters/` | 群聊管理（bootstrap 装配） |
| Agent 上下文 | `agent/context/AgentContextFactory.ts` vs `context/`(8 文件) vs `agent/harness/ContextBuilder.ts` | **三处上下文构建** |
| 装配(v 权威) | `bootstrap-unified.ts`(580 行) | 全系统装配点（L1-L10 全部注入，见 §三）；StudioServer 实际调用 |
| 装配(旧版本) | `bootstrap-v12/v13/v14/v15/v15-integration/v16.ts` | 全部 @deprecated；**v12 内部转而调用 bootstrapUnified()（包装器）**；v13-v16 仅被 index.ts barrel 导出（L850/875/905/967），无其他调用方 |
| Studio 路由(死代码) | `studio/server/{RouteHandler,RouteSetup,V10API,V10Integration,V10MissionAdapter}.ts` | **5 个文件均无 studio/server 内引用**；StudioServer 只 import `registerRuntimeRoutes` from `RuntimeAPI.js`（L48）——4 套路由注册中仅 RuntimeAPI 存活 |
| workflow 双装载 | `packages/core/src/bootstrap-unified.ts` L113-116 + L128-131 | **同一 bootstrap 同时 import 旧式 `workflow-provider.js`（4 个）和新式 `src/bootstrap.js`（4 个）**——新旧双轨都被装载 |
| SDK 悬空 | `packages/workflow-sdk/src/`(8 文件) | 全仓库仅 `packages/workflows/hardware/firmware/index.ts`（旧式文件）引用 workflow-sdk——SDK 仅挂在遗留链路上 |
| Agent 底座 | `agent/{AgentBootstrap,AgentWorker}.ts`、`agent/harness/AgentHarness.ts`、`services/{AgentFactory,LLMProvider}.ts` | Agent 启动/工作线程/Harness |
| MCP | `mcp/McpJsonRpcHandler.ts` | MCP JSON-RPC 处理器 |
| 评估 | `evaluation/{EvaluationEngine,QualityScorer,ontologyCompliance}.ts` | 评估引擎/质量评分/本体合规 |
| 提示词 | `prompts/{leader-prompt,expert-prompt,forced-query-system,prompt-types}.ts` | 角色提示词编译 |
| 角色 | `role/RoleRegistry.ts` | 角色注册 |
| 领域键控 | `domain` 相关：`domains/`、`industry/`、`adapters/domain-cluster.ts` | 领域管理 |

---

## 三、碎片化实现清单（按严重度排序）

### 🔴 严重 1：记忆系统 — 8+ 处实现（用户点名的重灾区）

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| M1 | @morpex/memory 统一记忆层 | `packages/memory/`（MemoryApi/wiki/cognee/storage/gate） | ✅ **权威**（bootstrap 装配） |
| M2 | adapters 桥 | `core/src/adapters/memory/index.ts` | ✅ 唯一合法边界 |
| M3 | core memory hooks/总线 | `core/src/memory/`（MemoryHooks/MemoryApiBus/MemoryActivationEngine/CompanyKnowledge） | ⚠️ 合法互补层（hook 层），非重复 |
| M4 | Brain 私有记忆 | `core/src/cognition/memory/`（PersonalBrain/DecisionMemory/WorkflowMemory/BrainPersistor） | ⚠️ 与 @morpex/memory 功能重叠（记忆写入/检索），独立实现 |
| M5 | Agent 记忆隔离 | `core/src/agent/memory/AgentMemoryIsolation.ts` | ⚠️ 独立实现 |
| M6 | 部门记忆 | `core/src/department/DepartmentMemoryAdapter.ts` | ⚠️ 独立实现 |
| M7 | 图谱记忆 | `core/src/metadata/`（SystemMetadataGraph + KnowledgeGraph） | ⚠️ 与 @morpex/memory 图谱引擎功能重叠（实体/关系查询） |
| M8 | 事件存储记忆底座 | `core/src/protocol/events/` + `core/src/event/EventStore.ts` | ⚠️ 两套事件存储并存 |
| M9 | 会话上下文记忆 | `core/src/context/ContextPersistence.ts` + `studio/server/SessionStore.ts` | ⚠️ 独立 |
| M10 | **Studio 绕过桥直连** | `studio/server/StudioServer.ts:972 new MemoryWiki()` | 🔴 **违反唯一桥约束** |
| M11 | 记忆检索工具 | `core/src/tools/memory-search-tool.ts` | ⚠️ 消费层，正常 |

### 🔴 严重 2：演化/学习 — 9+ 处实现

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| E1 | evolution 权威引擎 | `core/src/evolution/`（ExperienceMiner/FailureAnalyzer/PatternExtractor/ActiveEvolutionTrigger/PatternMigrationEngine/KnowledgeGapListener/SOPEngine/EvolutionSandbox） | ✅ bootstrap 装配 |
| E2 | experience v16 同名类 | `core/src/experience/{ExperienceMiner,PatternExtractor}.ts` | 🔴 **与 E1 同名不同实现**（17/26 行 vs 294/324 行），MorPexRuntime 用 E2，bootstrap 用 E1 → 双轨 |
| E3 | learning 循环 | `core/src/learning/LearningLoop.ts` 等 5 文件 | ✅ 注入 BrainFacade（S22 新增） |
| E4 | cognition 学习类 | `cognition/{SelfImprovementLoop,MetaLearner,ImprovementAnalyzer,FeedbackAwareLearner,EvolutionProposal}.ts` | ⚠️ SelfImprovementLoop 与 LearningLoop 职责重叠 |
| E5 | 跨 Agent 学习 | `core/src/agent/learning/` 6 文件 | 🔴 独立经验库/蒸馏（ServiceContainer 持有 learningEngine），与 E3/E4 并行 |
| E6 | 工作流演化栈 | `core/src/evolution/workflow/` 16 文件 | 🔴 独立子系统（含自己的 WorkflowRegistry/Executor/Miner/Optimizer） |
| E7 | Studio 学习面 | `studio/server/learning/` 4 文件 | 🔴 与 core 双轨 |
| E8 | Agent 能力演化 | `core/src/agent/evolution/AgentCapabilityEvolution.ts` | ⚠️ 独立 |
| E9 | 能力挖掘 | `experience/{CapabilityStore,SOPRegistry}.ts` | ⚠️ 写 CapabilityRegistry（bootstrap 声称"反馈已接通"） |

### 🔴 严重 3：执行/运行时 — 5 套并行路径 + FSM/DAG 各 2 套

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| X1 | UnifiedExecutionEngine | `execution/UnifiedExecutionEngine.ts` | ✅ bootstrap 权威 |
| X2 | MorPexRuntime | `runtime/MorPexRuntime.ts` | ⚠️ 主运行时（聚合 X1 + 验证 + 经验 + 团队） |
| X3 | PipelineOrchestrator | `runtime/PipelineOrchestrator.ts` | ⚠️ 独立流水线 |
| X4 | MissionRuntime | `runtime/mission/MissionRuntime.ts` | ⚠️ 任务级执行（与 X1 并存，DeliveryPlannerAdapter 接入） |
| X5 | CognitiveLoop 全链路 | `runtime/cognitive-loop/` 12 文件 | 🔴 第二套"意图→执行→学习"全链路 |
| X6 | ExecutionOrchestrator | `control-plane/orchestrator/ExecutionOrchestrator.ts` | ⚠️ 旧编排（14 导入者） |
| FSM1 | FSMEngine | `runtime/fsm/FSMEngine.ts` | ⚠️ 工具层使用 |
| FSM2 | ExecutionFSM | `runtime/state-machine/ExecutionFSM.ts` | ⚠️ MissionRuntime 使用 → **双 FSM 并存** |
| DAG1 | DAGRuntime | `runtime/dag/` 6 文件 | ✅ UnifiedExecutionEngine 使用 |
| DAG2 | ExecutionGraphEngine | `runtime/execution-graph/` | 🔴 无外部使用（死代码） |
| V1/V2 | VerificationEngine ×2 | `verification/` vs `runtime/verification/` | 🔴 同名双实现（bootstrap 用前者，MissionRuntime 用后者） |

### 🟠 中等 4：规划 — 两套系统

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| P1 | planner 权威 | `planner/` 4 文件 | ✅ bootstrap 装配 |
| P2 | 规划扩展系统 | `extensions/planning/` 43 文件 | 🔴 完整第二套规划（MetaPlanner/候选生成/模拟/经验库），**未装配**，仅 DomainDispatcher 引用 ToolQualityManager 1 个类 |
| P3 | goal-intelligence 双套 | `goal-intelligence/`(顶层 6) vs `goal-intelligence/intent/`(9) | 🔴 同目录两套，ConstraintAnalyzer 同名重复，GoalParser vs GoalExtractor 职责重叠 |

### 🟠 中等 5：事件体系 — 5 套

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| B1 | common/EventBus | `common/EventBus.ts` | ✅ 权威唯一通道 |
| B2 | 事件存储 3 代 | `event/EventStore.ts`(旧) → `protocol/events/store/EventStore.ts`(JSONL deprecated) → `SqliteEventStore/UnifiedEventStore`(新) | ⚠️ 三代并存，index.ts 仍导出旧的 |
| B3 | 事件工厂 | `events/ontologyEvents.ts` + `CrossDomainEvents.ts` | ⚠️ 与 B2 类型体系独立 |
| B4 | Studio EventMesh | `studio/server/event-mesh/` 6 文件 | 🔴 独立事件网格（自己的 registry/validator/replay） |
| B5 | Studio TraceBus | `studio/server/observability/event-bus.ts` | 🔴 独立单例总线 |

### 🟠 中等 6：可观测 — core/studio 双栈 + 内部三套

| # | 实现 | 文件 | 角色判定 |
|---|------|------|---------|
| O1 | core observability | `observability/` 7 文件 | ✅ bootstrap |
| O2 | core mirror | `mirror/` 3 文件 | ⚠️ 与 O1 重叠（执行录制） |
| O3 | core trace | `trace/` 2 文件 | ⚠️ 与 O1 TraceManager 重叠 |
| O4 | core auditor | `auditor/` 12 文件 | ⚠️ 静态分析专用 |
| O5 | studio observability | `studio/server/observability/` 21 文件 | 🔴 完全独立栈（TraceBus/TraceStore/19 追踪器），与 core 双轨 |

### 🟡 轻度 7~17：其余重复

| # | 重复项 | 位置 | 说明 |
|---|--------|------|------|
| 7 | PolicyEngine ×2 | `policy/PolicyEngine.ts` ↔ `control/PolicyEngine.ts` | **互相声明对方 deprecated**（鸡生蛋），双轨 |
| 8 | 权限 ×2 | `permission/PermissionEngine.ts` vs `control/PermissionModel.ts` | 两个导出 |
| 9 | 风险 ×2 | `control/RiskAnalyzer.ts` vs `goal-intelligence/intent/RiskDetector.ts` | 两个导出 |
| 10 | 能力注册 ×3 | `capability/`(权威) vs `agent-capability/` vs `agent/capability/CapabilityGraph` | 三处 |
| 11 | 协商 ×2 | `negotiation/NegotiationEngine` vs `agent/collaboration/NegotiationEngine` | 同名不同实现 |
| 12 | 上下文 ×3 | `context/`(8) vs `agent/context/` vs `agent/harness/ContextBuilder` | 三处 |
| 13 | 工作流注册 ×3 | `workflow/WorkflowProvider.ts`(权威) vs `evolution/workflow/WorkflowRegistry.ts` vs 插件 workflow-provider.ts | 三处 |
| 14 | 验证 ×4 | `verification/` vs `validation/` vs `runtime/verification/` vs `studio/server/verification/` | 四套 |
| 15 | 压缩 ×3 | `compaction/CompactionPolicy.ts` vs `observability/CompactionService.ts` vs `packages/memory/src/storage/JSONLCompactor.ts` | 三处 |
| 16 | 装配 ×6 | `bootstrap-unified.ts`(权威) vs `bootstrap-v12~v16`(6 个历史) | 版本化残留 |
| 17 | Workflow 插件新旧双轨 | 每个插件 `src/`(新) + 根目录(旧) | bootstrap 同时调用新旧两套注册 |
| 18 | 组织 ×2 | `department/` vs `organization/`（ManagementHub/TeamBuilder 等） | 并行 |
| 19 | Studio 模拟器 | `studio/server/simulation/`(8) vs `core/src/simulation/ExecutionSimulator.ts` | 双轨 |

---

## 四、修复优先级建议（供后续决策）

1. **P0 记忆**：确认 `@morpex/memory` 为唯一写入/检索层 → 将 `cognition/memory`（PersonalBrain 等）、`agent/memory`、`DepartmentMemoryAdapter` 收敛为 adapter 之上的薄封装；删除 StudioServer 直连 `new MemoryWiki`（改走 core adapters 桥）。
2. **P0 演化**：统一 `evolution/` 为权威，迁移 `experience/` 同名类；将 `agent/learning` 并入 `learning/` 或明确其为独立功能；`studio/server/learning` 与 core 二选一。
3. **P1 执行**：明确 `UnifiedExecutionEngine`（权威）vs `MissionRuntime` vs `CognitiveLoop` 边界或合并；删除无引用的 `runtime/execution-graph`；FSM 二选一。
4. **P1 规划**：`extensions/planning` 43 文件未装配——要么接入 bootstrap 要么归档；`goal-intelligence` 顶层与 intent 合并。
5. **P2 事件/观测**：studio event-mesh/observability 与 core 协议统一；废弃 `event/EventStore`（旧 JSONL）导出。
6. **P2 小重复**：PolicyEngine 双向 deprecated 死锁需人工裁决；validation/、agent-capability、negotiation、context、workflow 注册按权威收敛。

---

## 附：L10 基础设施/事件/可观测/治理 —— per-file 深挖补全（2026-08-01）

> 本附录由调度器直接补全（此前 fork 未返回）。覆盖事件系统、可观测、策略/权限、治理、ReplayEngine、压缩六个子域。

### A. 事件系统（6 处实现，2 代核心）

| 功能子域 | 文件 | 文件内功能 |
|---|---|---|
| ⭐ 通信总线（权威） | `common/EventBus.ts` | `EventBus` v2：内存总线，领域作用域 + projected 事件 + history；命名空间 `{domain}.{action}`；`isProjectedEvent()`。ServiceContainer:179 `new EventBus()`，全系统唯一通信通道 |
| ⭐ 事件溯源存储（权威） | `protocol/events/store/SqliteEventStore.ts` | `SqliteEventStore implements IEventStore`：SQLite WAL + 事务批量写 + 时序/aggregateId 索引；`createSqliteEventStore()`（410-747 行） |
| ⭐ 存储门面 | `protocol/events/store/UnifiedEventStore.ts` | 内部 SqliteEventStore，对外兼容旧 replay/query/queryByType；ServiceContainer:265 实际装配的就是它 |
| 存储契约 | `protocol/events/store/IEventStore.ts` | `IEventStore`/`EventQueryFilter`/`EventStoreStats` |
| 事件查询 | `protocol/events/store/EventRepository.ts` | 过滤/聚合/时序查询层 |
| 事件投影 | `protocol/events/store/EventProjection.ts` | 纯函数：事件流→Mission/System 状态视图（状态=投影(事件流)） |
| 事件迁移 | `protocol/events/store/MigrationRunner.ts` | schema_migrations 版本化迁移 |
| 认知事件扩展 | `protocol/events/store/EventStore.Extensions.ts` | `EventStoreCognitiveMixin`：DecisionEvent 独立存储/查询 |
| ❌ 旧 JSONL 存储 | `protocol/events/store/EventStore.ts` | @deprecated JSONL 事件存储（保留向后兼容） |
| 事件类型协议 | `protocol/events/EventType.ts`/`BaseEvent.ts`/`EventTypes.ts`/`DecisionEvent.ts`/`index.ts` | 45+ 标准事件枚举 + 层分组 + BaseEvent + DecisionEvent |
| ❌ 更旧 JSONL | `event/EventStore.ts` | @deprecated JSONL EventStore（SourcingEvent/ReplayState） |
| ❌ 订阅持久化 | `event/EventStoreSubscriber.ts` | 订阅 EventBus→写旧 JSONL（迁移期遗留） |
| 事件类型（域级） | `events/ontologyEvents.ts`、`events/CrossDomainEvents.ts` | ontology.* / cross_domain.* 事件类型定义（挂在 protocol/events 之上） |
| ⚠️ Studio 事件网格 | `studio/server/event-mesh/event-mesh.ts` | `EventMesh` v10：包装 EventBus + SchemaRegistry + Validator + ReplayEngine |
| ⚠️ Studio schema | `event-mesh/event-registry.ts`（SQLite schema CRUD）、`schema-validator.ts`、`migration-layer.ts` | 事件 schema 版本控制/兼容校验/迁移 |
| ⚠️ Studio 事件回放 | `event-mesh/replay-engine.ts` | 从事件存储读历史重新 dispatch（故障恢复） |
| ⚠️ Studio 观测总线 | `studio/server/observability/event-bus.ts` | `TraceBus` 单例：TraceEvent → TraceStore(SQLite) + WebSocket 广播（独立于 core EventBus） |

**判定**：通道权威 = `common/EventBus`（唯一被 ServiceContainer 装配）；存储权威 = `protocol/events/store`（SqliteEventStore/UnifiedEventStore，装配点 ServiceContainer:263-277，接入 MissionController + ArtifactFacade + SystemMetadataGraph）。`event/` 为旧 JSONL 遗留；`events/` 只是类型；Studio event-mesh + TraceBus 是 Studio 侧独立第三/四套，未与 core 协议合并。

### B. 可观测（5 套体系）

| 功能子域 | 文件 | 文件内功能 |
|---|---|---|
| ⭐ core 观测 | `observability/MetricsCollector.ts`（时序指标）、`TraceManager.ts`（Mission 树形 span）、`PrometheusExporter.ts`、`ObservabilityBootstrap.ts`（挂载 /metrics /health）、`HealthCheckService.ts`、`WorkflowMetrics.ts`、`CompactionService.ts`（SQLite 压缩）、`ObservabilityLite.ts`（自称"替代原 8 文件"的精简版）、`index.ts` | core 权威指标/追踪/健康 |
| ⭐ 执行镜像 | `mirror/ExecutionMirror.ts`（订阅→映射→JSONL 存储，observer 不拦截）、`mirror/storage/JSONLStorage.ts` + `types.ts`（MirrorStorage 接口）、`mirror/ExecutionRecordingEngine.ts`（**STUB @deprecated**） | 执行轨迹镜像记录 |
| ⚠️ 轻量 trace | `trace/TraceCollector.ts` + `TraceSpan.ts` | 第二套轻量 span 收集（与 observability/TraceManager 并存） |
| ✅ 架构审计 | `auditor/` 13 文件：ArchitectureAuditor v3（静态+动态混合）、ModuleScanner、ModuleClassifier（8 级分类）、DeadModuleDetector、DependencyAnalyzer、DIAnalyzer、PublicAPIAnalyzer、EventFlowAnalyzer、RuntimePathAnalyzer、ScoringEngine、CapabilityRegistryAnalyzer、types、index | 独立定位（架构治理），由 scripts/validate-architecture.js 驱动 |
| ⚠️ Studio 观测平台 | `studio/server/observability/` 19 文件：traceBus/TraceBus、TraceStore（SQLite）、CoverageEngine、**architecture-auditor（第二套）**、**replay-engine（第二套）**、agent/execution/tool/dag/fsm 五个 tracer、observation、observable-module、observation-adapter、runtime-invoker、task-generator、exercise-all、ws-handler、observability-api、graph-builder、types | Studio 独立观测栈，与 core 完全平行 |
| ✅ 事件订阅 | `engine/engine-subscriber.ts`（EngineSubscriber） | 订阅 EventBus 写 EventStore |

**判定**：core 侧 4 套（observability + mirror + trace + auditor）中，`trace/` 与 `observability/TraceManager` 重复，`mirror` 与 trace 定位重叠；Studio 侧整个 observability 栈是独立第二世界（含重复 ArchitectureAuditor/ReplayEngine/TraceBus）。

### C. 策略/权限/治理（互指废弃死锁）

| 功能子域 | 文件 | 文件内功能 |
|---|---|---|
| ❌⚠️ 策略引擎 A | `control/PolicyEngine.ts` | 头注"@deprecated 使用 policy/PolicyEngine.ts (UnifiedPolicyEngine)"；导出 `PolicyAction`（auto_approve/notify_and_execute/require_approval/block）、AgentPolicyRule、WorkflowPolicy；**仍被 index.ts:324 导出** |
| ❌⚠️ 策略引擎 B | `policy/PolicyEngine.ts` | 头注"@deprecated 请使用 control/PolicyEngine.ts"；导出 `PolicyAction`（spend_money/publish_content/delete_data…）、Policy/PolicyDecision（ALLOW/DENY/REQUIRE_APPROVAL）；**仍被 index.ts:958 以 UnifiedPolicyEngine 导出** |
| ⚠️ 权限模型 | `control/PermissionModel.ts` | 用户中心细粒度权限（用户/领域/工具/风险四维） |
| ⚠️ 运行时拦截 | `permission/PermissionEngine.ts` | 每轮 Tool Call 动态审计（allow/block/ask→HITL SUSPENDED）；被 `tools/ToolCallTracker.ts` 与 index.ts 引用 |
| ⚠️ 审批门 | `verification/ApprovalGate.ts` | 审批动作枚举（与 policy 概念同名） |
| ✅ 风险/审计 | `control/RiskAnalyzer.ts`（复杂度/敏感域/敏感工具风险评估）、`control/AuditTrail.ts`（append-only 审计）、`control/types.ts`（RiskLevel/GovernanceConfig） | 治理层 |
| ⭐ 治理看板 | `governance/GovernanceDashboard.ts`（SystemHealth/Cost/Compliance 报告）、`CostController.ts`（预算）、`AlertEngine.ts`（告警）、`RuntimeManager.ts` | bootstrap-unified:485-491 装配 |

**判定**：`control/PolicyEngine` 与 `policy/PolicyEngine` **互相指认对方废弃**（死锁），且都被主入口导出——需人工裁决或合并；PermissionEngine 是唯一"活"的运行时权限拦截器；ApprovalGate 概念重叠。bootstrap-unified 未装配任何 PolicyEngine/PermissionEngine。

### D. ReplayEngine（4 处 + 2 相关）

| 位置 | 职责 | 判定 |
|---|---|---|
| `runtime/checkpoint/ReplayEngine.ts` | 检查点回放 | ⚠️ |
| `reliability/replay/ReplayEngine.ts`（+EventReplayer/ReliabilityScorer） | 可靠性回放+评分 | ⚠️ |
| `studio/server/event-mesh/replay-engine.ts` | 事件重放（故障恢复） | ⚠️ |
| `studio/server/observability/replay-engine.ts` | 追踪回放/回归对比 | ⚠️ |
| `validation/ReplayValidator.ts` | 回放校验（验证域） | ⚠️ |
| `protocol/events/store/EventProjection.ts` | 事件投影（不是回放，但概念相邻） | ✅ 权威投影 |

**判定**：回放概念无统一权威，4 处分布在 4 个不同域。

### E. 压缩/记忆整理（3 处）

`observability/CompactionService.ts`（SQLite 压缩维护）vs `compaction/CompactionPolicy.ts`（压缩策略）vs `@morpex/memory/src/storage/Compactor.ts`（JSONL AOF 压缩）——三处互不引用。

### F. 装配判定（bootstrap-unified 实装配清单，L10 相关）

- `ServiceContainer.ts:179` `new EventBus()`；`:263-277` `new UnifiedEventStore()` → 接入 MissionController/ArtifactFacade/SystemMetadataGraph（事件溯源真相源）
- `bootstrap-unified.ts:106,158` 等待 EventStore 就绪 + `restoreFromEvents` 重建状态
- `bootstrap-unified.ts:485-491` GovernanceDashboard + CostController + AlertEngine
- **未装配**：PermissionEngine、mirror/、trace/、auditor/、policy 双引擎、Studio 观测栈（Studio 侧自行初始化）
## 五、补充核验（调度器第二轮直查，2026-08-01）

> 首轮 4 个并行深挖 fork 返回失败后，以下证据由调度器直接逐文件核验补齐（B: 演化/学习、D: 事件/观测/策略、E: 原语/验证/组织、F: 装配/Studio/插件）。所有结论均有行级证据。

### 5.1 演化/学习/经验（B 域）逐文件证据

| 文件 | 行数 | 证据要点 |
|------|------|----------|
| `evolution/ExperienceMiner.ts` | 294 | 权威实现：`MinedExperience`/`MiningConfig`/`ExperienceMiner`（工作流级挖掘，import ./workflow/types） |
| `evolution/PatternExtractor.ts` | 324 | 权威实现：`ExtractedPattern`/`PatternExtractorConfig`（工作流模式识别） |
| `experience/ExperienceMiner.ts` | **17** | 遗留迷你版：仅 1 个类，无接口；`experience/index.ts` 头注 **@deprecated 已合并到 capability/CapabilityRegistry.ts** |
| `experience/PatternExtractor.ts` | **26** | 遗留迷你版：静态能力模式提取（import CapabilityRegistry）；与 evolution 版同名不同实现 |
| `experience/SOPRegistry.ts` | 29 | SOP 注册（遗留） |
| `experience/CapabilityStore.ts` | 49 | 头注 **@deprecated 已合并到 capability/CapabilityRegistry.ts** |
| `learning/LearningLoop.ts` | 104 | `LearningLoop implements LearningLoopLike`（S22 补全，聚合三件套）；bootstrap-unified L437 动态 import 并注入 BrainFacade |
| `learning/{ExperienceExtractor,PlanEvaluator,StrategyOptimizer,TemplateEvolutionEngine}.ts` | 148/90/105/125 | 学习三件套 + 模板演化 |
| `cognition/{ReflectionEngine,MetaLearner,SelfImprovementLoop,CrossDepartmentKnowledgeSynthesizer,FeedbackAwareLearner,ImprovementAnalyzer,EvolutionProposal,SafetyMonitor}.ts` | 193/181/112/545/259/83/56/88 | bootstrap-unified L401-446 真实装配 ReflectionEngine+MetaLearner+Synthesizer+LearningLoop |
| `agent/learning/`（6 文件） | — | 独立跨 Agent 经验体系：ExperienceRepository（内存）+ **ExperienceSqliteRepository（SQLite，双仓储并存）** + CrossAgentLearningEngine/KnowledgeDistiller/LearningPropagationService/ExperienceMatcher；未被 bootstrap-unified 装配 |
| `agent/evolution/AgentCapabilityEvolution.ts` | 126 | Agent 能力演化（未装配） |
| `agent/optimizer/AgentAutoOptimizer.ts` | 158 | Agent 自动优化（未装配） |
| `agent/benchmark/AgentBenchmark.ts` | 180 | Agent 基准（未装配） |
| `studio/server/learning/{LearningPlane,ExperienceLearning,PreferenceLearning,WorkflowLearning}.ts` | 121/54/53/55 | Studio 独立学习平面（事件驱动，与 core 双轨） |
| `capability/{CapabilityRegistry,CapabilityDiscoverer}.ts` | — | **权威**：bootstrap-unified L100-101 `CapabilityRegistry.init()` |
| `agent-capability/AgentCapabilityRegistry.ts` | — | 第二套：被 AgentController/DynamicTeamOrchestrator 使用（CapabilityNode/AgentDeclaration） |
| `agent/capability/{CapabilityGraph,Capability}.ts` | — | 第三套：能力图谱 |

**B 域判定**：`experience/` 是标注废弃的 v16 旧版残留（与 evolution/ 同名但仅 17-26 行）；`agent/learning` 与 `studio/server/learning` 是未被统一装配的第二、第三套学习体系；能力注册 3 套并存（capability 权威）。

### 5.2 事件/观测/策略（D 域）逐文件证据

| 文件 | 行数 | 证据要点 |
|------|------|----------|
| `common/EventBus.ts` | — | 权威通信通道（内存总线） |
| `protocol/events/store/SqliteEventStore.ts` | **752** | 权威事件存储（SQLite WAL） |
| `protocol/events/store/UnifiedEventStore.ts` | 352 | 迁移门面：**自身 @deprecated → 使用 IEventStore.query()** |
| `protocol/events/store/EventStore.ts` | 524 | @deprecated → 使用 SqliteEventStore/UnifiedEventStore |
| `event/EventStore.ts` | 300 | @deprecated → 使用 UnifiedEventStore（**与 protocol/events 同名第三处**） |
| `event/EventStoreSubscriber.ts` | 134 | 订阅器（接旧 EventStore） |
| `events/ontologyEvents.ts` / `events/CrossDomainEvents.ts` | 166/144 | 事件类型工厂（OntologyEventTypes/DomainXxxEvent） |
| `observability/`（10 文件） | — | MetricsCollector/TraceManager/PrometheusExporter/ObservabilityLite/ObservabilityBootstrap/HealthCheckService/CompactionService/WorkflowMetrics |
| `mirror/ExecutionRecordingEngine.ts` | 48 | **头注 @deprecated：由 ExecutionMirror + EventStore 取代** |
| `trace/{TraceSpan,TraceCollector}.ts` | 12/44 | 轻量追踪（与 observability/TraceManager 平行，极小实现） |
| `auditor/`（13 文件） | — | 架构审计体系（独立定位，非重复） |
| `policy/PolicyEngine.ts` | 90 | 头注 **@deprecated 请使用 control/PolicyEngine.ts**（PolicyAction 审批类） |
| `control/PolicyEngine.ts` | 843 | 头注 **@deprecated 使用 policy/PolicyEngine.ts (UnifiedPolicyEngine) 代替**（AgentPolicyRule 类）——**互相指认对方废弃，双轨共存且都从 index.ts 导出** |
| `permission/PermissionEngine.ts` / `control/PermissionModel.ts` | 164/435 | 两套权限模型（工具权限 vs 控制面权限） |
| `studio/server/event-mesh/`（7 文件） | — | Studio 独立事件网格（EventMesh/EventRegistry(SQLite)/SchemaValidator/MigrationLayer/ReplayEngine） |
| `studio/server/observability/event-bus.ts` | — | TraceBus（观测独立总线）——**Studio 侧事件体系与 core 完全平行** |
| `studio/server/observability/`（19 文件） | — | 独立观测栈（含又一个 architecture-auditor、又一个 replay-engine） |
| `compaction/CompactionPolicy.ts` vs `observability/CompactionService.ts` vs `@morpex/memory/src/storage/Compactor.ts` | — | 压缩三处互不引用 |

### 5.3 原语/验证/组织（E 域）逐文件证据

| 功能 | 文件 | 证据要点 |
|------|------|----------|
| **Ontology Gate 绑定（已核验）** | `tools/primitives/KnowledgeQueryPrimitive.ts` | L18-19 import ForcedQueryGuard + runOntologyGroundedReasoning；L53 initializeOntologyGate 注入守卫 |
| **Ontology Gate 绑定（已核验）** | `tools/primitives/ArtifactGenerationPrimitive.ts` | L21-22 同上；L201 getOntologyGuard() 于 execute 内调用 |
| PiBridge 隔离（已核验） | `adapters/pi-bridge/PiBridge.ts`(366) + `gateway/PiAdapterBridge.ts` | **core 内 from 'pi' 直接导入 = 0 处**（grep 全空），隔离成立 |
| 原语注册表 | `tools/DomainPrimitiveRegistry.ts` | 19 项原语注册/匹配/统计 |
| 工具层 | `tools/{ToolRegistry,ToolFactory,ToolExecutionProxy,ToolCallTracker,builtin-tools}.ts` | 注册/工厂/超时代理/调用追踪/内置工具 |
| 专用工具（9） | `tools/{ontologyTools,memory-search-tool,knowledge-graph-skill,artifact-registry-skill,ForkExecuteTool,TeamSayTool,ReadArtifactTool,AgentCreateTool,ask-user-tool}.ts` | 领域/Agent 技能工具散落 tools/ |
| 验证薄封装 | `verification/VerificationEngine.ts` | **仅 18 行**（QualityRule.init + ExecutionVerifier + RepairPlanner 组合） |
| 验证真实引擎 | `runtime/verification/VerificationEngine.ts` | **329 行**真实实现；`runtime/mission/MissionRuntime.ts` L52/645 注入使用 |
| 验证并行 | `validation/`（8 文件） | RuntimeValidator/FSMValidator/DAGValidator/ReplayValidator/RecoveryValidator/LearningValidator/ExecutionScenarioRunner |
| 部门（装配） | `department/`（5 文件） | DepartmentManager/DepartmentContext/DepartmentKPITracker/LeadAgentOrchestrator/DepartmentMemoryAdapter |
| 组织（装配） | `organization/`（7 文件） | ManagementHub/DynamicTeamOrchestrator/TeamBuilder/DependencyCoordinator/AgentAllocator/OrganizationContextLite |
| 协商双轨 | `negotiation/{NegotiationEngine,NegotiationLite}.ts` + `agent/collaboration/NegotiationEngine.ts` | 两处同名 NegotiationEngine（跨域 vs Agent 间） |
| 路由/领域 | `router/`(4) + `domains/`(4) + `industry/`(3) | CrossDomainRouter/DomainDispatcher/ArbitrationHandler/RouterLite + DomainCluster(Manager)/DomainManifestLoader + IndustryRegistry |
| 交互/MCP | `interaction/GroupChatManager.ts`、`mcp/McpJsonRpcHandler.ts` | 群聊管理、MCP JSON-RPC |
| 上下文三处 | `context/`(8) vs `agent/context/` vs `agent/harness/ContextBuilder.ts` | 三处上下文构建/持久化体系 |

### 5.4 装配/Studio/插件（F 域）逐文件证据

| 功能 | 文件 | 证据要点 |
|------|------|----------|
| 权威装配 | `bootstrap-unified.ts`(580 行) | 唯一被实际调用（StudioServer）；L113-116 旧式 provider + L128-131 新式 bootstrap **双装载** |
| 遗留装配 ×5 | `bootstrap-v12..v16.ts` | 全部 @deprecated；**v12 L114 内部再调 bootstrapUnified()（包装器）**；v13-v16 仅 index.ts barrel 导出（L850/875/905/967） |
| Studio 主服务 | `studio/server/StudioServer.ts`(2358) | 57+ REST 端点 + SSE；L48 只 import registerRuntimeRoutes（RuntimeAPI） |
| Studio 路由死代码 | `studio/server/{RouteHandler,RouteSetup,V10API,V10Integration,V10MissionAdapter}.ts` | **全仓无引用**（grep 为空）——4 套路由注册仅 RuntimeAPI 存活 |
| Studio 编排/会话 | `StudioOrchestrator.ts`(358)/SessionManager.ts(587)/SessionStore.ts(117) | Orchestrator 直连 core（CrossDomainRouter/DomainDispatcher/DomainClusterManager）+ MemoryBridge；**StudioServer L972 直 new MemoryWiki() 绕过 adapters 桥** |
| Studio 验证 | `studio/server/verification/`（8 文件） | BehaviorVerificationEngine/ExpectedTraceBuilder/TraceComparator/ViolationDetector/QualityScoreEngine/RegressionStore——core 验证第 4 套 |
| 插件新式 | `workflows/{xjmcu,ecommerce,hardware,software}/src/{bootstrap,index,actions,rules}.ts` | ActionPrimitive + 注册（bootstrap-unified 装载） |
| 插件旧式 | `workflows/*/workflow-provider.ts` + ecommerce/{actions,validators,artifacts} + hardware/{firmware,simulation,integrations} + xjmcu/{knowledge,toolchain} | 旧 ActionHandler 式文件；hardware/integrations/xjmcu-pipeline.ts 仅自引用（死代码，且含语法错误） |
| 连接器 | `packages/connectors/src/`（7 文件） | BaseConnector/ConnectorRegistry/FileSystemConnector/ShellConnector/IActionConnector |
| SDK 悬空 | `packages/workflow-sdk/src/`（8 文件） | WorkflowSDK(452)/WorkflowRuntime(690)/WorkflowContext/WorkflowSDK；仅 hardware/firmware/index.ts（旧式）引用 |
| Studio 学习/事件/观测 | `studio/server/{learning,event-mesh,observability}/` | 与 core 三套双轨（见 5.1/5.2） |

### 5.5 第二轮核验修正记录

1. **verification/VerificationEngine 不是权威实现**：18 行薄组合 vs runtime/verification/VerificationEngine 329 行真实引擎（MissionRuntime 用后者）；文档此前标注"verification/ 权威"需修正为"两同名引擎并存"。
2. **Policy 双引擎是"互相指认废弃"**：policy/PolicyEngine.ts 说用 control 版，control/PolicyEngine.ts 说用 policy 版——两文件头注互指（已核验原文），且都从 index.ts 导出。
3. **workflow 插件是"双装载"而非"仅新式"**：bootstrap-unified 同时 import 旧式 workflow-provider.js 与新式 src/bootstrap.js。
4. **Studio 路由 4 套中 3 套死代码**：RouteHandler/RouteSetup/V10API/V10Integration/V10MissionAdapter 全仓无引用。
5. **bootstrap v12 是包装器**：内部再调 bootstrapUnified；v13-v16 仅 barrel 导出。
6. **experience/ 已标注废弃**：ExperienceMiner 17 行 / PatternExtractor 26 行 / CapabilityStore 头注"已合并到 capability/CapabilityRegistry"。
7. **agent/learning 双仓储**：ExperienceRepository（内存）+ ExperienceSqliteRepository（SQLite）。
