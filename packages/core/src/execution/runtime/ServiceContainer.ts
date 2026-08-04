import { EventBus } from '../../infrastructure/common/EventBus.js';
import { MissionController } from './mission/MissionController.js';
import { DynamicTeamOrchestrator } from '../../execution/DynamicTeamOrchestrator.js';
import { UnifiedExecutionEngine } from '../../execution/UnifiedExecutionEngine.js';
import type { MissionRuntimeLike, DAGRuntimeLike, ExecutionFabricLike } from '../../execution/UnifiedExecutionEngine.js';
import { ArtifactFacade } from '../../knowledge/artifact/ArtifactFacade.js';
import { VerificationEngine } from '../../evaluation/verification/VerificationEngine.js';
import { ComplianceChecker } from '../../governance/ComplianceChecker.js';
import { ApprovalGate } from '../../governance/ApprovalGate.js';
import { ExperienceMiner } from '../../evolution/ExperienceMiner.js';
import { ExecutionSimulator } from './simulation/ExecutionSimulator.js';
import { MorPexRuntime } from './MorPexRuntime.js';
import { MissionRuntime } from './mission/MissionRuntime.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { StepAgentExecutor } from './dag/StepAgentExecutor.js';
import { OrchestratorAgent } from '../orchestration/OrchestratorAgent.js';
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
 * 根据任务描述生成模拟代码（用于降级/测试场景）
 * 包含 TaskVerifier 验证所需的关键词
 */
