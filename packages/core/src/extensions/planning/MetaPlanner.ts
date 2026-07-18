/**
 * MetaPlanner v3.1 — 计划编排器（拆分后精简版）
 *
 * v2.5 -> v3.1:
 *   7-Stage Pipeline 逻辑已提取至 PipelineExecutor.ts
 *   本文件仅保留编排、扩展生命周期、事件桥接
 *
 * 职责边界：
 *   - 扩展生命周期（initialize/start/stop）
 *   - 编排入口（wrapOrchestrate）
 *   - 运行时重规划（replanPipeline）
 *   - 事件桥接（bridgeMemoryBusEvent）
 *   - 7-Stage Pipeline 执行委派给 PipelineExecutor
 *
 * 设计约束遵守：
 *   ✅ 零侵入：不修改 ExecutionOrchestrator / Runtime Kernel
 *   ✅ 保持签名：wrapOrchestrate(orchestrateFn) 完全向下兼容
 *   ✅ 四准则：契约先行 | 可观测性驱动 | Prompt 分离 | 断裂注入
 *   ✅ Single Responsibility：只编排，不执行 Stage 逻辑
 *
 * @see PipelineExecutor.ts — 7-Stage 管道执行器
 * @see PipelineLogger.ts   — 结构化 Trace 日志
 */

import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ExtensionDefinition, ExtensionContext, ExtensionStatus } from '../types.js';
import type {
  MetaPlannerConfig, PlanExecutionRecord, DAGNodeRecord, FailureDetail,
  IPlanningExtension, PrePlanContext, PrePlanResult, PostPlanContext, PostPlanResult,
  RuntimeEventContext, RuntimeEventResult, IRuntimeController,
  MemoryBusLogEntry, MetaPlannerV2Config, Milestone, DeviationEvent, SemanticTag,
} from './types.js';
import { DEFAULT_META_PLANNER_CONFIG, DEFAULT_META_PLANNER_V2_CONFIG } from './types.js';
import { PlanExperienceStore } from './PlanExperienceStore.js';
import { PlanAnalyzer } from './PlanAnalyzer.js';

// ★ v3.0 OpenSpace Fusion imports
import { ToolQualityManager, DEFAULT_TOOL_QUALITY_CONFIG, type DegradationAlert, type ToolQualityConfig } from './ToolQualityManager.js';
import { TemplateManager, EvolutionType, DEFAULT_EVOLUTION_CONFIG, type TemplateLineage, type TemplateFrontmatter } from './TemplateManager.js';
// Note: PlanAnalyzer replaces PlanEvaluator + PlanOptimizer
import { RuntimeController } from './RuntimeController.js';
import { DeviationGuard } from './guards/DeviationGuard.js';
import { V1CapabilityAdapter } from './engines/V1CapabilityAdapter.js';
import { StrategicDeconstructor } from './engines/StrategicDeconstructor.js';
import { LookAheadSimulator } from './engines/LookAheadSimulator.js';
import { DynamicReflexEngine } from './engines/DynamicReflexEngine.js';
import { TopologyExplorer } from './engines/TopologyExplorer.js';
import type { ExecutionDAG } from '../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { SessionContext } from '../../common/types.js';

// ── v2.6 升级模块导入 ──────────────────────────────────
import { SessionErrorExtractor } from './SessionErrorExtractor.js';
import { PlanningIntelligenceEngine } from './PlanningIntelligenceEngine.js';
import { HierarchicalCandidateGenerator, StatisticalPlanSimulator, WeightedPlanEvaluator } from './engines/HierarchicalPlanningEngine.js';

// ── PipelineExecutor Import ──────────────────────────────
import type {
  PlanActivationResult, PipelineTrace,
  CandidatePlanProfile, ExperienceQueryResult,
  IShadowSimulationReport, IEvaluationScorecard, IntentAnalysisResult,
} from './types.js';
import { DEFAULT_DES_CONFIG } from './types.js';
import { PipelineLogger, oneLinePipelineStatus } from './PipelineLogger.js';
import { PipelineExecutor, type PipelineInput } from './pipeline/PipelineExecutor.js';

// ★ MemoryWiki import
import { MemoryWiki, MemoryRetriever } from '../../../../memory/src/index.js';

type OrchestrateFn = (userInput: string, sessionCtx?: SessionContext) => Promise<{ dag: ExecutionDAG; result: any }>;
type WrappedOrchestrateFn = OrchestrateFn;

export class MetaPlanner implements ExtensionDefinition {
  public readonly name = 'MetaPlanner';
  public readonly version = '2.5.0';
  public readonly dependencies: string[] = ['LineageTracker', 'ContextPruner'];

  private _enabled: boolean;
  private _config: MetaPlannerConfig;
  private _v2Config: MetaPlannerV2Config;
  private _context: ExtensionContext | null = null;
  private _phase: ExtensionStatus['phase'] = 'uninitialized';
  private _startedAt: number | undefined;
  private _lastError: string | undefined;

  // v1 子系统
  readonly store: PlanExperienceStore;
  readonly analyzer: PlanAnalyzer;

  // v2 扩展系统
  private extensions: IPlanningExtension[] = [];
  private deviationGuard: DeviationGuard;

  // v2 内置引擎
  private v1Adapter: V1CapabilityAdapter;
  private strategicDeconstructor: StrategicDeconstructor | null = null;
  private lookAheadSimulator: LookAheadSimulator | null = null;
  private dynamicReflexEngine: DynamicReflexEngine | null = null;
  private topologyExplorer: TopologyExplorer | null = null;

  // ★ v3.0 OpenSpace Fusion components
  private toolQuality: ToolQualityManager;
  private templateManager: TemplateManager;

