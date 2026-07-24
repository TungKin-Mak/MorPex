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
export { MorPexKernel } from './common/Kernel.js';
export type { KernelConfig } from './common/Kernel.js';

// ── Core 组件 ──
export { EventBus } from './common/EventBus.js';
export { ExecutionIdentity } from './common/ExecutionIdentity.js';
export { PluginSystem } from './common/PluginSystem.js';

// ── Gateway（内部使用，不对外暴露）─

// ═══════════════════════════════════════════════════════════════
// Phase 0 — 组织层（一人虚拟公司部门体系）
// ═══════════════════════════════════════════════════════════════
export { DepartmentManager, DepartmentContext, LeadAgentOrchestrator, DepartmentMemoryAdapter } from './department/index.js';
export type { Department, DepartmentId, DepartmentType, DepartmentStatus, CreateDepartmentParams, DepartmentStats } from './department/index.js';
export type { LeadAgent, TaskAssignment, OrchestrationResult, LeadAgentStats } from './department/index.js';

export { RoleRegistry } from './role/index.js';
export type { Role, RoleId, RoleName, RoleAssignment } from './role/index.js';

export { OrganizationContextLite, ManagementHub } from './organization/index.js';
export type { OrganizationContext, OrganizationScope } from './organization/index.js';
export type { ParsedCommand, HubStatusReport } from './organization/index.js';

export { CompanyFacade } from './facade/index.js';

// ── Agent Harness v2 (Phase 2) ──
export { AgentHarness, ContextBuilder } from './planes/agent-plane/index.js';
export type {
  HarnessContext,
  IntentContext,
  PlanContext,
  MemoryContext,
  ArtifactContext,
  ExecutionState as HarnessExecutionState,
  PermissionContext,
  ExperienceContext,
} from './planes/agent-plane/index.js';
export type { MemoryRecord, ArtifactRef as AgentArtifactRef, Experience as AgentExperience, HarnessEventCallback } from './planes/agent-plane/index.js';

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
  RuntimeKernelIntegrator,
} from './runtime/index.js';
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
  RuntimeKernelConfig,
} from './runtime/index.js';

// ── Mirror ──
export { ExecutionMirror } from './mirror/ExecutionMirror.js';
// ExecutionRecordingEngine was a ghost module — removed
export { JSONLStorage } from './mirror/storage/JSONLStorage.js';

// ── Pi 集成模块 ──
export { THINKING_LEVELS, THINKING_LEVEL_LABELS, DEFAULT_THINKING_LEVEL, getSupportedLevels, clampLevel, parseThinkingLevel, clearModelCache } from './common/ThinkingLevelControl.js';
export type { ThinkingLevel } from './common/ThinkingLevelControl.js';

// ── Phase 4.6: ProgressCallback + ToolQualityTracker ──
export { makeProgressEvent } from './common/ProgressCallback.js';
export type { ProgressEvent, ProgressEventType, ProgressCallback } from './common/ProgressCallback.js';
export { ToolQualityTracker } from './common/ToolQualityTracker.js';
export type { ToolStats } from './common/ToolQualityTracker.js';

export { listProviders, listModels, listAllProviders, findModel, getDefaultModel } from './common/ModelRegistry.js';
export type { ModelInfo, ProviderInfo } from './common/ModelRegistry.js';

// AgentService / createBuiltinTools — 内部模块，不对外暴露

// ── 跨领域升级模块 (Phase 8-12) ──
export { DomainManifestLoader, DomainCluster, DomainClusterManager } from './domains/index.js';
export type { LLMCaller } from './domains/DomainClusterManager.js';
// LLMCaller also exported from CrossDomainRouter — same type, re-exported here via DomainClusterManager
export type {
  DomainManifest, MasterAgentConfig, ArtifactSpec, WakeConditions,
  ClusterStatus, TaskDecomposition, DecomposedTask, DAGNode,
  DAGNode as CrossDomainDAGNode,
  ArtifactRef, DomainTaskCompletedEvent,
  InterrogationTicket, TicketRound, TicketStatus, ConflictType,
  ClusterStatusReport, ValidationResult, ValidationError,
} from './domains/types.js';

