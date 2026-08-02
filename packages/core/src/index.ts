/**
 * MorPexCore — 入口文件
 *
 * MorPexCore Phase 0 — Kernel Contract 冻结
 * 建立 MorPexCore Kernel 边界，冻结三个核心协议：
 *   - Event Schema（core/types.ts）
 *   - Execution Gateway API（gateway/）
 *   - Plugin API（core/types.ts + core/PluginSystem.ts）
 *
 * 使用方式：
 *   ```typescript
 *   import { bootstrapMorPexCore } from '../morpex-core/index.js';
 *
 *   const kernel = await bootstrapMorPexCore(runtime);
 *   ```
 */

// ── Kernel ──

// ── Core 组件 ──
export { EventBus } from './infrastructure/common/EventBus.js';
export { ExecutionIdentity } from './infrastructure/common/ExecutionIdentity.js';
export { PluginSystem } from './infrastructure/common/PluginSystem.js';

// ── Gateway（内部使用，不对外暴露）─

// ═══════════════════════════════════════════════════════════════
// Phase 0 — 组织层（一人虚拟公司部门体系）
// ═══════════════════════════════════════════════════════════════
export { DepartmentManager, DepartmentContext } from './governance/control-plane/index.js';
export type { Department, DepartmentId, DepartmentType, DepartmentStatus, CreateDepartmentParams, DepartmentStats } from './governance/control-plane/index.js';

export { RoleRegistry } from './governance/control-plane/index.js';
export type { Role, RoleId, RoleName, RoleAssignment } from './governance/control-plane/index.js';

export type { OrganizationContext, OrganizationScope } from './execution/types.js';

export { CompanyFacade } from './facade/index.js';

// ── Agent Harness v2 (Phase 2) ──
export { AgentHarness, ContextBuilder } from './execution/harness/index.js';
export type {
  HarnessContext,
  IntentContext,
  PlanContext,
  MemoryContext,
  ArtifactContext,
  ExecutionState as HarnessExecutionState,
  PermissionContext,
  ExperienceContext,
} from './execution/harness/index.js';
export type { MemoryRecord, ArtifactRef as AgentArtifactRef, Experience as AgentExperience, HarnessEventCallback } from './execution/harness/index.js';

// ── Runtime Kernel v2 (Phase 1) ──
export {
  ExecutionFSM,
  ExecutionState,
  DAGRuntime,
  TaskNode,
  TaskGraph,
  DependencyResolver,
  Scheduler,
  ParallelExecutor,
  CheckpointManager,
  RecoveryManager,
  ReplayEngine,
} from './execution/runtime/index.js';
export type {
  StateTransitionEvent,
  ExecutionAuditEntry,
  ExecutionFSMConfig,
  FSMSnapshot,
  DAGResult,
  ExecutionTraceEntry,
  DAGRuntimeConfig,
  TaskNodeStatus,
  TaskExecutionResult,
  SchedulerConfig,
  SchedulerStatus,
  NodeState,
  ExecutionSnapshot,
  CheckpointManagerConfig,
  RecoveryAction,
  RecoveryPlan,
  ReplayEvent,
  ReplayEventType,
} from './execution/runtime/index.js';

// ── Pi 集成模块 ──
export { THINKING_LEVELS, THINKING_LEVEL_LABELS, DEFAULT_THINKING_LEVEL, getSupportedLevels, clampLevel, parseThinkingLevel, clearModelCache } from './infrastructure/common/ThinkingLevelControl.js';
export type { ThinkingLevel } from './infrastructure/common/ThinkingLevelControl.js';

// ── Phase 4.6: ProgressCallback + ToolQualityTracker ──
export { makeProgressEvent } from './infrastructure/common/ProgressCallback.js';
export type { ProgressEvent, ProgressEventType, ProgressCallback } from './infrastructure/common/ProgressCallback.js';
export { ToolQualityTracker } from './infrastructure/common/ToolQualityTracker.js';
export type { ToolStats } from './infrastructure/common/ToolQualityTracker.js';

