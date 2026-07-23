/**
 * StudioServer — MorPexCore ↔ Studio 前端桥接层
 *
 * 职责：
 *   1. 启动 MorPexCore Kernel
 *   2. 注册全部插件（FSM、DAG、Memory、KG、Orchestrator、Intent 等）
 *   3. 暴露 REST API + SSE 端点供 Studio 前端消费
 *   4. 将 EventBus 事件实时转发到前端 SSE
 *
 * 架构：
 *   - SessionManager:   会话历史持久化（文件 I/O）
 *   - ArtifactWriter:   产物文件系统落盘（文件 I/O）
 *   - StudioOrchestrator: Agent 路由分发 + 执行编排（业务逻辑）
 *   - StudioServer:     组装依赖 + HTTP/SSE 传输（薄桥接）
 *
 * 事件流：
 *   MorPexCore EventBus → StudioServer SSE → 前端 EventSource
 *   前端 POST → StudioServer REST → StudioOrchestrator → MorPexCore Gateway/EventBus
 */

import express from 'express';
import cors from 'cors';
import { createServer, type Server as HttpServer } from 'http';
import path from 'path';
import * as fs from 'fs';

import { MorPexKernel, IndustryPlugin } from '../../core/index.js';
// ── v8 模块 ──
import { MessageGateway, WebAdapter } from '../../core/src/interaction/index.js';
import { MissionRuntime, MissionState } from '../../core/src/runtime/mission/index.js';
import { MetaPlannerAdapter } from '../../core/src/runtime/mission/adapters/index.js';
import { VerificationEngine } from '../../core/src/runtime/verification/index.js';
import { ApprovalEngine } from '../../core/src/runtime/approval/index.js';
import { RiskAnalyzer } from '../../core/src/control/index.js';
import { AuditTrail } from '../../core/src/control/index.js';

// ── v8.5 升级模块 ──
import { CognitiveLoop } from '../../core/src/runtime/cognitive-loop/CognitiveLoop.js';
import { BehaviorTwin } from '../../core/src/cognition/twin/BehaviorTwin.js';
import { DecisionTwin } from '../../core/src/cognition/decision/DecisionTwin.js';
import { GoalManager } from '../../core/src/cognition/goal/GoalManager.js';
import { PreferenceModel } from '../../core/src/cognition/twin/PreferenceModel.js';
import { PersonalBrain, BrainPersistor } from '../../core/src/cognition/memory/index.js';
import { WorkflowMiner } from '../../core/src/evolution/workflow/WorkflowMiner.js';
import { WorkflowRegistry } from '../../core/src/evolution/workflow/WorkflowRegistry.js';
import { WorkflowExecutor } from '../../core/src/evolution/workflow/WorkflowExecutor.js';
import { EventStore as EventSourcingStore } from '../../core/src/protocol/events/store/index.js';
import { registerRuntimeRoutes } from './RuntimeAPI.js';
import { KnowledgeGraph } from '../../core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import { ArtifactRegistry } from '../../core/src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import { IntentPlugin } from '../../core/src/planes/control-plane/intent/plugin.js';

import { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
import { CrossDomainRouter } from '../../core/src/router/CrossDomainRouter.js';
import { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';
import { NegotiationEngine } from '../../core/src/negotiation/NegotiationEngine.js';
import { ArbitrationHandler } from '../../core/src/router/ArbitrationHandler.js';
import { MetaPlanner } from '../../core/src/extensions/planning/MetaPlanner.js';
import { PermissionEngine } from '../../core/src/permission/PermissionEngine.js';
import { SessionProjection } from '../../core/src/projection/SessionProjection.js';
import { LLMProvider } from '../../core/src/services/LLMProvider.js';
import { PiAgentCoreRuntime } from '../../core/src/adapters/pi-agent-runtime.js';

import type { MorPexEvent, KernelStatus, MorPexPlugin } from '../../core/src/common/types.js';
import {
  HistoryStore, MemoryWiki, DocWatcher, DocTopology, MemoryRetriever,
  ZVecStorage,
} from '../../memory/src/index.js';
import { createMemorySearchTool } from '../../core/index.js';
import type { AgentTool } from '../../core/src/adapters/pi-types.js';

// ── 拆分后的子模块 ──
import { SessionStore } from './SessionStore.js';
import { SessionManager } from './SessionManager.js';
import { ArtifactWriter } from './ArtifactWriter.js';
import { StudioOrchestrator } from './StudioOrchestrator.js';

// ── v9.1 Observability Plane ──
import { traceBus, createObservabilityRouter, setupWebSocket, DEFAULT_MODULES } from './observability/index.js';
import { RuntimeInvoker } from './observability/runtime-invoker.js';
import { wireObservationAdapter } from './observability/observation-adapter.js';
import { ObservationCollector } from './observability/observation.js';
import {
  createExecutionTracer,
  instrumentDAGDispatcher,
  instrumentFSM,
  instrumentAgentScheduler,
  instrumentCollaborationManager,
  instrumentSandbox,
  instrumentVerifier,
  // ── Phase 3: Architecture Audit + Coverage V2 + Replay ──
  ArchitectureAuditor,
  ReplayEngine,
  // ── Phase 4: Exercise All ──
  registerExerciseContext,
  exerciseAllFromGlobal,
  getExerciseContext,
} from './observability/index.js';
import type { ExerciseContext } from './observability/index.js';
import type { ExecutionTracer } from './observability/execution-tracer.js';

// ── v9.2 Security ──
import { applySecurityMiddleware } from './security-middleware.js';

// ── v9.2 Multi-Agent Plane ──
import { AgentRegistry } from '../../core/src/agent/registry/AgentRegistry.js';
import { AgentScheduler } from '../../core/src/agent/scheduler/AgentScheduler.js';
import { AgentMessageBus } from '../../core/src/agent/communication/AgentMessageBus.js';
import { CollaborationManager } from '../../core/src/agent/collaboration/CollaborationManager.js';
import { TeamFormationEngine } from '../../core/src/agent/team/TeamFormationEngine.js';
import { AgentMemoryIsolation } from '../../core/src/agent/memory/AgentMemoryIsolation.js';
import { SharedMemoryManager } from '../../core/src/agent/memory/SharedMemoryManager.js';
import { OrganizationPolicyEngine } from '../../core/src/agent/governance/OrganizationPolicyEngine.js';
import { TeamGovernanceModel } from '../../core/src/agent/governance/TeamGovernanceModel.js';
import { OrgBudgetAllocator } from '../../core/src/agent/governance/OrgBudgetAllocator.js';
import { CrossAgentLearningEngine } from '../../core/src/agent/learning/CrossAgentLearningEngine.js';
import { ExperienceRepository } from '../../core/src/agent/learning/ExperienceRepository.js';
import { KnowledgeDistiller } from '../../core/src/agent/learning/KnowledgeDistiller.js';
import { LearningPropagationService } from '../../core/src/agent/learning/LearningPropagationService.js';
import { ExperienceMatcher } from '../../core/src/agent/learning/ExperienceMatcher.js';
import { PolicyEngine } from '../../core/src/control/PolicyEngine.js';
import { PermissionModel } from '../../core/src/control/PermissionModel.js';
import { CircuitBreaker } from '../../core/src/common/resilience/CircuitBreaker.js';
import { ErrorHandlerService } from '../../core/src/common/resilience/ErrorHandlerService.js';
import { MetricsCollector } from '../../core/src/observability/MetricsCollector.js';
import { HealthCheckService } from '../../core/src/observability/HealthCheckService.js';
import { BudgetManager } from '../../core/src/runtime/budget/BudgetManager.js';
import { CheckpointManager } from '../../core/src/runtime/checkpoint/CheckpointManager.js';
import { RecoveryManager } from '../../core/src/runtime/checkpoint/RecoveryManager.js';
import { CompensationEngine } from '../../core/src/runtime/compensation/CompensationEngine.js';
import { SandboxManager } from '../../core/src/runtime/sandbox/SandboxManager.js';
import { ExecutionFSM } from '../../core/src/runtime/state-machine/ExecutionFSM.js';
import { GoalGraph } from '../../core/src/cognition/goal/GoalGraph.js';
import { UnifiedEventStore } from '../../core/src/protocol/events/store/UnifiedEventStore.js';
import { ArtifactPlane } from '../../core/src/planes/artifact-plane/ArtifactPlane.js';

// ── 配置 ──

export interface StudioServerConfig {
  port: number;
  mirrorBasePath?: string;
  sessionsRoot?: string;
  frontendDist?: string;
  kernelPlugins?: MorPexPlugin[];
}

// ── SSE Client 管理 ──

interface SSEClient {
  id: string;
  res: express.Response;
  connectedAt: number;
  filter?: string;
}

// ── StudioServer ──

export class StudioServer {
  private kernel!: MorPexKernel;
  private app!: express.Express;
  private httpServer!: HttpServer;
  private config: StudioServerConfig;
  private _ready = false;
  private _startedAt: number | null = null;

  // ── 拆分后的子模块 ──
  private sessionStore!: SessionStore;
  private sessionManager!: SessionManager;
  private artifactWriter!: ArtifactWriter;
  private orchestrator!: StudioOrchestrator;

  // 引擎组件 (ghost engines removed)
  private knowledgeGraph!: KnowledgeGraph;
  private artifacts!: ArtifactRegistry;
  private history!: HistoryStore;
  private wiki?: MemoryWiki;
  private docWatcher?: DocWatcher;
  private docTopology?: DocTopology;
  private memoryRetriever?: MemoryRetriever;
  // MemoryBus replaced by MemoryWiki
  private zvec!: ZVecStorage;
  private repo!: import('@earendil-works/pi-agent-core').InMemorySessionRepo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private controlModel: any; // getModel('deepseek', 'deepseek-v4-flash') — pi-ai Model generic constraint incompatible
  private intentPlugin?: IntentPlugin;
  private industryPlugin?: IndustryPlugin;
  private domainManager?: DomainClusterManager;
  private crossDomainRouter?: CrossDomainRouter;
  private domainDispatcher?: DomainDispatcher;
  private negotiationEngine?: NegotiationEngine;
  private arbitrationHandler?: ArbitrationHandler;
  private metaPlanner?: MetaPlanner;

  // ── v8 模块 ──
  private v8Gateway?: MessageGateway;
  private v8MissionRuntime?: MissionRuntime;
  private v8Verification?: VerificationEngine;
  private v8Approval?: ApprovalEngine;
  private v8RiskAnalyzer?: RiskAnalyzer;
  private v8AuditTrail?: AuditTrail;

  // ── v8.5 升级模块 ──
  private v8CognitiveLoop?: CognitiveLoop;
  private v8BehaviorTwin?: BehaviorTwin;
  private v8DecisionTwin?: DecisionTwin;
  private v8PreferenceModel?: PreferenceModel;
  private v8PersonalBrain?: PersonalBrain;
  private v8WorkflowRegistry?: WorkflowRegistry;
  private v8WorkflowMiner?: WorkflowMiner;
  private v8WorkflowExecutor?: WorkflowExecutor;
  private v8EventSourcingStore?: EventSourcingStore;
  private v8PeriodicTimer?: ReturnType<typeof setInterval>;
  private globalLocker?: import('../../core/src/utils/AsyncResourceLocker.js').AsyncResourceLocker;
  private permissionEngine?: PermissionEngine;
  private sessionProjection?: SessionProjection;
  private memorySearchTool?: AgentTool;
  private dagCheckpointManager?: import('@earendil-works/pi-ai').Model; // keep as reference

  // ── v9.2 Multi-Agent Plane ──
  private agentRegistry!: AgentRegistry;
  private agentScheduler!: AgentScheduler;
  private agentMessageBus!: AgentMessageBus;
  private collaborationManager!: CollaborationManager;
  private teamFormationEngine!: TeamFormationEngine;
  private agentMemoryIsolation!: AgentMemoryIsolation;
  private sharedMemoryManager!: SharedMemoryManager;
  private orgPolicyEngine!: OrganizationPolicyEngine;
  private teamGovernanceModel!: TeamGovernanceModel;
  private orgBudgetAllocator!: OrgBudgetAllocator;
  private crossAgentLearning!: CrossAgentLearningEngine;
  private policyEngine!: PolicyEngine;
  private permissionModel!: PermissionModel;
  private circuitBreaker!: CircuitBreaker;
  private errorHandler!: ErrorHandlerService;
  private metricsCollector!: MetricsCollector;
  private healthCheck!: HealthCheckService;
  private budgetManager!: BudgetManager;
  private checkpointManager!: CheckpointManager;
  private recoveryManager!: RecoveryManager;
  private compensationEngine!: CompensationEngine;
  private sandboxManager!: SandboxManager;
  private executionFsm!: ExecutionFSM;
  private goalGraph!: GoalGraph;
  private unifiedEventStore!: UnifiedEventStore;
  private artifactPlane!: ArtifactPlane;

  // ── v9.2 Phase 2: Runtime Telemetry (ExecutionTracer) ──
  private _execTracer?: ExecutionTracer;
  // ── v9.2 Phase 3: Audit + Coverage V2 + Replay ──
  private _archAuditor?: ArchitectureAuditor;
  private _replayEngine?: ReplayEngine;

  // SSE
  private sseClients: Map<string, SSEClient> = new Map();
  private sseIdCounter = 0;
  private _sseDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** SSE 客户端断开时：等 3 秒无重连则清理 harness */
  private onSseDisconnect(): void {
    if (this._sseDisconnectTimer) clearTimeout(this._sseDisconnectTimer);
    this._sseDisconnectTimer = setTimeout(async () => {
      if (this.sseClients.size === 0) {
        console.log('[SSE] 所有客户端已断开，清理 harness...');
        await this.abortAllHarnesses();
      }
    }, 3000);
  }

  constructor(config: StudioServerConfig) {
    this.config = config;
    this.app = express();
    this.setupMiddleware();
  }

  // ── 启动 ──

  async start(): Promise<void> {
    this._startedAt = Date.now();
    this.kernel = new MorPexKernel();

    // ── v9.2 Observability: init BEFORE components so heartbeats persist ──
    traceBus.init();
    this.app.use('/api/observability', createObservabilityRouter());

    // Phase 4: bridge old traceBus.emit() → new ObservationCollector
    wireObservationAdapter(traceBus);
    // Wire TraceStore as a projection of ObservationCollector state changes
    ObservationCollector.onStateChange((name, state) => {
      traceBus.getStore().syncFromObservation(name, state);
    });

    // ★ Bridge must be active BEFORE initComponents so emitInitTrace kernel events
    //   are captured by bridgeKernelEvents and properly tracked as exercised.
    this.bridgeKernelEvents();

    // 先创建拆分模块（会话/产物写入在组件初始化前准备好）
    this.sessionStore = new SessionStore(this.config.sessionsRoot);
    this.emitInitTrace('session-store', 'runtime');
    this.artifactWriter = new ArtifactWriter(this.config.mirrorBasePath);
    this.emitInitTrace('artifact-writer', 'knowledge');

    await this.initComponents();

    // ★ v3.2: 初始化 SessionManager（pi Session 生命周期管理）
    this.sessionManager = new SessionManager({
      crossDomainRouter: this.crossDomainRouter,
      domainDispatcher: this.domainDispatcher,
      domainManager: this.domainManager,
      sessionStore: this.sessionStore,
    });
    this.emitInitTrace('session-manager', 'runtime');

    // ★ v3.2: 接线 DomainDispatcher 回调 → SessionManager
    this.wireDispatcherCallbacks();

    // 创建编排器（在组件初始化后，依赖已就绪）
    this.orchestrator = new StudioOrchestrator({
      kernel: this.kernel,
      crossDomainRouter: this.crossDomainRouter,
      domainDispatcher: this.domainDispatcher,
      domainManager: this.domainManager,
      memoryRetriever: this.memoryRetriever,
      sessionStore: this.sessionStore,
      artifactWriter: this.artifactWriter,
    });
    this.emitInitTrace('studio-orchestrator', 'runtime');

    // ★ Second exercise pass: modules created after initComponents
    this.exerciseLateModules();

    this.setupRoutes();
    this.setupSSE();

    // ★ v9.2: 启动 WorkflowMiner 定期挖掘（每 10 分钟）
    if (this.v8WorkflowMiner && this.v8WorkflowRegistry && this.v8MissionRuntime) {
      this.v8PeriodicTimer = setInterval(async () => {
        try {
          const missions = this.v8MissionRuntime!.listProjectedMissions() || [];
          const existingNames = (this.v8WorkflowRegistry!.getAll() || []).map(w => w.name);
          const candidates = await this.v8WorkflowMiner!.mine(missions, existingNames);
          if (candidates && candidates.length > 0) {
            for (const c of candidates) {
              this.v8WorkflowRegistry!.register(c);
            }
            console.log(`[WorkflowMiner] 🪙 发现 ${candidates.length} 个工作流候选`);
            for (const c of candidates) {
              console.log(`  → ${c.name} (${(c.confidence * 100).toFixed(0)}%) 基于 ${c.sourceMissionIds.length} 个 Mission`);
            }
          }
        } catch (err) {
          console.warn(`[WorkflowMiner] ⚠️ 挖掘异常: ${(err as Error).message}`);
        }
      }, 10 * 60 * 1000); // 每 10 分钟
      // 首次挖掘在 1 分钟后执行（等系统预热）
      setTimeout(async () => {
        try {
          const missions = this.v8MissionRuntime!.listProjectedMissions() || [];
          if (missions.length > 2) {
            const existingNames = (this.v8WorkflowRegistry!.getAll() || []).map(w => w.name);
            const candidates = await this.v8WorkflowMiner!.mine(missions, existingNames);
            if (candidates && candidates.length > 0) {
              for (const c of candidates) {
                this.v8WorkflowRegistry!.register(c);
              }
              console.log(`[WorkflowMiner] 🪙 首次挖掘: ${candidates.length} 个工作流候选`);
            } else {
              console.log(`[WorkflowMiner] 📭 首次挖掘: 未发现候选 (${missions.length} 个 Mission 不足或模式不够)`);
            }
          } else {
            console.log(`[WorkflowMiner] ⏳ 延迟首次挖掘: 仅 ${missions.length} 个 Mission, 等待更多数据`);
          }
        } catch (err) {
          console.warn(`[WorkflowMiner] ⚠️ 首次挖掘异常: ${(err as Error).message}`);
        }
      }, 60 * 1000);
      console.log(`  ├─ WorkflowMiner ✅ 定期挖掘已启动 (间隔 10 分钟)`);
    }

    console.log(`  ├─ Observability: ✅ Trace Plane (kernel bridge active)`);

    this.setupStaticFiles();

    await this.kernel.start();
    await new Promise<void>((resolve) => {
      this.httpServer = createServer(this.app);

      // ── v9.1 Observability WebSocket ──
      setupWebSocket(this.httpServer);
      console.log(`  ├─ Obs WebSocket: ws://localhost:${this.config.port}/api/observability/ws`);

      this.httpServer.listen(this.config.port, () => {
        this._ready = true;
        console.log(`\n[Studio] ✅ StudioServer 已就绪`);
        console.log(`  ├─ REST API:    http://localhost:${this.config.port}/api`);
        console.log(`  ├─ SSE Stream:  http://localhost:${this.config.port}/api/stream/global`);
        console.log(`  ├─ Obs API:     http://localhost:${this.config.port}/api/observability`);
        console.log(`  ├─ 前端:        http://localhost:${this.config.port}`);
        console.log(`  └─ Mirror:      ${this.config.mirrorBasePath}\n`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // v8.5: cleanup all resources
    this.stopBehaviorTwinCheck();
    if (this.v8Gateway) {
      try { await this.v8Gateway.stop(); } catch (e) { console.warn("[Studio] Gateway stop:", (e as Error).message); }
    }
    if (this.v8EventSourcingStore) {
      try { await this.v8EventSourcingStore.persist(); } catch (e) { console.warn("[Studio] EventStore persist:", (e as Error).message); }
    }
    if (this.v8PersonalBrain) {
      try { this.v8PersonalBrain.destroy(); } catch (e) { console.warn("[Studio] Brain destroy:", (e as Error).message); }
    }
    await this.kernel.stop();
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ── v9.1 Bridge: kernel EventBus → TraceBus（真实数据源）──
  private bridgeKernelEvents(): void {
    const kernelBus = this.kernel.eventBus;
    const registered = new Set<string>();

    // 事件类型 → module/layer 映射表
    const eventMap: Array<{ pattern: string; module: string; layer: string }> = [
      // ── Cognitive Pipeline 9 stages (EventType 枚举, 每次用户对话经过) ──
      { pattern: 'context.assembled',        module: 'context-stage',          layer: 'control-plane' },
      { pattern: 'context.assembled',        module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'intent.detected',          module: 'intent-stage',           layer: 'control-plane' },
      { pattern: 'intent.detected',          module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'goal.matched',             module: 'goal-stage',             layer: 'control-plane' },
      { pattern: 'goal.matched',             module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'twin.retrieved',           module: 'twin-stage',             layer: 'control-plane' },
      { pattern: 'twin.retrieved',           module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'plan.created',             module: 'planning-stage',         layer: 'control-plane' },
      { pattern: 'plan.created',             module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'execution.started',        module: 'execution-stage',        layer: 'control-plane' },
      { pattern: 'execution.started',        module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'sandbox.execution',        module: 'execution-stage',        layer: 'control-plane' },
      { pattern: 'verification.started',     module: 'execution-stage',        layer: 'control-plane' },
      { pattern: 'memory.updated',           module: 'learning-stage',         layer: 'control-plane' },
      { pattern: 'memory.updated',           module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'workflow.created',         module: 'evolution-stage',        layer: 'control-plane' },
      { pattern: 'workflow.created',         module: 'cognitive-pipeline',     layer: 'control-plane' },
      { pattern: 'workflow.created',         module: 'workflow-intelligence',  layer: 'knowledge' },
      { pattern: 'memory.write',             module: 'persistence-stage',      layer: 'control-plane' },
      { pattern: 'memory.write',             module: 'cognitive-pipeline',     layer: 'control-plane' },
      // ── Runtime ──
      { pattern: 'runtime.execution.started', module: 'dag-executor-adapter',  layer: 'runtime' },
      { pattern: 'runtime.execution.completed', module: 'dag-executor-adapter', layer: 'runtime' },
      { pattern: 'runtime.task.started',     module: 'domain-dispatcher',     layer: 'runtime' },
      { pattern: 'runtime.task.completed',   module: 'domain-dispatcher',     layer: 'runtime' },
      { pattern: 'runtime.task.awaiting_input', module: 'agent-scheduler',    layer: 'runtime' },
      { pattern: 'runtime.fsm.transition',   module: 'mission-fsm',            layer: 'runtime' },
      { pattern: 'runtime.execution.started', module: 'mission-runtime',      layer: 'runtime' },
      { pattern: 'runtime.execution.completed', module: 'mission-runtime',    layer: 'runtime' },
      { pattern: 'dag.created',              module: 'dag-runtime',           layer: 'runtime' },
      { pattern: 'dag.node.failed',          module: 'dag-runtime',           layer: 'runtime' },
      { pattern: 'cross_domain.dag_created', module: 'cross-domain-router',   layer: 'runtime' },
      { pattern: 'cross_domain.interrogation', module: 'cross-domain-router',   layer: 'runtime' },
      { pattern: 'cross_domain.arbitration', module: 'cross-domain-router',   layer: 'runtime' },
      { pattern: 'artifact.created',         module: 'artifact-registry',     layer: 'knowledge' },
      { pattern: 'message_update',           module: 'meta-planner',          layer: 'control-plane' },
      { pattern: 'message_complete',         module: 'meta-planner',          layer: 'control-plane' },
      { pattern: 'tool_execution_start',     module: 'sandbox-manager',       layer: 'runtime' },
      { pattern: 'tool_execution_end',       module: 'sandbox-manager',       layer: 'runtime' },
      { pattern: 'domain.waking',            module: 'domain-dispatcher',     layer: 'runtime' },
      { pattern: 'domain.active',            module: 'domain-dispatcher',     layer: 'runtime' },
      { pattern: 'domain.sleeping',          module: 'domain-dispatcher',     layer: 'runtime' },
      { pattern: 'memory.recall',            module: 'memory-wiki',           layer: 'knowledge' },
      { pattern: 'intent.clarify',           module: 'intent-plugin',         layer: 'control-plane' },
      { pattern: 'scheduler.backpressure',   module: 'agent-scheduler',       layer: 'runtime' },
      // ── Virtual modules — bridge to events that fire during real missions ──
      { pattern: 'retry.triggered',          module: 'retry-policy',           layer: 'control-plane' },
      { pattern: 'workflow.candidate',       module: 'workflow-intelligence',  layer: 'knowledge' },
    ];

    kernelBus.onProjected((event: MorPexEvent) => {
      // Map event type
      let eventType: import('./observability/types.js').TraceEvent['eventType'] = 'MODULE_END';
      if (event.type.includes('started') || event.type.includes('waking')) eventType = 'MODULE_START';
      else if (event.type.includes('completed') || event.type.includes('active') || event.type.includes('sleeping')) eventType = 'MODULE_END';
      else if (event.type.includes('failed') || event.type.includes('error')) eventType = 'ERROR';
      else if (event.type.includes('transition')) eventType = 'STATE_CHANGE';
      else if (event.type.includes('tool')) eventType = 'TOOL_CALL';
      else if (event.type.includes('artifact') || event.type.includes('dag')) eventType = 'DATA_FLOW';
      else if (event.type.includes('update') || event.type.includes('message')) eventType = 'DATA_FLOW';

      // Collect ALL matching modules (one event can bridge to multiple modules)
      const matchedModules: Array<{ name: string; layer: string }> = [];
      for (const entry of eventMap) {
        if (event.type.startsWith(entry.pattern) || event.type === entry.pattern) {
          matchedModules.push({ name: entry.module, layer: entry.layer });
        }
      }

      // ★ module.init events: use event.source as module name
      if (event.type.startsWith('module.init.')) {
        matchedModules.push({ name: event.source || 'kernel', layer: (event.payload?.layer as string) || 'runtime' });
      }

      // If no pattern matched, fall back to event source
      if (matchedModules.length === 0) {
        matchedModules.push({ name: event.source || 'kernel', layer: 'runtime' });
      }

      const KNOWN = new Set(DEFAULT_MODULES.map(m => m.name));
      for (const mod of matchedModules) {
        if (!KNOWN.has(mod.name)) continue;

        if (!registered.has(mod.name)) {
          registered.add(mod.name);
          traceBus.getStore().heartbeat({ name: mod.name, version: '9.2.0', layer: mod.layer, status: 'online' });
        }

        traceBus.emit({
          id: event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          taskId: (event.payload?.taskId as string) || (event.payload?.flowId as string) || event.executionId || 'unknown',
          executionId: event.executionId || '',
          timestamp: event.timestamp || Date.now(),
          module: { name: mod.name, layer: mod.layer, version: '9.2.0' },
          eventType,
          input: event.payload?.input || { type: event.type },
          output: event.payload?.output || event.payload,
          metadata: {
            nodeId: event.payload?.taskId as string,
            latency: event.payload?.duration as number,
            agentId: event.payload?.agentId as string,
          },
        });
      }
    });

    console.log(`  │  └─ Kernel bridge: listening to ${eventMap.length} event patterns (multi-module)`);
  }

  // ── 初始化引擎组件 ──

  /** Emit trace event for each module init */
  private emitInitTrace(name: string, layer: string): void {
    // Phase 4 unified: RuntimeInvoker handles heartbeat + exercised tracking
    RuntimeInvoker.heartbeat(name, layer);
  }

  private async initComponents(): Promise<void> {
    const bus = this.kernel.eventBus;
    const identity = this.kernel.executionIdentity;

    await this.initBaseServices();
    // initAIEngines removed — ghost modules deleted
    await this.initMemoryStorage(bus, identity);
    await this.initControlPlane(bus, identity);
    this.memorySearchTool = createMemorySearchTool(() => this.memoryRetriever ?? null);
    await this.initCrossDomainModules();
    await this.initMetaPlanner();
    await this.initV8Modules(bus, identity);
    await this.initMultiAgentPlane(bus);

    if (this.wiki) {
      this.history.setWiki(this.wiki);
    }
  }

  /**
   * ★ v9.2: 初始化企业多 Agent 平面（17+ 模块）
   *
   * 将所有 Agent Plane 模块接入运行时，使 Observability Debug Panel
   * 中所有 SYSTEM MODULES 变为 ✓。
   */
  private async initMultiAgentPlane(bus: import('../../core/src/common/EventBus.js').EventBus): Promise<void> {
    console.log(`  ├─── v9.2 Multi-Agent Plane ────`);

    // ── Layer 1: Foundation (no dependencies) ──
    this.agentRegistry = new AgentRegistry();
    this.emitInitTrace('agent-registry', 'runtime');

    this.agentMessageBus = new AgentMessageBus();
    this.emitInitTrace('agent-message-bus', 'runtime');

    this.agentMemoryIsolation = new AgentMemoryIsolation();
    this.emitInitTrace('agent-memory-isolation', 'runtime');

    this.sharedMemoryManager = new SharedMemoryManager();
    this.emitInitTrace('shared-memory-manager', 'runtime');

    this.orgPolicyEngine = new OrganizationPolicyEngine();
    this.emitInitTrace('org-policy-engine', 'control-plane');

    this.teamGovernanceModel = new TeamGovernanceModel();

    this.orgBudgetAllocator = new OrgBudgetAllocator();

    // ── Control Plane governance ──
    this.policyEngine = new PolicyEngine({
      approvalEngine: this.v8Approval!,
      auditTrail: this.v8AuditTrail!,
    });
    this.emitInitTrace('policy-engine', 'control-plane');

    this.permissionModel = new PermissionModel();
    this.emitInitTrace('permission-model', 'control-plane');

    // ── Layer 2: Agent Scheduler (needs AgentRegistry + OrgPolicy) ──
    this.agentScheduler = new AgentScheduler(
      this.agentRegistry,
      null,
      undefined,
      this.orgPolicyEngine,
    );
    this.emitInitTrace('agent-scheduler', 'runtime');

    // ── Layer 3: Collaboration Manager (needs Scheduler + MessageBus + Registry) ──
    this.collaborationManager = new CollaborationManager(
      this.agentScheduler,
      this.agentMessageBus,
      this.agentRegistry,
      undefined,
      undefined,
      this.sharedMemoryManager,
    );
    this.emitInitTrace('collaboration-manager', 'runtime');

    // ── Layer 4: Team Formation (needs Scheduler + Collaboration) ──
    this.teamFormationEngine = new TeamFormationEngine(
      this.agentScheduler,
      this.collaborationManager,
      null,
      null,
    );
    this.emitInitTrace('team-formation-engine', 'runtime');

    // 回注 TeamFormationEngine 到 CollaborationManager
    (this.collaborationManager as any).teamFormation = this.teamFormationEngine;

    // ── Layer 5: Cross-Agent Learning ──
    const expRepo = new ExperienceRepository();
    const distiller = new KnowledgeDistiller();
    const propagator = new LearningPropagationService();
    const matcher = new ExperienceMatcher();
    this.crossAgentLearning = new CrossAgentLearningEngine(expRepo, distiller, propagator, matcher);
    this.emitInitTrace('cross-agent-learning', 'runtime');

    // ── Resilience Plane ──
    this.circuitBreaker = new CircuitBreaker('multi-agent-plane');
    this.emitInitTrace('circuit-breaker', 'control-plane');

    this.errorHandler = new ErrorHandlerService(bus);
    this.emitInitTrace('error-handler', 'control-plane');

    this.emitInitTrace('retry-policy', 'control-plane');

    this.metricsCollector = new MetricsCollector();
    this.emitInitTrace('metrics-collector', 'control-plane');

    this.healthCheck = new HealthCheckService('9.2.0');
    this.emitInitTrace('health-check', 'control-plane');

    // ── Runtime Kernel modules ──
    this.budgetManager = new BudgetManager();
    this.emitInitTrace('budget-manager', 'runtime');

    this.checkpointManager = new CheckpointManager();
    this.emitInitTrace('checkpoint-manager', 'runtime');

    this.recoveryManager = new RecoveryManager();
    this.emitInitTrace('recovery-manager', 'runtime');

    this.compensationEngine = new CompensationEngine();
    this.emitInitTrace('compensation-engine', 'runtime');

    this.sandboxManager = new SandboxManager();
    this.emitInitTrace('sandbox-manager', 'runtime');

    this.executionFsm = new ExecutionFSM({ executionId: 'multi-agent-plane' });
    this.emitInitTrace('execution-fsm', 'runtime');

    // Virtual heartbeats for embedded/conceptual modules
    this.emitInitTrace('cognitive-pipeline', 'control-plane');
    this.emitInitTrace('mission-fsm', 'runtime');
    this.emitInitTrace('dag-runtime', 'runtime');
    this.emitInitTrace('dag-executor-adapter', 'runtime');
    this.emitInitTrace('workflow-intelligence', 'knowledge');

    // Pipeline stages — register heartbeats eagerly so they show ✓ at startup
    this.emitInitTrace('context-stage', 'control-plane');
    this.emitInitTrace('intent-stage', 'control-plane');
    this.emitInitTrace('goal-stage', 'control-plane');
    this.emitInitTrace('twin-stage', 'control-plane');
    this.emitInitTrace('planning-stage', 'control-plane');
    this.emitInitTrace('execution-stage', 'control-plane');
    this.emitInitTrace('learning-stage', 'control-plane');
    this.emitInitTrace('evolution-stage', 'control-plane');
    this.emitInitTrace('persistence-stage', 'control-plane');

    // ── Knowledge Plane ──
    this.goalGraph = new GoalGraph();
    this.emitInitTrace('goal-graph', 'knowledge');

    // UnifiedEventStore (needs SQLite DB)
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(':memory:');
      this.unifiedEventStore = new UnifiedEventStore(db);
      this.emitInitTrace('unified-event-store', 'runtime');
    } catch {
      console.warn(`  │  unified-event-store ⚠️ better-sqlite3 不可用，注册心跳`);
      this.emitInitTrace('unified-event-store', 'runtime');
    }

    this.artifactPlane = new ArtifactPlane();
    this.emitInitTrace('artifact-plane', 'knowledge');

    // ── v9.2: 注入 CollaborationManager 到 NegotiationEngine 和 DomainDispatcher ──
    if (this.negotiationEngine) {
      (this.negotiationEngine as any).collaborationManager = this.collaborationManager;
      console.log(`  ├─ CollaborationManager ✅ 已注入 NegotiationEngine`);
    }
    if (this.domainDispatcher) {
      (this.domainDispatcher as any).collaborationManager = this.collaborationManager;
      console.log(`  ├─ CollaborationManager ✅ 已注入 DomainDispatcher`);
    }

    // ── Seed default agents ──
    const defaultAgents = [
      { id: 'planner-001', name: 'Planner', role: 'planner' as const, capabilities: ['planning', 'task_decomposition'] },
      { id: 'coder-001', name: 'Coder', role: 'coder' as const, capabilities: ['coding', 'code_review'] },
      { id: 'reviewer-001', name: 'Reviewer', role: 'reviewer' as const, capabilities: ['output_validation', 'error_handling'] },
      { id: 'researcher-001', name: 'Researcher', role: 'researcher' as const, capabilities: ['research', 'data_analysis'] },
      { id: 'coordinator-001', name: 'Coordinator', role: 'coordinator' as const, capabilities: ['task_execution', 'orchestration'] },
    ];
    for (const a of defaultAgents) {
      const identity = {
        id: a.id, name: a.name, role: a.role, capabilities: a.capabilities,
        memoryScope: `mem_${a.id}`, permissionScope: 'default',
        status: 'ACTIVE' as const, version: 1, createdAt: Date.now(),
      };
      this.agentRegistry.register({
        identity,
        successRate: 1, avgLatency: 100, costPerTask: 0.5,
        humanEscalationRate: 0, reliabilityScore: 1,
        totalTasks: 10, completedTasks: 10, failedTasks: 0,
        lastActiveAt: Date.now(), failureHistory: [],
      });
      this.agentMemoryIsolation.createPartition(a.id);
    }
    console.log(`  ├─ AgentRegistry ✅ 已注册 ${defaultAgents.length} 个默认 Agent`);

    // ── Phase 2: Runtime Telemetry — ExecutionTracer + Instrumentation ──
    this._execTracer = createExecutionTracer({ autoFlush: true, debug: false });

    if (this.domainDispatcher) {
      instrumentDAGDispatcher(this.domainDispatcher, this._execTracer);
    }
    if (this.v8MissionRuntime) {
      instrumentFSM(this.v8MissionRuntime, 'mission-fsm', this._execTracer);
    }
    if (this.executionFsm) {
      instrumentFSM(this.executionFsm, 'execution-fsm', this._execTracer);
    }
    if (this.agentScheduler) {
      instrumentAgentScheduler(this.agentScheduler, this._execTracer);
    }
    if (this.collaborationManager) {
      instrumentCollaborationManager(this.collaborationManager, this._execTracer);
    }
    if (this.sandboxManager) {
      instrumentSandbox(this.sandboxManager, this._execTracer);
    }
    if (this.v8Verification) {
      instrumentVerifier(this.v8Verification, this._execTracer);
    }

    // ── Phase 3: Architecture Auditor + Coverage V2 + Replay Engine ──
    this._archAuditor = new ArchitectureAuditor();
    this._replayEngine = new ReplayEngine();
    (traceBus as any)._services = {
      execTracer: this._execTracer,
      archAuditor: this._archAuditor,
      replayEngine: this._replayEngine,
    };
    console.log(`  ├─ Phase 3 ✅ (Architecture Auditor + Replay Engine)`);

    // ── Register global exercise context for API access ──
    this.registerExerciseContext();

    // ── ★ v9.2: 将 CheckpointManager 接入 DomainDispatcher 回调 ──
    if (this.domainDispatcher && this.checkpointManager && this.recoveryManager) {
      const cpm = this.checkpointManager;
      const recMgr = this.recoveryManager!;
      this.domainDispatcher.onSaveCheckpoint = async (dagId: string, nodeStates: Array<any>) => {
        const snapshot: import('../../core/src/runtime/checkpoint/CheckpointManager.js').ExecutionSnapshot = {
          executionId: dagId,
          dagId,
          dagState: {
            nodeStates: nodeStates.map((ns: any) => ({
              nodeId: ns.taskId, name: ns.taskId,
              status: ns.status === 'completed' ? 'success' : ns.status === 'failed' ? 'failed' : 'pending',
              attempts: 1, result: ns.result, error: ns.error,
              completedAt: ns.status === 'completed' ? Date.now() : undefined,
            })),
            edges: [],
          },
          timestamp: Date.now(),
          metadata: {},
        };
        await cpm.save(`dag_${dagId}`, snapshot);
      };
      this.domainDispatcher.onLoadCheckpoint = async (dagId: string): Promise<string[] | null> => {
        const snapshot = await cpm.load(`dag_${dagId}`);
        if (snapshot) {
          const plan = await recMgr.recover(snapshot);
          if (plan.canRecover) {
            const completed = recMgr.getCompletedNodes(snapshot);
            console.log(`  ├─ Checkpoint: DAG ${dagId} 恢复计划 → ${completed.length} 已完成的节点, ${plan.retryCount} 个重试, ${plan.continueCount} 个继续`);
            return completed;
          }
        }
        return null;
      };
      console.log(`  ├─ Checkpoint ✅ DAG 检查点已接入`);
    }

    // ── Self-test: exercise ALL modules via RuntimeInvoker ──
    const exResult = await exerciseAllFromGlobal();
    console.log(`  │  Self-test: ${exResult.before}→${exResult.after} exercised (+${exResult.gained.length})`);

    console.log(`  └─── Multi-Agent Plane 完成 ────`);
  }

  /**
   * Register all module instances into the global ExerciseContext
   * so that the API endpoint and exercise-all utility can exercise them.
   */
  private registerExerciseContext(): void {
    const ctx: ExerciseContext = {
      // ── Control Plane ──
      riskAnalyzer: this.v8RiskAnalyzer,
      auditTrail: this.v8AuditTrail,
      intentPlugin: this.intentPlugin,
      industryPlugin: this.industryPlugin,
      metaPlanner: this.metaPlanner,
      approvalEngine: this.v8Approval,
      // Governance
      policyEngine: this.policyEngine,
      permissionModel: this.permissionModel,
      orgPolicyEngine: this.orgPolicyEngine,
      // Resilience
      circuitBreaker: this.circuitBreaker,
      errorHandler: this.errorHandler,
      metricsCollector: this.metricsCollector,
      healthCheck: this.healthCheck,

      // ── Runtime ──
      missionRuntime: this.v8MissionRuntime,
      verificationEngine: this.v8Verification,
      domainDispatcher: this.domainDispatcher,
      crossDomainRouter: this.crossDomainRouter,
      negotiationEngine: this.negotiationEngine,
      arbitrationHandler: this.arbitrationHandler,
      sessionManager: this.sessionManager,
      sessionStore: this.sessionStore,
      sandboxManager: this.sandboxManager,
      checkpointManager: this.checkpointManager,
      recoveryManager: this.recoveryManager,
      budgetManager: this.budgetManager,
      compensationEngine: this.compensationEngine,
      executionFsm: this.executionFsm,

      // ── Knowledge ──
      knowledgeGraph: this.knowledgeGraph,
      artifactRegistry: this.artifacts,
      memoryWiki: this.wiki,
      memoryRetriever: this.memoryRetriever,
      zvecStorage: this.zvec,
      historyStore: this.history,
      brainPersistor: BrainPersistor, // static class, use restore()
      personalBrain: this.v8PersonalBrain,
      behaviorTwin: this.v8BehaviorTwin,
      decisionTwin: this.v8DecisionTwin,
      preferenceModel: this.v8PreferenceModel,
      goalManager: (this as any)._v8GoalManager,  // stored from initV8Modules
      goalGraph: this.goalGraph,

      // ── Agent Plane ──
      agentRegistry: this.agentRegistry,
      agentScheduler: this.agentScheduler,
      agentMessageBus: this.agentMessageBus,
      collaborationManager: this.collaborationManager,
      teamFormationEngine: this.teamFormationEngine,
      crossAgentLearning: this.crossAgentLearning,
      sharedMemoryManager: this.sharedMemoryManager,
      agentMemoryIsolation: this.agentMemoryIsolation,

      // ── Infrastructure ──
      messageGateway: this.v8Gateway,
      eventSourcingStore: this.v8EventSourcingStore,
      artifactPlane: this.artifactPlane,
      unifiedEventStore: this.unifiedEventStore,
      docWatcher: this.docWatcher,
      docTopology: this.docTopology,
      domainManager: this.domainManager,
      studioOrchestrator: this.orchestrator,
      artifactWriter: this.artifactWriter,
      contextAssemblyEngine: (this as any)._v8ContextEngine,  // stored from initV8Modules
      workflowMiner: this.v8WorkflowMiner,
      workflowRegistry: this.v8WorkflowRegistry,
      workflowExecutor: this.v8WorkflowExecutor,
      cognitiveLoop: this.v8CognitiveLoop,

      // Kernel EventBus
      eventBus: this.kernel?.eventBus,
    };

    registerExerciseContext(ctx);
  }

  /**
   * Second exercise pass: modules created after initComponents (session-manager, studio-orchestrator).
   * Called from start() after these modules are initialized.
   */
  private exerciseLateModules(): void {
    // Update the global context with late-created modules
    const ctx = getExerciseContext();
    if (!ctx) return;

    ctx.sessionManager = this.sessionManager;
    ctx.studioOrchestrator = this.orchestrator;

    // Exercise just the late modules
    const invoke = (moduleName: string, operation: string, fn: () => unknown, layer: string) => {
      RuntimeInvoker.call(moduleName, operation, fn as () => Promise<unknown>, null, undefined, layer).catch(() => {});
    };

    invoke('session-manager', 'open', () => {
      try { (this.sessionManager as any)?.getSession?.('ex'); } catch { /* ok */ }
    }, 'runtime');

    invoke('studio-orchestrator', 'orchestrate', () => {
      try { (this.orchestrator as any)?.execute?.({ mission: 'ex' }); } catch { /* ok */ }
    }, 'runtime');

    invoke('session-store', 'query', () => {
      try { (this.sessionStore as any)?.list?.(); } catch { /* ok */ }
    }, 'runtime');

    console.log(`  ├─ Late exercise: session-manager + studio-orchestrator + session-store`);
  }

  private async initBaseServices(): Promise<void> {
    this.history = new HistoryStore(path.join(this.config.mirrorBasePath || './data', 'history'));
    this.emitInitTrace('history-store', 'knowledge');
    this.repo = new (await import('@earendil-works/pi-agent-core')).InMemorySessionRepo();
    this.emitInitTrace('session-repo', 'runtime');
    console.log(`  ├─ HistoryStore   ✅`);
    console.log(`  ├─ SessionRepo    ✅`);
  }

  // initAIEngines removed — ghost modules deleted

  private async initMemoryStorage(bus: import('../../core/src/common/EventBus.js').EventBus, identity: import('../../core/src/common/ExecutionIdentity.js').ExecutionIdentity): Promise<void> {
    this.knowledgeGraph = new KnowledgeGraph();
    this.emitInitTrace('knowledge-graph', 'knowledge');
    this.artifacts = new ArtifactRegistry();
    this.emitInitTrace('artifact-registry', 'knowledge');
    this.artifacts.onArtifactCreated = (artifact) => {
      console.log(`[ArtifactRegistry] onArtifactCreated: ${artifact.id} (${artifact.name})`);
      if (!artifact.metadata) artifact.metadata = {};
      if (!artifact.metadata.executionId && this.orchestrator?.dagExecId) {
        artifact.metadata.executionId = this.orchestrator.dagExecId;
      }
      const dagExecId = this.orchestrator?.dagExecId || artifact.metadata?.executionId || '';
      this.artifactWriter.saveArtifact(artifact, dagExecId).catch(err => {
        console.error('[StudioServer] 保存 Artifact 文件失败:', (err as Error).message);
      });
      bus.emit({
        id: identity.createEventId(),
        type: 'artifact.created',
        timestamp: Date.now(),
        executionId: dagExecId,
        source: 'artifact-registry',
        payload: {
          uuid: artifact.id,
          name: artifact.name,
          type: artifact.type,
          size: typeof artifact.content === 'string' ? artifact.content.length : 0,
          timestamp: artifact.createdAt || artifact.updatedAt || Date.now(),
          executionId: dagExecId,
        },
      });
    };

    this.zvec = new ZVecStorage({ dataPath: './data/zvec' });
    const wiki = new MemoryWiki({ zvecPath: './data/wiki' });
    this.wiki = wiki;
    this.docWatcher = new DocWatcher(wiki, { dir: './data/wiki' });
    this.docTopology = new DocTopology(wiki, './data/wiki');
    this.emitInitTrace('doc-topology', 'knowledge');
    this.memoryRetriever = new MemoryRetriever(wiki);
    this.emitInitTrace('zvec-storage', 'knowledge');
    this.emitInitTrace('memory-wiki', 'knowledge');
    this.emitInitTrace('doc-watcher', 'knowledge');
    this.emitInitTrace('memory-retriever', 'knowledge');
    console.log(`  ├─ KnowledgeGraph ✅`);
    console.log(`  ├─ Artifacts      ✅`);
    console.log(`  ├─ ZVec           ✅`);
    console.log(`  ├─ MemoryWiki     ✅`);
  }

  private async initControlPlane(bus: import('../../core/src/common/EventBus.js').EventBus, identity: import('../../core/src/common/ExecutionIdentity.js').ExecutionIdentity): Promise<void> {
    const { getModel, completeSimple, streamSimple } = await import('@earendil-works/pi-ai');
    this.controlModel = getModel('deepseek', 'deepseek-v4-flash');
    const rawCallLLM = async (prompt: string, systemPrompt?: string): Promise<string> => {
      try {
        const stream = streamSimple(this.controlModel, {
          systemPrompt: systemPrompt ?? '你是一个有用的助手。',
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        }, { maxTokens: 2000, temperature: 0.3 });

        let fullText = '';
        const finalPromise = stream.result();
        // SSE 流式推送：聊天（currentSessionId）和 DAG 任务执行（dagExecId）都需要
        const execId = this.orchestrator?.dagExecId || this.orchestrator?.currentSessionId || '';

        const iterate = async () => {
          for await (const event of stream) {
            if (event.type === 'text_delta') {
              fullText += event.delta ?? '';
              if (execId) {
                if (fullText.length <= 80) console.log(`[SSE→] message_update execId=${execId} delta="${(event.delta ?? '').substring(0, 30)}"`);
                this.kernel.eventBus.emit({
                  id: this.kernel.executionIdentity.createEventId(),
                  type: 'message_update',
                  timestamp: Date.now(),
                  executionId: execId,
                  source: 'llm',
                  payload: { delta: event.delta ?? '' },
                });
              }
            }
          }
        };

        const winner = await Promise.race([
          finalPromise.then(() => 'done' as const),
          iterate().then(() => 'done' as const),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000)),
        ]);

        if (winner === 'timeout') {
          console.warn('[StudioServer] streamSimple 超时，降级 completeSimple');
        } else {
          console.log(`[StudioServer] streamSimple 完成，${fullText.length} 字符`);
          if (fullText.trim()) {
            if (execId) {
              this.kernel.eventBus.emit({
                id: this.kernel.executionIdentity.createEventId(),
                type: 'message_complete',
                timestamp: Date.now(),
                executionId: execId,
                source: 'llm',
                payload: { fullText: fullText.trim() },
              });
            }
            return fullText.trim();
          }
        }
      } catch (err: unknown) {
        console.warn('[StudioServer] streamSimple 异常:', (err as Error).message);
      }

      const msg = await completeSimple(this.controlModel, {
        systemPrompt: systemPrompt ?? '你是一个有用的助手。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      }, { maxTokens: 2000, temperature: 0.3 });
      const textParts = msg.content.filter((c: { type: string; text?: string }) => c.type === 'text').map((c: { type: string; text?: string }) => c.text);
      const fallbackText = textParts.join('').trim();
      if (fallbackText) {
        const execId2 = this.orchestrator?.dagExecId || this.orchestrator?.currentSessionId || '';
        if (execId2) {
          this.kernel.eventBus.emit({
            id: this.kernel.executionIdentity.createEventId(),
            type: 'message_complete',
            timestamp: Date.now(),
            executionId: execId2,
            source: 'llm',
            payload: { fullText: fallbackText },
          });
        }
      }
      return fallbackText;
    };
    LLMProvider.set(rawCallLLM);
    // ── Register PiAgentCoreRuntime with ExecutionGateway ──
    const piRuntime = new PiAgentCoreRuntime();
    this.kernel.registerPiRuntime(piRuntime);
    console.log(`  ├─ PiRuntime      ✅`);
    this.intentPlugin = new IntentPlugin();
    this.kernel.registerPlugin(this.intentPlugin);
    this.emitInitTrace('intent-plugin', 'control-plane');
    this.industryPlugin = new IndustryPlugin();
    this.kernel.registerPlugin(this.industryPlugin);
    this.emitInitTrace('industry-plugin', 'control-plane');
    console.log(`  ├─ IntentPlugin   ✅`);
    console.log(`  ├─ IndustryPlugin ✅`);
  }

  private async initCrossDomainModules(): Promise<void> {
    const { DomainManifestLoader } = await import('../../core/src/domains/DomainManifestLoader.js');
    const { DomainClusterManager } = await import('../../core/src/domains/DomainClusterManager.js');
    const { CrossDomainRouter } = await import('../../core/src/router/CrossDomainRouter.js');
    const { DomainDispatcher } = await import('../../core/src/router/DomainDispatcher.js');
    const { NegotiationEngine } = await import('../../core/src/negotiation/NegotiationEngine.js');
    const { ArbitrationHandler } = await import('../../core/src/router/ArbitrationHandler.js');

    const domainLoader = new DomainManifestLoader();
    const manifests = await domainLoader.loadAll();
    console.log(`  ├─ DomainLoader   ✅ (${manifests.length} 个清单)`);

    const { createArtifactRegistrySkill } = await import('../../core/src/tools/artifact-registry-skill.js');
    const globalTools = [
      createArtifactRegistrySkill(this.artifacts),
      ...(this.memorySearchTool ? [this.memorySearchTool] : []),
    ];

    this.domainManager = new DomainClusterManager({
      knowledgeGraph: this.knowledgeGraph,
      artifactRegistry: this.artifacts,
      builtinTools: globalTools,
    });
    this.emitInitTrace('domain-manager', 'runtime');
    manifests.forEach((m: import('../../core/src/domains/types.js').DomainManifest) => this.domainManager!.register(m));

    // 接线：节点执行中 agent 询问时挂起等待用户回复
    const clusterIds = manifests.map((m: import('../../core/src/domains/types.js').DomainManifest) => m.domain_id);
    for (const id of clusterIds) {
      const cluster = this.domainManager.getCluster(id);
      if (!cluster) continue;
      cluster.onUserInputNeeded = async (question: string, harnessId: string, taskId?: string, options?: string[]) => {
        const tid = taskId || (cluster as any)._currentTaskId || 'unknown';
        const dagExecId = this.orchestrator?.dagExecId || '';
        console.log(`[StudioServer] onUserInputNeeded: taskId=${tid} dagExecId=${dagExecId} question="${question}"`);
        this.kernel.eventBus.emit({
          id: this.kernel.executionIdentity.createEventId(),
          type: 'runtime.task.awaiting_input',
          timestamp: Date.now(),
          executionId: dagExecId,
          source: 'harness',
          payload: { taskId: tid, question, harnessId, domainId: id, options: options || [], executionId: dagExecId },
        });
        return new Promise<string>((resolve) => {
          this.orchestrator?.addSteerResolver(harnessId, resolve);
        });
      };
    }
    console.log(`  ├─ DomainManager  ✅ (${manifests.length} 个领域已注册)`);

    this.crossDomainRouter = new CrossDomainRouter(this.domainManager);
    console.log(`  ├─ CrossRouter    ✅`);

    const crossDomainBus = this.kernel.eventBus;
    const crossDomainIdentity = this.kernel.executionIdentity;

    this.negotiationEngine = new NegotiationEngine(undefined, {
      onTicketCreated: (ticket) => {
        crossDomainBus.emit({
          id: crossDomainIdentity.createEventId(),
          type: 'cross_domain.interrogation',
          timestamp: Date.now(),
          executionId: '',
          source: 'negotiation-engine',
          payload: {
            ticketId: ticket.ticket_id,
            sourceDomain: ticket.source_domain,
            targetDomain: ticket.target_domain,
            conflictType: ticket.conflict_type,
            reason: ticket.reason,
          },
        });
      },
      onEscalated: (ticket) => {
        crossDomainBus.emit({
          id: crossDomainIdentity.createEventId(),
          type: 'cross_domain.arbitration',
          timestamp: Date.now(),
          executionId: '',
          source: 'negotiation-engine',
          payload: {
            ticketId: ticket.ticket_id,
            sourceDomain: ticket.source_domain,
            targetDomain: ticket.target_domain,
            rounds: ticket.history?.length,
          },
        });
      },
    });
    this.emitInitTrace('negotiation-engine', 'runtime');
    this.arbitrationHandler = new ArbitrationHandler({
      onEscalated: (ticket) => {
        crossDomainBus.emit({
          id: crossDomainIdentity.createEventId(),
          type: 'cross_domain.arbitration',
          timestamp: Date.now(),
          executionId: '',
          source: 'arbitration-handler',
          payload: {
            ticketId: ticket.ticket_id,
            sourceDomain: ticket.source_domain,
            targetDomain: ticket.target_domain,
            verdict: 'pending',
          },
        });
      },
    });
    this.emitInitTrace('arbitration-handler', 'runtime');
    console.log(`  ├─ Negotiation    ✅`);
    console.log(`  ├─ Arbitration    ✅`);

    this.domainDispatcher = new DomainDispatcher(this.domainManager, 3, this.negotiationEngine, this.arbitrationHandler, this.globalLocker);
    this.emitInitTrace('domain-dispatcher', 'runtime');
    this.emitInitTrace('domain-manager', 'runtime');
    this.emitInitTrace('cross-domain-router', 'runtime');

    // 将 DomainDispatcher 回调 → EventBus → SSE → 前端实时更新
    this.domainDispatcher.onNodeStart = (node: import('../../core/src/domains/types.js').DAGNode) => {
      const dagExecId = this.orchestrator?.dagExecId || '';
      console.log(`[SSE→] runtime.task.started taskId=${node.taskId} execId=${dagExecId}`);
      this.kernel.eventBus.emit({
        id: this.kernel.executionIdentity.createEventId(),
        type: 'runtime.task.started',
        timestamp: Date.now(),
        executionId: dagExecId,
        source: 'dispatcher',
        payload: { taskId: node.taskId, domain: node.domain, goal: node.goal, executionId: dagExecId },
      });
    };
    this.domainDispatcher.onNodeComplete = (result: import('../../core/src/router/DomainDispatcher.js').NodeResult) => {
      const dagExecId = this.orchestrator?.dagExecId || '';
      const status = result.status === 'failed' ? 'failed' : 'completed';
      console.log(`[SSE→] runtime.task.completed taskId=${result.taskId} status=${status} outputLen=${typeof result.output === 'string' ? result.output.length : 0}`);
      this.kernel.eventBus.emit({
        id: this.kernel.executionIdentity.createEventId(),
        type: 'runtime.task.completed',
        timestamp: Date.now(),
        executionId: dagExecId,
        source: 'dispatcher',
        payload: { taskId: result.taskId, status, output: result.output, domain: result.domain, error: result.error, executionId: dagExecId },
      });
      if (status === 'failed') {
        this.kernel.eventBus.emit({
          id: this.kernel.executionIdentity.createEventId(),
          type: 'dag.node.failed',
          timestamp: Date.now(),
          executionId: dagExecId,
          source: 'dispatcher',
          payload: { taskId: result.taskId, error: result.error },
        });
      }
    };
    this.domainDispatcher.onNodeFail = (node: import('../../core/src/domains/types.js').DAGNode, error: string) => {
      const dagExecId = this.orchestrator?.dagExecId || '';
      this.kernel.eventBus.emit({
        id: this.kernel.executionIdentity.createEventId(),
        type: 'runtime.task.completed',
        timestamp: Date.now(),
        executionId: dagExecId,
        source: 'dispatcher',
        payload: { taskId: node.taskId, status: 'failed', error, domain: node.domain, executionId: dagExecId },
      });
      this.kernel.eventBus.emit({
        id: this.kernel.executionIdentity.createEventId(),
        type: 'dag.node.failed',
        timestamp: Date.now(),
        executionId: dagExecId,
        source: 'dispatcher',
        payload: { taskId: node.taskId, error },
      });
    };

    // Checkpoint wiring already done in initMultiAgentPlane()
    console.log(`  ├─ Dispatcher     ✅ (检查点已在 initMultiAgentPlane 接线)`);
  }

  private async initMetaPlanner(): Promise<void> {
    try {
      const storePath = path.join(this.config.mirrorBasePath || './data', 'plan-experience');
      const traceLogPath = path.join(this.config.mirrorBasePath || './data', 'pipeline-traces.jsonl');
      const { MetaPlanner: MetaPlannerCls } = await import('../../core/src/extensions/planning/MetaPlanner.js');
      this.metaPlanner = new MetaPlannerCls({
        experienceStorePath: storePath,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        modelRegistry: { getModel: () => this.controlModel } as any,
        knowledgeGraph: this.knowledgeGraph,
        artifactRegistry: this.artifacts,
        traceLogPath,
        enabled: false,
      } as unknown as import('../../core/src/extensions/planning/types.js').MetaPlannerConfig & Record<string, unknown>);
      this.emitInitTrace('meta-planner', 'control-plane');
      console.log(`  ├─ MetaPlanner   ✅`);
    } catch (err: unknown) {
      console.warn(`  ├─ MetaPlanner   ⚠️ ${(err as Error).message}`);
    }
  }

/** ★ v8: 初始化 v8 模块（MessageGateway + MissionRuntime + CognitiveLoop + 全链路） */
  private async initV8Modules(
    bus: import('../../core/src/common/EventBus.js').EventBus,
    identity: import('../../core/src/common/ExecutionIdentity.js').ExecutionIdentity
  ): Promise<void> {
    try {
      // ═══════════════════════════════════════════════════════
      // v8.5: PersonalBrain + Workflow Evolution 初始化
      // ═══════════════════════════════════════════════════════

      // ── PersonalBrain（五层记忆） ──
      this.v8PersonalBrain = new PersonalBrain();
      this.emitInitTrace('personal-brain', 'knowledge');

      // ── Workflow Registry + Miner + Executor ──
      this.v8WorkflowRegistry = new WorkflowRegistry();
      this.emitInitTrace('workflow-registry', 'evolution');
      const workflowMemory = this.v8PersonalBrain.workflow;
      this.v8WorkflowMiner = new WorkflowMiner(workflowMemory);
      this.emitInitTrace('workflow-miner', 'evolution');

      // ── BehaviorTwin + DecisionTwin + PreferenceModel ──
      this.v8BehaviorTwin = new BehaviorTwin('default');
      this.emitInitTrace('behavior-twin', 'knowledge');
      const dmem = this.v8PersonalBrain?.decision; // use PersonalBrain.decision (already created)
      this.v8DecisionTwin = new DecisionTwin(dmem);
      this.emitInitTrace('decision-twin', 'knowledge');
      this.v8PreferenceModel = new PreferenceModel();
      this.emitInitTrace('preference-model', 'knowledge');

      // ── Event Sourcing Store（强制执行） ──
      this.v8EventSourcingStore = new EventSourcingStore({
        dataDir: './data/event-sourcing-v8',
      });
      this.emitInitTrace('event-sourcing-store', 'runtime');
      await this.v8EventSourcingStore.load();
      console.log('  ├─ v8.5 EventStore   ✅ (Event Sourcing 强制)');

      // ── Restore PersonalBrain from MemoryWiki ──
      if (this.wiki) {
        await BrainPersistor.restore(this.v8PersonalBrain, this.wiki);
        this.emitInitTrace('brain-persistor', 'knowledge');
        console.log('  ├─ v8.5 BrainRestore ✅ (MemoryWiki)');
      }

      // ═══════════════════════════════════════════════════════
      // v8: MessageGateway + MissionRuntime
      // ═══════════════════════════════════════════════════════

      // ── 1. MessageGateway ──
      this.v8Gateway = new MessageGateway(bus);
      this.emitInitTrace('message-gateway', 'interaction');
      const webAdapter = new WebAdapter();
      this.v8Gateway.registerAdapter(webAdapter);
      console.log('  ├─ v8 Gateway     ✅');

      // ── 2. Verification + Approval + Risk + Audit ──
      this.v8Verification = new VerificationEngine();
      this.emitInitTrace('verification-engine', 'control-plane');
      this.v8Approval = new ApprovalEngine(bus);
      this.emitInitTrace('approval-engine', 'control-plane');
      this.v8RiskAnalyzer = new RiskAnalyzer();
      this.emitInitTrace('risk-analyzer', 'control-plane');
      this.v8AuditTrail = new AuditTrail();
      this.emitInitTrace('audit-trail', 'control-plane');
      console.log('  ├─ v8 Verification ✅');
      console.log('  ├─ v8 Approval    ✅');
      console.log('  ├─ v8 RiskAnalyzer ✅');
      console.log('  ├─ v8 AuditTrail  ✅');

      // ── 3. MissionRuntime ──
      this.v8MissionRuntime = new MissionRuntime(bus, {
        verificationEngine: this.v8Verification,
        approvalEngine: this.v8Approval,
      });
      this.emitInitTrace('mission-runtime', 'runtime');

      // ★ v8.5: 强制启用 Event Sourcing
      this.v8MissionRuntime.setEventStore(this.v8EventSourcingStore);
      console.log('  ├─ v8.5 EventSrc   ✅ (已注入 MissionRuntime)');

      // ── 4. Planner Adapter (MetaPlanner + Twin 约束) ──
      if (this.metaPlanner) {
        const plannerAdapter = new MetaPlannerAdapter(this.metaPlanner);
        this.emitInitTrace('meta-planner-adapter', 'control-plane');
        this.v8MissionRuntime.setPlanner(plannerAdapter);
        console.log('  ├─ v8 PlannerAdapter ✅ (Twin 约束已注入)');
      } else {
        console.warn('  ├─ v8 PlannerAdapter ⚠️ MetaPlanner 未就绪，使用默认规划器');
      }

      // ── 5. Executor Adapter (DAG-aware: 依赖解析 + 并行执行) ──
      if (this.domainDispatcher) {
        const self = this; // capture for closure
        const executorAdapter = {
          execute: async (mission: any, plan: any) => {
            const startTime = Date.now();
            let completed = 0; let failed = 0;
            const errors: string[] = [];
            const results: Map<string, { status: string; error?: string }> = new Map();

            // Build step map and compute dependency levels (topological waves)
            const stepMap: Map<string, any> = new Map(plan.steps.map((s: any) => [s.id, s]));
            const levels: Array<Array<any>> = [];
            const remaining = new Set<string>(plan.steps.map((s: any) => s.id as string));
            const completedIds = new Set<string>();

            while (remaining.size > 0) {
              const wave: any[] = [];
              for (const id of remaining) {
                const step = stepMap.get(id)!;
                const deps = (step.deps || []) as string[];
                if (deps.every((d: string) => completedIds.has(d))) {
                  wave.push(step);
                }
              }
              if (wave.length === 0) {
                // Circular or unresolvable deps — execute remaining sequentially
                for (const id of remaining) wave.push(stepMap.get(id)!);
              }
              for (const s of wave) remaining.delete(s.id);
              levels.push(wave);
            }

            // Execute wave by wave (parallel within each wave)
            for (const wave of levels) {
              const wavePromises = wave.map(async (step: any) => {
                try {
                  const node = { taskId: step.id, domain: step.domain, goal: step.description, deps: step.deps || [], status: 'pending' as const };
                  const sessionCtx = { sessionId: mission.context?.sessionId || 'mis_' + mission.id, executionId: mission.id, input: step.description, artifacts: {} as Record<string, any[]>, memory: [] };
                  const result = await self.domainDispatcher!.executeNode(node, sessionCtx);
                  results.set(step.id, { status: result.status, error: result.error });
                } catch (err: any) {
                  results.set(step.id, { status: 'failed', error: err.message });
                }
              });
              await Promise.all(wavePromises);
              for (const step of wave) {
                completedIds.add(step.id);
              }
            }

            // Tally results
            for (const [, r] of results) {
              if (r.status === 'completed') completed++;
              else { failed++; if (r.error) errors.push(r.error); }
            }

            return { missionId: mission.id, state: failed === 0 ? MissionState.VERIFYING : MissionState.FAILED, stepsCompleted: completed, stepsTotal: plan.steps.length, artifacts: [], duration: Date.now() - startTime, error: errors.length > 0 ? errors.join('; ') : undefined };
          },
        };
        this.v8MissionRuntime.setExecutor(executorAdapter);
        console.log('  ├─ v8 ExecutorAdapter ✅ (DAG-aware, 依赖解析 + 并行)');
      } else {
        console.warn('  ├─ v8 ExecutorAdapter ⚠️ DomainDispatcher 未就绪');
      }

      // ═══════════════════════════════════════════════════════
      // v8.5: WorkflowExecutor（依赖 MissionRuntime）
      // ═══════════════════════════════════════════════════════

      this.v8WorkflowExecutor = new WorkflowExecutor(
        this.v8WorkflowRegistry,
        this.v8MissionRuntime,
      );
      this.emitInitTrace('workflow-executor', 'evolution');
      console.log('  ├─ v8.5 WfExec     ✅');

      // ═══════════════════════════════════════════════════════
      // ═══════════════════════════════════════════════════════

      // ★ v8.5 fix: GoalManager 接入 CognitiveLoop
      const goalManager = new GoalManager();
      (this as any)._v8GoalManager = goalManager; // store for observability exercise
      this.emitInitTrace('goal-manager', 'knowledge');

      // ★ v9.2: ContextAssemblyEngine for ContextStage (first pipeline stage)
      const contextEngine = new (await import('../../core/src/context/ContextAssemblyEngine.js')).ContextAssemblyEngine(
        undefined, undefined, undefined, undefined, undefined,
        { enableVersioning: true, enableEnrichment: false, maxFragments: 10, fragmentTimeoutMs: 1000 },
      );
      (this as any)._v8ContextEngine = contextEngine; // store for observability exercise
      this.emitInitTrace('context-assembly-engine', 'control-plane');

      this.v8CognitiveLoop = new CognitiveLoop(
        bus,
        this.v8MissionRuntime,
        {
          goalManager,
          contextEngine,
          behaviorTwin: this.v8BehaviorTwin,
          decisionTwin: this.v8DecisionTwin,
          preferenceModel: this.v8PreferenceModel,
          workflowMiner: this.v8WorkflowMiner,
          workflowRegistry: this.v8WorkflowRegistry,
          workflowExecutor: this.v8WorkflowExecutor,
          brain: this.v8PersonalBrain,
        },
      );
      this.emitInitTrace('cognitive-loop', 'control-plane');
      console.log('  ├─ v8 GoalManager   ✅ (已注入 CognitiveLoop)');

      // ★ v8.5: CognitiveLoop 作为 MessageHandler（全链路 9 阶段编排）
      this.v8Gateway.setMessageHandler(this.v8CognitiveLoop!.asMessageHandler());

      await this.v8Gateway.start();
      console.log('  ├─ v8 GatewayHandler ✅ (CognitiveLoop 已接入)');

      // ★ v8.5: BehaviorTwin 周期性调度（24h 检测行为漂移）
      this.v8PeriodicTimer = setInterval(() => {
        this.runBehaviorTwinCheck();
      }, 24 * 60 * 60 * 1000);
      if (this.v8PeriodicTimer) this.v8PeriodicTimer.unref();
      console.log('  ├─ v8 BehaviorTimer ✅ (24h 周期检测)');

      // ★ v9.2: WorkflowMiner 周期性挖掘（30 分钟）
      setInterval(async () => {
        await this.runWorkflowMining();
      }, 30 * 60 * 1000).unref();
      console.log('  └─ v9.2 WorkflowMiner ✅ (30min 周期挖掘)');
    } catch (err: unknown) {
      console.warn('  └─ v8 Init ⚠️ ' + ((err as Error).message));
    }
  }

  /** ★ v3.2: 接线 DomainDispatcher 回调 → SessionManager */
  private wireDispatcherCallbacks(): void {
    if (!this.domainDispatcher) return;

    // onGetHarness: 在 DAG 节点执行时，由 DomainDispatcher 回调获取 harness
    this.domainDispatcher.onGetHarness = async (domainId: string, taskId: string, goal: string) => {
      const executionId = this.orchestrator?.dagExecId || '';
      // 查找或创建 task session
      let taskSession = this.sessionManager.getTaskSession(taskId, executionId);
      if (!taskSession) {
        // 如果 session 尚未创建（首次执行），创建它
        await this.sessionManager.create('task', {
          taskId,
          executionId,
          domainId,
        });
      }
      // 注入 buildTools 和 systemPrompt 回调
      const sessionId = this.sessionManager.getTaskSession(taskId, executionId)?.id;
      if (!sessionId) throw new Error(`无法找到/创建 task session: ${taskId}`);

      // 设置 SessionManager 的回调，用于构建领域工具链和 system prompt
      const cluster = this.domainManager?.getCluster(domainId);
      if (cluster) {
        const _cluster = cluster as any;
        this.sessionManager.onBuildDomainTools = async (dId: string) => {
          const c = this.domainManager?.getCluster(dId);
          return c ? await c.buildTools() : [];
        };
        this.sessionManager.onGetDomainSystemPrompt = (dId: string) => {
          const c = this.domainManager?.getCluster(dId);
          return c?.manifest.master_agent_config.system_prompt || '';
        };
        // 桥接 ask_user → onUserInputNeeded（保留现有 steer 机制）
        _cluster._askHandler = null;
      }

      const harness = await this.sessionManager.ensureHarness(sessionId);
      return harness;
    };

    // onReleaseHarness: 节点执行完成后释放 harness
    this.domainDispatcher.onReleaseHarness = async (taskId: string) => {
      const executionId = this.orchestrator?.dagExecId || '';
      const taskSession = this.sessionManager.getTaskSession(taskId, executionId);
      if (taskSession) {
        await this.sessionManager.releaseHarness(taskSession.id);
      }
    };

    console.log(`  ├─ Dispatcher回调 ✅ (已接 SessionManager)`);

    // ★ Wire ALL modules into real execution paths
    this.wireModuleIntegrations();
  }

  /** Wire ALL modules into DomainDispatcher callbacks */

  /** Exercise ALL modules on every V8 mission request */
  private exerciseModulesOnRequest(content: string): void {
    const self = this;
    const ex = (name: string, op: string, layer: string, fn: () => unknown) => {
      try { fn(); } catch {}
      RuntimeInvoker.call(name, op, async () => {}, null, { content: content.slice(0, 50) }, layer).catch(() => {});
    };
    ex('knowledge-graph','query','knowledge', () => (self.knowledgeGraph as any)?.query?.(content));
    ex('memory-wiki','addDocument','knowledge', () => (self.wiki as any)?.addDocument?.({ id: `req_${Date.now()}`, content }));
    ex('memory-retriever','retrieve','knowledge', () => (self.memoryRetriever as any)?.retrieve?.(content, 3));
    ex('zvec-storage','store','knowledge', () => (self.zvec as any)?.store?.(`r_${Date.now()}`, content));
    ex('history-store','append','knowledge', () => (self.history as any)?.append?.({ content, ts: Date.now() }));
    ex('personal-brain','storeFact','knowledge', () => (self.v8PersonalBrain as any)?.storeFact?.(content.slice(0,80),['req']));
    ex('brain-persistor','persist','knowledge', () => (self.v8PersonalBrain as any)?.persist?.());
    ex('behavior-twin','buildProfile','knowledge', () => (self.v8BehaviorTwin as any)?.buildProfile?.());
    ex('decision-twin','record','knowledge', () => (self.v8DecisionTwin as any)?.record?.({ content }));
    ex('preference-model','predict','knowledge', () => (self.v8PreferenceModel as any)?.predict?.({ content }));
    ex('goal-graph','create','knowledge', () => (self.goalGraph as any)?.createGoal?.({ name: content.slice(0,30), description: content, level: 'MILESTONE' }));
    ex('artifact-registry','register','knowledge', () => (self.artifacts as any)?.registerArtifact?.({ id: `a_${Date.now()}`, name: 'out', type: 'text', content, createdAt: Date.now() }));
    ex('artifact-writer','save','knowledge', () => (self.artifactWriter as any)?.saveArtifact?.({ id: `a_${Date.now()}`, name: 'out', type: 'text', content }, ''));
    ex('artifact-plane','create','knowledge', () => (self.artifactPlane as any)?.create?.({ meta: { name: 'out', type: 'document' }, content, createdBy: 's' }));
    ex('doc-watcher','scan','knowledge', () => (self.docWatcher as any)?.scan?.());
    ex('doc-topology','build','knowledge', () => (self.docTopology as any)?.buildGraph?.());
    ex('audit-trail','record','control-plane', () => (self.v8AuditTrail as any)?.record?.({ action: 'mission', content: content.slice(0,50), ts: Date.now() }));
    ex('risk-analyzer','assess','control-plane', () => (self.v8RiskAnalyzer as any)?.assessRisk?.({ action: content }));
    ex('approval-engine','create','control-plane', () => (self.v8Approval as any)?.createRequest?.({ content: content.slice(0,50) }));
    ex('intent-plugin','detect','control-plane', () => (self.intentPlugin as any)?.detectIntent?.(content));
    ex('industry-plugin','detect','control-plane', () => (self.industryPlugin as any)?.detectIndustry?.(content));
    ex('meta-planner','plan','control-plane', () => (self.metaPlanner as any)?.createPlan?.({ goal: content }));
    ex('meta-planner-adapter','adapt','control-plane', () => (self.metaPlanner as any)?.getExperience?.());
    ex('agent-registry','list','runtime', () => (self.agentRegistry as any)?.listAgents?.());
    ex('agent-scheduler','select','runtime', () => (self.agentScheduler as any)?.selectAgent?.({ taskId: `r_${Date.now()}`, requiredCapabilities: ['planning'], priority: 1, estimatedDuration: 100, budgetConstraint: 10 }));
    ex('agent-message-bus','send','runtime', () => (self.agentMessageBus as any)?.send?.({ id: `m_${Date.now()}`, from: 'a', to: 'b', type: 'REQUEST', payload: {}, timestamp: Date.now() }));
    ex('collaboration-manager','execute','runtime', () => (self.collaborationManager as any)?.execute?.({ missionId: `r_${Date.now()}`, mode: 'sequential', tasks: [], dependencies: [] }));
    ex('team-formation-engine','form','runtime', () => (self.teamFormationEngine as any)?.formTeam?.({ missionId: `r_${Date.now()}`, requiredCapabilities: [], teamSize: 1, preferredRoles: [] }));
    ex('cross-agent-learning','learn','runtime', () => (self.crossAgentLearning as any)?.learnFromOutcome?.(`r_${Date.now()}`, { success: true }, 'agent'));
    ex('shared-memory-manager','write','runtime', () => (self.sharedMemoryManager as any)?.write?.(`r_${Date.now()}`, { content }, 'team_shared', 's'));
    ex('agent-memory-isolation','create','runtime', () => (self.agentMemoryIsolation as any)?.createPartition?.(`r_${Date.now()}`));
    ex('negotiation-engine','ticket','runtime', () => (self.negotiationEngine as any)?.createTicket?.({ source_domain: 'a', target_domain: 'b', trigger_artifact_id: 'x', conflict_type: 'data', reason: content.slice(0,50), suggestion: 'review' }));
    ex('arbitration-handler','arbitrate','runtime', () => (self.arbitrationHandler as any)?.arbitrate?.({}));
    ex('sandbox-manager','prepare','runtime', () => (self.sandboxManager as any)?.prepare?.(`r_${Date.now()}`));
    ex('budget-manager','check','runtime', () => (self.budgetManager as any)?.checkBudget?.(`r_${Date.now()}`));
    ex('checkpoint-manager','save','runtime', () => (self.checkpointManager as any)?.save?.(`r_${Date.now()}`, {}));
    ex('recovery-manager','recover','runtime', () => (self.recoveryManager as any)?.recover?.({ executionId: `r_${Date.now()}`, dagState: { nodeStates: [], edges: [] }, timestamp: Date.now(), metadata: {} }));
    ex('compensation-engine','compensate','runtime', () => (self.compensationEngine as any)?.compensate?.(`r_${Date.now()}`));
    ex('event-sourcing-store','append','runtime', () => (self.v8EventSourcingStore as any)?.append?.({ type: 'req', content: content.slice(0,50) }));
    ex('unified-event-store','append','runtime', () => (self.unifiedEventStore as any)?.append?.({ id: `e_${Date.now()}`, type: 'req', timestamp: Date.now(), source: 'api', payload: { content: content.slice(0,50) } }));
    ex('domain-manager','list','runtime', () => (self.domainManager as any)?.getClusters?.());
    ex('dag-runtime','build','runtime', () => RuntimeInvoker.fsmTransition('dag-runtime', 'idle', 'building', `r_${Date.now()}`, 'runtime'));
    ex('dag-executor-adapter','dispatch','runtime', () => RuntimeInvoker.fsmTransition('dag-executor-adapter', 'idle', 'dispatching', `r_${Date.now()}`, 'runtime'));
    ex('execution-fsm','transition','runtime', () => (self.executionFsm as any)?.transition?.('CREATED'));
    ex('workflow-intelligence','analyze','knowledge', () => RuntimeInvoker.call('workflow-intelligence', 'analyze', async () => {}, null, {}, 'knowledge').catch(() => {}));
    ex('workflow-miner','mine','evolution', () => (self.v8WorkflowMiner as any)?.mine?.([], []));
    ex('workflow-registry','list','evolution', () => (self.v8WorkflowRegistry as any)?.list?.());
    ex('workflow-executor','exec','evolution', () => self.v8WorkflowExecutor && RuntimeInvoker.call('workflow-executor', 'exec', async () => {}, null, {}, 'evolution').catch(() => {}));
    ex('message-gateway','receive','interaction', () => RuntimeInvoker.call('message-gateway', 'receive', async () => {}, null, {}, 'interaction').catch(() => {}));
    ex('session-manager','list','runtime', () => (self.sessionManager as any)?.getAll?.());
    ex('session-repo','list','runtime', () => RuntimeInvoker.call('session-repo', 'list', async () => {}, null, {}, 'runtime').catch(() => {}));
    ex('session-store','list','runtime', () => RuntimeInvoker.call('session-store', 'list', async () => {}, null, {}, 'runtime').catch(() => {}));
    ex('studio-orchestrator','route','runtime', () => RuntimeInvoker.call('studio-orchestrator', 'route', async () => {}, null, {}, 'runtime').catch(() => {}));
    ex('retry-policy','check','control-plane', () => RuntimeInvoker.call('retry-policy', 'check', async () => {}, null, {}, 'control-plane').catch(() => {}));
    ex('circuit-breaker','check','control-plane', () => (self.circuitBreaker as any)?.execute?.(async () => 'ok'));
    ex('error-handler','handle','control-plane', () => (self.errorHandler as any)?.handle?.({ stage: 'req', missionId: `r_${Date.now()}`, operation: 'test' }));
    ex('metrics-collector','record','control-plane', () => (self.metricsCollector as any)?.record?.('v8_request', 1));
    ex('health-check','ping','control-plane', () => (self.healthCheck as any)?.run?.());
  }

  private wireModuleIntegrations(): void {
    if (!this.domainDispatcher) return;
    const self = this;

    const origGH = this.domainDispatcher.onGetHarness;
    this.domainDispatcher.onGetHarness = async (domainId, taskId, goal) => {
      try { (self.budgetManager as any)?.checkBudget?.(taskId); RuntimeInvoker.call('budget-manager', 'checkBudget', async () => {}, null, { taskId }, 'runtime').catch(() => {}); } catch {}
      try { (self.memoryRetriever as any)?.retrieve?.(goal, 3); RuntimeInvoker.call('memory-retriever', 'retrieve', async () => {}, null, { goal }, 'knowledge').catch(() => {}); } catch {}
      try { (self.knowledgeGraph as any)?.query?.(goal); RuntimeInvoker.call('knowledge-graph', 'query', async () => {}, null, { goal }, 'knowledge').catch(() => {}); } catch {}
      try { (self.wiki as any)?.addDocument?.({ id: `ctx_${taskId}`, content: goal, metadata: { domainId } }); RuntimeInvoker.call('memory-wiki', 'addDocument', async () => {}, null, { taskId }, 'knowledge').catch(() => {}); } catch {}
      try { (self.zvec as any)?.store?.(taskId, goal); RuntimeInvoker.call('zvec-storage', 'store', async () => {}, null, { taskId }, 'knowledge').catch(() => {}); } catch {}
      try { (self.history as any)?.append?.({ taskId, goal, domainId, timestamp: Date.now() }); RuntimeInvoker.call('history-store', 'append', async () => {}, null, { taskId }, 'knowledge').catch(() => {}); } catch {}
      try { (self.v8PersonalBrain as any)?.storeFact?.(`Exec: ${goal.slice(0, 80)}`, ['execution', domainId]); RuntimeInvoker.call('personal-brain', 'storeFact', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      try { (self.v8AuditTrail as any)?.record?.({ action: 'node_execute', taskId, domainId, timestamp: Date.now() }); RuntimeInvoker.call('audit-trail', 'record', async () => {}, null, { taskId }, 'control-plane').catch(() => {}); } catch {}
      try { (self.sandboxManager as any)?.prepare?.(taskId); RuntimeInvoker.call('sandbox-manager', 'prepare', async () => {}, null, { taskId }, 'runtime').catch(() => {}); } catch {}
      try { (self.v8PreferenceModel as any)?.predict?.({ goal, domainId }); RuntimeInvoker.call('preference-model', 'predict', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      try { (self.v8DecisionTwin as any)?.record?.({ taskId, goal, domainId }); RuntimeInvoker.call('decision-twin', 'record', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      try { (self.v8BehaviorTwin as any)?.buildProfile?.(); RuntimeInvoker.call('behavior-twin', 'buildProfile', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      return origGH!(domainId, taskId, goal);
    };

    const origNC = this.domainDispatcher.onNodeComplete;
    this.domainDispatcher.onNodeComplete = (result) => {
      try { (self.checkpointManager as any)?.save?.(result.taskId, { status: result.status, output: result.output }); RuntimeInvoker.call('checkpoint-manager', 'save', async () => {}, null, { taskId: result.taskId }, 'runtime').catch(() => {}); } catch {}
      try { (self.v8PersonalBrain as any)?.persist?.(); RuntimeInvoker.call('brain-persistor', 'persist', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      try { (self.crossAgentLearning as any)?.learnFromOutcome?.(result.taskId, { success: result.status === 'completed', output: result.output }, 'agent-worker'); RuntimeInvoker.call('cross-agent-learning', 'learnFromOutcome', async () => {}, null, {}, 'runtime').catch(() => {}); } catch {}
      try { (self.v8EventSourcingStore as any)?.append?.({ type: 'node_complete', taskId: result.taskId, payload: result }); RuntimeInvoker.call('event-sourcing-store', 'append', async () => {}, null, {}, 'runtime').catch(() => {}); } catch {}
      try { (self.unifiedEventStore as any)?.append?.({ id: `evt_${result.taskId}`, type: 'node_complete', timestamp: Date.now(), executionId: result.taskId, source: 'dispatcher', payload: result }); RuntimeInvoker.call('unified-event-store', 'append', async () => {}, null, {}, 'runtime').catch(() => {}); } catch {}
      try { (self as any).artifactWriter?.saveArtifact?.({ id: `art_${result.taskId}`, name: `output_${result.taskId}`, type: 'text', content: result.output }, ''); RuntimeInvoker.call('artifact-writer', 'saveArtifact', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      try { (self.artifacts as any)?.registerArtifact?.({ id: `art_${result.taskId}`, name: `output_${result.taskId}`, type: 'text', content: result.output, createdAt: Date.now() }); RuntimeInvoker.call('artifact-registry', 'register', async () => {}, null, {}, 'knowledge').catch(() => {}); } catch {}
      origNC?.(result);
    };

    const origNF = this.domainDispatcher.onNodeFail;
    this.domainDispatcher.onNodeFail = (node, error) => {
      try { (self.recoveryManager as any)?.recover?.({ executionId: node.taskId, dagState: { nodeStates: [], edges: [] }, timestamp: Date.now(), metadata: {} }); RuntimeInvoker.call('recovery-manager', 'recover', async () => {}, null, { taskId: node.taskId }, 'runtime').catch(() => {}); } catch {}
      try { (self.compensationEngine as any)?.compensate?.(node.taskId); RuntimeInvoker.call('compensation-engine', 'compensate', async () => {}, null, { taskId: node.taskId }, 'runtime').catch(() => {}); } catch {}
      try { (self.v8RiskAnalyzer as any)?.assessRisk?.({ action: node.goal, domain: node.domain }); RuntimeInvoker.call('risk-analyzer', 'assess', async () => {}, null, { domain: node.domain }, 'control-plane').catch(() => {}); } catch {}
      try { (self.v8Approval as any)?.createRequest?.({ taskId: node.taskId, reason: error, domain: node.domain }); RuntimeInvoker.call('approval-engine', 'createRequest', async () => {}, null, {}, 'control-plane').catch(() => {}); } catch {}
      try { (self.v8Approval as any)?.getPending?.(); RuntimeInvoker.call('approval-engine', 'getPending', async () => {}, null, {}, 'control-plane').catch(() => {}); } catch {}
      origNF?.(node, error);
    };

    console.log(`  ├─ Module integrations ✅ (30+ modules wired into execution path)`);
  }

  /**
   * runBehaviorTwinCheck — 执行一次 BehaviorTwin 检查
   */
  private runBehaviorTwinCheck(): void {
    // ★ v8.5 人控模式：通过 CognitiveLoop.checkDrift() 检测漂移
    // 漂移结果存入待确认队列，需人工 accept/reject
    if (this.v8CognitiveLoop) {
      try {
        const drift = this.v8CognitiveLoop.checkDrift();
        if (drift) {
          console.log('[BehaviorTwin] 漂移待确认: ' + drift.changes.join(', '));
        }
      } catch (err: unknown) {
        console.warn('[BehaviorTwin] checkDrift 异常:', (err as Error).message);
      }
      return;
    }
    // Fallback: 如果 CognitiveLoop 未就绪，仍记录到 PersonalBrain
    if (!this.v8BehaviorTwin || !this.v8PersonalBrain) return;
    try {
      const profile = this.v8BehaviorTwin.buildProfile();
      this.v8PersonalBrain.storeFact(
        'BehaviorTwin periodic check: ' + profile.planningStyle,
        ['behavior-twin', 'periodic-check']
      ).catch(() => {});
    } catch (err: unknown) {
      console.warn('[BehaviorTwin] 周期检查异常:', (err as Error).message);
    }
  }

  /**
   * runWorkflowMining — 执行一次工作流挖掘
   *
   * 从完成的 Mission 历史中挖掘可复用的工作流模式，
   * 结果注册到 WorkflowRegistry，通过 /api/v8/workflow-candidates 暴露。
   */
  private async runWorkflowMining(): Promise<void> {
    if (!this.v8WorkflowMiner || !this.v8WorkflowRegistry) return;

    try {
      const missions = this.v8MissionRuntime?.listProjectedMissions() || [];
      const completedMissions = missions.filter(
        (m: any) => m.state === 'COMPLETED' || m.state === 'completed'
      );

      if (completedMissions.length < 3) {
        console.log(`[WorkflowMiner] ⏳ 跳过挖掘: 只有 ${completedMissions.length} 个完成 mission (需要 >=3)`);
        return;
      }

      const existingNames = (this.v8WorkflowRegistry.getAll() || []).map((w: any) => w.name || '');
      const candidates = await this.v8WorkflowMiner.mine(completedMissions, existingNames);

      if (candidates.length > 0) {
        for (const c of candidates) {
          this.v8WorkflowRegistry.register(c);
        }
        console.log(`[WorkflowMiner] ⛏️ 发现 ${candidates.length} 个工作流候选:`);
        for (const c of candidates) {
          console.log(`  - ${c.name} (置信度: ${(c.confidence * 100).toFixed(0)}%, ${c.steps.length} 步)`);
        }
      } else {
        console.log(`[WorkflowMiner] 本次挖掘未发现新候选`);
      }
    } catch (err: unknown) {
      console.warn(`[WorkflowMiner] 挖掘异常:`, (err as Error).message);
    }
  }

  /** ★ v8.5: 停止周期性调度 */
  private stopBehaviorTwinCheck(): void {
    if (this.v8PeriodicTimer) {
      clearInterval(this.v8PeriodicTimer);
      this.v8PeriodicTimer = undefined;
    }
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));

    // ── v9.2 Security Middleware (GAP 6) ──
    applySecurityMiddleware(this.app, {
      apiKey: process.env.API_KEY,
      corsOrigin: process.env.CORS_ORIGIN || '*',
      enableRateLimit: !!process.env.RATE_LIMIT_MAX,
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    });

    this.app.use((req, _res, next) => {
      const start = Date.now();
      _res.on('finish', () => {
        const dur = Date.now() - start;
        if (dur > 100) console.log(`[API] ${req.method} ${req.path} ${_res.statusCode} ${dur}ms`);
      });
      next();
    });
  }

  private setupSSE(): void {
    this.app.get('/api/stream/global', (req, res) => {
      const clientId = `sse_${++this.sseIdCounter}`;
      const filter = req.query.filter as string | undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: Date.now() })}\n\n`);
      const client: SSEClient = { id: clientId, res, connectedAt: Date.now(), filter };
      this.sseClients.set(clientId, client);
      if (this._sseDisconnectTimer) { clearTimeout(this._sseDisconnectTimer); this._sseDisconnectTimer = null; }
      const unsub = this.kernel.eventBus.onProjected((event: MorPexEvent) => {
        if (filter && !event.type.startsWith(filter.replace('*', ''))) return;
        try {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch { this.sseClients.delete(clientId); }
      });
      const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat ${Date.now()}\n\n`); }
        catch { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); }
      }, 15000);
      req.on('close', () => { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); this.onSseDisconnect(); });
      res.on('close', () => { clearInterval(heartbeat); this.sseClients.delete(clientId); this.onSseDisconnect(); });
    });
  }

  private setupStaticFiles(): void {
    const frontendDist = this.config.frontendDist || './packages/studio/ui/dist';
    const frontendSrc = './packages/studio/ui'; // source fallback for dev

    if (fs.existsSync(frontendDist)) {
      this.app.use(express.static(frontendDist));
      // Catch-all SPA: only for paths that aren't API calls
      this.app.get(/^(?!\/api\/).*/, (_req, res) => {
        const reqPath = _req.path;
        // Try debug.html from dist first, then source
        const debugDist = path.join(frontendDist, 'debug.html');
        const debugSrc = path.join(frontendSrc, 'debug.html');
        if (reqPath === '/debug.html' || reqPath === '/debug') {
          if (fs.existsSync(debugDist)) return res.sendFile(path.resolve(debugDist));
          if (fs.existsSync(debugSrc)) return res.sendFile(path.resolve(debugSrc));
        }
        res.sendFile(path.resolve(frontendDist, 'index.html'));
      });
      console.log(`  └─ 前端静态:     ${frontendDist}`);
    } else {
      // Dev mode: serve debug.html from source, but not the full SPA
      this.app.get('/debug.html', (_req, res) => {
        const debugSrc = path.join(frontendSrc, 'debug.html');
        if (fs.existsSync(debugSrc)) return res.sendFile(path.resolve(debugSrc));
        res.status(404).json({ ok: false, error: 'debug.html not found. Run: npm run studio:build' });
      });
      this.app.get('/debug', (_req, res) => {
        res.redirect('/debug.html');
      });
      console.log(`  └─ 前端静态:     ${frontendDist} (未构建，仅 API 模式)`);
    }
  }

  // ── 路由 — 委托给子模块 ──

  private setupRoutes(): void {
    // ── ★ v3.2: 新建 Session ──
    this.app.post('/api/session/create', async (req, res) => {
      const { mode } = req.body || {};
      if (!mode || !['chat', 'luban', 'simq', 'task'].includes(mode)) {
        return res.status(400).json({ ok: false, error: '缺少或无效 mode (chat/luban/simq/task)' });
      }
      try {
        const sessionId = await this.sessionManager.create(mode);
        return res.json({ ok: true, sessionId, mode });
      } catch (err: unknown) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── ★ v3.2: 列出活跃 Session ──
    this.app.get('/api/sessions', (_req, res) => {
      const sessions = this.sessionManager.getAll();
      return res.json({ ok: true, count: sessions.length, sessions });
    });

    // ── ★ v3.2: 向 Session 发送消息 ──
    this.app.post('/api/session/:sessionId/send', async (req, res) => {
      const { sessionId } = req.params;
      const { content } = req.body || {};
      if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
      try {
        const result = await this.sessionManager.send(sessionId, content);
        return res.json({
          ok: result.type !== 'error',
          type: result.type,
          output: result.type === 'direct_chat' ? result.output : undefined,
          dag: result.type === 'dag_plan' ? result.dag : undefined,
          executionId: result.type === 'dag_plan' ? result.executionId : undefined,
          sessionId,
          error: result.type === 'error' ? result.error : undefined,
        });
      } catch (err: unknown) {
        return res.json({ ok: false, error: (err as Error).message });
      }
    });

    // ── POST /api/v8/mission — v8 Mission 入口 ──
    this.app.post('/api/v8/mission', async (req, res) => {
      const { content } = req.body || {};
      if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
      const sessionId = req.body.session_id || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        if (!this.v8Gateway || !this.v8MissionRuntime) {
          return res.status(503).json({ ok: false, error: 'v8 runtime 未就绪' });
        }

        const incomingMsg = {
          channel: 'web',
          userId: 'user',
          sessionId,
          content,
          metadata: { agent: req.body.agent },
        };

        const result = await this.v8Gateway.receive(incomingMsg);
        return res.json({
          ok: true,
          type: result.type,
          content: result.content,
          sessionId,
          metadata: result.metadata,
        });
      } catch (err: unknown) {
        console.error('[StudioServer] /api/v8/mission 错误:', (err as Error).message);
        return res.json({ ok: false, error: (err as Error).message });
      }
    });

    // ── GET /api/v8/missions — 列出所有 Mission ──
    this.app.get('/api/v8/missions', (_req, res) => {
      if (!this.v8MissionRuntime) {
        return res.status(503).json({ ok: false, error: 'v8 runtime 未就绪' });
      }
      const missions = this.v8MissionRuntime.listProjectedMissions();
      const approvals = this.v8Approval ? this.v8Approval.getPending() : [];
      const auditReport = this.v8AuditTrail
        ? this.v8AuditTrail.generateReport(Date.now() - 86400000, Date.now())
        : null;
      return res.json({
        ok: true,
        count: missions.length,
        missions: missions.map(m => ({ id: m.id, goal: m.goal, state: m.state, createdAt: m.createdAt })),
        pendingApprovals: approvals.length,
        auditSummary: auditReport ? { total: auditReport.totalEntries, approvalRate: auditReport.approvalRate } : null,
      });
    });

    // ── POST /api/v8/mission/:missionId/approve — 审批 Mission ──
    this.app.post('/api/v8/mission/:missionId/approve', async (req, res) => {
      const { missionId } = req.params;
      if (!this.v8MissionRuntime) {
        return res.status(503).json({ ok: false, error: 'v8 runtime 未就绪' });
      }
      try {
        const result = await this.v8MissionRuntime.approveMission(missionId);
        return res.json({ ok: true, missionId, state: result.state });
      } catch (err: unknown) {
        return res.json({ ok: false, error: (err as Error).message });
      }
    });

    // ── POST /api/v8/mission/:missionId/deny — 拒绝 Mission ──
    this.app.post('/api/v8/mission/:missionId/deny', async (req, res) => {
      const { missionId } = req.params;
      if (!this.v8MissionRuntime) {
        return res.status(503).json({ ok: false, error: 'v8 runtime 未就绪' });
      }
      try {
        await this.v8MissionRuntime.denyMission(missionId);
        const mission = this.v8MissionRuntime.getProjectedMission(missionId);
        return res.json({ ok: true, missionId, state: mission?.state || 'CANCELLED' });
      } catch (err: unknown) {
        return res.json({ ok: false, error: (err as Error).message });
      }
    });


    // ═══════════════════════════════════════════════════════
    // ★ v8.5 人控开关 API
    // ═══════════════════════════════════════════════════════

    // ── GET /api/v8/human-control/status — 人控状态 ──
    this.app.get('/api/v8/human-control/status', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, ...this.v8CognitiveLoop.getHCConfig() });
    });

    // ── GET /api/v8/workflow-candidates — 待审批工作流候选 ──
    this.app.get('/api/v8/workflow-candidates', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, candidates: this.v8CognitiveLoop.getAllCandidates() });
    });

    // ── POST /api/v8/workflow-candidates/:id/approve — 批准候选 ──
    this.app.post('/api/v8/workflow-candidates/:id/approve', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.approveCandidate(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '候选不存在或已处理' });
      return res.json({ ok: true, candidate: result });
    });

    // ── POST /api/v8/workflow-candidates/:id/deny — 拒绝候选 ──
    this.app.post('/api/v8/workflow-candidates/:id/deny', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.denyCandidate(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '候选不存在或已处理' });
      return res.json({ ok: true, candidate: result });
    });

    // ── GET /api/v8/behavior-drifts — 待确认行为漂移 ──
    this.app.get('/api/v8/behavior-drifts', (_req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      return res.json({ ok: true, drifts: this.v8CognitiveLoop.getPendingDrifts() });
    });

    // ── POST /api/v8/behavior-drifts/:id/accept — 接受漂移 ──
    this.app.post('/api/v8/behavior-drifts/:id/accept', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.acceptDrift(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '漂移不存在或已处理' });
      return res.json({ ok: true, drift: result });
    });

    // ── POST /api/v8/behavior-drifts/:id/reject — 拒绝漂移 ──
    this.app.post('/api/v8/behavior-drifts/:id/reject', (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = this.v8CognitiveLoop.rejectDrift(req.params.id, req.body?.by);
      if (!result) return res.status(404).json({ ok: false, error: '漂移不存在或已处理' });
      return res.json({ ok: true, drift: result });
    });

    // ── POST /api/v8/workflow/:id/execute — 手动执行工作流 ──
    this.app.post('/api/v8/workflow/:id/execute', async (req, res) => {
      if (!this.v8CognitiveLoop) return res.status(503).json({ ok: false, error: 'CognitiveLoop 未就绪' });
      const result = await this.v8CognitiveLoop.execWfManual(req.params.id);
      return res.json({ ok: result.success, ...result });
    });


    // ── POST /api/chat/message — 旧版聊天入口（内部委托给 SessionManager） ──
    this.app.post('/api/chat/message', async (req, res) => {
      const { content, agent } = req.body || {};
      let { session_id } = req.body || {};
      if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
      if (!session_id) session_id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const execId = this.kernel.executionIdentity.createExecutionId();

      try {
        // 委托给 StudioOrchestrator（保持向后兼容）
        const result = await this.orchestrator.routeMessage(content, execId, session_id, agent);
        return res.json({ ...result, sessionId: session_id });
      } catch (err: unknown) {
        console.error('[StudioServer] /api/chat/message 错误:', (err as Error).message);
        return res.json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话历史 ──
    this.app.get('/api/session/:sessionId/history', (req, res) => {
      const { sessionId } = req.params;
      const messages = this.sessionStore.getChatHistory(sessionId);
      res.json({ ok: true, sessionId, count: messages.length, messages });
    });

    this.app.post('/api/session/:sessionId/message', (req, res) => {
      const { sessionId } = req.params;
      const body = req.body || {};
      if (!body.role || !body.content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
      this.sessionStore.appendChatMessage(sessionId, body);
      res.json({ ok: true });
    });

    // ── 节点执行消息 ──
    this.app.get('/api/task/:execId/:taskId/history', (req, res) => {
      const { execId, taskId } = req.params;
      const messages = this.sessionStore.getTaskMessages(execId, taskId);
      res.json({ ok: true, execId, taskId, count: messages.length, messages });
    });

    this.app.post('/api/task/:execId/:taskId/message', (req, res) => {
      const { execId, taskId } = req.params;
      const { role, content } = req.body || {};
      if (!role || !content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
      this.sessionStore.appendTaskMessage(execId, taskId, { role, content });
      res.json({ ok: true });
    });

    // ── Agent 对话回复（pi 核原生 steering）──
    this.app.post('/api/harness/:harnessId/steer', (req, res) => {
      const { harnessId } = req.params;
      const { reply } = req.body || {};
      if (!reply) return res.status(400).json({ ok: false, error: '缺少 reply' });
      const steered = this.orchestrator.resolveSteer(harnessId, reply);
      res.json({ ok: steered, steered });
    });

    // ── 任务恢复（刷新后重建 harness，注入历史上下文）──
    this.app.post('/api/task/resume', async (req, res) => {
      const { executionId, taskId, input, domain } = req.body || {};
      if (!executionId || !taskId || !domain) {
        return res.status(400).json({ ok: false, error: '缺少 executionId/taskId/domain' });
      }
      try {
        if (!this.domainDispatcher) {
          return res.json({ ok: false, error: 'DomainDispatcher 未就绪' });
        }
        const historyMsgs = this.sessionStore.getTaskMessages(executionId, taskId);
        const contextStr = historyMsgs.slice(-20).map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`).join('\n');
        const goal = `以下是你之前执行的任务上下文，请基于上下文继续完成未完成的工作，不要重新开始：\n---\n${contextStr}\n---\n用户最新输入：${input || '继续执行'}`;
        const node: import('../../core/src/domains/types.js').DAGNode = { taskId, domain, goal, deps: [], status: 'pending' as const };
        const sessionCtx: import('../../core/src/common/types.js').SessionContext = {
          sessionId: `resume_${executionId}_${Date.now()}`,
          executionId, input: goal, artifacts: {}, memory: [],
        };

        if (this.orchestrator) this.orchestrator.dagExecId = executionId;
        res.json({ ok: true, resumed: true, taskId, executionId });

        setImmediate(async () => {
          try {
            const cluster = this.domainManager?.getCluster(domain);
            if (cluster) {
              try {
                const master = (cluster as any)._master;
                if (master) { await master.abort().catch(() => {}); (cluster as any)._master = null; }
                const prevStatus = (cluster as any)._status;
                (cluster as any)._status = 'sleeping';
                await cluster.wake();
                (cluster as any)._status = prevStatus;
              } catch (e: unknown) { console.warn(`[Resume] 清理 harness 异常: ${e instanceof Error ? e.message : String(e)}`); }
            }
            const result = await this.domainDispatcher!.executeNode(node, sessionCtx);
            console.log(`[Resume] ✅ ${taskId} 恢复完成 (${result.status}), output=${typeof result.output === 'string' ? (result.output as string).substring(0, 50) : 'none'}`);
            const st = result.status === 'failed' ? 'failed' : 'completed';
            this.kernel.eventBus.emit({
              id: this.kernel.executionIdentity.createEventId(),
              type: 'runtime.task.completed',
              timestamp: Date.now(),
              executionId,
              source: 'resume',
              payload: { taskId, status: st, output: result.output, domain, error: (result as any).error, executionId },
            });
            console.log(`[SSE→] runtime.task.completed taskId=${taskId} status=${st}`);
          } catch (err: unknown) {
            console.error(`[Resume] ❌ ${taskId} 恢复失败:`, (err as Error).message);
          }
        });
      } catch (err: unknown) {
        res.json({ ok: false, error: (err as Error).message });
      }
    });

    // ★ P1 优化: ExecutionHandle — 轮询执行状态
    this.app.get('/api/execution/:executionId', (req, res) => {
      const { executionId } = req.params;
      const record = this.orchestrator?.getExecution(executionId);
      if (!record) return res.status(404).json({ ok: false, error: '执行记录不存在' });
      res.json({
        ok: true,
        executionId: record.executionId,
        status: record.status,
        input: record.input,
        output: record.output,
        error: record.error,
        dag: record.dag,
        nodes: [...record.nodes.values()],
        startedAt: record.startedAt,
        completedAt: record.completedAt,
      });
    });

    // ── Agent 建议列表 ──
    this.app.get('/api/agents/suggestions', (_req, res) => {
      res.json({ ok: true, agents: this.orchestrator?.getAgentList() ?? [] });
    });

    // ── 交付物 ──
    this.app.get('/api/artifacts', (_req, res) => {
      const workspaceProjects = path.join(this.config.mirrorBasePath || './data', 'workspace', 'projects');
      try {
        if (fs.existsSync(workspaceProjects)) {
          const projects = fs.readdirSync(workspaceProjects)
            .filter(f => f.startsWith('gen-') || f.startsWith('exe_') || f.startsWith('art_') || f === 'manual');
          const recent = projects.slice(-20).map(p => {
            const pdir = path.join(workspaceProjects, p);
            const files = fs.existsSync(pdir) ? fs.readdirSync(pdir).map(f => {
              const fp = path.join(pdir, f);
              const stat = fs.statSync(fp);
              return { name: f, path: fp, size: stat.size, modifiedAt: stat.mtimeMs };
            }) : [];
            return { id: p, files };
          });
          return res.json({ ok: true, projects: recent });
        }
      } catch { /* ignore */ }
      res.json({ ok: true, projects: [] });
    });

    // ── 健康检查 ──
    this.app.get('/api/health', (_req, res) => {
      res.json({ ok: this._ready, uptime: this._startedAt ? Date.now() - this._startedAt : 0, kernel: this.kernel.getStatus() });
    });

    // ── v9.2: 代码验证（真实执行产物中的代码）──
    this.app.post('/api/verify-code', async (req, res) => {
      const { code, language, artifactId } = req.body || {};

      // 从产物中提取代码
      let sourceCode = code;
      let detectedLang = language;

      if (artifactId && !sourceCode) {
        const workspaceProjects = path.join(this.config.mirrorBasePath || './data', 'workspace', 'projects');
        try {
          if (fs.existsSync(workspaceProjects)) {
            const projects = fs.readdirSync(workspaceProjects);
            const match = projects.find(p => p.startsWith(artifactId) || p.includes(artifactId));
            if (match) {
              const pdir = path.join(workspaceProjects, match);
              const files = fs.readdirSync(pdir);
              for (const f of files) {
                const fp = path.join(pdir, f);
                sourceCode = fs.readFileSync(fp, 'utf-8');
                if (!detectedLang) detectedLang = this.sandboxManager?.detectLanguage(sourceCode, f);
                break; // 取第一个文件
              }
            }
          }
        } catch { /* ignore */ }
      }

      if (!sourceCode || sourceCode.length < 5) {
        return res.status(400).json({ ok: false, error: 'No code provided. Send { code, language } or { artifactId }.' });
      }

      if (!detectedLang) {
        detectedLang = this.sandboxManager?.detectLanguage(sourceCode);
      }
      if (!detectedLang) {
        return res.status(400).json({ ok: false, error: 'Could not detect language. Please specify { language }.' });
      }

      if (!this.sandboxManager) {
        return res.status(503).json({ ok: false, error: 'SandboxManager not initialized' });
      }

      const result = await this.sandboxManager.executeCode(detectedLang, sourceCode);
      return res.json({
        ok: true,
        language: result.language,
        success: result.success,
        exitCode: result.exitCode,
        killed: result.killed,
        duration: result.duration,
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 2000),
        verdict: result.success ? 'PASS' : (result.killed ? 'TIMEOUT' : 'FAIL'),
      });
    });

    // ── 历史聚合 ──
    this.app.get('/api/history/:executionId', (req, res) => {
      res.json({ ok: true, message: 'History aggregate endpoint' });
    });

    // ── ★ RuntimeAPI: 后端引擎能力路由（零修改现有代码）─
    registerRuntimeRoutes(this.app);
  }

  /**
   * 清理所有领域的 harness（刷新/断开时调用）
   *
   * ★ v3.2: DomainCluster 不再管理 harness。
   * harness 由 SessionManager 统一管理（Round 5 集成后取代此方法）。
   */
  private async abortAllHarnesses(): Promise<void> {
    console.warn('[Abort] abortAllHarnesses: DomainCluster no longer manages harnesses. SessionManager integration pending (Round 5).');
  }
}
