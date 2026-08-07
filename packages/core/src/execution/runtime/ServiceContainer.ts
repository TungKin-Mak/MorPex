import { EventBus } from '../../infrastructure/common/EventBus.js';
import { MissionController } from './mission/MissionController.js';
import { DynamicTeamOrchestrator } from '../../execution/DynamicTeamOrchestrator.js';
import { UnifiedExecutionEngine } from '../../execution/UnifiedExecutionEngine.js';
import type { DAGRuntimeLike } from '../../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../../knowledge/artifact/ArtifactFacade.js';
import { VerificationEngine } from '../../evaluation/verification/VerificationEngine.js';
import { ComplianceChecker } from '../../governance/ComplianceChecker.js';
import { ApprovalGate } from '../../governance/ApprovalGate.js';
import { AnomalyDetector } from '../../governance/AnomalyDetector.js';
import { ExperienceMiner } from '../../evolution/ExperienceMiner.js';
import { EvolutionSandbox } from '../../evolution/EvolutionSandbox.js';
import { PromptStrategyRegistry } from '../../evolution/PromptStrategyRegistry.js';
import { EvolutionApplyLoop } from '../../evolution/EvolutionApplyLoop.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { MorPexRuntime } from './MorPexRuntime.js';
import { MissionRuntime } from './mission/MissionRuntime.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { StepAgentExecutor } from './dag/StepAgentExecutor.js';
import { OrchestratorAgent } from '../orchestration/OrchestratorAgent.js';
import { AgentSessionStore } from '../orchestration/AgentSessionStore.js';
import { ContextPersistence } from '../../knowledge/context/ContextPersistence.js';
import { PersistentMissionStore } from './PersistentMissionStore.js';
import { PersistentArtifactStore } from './PersistentArtifactStore.js';
import { ControlPlane } from '../../governance/control-plane/ControlPlane.js';
import { systemMetadataGraph } from '../../knowledge/graph/SystemMetadataGraph.js';
import { CrossAgentLearningEngine } from '../../cognition/learning/agent/CrossAgentLearningEngine.js';
import { ExperienceRepository } from '../../cognition/learning/agent/ExperienceRepository.js';
import { KnowledgeDistiller } from '../../cognition/learning/agent/KnowledgeDistiller.js';
import { LearningPropagationService } from '../../cognition/learning/agent/LearningPropagationService.js';
import { ExperienceMatcher } from '../../cognition/learning/agent/ExperienceMatcher.js';

// ── Ontology 迭代4 ──
import type { OntologyService } from '../../knowledge/ontology/OntologyService.js';
import type { ForcedQueryGuard } from '../../gate/ForcedQueryGuard.js';
import { EvaluationEngine } from '../../evaluation/EvaluationEngine.js';

/**
 * ServiceContainer — 依赖注入容器
 * v15 Integration: 一键初始化所有运行时服务，确保模块间正确连接
 */
export class ServiceContainer {
  readonly eventBus: EventBus;
  readonly missionController: MissionController;
  readonly teamOrchestrator: DynamicTeamOrchestrator;
  readonly executionEngine: UnifiedExecutionEngine;
  /** 会话 3 多 Agent 框架：总大脑（编排 + 审计循环） */
  readonly orchestratorAgent: OrchestratorAgent;
  /** 会话 4（Session 化）：编排组件持久化会话仓库（总大脑/step-agent 独立 Session） */
  readonly agentSessionStore: AgentSessionStore;
  readonly artifactFacade: ArtifactFacade;
  readonly verificationEngine: VerificationEngine;
  readonly complianceChecker: ComplianceChecker;
  readonly approvalGate: ApprovalGate;
  readonly experienceMiner: ExperienceMiner;
  /** 会话 16d（P3 运维）：异常告警检测器（空参率突升/原语连续失败/装配超时） */
  readonly anomalyDetector: AnomalyDetector;
  /** 会话 16e（3-3 进化落地通道）：策略库（可学习事件 → 应用为提示词策略，版本化可回滚） */
  readonly promptStrategyRegistry: PromptStrategyRegistry;
  readonly evolutionSandbox: EvolutionSandbox;
  readonly evolutionApplyLoop: EvolutionApplyLoop;
  readonly simulator: ExecutionSimulator;
  /** L3 全功能实现：真实 MissionRuntime（供 DeliveryPlanner 接入规划阶段；构造器内赋值） */
  missionRuntime!: import('./mission/MissionRuntime.js').MissionRuntime;
  readonly runtime: MorPexRuntime;
  readonly missionStore: PersistentMissionStore;
  readonly artifactStore: PersistentArtifactStore;
  readonly controlPlane: ControlPlane;
  readonly learningEngine: CrossAgentLearningEngine;
  private _eventStore?: import('../../infrastructure/protocol/events/store/IEventStore.js').IEventStore;

