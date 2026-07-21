/**
 * RouteHandler — StudioServer 的 Express 路由定义
 *
 * 从 StudioServer.setupRoutes() 提取，消除 ~200 行的 God Object 膨胀。
 */

import express, { type Express, type Response } from 'express';
import path from 'path';
import * as fs from 'fs';

import type { MorPexKernel, MorPexEvent } from '../../core/index.js';
import type { SessionManager } from './SessionManager.js';
import type { SessionStore } from './SessionStore.js';
import type { StudioOrchestrator } from './StudioOrchestrator.js';
import type { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
import type { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';

/** 依赖集合 */
export interface RouteDeps {
  kernel: MorPexKernel;
  sessionManager: SessionManager;
  sessionStore: SessionStore;
  orchestrator: StudioOrchestrator;
  domainManager?: DomainClusterManager;
  domainDispatcher?: DomainDispatcher;
  mirrorBasePath: string;
  frontendDist: string;
  onSseDisconnect: () => void;
}

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: number;
  filter?: string;
}

let sseClients: Map<string, SSEClient> = new Map();
let sseIdCounter = 0;

export function setupRoutes(app: Express, deps: RouteDeps): void {
  const { kernel, sessionManager, sessionStore, orchestrator, domainManager, domainDispatcher, mirrorBasePath, frontendDist, onSseDisconnect } = deps;

  app.post('/api/session/create', async (req, res) => {
    const { mode } = req.body || {};
    if (!mode || !['chat', 'luban', 'simq', 'task'].includes(mode)) {
      return res.status(400).json({ ok: false, error: '缺少或无效 mode' });
    }
    try {
      const sessionId = await sessionManager.create(mode);
      return res.json({ ok: true, sessionId, mode });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/sessions', (_req, res) => {
    res.json({ ok: true, count: sessionManager.getAll().length, sessions: sessionManager.getAll() });
  });

  app.post('/api/session/:sessionId/send', async (req, res) => {
    const { sessionId } = req.params;
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
    try {
      const result = await sessionManager.send(sessionId, content);
      return res.json({
        ok: result.type !== 'error',
        type: result.type,
        output: result.type === 'direct_chat' ? result.output : undefined,
        dag: result.type === 'dag_plan' ? result.dag : undefined,
        executionId: result.type === 'dag_plan' ? result.executionId : undefined,
        sessionId,
        error: result.type === 'error' ? result.error : undefined,
      });
    } catch (err) {
      return res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/chat/message', async (req, res) => {
    const { content, agent } = req.body || {};
    let { session_id } = req.body || {};
    if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
    if (!session_id) session_id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const execId = kernel.executionIdentity.createExecutionId();
    try {
      const result = await orchestrator.routeMessage(content, execId, session_id, agent);
      return res.json({ ...result, sessionId: session_id });
    } catch (err) {
      console.error('[API] /api/chat/message 错误:', err instanceof Error ? err.message : String(err));
      return res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/session/:sessionId/history', (req, res) => {
    const { sessionId } = req.params;
    res.json({ ok: true, sessionId, messages: sessionStore.getChatHistory(sessionId) });
  });

  app.post('/api/session/:sessionId/message', (req, res) => {
    const { sessionId } = req.params;
    const body = req.body || {};
    if (!body.role || !body.content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
    sessionStore.appendChatMessage(sessionId, body);
    res.json({ ok: true });
  });

  app.get('/api/task/:execId/:taskId/history', (req, res) => {
    const { execId, taskId } = req.params;
    res.json({ ok: true, execId, taskId, messages: sessionStore.getTaskMessages(execId, taskId) });
  });

  app.post('/api/task/:execId/:taskId/message', (req, res) => {
    const { execId, taskId } = req.params;
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
    sessionStore.appendTaskMessage(execId, taskId, { role, content });
    res.json({ ok: true });
  });

  app.post('/api/harness/:harnessId/steer', (req, res) => {
    const { harnessId } = req.params;
    const { reply } = req.body || {};
    if (!reply) return res.status(400).json({ ok: false, error: '缺少 reply' });
    res.json({ ok: orchestrator.resolveSteer(harnessId, reply), steered: true });
  });

  app.post('/api/task/resume', async (req, res) => {
    const { executionId, taskId, input, domain } = req.body || {};
    if (!executionId || !taskId || !domain) {
      return res.status(400).json({ ok: false, error: '缺少 executionId/taskId/domain' });
    }
    if (!domainDispatcher) {
      return res.json({ ok: false, error: 'DomainDispatcher 未就绪' });
    }
    const historyMsgs = sessionStore.getTaskMessages(executionId, taskId);
    const contextStr = (historyMsgs.slice(-20) as Array<Record<string, unknown>>)
      .map((m: Record<string, unknown>) => `[${String(m.role)}]: ${String(m.content)}`)
      .join('\n');
    const goal = `以下是你之前执行的任务上下文，请基于上下文继续完成未完成的工作，不要重新开始：\n---\n${contextStr}\n---\n用户最新输入：${input || '继续执行'}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: Record<string, unknown> = { taskId, domain, goal, deps: [], status: 'pending' };
    const sessionCtx = { sessionId: `resume_${executionId}_${Date.now()}`, executionId, input: goal, artifacts: {}, memory: [] };
    if (orchestrator) orchestrator.dagExecId = executionId;
    res.json({ ok: true, resumed: true, taskId, executionId });
    setImmediate(async () => {
      try {
        const cluster = domainManager?.getCluster(domain);
        if (cluster) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const c = cluster as any;
            if (c._master) { await c._master.abort().catch(() => {}); c._master = null; }
            const prevStatus = c._status;
            c._status = 'sleeping';
            await cluster.wake();
            c._status = prevStatus;
          } catch (e) { console.warn(`[Resume] 清理 harness 异常: ${e instanceof Error ? e.message : String(e)}`); }
        }
        const result = await domainDispatcher.executeNode(node as unknown as import('../../core/src/domains/types.js').DAGNode, sessionCtx);
        console.log(`[Resume] ✅ ${taskId} 恢复完成 (${result.status})`);
        kernel.eventBus.emit({
          id: kernel.executionIdentity.createEventId(),
          type: 'runtime.task.completed', timestamp: Date.now(), executionId, source: 'resume',
          payload: { taskId, status: result.status, output: result.output, domain, executionId },
        });
      } catch (err) {
        console.error(`[Resume] ❌ ${taskId} 恢复失败:`, err instanceof Error ? err.message : String(err));
      }
    });
  });

  app.get('/api/execution/:executionId', (req, res) => {
    const record = orchestrator?.getExecution(req.params.executionId);
    if (!record) return res.status(404).json({ ok: false, error: '执行记录不存在' });
    res.json({ ok: true, ...record, nodes: [...record.nodes.values()] });
  });

  app.get('/api/agents/suggestions', (_req, res) => {
    res.json({ ok: true, agents: orchestrator?.getAgentList() ?? [] });
  });

  app.get('/api/artifacts', (_req, res) => {
    const wp = path.join(mirrorBasePath, 'workspace', 'projects');
    try {
      if (fs.existsSync(wp)) {
        const projects = fs.readdirSync(wp).filter(f => f.startsWith('gen-') || f.startsWith('exe_') || f.startsWith('art_') || f === 'manual');
        return res.json({ ok: true, projects: projects.slice(-20).map(p => ({
          id: p,
          files: fs.existsSync(path.join(wp, p)) ? fs.readdirSync(path.join(wp, p)).map(f => {
            const stat = fs.statSync(path.join(wp, p, f));
            return { name: f, path: path.join(wp, p, f), size: stat.size, modifiedAt: stat.mtimeMs };
          }) : [],
        })) });
      }
    } catch { /* ignore */ }
    res.json({ ok: true, projects: [] });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: Date.now(), kernel: 'running' });
  });

  app.get('/api/history/:executionId', (_req, res) => {
    res.json({ ok: true, message: 'History aggregate endpoint' });
  });

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => { res.sendFile(path.resolve(frontendDist, 'index.html')); });
  }
}

export function setupSSE(app: Express, kernel: MorPexKernel, onSseDisconnect: () => void): void {
  app.get('/api/stream/global', (req, res) => {
    const clientId = `sse_${++sseIdCounter}`;
    const filter = req.query.filter as string | undefined;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId, timestamp: Date.now() })}\n\n`);
    sseClients.set(clientId, { id: clientId, res, connectedAt: Date.now(), filter });
    const unsub = kernel.eventBus.onProjected((event: MorPexEvent) => {
      if (filter && !event.type.startsWith(filter.replace('*', ''))) return;
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { sseClients.delete(clientId); }
    });
    const heartbeat = setInterval(() => {
      try { res.write(`:heartbeat ${Date.now()}\n\n`); } catch { clearInterval(heartbeat); unsub(); sseClients.delete(clientId); }
    }, 15000);
    req.on('close', () => { clearInterval(heartbeat); unsub(); sseClients.delete(clientId); onSseDisconnect(); });
    res.on('close', () => { clearInterval(heartbeat); sseClients.delete(clientId); onSseDisconnect(); });
  });
}