export { listProviders, listModels, listAllProviders, findModel, getDefaultModel } from './infrastructure/common/ModelRegistry.js';
export type { ModelInfo, ProviderInfo } from './infrastructure/common/ModelRegistry.js';

// AgentService / createBuiltinTools — 内部模块，不对外暴露

// ── Knowledge Plane — Artifact Intelligence (Phase 3) ──
export { ArtifactGraph, ArtifactLineage, ArtifactEvaluator, ArtifactDependencyResolver, ArtifactEmbedding } from './knowledge/artifact/registry/index.js';
export type { ArtifactNode, ArtifactEdge, ArtifactCapability, ArtifactDependency, ArtifactUsageRecord, ArtifactEvaluation, LineageQuery, LineagePath, ArtifactEmbedding as ArtifactEmbeddingType } from './knowledge/artifact/registry/index.js';

// ── Memory Activation Engine (Phase 4) ──
export { MemoryActivationEngine } from './knowledge/memory/MemoryActivationEngine.js';
export type { ActivationContext, ActivationResult, MemoryActivationSource } from './knowledge/memory/MemoryActivationEngine.js';
export { setGlobalActivationEngine, getGlobalActivationEngine } from './knowledge/memory/activationRegistry.js';

// ── Learning Loop (Phase 6) ──
export { ExperienceExtractor, PlanEvaluator, StrategyOptimizer, TemplateEvolutionEngine } from './cognition/learning/index.js';
export type { ExecutionRecord, Experience } from './cognition/learning/index.js';
// PlanEvaluation kept from learning (canonical); extensions re-export aliased below
export type { PlanEvaluation } from './cognition/learning/index.js';
export type { OptimizationSuggestion } from './cognition/learning/index.js';
export type { PlanTemplate, TemplateRecommendation } from './cognition/learning/index.js';



// ── TeamSayTool (Phase 3.2) ──
export { TeamSayTool, createTeamSayTool } from './infrastructure/tools/TeamSayTool.js';
export type { AgentRegistry } from './infrastructure/tools/TeamSayTool.js';

// ── ReadArtifactTool (Phase 3.4) ──
export { createReadArtifactTool } from './infrastructure/tools/ReadArtifactTool.js';

// ── 提示词系统 — 三级分封架构 (Leader→Expert→Fork) ──
export { compileLeaderPrompt, compileExpertPrompt, createAstroMTrace } from './knowledge/ontology/prompts/index.js';
export type { PromptTemplate, PromptCompileOptions, AstroMTrace } from './knowledge/ontology/prompts/index.js';

// ── 三级分封工具 (v2.4) ──
export { ForkExecuteTool, createForkExecuteTool } from './infrastructure/tools/ForkExecuteTool.js';

// ── Memory Search Tool (v2.6) — LLM 可主动调用 search_memory ──
export { createMemorySearchTool } from './infrastructure/tools/memory-search-tool.js';

// ── Memory Hooks (Phase 4) ──
export { createAutoMemoryHook, createReasoningMemoryHook } from './knowledge/memory/MemoryHooks.js';
export type { MemoryBus } from './knowledge/memory/MemoryHooks.js';

// ── Memory Messages (Phase 4.3) ──
export { convertMemoryHintToLlm, convertDagNodeStatusToLlm, createCustomConvertToLlm, isMemoryHintMessage, isDagNodeStatusMessage } from './knowledge/memory/MemoryMessages.js';

// ── PermissionEngine (Phase 1.2) — 运行时工具调用拦截器 ──

// ── CompactionPolicy (Phase 2.2) — 上下文压缩策略接口 ──

// ── SessionProjection (Phase 3.6) — 会话状态读模型投影 ──

// ── Negotiation (Phase 11.5) ──
/** @deprecated 协商功能已合并到 LeadAgentOrchestrator.resolveTaskConflict() */

// ── Skill 工具（内部使用，不对外暴露）─