  // v2.5 管道基础设施
  private pipelineLogger: PipelineLogger;
  private modelRegistry: any | null = null; // LLM provider for Stage 3
  private desConfig = { ...DEFAULT_DES_CONFIG };
  private pipeline: PipelineExecutor | null = null;

  // ★ v2.6 升级模块（自主学习回路 + 错误提取管道）
  private planningIntelligence: PlanningIntelligenceEngine | null = null;
  private sessionErrorExtractor: SessionErrorExtractor | null = null;

  // ★ MemoryWiki 实例（双写 SQLite）
  private wiki: MemoryWiki | null = null;

  // ★ Agent 记忆优先检索层
  private memoryRetriever: MemoryRetriever | null = null;

  // 外部引用
  private memoryBus: any = null;
  private dagEngine: any = null;
  private knowledgeGraph: any = null;
  private artifactRegistry: any = null;
  private vectorStore: any = null;
  private _eventBus: any = null;

  // 运行时状态
  private _pendingRecord: PlanExecutionRecord | null = null;
  private _activeExecutionCtx: { sessionId: string; executionId: string } | null = null;

  constructor(config?: Partial<MetaPlannerConfig> & {
    v2?: Partial<MetaPlannerV2Config>;
    knowledgeGraph?: any;
    artifactRegistry?: any;
    vectorStore?: any;
    memoryBus?: any;
    dagEngine?: any;
    eventBus?: any;
    pipelineLogger?: PipelineLogger;
    modelRegistry?: any;
    desConfig?: Partial<typeof DEFAULT_DES_CONFIG>;
    wiki?: MemoryWiki;
    memoryRetriever?: MemoryRetriever;
  }) {
    const { v2: v2Config, knowledgeGraph, artifactRegistry, vectorStore, memoryBus, dagEngine, eventBus, pipelineLogger, modelRegistry, desConfig, wiki, memoryRetriever, ...rest } = config ?? {};
    this._config = { ...DEFAULT_META_PLANNER_CONFIG, ...rest };
    this._v2Config = { ...DEFAULT_META_PLANNER_V2_CONFIG, ...v2Config };
    this._enabled = this._config.enabled;

    this.store = new PlanExperienceStore(this._config);
    this.analyzer = new PlanAnalyzer(this.store);

    this.deviationGuard = new DeviationGuard({ maxDeviationsPerSession: this._v2Config.maxDeviationCount, traceLogPath: this._v2Config.traceLogPath + 'deviation-traces.jsonl' });
    this.memoryBus = memoryBus ?? null;
    this.dagEngine = dagEngine ?? null;
    this.knowledgeGraph = knowledgeGraph ?? null;
    this.artifactRegistry = artifactRegistry ?? null;
    this.vectorStore = vectorStore ?? null;
    this._eventBus = eventBus ?? null;
    this.wiki = wiki ?? null;
    this.memoryRetriever = memoryRetriever ?? null;

    // ★ 向下游组件注入 MemoryWiki
    if (this.wiki) {
      this.store.setWiki(this.wiki);
      this.deviationGuard.setWiki(this.wiki);
    }

    // v2.5 管道基础设施
    this.pipelineLogger = pipelineLogger ?? new PipelineLogger({ traceLogPath: this._v2Config.traceLogPath });
    this.modelRegistry = modelRegistry ?? null;
    if (desConfig) {
      this.desConfig = { ...this.desConfig, ...desConfig };
    }

    // ★ v2.6 升级模块初始化（自主学习回路 + 错误提取管道 + 层次规划引擎）
    this.sessionErrorExtractor = new SessionErrorExtractor();
    this.planningIntelligence = new PlanningIntelligenceEngine(this, {});

    // ★ 向下游组件注入 MemoryWiki
    if (this.wiki) {
      this.sessionErrorExtractor.setWiki(this.wiki);
      this.planningIntelligence.setWiki(this.wiki);
    }

    // ★ v2.6 层次规划引擎（HierarchicalCandidateGenerator + StatisticalPlanSimulator）
    const hierCandidates = new HierarchicalCandidateGenerator();
    const hierSimulator = new StatisticalPlanSimulator(this.store);
    const hierEvaluator = new WeightedPlanEvaluator();

    // Initialize PipelineExecutor (7-stage pipeline engine, with v2.6 upgrade modules)
    this.pipeline = new PipelineExecutor({
      pipelineLogger: this.pipelineLogger,
      modelRegistry: this.modelRegistry,
      desConfig: this.desConfig,
      store: this.store,
      knowledgeGraph: this.knowledgeGraph,
      vectorStore: this.vectorStore,
      topologyExplorer: this.topologyExplorer,
      analyzer: this.analyzer,
      deviationGuard: this.deviationGuard,
      traceLogPath: this._v2Config.traceLogPath,
      artifactRegistry: this.artifactRegistry,
      memoryBus: this.memoryBus,
      wiki: this.wiki,
      memoryRetriever: this.memoryRetriever,
      // ★ v2.6: HierarchicalPlanningEngine components for S3 candidate generation
      hierarchicalPlanner: { candidateGenerator: hierCandidates, simulator: hierSimulator, evaluator: hierEvaluator },
    });

    // 注册 v1 适配器
    this.v1Adapter = new V1CapabilityAdapter({ store: this.store, analyzer: this.analyzer, enabled: true });
    this.extensions.push(this.v1Adapter);

    // 注册 StrategicDeconstructor
    if (this._v2Config.enableStrategicDeconstructor) {
      this.strategicDeconstructor = new StrategicDeconstructor({ knowledgeGraph: this.knowledgeGraph, artifactRegistry: this.artifactRegistry, enabled: true });
      this.extensions.push(this.strategicDeconstructor);
    }

    // 注册 LookAheadSimulator
    if (this._v2Config.enableLookAheadSimulator) {
      this.lookAheadSimulator = new LookAheadSimulator({ vectorStore: this.vectorStore, store: this.store, riskThreshold: this._v2Config.simulationRejectionThreshold, enabled: true });
      this.extensions.push(this.lookAheadSimulator);
    }

    // 注册 DynamicReflexEngine
    if (this._v2Config.enableDynamicReflexEngine) {
      this.dynamicReflexEngine = new DynamicReflexEngine({ memoryBus: this.memoryBus, dagEngine: this.dagEngine, guard: this.deviationGuard, enabled: true });
      this.extensions.push(this.dynamicReflexEngine);
    }

    // 注册 TopologyExplorer
    this.topologyExplorer = new TopologyExplorer({
      maxPermutations: 24,
      maxNodesForExploration: 7,
      simulationsPerVariant: 1,
    });

    // Wire the re-planning pipeline callback into DynamicReflexEngine
    if (this.dynamicReflexEngine) {
      this.dynamicReflexEngine.setReplanPipeline(this.replanPipeline.bind(this));
    }

    // 按优先级排序
    this.extensions.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // ── ★ v3.0 OpenSpace Fusion 初始化 ──
    const basePath = this._config.experienceStorePath ?? './data/planning';
    this.templateManager = new TemplateManager(
      this.store,
      { useLLMForFix: false },
      path.join(basePath, 'templates'),
    );
    // ★ 向下游组件注入 MemoryWiki
    if (this.wiki) {
      this.templateManager.setWiki(this.wiki);
    }

    this.toolQuality = new ToolQualityManager({
      storePath: path.join(basePath, 'tool-quality.jsonl'),
      autoFixOnDegradation: true,
    });
    // ★ 注入 MemoryWiki
    if (this.wiki) this.toolQuality.setWiki(this.wiki);

    // Wire degradation detection → automatic template fix
    this.toolQuality.onDegradationDetected(async (alert: DegradationAlert) => {
      if (this._context) {
        this._context.logger.warn('[MetaPlanner] 工具退化告警', {
          tool: alert.toolName,
          domain: alert.domain,
          recentRate: alert.recentRate,
          action: alert.suggestedAction,
        });
      }
      if (alert.suggestedAction === 'fix_template') {
        const allTemplates = this.store.getAllTemplates();
        const templates = allTemplates.filter((tpl: any) =>
          tpl.tags?.includes?.(alert.domain) ||
          tpl.nodeSkeletons?.some?.((s: any) => s.domain === alert.domain || s.role === alert.toolName)
        );
        for (const tpl of templates) {
          const fixed = await this.templateManager.fixTemplate(tpl.templateId);
          if (fixed && this._context) {
            this._context.logger.info('🔧 FIXED 模板', { templateId: tpl.templateId, version: fixed.version });
          }
        }
      }
    });
  }