  /** 公开访问器：EventStore（替代外部 (container as any)._eventStore 绕过） */
  get eventStore(): import('../../infrastructure/protocol/events/store/IEventStore.js').IEventStore | undefined {
    return this._eventStore;
  }

  // ═══════════════════════════════════════════════════════════════
  // 功能③ Phase 2：统一召回接口（ContextPersistence 装配快照 + EventStore 权威快照）
  // ═══════════════════════════════════════════════════════════════

  private _contextPersistence: import('../../knowledge/context/ContextPersistence.js').ContextPersistence | null = null;

  /**
   * getContextPersistence — 惰性构造装配快照持久化（共享 EventStore 的 SQLite db）
   * EventStore 非 SqliteEventStore（无 getDatabase）→ 返回 null（统一召回退化为仅 EventStore 侧）。
   */
  getContextPersistence(): import('../../knowledge/context/ContextPersistence.js').ContextPersistence | null {
    if (this._contextPersistence) return this._contextPersistence;
    if (!this._eventStore) return null;
    const db = (this._eventStore as unknown as { getDatabase?: () => unknown }).getDatabase?.();
    if (!db) return null;
    this._contextPersistence = new ContextPersistence(db as never);
    return this._contextPersistence;
  }

  /**
   * recallTaskContext — 统一召回：按任务身份 ID 合并两存储快照（EventStore 权威 + 装配快照）
   * 先确保 EventStore 初始化（UnifiedEventStore 惰性 init），再构造装配快照持久化（共享同一 SQLite）。
   */
  async recallTaskContext(taskRef: string): Promise<import('../../knowledge/context/ContextArchive.js').MergedTaskContext> {
    // ⬇️ 功能③ Phase 2 修复：UnifiedEventStore 惰性 init——不先 init 则 getDatabase() 返 undefined → 装配侧退化
    if (this._eventStore) {
      try {
        await (this._eventStore as unknown as { init?: () => Promise<void> }).init?.();
      } catch (err) {
        console.warn(`[ServiceContainer] ⚠️ EventStore init 失败（统一召回退化为仅 EventStore 侧）: ${(err as Error).message}`);
      }
    }
    const { loadMerged } = await import('../../knowledge/context/ContextArchive.js');
    return loadMerged(this._eventStore, this.getContextPersistence(), taskRef);
  }

  /**
   * recallTaskForAgent — 会话 16j（B2 指针消费端）：按 taskRef 拉取历史上下文为精简文本，
   * 供 step-agent 的 recall_task 工具消费（装配「可拉取详情」指针的消费端）。
   */
  async recallTaskForAgent(taskRef: string): Promise<string | null> {
    if (!taskRef) return null;
    try {
      const merged = await this.recallTaskContext(taskRef);
      if (!merged) return null;
      const parts: string[] = [];
      if (merged.archived) {
        parts.push(`目标: ${merged.archived.goal ?? '?'}`);
        parts.push(`结果: ${merged.archived.result ?? '?'}${typeof merged.archived.score === 'number' ? `（质量分 ${merged.archived.score}）` : ''}`);
      }
      if (merged.snapshots && merged.snapshots.length > 0) {
        const snap = merged.snapshots[0];
        if (snap.focusedSummary) parts.push(`装配摘要: ${snap.focusedSummary.slice(0, 800)}`);
      }
      if (parts.length === 0) return null;
      return parts.join('\n');
    } catch (err) {
      console.warn(`[ServiceContainer] ⚠️ recallTaskForAgent(${taskRef}) 失败: ${(err as Error).message}`);
      return null;
    }
  }