// ── MorPex v8 Mission Runtime ──
export {
  MissionState,
  MISSION_VALID_TRANSITIONS,
  MissionRuntime,
} from './execution/runtime/index.js';
export type {
  MissionPlanner,
  MissionExecutor,
  MissionRuntimeConfig,
  Mission,
  MissionPlan,
  PlanStep,
  MissionResult,
  MissionContext,
  MissionPermissions,
} from './execution/runtime/index.js';

// ── Mission Runtime Adapters (P0 架构完善) ──
export { MetaPlannerAdapter, DAGExecutorAdapter } from './execution/runtime/index.js';

// ── v9.1 Context Assembly Layer ──
export {
  ContextAssemblyEngine,
  ContextFragmentRegistry,
  ContextBuilder as ContextAssemblyBuilder,
  ContextVersioner,
  ContextTemplateRepository,
  ContextEnricherPipeline,
  ContextPersistence,
} from './knowledge/context/index.js'
export type {
  ExecutionContext as ContextAssemblyExecutionContext,
  ContextLayer,
  ContextFragment,
  FragmentSource,
  FragmentProvider,
  ContextAssemblyInput,
  ContextSnapshot as ContextAssemblySnapshot,
  DiffEntry,
  ContextTemplate,
  ContextEnricher,
  ContextAssemblyConfig,
} from './knowledge/context/index.js'

// ── Governance Layer (Phase 8 / MorPex v8) ──
export { RiskAnalyzer, AuditTrail, PolicyEngine, PermissionModel } from './governance/index.js';
export type {
  RiskLevel,
  RiskAssessment,
  RiskFactor,
  AuditEntry,
  AuditEventType,
  AuditReport,
  GovernanceConfig,
} from './governance/index.js';
export type {
  PolicyAction,
  ActionProposal,
  PolicyDecision,
  PolicyRule,
  PolicyEngineConfig,
  WorkflowTypePolicy,
  WorkflowSimulationProposal,
  WorkflowPolicyAction,
  WorkflowPolicyDecision,
  AgentPolicyRule,
  AgentPolicyDecision,
} from './governance/index.js';
export type {
  Permission,
  PermissionSet,
  PermissionCheck,
} from './governance/index.js';
export { DEFAULT_GOVERNANCE_CONFIG } from './governance/index.js';
export { DEFAULT_USER_PERMISSIONS } from './governance/index.js';

// ── Verification Engine (Phase 4 / MorPex v8) ──
export { VerificationEngine } from './execution/runtime/index.js';
export type { VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig } from './execution/runtime/index.js';

// ── Approval Engine (Phase 4 / MorPex v8) ──
export { ApprovalEngine } from './execution/runtime/index.js';
export type { ApprovalRequest, ApprovalStatus, ApprovalEngineConfig, ApprovalEventPayload, ApprovalStats } from './execution/runtime/index.js';

// ── Cognitive Layer (Phase 5-6 / MorPex v8) ──
// Personal Twin Graph
export { PersonalTwinGraph, BehaviorTwin } from './cognition/index.js';
export type {
  TwinNodeType,
  TwinEdgeType,
  TwinNode,
  TwinEdge,
  UserProperties,
  GoalProperties,
  ProjectProperties,
  DecisionProperties,
  PreferenceProperties,
  WorkflowProperties,
  ExperienceProperties,
  TwinQuery,
  TwinStats,
  DecisionProfile,
  SubgraphResult,
  TwinInsight,
  VersionHistoryEntry,
  TwinVersion,
} from './cognition/index.js';

// Personal Brain (Phase 6)
export { PersonalBrain, WorkflowMemory, DecisionMemory, BrainPersistor } from './cognition/index.js';
export type {
  MemoryLayer,
  MemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  BrainStats,
  WorkflowMemoryEntry,
  DecisionMemoryEntry,
  PreferenceMemoryEntry,
} from './cognition/index.js';
export { ALL_LAYERS } from './cognition/index.js';

// ── Workflow Intelligence (Phase 7) ──
export { WorkflowIntelligence } from './cognition/index.js';
export type {
  WorkflowPattern,
  WorkflowStep,
  OptimizationSuggestion as WorkflowOptimizationSuggestion,
  AutomationAssessment,
  IntelligenceReport,
} from './cognition/index.js';

