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

import { MorPexKernel } from '../../core/index.js';
import { AgentService } from '../../core/src/services/AgentService.js';
import { FSMEngine } from '../../core/src/planes/runtime-kernel/fsm/FSMEngine.js';
import { DAGEngine } from '../../core/src/planes/runtime-kernel/dag/DAGEngine.js';
import { SchedulerEngine } from '../../core/src/planes/runtime-kernel/scheduler/SchedulerEngine.js';
import { KnowledgeGraph } from '../../core/src/planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import { ArtifactRegistry } from '../../core/src/planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import { AgentOrchestrator } from '../../core/src/planes/agent-plane/orchestrator/AgentOrchestrator.js';
import { IntentPlugin } from '../../core/src/planes/control-plane/intent/plugin.js';
import { IndustryPlugin } from '../../core/index.js';

import { SwarmEngine } from '../../core/src/planes/agent-plane/swarm/SwarmEngine.js';
import { ExecutionGraphEngine } from '../../core/src/planes/runtime-kernel/execution-graph/ExecutionGraph.js';

import { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
import { CrossDomainRouter } from '../../core/src/router/CrossDomainRouter.js';
import { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';
import { NegotiationEngine } from '../../core/src/negotiation/NegotiationEngine.js';
import { ArbitrationHandler } from '../../core/src/router/ArbitrationHandler.js';
import { MetaPlanner } from '../../core/src/extensions/planning/MetaPlanner.js';
import { ExtensionRegistryImpl } from '../../core/src/extensions/ExtensionRegistry.js';
import { LineageTracker } from '../../core/src/extensions/LineageTracker.js';
import { ContextPruner } from '../../core/src/extensions/ContextPruner.js';
import { McpProcessGuard } from '../../core/src/extensions/McpProcessGuard.js';
import type { AsyncResourceLocker } from '../../core/src/utils/AsyncResourceLocker.js';
import { PermissionEngine } from '../../core/src/permission/PermissionEngine.js';
import { SessionProjection } from '../../core/src/projection/SessionProjection.js';
import { ExecutionRecordingEngine } from '../../core/src/mirror/ExecutionRecordingEngine.js';
import { SlidingWindowCompaction } from '../../core/src/compaction/CompactionPolicy.js';
import { McpRuntimeManager } from '../../core/src/mcp/McpRuntimeManager.js';
import { LLMProvider } from '../../core/src/services/LLMProvider.js';

import type { MorPexEvent, KernelStatus } from '../../core/src/common/types.js';
import {
  HistoryStore, MemoryWiki, DocWatcher, DocTopology, MemoryRetriever,
  MemoryBus, ZVecStorage, createMemoryBus,
} from '../../memory/src/index.js';
import { createMemorySearchTool } from '../../core/index.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';

// ── 拆分后的子模块 ──
import { SessionStore } from './SessionStore.js';
import { SessionManager } from './SessionManager.js';
import { ArtifactWriter } from './ArtifactWriter.js';
import { StudioOrchestrator } from './StudioOrchestrator.js';

// ── 配置 ──

export interface StudioServerConfig {
  port: number;
  mirrorBasePath?: string;
  sessionsRoot?: string;
  frontendDist?: string;
  kernelPlugins?: any[];
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

  // 引擎组件
  private agentService!: AgentService;
  private fsmEngine!: FSMEngine;
  private dagEngine!: DAGEngine;
  private schedulerEngine!: SchedulerEngine;
  private swarmEngine!: SwarmEngine;
  private execGraphEngine!: ExecutionGraphEngine;
  private agentOrchestrator!: AgentOrchestrator;
  private knowledgeGraph!: KnowledgeGraph;
  private artifacts!: ArtifactRegistry;
  private history!: HistoryStore;
  private wiki?: MemoryWiki;
  private docWatcher?: DocWatcher;
  private docTopology?: DocTopology;
  private memoryRetriever?: MemoryRetriever;
  private memoryBus?: MemoryBus;
  private zvec!: ZVecStorage;
  private repo: any;
  private controlModel: any;
  private intentPlugin?: IntentPlugin;
  private industryPlugin?: IndustryPlugin;
  private domainManager?: DomainClusterManager;
  private crossDomainRouter?: CrossDomainRouter;
  private domainDispatcher?: DomainDispatcher;
  private negotiationEngine?: NegotiationEngine;
  private arbitrationHandler?: ArbitrationHandler;
  private metaPlanner?: MetaPlanner;
  private extensionRegistry?: ExtensionRegistryImpl;
  private globalLocker?: AsyncResourceLocker;
  private permissionEngine?: PermissionEngine;
  private sessionProjection?: SessionProjection;
  private mcpManager?: McpRuntimeManager;
  private memorySearchTool?: AgentTool;
  private dagCheckpointManager?: any;

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

    // 先创建拆分模块（会话/产物写入在组件初始化前准备好）
    this.sessionStore = new SessionStore(this.config.sessionsRoot);
    this.artifactWriter = new ArtifactWriter(this.config.mirrorBasePath);

    await this.initComponents();

    // ★ v3.2: 初始化 SessionManager（pi Session 生命周期管理）
    this.sessionManager = new SessionManager({
      crossDomainRouter: this.crossDomainRouter,
      domainDispatcher: this.domainDispatcher,
      domainManager: this.domainManager,
      memoryBus: this.memoryBus,
      sessionStore: this.sessionStore,
    });

    // ★ v3.2: 接线 DomainDispatcher 回调 → SessionManager
    this.wireDispatcherCallbacks();

    // 创建编排器（在组件初始化后，依赖已就绪）
    this.orchestrator = new StudioOrchestrator({
      kernel: this.kernel,
      crossDomainRouter: this.crossDomainRouter,
      domainDispatcher: this.domainDispatcher,
      domainManager: this.domainManager,
      memoryBus: this.memoryBus,
      memoryRetriever: this.memoryRetriever,
      sessionStore: this.sessionStore,
      artifactWriter: this.artifactWriter,
    });

    this.setupRoutes();
    this.setupSSE();
    this.setupStaticFiles();
    await this.kernel.start();
    await new Promise<void>((resolve) => {
      this.httpServer = createServer(this.app);
      this.httpServer.listen(this.config.port, () => {
        this._ready = true;
        console.log(`\n[Studio] ✅ StudioServer 已就绪`);
        console.log(`  ├─ REST API:    http://localhost:${this.config.port}/api`);
        console.log(`  ├─ SSE Stream:  http://localhost:${this.config.port}/api/stream/global`);
        console.log(`  ├─ 前端:        http://localhost:${this.config.port}`);
        console.log(`  └─ Mirror:      ${this.config.mirrorBasePath}\n`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.kernel.stop();
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ── 初始化引擎组件 ──

  private async initComponents(): Promise<void> {
    const bus = this.kernel.eventBus;
    const identity = this.kernel.executionIdentity;

    await this.initBaseServices();
    await this.initAIEngines(bus, identity);
    await this.initMemoryStorage(bus, identity);
    await this.initControlPlane(bus, identity);
    this.memorySearchTool = createMemorySearchTool(() => this.memoryRetriever ?? null);
    await this.initCrossDomainModules();
    await this.initMetaPlanner();

    if (this.wiki) {
      this.history.setWiki(this.wiki);
    }
  }

  private async initBaseServices(): Promise<void> {
    this.history = new HistoryStore(path.join(this.config.mirrorBasePath || './data', 'history'));
    this.agentService = new AgentService({ artifactRegistry: this.artifacts });
    this.repo = new (await import('@earendil-works/pi-agent-core')).InMemorySessionRepo();
    console.log(`  ├─ HistoryStore   ✅`);
    console.log(`  ├─ AgentService   ✅`);
    console.log(`  └─ SessionRepo    ✅`);
  }

  private async initAIEngines(bus: any, identity: any): Promise<void> {
    this.fsmEngine = new FSMEngine();
    this.dagEngine = new DAGEngine();
    this.schedulerEngine = new SchedulerEngine();
    this.swarmEngine = new SwarmEngine();
    this.execGraphEngine = new ExecutionGraphEngine();
    this.agentOrchestrator = new AgentOrchestrator();
    console.log(`  ├─ FSM            ✅`);
    console.log(`  ├─ DAG            ✅`);
    console.log(`  ├─ Scheduler      ✅`);
    console.log(`  ├─ Orchestrator   ✅`);
    console.log(`  ├─ Swarm          ✅`);
    console.log(`  └─ ExecutionGraph ✅`);
  }

  private async initMemoryStorage(bus: any, identity: any): Promise<void> {
    this.knowledgeGraph = new KnowledgeGraph();
    this.artifacts = new ArtifactRegistry();
    this.artifacts.onArtifactCreated = (artifact) => {
      console.log(`[ArtifactRegistry] onArtifactCreated: ${artifact.id} (${artifact.name})`);
      if (!artifact.metadata) artifact.metadata = {};
      if (!artifact.metadata.executionId && this.orchestrator?.dagExecId) {
        artifact.metadata.executionId = this.orchestrator.dagExecId;
      }
      const dagExecId = this.orchestrator?.dagExecId || artifact.metadata?.executionId || '';
      this.artifactWriter.saveArtifact(artifact, dagExecId).catch(err => {
        console.error('[StudioServer] 保存 Artifact 文件失败:', err.message);
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
    this.memoryRetriever = new MemoryRetriever(wiki);
    this.memoryBus = createMemoryBus().bus;
    console.log(`  ├─ KnowledgeGraph ✅`);
    console.log(`  ├─ Artifacts      ✅`);
    console.log(`  ├─ ZVec           ✅`);
    console.log(`  ├─ MemoryWiki     ✅`);
    console.log(`  ├─ MemoryBus      ✅`);
  }

  private async initControlPlane(bus: any, identity: any): Promise<void> {
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

        const iterate = async () => {
          for await (const event of stream) {
            if (event.type === 'text_delta') {
              fullText += event.delta;
              const execId = this.orchestrator?.dagExecId || this.orchestrator?.currentSessionId || '';
              if (execId) {
                if (fullText.length <= 80) console.log(`[SSE→] message_update execId=${execId} delta="${event.delta.substring(0, 30)}"`);
                this.kernel.eventBus.emit({
                  id: this.kernel.executionIdentity.createEventId(),
                  type: 'message_update',
                  timestamp: Date.now(),
                  executionId: execId,
                  source: 'llm',
                  payload: { delta: event.delta },
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
          if (fullText.trim()) return fullText.trim();
        }
      } catch (err: any) {
        console.warn('[StudioServer] streamSimple 异常:', err.message);
      }

      const msg = await completeSimple(this.controlModel, {
        systemPrompt: systemPrompt ?? '你是一个有用的助手。',
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      }, { maxTokens: 2000, temperature: 0.3 });
      const textParts = msg.content.filter(c => c.type === 'text').map(c => (c as any).text);
      return textParts.join('').trim();
    };
    LLMProvider.set(rawCallLLM);
    this.intentPlugin = new IntentPlugin();
    this.kernel.registerPlugin(this.intentPlugin);
    this.industryPlugin = new IndustryPlugin();
    this.kernel.registerPlugin(this.industryPlugin);
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
    manifests.forEach((m: any) => this.domainManager!.register(m));

    // 接线：节点执行中 agent 询问时挂起等待用户回复
    const clusterIds = manifests.map((m: any) => m.domain_id);
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

    this.negotiationEngine = new NegotiationEngine();
    this.arbitrationHandler = new ArbitrationHandler();
    console.log(`  ├─ Negotiation    ✅`);
    console.log(`  ├─ Arbitration    ✅`);

    this.domainDispatcher = new DomainDispatcher(this.domainManager, 3, this.negotiationEngine, this.arbitrationHandler, this.globalLocker);

    // 将 DomainDispatcher 回调 → EventBus → SSE → 前端实时更新
    this.domainDispatcher.onNodeStart = (node: any) => {
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
    this.domainDispatcher.onNodeComplete = (result: any) => {
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
    this.domainDispatcher.onNodeFail = (node: any, error: string) => {
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
    console.log(`  ├─ Dispatcher     ✅ (回调已连 SSE)`);
  }

  private async initMetaPlanner(): Promise<void> {
    try {
      const storePath = path.join(this.config.mirrorBasePath || './data', 'plan-experience');
      const traceLogPath = path.join(this.config.mirrorBasePath || './data', 'pipeline-traces.jsonl');
      const { MetaPlanner: MetaPlannerCls } = await import('../../core/src/extensions/planning/MetaPlanner.js');
      this.metaPlanner = new MetaPlannerCls({
        experienceStorePath: storePath,
        modelRegistry: { getModel: () => this.controlModel } as any,
        memoryBus: this.memoryBus as any,
        knowledgeGraph: this.knowledgeGraph,
        artifactRegistry: this.artifacts,
        traceLogPath,
        enabled: false,
      } as any);
      console.log(`  ├─ MetaPlanner   ✅`);
    } catch (err: any) {
      console.warn(`  ├─ MetaPlanner   ⚠️ ${err.message}`);
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
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
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
    if (fs.existsSync(frontendDist)) {
      this.app.use(express.static(frontendDist));
      this.app.get('*', (_req, res) => {
        res.sendFile(path.resolve(frontendDist, 'index.html'));
      });
      console.log(`  └─ 前端静态:     ${frontendDist}`);
    } else {
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
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err.message });
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
      } catch (err: any) {
        return res.json({ ok: false, error: err.message });
      }
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
      } catch (err: any) {
        console.error('[StudioServer] /api/chat/message 错误:', err.message);
        return res.json({ ok: false, error: err.message });
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
        const contextStr = historyMsgs.slice(-20).map((m: any) => `[${m.role}]: ${m.content}`).join('\n');
        const goal = `以下是你之前执行的任务上下文，请基于上下文继续完成未完成的工作，不要重新开始：\n---\n${contextStr}\n---\n用户最新输入：${input || '继续执行'}`;
        const node: any = { taskId, domain, goal, deps: [], status: 'pending' };
        const sessionCtx: any = {
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
              } catch (e: any) { console.warn(`[Resume] 清理 harness 异常: ${e.message}`); }
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
          } catch (err: any) {
            console.error(`[Resume] ❌ ${taskId} 恢复失败:`, err.message);
          }
        });
      } catch (err: any) {
        res.json({ ok: false, error: err.message });
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

    // ── 历史聚合 ──
    this.app.get('/api/history/:executionId', (req, res) => {
      res.json({ ok: true, message: 'History aggregate endpoint' });
    });
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