  get enabled(): boolean { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; }

  async initialize(context: ExtensionContext): Promise<void> {
    this._context = context;
    this._phase = 'initialized';
    await this.store.initialize();
    context.logger.info('MetaPlanner v2.5 已初始化', {
      records: this.store.getStats().totalRecords,
      templates: this.store.getStats().totalTemplates,
      extensions: this.extensions.length,
      pipelineEnabled: true,
      v2Features: {
        strategicDeconstructor: this._v2Config.enableStrategicDeconstructor,
        lookAheadSimulator: this._v2Config.enableLookAheadSimulator,
        dynamicReflexEngine: this._v2Config.enableDynamicReflexEngine,
      },
    });
  }

  async start(): Promise<void> {
    this._phase = 'running';
    this._startedAt = Date.now();

    // ★ v3.0 Sync templates from TemplateFileSystem → PlanExperienceStore
    await this.syncTemplatesFromFS().catch((err: any) =>
      console.warn('[MetaPlanner] TemplateFileSystem sync error (non-fatal):', err)
    );

    if (this._context) {
      this._context.eventBus.on('workflow.completed', this.onWorkflowCompleted.bind(this));
      this._context.eventBus.on('workflow.failed', this.onWorkflowFailed.bind(this));
      this._context.eventBus.on('checkpoint.rollback', this.onCheckpointRollback.bind(this));
    }

    // ── 订阅 EventBus 运行时事件 → 桥接到 DynamicReflexEngine ──
    const runtimeEvents = [
      'runtime.node.failed',
      'runtime.node.deviation',
      'runtime.deviation',
      'runtime.self_heal.failed',
    ];
    for (const evtType of runtimeEvents) {
      const bus = this._eventBus ?? this._context?.eventBus;
      if (bus?.on) {
        bus.on(evtType, (event: any) => {
          const rawEvent = {
            type: evtType === 'runtime.node.failed' ? 'NODE_FAILED'
              : evtType === 'runtime.deviation' ? 'STATE_DEVIATION'
              : evtType === 'runtime.self_heal.failed' ? 'SELF_HEALING_FAILED'
              : evtType,
            sessionId: event?.sessionId ?? this._activeExecutionCtx?.sessionId ?? 'unknown',
            executionId: event?.executionId ?? this._activeExecutionCtx?.executionId ?? 'unknown',
            timestamp: event?.timestamp ?? Date.now(),
            payload: event?.payload ?? {},
          };
          this.bridgeMemoryBusEvent(rawEvent).catch((err: any) => {
            console.warn(`[MetaPlanner] 桥接运行时事件异常: ${err.message}`);
          });
        });
      }
    }

    this._context?.logger.info('MetaPlanner v2.5 已启动');
  }