// ── Decision Twin (P1 架构完善) ──
export { DecisionTwin } from './cognition/index.js';
export type {
  DecisionTwinProfile,
  FactorSummary,
  DecisionAnalysis,
  DecisionPrediction,
} from './cognition/index.js';

// ── Goal Plane (Phase 1 / v8.5) ──
export { GoalManager, GoalGraph } from './cognition/index.js';
export type {
  Goal,
  GoalStatus,
  GoalLevel,
  Objective,
  KeyResult,
  GoalGraphNode,
  GoalCreateInput,
  GoalStats,
} from './cognition/index.js';

// ── MorPex v8.6 Evolution Layer ──
export { WorkflowRegistry, WorkflowSimulator, WorkflowOptimizer, WorkflowExecutor } from './evolution/index.js';
export type { SimulationResult, SimulationMetrics, SimulatorConfig } from './evolution/index.js';
export type {
  WorkflowStatus,
  WorkflowVersion,
  WorkflowStepDef,
  VersionPerformance,
  RegisteredWorkflow,
  WorkflowCandidate,
  EvolutionReport,
  ExecutionResult as WorkflowExecutionResult,
  OptimizationPlan,
} from './evolution/index.js';

// ── v8.8 Workflow Contract ──
export { ContractValidator } from './evolution/index.js';
export type {
  WorkflowContract,
  ContractValidationResult,
} from './evolution/index.js';

// ── MorPex v8 Event Protocol ──
export {
  EventType,
  EVENT_LAYERS,
  getAllEventTypes,
  isStandardEvent,
  isEventInLayer,
  extractEventLayer,
  // Decision Events (v8.6: Cognitive Event Stream)
  createDecisionEvent,
  decisionToBaseEvent,
} from './infrastructure/protocol/index.js';
export type { BaseEvent, DecisionEvent, DecisionEventQuery } from './infrastructure/protocol/index.js';

// ── Event Sourcing (v9.2 Stage 0: 统一 SQLite EventStore + 旧版兼容) ──
export { SqliteEventStore, UnifiedEventStore, EventStore as EventSourcingStore, EventRepository, EventProjection } from './infrastructure/protocol/index.js';
export type { IEventStore, EventQueryFilter, EventStoreStats, EventStoreConfig as SourcingStoreConfig, EventQuery, AggregationResult, MissionProjection, SystemProjection } from './infrastructure/protocol/index.js';
export type { ReplayState, SourcingEvent } from './infrastructure/protocol/events/store/UnifiedEventStore.js';

// ── MorPex v8 Interaction Layer ──


// ── 类型导出 ──
export type {
  // 事件
  MorPexEvent,
  EventHandler,
  EventBus as EventBusInterface,

  // 执行身份（接口，区别于 ExecutionIdentity 类）
  ExecutionIdentity as ExecutionIdentityType,

  // 执行
  ExecutionRequest,
  ExecutionResult,
  ExecutionContext,
  Constraints,

  // 运行时
  AgentRuntimeAdapter,
  RuntimeHealth,
  KernelStatus,

  // 镜像
  ExecutionTrace,
  ContextSnapshot,
  SnapshotType,
  MirrorStats,
  MirrorRecord,
  MirrorStorage,

  // 插件
  MorPexPlugin,
  PluginContext,
} from './infrastructure/common/types.js';

// VectorStoreAdapter was a ghost module — removed

// ── AgentFactory (Conflict 1) — Agent 唯一工厂 ──


// MemoryBusListener was a ghost module — removed

// ── 会话上下文 (源自 core/types.ts) ──
export type {
  SessionContext,
} from './infrastructure/common/types.js';

// P4 收敛：内核扩展系统（ExtensionRegistry）已移除

