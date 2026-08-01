/**
 * SessionManager — pi Session 生命周期管理器
 *
 * ★ v3.2 多 Session 架构改造
 *
 * 职责：
 *   1. 统一管理所有 pi Session 的创建、路由、回收
 *   2. 按 mode 区分路由逻辑（chat/luban/simq 不需要 harness，task 需要）
 *   3. Task session 的 harness 懒创建（ensureHarness）
 *   4. 清理策略：引用计数 + 定时 GC
 *
 * 与 SessionStore 的分工：
 *   - SessionManager:  pi Session 生命周期 + 内存路由逻辑
 *   - SessionStore:    文件 I/O 持久化（聊天历史 JSONL、节点执行历史）
 *
 * Harness 依赖分层：
 *   sess_chat / sess_luban / sess_simq 的 harness 永远为 null。
 *   只有 sess_task 才需要 ensureHarness。
 */

import { PiBridge, type AgentTool, type AgentSession } from '../../core/src/adapters/pi-bridge/index.js';
import { getModel, Type } from '@earendil-works/pi-ai/compat';

// PiBridge static exports for backward compat
import type { AgentHarness as _AgentHarnessType } from '../../core/src/adapters/pi-bridge/index.js';
import type { Session } from '../../core/src/adapters/pi-types.js';
const AgentHarness = PiBridge.AgentHarnessClass;
const InMemorySessionRepo = PiBridge.SessionRepoClass;
const NodeExecutionEnv = PiBridge.NodeEnvClass;
type AgentHarnessType = _AgentHarnessType;
type InMemorySessionRepoType = InstanceType<typeof InMemorySessionRepo>;

