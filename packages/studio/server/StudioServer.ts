/**
 * Studio Server — 理想架构对齐版（vNext·Ideal）
 *
 * ═══ 只消费理想 10 层组件 ═══
 *   L1 入口与治理: CompanyFacade / ControlPlane / GovernanceDashboard
 *   L2 Ontology Gate: OntologyService / ForcedQueryGuard
 *   L3 规划: DeliveryPlanner（经 companyFacade.executeGoal）
 *   L4 认知: BrainFacade（经 container.brainFacade）
 *   L5 执行: UnifiedExecutionEngine
 *   L7 知识记忆: MemoryAPI / ArtifactFacade
 *   L10 基础设施: EventBus(SSE) / Observability
 *
 * 已移除（前端 UI 废弃 + 多代遗留）：
 *   - v8 MessageGateway / MissionRuntime / PersonalBrain / Twin
 *   - v9 Agent 组织平面 / AgentHarness / CrossAgent 编排
 *   - v10 LearningPlane / EventMesh
 *   - v12 departments / management / groupchat
 *   - 前端静态托管（packages/studio/ui 已废弃）
 */

import express from 'express';
import cors from 'cors';
import type { Server as HttpServer } from 'node:http';
import { bootstrapUnified } from '../../core/src/bootstrap-unified.js';
import type { UnifiedBootstrapResult } from '../../core/src/bootstrap-unified.js';
import { SessionStore } from './SessionStore.js';
import { createObservabilityRouter } from './observability/index.js';
import { startObservabilityBridge, wireObservabilityServices } from './observability/runtime-bridge.js';
import { registerRuntimeRoutes } from './RuntimeAPI.js';

export interface StudioServerConfig {
  port?: number;
  sessionsRoot?: string;
  mirrorBasePath?: string;
  ceoId?: string;
}

interface SessionMeta {
  id: string;
  name?: string;
  createdAt: number;
}

export class StudioServer {
  private app: express.Express;
  private config: StudioServerConfig;
  private httpServer?: HttpServer;
  private sessionStore?: SessionStore;
  private sessions = new Map<string, SessionMeta>();
  private boot?: UnifiedBootstrapResult;
  private sseClients = new Map<string, { res: express.Response; connectedAt: number }>();
  private sseIdCounter = 0;

  constructor(config: StudioServerConfig = {}) {
    this.config = config;
    this.app = express();
  }

  // ── 启动 ──