// ── Cross-Domain Router (Phase 10) + RouterLite (Phase 3) ──
/** @deprecated 路由功能已合并到 BrainFacade.routeByIntent() */
export { CrossDomainRouter, RouterLite } from './router/index.js';
export { DomainDispatcher } from './router/DomainDispatcher.js';
export { ArbitrationHandler } from './router/ArbitrationHandler.js';
export type {
  NodeResult,
  DAGExecutionResult,
  DomainHandler,
  DomainRoute,
} from './router/index.js';
// LLMCaller type already exported above from DomainClusterManager
export type {
  ArbitrationVerdict,
} from './router/ArbitrationHandler.js';

// ── Knowledge Plane — Artifact Intelligence (Phase 3) ──
export { ArtifactGraph, ArtifactLineage, ArtifactEvaluator, ArtifactDependencyResolver, ArtifactEmbedding } from './planes/knowledge-plane/artifacts/index.js';
export type { ArtifactNode, ArtifactEdge, ArtifactCapability, ArtifactDependency, ArtifactUsageRecord, ArtifactEvaluation, LineageQuery, LineagePath, ArtifactEmbedding as ArtifactEmbeddingType } from './planes/knowledge-plane/artifacts/index.js';

// ── v9.1 Independent Artifact Plane ──
export { ArtifactPlane, ArtifactManager, ArtifactRepository, ArtifactStagingArea, ArtifactValidator, ArtifactVerifier, ArtifactVersionService, ArtifactEventEmitter, ArtifactLineageTracker, ArtifactSqliteRepository } from './planes/artifact-plane/index.js';
export type {
  ArtifactType as ArtifactPlaneType,
  ArtifactStatus as ArtifactPlaneStatus,
  ArtifactMeta,
  ArtifactRef as ArtifactPlaneRef,
  ArtifactRecord,
  ArtifactVerificationResult,
  ArtifactEvent,
  ArtifactEventType,
  ArtifactQuery as ArtifactPlaneQuery,
  CreateArtifactInput,
  ValidationRule,
  ValidationIssue,
  ValidationResult as ArtifactValidationResult,
  VerificationConfig,
  VersionInfo,
  VersionTag,
  VersionDiff,
  LineageRelation,
  LineageEdge as ArtifactLineageEdge,
  LineagePath as ArtifactPlaneLineagePath,
  StagingConfig,
} from './planes/artifact-plane/index.js';

// ── Memory Activation Engine (Phase 4) ──
export { MemoryActivationEngine } from './memory/MemoryActivationEngine.js';
export type { ActivationContext, ActivationResult } from './memory/MemoryActivationEngine.js';

// ── Intent Intelligence Layer (Phase 5) ──
export { GoalExtractor, ConstraintAnalyzer, PriorityEngine, RiskDetector, ExecutionPolicyGenerator, IntentResolver } from './planes/control-plane/intent/index.js';
export type { StructuredGoal } from './planes/control-plane/intent/index.js';
// Constraints exported from common/types.js below (canonical)
export type { Constraints as IntentConstraints } from './planes/control-plane/intent/index.js';
export type { PriorityResult, PriorityFactor } from './planes/control-plane/intent/index.js';
export type { Risk } from './planes/control-plane/intent/index.js';
export type { ExecutionPolicy } from './planes/control-plane/intent/index.js';

// ── Learning Loop (Phase 6) ──
export { ExperienceExtractor, PlanEvaluator, StrategyOptimizer, TemplateEvolutionEngine } from './learning/index.js';
export type { ExecutionRecord, Experience } from './learning/index.js';
// PlanEvaluation kept from learning (canonical); extensions re-export aliased below
export type { PlanEvaluation } from './learning/index.js';
export type { OptimizationSuggestion } from './learning/index.js';
export type { PlanTemplate, TemplateRecommendation } from './learning/index.js';