// ── v8.8 Runtime: Sandbox, Budget, Compensation ──
export { SandboxManager } from './execution/runtime/sandbox/index.js';
export type { SandboxContext, SandboxExecutionResult } from './execution/runtime/sandbox/index.js';
export { BudgetManager } from './execution/runtime/budget/index.js';
export type { BudgetConfig, BudgetStatus } from './execution/runtime/budget/index.js';
export { CompensationEngine } from './execution/runtime/compensation/index.js';
export type { CompensationStep, SagaDefinition, CompensationResult } from './execution/runtime/compensation/index.js';

// ── v9.2 Phase 1: Resilience (RetryPolicy + CircuitBreaker + ErrorHandlerService) ──
export { RetryPolicy, CircuitBreaker, CircuitOpenError, ErrorHandlerService } from './execution/runtime/index.js';
export type { RetryPolicyConfig, BackoffStrategy, CircuitState, CircuitBreakerConfig, ExecutionContext as ErrorHandlerContext, ErrorRecord } from './execution/runtime/index.js';
export type { MissionCheckpoint } from './execution/runtime/checkpoint/index.js';

// ── v8.8 Observability ──
export { MetricsCollector, CompactionService } from './infrastructure/observability/index.js';
export type { MetricPoint, V9Metrics, CompactionConfig, CompactionResult as DbCompactionResult } from './infrastructure/observability/index.js';
export { TraceManager } from './infrastructure/observability/index.js';
export type { TraceSpan, MissionTrace } from './infrastructure/observability/index.js';
export { WorkflowMetrics } from './infrastructure/observability/index.js';
export type { WorkflowMetricsSnapshot } from './infrastructure/observability/index.js';

// ── Phase 3 ObservabilityLite ──
/** @deprecated 可观测性指标已合并到 EventBus.getMetrics() */
export { ObservabilityLite } from './infrastructure/observability/ObservabilityLite.js';
export type { HealthState, MetricCounter, LatencyStats, HealthEntry, ObservabilitySnapshot } from './infrastructure/observability/ObservabilityLite.js';

// ── v8.9 Reliability Plane ──

// ── v9.2 Cross-Agent Learning ──
export { CrossAgentLearningEngine as AgentLearningEngine, ExperienceRepository as AgentExperienceRepository, ExperienceSqliteRepository as AgentExperienceSqliteRepo } from './cognition/learning/index.js'
export type { GeneralizedExperience, ExperienceCategory, ExperienceQuery } from './cognition/learning/index.js'

// ── v11 Evolution Engine ──
export { FailureAnalyzer } from './evolution/index.js';
export type {
  FailureMode,
  FailureCategory as EvolutionFailureCategory,
  WorkflowFailureAnalysis,
  FailureAnalysisConfig,
} from './evolution/index.js';

// ── v11 Execution Fabric ──
export { ExecutionFabric } from './execution/index.js';
export type {
  AgentCapability,
  CapabilityResolution,
  ExecutionFabricConfig,
} from './execution/index.js';

// ── Phase 2: Unified Execution Engine + SubAgentFork ──
export { UnifiedExecutionEngine, SubAgentFork } from './execution/index.js';
export type {
  ExecutionMode,
  ExecutionStatus,
  EngineHealth,
  SubAgentTask,
  SubAgentFleet,
  FleetStats,
  ConnectorRegistryLike,
} from './execution/index.js';

// ── Phase 2: DeliveryPlanner ──
export { DeliveryPlanner } from './cognition/planning/index.js';
export type {
  PlanningMode,
  PlanningRequest,
  Plan,
  PlanTask,
} from './cognition/planning/index.js';

// ── v9 Config Schema (Zod)
export { MorPexConfigSchema } from '../config/MorPexConfig.js';
export type { MorPexConfig, ConfigChangeListener } from '../config/MorPexConfig.js';

// ── PiBridge（v11 稳定抽象层）
export { PiBridge } from './infrastructure/adapters/pi-bridge/index.js';
export type { GenerateParams, GenerateResult, ModelInfo as PiModelInfo } from './infrastructure/adapters/pi-bridge/index.js';


