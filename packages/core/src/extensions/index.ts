/**
 * extensions/index.ts — 内核扩展模块统一入口
 *
 * MorPex 三大内核升级模块：
 *   1. Artifact Lineage Graph（产物血缘关系图）     — LineageTracker
 *   2. Context Intelligence Engine（上下文智能引擎） — ContextPruner
 *   3. Self-Healing Runtime（自愈运行时）            — McpProcessGuard + CheckpointManager
 *
 * 设计原则：
 *   - 零侵入现有 WorkflowEngine.ts
 *   - 通过 ExtensionRegistry 统一管理生命周期
 *   - 所有模块支持一键 Disable
 *
 * 用法：
 *   import {
 *     ExtensionRegistryImpl,
 *     LineageTracker,
 *     ContextPruner,
 *     McpProcessGuard,
 *     CheckpointManager,
 *   } from './extensions/index.js';
 *
 *   // 1. 创建扩展注册表
 *   const registry = new ExtensionRegistryImpl(eventBus, extensionsConfig);
 *
 *   // 2. 注册所有扩展（按依赖顺序）
 *   const lineageTracker = new LineageTracker();
 *   registry.register(lineageTracker);
 *
 *   const contextPruner = new ContextPruner({}, lineageTracker);
 *   registry.register(contextPruner);
 *
 *   const mcpGuard = new McpProcessGuard(mcpRuntimeManager);
 *   registry.register(mcpGuard);
 *
 *   const checkpointMgr = new CheckpointManager();
 *   registry.register(checkpointMgr);
 *
 *   // 3. 启动所有扩展
 *   await registry.startAll();
 *
 *   // 4. 使用 CheckpointManager 包装工作流执行
 *   const result = await checkpointMgr.executeWithCheckpoints(
 *     executeWorkflow, state, workflowDef, nodeMap, handoff, planner
 *   );
 *
 *   // 5. 使用 McpProcessGuard 启动受守护的 MCP 进程
 *   const guardedClient = await mcpGuard.guardSpawn('filesystem', 'npx', ['tsx', './handler.ts']);
 *
 *   // 6. 停止
 *   await registry.stopAll();
 */

// ── 类型 ──
export type {
  // 血缘图谱
  ArtifactNode,
  LineageEdge,
  LineageGraph,
  LineageQuery,
  LineageQueryResult,
  LineageTrackerConfig,

  // 上下文智能引擎
  ContextPrunerConfig,
  ContextSegment,
  PruningDecision,
  PruningResult,
  ContextSnapshot,

  // 自愈运行时
  McpGuardConfig,
  McpGuardState,

  // 生命周期钩子
  BeforeNodeExecutePayload,
  AfterNodeExecutePayload,
  BeforeLLMCallPayload,
  AfterLLMCallPayload,
  OnFatalErrorPayload,

  // 扩展框架
  ExtensionDefinition,
  ExtensionContext,
  ExtensionRegistry,
  ExtensionStatus,
  ExtensionLogger,
  KernelExtensionsConfig,
} from './types.js';

// ── 常量 ──
export { DEFAULT_EXTENSIONS_CONFIG } from './types.js';

// ── 扩展注册表 ──
export { ExtensionRegistryImpl } from './ExtensionRegistry.js';

// ── Phase 1-2: 产物血缘 + 上下文智能 (removed — ghost modules) ──
// LineageTracker, ContextPruner, McpProcessGuard were ghost modules

// ── Phase 4: Planning Intelligence Layer (MetaPlanner + PipelineExecutor + PIE + SEE) ──
export { MetaPlanner, PlanExperienceStore, PlanAnalyzer, PipelineExecutor, SessionErrorExtractor, PlanningIntelligenceEngine } from './planning/index.js';
export type { PipelineExecutorConfig, PipelineDeps, PipelineInput, SessionErrorReport } from './planning/index.js';
export type {
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
} from './planning/index.js';
export { DEFAULT_META_PLANNER_CONFIG } from './planning/index.js';