// ── Cross-Domain Events (Phase 11) ──
export { CrossDomainEventTypes } from './events/CrossDomainEvents.js';
export type {
  CrossDomainEvent,
  DomainWakingEvent,
  DomainActiveEvent,
  DomainSleepingEvent,
  DomainTaskDoneEvent,
  DomainErrorEvent,
  CrossDomainDAGCreatedEvent,
  CrossDomainArtifactSharedEvent,
  ArtifactCreatedEvent,
  ArtifactUpdatedEvent,
} from './events/CrossDomainEvents.js';

// ── EventStore (Phase 1.3) — @deprecated 使用 UnifiedEventStore 代替
/** @deprecated 使用 UnifiedEventStore 代替 */
export { EventStore } from './event/EventStore.js';

// ── TeamSayTool (Phase 3.2) ──
export { TeamSayTool, createTeamSayTool } from './tools/TeamSayTool.js';
export type { AgentRegistry } from './tools/TeamSayTool.js';

// ── ReadArtifactTool (Phase 3.4) ──
export { createReadArtifactTool } from './tools/ReadArtifactTool.js';

// ── 提示词系统 — 三级分封架构 (Leader→Expert→Fork) ──
export { compileLeaderPrompt, compileExpertPrompt, createAstroMTrace } from './prompts/index.js';
export type { PromptTemplate, PromptCompileOptions, AstroMTrace } from './prompts/index.js';

// ── 三级分封工具 (v2.4) ──
export { AgentCreateTool, createAgentCreateTool } from './tools/AgentCreateTool.js';
export { ForkExecuteTool, createForkExecuteTool } from './tools/ForkExecuteTool.js';

// ── Memory Search Tool (v2.6) — LLM 可主动调用 search_memory ──
export { createMemorySearchTool } from './tools/memory-search-tool.js';

// ── Memory Hooks (Phase 4) ──
export { createAutoMemoryHook, createReasoningMemoryHook } from './memory/MemoryHooks.js';
export type { MemoryBus } from './memory/MemoryHooks.js';

// ── Memory Messages (Phase 4.3) ──
export { convertMemoryHintToLlm, convertDagNodeStatusToLlm, createCustomConvertToLlm, isMemoryHintMessage, isDagNodeStatusMessage } from './memory/MemoryMessages.js';

// ── PermissionEngine (Phase 1.2) — 运行时工具调用拦截器 ──
export { PermissionEngine } from './permission/PermissionEngine.js';
export type { PermissionMode, PermissionRule, PermissionResult, ToolCallInfo } from './permission/PermissionEngine.js';

// ── CompactionPolicy (Phase 2.2) — 上下文压缩策略接口 ──
export { SlidingWindowCompaction, estimateTokens, estimateContextTokens } from './compaction/CompactionPolicy.js';
export type { CompactionPolicy, CompactionStrategy, CompactionContext, CompactionResult } from './compaction/CompactionPolicy.js';

// ── SessionProjection (Phase 3.6) — 会话状态读模型投影 ──
export { SessionProjection } from './projection/SessionProjection.js';
export type { ProjectionParams, ProjectionRecord, DAGNodeProjection, AgentStateProjection, ArtifactProjection, TimelineEntry, ConstraintProjection } from './projection/SessionProjection.js';

// ── Negotiation (Phase 11.5) ──
/** @deprecated 协商功能已合并到 LeadAgentOrchestrator.resolveTaskConflict() */
export { NegotiationEngine, NegotiationLite } from './negotiation/index.js';
export type {
  CreateTicketParams,
  NegotiationEngineConfig,
  NegotiationCallbacks,
  LiteTicket,
  LiteTicketStatus,
  Resolution,
} from './negotiation/index.js';