// ── v12 Bootstrap — 组织层 + 交付层统一引导
// ── Phase 4.5: BrainFacade（统一大脑门面） ──
export { BrainFacade } from './cognition/BrainFacade.js';
export type {
  BrainContext,
  BrainExperience,
  BrainMemory,
  BrainInsight,
  BrainStats as BrainFacadeStats,
  BrainForgetCriteria,
  ConsolidationResult,
  CEOReport,
  CrossDeptSynthesis,
  PersonalBrainLike,
  MemoryWikiLike,
  LearningLoopLike,
  EvolutionEngineLike,
} from './cognition/BrainFacade.js';

// ═══════════════════════════════════════════════════════════════
// v16 Unified Bootstrap — 唯一入口
// ═══════════════════════════════════════════════════════════════
export { bootstrapUnified } from './bootstrap-unified.js';
export type { UnifiedBootstrapResult } from './bootstrap-unified.js';

// ═══════════════════════════════════════════════════════════════
// @deprecated 旧版本 Bootstrap — 请使用 bootstrapUnified()
// ═══════════════════════════════════════════════════════════════
/** @deprecated 请使用 bootstrapUnified */

// ═══════════════════════════════════════════════════════════════
// v13 增强模块
// ═══════════════════════════════════════════════════════════════

// ── Brain 增强: ReflectionEngine + MetaLearner (已合并到 cognition 层) ──
export { ReflectionEngine, MetaLearner } from './cognition/index.js';
export type {
  BrainReflectionState,
  BrainReflectionResult,
  ReflectionEngineLike,
} from './cognition/index.js';
export type {
  TaskRecord,
  UserFeedback,
  LearningResult,
  MetaLearnerLike,
} from './cognition/index.js';

// ── Planner 增强: HierarchicalPlanner (HTN) ──
export { HierarchicalPlanner } from './cognition/planning/HierarchicalPlanner.js';
export type {
  DAGPlan,
  SubGoal,
  HierarchicalPlannerLike,
} from './cognition/planning/HierarchicalPlanner.js';

// ── 动态工具层: ToolFactory + ToolRegistry ──
export { ToolFactory, ToolRegistry } from './infrastructure/tools/index.js';
export type { ToolSchema, RegisteredTool, ToolGenContext } from './infrastructure/tools/index.js';

// ── 通用原语注册中心（第 6 层：DomainPrimitiveRegistry）──
export { DomainPrimitiveRegistry } from './infrastructure/tools/DomainPrimitiveRegistry.js';
export type {
  PrimitiveRegistration,
  PrimitiveMatchResult,
  PrimitiveStats,
} from './infrastructure/tools/DomainPrimitiveRegistry.js';

// ── 通用基础原语 ──
export {
  KnowledgeQueryPrimitive,
  FileOperationPrimitive,
  ArtifactGenerationPrimitive,
  ShellExecutionPrimitive,
  APICallPrimitive,
} from './infrastructure/tools/primitives/index.js';
export type {
  ActionPrimitive,
  ActionResult,
  KnowledgeQuery,
  KnowledgeQueryResult,
  FileOperationRequest,
  ArtifactGenerationRequest,
  ArtifactGenerationResult,
  APICallRequest,
  ShellExecutionRequest,
} from './infrastructure/tools/primitives/index.js';

// ── 治理看板: GovernanceDashboard (VCOS 100) ──
export { GovernanceDashboard } from './governance/index.js';

// ── v13 Bootstrap ──
/** @deprecated 请使用 bootstrapUnified */



// ═══════════════════════════════════════════════════════════════
// v14 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Goal Intelligence (v14) — ConstraintAnalyzer 已从 goal-intelligence/intent 导出
export { GoalIntelligenceFacade, GoalParser, GoalValidator } from './cognition/planning/goal-intelligence/index.js';
export type { GoalParseResult, GoalContext } from './infrastructure/protocol/contracts/goal.js';

// v16 ArtifactFacade 替代 (v14 版本)
export type { Artifact, ArtifactType } from './infrastructure/protocol/contracts/artifact.js';

// ── Verification Engine (v14) — VerificationEngine 已从 runtime 导出；验证簇已迁至 evaluation/verification（Wave 8a）
export { QualityRule, ArtifactChecker, ExecutionVerifier, RepairPlanner } from './evaluation/index.js';
export type { QualityCheck, CheckResult, RepairPlan } from './evaluation/index.js';