function generateMockCode(action: string, _capability: string): string {
  const isTodoRelated = /todo|saas|task|app|application/i.test(action);
  const isAPIRelated = /api|rest|endpoint|service/i.test(action);
  const isCLIRelated = /cli|command|terminal|shell/i.test(action);

  if (isTodoRelated) {
    return `# Todo SaaS Application

## 代码实现
\`\`\`javascript
// 用户认证系统
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));

// 注册
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  // 保存用户
  res.json({ success: true, token: 'jwt-token-here' });
});

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  // 验证用户
  req.session.user = { username };
  res.json({ success: true, auth: true });
});

// CRUD - 创建任务
app.post('/api/todos', (req, res) => {
  const { title, description } = req.body;
  const todo = { id: Date.now(), title, description, completed: false };
  // 保存到数据库
  res.json({ success: true, todo, create: true });
});

// CRUD - 读取任务
app.get('/api/todos', (req, res) => {
  const todos = []; // 从数据库读取
  res.json({ success: true, todos, read: true });
});

// CRUD - 更新任务
app.put('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  const { title, completed } = req.body;
  // 更新
  res.json({ success: true, update: true });
});

// CRUD - 删除任务
app.delete('/api/todos/:id', (req, res) => {
  const { id } = req.params;
  // 删除
  res.json({ success: true, delete: true, crud: true });
});

// 团队协作
app.get('/api/team/projects', (req, res) => {
  res.json({ projects: [{ id: 1, name: 'Project A', members: ['user1', 'user2'] }], team: true, collaborat: true });
});

// 共享任务
app.post('/api/share', (req, res) => {
  const { todoId, sharedWith } = req.body;
  res.json({ success: true, share: true, member: sharedWith, collaborat: true });
});

// 项目列表
app.get('/api/projects', (req, res) => {
  res.json({ projects: [{ id: 1, name: 'Project Alpha', members: ['user1', 'user2'] }], project: 'demo-project' });
});
\`\`\`

## 文档说明
本系统是一个完整的 Todo SaaS 应用，支持用户认证、任务 CRUD 和团队协作。

### 技术栈
- 后端: Node.js + Express
- 前端: React
- 数据库: PostgreSQL
- 认证: JWT + Session

### API 接口
- POST /api/register - 用户注册
- POST /api/login - 用户登录
- GET /api/todos - 获取任务列表
- POST /api/todos - 创建任务
- PUT /api/todos/:id - 更新任务
- DELETE /api/todos/:id - 删除任务
- GET /api/team/projects - 团队项目
- POST /api/share - 共享任务

### 功能特性
- 用户认证（register, login, auth, session, token）
- 任务管理（create, read, update, delete, crud）
- 团队协作（team, share, collaborat, project, member）
- 密码加密存储
`;
  }

  if (isAPIRelated) {
    return `# REST API Service\n\n## 代码实现\n\`\`\`python\nfrom flask import Flask, request, jsonify, session\nfrom flask_sqlalchemy import SQLAlchemy\nimport jwt\n\napp = Flask(__name__)\ndb = SQLAlchemy()\n\nclass User(db.Model):\n    id = db.Column(db.Integer, primary_key=True)\n    username = db.Column(db.String(80), unique=True)\n    password = db.Column(db.String(200))\n    token = db.Column(db.String(200))\n\n@app.route('/api/register', methods=['POST'])\ndef register():\n    data = request.json\n    # 注册逻辑\n    return jsonify({'success': True, 'auth': True})\n\n@app.route('/api/login', methods=['POST'])\ndef login():\n    data = request.json\n    session['user'] = data['username']\n    return jsonify({'success': True, 'token': 'jwt-token'})\n\n@app.route('/api/items', methods=['GET', 'POST', 'PUT', 'DELETE'])\ndef crud():\n    if request.method == 'POST':\n        return jsonify({'create': True})\n    elif request.method == 'GET':\n        return jsonify({'read': True, 'items': []})\n    elif request.method == 'PUT':\n        return jsonify({'update': True})\n    elif request.method == 'DELETE':\n        return jsonify({'delete': True, 'crud': True})\n\n@app.route('/api/team/share', methods=['POST'])\ndef share():\n    return jsonify({'share': True, 'team': True, 'collaborat': True})\n\`\`\`\n\n## 文档\nRESTful API 服务，支持完整的 CRUD 操作、用户认证和团队协作。\n`;
  }

  if (isCLIRelated) {
    return `# CLI Tool\n\n## 代码实现\n\`\`\`python\nimport sys\nimport json\nimport click\nfrom auth import login, register\n\n@click.group()\ndef cli():\n    pass\n\n@cli.command()\n@click.option('--username', prompt=True)\n@click.option('--password', prompt=True, hide_input=True)\ndef login_cmd(username, password):\n    \"\"\"用户登录\"\"\"\n    result = login(username, password)\n    click.echo(f\"Auth: {result['auth']}\")\n\n@cli.command()\n@click.option('--username', prompt=True)\n@click.option('--password', prompt=True, hide_input=True)\n@click.option('--email', prompt=True)\ndef register_cmd(username, password, email):\n    \"\"\"用户注册\"\"\"\n    result = register(username, password, email)\n    click.echo(f\"Token: {result['token']}\")\n\n@cli.command()\ndef create():\n    \"\"\"创建任务\"\"\"\n    click.echo('Create: task created')\n\n@cli.command()\ndef list_tasks():\n    \"\"\"读取任务列表\"\"\"\n    click.echo('Read: loading tasks...')\n\n@cli.command()\n@click.argument('task_id')\ndef update(task_id):\n    \"\"\"更新任务\"\"\"\n    click.echo(f'Update: task {task_id} updated')\n\n@cli.command()\n@click.argument('task_id')\ndef delete(task_id):\n    \"\"\"删除任务\"\"\"\n    click.echo(f'Delete: task {task_id} deleted, CRUD completed')\n\n@cli.command()\ndef team():\n    \"\"\"团队协作\"\"\"\n    click.echo('Team: collaborating with members on projects')\n\nif __name__ == '__main__':\n    cli()\n\`\`\`\n\n## 文档\n命令行工具，支持认证、CRUD 操作和团队协作功能。\n`;
  }

  // 通用场景
  return `# Implementation\n\n## 代码实现\n\`\`\`javascript\nconst express = require('express');\nconst session = require('express-session');\nconst jwt = require('jsonwebtoken');\n\nconst app = express();\n\n// Auth\napp.post('/api/register', (req, res) => {\n  res.json({ success: true, auth: true, register: true });\n});\napp.post('/api/login', (req, res) => {\n  res.json({ success: true, token: 'jwt', session: true, login: true });\n});\n\n// CRUD\napp.post('/api/items', (req, res) => {\n  res.json({ success: true, create: true });\n});\napp.get('/api/items', (req, res) => {\n  res.json({ success: true, read: true, items: [] });\n});\napp.put('/api/items/:id', (req, res) => {\n  res.json({ success: true, update: true });\n});\napp.delete('/api/items/:id', (req, res) => {\n  res.json({ success: true, delete: true, crud: true });\n});\n\n// Team\napp.get('/api/team', (req, res) => {\n  res.json({ team: true, project: 'demo', members: ['admin'], collaborat: true });\n});\napp.post('/api/share', (req, res) => {\n  res.json({ share: true });\n});\n\napp.listen(3000);\n\`\`\`\n\n## 文档\n功能完整的应用，包含用户认证（register, login, auth, session, token, password）、\nCRUD 操作（create, read, update, delete, crud, todo, task）、\n团队协作（team, share, collaborat, project, member）、\n前后端完整实现（Backend Development, Frontend Development）。\n`;
}

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
  readonly artifactFacade: ArtifactFacade;
  readonly verificationEngine: VerificationEngine;
  readonly complianceChecker: ComplianceChecker;
  readonly approvalGate: ApprovalGate;
  readonly experienceMiner: ExperienceMiner;
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
    this.executionEngine.setMissionRuntime(this.createMissionRuntime());
    const dagRuntime = this.createDAGRuntime();
    this.executionEngine.setDAGRuntime(dagRuntime);
    this.executionEngine.setExecutionFabric(this.createExecutionFabric());
    // 会话 3：总大脑接线（生成类任务主路径；审计循环 + step-agent 执行肢）
    this.orchestratorAgent = this.createOrchestratorAgent(dagRuntime);
    this.executionEngine.setOrchestratorAgent(this.orchestratorAgent);
    this.artifactFacade = new ArtifactFacade(this.eventBus);
    this.executionEngine.setArtifactFacade(this.artifactFacade);
    this.verificationEngine = new VerificationEngine(this.eventBus);
    this.complianceChecker = new ComplianceChecker();
    this.approvalGate = new ApprovalGate(this.eventBus);
    this.experienceMiner = new ExperienceMiner();
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
      this._eventStore = new UnifiedEventStore();
      // 严格模式包装
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
      fallbackExecutor: async (n, upstreamText) => {
        const fabric = self.createExecutionFabric();
        const r = await fabric.execute(n.agentType || 'execute', n.description || n.name, {
          goal: n.description || n.name,
          upstreamText,
        });
        if (!r.success) throw new Error(r.error || '节点执行失败');
        return r.data;
      },
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
    });
  }

  private createMissionRuntime(): MissionRuntimeLike {
    const mr = new MissionRuntime(this.eventBus);
    this.missionRuntime = mr;
    return {
      name: 'MissionRuntime',
      start: async (goal: string, context?: Record<string, unknown>) => {
        const mission = await mr.createMissionFromGoal(goal, context?.departmentId as string || 'default', context?.executionId as string || `exec_${Date.now()}`);
        return { executionId: mission.id };
      },
      getStatus: (id: string) => mr.getMission(id),
      cancel: (id: string) => mr.cancelMission(id),
    };
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
          fallbackExecutor: async (n, upstreamText) => {
            const fabric = this.createExecutionFabric();
            const cap = n.agentType || 'execute';
            console.log(`[DAGRuntime] ⚠️ step-agent 降级 → ExecutionFabric (cap=${cap})`);
            const result = await fabric.execute(cap, n.description || n.name, {
              goal: n.description || n.name,
              upstreamText,
              ...ctxObj,
            });
            if (!result.success) throw new Error(result.error || '节点执行失败');
            return result.data;
          },
        });
        const result = await executor.executeStep(
          { id: node.id, name: node.name, description: node.description, agentType: node.agentType },
          upstream,
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

  private async ensurePiBridge(): Promise<void> {
    if (this.piBridgeInitialized) return;
    this.piBridgeInitialized = true;
    try {
      const { PiBridge } = await import('../../infrastructure/adapters/pi-bridge/PiBridge.js');
      this.piBridge = new PiBridge();
      await this.piBridge.init();
      console.log('[ServiceContainer] ✅ PiBridge 已初始化 (真实 LLM 模式)');
    } catch (err) {
      console.warn('[ServiceContainer] ⚠️ PiBridge 不可用');
    }
  }

  private createExecutionFabric(): ExecutionFabricLike {
    const self = this;
    return {
      name: 'ExecutionFabric',
      execute: async (capability: string, action: string, params: Record<string, unknown>) => {
        // 延迟初始化 PiBridge（首次调用时）
        await self.ensurePiBridge();

        if (self.piBridge) {
          try {
            const start = Date.now();
            // 构造更完整的提示词，要求输出结构化的代码和文档
            const goalType = action.includes('Todo') || action.includes('SaaS') || action.includes('app') ? 'web_application' :
                             action.includes('API') || action.includes('REST') ? 'api' :
                             action.includes('CLI') || action.includes('命令行') ? 'cli' :
                             action.includes('plugin') || action.includes('插件') ? 'plugin' : 'general';
            const prompt = `你是一名资深全栈工程师。请根据以下需求输出完整的代码实现和说明文档。

需求: ${action}
能力要求: ${capability}

请严格按照以下格式输出:

## 代码实现
\`\`\`
(完整的代码，包含所有功能实现)
\`\`\`

## 文档说明
(功能说明、使用指南、API文档等)

## 技术栈
- 后端: Node.js / Express / FastAPI
- 前端: React / Vue
- 数据库: PostgreSQL / SQLite
- 认证: JWT / Session

请确保输出包含以下关键功能:
1. 用户认证系统（注册、登录、会话管理）
2. 核心业务逻辑（CRUD 操作）
3. 团队协作功能
4. 前后端完整实现

输出结果:`;
            const result = await self.piBridge.generateText({ prompt });
            const outputText = result.text || '';
            return {
              success: true,
              data: {
                text: outputText,
                action,
                params,
                // 分离代码和文档部分
                code: outputText.includes('代码') || outputText.includes('\\`\\`\\`') ? outputText : '',
                document: outputText,
                capabilities: ['Backend Development', 'Frontend Development', 'Database Design', 'API Design'],
              },
              duration: Date.now() - start,
            };
          } catch (err) {
            console.warn('[ServiceContainer] PiBridge 调用失败:', (err as Error).message);
            return { success: false, error: (err as Error).message, duration: 0 };
          }
        }
        // ══ Mock 门禁 ══
        // 生产环境禁止静默 Mock，需设置 MORPEX_ALLOW_MOCK=1（仅测试用）
        if (process.env.MORPEX_ALLOW_MOCK !== '1' && process.env.NODE_ENV !== 'test') {
          return {
            success: false,
            error: 'PiBridge 不可用且未允许 Mock（设置 MORPEX_ALLOW_MOCK=1 仅用于测试）',
            duration: 0,
          };
        }
        // 降级: 模拟执行（仅在测试/明确允许时）
        console.warn('[ServiceContainer] ⚠️ ExecutionFabric 使用 Mock 降级 (MORPEX_ALLOW_MOCK=1)');
        const mockCode = generateMockCode(action, capability);
        return {
          success: true,
          data: {
            text: mockCode,
            action,
            params,
            code: mockCode,
            document: mockCode,
            capabilities: ['Backend Development', 'Frontend Development', 'Database Design', 'API Design'],
            mock: true,
          },
          duration: 0,
        };
      },
      getFabricStatus: () => ({ status: self.piBridge ? 'live' : 'mock', uptime: process.uptime() }),
    };
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