// ── Industry Plugin (v3.1) — 行业适配引擎 ──
export { IndustryPlugin } from './industry/plugin.js';
export { IndustryRegistry } from './industry/IndustryRegistry.js';
export type {
  IndustryType,
  IndustryAdapter,
  IndustryPluginConfig,
  WorkflowTemplate,
  WorkflowStep as IndustryWorkflowStep,
} from './industry/types.js';

// ── Skill 工具（内部使用，不对外暴露）─

// ── MorPex v8 Mission Runtime ──
export {
  MissionState,
  MISSION_VALID_TRANSITIONS,
  MissionRuntime,
} from './runtime/index.js';
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
} from './runtime/index.js';

// ── Mission Runtime Adapters (P0 架构完善) ──
export { MetaPlannerAdapter, DAGExecutorAdapter } from './runtime/index.js';

// ── v9.1 Context Assembly Layer ──
export {
  ContextAssemblyEngine,
  ContextFragmentRegistry,
  ContextBuilder as ContextAssemblyBuilder,
  ContextVersioner,
  ContextTemplateRepository,
  ContextEnricherPipeline,
  ContextPersistence,
} from './context/index.js'
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
} from './context/index.js'

// ── Governance Layer (Phase 8 / MorPex v8) ──
export { RiskAnalyzer, AuditTrail, PolicyEngine, PermissionModel } from './control/index.js';
export type {
  RiskLevel,
  RiskAssessment,
  RiskFactor,
  AuditEntry,
  AuditEventType,
  AuditReport,
  GovernanceConfig,
} from './control/index.js';
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
} from './control/index.js';
export type {
  Permission,
  PermissionSet,
  PermissionCheck,
} from './control/index.js';
export { DEFAULT_GOVERNANCE_CONFIG } from './control/index.js';
export { DEFAULT_USER_PERMISSIONS } from './control/index.js';

// ── Verification Engine (Phase 4 / MorPex v8) ──
export { VerificationEngine } from './runtime/index.js';
export type { VerificationResult, VerificationCheck, VerificationIssue, VerificationEngineConfig } from './runtime/index.js';

// ── Approval Engine (Phase 4 / MorPex v8) ──
export { ApprovalEngine } from './runtime/index.js';
export type { ApprovalRequest, ApprovalStatus, ApprovalEngineConfig, ApprovalEventPayload, ApprovalStats } from './runtime/index.js';

// ── Cognitive Runtime Loop (Phase 6 / MorPex v8.5) ──
export { CognitiveLoop, CognitivePipeline } from './runtime/index.js';
export type { CognitiveStage, CognitiveContext, CognitivePhase, DetectedIntent, LoopStats, WorkflowCandidateEntry, BehaviorDriftEntry, TwinCandidate, EvidenceAggregation } from './runtime/index.js';

// ── v8.6 Pipeline Stages (v9.1: +ContextStage) ──
export {
  ContextStage,
  IntentStage,
  GoalStage,
  TwinStage,
  PlanningStage,
  ExecutionStage,
  LearningStage,
  EvolutionStage,
  PersistenceStage,
} from './runtime/index.js';

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
export { WorkflowMiner, WorkflowRegistry, WorkflowOptimizer, WorkflowExecutor, WorkflowSimulator } from './evolution/index.js';
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

// ── v8.8 Workflow Testing ──
export { WorkflowTestRunner } from './evolution/index.js';
export type {
  WorkflowTestCase,
  WorkflowTestResult,
  WorkflowTestSuiteResult,
} from './evolution/index.js';