// ── v14 Bootstrap ──
/** @deprecated 请使用 bootstrapUnified */


// ═══════════════════════════════════════════════════════════════
// v15 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Dynamic Team Orchestration (v15) ──
export { DynamicTeamOrchestrator, TeamBuilder, AgentAllocator, DependencyCoordinator } from './execution/index.js';
export type { DynamicTeam, TeamMember, DependencyGraph, TeamSpec } from './execution/types.js';

// ── Workflow Plugin System (v15) — 别名避免与 evolution/WorkflowRegistry 冲突 ──
export { WorkflowRegistry as WorkflowPluginRegistry } from './workflow/index.js';
export type { WorkflowProvider, WorkflowAction } from './workflow/index.js';

// ── Compliance Checker (v15) — PolicyRule 已从 control/PolicyEngine 导出 ──
export { ComplianceChecker, PolicyRuleRegistry } from './governance/index.js';
export type { ComplianceResult } from './governance/index.js';

// ── Runtime Governance (v15) ──
export { RuntimeManager, CostController, AlertEngine } from './governance/index.js';
export type { Alert, AlertLevel } from './governance/index.js';

// ── Self Improvement Loop (v15) — Wave 3a 已迁至 evolution/ ──
export { SelfImprovementLoop, ImprovementAnalyzer, EvolutionProposal } from './evolution/index.js';
export type { ImprovementInsight, Proposal } from './evolution/index.js';

// ── v15 Bootstrap ──
/** @deprecated 请使用 bootstrapUnified */


// ═══════════════════════════════════════════════════════════════
// v16 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Mission Control (v16) — 项目总控 ──
export { MissionController } from './execution/runtime/mission/MissionController.js';
export type { MissionState as MissionControlState, MissionStatus, MissionPhase, MissionUpdate, BlockReason } from './execution/runtime/mission/MissionTypes.js';

// ── Capability Registry (v16) — 能力目录 ──
export { CapabilityRegistry, CapabilityDiscoverer } from './governance/capability/index.js';
export type { Capability as SystemCapability } from './governance/capability/index.js';

// ── Simulation Layer (v16) — 执行前模拟 ──
export { ExecutionSimulator } from './execution/runtime/simulation/index.js';
export type { SimulationInput, SimulationResult as SimulatedResult } from './execution/runtime/simulation/index.js';

// ── Approval Gate (v16) — 审批门 ──
export { ApprovalGate } from './governance/index.js';
export type { ApprovalRequest as ApprovalGateRequest, ApprovalDecision } from './governance/index.js';

// ── Artifact Lifecycle (v16) — 升级版 ──
export type { ArtifactLifecycleStatus, ArtifactLineageEntry } from './infrastructure/protocol/contracts/artifact-lifecycle.js';

// ── Stabilization: Evaluation ──
export { EvaluationEngine, QualityScorer } from './evaluation/index.js';
export type { SystemScore } from './evaluation/index.js';



// ── Stabilization: Agent Capability Registry ──
export { AgentCapabilityRegistry } from './governance/capability/index.js';
export type { AgentDeclaration } from './governance/capability/index.js';

// ── Stabilization: Benchmark ──

// ── Organization Twin (Phase 2) ──
export { OrganizationTwin } from './cognition/twin/index.js';
export type { OrgRole, OrgDecision } from './cognition/twin/index.js';

// ── Safety Monitor (Phase 2) ──
export { SafetyMonitor } from './cognition/index.js';
export type { Observation } from './cognition/index.js';

// ── Policy Engine (Phase 2 — 统一策略引擎) ──

// ── Metadata Graph (Phase 2) ──
export { SystemMetadataGraph, systemMetadataGraph } from './knowledge/graph/index.js';
export type { Entity, EntityType, Relation, RelationType } from './knowledge/graph/index.js';

// ── v16 Bootstrap ──
/** @deprecated 请使用 bootstrapUnified */