  /** 治理观测面板（bootstrap 挂载，供 StudioServer 显式访问） */
  governanceDashboard?: { getSystemHealth(): unknown; getCostReport(): unknown; getDeliveryMetrics(): unknown };

  /** 公司记忆 API（bootstrap 挂载，供 StudioServer 显式访问） */
  companyMemoryApi?: import('../../../../memory/src/api/MemoryApi.js').MemoryApi;
  private _ready: Promise<void>;

  constructor() {
    this.eventBus = new EventBus();
    this.missionController = new MissionController(this.eventBus);
    this.teamOrchestrator = new DynamicTeamOrchestrator();
    this.executionEngine = new UnifiedExecutionEngine(this.eventBus);
    // ═══ 会话 15（去兜底化）：createMissionRuntime 仅实例化真实 MissionRuntime（bootstrap 经 container.missionRuntime 使用），
    //     不再包装注入引擎（引擎现行唯一执行后端 = orchestrator）═══
    this.createMissionRuntime();
    const dagRuntime = this.createDAGRuntime();
    // 会话 4（Session 化）：共享组件会话仓库（总大脑 + step-agent 持久化会话）
    this.agentSessionStore = new AgentSessionStore();
    // 会话 3：总大脑接线（唯一执行后端；审计循环 + step-agent 执行肢）
    this.orchestratorAgent = this.createOrchestratorAgent(dagRuntime);
    this.executionEngine.setOrchestratorAgent(this.orchestratorAgent);
    this.artifactFacade = new ArtifactFacade(this.eventBus);
    this.verificationEngine = new VerificationEngine(this.eventBus);
    this.complianceChecker = new ComplianceChecker();
    this.approvalGate = new ApprovalGate(this.eventBus);
    this.experienceMiner = new ExperienceMiner(this.eventBus);
    // ═══ 会话 16d（P3 运维）：异常告警检测器（监听 step/装配事件流）═══
    this.anomalyDetector = new AnomalyDetector(this.eventBus);
    this.anomalyDetector.init(this.eventBus);
    // ═══ 会话 16e（3-3 进化提案落地通道）：策略库 + 沙箱 + 半自动应用闭环 ═══
    this.promptStrategyRegistry = new PromptStrategyRegistry();
    this.evolutionSandbox = new EvolutionSandbox();
    this.evolutionApplyLoop = new EvolutionApplyLoop(this.evolutionSandbox, this.promptStrategyRegistry, {
      // 半自动应用：Gate 凭证可签发时自动批准低风险策略；否则停留 pending_approval
      gateContextProvider: async () => {
        if (!this._ontology || !this._guard) return null;
        await this.ensurePiBridge();
        if (!this.piBridge) return null;
        try {
          const { runOntologyGroundedReasoning } = await import('../../gate/runOntologyGroundedReasoning.js');
          const result = await runOntologyGroundedReasoning({
            goal: '演化策略应用（低风险提示词策略）',
            ontology: this._ontology,
            guard: this._guard,
            piBridge: this.piBridge,
            scenario: 'evolution-apply',
          });
          return result.knowledgeContextPackage ?? null;
        } catch {
          return null;
        }
      },
    });
    this.evolutionApplyLoop.init(this.eventBus);
    this.simulator = new ExecutionSimulator();
    this.missionStore = new PersistentMissionStore();
    this.artifactStore = new PersistentArtifactStore();
    this.missionStore.init().catch((err: Error) => console.warn('[ServiceContainer] MissionStore 初始化失败:', err.message));
    this.artifactStore.init().catch((err: Error) => console.warn('[ServiceContainer] ArtifactStore 初始化失败:', err.message));
    this.missionController.setPersistentStore({ save: (m: any) => { this.missionStore.append('mission.updated', m.missionId, { status: m.status, phase: m.phase, progress: m.progress, blocks: m.blocks, risks: m.risks, objective: m.objective }).catch((err: Error) => console.warn('[ServiceContainer] MissionStore 写入失败:', err.message)); } });
    // 连接 EventStore 作为真相源（异步初始化，通过 ready 等待）
    this._ready = this.initEventStore();
    this.artifactFacade.setPersistentStore({ save: (a: unknown) => { /* artifact 通过 transition 持久化 */ }, transition: (id: string, to: string) => this.artifactStore.transition(id, to as unknown as import('../../infrastructure/protocol/contracts/artifact-lifecycle.js').ArtifactStatus) });
    this.controlPlane = new ControlPlane();

    // 初始化跨 Agent 学习引擎
    const expRepo = new ExperienceRepository();
    const distiller = new KnowledgeDistiller();
    const propagator = new LearningPropagationService();
    const matcher = new ExperienceMatcher();
    this.learningEngine = new CrossAgentLearningEngine(expRepo, distiller, propagator, matcher);

    // 尝试将学习经验持久化到 SQLite（missions.db 中的 shared_experiences 表）
    this.initLearningPersistence(expRepo).catch((err: Error) => console.warn('[ServiceContainer] 学习持久化初始化失败:', err.message));

    this.runtime = new MorPexRuntime(
      this.eventBus,
      this.missionController,
      this.executionEngine,
      this.artifactFacade,
      this.verificationEngine,
      this.complianceChecker,
      this.approvalGate,
      this.experienceMiner,
      this.simulator,
      this.teamOrchestrator,
      this.learningEngine,
    );

    // 注入 EvaluationEngine（迭代4：主路径合规）
    // Wave 3a：注入 EventBus → L6 评价结果以 evaluation.scored / evaluation.low_score 事件流出（此前事件桥是死的）
    this.runtime.setEvaluationEngine(new EvaluationEngine(this.eventBus));
  }