  async start(): Promise<void> {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));

    // ★ 理想装配：L1-L10 全部经 bootstrapUnified 注入
    this.boot = await bootstrapUnified({ ceoId: this.config.ceoId ?? 'ceo-default' });
    const { container } = this.boot;

    // 会话持久化
    this.sessionStore = new SessionStore(this.config.sessionsRoot);
    console.log('[Studio] ✅ SessionStore 就绪');

    // L10 观测面
    this.app.use('/api/observability', createObservabilityRouter());

    // ═══ 架构可观测（S34）：接线 /audit、/replay 服务 + 核心 EventBus → 观测面桥接 ═══
    // 修复此前 archAuditor/replayEngine 从未初始化（/audit 503）+ ObservationCollector 无真实数据
    wireObservabilityServices();
    startObservabilityBridge(container.eventBus);

    // 运行时 API（RuntimeAPI：FSM/DAG/ArtifactGraph/Learning/SSE）
    // ⚠️ S24 修复：此前 registerRuntimeRoutes 从未被挂载 → 11 个路由全部不可达（死代码面）
    registerRuntimeRoutes(this.app);

    // 路由注册
    this.registerIdealRoutes();

    // SSE（L10 EventBus → 前端事件流）
    this.registerSSE(container.eventBus);

    const port = this.config.port ?? 8080;
    this.httpServer = this.app.listen(port, () => {
      console.log(`[Studio] 🚀 理想架构 Studio Server 运行在 http://localhost:${port}`);
    });
  }

  /**
   * getPort — 返回实际监听端口（配置为 0 时由 OS 分配，测试用）
   */
  getPort(): number {
    const addr = this.httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.config.port ?? 8080;
  }

  // ── 理想层路由 ──

  private registerIdealRoutes(): void {
    const { container, companyFacade, ontology, forcedQueryGuard } = this.boot!;

    // ── 系统状态（L1/L10）──
    this.app.get('/api/health', (_req, res) => {
      res.json({
        ok: true,
        uptime: process.uptime(),
        bootedAt: this.boot ? 'ready' : 'booting',
        runtime: container.runtime.constructor.name,
      });
    });

    this.app.get('/api/status', (_req, res) => {
      const gov = (container as any).governanceDashboard;
      res.json({
        phase: 'ideal-aligned',
        departments: companyFacade.listDepartments().length,
        artifacts: container.artifactFacade.getAll().length,
        controlPlane: {
          goal: !!container.controlPlane,
          policies: (container as any).governanceDashboard ? 1 : 0,
        },
        governance: gov ? gov.getSystemHealth() : null,
      });
    });

    this.app.get('/api/config', (_req, res) => {
      res.json({ version: 'vNext-ideal', engine: 'bootstrapUnified', port: this.config.port ?? 8080 });
    });

    // ── 治理（L1）──
    this.app.get('/api/governance', (_req, res) => {
      const gov = (container as any).governanceDashboard;
      res.json({
        ok: true,
        health: gov?.getSystemHealth?.() ?? null,
        cost: gov?.getCostReport?.() ?? null,
        delivery: gov?.getDeliveryMetrics?.() ?? null,
      });
    });

    // ── 本体（L2）──
    this.app.get('/api/ontology/stats', (_req, res) => {
      res.json({ ok: true, guard: !!forcedQueryGuard, service: !!ontology });
    });

    // ── 会话 ──
    this.app.get('/api/sessions', (_req, res) => {
      res.json({ sessions: [...this.sessions.values()] });
    });

    this.app.post('/api/session/create', (req, res) => {
      const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const meta: SessionMeta = { id, name: req.body?.name, createdAt: Date.now() };
      this.sessions.set(id, meta);
      res.json({ ok: true, sessionId: id });
    });

    this.app.get('/api/session/:id/history', (req, res) => {
      res.json({ ok: true, messages: this.sessionStore?.getChatHistory(req.params.id) ?? [] });
    });

    // ── 对话：CompanyFacade.executeGoal（L1 → L3 规划 → L5 执行 → L7 记忆）──
    this.app.post('/api/chat/send', async (req, res) => {
      const goal = req.body?.message ?? req.body?.goal;
      if (!goal) return res.status(400).json({ ok: false, error: 'message required' });
      try {
        const result = await companyFacade.executeGoal(String(goal), {
          departmentId: req.body?.departmentId,
          departmentName: req.body?.departmentName,
        });
        if (req.body?.sessionId) {
          this.sessionStore?.appendChatMessage(req.body.sessionId, {
            role: 'user', content: String(goal), timestamp: Date.now(),
          });
          this.sessionStore?.appendChatMessage(req.body.sessionId, {
            role: 'system', content: result.report ?? JSON.stringify(result), timestamp: Date.now(),
          });
        }
        return res.json(result);
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 执行（L5 UnifiedExecutionEngine）──
    this.app.post('/api/execute', async (req, res) => {
      const goal = req.body?.goal;
      if (!goal) return res.status(400).json({ ok: false, error: 'goal required' });
      try {
        const r = await container.executionEngine.execute({
          goal: String(goal),
          mode: req.body?.mode ?? 'auto',
          departmentId: req.body?.departmentId,
          context: req.body?.context,
        });
        return res.json(r);
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.get('/api/execution/:executionId', (req, res) => {
      const mission = container.missionController.getMission(req.params.executionId);
      res.json({ executionId: req.params.executionId, mission: mission ?? null });
    });

    // ── 产物（L7 ArtifactFacade）──
    this.app.get('/api/artifacts', (_req, res) => {
      res.json({ artifacts: container.artifactFacade.getAll() });
    });
    this.app.get('/api/artifacts/:id', (req, res) => {
      const a = container.artifactFacade.get(req.params.id);
      res.json({ artifact: a ?? null });
    });

    // ── 记忆（L7 MemoryAPI）──
    this.app.get('/api/memory/recall', async (req, res) => {
      const mem = (container as any).companyMemoryApi;
      if (!mem) return res.json({ ok: false, error: 'memory not initialized' });
      try {
        const r = await mem.query({ text: String(req.query.q ?? ''), limit: 10 });
        return res.json({ ok: true, hits: r.hits });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    this.app.post('/api/memory/remember', async (req, res) => {
      const mem = (container as any).companyMemoryApi;
      if (!mem) return res.status(400).json({ ok: false, error: 'memory not initialized' });
      try {
        await mem.rememberEpisode(String(req.body?.content), { source: req.body?.source ?? 'api' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
  }

  // ── SSE（L10 EventBus 事件流）──

  private registerSSE(eventBus: import('../../core/src/infrastructure/common/EventBus.js').EventBus): void {
    this.app.get('/api/stream/global', (req, res) => {
      const clientId = `sse_${++this.sseIdCounter}`;
      const filter = req.query.filter as string | undefined;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: Date.now() })}\n\n`);
      const client = { res, connectedAt: Date.now() };
      this.sseClients.set(clientId, client);

      const unsub = eventBus.onProjected((event: any) => {
        if (filter && !event.type.startsWith(filter.replace('*', ''))) return;
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { this.sseClients.delete(clientId); }
      });

      const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat ${Date.now()}\n\n`); }
        catch { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); }
      }, 15000);

      const cleanup = () => { clearInterval(heartbeat); unsub(); this.sseClients.delete(clientId); };
      req.on('close', cleanup);
      res.on('close', cleanup);
    });
  }

  // ── 停止 ──

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }
    const boot = this.boot;
    if (boot) {
      (boot.container as any).companyMemoryApi?.close?.();
    }
    console.log('[Studio] ✅ stopped');
  }
}