// ── v8.8 Artifact Lineage (aliased to avoid conflict with Phase 3 Knowledge Plane ArtifactLineage) ──
export { ArtifactLineage as WorkflowArtifactLineage } from './evolution/index.js';
export type {
  ArtifactNode as WorkflowArtifactNode,
  ArtifactEdge as WorkflowArtifactEdge,
  LineageQuery as WorkflowLineageQuery,
  LineagePath as WorkflowLineagePath,
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
} from './protocol/index.js';
export type { BaseEvent, DecisionEvent, DecisionEventQuery } from './protocol/index.js';

// ── Event Sourcing (v9.2 Stage 0: 统一 SQLite EventStore + 旧版兼容) ──
export { SqliteEventStore, UnifiedEventStore, EventStore as EventSourcingStore, EventRepository, EventProjection } from './protocol/index.js';
export type { IEventStore, EventQueryFilter, EventStoreStats, EventStoreConfig as SourcingStoreConfig, EventQuery, AggregationResult, MissionProjection, SystemProjection } from './protocol/index.js';
export type { ReplayState, SourcingEvent } from './protocol/events/store/UnifiedEventStore.js';

// ── MorPex v8 Interaction Layer ──
export {
  MessageGateway,
  GroupChatManager,
  WebAdapter,
  CLIAdapter,
  WeChatAdapter,
  FeishuAdapter,
} from './interaction/index.js';
export type {
  IncomingMessage,
  OutgoingMessage,
  ChannelAdapter,
  SessionInfo,
  MessageHandler,
  ChatGroup,
  ChatMessage,
  GroupMember,
  GroupId,
  GroupType,
  MessageType,
  GroupChatStats,
  ExternalIMAdapter,
} from './interaction/index.js';

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
} from './common/types.js';

// VectorStoreAdapter was a ghost module — removed

// ── EventStore Subscriber (Conflict 9) — EventBus 中介持久化 ──
export { EventStoreSubscriber } from './event/EventStoreSubscriber.js';

// ── AgentFactory (Conflict 1) — Agent 唯一工厂 ──
export { AgentFactory, SecurityBoundaryException } from './services/AgentFactory.js';
export type { AgentSpawnContext } from './services/AgentFactory.js';

// ── ExecutionOrchestrator (Conflict 3) — Control Plane 编排器 ──
export { ExecutionOrchestrator } from './planes/control-plane/orchestrator/ExecutionOrchestrator.js';
export type { ExecutionDAG } from './planes/control-plane/orchestrator/ExecutionOrchestrator.js';

// MemoryBusListener was a ghost module — removed

// ── 会话上下文 (源自 core/types.ts) ──
export type {
  SessionContext,
} from './common/types.js';

// ── 内核扩展（v3.1）— 产物血缘 + 上下文智能 + 自愈运行时 + 计划智能 ──
export {
  ExtensionRegistryImpl,
  MetaPlanner,
  PlanExperienceStore,
  PlanAnalyzer,
  PipelineExecutor,
  SessionErrorExtractor,
  PlanningIntelligenceEngine,
  DEFAULT_EXTENSIONS_CONFIG,
  DEFAULT_META_PLANNER_CONFIG,
} from './extensions/index.js';

export type {
  ArtifactNode as ExtensionArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery as ExtensionLineageQuery,
  LineageQueryResult,
  ContextSegment,
  PruningDecision,
  PruningResult,
  BeforeNodeExecutePayload,
  AfterNodeExecutePayload,
  BeforeLLMCallPayload,
  AfterLLMCallPayload,
  OnFatalErrorPayload,
  ExtensionDefinition,
  ExtensionContext,
  ExtensionRegistry,
  ExtensionStatus,
  ExtensionLogger,
  KernelExtensionsConfig,
  // Planning Intelligence Layer
  PlanTemplate as ExtensionPlanTemplate,
  PlanNodeSkeleton,
  PlanExecutionRecord,
  DAGNodeRecord,
  FailureDetail,
  FailureCategory,
  PlanEvaluation as ExtensionPlanEvaluation,
  PlanDimensionScores,
  PlanTrend,
  PlanSuggestion,
  PlanMatchResult,
  PlanAdjustment,
  MetaPlannerConfig,
  FailurePatternReport,
  PlanStoreStats,
  // PipelineExecutor types
  PipelineExecutorConfig,
  PipelineDeps,
  PipelineInput,
  SessionErrorReport,
} from './extensions/index.js';