  /** setOntology — 注入 Ontology 依赖到 MorPexRuntime（迭代4） */
  setOntology(ontology: OntologyService, guard: ForcedQueryGuard, piBridge: { generateText: (params: { system?: string; prompt: string; temperature?: number; maxTokens?: number }) => Promise<{ text: string }> }): void {
    this.runtime.setOntology(ontology);
    this.runtime.setForcedQueryGuard(guard);
    this.runtime.setPiBridge(piBridge);
    // 会话 4（执行肢解锁）：保存 Gate 依赖供 orchestrator gateRunner 使用
    this._ontology = ontology;
    this._guard = guard;
  }

  /** setContextAssemblyEngine — 注入上下文装配引擎到 MorPexRuntime（功能③ 聚焦装配，orchestrate 后调用） */
  setContextAssemblyEngine(engine: import('../../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine | null): void {
    this._contextAssemblyEngine = engine;
    if (typeof this.runtime.setContextAssemblyEngine === 'function') {
      this.runtime.setContextAssemblyEngine(engine);
    }
  }

  /** 功能③：注册真实数据 Provider 到装配引擎（bootstrap 在 ontology 就绪后调用） */
  registerRealProviders(
    ...providers: import('../../knowledge/context/ContextFragmentRegistry.js').FragmentProvider[]
  ): void {
    const registry = this._contextAssemblyEngine?.getRegistry();
    if (!registry) return;
    for (const p of providers) registry.register(p);
  }

  private _contextAssemblyEngine: import('../../knowledge/context/ContextAssemblyEngine.js').ContextAssemblyEngine | null = null;

  /**
   * ready — 等待所有异步初始化完成
   * 确保 EventStore 等关键基础设施就绪后再对外暴露
   */
  get ready(): Promise<void> {
    return this._ready;
  }

  /**
   * initEventStore — 异步初始化 EventStore 并接入 MissionController
   */
  /**
   * 创建 EventStore append 包装器，支持严格模式
   * MORPEX_STRICT_EVENTSTORE=1 时 append 失败抛错
   */
  private createEventStoreAppender<T extends (...args: any[]) => Promise<void>>(fn: T, label: string): T {
    const strict = process.env.MORPEX_STRICT_EVENTSTORE === '1';
    return ((...args: any[]) => {
      const promise = fn(...args);
      if (strict) return promise;
      promise.catch((err: Error) => console.warn(`[EventStore] ${label} 写入失败:`, err.message));
      return promise;
    }) as T;
  }

  private async initEventStore(): Promise<void> {
    try {
      const { UnifiedEventStore } = await import('../../infrastructure/protocol/events/store/UnifiedEventStore.js');
      this._eventStore = new UnifiedEventStore();      // 严格模式包装
      if (process.env.MORPEX_STRICT_EVENTSTORE === '1') {
        console.log('[ServiceContainer] 🔒 EventStore 严格模式已启用 (MORPEX_STRICT_EVENTSTORE=1)');
      }
      this.missionController.setEventStore(this._eventStore);
      if (typeof this.artifactFacade.setEventStore === 'function') {
        this.artifactFacade.setEventStore(this._eventStore);
      }
      // 接入 SystemMetadataGraph
      systemMetadataGraph.setEventStore(this._eventStore);
      // 功能③：历史抽离完整快照入 EventStore（MorPexRuntime 按 taskRef 召回精确还原）
      if (typeof this.runtime.setEventStore === 'function') {
        this.runtime.setEventStore(this._eventStore);
      }
      // ═══ 会话 16e（3-3 进化落地通道）：演化提案版本化持久化 ═══
      this.evolutionSandbox.setEventStore(this._eventStore);
      console.log('[ServiceContainer] ✅ EventStore 已接入 MissionController + ArtifactFacade + SystemMetadataGraph + MorPexRuntime');
    } catch (err) {
      console.warn('[ServiceContainer] ⚠️ EventStore 不可用:', (err as Error).message);
    }
  }

  /**
   * createOrchestratorAgent — 总大脑（会话 3 多 Agent 框架）
   *
   * 接线：LLM（PiBridge 网关）+ DAG 工具（dagRuntime，nodeHandler 已接 step-agent）+ step-agent 执行器。
   */
  private createOrchestratorAgent(dagRuntime: DAGRuntimeLike): OrchestratorAgent {
    const self = this;
    const stepExecutor = new StepAgentExecutor({
      // 会话 4（Session 化）：step-agent 独立持久化会话
      sessionStore: this.agentSessionStore,
      // ⬅️ 会话 16c（3+4）：步骤结果事件出口（execution.step.result，观测/学习数据源）
      eventBus: this.eventBus,
      // ⬅️ 会话 16j（B2 指针消费端）：按 taskRef 拉取被裁详情（装配「可拉取详情」的消费端）
      recallTask: (taskRef) => this.recallTaskForAgent(taskRef),
    });
    return new OrchestratorAgent({
      llm: {
        generateText: async (opts: { prompt: string; temperature?: number }) => {
          await self.ensurePiBridge();
          if (!self.piBridge) throw new Error('[OrchestratorAgent] PiBridge 不可用');
          return self.piBridge.generateText(opts);
        },
      },
      dagRuntime,
      stepExecutor,
      maxIterations: 3,
      // ═══ P2-8（会话 16l·3）：Bounded Autonomy——步骤数 cap + 编排总 token 预算 ═══
      // 复杂任务拆解失控（实测单任务 4.5h）时截断保底 + 超预算 fail loud，不空转。
      maxSteps: 8,
      maxTotalTokens: 200_000,
      // 会话 4（Session 化）：总大脑会话 + step 会话追踪
      sessionStore: this.agentSessionStore,
      // ⑤ 全链路计费：编排 LLM token 经事件总线上报（CostController 监听 execution.gate.token_usage）
      onTokenUsage: (tokens: number) => {
        if (tokens <= 0) return;
        this.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'execution.gate.token_usage',
          timestamp: Date.now(),
          executionId: `orch_${Date.now()}`,
          source: 'orchestrator',
          payload: { tokens },
        });
      },
      // 会话 4（执行肢解锁）：Gate 两阶段签发凭证（经 runOntologyGroundedReasoning）
      gateRunner: async (goal: string, departmentId?: string) => {
        if (!self._ontology || !self._guard) return null;
        await self.ensurePiBridge();
        if (!self.piBridge) return null;
        try {
          const { runOntologyGroundedReasoning } = await import('../../gate/runOntologyGroundedReasoning.js');
          const result = await runOntologyGroundedReasoning({
            goal,
            ontology: self._ontology,
            guard: self._guard,
            piBridge: self.piBridge,
            extraContext: `departmentId=${departmentId ?? 'global'}（编排前置 Gate 凭证签发）`,
            scenario: 'orchestrator-gate',
            domain: departmentId,
          });
          return result.knowledgeContextPackage ?? null;
        } catch (err) {
          console.warn(`[ServiceContainer] ⚠️ orchestrator Gate 凭证签发失败（破坏性操作保持硬拦截）: ${(err as Error).message}`);
          return null;
        }
      },
    });
  }

  private createMissionRuntime(): void {
    // 仅实例化真实 MissionRuntime（供 bootstrap container.missionRuntime 使用；引擎不再消费包装）
    this.missionRuntime = new MissionRuntime(this.eventBus);
  }

  private createDAGRuntime(): DAGRuntimeLike {
    const realRuntime = new DAGRuntime({
      maxParallel: 4,
      enablePriority: true,
      continueOnFailure: true,
      eventBus: this.eventBus,
      // ═══ 多 Agent 框架（会话 3 P0）：DAG 节点由 step-agent（agentSpawner + 原语工具）执行 ═══
      // 取代原先 ExecutionFabric 单次 LLM 生成（无工具调用 → 生成类任务空转卡死）。
      // ExecutionFabric 降级为 fallback（Agent 不可用时兜底）。
      nodeHandler: async (node, ctx) => {
        const action = node.description || node.name;
        const ctxObj = (ctx !== null && typeof ctx === 'object')
          ? (ctx as Record<string, unknown>)
          : {};
        // P1：上游成果（DAGRuntime 注入）
        const upstream = (ctxObj.upstreamResults instanceof Map ? ctxObj.upstreamResults : new Map<string, unknown>());
        const departmentId = typeof ctxObj.departmentId === 'string' ? ctxObj.departmentId : undefined;
        console.log(`[DAGRuntime] 执行节点: ${node.id} (agentType=${node.agentType}, action=${action.slice(0, 60)})`);

        const executor = new StepAgentExecutor({
          departmentId,
          goal: typeof ctxObj.goal === 'string' ? ctxObj.goal : action,
          // 会话 4（Session 化）：DAG 节点 step-agent 会话也持久化（未预建时自行创建）
          sessionStore: this.agentSessionStore,
          // ⬅️ 会话 16c（3+4）：步骤结果事件出口
          eventBus: this.eventBus,
          // ⬅️ 会话 16j（B2 指针消费端）：按 taskRef 拉取被裁详情
          recallTask: (taskRef) => this.recallTaskForAgent(taskRef),
        });
        // 会话 4：总大脑预建的 step 会话（按节点名匹配，nodeHandler 复用同一会话）
        const stepSessions = (ctxObj.stepSessions instanceof Map ? ctxObj.stepSessions : new Map<string, { session: unknown; sessionPath: string }>());
        const handle = stepSessions.get(node.name) as { session?: unknown; sessionPath?: string } | undefined;
        const result = await executor.executeStep(
          { id: node.id, name: node.name, description: node.description, agentType: node.agentType },
          upstream,
          { session: handle?.session, sessionPath: handle?.sessionPath },
        );
        if (!result.success) throw new Error(result.error || '节点执行失败');
        return result.output;
      },
    });

    // 执行状态缓存，供 getStatus 返回 state 字段（Engine 轮询依赖）
    const statusMap = new Map<string, {
      state: 'running' | 'completed' | 'failed' | 'cancelled';
      dagId: string;
      result?: unknown;
      error?: string;
    }>();

    return {
      name: 'DAGRuntime',
      execute: async (goal: string, tasks: unknown[], context?: Record<string, unknown>) => {
        console.log('[ServiceContainer] DAGRuntime.execute:', goal.substring(0, 60));
        const dagId = `dag_${Date.now()}`;
        statusMap.set(dagId, { state: 'running', dagId });

        // 构造节点列表
        let nodes: import('../../execution/runtime/dag/types.js').DAGNode[] = (tasks || []).map((t: any, i: number) => ({
          id: `node_${i}_${Date.now()}`,
          name: t?.name || `step_${i}`,
          agentType: 'default',
          description: t?.description || t?.name || goal.substring(0, 60),
          deps: t?.deps || [],
          status: 'pending' as const,
          priority: 0,
          retryCount: 0,
          maxRetries: 0,
        }));
        if (nodes.length === 0) {
          nodes.push({
            id: `node_0_${Date.now()}`,
            name: goal.substring(0, 60),
            agentType: 'default',
            description: goal,
            deps: [],
            status: 'pending' as const,
            priority: 0,
            retryCount: 0,
            maxRetries: 0,
          });
        }

        const dag: import('../../execution/runtime/dag/types.js').ExecutionDAG = {
          id: dagId,
          nodes,
          edges: [],
          status: { totalNodes: nodes.length, totalEdges: 0, mutations: 0, isCyclic: false, canRollback: false, isComplete: false },
          createdAt: Date.now(),
        };

        try {
          const result = await realRuntime.run(dag, context || {});
          // ⚠️ 修正：DAGResult.failedNodes 为 number（非数组）——原 `(result as any)?.failedNodes?.length` 恒 false（as any 掩盖的 bug）
          const failed = result.failedNodes > 0 || result.success === false;
          statusMap.set(dagId, {
            state: failed ? 'failed' : 'completed',
            dagId,
            result,
            error: failed ? String(result.errors?.[0]?.error ?? 'node failure') : undefined,
          });
          return { executionId: dagId, ...result };
        } catch (err) {
          statusMap.set(dagId, { state: 'failed', dagId, error: (err as Error).message });
          throw err;
        }
      },

      getStatus: (id: string) => {
        const s = statusMap.get(id);
        if (!s) {
          return { state: 'failed', dagId: id, error: 'unknown executionId' };
        }
        return {
          state: s.state,          // ← Engine 轮询依赖此字段
          dagId: s.dagId,
          result: s.result,
          error: s.error,
          trace: realRuntime.executionTrace,
        };
      },

      cancel: async (id: string) => {
        const s = statusMap.get(id);
        if (s && s.state === 'running') {
          statusMap.set(id, { ...s, state: 'cancelled' });
        }
      },
    };
  }

  private piBridgeInitialized = false;
  private piBridge: any = null;
  /** 会话 4（执行肢解锁）：Gate 依赖引用（setOntology 时保存，供 orchestrator gateRunner 使用） */
  private _ontology: import('../../knowledge/ontology/OntologyService.js').OntologyService | null = null;
  private _guard: import('../../gate/ForcedQueryGuard.js').ForcedQueryGuard | null = null;

  private async ensurePiBridge(): Promise<void> {
    if (this.piBridgeInitialized) return;
    this.piBridgeInitialized = true;
    try {
      // ═══ 会话 16l（P0-2 连接复用）：复用进程级共享单例（此前每次 new + init）
      const { getSharedPiBridge } = await import('../../infrastructure/adapters/pi-bridge/PiBridge.js');
      this.piBridge = getSharedPiBridge();
      await this.piBridge.init();
      console.log('[ServiceContainer] ✅ PiBridge 已初始化 (真实 LLM 模式)');
    } catch (err) {
      console.warn('[ServiceContainer] ⚠️ PiBridge 不可用');
    }
  }

  /**
   * initLearningPersistence — 初始化学习经验持久化
   *
   * 将 in-memory 的 ExperienceRepository 同步到 SQLite（shared_experiences 表）
   * 使学习经验在重启后仍然可用。
   */
  private async initLearningPersistence(expRepo: ExperienceRepository): Promise<void> {
    try {
      const { ExperienceSqliteRepository } = await import('../../cognition/learning/agent/ExperienceSqliteRepository.js');
      const { default: Database } = await import('better-sqlite3');
      const sqliteDb = new Database('./data/missions.db');
      const sqliteRepo = new ExperienceSqliteRepository(sqliteDb);

      // 代理 store 方法：同时写入内存 + SQLite
      const originalStore = expRepo.store.bind(expRepo);
      expRepo.store = (exp: any) => {
        originalStore(exp);
        try { sqliteRepo.save(exp); } catch (_e) { /* SQLite 写入失败不影响主流程 */ }
      };

      console.log('[ServiceContainer] ✅ 学习经验持久化已启用 (missions.db)');
    } catch (_err) {
      console.log('[ServiceContainer] ℹ️ 学习经验使用内存存储（SQLite 不可用）');
    }
  }
}
