/**
 * RouteSetup — REST API 路由注册
 *
 * 从 StudioServer 提取，消除 HTTP 路由与组件初始化的耦合。
 *
 * 每个路由 handler 通过依赖注入获取所需模块，不直接访问 StudioServer 内部状态。
 */

import type { Router as ExpressRouter } from 'express';
import type { SessionManager } from './SessionManager.js';
import type { SessionStore } from './SessionStore.js';
import type { StudioOrchestrator } from './StudioOrchestrator.js';
import type { MorPexKernel, MorPexEvent } from '../../core/index.js';
import type { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';
import type { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
import fs from 'fs';
import path from 'path';

export interface RouteDependencies {
  kernel: MorPexKernel;
  sessionManager: SessionManager;
  sessionStore: SessionStore;
  orchestrator: StudioOrchestrator;
  domainDispatcher?: DomainDispatcher;
  domainManager?: DomainClusterManager;
  mirrorBasePath?: string;
}

export function setupRoutes(app: ExpressRouter, deps: RouteDependencies): void {
  const { kernel, sessionManager, sessionStore, orchestrator, domainDispatcher, domainManager, mirrorBasePath } = deps;

  // ── 新建 Session ──
  app.post('/api/session/create', async (req, res) => {
    const { mode } = req.body || {};
    if (!mode || !['chat', 'luban', 'simq', 'task'].includes(mode)) {
      return res.status(400).json({ ok: false, error: '缺少或无效 mode (chat/luban/simq/task)' });
    }
    try {
      const sessionId = await sessionManager.create(mode);
      return res.json({ ok: true, sessionId, mode });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── 列出活跃 Session ──
  app.get('/api/sessions', (_req, res) => {
    const sessions = sessionManager.getAll();
    return res.json({ ok: true, count: sessions.length, sessions });
  });

  // ── 向 Session 发送消息 ──
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

  // ── 旧版聊天入口 ──
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
      const message = err instanceof Error ? err.message : String(err);
      console.error('[StudioServer] /api/chat/message 错误:', message);
      return res.json({ ok: false, error: message });
    }
  });

  // ── 会话历史 ──
  app.get('/api/session/:sessionId/history', (req, res) => {
    const { sessionId } = req.params;
    const messages = sessionStore.getChatHistory(sessionId);
    res.json({ ok: true, sessionId, count: messages.length, messages });
  });

  app.post('/api/session/:sessionId/message', (req, res) => {
    const { sessionId } = req.params;
    const body = req.body || {};
    if (!body.role || !body.content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
    sessionStore.appendChatMessage(sessionId, body);
    res.json({ ok: true });
  });

  // ── 节点执行消息 ──
  app.get('/api/task/:execId/:taskId/history', (req, res) => {
    const { execId, taskId } = req.params;
    const messages = sessionStore.getTaskMessages(execId, taskId);
    res.json({ ok: true, execId, taskId, count: messages.length, messages });
  });

  app.post('/api/task/:execId/:taskId/message', (req, res) => {
    const { execId, taskId } = req.params;
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ ok: false, error: '缺少 role 或 content' });
    sessionStore.appendTaskMessage(execId, taskId, { role, content });
    res.json({ ok: true });
  });

  // ── Agent 对话回复 ──
  app.post('/api/harness/:harnessId/steer', (req, res) => {
    const { harnessId } = req.params;
    const { reply } = req.body || {};
    if (!reply) return res.status(400).json({ ok: false, error: '缺少 reply' });
    const steered = orchestrator.resolveSteer(harnessId, reply);
    res.json({ ok: steered, steered });
  });

  // ── 任务恢复 ──
  app.post('/api/task/resume', async (req, res) => {
    const { executionId, taskId, input, domain } = req.body || {};
    if (!executionId || !taskId || !domain) {
      return res.status(400).json({ ok: false, error: '缺少 executionId/taskId/domain' });
    }
    try {
      if (!domainDispatcher) {
        return res.json({ ok: false, error: 'DomainDispatcher 未就绪' });
      }
      const historyMsgs = sessionStore.getTaskMessages(executionId, taskId);
      const contextStr = (historyMsgs.slice(-20) as Array<Record<string, unknown>>)
        .map((m: Record<string, unknown>) => `[${String(m.role)}]: ${String(m.content)}`)
        .join('\n');
      const goal = `以下是你之前执行的任务上下文，请基于上下文继续完成未完成的工作，不要重新开始：\n---\n${contextStr}\n---\n用户最新输入：${input || '继续执行'}`;
      const node: import('../../core/src/domains/types.js').DAGNode = { taskId, domain, goal, deps: [], status: 'pending' as const };
      const sessionCtx: import('../../core/src/common/types.js').SessionContext = {
        sessionId: `resume_${executionId}_${Date.now()}`,
        executionId, input: goal, artifacts: {}, memory: [],
      };

      if (orchestrator) orchestrator.dagExecId = executionId;
      res.json({ ok: true, resumed: true, taskId, executionId });

      setImmediate(async () => {
        try {
          const cluster = domainManager?.getCluster(domain);
          if (cluster) {
            try {
              const m = (cluster as unknown as Record<string, unknown>)._master;
              if (m) { await (m as { abort: () => Promise<void> }).abort().catch(() => {}); (cluster as unknown as Record<string, unknown>)._master = null; }
              const prevStatus = (cluster as unknown as Record<string, unknown>)._status;
              (cluster as unknown as Record<string, unknown>)._status = 'sleeping';
              await cluster.wake();
              (cluster as unknown as Record<string, unknown>)._status = prevStatus;
            } catch (e) { console.warn(`[Resume] 清理 harness 异常: ${e instanceof Error ? e.message : String(e)}`); }
          }
          const result = await domainDispatcher!.executeNode(node, sessionCtx);
          console.log(`[Resume] ✅ ${taskId} 恢复完成 (${result.status}), output=${typeof result.output === 'string' ? (result.output as string).substring(0, 50) : 'none'}`);
          const st = result.status === 'failed' ? 'failed' : 'completed';
          kernel.eventBus.emit({
            id: kernel.executionIdentity.createEventId(),
            type: 'runtime.task.completed',
            timestamp: Date.now(),
            executionId,
            source: 'resume',
            payload: { taskId, status: st, output: result.output, domain, error: (result as unknown as Record<string, unknown>).error, executionId },
          });
          console.log(`[SSE→] runtime.task.completed taskId=${taskId} status=${st}`);
        } catch (err) {
          console.error(`[Resume] ❌ ${taskId} 恢复失败:`, err instanceof Error ? err.message : String(err));
        }
      });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── 执行状态轮询 ──
  app.get('/api/execution/:executionId', (req, res) => {
    const { executionId } = req.params;
    const record = orchestrator?.getExecution(executionId);
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
  app.get('/api/agents/suggestions', (_req, res) => {
    res.json({ ok: true, agents: orchestrator?.getAgentList() ?? [] });
  });

  // ── 交付物 ──
  app.get('/api/artifacts', (_req, res) => {
    const base = mirrorBasePath || './data';
    const workspaceProjects = path.join(base, 'workspace', 'projects');
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
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // ── 历史聚合 ──
  app.get('/api/history/:executionId', (req, res) => {
    res.json({ ok: true, message: 'History aggregate endpoint' });
  });
}
