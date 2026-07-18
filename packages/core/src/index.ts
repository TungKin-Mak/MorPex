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

// ── Mirror ──
export { ExecutionMirror } from './mirror/ExecutionMirror.js';
export { ExecutionRecordingEngine } from './mirror/ExecutionRecordingEngine.js';
export type {
  ExecutionRecording,
  ThoughtEntry as RecordedThought,
  ActionEntry as RecordedAction,
  ObservationEntry as RecordedObservation,
  DAGSnapshot as RecordedDAGSnapshot,
  RecordingConfig,
  RecordingStats,
} from './mirror/ExecutionRecordingEngine.js';
export { DEFAULT_RECORDING_CONFIG } from './mirror/ExecutionRecordingEngine.js';
export { JSONLStorage } from './mirror/storage/JSONLStorage.js';

// ── Pi 集成模块 ──
export { THINKING_LEVELS, THINKING_LEVEL_LABELS, DEFAULT_THINKING_LEVEL, getSupportedLevels, clampLevel, parseThinkingLevel, clearModelCache } from './common/ThinkingLevelControl.js';
export type { ThinkingLevel } from './common/ThinkingLevelControl.js';

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

// ── Cross-Domain Router (Phase 10) ──
export { CrossDomainRouter } from './router/CrossDomainRouter.js';
export { DomainDispatcher } from './router/DomainDispatcher.js';
export { ArbitrationHandler } from './router/ArbitrationHandler.js';
export type {
  NodeResult,
  DAGExecutionResult,
} from './router/DomainDispatcher.js';
// LLMCaller type already exported above from DomainClusterManager
export type {
  ArbitrationVerdict,
} from './router/ArbitrationHandler.js';

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

// ── EventStore (Phase 1.3) ──
export { EventStore } from './event/EventStore.js';
export type { SourcingEvent, ReplayState } from './event/EventStore.js';

// ── TeamSayTool (Phase 3.2) ──
export { TeamSayTool, createTeamSayTool } from './tool/TeamSayTool.js';
export type { AgentRegistry } from './tool/TeamSayTool.js';

// ── ReadArtifactTool (Phase 3.4) ──
export { createReadArtifactTool } from './tool/ReadArtifactTool.js';

// ── 提示词系统 — 三级分封架构 (Leader→Expert→Fork) ──
export { compileLeaderPrompt, compileExpertPrompt, createAstroMTrace } from './prompts/index.js';
export type { PromptTemplate, PromptCompileOptions, AstroMTrace } from './prompts/index.js';

// ── 三级分封工具 (v2.4) ──
export { AgentCreateTool, createAgentCreateTool } from './tool/AgentCreateTool.js';
export { ForkExecuteTool, createForkExecuteTool } from './tool/ForkExecuteTool.js';

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
export { NegotiationEngine } from './negotiation/NegotiationEngine.js';
export type {
  CreateTicketParams,
  NegotiationEngineConfig,
  NegotiationCallbacks,
} from './negotiation/NegotiationEngine.js';

// ── Industry Plugin (v3.1) — 行业适配引擎 ──
export { IndustryPlugin } from './industry/plugin.js';
export { IndustryRegistry } from './industry/IndustryRegistry.js';
export type {
  IndustryType,
  IndustryAdapter,
  IndustryPluginConfig,
  WorkflowTemplate,
  WorkflowStep,
} from './industry/types.js';

// ── Skill 工具（内部使用，不对外暴露）─

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

// ── VectorStoreAdapter (Phase 4.1) — MemoryBus 的 VectorStore 实现 ──
export { VectorStoreAdapter } from './memory/VectorStoreAdapter.js';

// ── EventStore Subscriber (Conflict 9) — EventBus 中介持久化 ──
export { EventStoreSubscriber } from './event/EventStoreSubscriber.js';

// ── AgentFactory (Conflict 1) — Agent 唯一工厂 ──
export { AgentFactory, SecurityBoundaryException } from './services/AgentFactory.js';
export type { AgentSpawnContext } from './services/AgentFactory.js';

// ── ExecutionOrchestrator (Conflict 3) — Control Plane 编排器 ──
export { ExecutionOrchestrator } from './planes/control-plane/orchestrator/ExecutionOrchestrator.js';
export type { ExecutionDAG } from './planes/control-plane/orchestrator/ExecutionOrchestrator.js';

// ── MemoryBusListener (Conflict 6) — 事件驱动记忆归档 ──
export { MemoryBusListener } from './memory/MemoryBusListener.js';

// ── 会话上下文 (源自 core/types.ts) ──
export type {
  SessionContext,
} from './common/types.js';

// ── 内核扩展（v3.1）— 产物血缘 + 上下文智能 + 自愈运行时 + 计划智能 ──
export {
  ExtensionRegistryImpl,
  LineageTracker,
  ContextPruner,
  McpProcessGuard,
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
  ArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery,
  LineageQueryResult,
  LineageTrackerConfig,
  ContextPrunerConfig,
  ContextSegment,
  PruningDecision,
  PruningResult,
  McpGuardConfig,
  McpGuardState,
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
  PlanTemplate,
  PlanNodeSkeleton,
  PlanExecutionRecord,
  DAGNodeRecord,
  FailureDetail,
  FailureCategory,
  PlanEvaluation,
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

// ── CheckpointManager — DAG 快照回滚（非 ExtensionDefinition，单独导出）──
export { CheckpointManager } from './extensions/CheckpointManager.js';

// ── 唯一入口（v2.4 门面模式） — 对外只暴露 bootstrapMorPexCore
export { bootstrapMorPexCore } from '../bootstrap.js';
export type { BootstrapConfig } from '../bootstrap.js';