// CheckpointManager was a ghost module — removed

// ── v8.8 Runtime: Sandbox, Budget, Compensation ──
export { SandboxManager } from './runtime/sandbox/index.js';
export type { SandboxContext, SandboxExecutionResult } from './runtime/sandbox/index.js';
export { BudgetManager } from './runtime/budget/index.js';
export type { BudgetConfig, BudgetStatus } from './runtime/budget/index.js';
export { CompensationEngine } from './runtime/compensation/index.js';
export type { CompensationStep, SagaDefinition, CompensationResult } from './runtime/compensation/index.js';

// ── v9.2 Phase 1: Resilience (RetryPolicy + CircuitBreaker + ErrorHandlerService) ──
export { RetryPolicy, CircuitBreaker, CircuitOpenError, ErrorHandlerService } from './runtime/index.js';
export type { RetryPolicyConfig, BackoffStrategy, CircuitState, CircuitBreakerConfig, ExecutionContext as ErrorHandlerContext, ErrorRecord } from './runtime/index.js';
export type { MissionCheckpoint } from './runtime/checkpoint/index.js';

// ── v8.8 Observability ──
export { MetricsCollector, CompactionService } from './observability/index.js';
export type { MetricPoint, V9Metrics, CompactionConfig, CompactionResult as DbCompactionResult } from './observability/index.js';
export { TraceManager } from './observability/index.js';
export type { TraceSpan, MissionTrace } from './observability/index.js';
export { WorkflowMetrics } from './observability/index.js';
export type { WorkflowMetricsSnapshot } from './observability/index.js';

// ── Phase 3 ObservabilityLite ──
/** @deprecated 可观测性指标已合并到 EventBus.getMetrics() */
export { ObservabilityLite } from './observability/ObservabilityLite.js';
export type { HealthState, MetricCounter, LatencyStats, HealthEntry, ObservabilitySnapshot } from './observability/ObservabilityLite.js';

// ── v8.9 Reliability Plane ──
import { ReplayEngine as RelReplayEngine, EventReplayer } from './reliability/index.js'
export { ReliabilityScorer, computeProductionScore } from './reliability/index.js';
export type { ReliabilityMetrics } from './reliability/index.js';
/** @deprecated Use ReliabilityReplayEngine (from Reliability Plane) instead */
const ReliabilityReplayEngine = RelReplayEngine
const ReliabilityEventReplayer = EventReplayer
export { ReliabilityReplayEngine, ReliabilityEventReplayer }
export type { ReplayState as ReliabilityReplayState, ReplayComparison } from './reliability/index.js';

// ── v9.0 Agent Organization Plane (aliases to avoid conflicts with existing exports) ──
import {
  AgentRegistry as AgentRegistryCore,
  NegotiationEngine as AgentNegotiationEngine,
} from './agent/index.js'
export { AgentProfileManager, AgentScheduler, AssignmentStrategy, AgentMessageBus, AgentContextFactory, ResultAggregator } from './agent/index.js'
export { AgentRegistry as AgentOrganizationRegistry, NegotiationEngine as AgentNegotiation } from './agent/index.js'
export type { AgentIdentity, AgentProfile, Capability, CapabilityGraph, CapabilityMatchResult } from './agent/index.js'
export type { AgentRole, AgentGovernanceMetadata, AgentGovernanceStats } from './agent/index.js'
export type { TaskRequirement, AgentAssignment, AgentMessage, AgentResponse } from './agent/index.js'
export type { CollaborationPlan, CollaborationTask, CollaborationResult } from './agent/index.js'
export type { AgentIdentity as AgentIdentityInterface, AgentProfile as AgentProfileInterface } from './agent/index.js'
export type { AgentMessage as AgentMessageInterface, AgentMemoryScope, AgentExecutionContext, AssignmentStrategyType, NegotiationRequest, NegotiationResponse } from './agent/index.js'

