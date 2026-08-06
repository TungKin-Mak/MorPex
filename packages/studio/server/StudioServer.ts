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
import { CostController } from '../../core/src/governance/CostController.js';
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

  /** 会话 16c（3+4）：execution-stats 总成功率（跨模式加权） */
  private calcOverallRate(quality: Record<string, { success: number; total: number; avgDuration: number; successRate: number }>): number {
    let total = 0;
    let success = 0;
    for (const q of Object.values(quality)) {
      total += q.total;
      success += q.success;
    }
    return total > 0 ? Number((success / total).toFixed(4)) : 0;
  }

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
      const gov = container.governanceDashboard;
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
      const gov = container.governanceDashboard;
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

    // ── 编排组件会话（Session 化治理：多 Agent 总大脑/step-agent/执行肢持久化会话）──
    this.app.get('/api/agent-sessions', async (req, res) => {
      try {
        const component = (req.query?.component as string | undefined) as 'orchestrator' | 'step-agent' | 'executor' | undefined;
        const valid = component === undefined || component === 'orchestrator' || component === 'step-agent' || component === 'executor';
        if (!valid) {
          return res.status(400).json({ ok: false, error: 'component 必须是 orchestrator|step-agent|executor' });
        }
        const sessions = await container.agentSessionStore.list(component);
        res.json({ ok: true, sessions });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    this.app.get('/api/agent-sessions/entries', async (req, res) => {
      const path = req.query?.path;
      if (!path || typeof path !== 'string') {
        return res.status(400).json({ ok: false, error: 'path query 参数必填（会话 jsonl 绝对路径）' });
      }
      try {
        const entries = await container.agentSessionStore.readEntries(path);
        res.json({ ok: true, path, entries });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
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
          departmentId: req.body?.departmentId,
          context: req.body?.context,
          // ═══ 会话 16d（P3 人机协同）：人工介入/重跑参考提示 ═══
          contextHint: typeof req.body?.contextHint === 'string' ? req.body.contextHint : undefined,
          maxTaskRerun: typeof req.body?.maxTaskRerun === 'number' ? req.body.maxTaskRerun : undefined,
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

    // ── 会话 16c（3+4）：实时观测聚合端点（实时仪表盘 API 层）──
    // 聚合：执行质量（成功率/耗时）+ 步骤质量（空参率/重试/错误分类）+ 装配成本（耗时/字符/密度）
    //        + 成本（token/金额）——按批次/步骤类型统计，供 P3 仪表盘消费。
    this.app.get('/api/execution-stats', (_req, res) => {
      try {
        const history = container.eventBus?.getHistory?.() ?? [];

        // 1. 执行质量（引擎 executionQuality：auto/orchestrator 分模式）
        const quality = container.executionEngine.getExecutionQuality();

        // 2. 步骤质量（execution.step.result 事件：空参率/重试/错误分类）
        const stepEvents = history.filter((e: { type: string }) => e.type === 'execution.step.result');
        let emptyParamFails = 0, safetyFails = 0, stepFails = 0, totalRetries = 0;
        for (const e of stepEvents as Array<{ payload?: { success?: boolean; errorClass?: string; retries?: number } }>) {
          const p = e.payload ?? {};
          totalRetries += p.retries ?? 0;
          if (p.success === false) {
            stepFails++;
            if (p.errorClass === 'retryable') emptyParamFails++;
            if (p.errorClass === 'non-retryable') safetyFails++;
          }
        }
        const totalSteps = stepEvents.length;

        // 3. 装配成本（context.assembly.telemetry 事件：耗时/字符/信息密度）
        const asmEvents = history.filter((e: { type: string }) => e.type === 'context.assembly.telemetry');
        const asmDurations = (asmEvents as Array<{ payload?: { durationMs?: number; infoDensity?: number; fragmentCount?: number } }>)
          .map(e => ({ durationMs: e.payload?.durationMs ?? 0, infoDensity: e.payload?.infoDensity ?? 0, fragmentCount: e.payload?.fragmentCount ?? 0 }));
        const avgAsmDuration = asmDurations.length > 0 ? asmDurations.reduce((a, b) => a + b.durationMs, 0) / asmDurations.length : 0;
        const avgInfoDensity = asmDurations.length > 0 ? asmDurations.reduce((a, b) => a + b.infoDensity, 0) / asmDurations.length : 0;

        // 4. 成本（CostController 全链路 token/金额）
        const cost = CostController.getInstance();
        const tokenUsage = cost.getTokenUsage('global');

        res.json({
          ok: true,
          stats: {
            execution: {
              byMode: quality,
              totalSuccessRate: this.calcOverallRate(quality),
            },
            steps: {
              totalSteps,
              failed: stepFails,
              emptyParamFails,
              safetyFails,
              emptyParamRate: totalSteps > 0 ? Number((emptyParamFails / totalSteps).toFixed(4)) : 0,
              totalRetries,
            },
            assembly: {
              count: asmDurations.length,
              avgDurationMs: Math.round(avgAsmDuration),
              avgInfoDensity,
            },
            cost: {
              totalTokens: tokenUsage.tokens,
              totalCost: Number(cost.getTotalCost('global').toFixed(4)),
            },
            generatedAt: Date.now(),
          },
        });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16d（P3 运维）：异常告警查询 ──
    this.app.get('/api/anomalies', (_req, res) => {
      try {
        const limit = Number(_req.query?.limit) || 50;
        res.json({ ok: true, anomalies: container.anomalyDetector.getAnomalies(limit) });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });

    // ── 会话 16d（P3 运维）：成本与延迟归因（每任务 token/耗时/步骤/成功）──
    this.app.get('/api/execution-stats/tasks', (_req, res) => {
      try {
        const limit = Number(_req.query?.limit) || 20;
        const history = container.eventBus?.getHistory?.() ?? [];
        const started = history.filter((e: { type: string }) => e.type === 'execution.engine.started');
        const completed = history.filter((e: { type: string }) => e.type === 'execution.engine.completed' || e.type === 'execution.engine.failed');
        const tokenEvts = history.filter((e: { type: string }) => e.type === 'execution.gate.token_usage');

        // token 按 executionId 聚合
        const tokensByExec = new Map<string, number>();
        for (const e of tokenEvts as Array<{ executionId?: string; payload?: { tokens?: number } }>) {
          const id = e.executionId ?? 'orch'; // orchestrator token 事件 executionId 前缀为 orch_
          tokensByExec.set(id, (tokensByExec.get(id) ?? 0) + (e.payload?.tokens ?? 0));
        }

        const tasks = completed
          .map((e: { executionId?: string; payload?: { goal?: string; ok?: boolean; duration?: number; mode?: string } }) => ({
            executionId: e.executionId,
            goal: (e.payload?.goal ?? '').slice(0, 60),
            ok: e.payload?.ok ?? false,
            durationMs: e.payload?.duration ?? 0,
            mode: e.payload?.mode ?? 'auto',
            tokens: tokensByExec.get(e.executionId ?? '') ?? 0,
          }))
          .slice(-limit);

        res.json({ ok: true, tasks, total: completed.length });
      } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
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
      const mem = container.companyMemoryApi;
      if (!mem) return res.json({ ok: false, error: 'memory not initialized' });
      try {
        const r = await mem.query({ text: String(req.query.q ?? ''), limit: 10 });
        return res.json({ ok: true, hits: r.hits });
      } catch (err) {
        return res.status(500).json({ ok: false, error: (err as Error).message });
      }
    });
    this.app.post('/api/memory/remember', async (req, res) => {
      const mem = container.companyMemoryApi;
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
      boot.container.companyMemoryApi?.close?.();
    }
    console.log('[Studio] ✅ stopped');
  }
}