  async stop(): Promise<void> {
    this._phase = 'stopped';
    if (this.dynamicReflexEngine) this.dynamicReflexEngine.unsubscribe();
    this._context?.logger.info('MetaPlanner v2.5 已停止');
  }

  getStatus(): ExtensionStatus {
    const s = this.store.getStats();
    return {
      name: this.name, enabled: this._enabled, phase: this._phase,
      startedAt: this._startedAt, uptime: this._startedAt ? Date.now() - this._startedAt : undefined,
      lastError: this._lastError,
      metrics: {
        totalRecords: s.totalRecords, totalTemplates: s.totalTemplates,
        successRate: `${(s.successRate * 100).toFixed(1)}%`,
        avgDurationMs: s.avgDurationMs, avgTokensUsed: s.avgTokensUsed,
        extensions: this.extensions.length,
        maxDeviationCount: this._v2Config.maxDeviationCount,
        pipelineEnabled: 'true',
      },
    };
  }

  // ── 扩展注册 API ──

  registerExtension(extension: IPlanningExtension): void {
    this.extensions = this.extensions.filter(e => e.name !== extension.name);
    this.extensions.push(extension);
    this.extensions.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  unregisterExtension(name: string): void {
    this.extensions = this.extensions.filter(e => e.name !== name);
  }

  getExtensions(): IPlanningExtension[] { return [...this.extensions]; }
  getExtension(name: string): IPlanningExtension | undefined { return this.extensions.find(e => e.name === name); }
  getDeviationGuard(): DeviationGuard { return this.deviationGuard; }
  getPlanningIntelligenceEngine(): PlanningIntelligenceEngine | null { return this.planningIntelligence; }
  getSessionErrorExtractor(): SessionErrorExtractor | null { return this.sessionErrorExtractor; }

  // ★ v3.0 OpenSpace Fusion getters
  getToolQualityManager(): ToolQualityManager { return this.toolQuality; }
  getTemplateManager(): TemplateManager { return this.templateManager; }

  // ── ★ v3.1 PipelineExecutor 公开 API 代理 ──

  /**
   * simulateDES — 对候选计划运行 DES 模拟（公开，供外部复用）
   *
   * 委派给 PipelineExecutor.simulateDES()。可用于：
   *   - 独立模拟验证（无需触发完整 7-Stage 管道）
   *   - 批量对比不同配置的 DES 参数效果
   */
  async simulateDES(
    candidates: CandidatePlanProfile[],
    experience: ExperienceQueryResult | null,
  ): Promise<IShadowSimulationReport[]> {
    return this.pipeline!.simulateDES(candidates, experience);
  }

  /**
   * evaluateMCDA — 多准则决策分析（公开，供外部复用）
   *
   * 委派给 PipelineExecutor.evaluateMCDA()。可用于：
   *   - PlanAnalyzer 对历史方案重新评分
   *   - 权重敏感性分析（what-if 场景）
   */
  evaluateMCDA(
    simulations: IShadowSimulationReport[],
    candidates: CandidatePlanProfile[],
    intent: IntentAnalysisResult,
    experience: ExperienceQueryResult | null,
    deviationCount: number,
  ): IEvaluationScorecard {
    return this.pipeline!.evaluateMCDA(simulations, candidates, intent, experience, deviationCount);
  }

  /**
   * ★ v3.0 Sync templates from TemplateFileSystem → PlanExperienceStore.
   *
   * Loads any templates from the filesystem that don't exist in the store,
   * enabling bidirectional sync. This handles the case where templates were
   * added manually, via another process, or restored from git.
   */
  private async syncTemplatesFromFS(): Promise<void> {
    if (!this.templateManager) return;
    const fsTemplates = await this.templateManager.listAllTemplates().catch(() => []);
    for (const fsTpl of fsTemplates) {
      const existing = this.store.getTemplate(fsTpl.templateId);
      if (!existing) {
        await this.store.saveTemplate(fsTpl);
        if (this._context) {
          this._context.logger.info('[MetaPlanner] Synced template from FS', { templateId: fsTpl.templateId, name: fsTpl.name });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 核心 API：wrapOrchestrate — 7-Stage Pipeline 集成（完全向下兼容）
  // ═══════════════════════════════════════════════════════════════════════

  wrapOrchestrate(originalOrchestrate: OrchestrateFn): WrappedOrchestrateFn {
    const mp = this;

    return async function orchestrateWithMeta(userInput: string, sessionCtx?: SessionContext) {
      if (!mp._enabled) return originalOrchestrate(userInput, sessionCtx);

      const startTime = Date.now();
      const recordId = `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const sessionId = sessionCtx?.sessionId ?? `sess_${Date.now()}`;
      const executionId = sessionCtx?.executionId ?? `exec_${Date.now()}`;

      // ── Phase 1: 提取标签 ──
      const tags = mp.extractTags(userInput);

      // ── Phase 2: onPrePlan 扩展链 ──
      const prePlanCtx: PrePlanContext = {
        sessionId, executionId, userInput, tags,
        sessionContext: sessionCtx as any,
        knowledgeGraph: mp.knowledgeGraph ? {
          searchEntities: (q: any) => mp.knowledgeGraph.searchEntities(q),
          getNeighborhood: (id: string, d?: number) => mp.knowledgeGraph.getNeighborhood(id, d),
          findPath: (f: string, t: string) => mp.knowledgeGraph.findPath(f, t),
        } : undefined,
        artifactRegistry: mp.artifactRegistry ? {
          search: (q: any) => mp.artifactRegistry.search?.(q),
          listByDomain: (d: string) => mp.artifactRegistry.listByDomain?.(d),
        } : undefined,
      };

      let enrichedSessionCtx = sessionCtx;
      let milestones: Milestone[] = [];

      for (const ext of mp.extensions) {
        if (!ext.enabled || !ext.onPrePlan) continue;
        try {
          const result: PrePlanResult = await ext.onPrePlan(prePlanCtx);
          if (result.enrichedContext && Array.isArray(result.enrichedContext) && result.enrichedContext.length > 0) {
            enrichedSessionCtx = mp.injectContext(enrichedSessionCtx, result.enrichedContext as string[], userInput);
          }
          if (result.milestones) milestones.push(...result.milestones);
        } catch (err: any) {
          console.warn(`[MetaPlanner] 扩展 "${ext.name}" onPrePlan 异常: ${err.message}`);
        }
      }

      mp.emitEvent('metaplanner.plan_started', { executionId, recordId, tags, milestones: milestones.length });

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // v2.5: 7-Stage Planning Pipeline（委派至 PipelineExecutor）
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let pipelineActivation: PlanActivationResult | null = null;
      let pipelineTrace: PipelineTrace | null = null;

      try {
        const pipelineResult = await mp.pipeline!.execute({
          userInput,
          sessionId,
          executionId,
          tags,
          sessionCtx: enrichedSessionCtx,
          milestones,
        });
        pipelineTrace = pipelineResult.trace;
        pipelineActivation = pipelineResult.activation;

        // Log final one-line status
        console.log(oneLinePipelineStatus(pipelineTrace));
      } catch (pipelineErr: any) {
        console.warn(`[MetaPlanner] 7-Stage Pipeline 异常: ${pipelineErr.message}，降级到原始 orchestrate`);
        mp._lastError = `Pipeline failed: ${pipelineErr.message}`;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // DAG 执行：使用 Pipeline 生成的 DAG 或降级到原始 orchestrate
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let dag: ExecutionDAG;
      let result: any;

      if (pipelineActivation?.readyForExecution && pipelineActivation.activatedPlan) {
        // Use pipeline-generated DAG
        dag = pipelineActivation.activatedPlan.dag;
        // Register resource tokens with ArtifactRegistry
        if (mp.artifactRegistry && pipelineActivation.resourceTokens.length > 0) {
          try {
            for (const token of pipelineActivation.resourceTokens) {
              mp.artifactRegistry.reserveToken?.(token);
            }
          } catch { /* non-critical */ }
        }
        // Execute the DAG through the original orchestrator
        try {
          const output = await originalOrchestrate(userInput, enrichedSessionCtx);
          result = output.result;
          if (output.dag !== dag) {
            console.log(`[MetaPlanner] Pipeline DAG injected (${dag.nodes.length} nodes vs original ${output.dag.nodes.length})`);
          }
        } catch (execErr: any) {
          mp._lastError = execErr.message;
          const rec: PlanExecutionRecord = {
            recordId, executionId, userInput, inputTags: tags, dagNodes: [],
            success: false, totalDurationMs: Date.now() - startTime, totalTokensUsed: 0,
            artifactCount: 0, selfHealingRetries: 0, pruningTokensSaved: 0, score: 0, createdAt: Date.now(),
            failureDetails: [{ nodeId: 'orchestrator', category: 'unknown', summary: execErr.message.slice(0, 500), timestamp: Date.now() }],
          };
          await mp.store.saveRecord(rec).catch(() => {});
          mp.emitEvent('metaplanner.plan_failed', { executionId, recordId, error: execErr.message });
          throw execErr;
        }
      } else {
        // Fallback: use original orchestrate as-is
        try {
          const output = await originalOrchestrate(userInput, enrichedSessionCtx);
          dag = output.dag;
          result = output.result;
        } catch (err: any) {
          mp._lastError = err.message;
          const rec: PlanExecutionRecord = {
            recordId, executionId, userInput, inputTags: tags, dagNodes: [],
            success: false, totalDurationMs: Date.now() - startTime, totalTokensUsed: 0,
            artifactCount: 0, selfHealingRetries: 0, pruningTokensSaved: 0, score: 0, createdAt: Date.now(),
            failureDetails: [{ nodeId: 'orchestrator', category: 'unknown', summary: err.message.slice(0, 500), timestamp: Date.now() }],
          };
          await mp.store.saveRecord(rec).catch(() => {});
          mp.emitEvent('metaplanner.plan_failed', { executionId, recordId, error: err.message });
          throw err;
        }
      }

      // ── Phase 3: onPostPlan 扩展链 ──
      const postPlanCtx: PostPlanContext = {
        sessionId, executionId, userInput, tags, dag, milestones,
      };

      let planRejected = false;
      const rejectionReasons: string[] = [];

      for (const ext of mp.extensions) {
        if (!ext.enabled || !ext.onPostPlan) continue;
        try {
          const ppResult: PostPlanResult = await ext.onPostPlan(postPlanCtx);
          if (ppResult.rejected) {
            planRejected = true;
            if (ppResult.rejectionReasons) rejectionReasons.push(...ppResult.rejectionReasons);
          }
        } catch (err: any) {
          console.warn(`[MetaPlanner] 扩展 "${ext.name}" onPostPlan 异常: ${err.message}`);
        }
      }

      if (planRejected) {
        const msg = `计划被模拟引擎拒绝: ${rejectionReasons.join('; ')}`;
        mp._context?.logger.warn(msg);
        mp.emitEvent('metaplanner.plan_rejected', { executionId, recordId, rejectionReasons });
        mp._lastError = msg;
        throw new PlanningRejectedError(msg, rejectionReasons, dag);
      }

      // ── Phase 4: 设置运行时 MemoryBus 桥接 ──
      mp._activeExecutionCtx = { sessionId, executionId };
      if (mp.memoryBus && mp.dynamicReflexEngine) {
        mp.dynamicReflexEngine.subscribeToMemoryBus(mp.memoryBus, (exId: string, sessId: string) =>
          new RuntimeController(mp.dagEngine, sessId),
        );
      }

      // ── Phase 5: 构建执行记录 ──
      const record: PlanExecutionRecord = {
        recordId, executionId, userInput, inputTags: tags,
        dagNodes: [], success: false, totalDurationMs: 0, totalTokensUsed: 0,
        artifactCount: 0, selfHealingRetries: 0, pruningTokensSaved: 0, score: 0, createdAt: Date.now(),
      };
      mp._pendingRecord = record;

      // ── Phase 6: 收尾 ──
      const duration = Date.now() - startTime;
      record.success = result?.success ?? true;
      record.totalDurationMs = duration;
      record.totalTokensUsed = mp.extractTokenUsage(result);
      record.dagNodes = mp.extractDAGNodes(dag, result);
      record.artifactCount = mp.extractArtifactCount(result);

      const evaluation = mp.analyzer.evaluate(record);
      await mp.store.saveRecord(record);

      // ★ MemoryWiki 双写（不阻塞主流程）
      if (mp.wiki?.ready) {
        mp.wiki.remember({
          id: `plan_${recordId}`,
          type: 'PlanRecord',
          name: userInput.slice(0, 100),
          data: {
            execution_id: executionId,
            task_id: tags.join(','),
            user_input: userInput,
            input_tags: JSON.stringify(tags),
            s3_method: pipelineActivation?.activatedPlan?.strategy ?? null,
            plan_score: evaluation.overallScore,
            execution_success: record.success ? 1 : 0,
            duration_ms: duration,
            total_tokens_used: record.totalTokensUsed,
            artifact_count: record.artifactCount,
            created_at: Math.floor(Date.now() / 1000),
          },
        }).catch(() => {});
      }

      if (mp._config.autoExtractTemplates && record.success) {
        const template = await mp.templateManager.captureFromExecution(record);
        if (template) {
          mp._context?.logger.info('📦 CAPTURED 新模板', { templateId: template.templateId, name: template.name, evolutionType: 'captured' });
          await mp.templateManager.exportTemplate(template).catch((err: any) =>
            console.warn('[MetaPlanner] 模板文件同步失败:', err.message)
          );
        } else {
          const oldTemplate = await mp.store.extractTemplate(record);
          if (oldTemplate) mp._context?.logger.info('新模板已提炼', { templateId: oldTemplate.templateId, name: oldTemplate.name });
        }
      }

      mp.emitEvent('metaplanner.plan_completed', {
        executionId, recordId, score: record.score, evaluationScore: evaluation.overallScore, duration,
      });

      mp._pendingRecord = null;
      mp._activeExecutionCtx = null;
      mp.deviationGuard.reset(sessionId);

      // ★ v2.6 自主学习回路：异步执行（不阻塞主流程）
      if (mp.planningIntelligence && pipelineTrace && record.success) {
        mp.planningIntelligence.evolveTemplates().catch((err: any) =>
          console.warn('[MetaPlanner] 自主学习回路异常:', err.message)
        );
      }

      return { dag, result };
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MemoryWiki 注入（Phase 2 双写）
  // ═══════════════════════════════════════════════════════════════════════

  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 运行时重规划 — replanPipeline
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * replanPipeline — Public entry point for DynamicReflexEngine
   *
   * Runs the 7-stage pipeline via PipelineExecutor for runtime re-planning
   * triggered by STATE_DEVIATION or SELF_HEALING_FAILED events.
   * Accepts a failure context from the reflex engine.
   *
   * Returns a DAG patch that can be applied via DAGEngine.hotPatch().
   */
  public async replanPipeline(
    sessionId: string,
    executionId: string,
    failureContext: Record<string, unknown>,
  ): Promise<{ dag: ExecutionDAG; patch: import('./types.js').DAGPatch | null } | null> {
    try {
      const failureReason = (failureContext.failureReason as string) ?? `Runtime re-plan for ${executionId}`;
      const failureDesc = failureReason;
      const tags = this.extractTags(failureReason);

      const userInput = failureReason;  // 错误修正由 Gateway Layer 3 处理，此处不再重复注入

      // Run the full 7-stage pipeline via PipelineExecutor
      const result = await this.pipeline!.execute({
        userInput,
        sessionId,
        executionId,
        tags,
        sessionCtx: undefined,
        milestones: [],
      });

      // If the pipeline produced an activation, generate a patch from it
      if (result.activation.readyForExecution && result.activation.activatedPlan) {
        const patchId = `patch_replan_${executionId}_${Date.now()}`;
        const affectedNodes = result.activation.activatedPlan.dag.nodes.map(n => n.taskId);

        // Build a reroute patch from the pipeline's winner DAG
        const patch: import('./types.js').DAGPatch = {
          patchId,
          reason: `7-Stage replan after: ${failureDesc}`,
          timestamp: Date.now(),
          operations: affectedNodes.map(nodeId => ({
            type: 'reroute' as const,
            nodeId,
            payload: { alternateNodeId: nodeId },
          })),
          affectedNodes,
        };

        return { dag: result.activation.activatedPlan.dag, patch };
      }

      return null;
    } catch (err: any) {
      console.warn(`[MetaPlanner] replanPipeline 异常: ${err.message}`);
      return null;
    }
  }

  // ── MemoryBus 桥接 ──
  private async bridgeMemoryBusEvent(rawEvent: any): Promise<void> {
    if (!this._activeExecutionCtx) return;
    const { sessionId, executionId } = this._activeExecutionCtx;

    const deviationEvent: DeviationEvent = {
      type: rawEvent.type,
      sessionId,
      executionId,
      timestamp: rawEvent.timestamp ?? Date.now(),
      payload: rawEvent.payload ?? {},
    };

    const ctx: RuntimeEventContext = {
      sessionId,
      executionId,
      event: deviationEvent,
      dagEngine: undefined,
    };

    const controller = new RuntimeController(this.dagEngine, sessionId);

    for (const ext of this.extensions) {
      if (!ext.enabled || !ext.onRuntimeEvent) continue;
      try {
        const result = await ext.onRuntimeEvent(ctx, controller);
        if (result.action === 'circuit_broken') {
          console.warn(`[MetaPlanner] 扩展 "${ext.name}" 触发熔断: ${result.reason}`);
          break;
        }
      } catch (err: any) {
        console.warn(`[MetaPlanner] 扩展 "${ext.name}" onRuntimeEvent 异常: ${err.message}`);
      }
    }
  }

  // ── EventBus 处理器（v1 保留） ──

  private onWorkflowCompleted(event: any): void {
    if (this._pendingRecord) {
      this._pendingRecord.success = true;
      this._pendingRecord.totalDurationMs = event.payload?.totalDurationMs ?? this._pendingRecord.totalDurationMs;
    }
  }

  private onWorkflowFailed(event: any): void {
    const errorMessage = event.payload?.error ?? 'unknown error';
    const errorType = event.type ?? 'workflow.failed';

    if (this._pendingRecord) {
      const existing = this._pendingRecord.failureDetails ?? [];
      existing.push({
        nodeId: event.payload?.failedStep ?? event.payload?.stepId ?? 'unknown',
        category: this.classifyError(errorMessage),
        summary: errorMessage.slice(0, 500),
        timestamp: Date.now(),
      });
      this._pendingRecord.failureDetails = existing;
    }

    // ★ v2.6 错误提取管道：记录错误到 SessionErrorExtractor
    if (this.sessionErrorExtractor && this._activeExecutionCtx) {
      try {
        this.sessionErrorExtractor.recordError(
          this._activeExecutionCtx.sessionId,
          this._activeExecutionCtx.executionId,
          {
            nodeId: event.payload?.failedStep ?? event.payload?.stepId ?? 'unknown',
            errorMessage,
            timestamp: Date.now(),
            errorType,
            retryCount: event.payload?.retryCount ?? 0,
            healingAttempted: event.payload?.healingAttempted ?? false,
            healingSucceeded: false,
          },
        );
      } catch { /* non-critical */ }
    }
    // 错误修正检索已移至 Gateway Layer 3 (AgentReasoningInterceptor.processObservation)
  }

  private onCheckpointRollback(event: any): void {
    if (this._pendingRecord) this._pendingRecord.selfHealingRetries++;
  }

  // ── 公开查询 API（v1 保留） ──

  getRecommendation(userInput: string) {
    const tags = this.extractTags(userInput);
    const matches = this.analyzer.recommendTemplate(userInput, tags);
    return {
      tags, matches,
      optimizationPrompt: this.analyzer.buildOptimizationPrompt(userInput, tags),
      failurePatterns: this.store.getFailurePatterns(),
      stats: this.store.getStats(),
      modelRecommendation: this.analyzer.getModelRecommendation(tags),
      extensions: this.extensions.map(e => ({ name: e.name, version: e.version, enabled: e.enabled })),
    };
  }

  getFailureReport() { return this.store.getFailurePatterns(); }
  getPlanStats() { return this.store.getStats(); }

  // ── 内部方法 ──

  private injectContext(ctx: SessionContext | undefined, contextLines: string[], userInput: string): SessionContext {
    const base: SessionContext = ctx ?? {
      sessionId: `sess_${Date.now()}`, executionId: `exec_${Date.now()}`, input: userInput, artifacts: {}, memory: [],
    };
    return { ...base, memory: [...(Array.isArray(base.memory) ? base.memory : []), ...contextLines] };
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    if (!this._context) return;
    this._context.eventBus.emit({
      id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      type, timestamp: Date.now(),
      executionId: (payload.executionId as string) ?? 'unknown',
      source: 'meta-planner', payload,
    });
  }

  // ── v1 保留方法 ──

  extractTags(input: string): string[] {
    const tags = new Set<string>();
    const lower = input.toLowerCase();
    const patterns: Array<[RegExp, string]> = [
      [/\b(ai|artificial intelligence|machine learning|ml|llm|gpt|transformer)\b/i, 'ai_ml'],
      [/\b(web|frontend|backend|api|rest|graphql|fullstack|react|vue|node)\b/i, 'web_dev'],
      [/\b(mobile|ios|android|app|flutter|react native)\b/i, 'mobile'],
      [/\b(data|analytics|pipeline|etl|warehouse|big data)\b/i, 'data_engineering'],
      [/\b(devops|ci|cd|docker|kubernetes|deploy|infra|cloud|aws|azure)\b/i, 'devops'],
      [/\b(hardware|embedded|iot|firmware|pcb|microcontroller|sensor)\b/i, 'hardware'],
      [/\b(startup|mvp|product|saas|business|market|validation)\b/i, 'startup'],
      [/\b(test|qa|quality|automation|unit test|integration test)\b/i, 'testing'],
      [/\b(security|auth|encrypt|penetration|vulnerability|compliance)\b/i, 'security'],
    ];
    for (const [re, tag] of patterns) { if (re.test(lower)) tags.add(tag); }
    if (/\b(create|build|develop|implement|code|write|generate)\b/i.test(lower)) tags.add('build');
    if (/\b(analyze|analysis|research|investigate|explore|study)\b/i.test(lower)) tags.add('analyze');
    if (/\b(fix|debug|repair|resolve|troubleshoot|bug)\b/i.test(lower)) tags.add('fix');
    if (/\b(optimize|improve|refactor|enhance|performance)\b/i.test(lower)) tags.add('optimize');
    if (/\b(design|architect|plan|blueprint|spec)\b/i.test(lower)) tags.add('design');
    if (/\b(deploy|release|launch|ship|publish)\b/i.test(lower)) tags.add('deploy');
    if (/\b(simple|basic|quick|easy|minimal|prototype)\b/i.test(lower)) tags.add('low_complexity');
    if (/\b(complex|advanced|comprehensive|full|complete|enterprise)\b/i.test(lower)) tags.add('high_complexity');
    if (tags.size === 0) tags.add('general');
    return [...tags].slice(0, 8);
  }

  private extractTokenUsage(result: any): number {
    if (!result) return 0;
    if (typeof result.totalTokensUsed === 'number') return result.totalTokensUsed;
    if (result.finalState?.metadata?.totalTokensUsed) return result.finalState.metadata.totalTokensUsed;
    const steps = result.finalState?.stepResults ?? [];
    let total = 0;
    for (const sr of steps) { if (sr.output?.tokenUsage?.total) total += sr.output.tokenUsage.total; }
    return total;
  }

  private extractDAGNodes(dag: ExecutionDAG, result: any): DAGNodeRecord[] {
    const nodes: DAGNodeRecord[] = [];
    for (const dagNode of dag.nodes) {
      const nodeId = dagNode.taskId;
      const nr = this.findNodeResult(result, nodeId);
      nodes.push({
        nodeId,
        role: 'unknown',
        domain: dagNode.domain ?? 'unknown',
        status: nr?.status === 'completed' ? 'success' : 'failed',
        durationMs: nr?.duration ?? 0, tokensUsed: 0,
        artifactUris: (nr?.artifacts ?? []).map((a: any) => a.uri ?? ''),
        retries: 0, error: nr?.error,
      });
    }
    return nodes;
  }

  private findNodeResult(result: any, taskId: string): any | undefined {
    if (!result) return undefined;
    const results = result.results ?? result.finalState?.stepResults ?? [];
    for (const r of results) { if (r.stepId === taskId || r.taskId === taskId) return r; }
    return undefined;
  }

  private extractArtifactCount(result: any): number {
    if (!result) return 0;
    const results = result.results ?? [];
    let count = 0;
    for (const r of results) count += (r.artifacts?.length ?? 0) + (r.artifactRefs?.length ?? 0);
    if (result.finalState?.artifactRegistry) count += Object.keys(result.finalState.artifactRegistry).length;
    return count;
  }

  private classifyError(errorMsg: string): FailureDetail['category'] {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
    if (lower.includes('token') || lower.includes('context length') || lower.includes('max_tokens')) return 'token_exhaustion';
    if (lower.includes('hallucination') || lower.includes('invalid json') || lower.includes('parse')) return 'llm_hallucination';
    if (lower.includes('tool') || lower.includes('toolcall')) return 'tool_error';
    if (lower.includes('mcp') || lower.includes('spawn') || lower.includes('crash')) return 'mcp_crash';
    if (lower.includes('validation') || lower.includes('verify') || lower.includes('check')) return 'validation_failure';
    if (lower.includes('dependency') || lower.includes('deps') || lower.includes('missing')) return 'dependency_missing';
    if (lower.includes('llm') || lower.includes('model') || lower.includes('api')) return 'llm_timeout';
    return 'unknown';
  }

  /**
   * categorizeTag — Determine the category of a tag
   */
  private categorizeTag(tag: string): SemanticTag['category'] {
    const domainTags = ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'];
    const actionTags = ['build', 'analyze', 'fix', 'optimize', 'design', 'deploy'];
    const complexityTags = ['low_complexity', 'high_complexity'];

    if (domainTags.includes(tag)) return 'domain';
    if (actionTags.includes(tag)) return 'action';
    if (complexityTags.includes(tag)) return 'complexity';
    return 'constraint';
  }

  /**
   * inferIntentType — Classify the high-level intent type
   */
  private inferIntentType(input: string): string {
    const lower = input.toLowerCase();
    if (/\b(create|build|develop|implement|generate)\b/i.test(lower)) return 'generation';
    if (/\b(analyze|research|investigate|study|audit)\b/i.test(lower)) return 'analysis';
    if (/\b(fix|debug|repair|resolve|troubleshoot)\b/i.test(lower)) return 'maintenance';
    if (/\b(deploy|release|launch|ship)\b/i.test(lower)) return 'deployment';
    if (/\b(optimize|improve|refactor|enhance)\b/i.test(lower)) return 'optimization';
    if (/\b(design|architect|plan)\b/i.test(lower)) return 'design';
    return 'general';
  }
}

export class PlanningRejectedError extends Error {
  public readonly rejectionReasons: string[];
  public readonly rejectedDAG: ExecutionDAG;
  constructor(message: string, reasons: string[], dag: ExecutionDAG) {
    super(message);
    this.name = 'PlanningRejectedError';
    this.rejectionReasons = reasons;
    this.rejectedDAG = dag;
  }
}