// ── v9.2 Cross-Agent Learning ──
export { CrossAgentLearningEngine as AgentLearningEngine, ExperienceRepository as AgentExperienceRepository, ExperienceSqliteRepository as AgentExperienceSqliteRepo } from './agent/index.js'
export type { GeneralizedExperience, ExperienceCategory, ExperienceQuery } from './agent/index.js'

// ── v11 Evolution Engine ──
export { ExperienceMiner, FailureAnalyzer, PatternExtractor } from './evolution/index.js';
export { SOPEngine } from './evolution/SOPEngine.js';
export type {
  MinedExperience,
  MiningConfig,
  FailureMode,
  FailureCategory as EvolutionFailureCategory,
  WorkflowFailureAnalysis,
  FailureAnalysisConfig,
  ExtractedPattern,
  PatternCategory,
  PatternExtractorConfig,
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
export { DeliveryPlanner } from './planner/index.js';
export type {
  PlanningMode,
  PlanningRequest,
  Plan,
  PlanTask,
} from './planner/index.js';

// ── v9 Config Schema (Zod)
export { MorPexConfigSchema } from '../config/MorPexConfig.js';
export type { MorPexConfig, ConfigChangeListener } from '../config/MorPexConfig.js';

// ── PiBridge（v11 稳定抽象层）
export { PiBridge } from './adapters/pi-bridge/index.js';
export type { GenerateParams, GenerateResult, ModelInfo as PiModelInfo } from './adapters/pi-bridge/index.js';

// ── 唯一入口（v2.4 门面模式） — 对外只暴露 bootstrapMorPexCore
export { bootstrapMorPexCore } from '../bootstrap.js';
export type { BootstrapConfig } from '../bootstrap.js';

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

export { bootstrapV12 } from './bootstrap-v12.js';
export type { V12BootstrapResult } from './bootstrap-v12.js';

// ═══════════════════════════════════════════════════════════════
// v13 增强模块
// ═══════════════════════════════════════════════════════════════

// ── Brain 增强: ReflectionEngine + MetaLearner ──
export { ReflectionEngine, MetaLearner } from './brain/index.js';
export type {
  BrainReflectionState,
  BrainReflectionResult,
  ReflectionEngineLike,
} from './brain/index.js';
export type {
  TaskRecord,
  UserFeedback,
  LearningResult,
  MetaLearnerLike,
} from './brain/index.js';

// ── Planner 增强: HierarchicalPlanner (HTN) ──
export { HierarchicalPlanner } from './planner/HierarchicalPlanner.js';
export type {
  DAGPlan,
  SubGoal,
  HierarchicalPlannerLike,
} from './planner/HierarchicalPlanner.js';

// ── 动态工具层: ToolFactory + ToolRegistry ──
export { ToolFactory, ToolRegistry } from './tools/index.js';
export type { ToolSchema, RegisteredTool, ToolGenContext } from './tools/index.js';

// ── 领域原语: AmazonListingAction, MarketResearchAction ──
export { AmazonListingAction, MarketResearchAction } from './tools/primitives/index.js';
export type { ActionPrimitive, ActionResult, ListingData, ListingResult } from './tools/primitives/index.js';

// ── 治理看板: GovernanceDashboard (VCOS 100) ──
export { GovernanceDashboard } from './governance/index.js';

// ── v13 Bootstrap ──
export { bootstrapV13 } from './bootstrap-v13.js';
export type { V13BootstrapResult } from './bootstrap-v13.js';



// ═══════════════════════════════════════════════════════════════
// v14 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Goal Intelligence (v14) — ConstraintAnalyzer 已从 planes/control-plane/intent 导出
export { GoalIntelligenceFacade, GoalParser, GoalValidator } from './goal-intelligence/index.js';
export type { GoalParseResult, GoalContext } from './contracts/goal.js';

// v16 ArtifactFacade 替代 (v14 版本)
export type { Artifact, ArtifactType } from './contracts/artifact.js';

// ── Verification Engine (v14) — VerificationEngine 已从 runtime 导出，用别名
export { QualityRule, ArtifactChecker, ExecutionVerifier, RepairPlanner } from './verification/index.js';
export type { QualityCheck, CheckResult, RepairPlan } from './verification/index.js';

export { CapabilityStore, SOPRegistry } from './experience/index.js';
export type { CapabilityPattern, SOP } from './experience/index.js';

// ── v14 Bootstrap ──
export { bootstrapV14 } from './bootstrap-v14.js';
export type { V14BootstrapResult } from './bootstrap-v14.js';


// ═══════════════════════════════════════════════════════════════
// v15 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Dynamic Team Orchestration (v15) ──
export { DynamicTeamOrchestrator, TeamBuilder, AgentAllocator, DependencyCoordinator } from './organization/index.js';
export type { DynamicTeam, TeamMember, DependencyGraph, TeamSpec } from './organization/index.js';

// ── Workflow Plugin System (v15) — 别名避免与 evolution/WorkflowRegistry 冲突 ──
export { WorkflowRegistry as WorkflowPluginRegistry } from './workflow/index.js';
export type { WorkflowProvider, WorkflowAction } from './workflow/index.js';

// ── Compliance Checker (v15) — PolicyRule 已从 control/PolicyEngine 导出 ──
export { ComplianceChecker, PolicyRuleRegistry } from './verification/index.js';
export type { ComplianceResult } from './verification/index.js';

// ── Runtime Governance (v15) ──
export { RuntimeManager, CostController, AlertEngine } from './governance/index.js';
export type { Alert, AlertLevel } from './governance/index.js';

// ── Self Improvement Loop (v15) ──
export { SelfImprovementLoop, ImprovementAnalyzer, EvolutionProposal } from './brain/index.js';
export type { ImprovementInsight, Proposal } from './brain/index.js';

// ── v15 Bootstrap ──
export { bootstrapV15 } from './bootstrap-v15.js';
export type { V15BootstrapResult } from './bootstrap-v15.js';


// ═══════════════════════════════════════════════════════════════
// v16 新增模块
// ═══════════════════════════════════════════════════════════════

// ── Mission Control (v16) — 项目总控 ──
export { MissionController, ProgressTracker, ConflictResolver } from './mission-control/index.js';
export type { MissionState as MissionControlState, MissionStatus, MissionPhase, MissionUpdate, BlockReason } from './mission-control/index.js';
export type { Conflict } from './mission-control/index.js';

// ── Capability Registry (v16) — 能力目录 ──
export { CapabilityRegistry, CapabilityDiscoverer } from './capability/index.js';
export type { Capability as SystemCapability } from './capability/index.js';

// ── Simulation Layer (v16) — 执行前模拟 ──
export { ExecutionSimulator } from './simulation/index.js';
export type { SimulationInput, SimulationResult as SimulatedResult } from './simulation/index.js';

// ── Approval Gate (v16) — 审批门 ──
export { ApprovalGate } from './verification/index.js';
export type { ApprovalRequest as ApprovalGateRequest, ApprovalDecision } from './verification/index.js';

// ── Artifact Lifecycle (v16) — 升级版 ──
export type { ArtifactLifecycleStatus, ArtifactLineageEntry } from './contracts/artifact-lifecycle.js';

// ── v16 Bootstrap ──
export { bootstrapV16 } from './bootstrap-v16.js';
export type { V16BootstrapResult } from './bootstrap-v16.js';