import { LLMProvider } from '../../core/src/services/LLMProvider.js';
import type { CrossDomainRouter } from '../../core/src/router/CrossDomainRouter.js';
import type { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';
import type { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
// Memory now goes through MemoryBridge (MemoryWiki)
import { MemoryBridge } from '../../core/src/adapters/memory/index.js';
import type { SessionStore } from './SessionStore.js';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type SessionMode = 'chat' | 'luban' | 'simq' | 'task';

export type SessionStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'closed';

export interface SessionHandle {
  id: string;
  mode: SessionMode;
  /** pi Agent Session 实例 */
  piSession: Session;
  /** AgentHarness（仅 task mode 非 null） */
  harness: AgentHarnessType | null;
  /** system prompt（创建时设定） */
  systemPrompt: string;
  /** 当前状态 */
  status: SessionStatus;
  /** task mode 字段 */
  taskId?: string;
  executionId?: string;
  domainId?: string;
  /** 引用计数（ZoneB tab 打开时 +1） */
  refCount: number;
  createdAt: number;
  completedAt?: number;
}

/** send() 的统一返回值类型 */
export type SendResult =
  | { type: 'direct_chat'; output: string }
  | { type: 'dag_plan'; dag: unknown; executionId: string }
  | { type: 'error'; error: string };

// ═══════════════════════════════════════════════════════════════
// SessionManager
// ═══════════════════════════════════════════════════════════════

export class SessionManager {
  /** 所有活跃 SessionHandle */
  private sessions: Map<string, SessionHandle> = new Map();

  /** pi 内核的 InMemorySessionRepo */
  private repo: InMemorySessionRepoType;

  /** 外部依赖（通过构造函数注入） */
  private crossDomainRouter?: CrossDomainRouter;
  private domainDispatcher?: DomainDispatcher;
  private domainManager?: DomainClusterManager;
  // Memory now goes through MemoryBridge (MemoryWiki)
  private sessionStore?: SessionStore;

  /** 定时 GC 句柄 */
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  /** 领域集群的 tool builder 回调（由 StudioServer 注入） */
  onBuildDomainTools: ((domainId: string) => Promise<AgentTool[]>) | null = null;

  /** 领域集群的 systemPrompt 回调（由 StudioServer 注入） */
  onGetDomainSystemPrompt: ((domainId: string) => string) | null = null;

  /** DAG 节点状态回调（通知前端更新） */
  onDagCreated: ((executionId: string, dag: unknown) => void) | null = null;
  onTaskStarted: ((taskId: string, executionId: string, goal: string, domain: string) => void) | null = null;
  onTaskCompleted: ((taskId: string, executionId: string, status: string, output?: unknown, error?: string) => void) | null = null;
  onNodeAwaitingInput: ((taskId: string, executionId: string, question: string, options: string[], harnessId: string) => void) | null = null;

  constructor(deps?: {
    crossDomainRouter?: CrossDomainRouter;
    domainDispatcher?: DomainDispatcher;
    domainManager?: DomainClusterManager;
    sessionStore?: SessionStore;
  }) {
    this.repo = new InMemorySessionRepo();
    this.crossDomainRouter = deps?.crossDomainRouter;
    this.domainDispatcher = deps?.domainDispatcher;
    this.domainManager = deps?.domainManager;
    this.sessionStore = deps?.sessionStore;
    this.startGC();
  }

  /** 启动定时 GC（每 5 分钟清理已完成的 session） */
  private startGC(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = setInterval(() => this.gc(), 5 * 60 * 1000);
    this.gcTimer.unref();
  }

  /** 停止 GC */
  stop(): void {
    if (this.gcTimer) { clearInterval(this.gcTimer); this.gcTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════
  // 创建 & 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * create — 创建新的 pi Session
   *
   * 通过 InMemorySessionRepo.create() 创建 pi Session，
   * 构造 SessionHandle，存入内部 Map。
   *
   * @param mode - Session 模式
   * @param opts - 可选参数（taskId, executionId, domainId, systemPrompt）
   * @returns sessionId
   */
  async create(mode: SessionMode, opts?: {
    taskId?: string;
    executionId?: string;
    domainId?: string;
    systemPrompt?: string;
  }): Promise<string> {
    const id = opts?.taskId
      ? `sess_${mode}_${opts.taskId}_${Date.now()}`
      : `sess_${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const piSession = await this.repo.create({
      id,
      ...(opts?.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
    });

    const handle: SessionHandle = {
      id,
      mode,
      piSession,
      harness: null,
      systemPrompt: opts?.systemPrompt ?? '',
      status: mode === 'task' ? 'pending' : 'idle',
      taskId: opts?.taskId,
      executionId: opts?.executionId,
      domainId: opts?.domainId,
      refCount: 0,
      createdAt: Date.now(),
    };

    this.sessions.set(id, handle);
    console.log(`[SessionManager] ✅ 已创建: ${id} (mode=${mode})`);
    return id;
  }

  /**
   * get — 获取 SessionHandle
   */
  get(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * getAll — 获取所有活跃 session 摘要
   */
  getAll(): Array<{
    id: string;
    mode: SessionMode;
    status: SessionStatus;
    taskId?: string;
    executionId?: string;
    domainId?: string;
    refCount: number;
  }> {
    return [...this.sessions.values()]
      .filter(s => s.status !== 'closed')
      .map(s => ({
        id: s.id,
        mode: s.mode,
        status: s.status,
        taskId: s.taskId,
        executionId: s.executionId,
        domainId: s.domainId,
        refCount: s.refCount,
      }));
  }

  /**
   * getTaskSession — 根据 taskId + executionId 查找 task session
   */
  getTaskSession(taskId: string, executionId: string): SessionHandle | undefined {
    return [...this.sessions.values()].find(
      s => s.mode === 'task' && s.taskId === taskId && s.executionId === executionId && s.status !== 'closed'
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // ensureHarness — 懒创建 AgentHarness
  // ═══════════════════════════════════════════════════════════════

  /**
   * ensureHarness — 为 task session 懒创建 AgentHarness
   *
   * 创建 AgentHarness 需要：
   *   - LLM 模型（从 DomainCluster 或默认获取）
   *   - 工具链（通过 onBuildDomainTools 回调从 DomainCluster 获取）
   *   - system prompt（通过 onGetDomainSystemPrompt 回调获取）
   *
   * @param sessionId - task session 的 ID
   * @returns AgentHarness 实例
   */
  async ensureHarness(sessionId: string): Promise<AgentHarnessType> {
    const handle = this.sessions.get(sessionId);
    if (!handle) throw new Error(`[SessionManager] Session 不存在: ${sessionId}`);
    if (handle.mode !== 'task') throw new Error(`[SessionManager] 只有 task mode 支持 harness: ${sessionId} (mode=${handle.mode})`);
    if (handle.harness) return handle.harness;

    const domainId = handle.domainId || 'unknown';

    // 1. 获取工具链
    let tools: AgentTool[] = [];
    if (this.onBuildDomainTools) {
      tools = await this.onBuildDomainTools(domainId);
    }

    // 2. 获取 system prompt
    let systemPrompt = handle.systemPrompt;
    if (!systemPrompt && this.onGetDomainSystemPrompt) {
      systemPrompt = this.onGetDomainSystemPrompt(domainId);
    }

    // 3. 创建 LLM 模型
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    const model = getModel('deepseek', 'deepseek-v4-flash');

    // 4. 创建 AgentHarness
    const harness = new AgentHarness({
      env,
      model,
      session: handle.piSession,
      tools,
      systemPrompt: systemPrompt || '你是一个有用的 AI 助手。',
    });

    handle.harness = harness;
    handle.status = 'running';

    console.log(`[SessionManager] 🔧 Harness 已创建: ${sessionId} (domain=${domainId})`);
    return harness;
  }

  /**
   * releaseHarness — 释放 AgentHarness（不关闭 session）
   */
  async releaseHarness(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (!handle || !handle.harness) return;
    try {
      await handle.harness.abort();
    } catch { /* 非关键 */ }
    handle.harness = null;
    console.log(`[SessionManager] 🔓 Harness 已释放: ${sessionId}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // send — 核心路由逻辑
  // ═══════════════════════════════════════════════════════════════

  /**
   * send — 向指定 session 发送消息
   *
   * 路由逻辑按 mode 区分：
   *   chat  → LLMProvider.get()(content)               ❌ 不需 harness
   *   luban → CrossDomainRouter.dispatch() → DAG       ❌ 不需 harness
   *   simq  → MemoryBus.recall()                       ❌ 不需 harness
   *   task  → ensureHarness() + harness.prompt()       ✅ 需要 harness
   *
   * @param sessionId - 目标 session ID
   * @param content - 用户输入内容
   * @returns SendResult
   */
  async send(sessionId: string, content: string): Promise<SendResult> {
    const handle = this.sessions.get(sessionId);
    if (!handle) return { type: 'error', error: `Session ${sessionId} 不存在` };

    switch (handle.mode) {
      // ═══ chat: 单次 LLM 对话 ═══
      case 'chat': {
        try {
          const reply = await LLMProvider.get()(content, handle.systemPrompt || '你是一个有用的助手。');
          return { type: 'direct_chat', output: reply };
        } catch (err: unknown) {
          return { type: 'error', error: `LLM 调用失败: ${(err as Error).message}` };
        }
      }

      // ═══ luban: 编排层 ═══
      case 'luban': {
        if (!this.crossDomainRouter || !this.domainDispatcher) {
          return { type: 'error', error: 'CrossDomainRouter 未就绪' };
        }

        try {
          // ① 意图分析 + DAG 生成
          const dag = await this.crossDomainRouter.dispatch(content);
          if (!dag.nodes || dag.nodes.length === 0) {
            return { type: 'error', error: '未能规划出任何任务' };
          }

          const executionId = handle.executionId || `dag_${Date.now()}`;

          // ② 为每个 DAG 节点创建 task session
          for (const node of dag.nodes) {
            await this.create('task', {
              taskId: node.taskId,
              executionId,
              domainId: node.domain,
            });
          }

          // ③ 通知前端 DAG 已创建
          this.onDagCreated?.(executionId, dag);

          // ④ 异步执行 DAG（不阻塞响应）
          setImmediate(async () => {
            try {
              await this.executeDag(dag.nodes, executionId);
            } catch (err: unknown) {
              console.error(`[SessionManager] ❌ DAG 执行失败: ${executionId}`, (err as Error).message);
            }
          });

          return {
            type: 'dag_plan',
            dag: {
              nodes: dag.nodes,
              isMultiDomain: dag.isMultiDomain,
              involvedDomains: dag.involvedDomains,
              globalIntent: dag.globalIntent,
              reasoning: dag.reasoning,
            },
            executionId,
          };
        } catch (err: unknown) {
          return { type: 'error', error: `规划失败: ${(err as Error).message}` };
        }
      }

      // ═══ simq: 记忆检索（已迁移到 StudioOrchestrator @司马迁）═══
      case 'simq': {
        try {
          const wiki = MemoryBridge.getWiki();
          const queryId = `simq_${Date.now()}`;
          await wiki.remember({
            id: queryId,
            type: 'Query',
            name: `SIMQ: ${content.substring(0, 80)}`,
            data: { content, timestamp: Date.now() },
          }).catch(() => {});
          return { type: 'direct_chat', output: '📖 记忆已记录（MemoryWiki）' };
        } catch (err: unknown) {
          return { type: 'error', error: `记忆操作失败: ${(err as Error).message}` };
        }
      }

      // ═══ task: 执行层 ═══
      case 'task': {
        try {
          await this.ensureHarness(sessionId);
          const assistantMsg = await handle.harness!.prompt(content);
          // AssistantMessage.content 是 (TextContent|ThinkingContent|ToolCall)[]
          const textParts = (assistantMsg.content || [])
            .filter((c: { type: string; text?: string }) => c.type === 'text')
            .map((c: { type: string; text?: string }) => c.text);
          const output = textParts.join('\n').trim() || '执行完成（无文本输出）';
          return { type: 'direct_chat', output };
        } catch (err: unknown) {
          return { type: 'error', error: `任务执行失败: ${(err as Error).message}` };
        }
      }

      default:
        return { type: 'error', error: `未知 mode: ${handle.mode}` };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DAG 执行
  // ═══════════════════════════════════════════════════════════════

  /**
   * executeDag — 异步执行 DAG 节点
   *
   * 由 luban session 的 send() 在 setImmediate 中调用。
   * 每个节点执行时通过 ensureHarness 创建 harness，完成后释放。
   */
  private async executeDag(nodes: import('../../core/src/domains/types.js').DAGNode[], executionId: string): Promise<void> {
    const nodeMap = new Map<string, import('../../core/src/domains/types.js').DAGNode>(nodes.map((n) => [n.taskId, { ...n, status: 'pending' as const }]));
    const maxParallel = 3;

    while (this.hasPendingNodes(nodeMap)) {
      const readyNodes = this.getReadyNodes(nodeMap);
      if (readyNodes.length === 0) {
        // 阻塞检测
        const blocked = this.getBlockedNodes(nodeMap);
        for (const node of blocked) {
          node.status = 'failed';
          this.onTaskCompleted?.(node.taskId, executionId, 'failed', undefined, '依赖阻塞');
        }
        break;
      }

      const batch = readyNodes.slice(0, maxParallel);
      await Promise.all(
        batch.map(async (node) => {
          const taskSessionId = this.getTaskSessionId(node.taskId, executionId);
          if (!taskSessionId) {
            node.status = 'failed';
            this.onTaskCompleted?.(node.taskId, executionId, 'failed', undefined, 'Session 未创建');
            return;
          }

          // 通知开始
          this.onTaskStarted?.(node.taskId, executionId, node.goal, node.domain);

          try {
            // 创建 harness
            await this.ensureHarness(taskSessionId);
            const result = await this.get(taskSessionId)!.harness!.prompt(node.goal);

            node.status = 'completed';
            node.result = result;
            this.onTaskCompleted?.(node.taskId, executionId, 'completed', result);
          } catch (err: unknown) {
            node.status = 'failed';
            node.error = (err as Error).message;
            this.onTaskCompleted?.(node.taskId, executionId, 'failed', undefined, (err as Error).message);
          } finally {
            // 释放 harness
            await this.releaseHarness(taskSessionId);
          }
        })
      );
    }

    // 持久化 DAG 完成状态
    if (this.sessionStore) {
      this.sessionStore.appendChatMessage(`dag_${executionId}`, {
        role: 'system',
        content: `__dag__:${executionId}`,
        region: '系统',
        status: 'completed',
        executionId,
      });
    }
  }

  private hasPendingNodes(nodeMap: Map<string, import('../../core/src/domains/types.js').DAGNode>): boolean {
    return [...nodeMap.values()].some(n => n.status === 'pending');
  }

  private getReadyNodes(nodeMap: Map<string, import('../../core/src/domains/types.js').DAGNode>): import('../../core/src/domains/types.js').DAGNode[] {
    return [...nodeMap.values()].filter(n => {
      if (n.status !== 'pending') return false;
      return ((n.deps as string[]) || []).every((depId: string) => {
        const dep = nodeMap.get(depId);
        return dep && dep.status === 'completed';
      });
    });
  }

  private getBlockedNodes(nodeMap: Map<string, import('../../core/src/domains/types.js').DAGNode>): import('../../core/src/domains/types.js').DAGNode[] {
    return [...nodeMap.values()].filter(n => {
      if (n.status !== 'pending') return false;
      return (n.deps || []).some((depId: string) => {
        const dep = nodeMap.get(depId);
        return dep && dep.status === 'failed';
      });
    });
  }

  private getTaskSessionId(taskId: string, executionId: string): string | undefined {
    const handle = this.getTaskSession(taskId, executionId);
    return handle?.id;
  }

  // ═══════════════════════════════════════════════════════════════
  // 关闭 & 清理
  // ═══════════════════════════════════════════════════════════════

  /**
   * close — 关闭 session
   *
   * 调用 harness.abort()，标记 status='closed'，从 Map 中移除。
   */
  async close(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (!handle) return;

    if (handle.harness) {
      try { await handle.harness.abort(); } catch { /* 非关键 */ }
      handle.harness = null;
    }

    handle.status = 'closed';
    this.sessions.delete(sessionId);
    console.log(`[SessionManager] 🗑️ 已关闭: ${sessionId}`);
  }

  /**
   * closeExecution — 关闭某个 executionId 下的所有 task session
   */
  async closeExecution(executionId: string): Promise<void> {
    const toClose = [...this.sessions.values()].filter(
      s => s.executionId === executionId && s.status !== 'closed'
    );
    await Promise.all(toClose.map(s => this.close(s.id)));
  }

  /**
   * incrementRef — 增加引用计数
   */
  incrementRef(sessionId: string): void {
    const handle = this.sessions.get(sessionId);
    if (handle) handle.refCount++;
  }

  /**
   * decrementRef — 减少引用计数
   */
  decrementRef(sessionId: string): void {
    const handle = this.sessions.get(sessionId);
    if (handle) handle.refCount = Math.max(0, handle.refCount - 1);
  }

  /**
   * gc — 定时清理
   *
   * 清理 refCount=0 且 status∈{completed,failed} 且完成超过 10 分钟的 session
   */
  private gc(): void {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 分钟
    let cleaned = 0;

    for (const [id, handle] of this.sessions) {
      if (handle.refCount > 0) continue;
      if (handle.status === 'completed' || handle.status === 'failed') {
        if (handle.completedAt && (now - handle.completedAt) > timeout) {
          this.close(id); // don't await in GC
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[SessionManager] 🧹 GC 清理了 ${cleaned} 个 session`);
    }
  }
}
