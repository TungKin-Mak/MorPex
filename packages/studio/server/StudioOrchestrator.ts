/**
 * StudioOrchestrator — 对话编排与 Agent 路由分发
 *
 * 职责：
 *   1. @Agent 专职路由（@鲁班 → 任务DAG, @司马迁 → 记忆检索）
 *   2. 意图分类（闲聊 vs 任务）
 *   3. 直接对话生成
 *   4. Harness steer 管理（用户回复 → Agent 挂起恢复）
 *   5. 执行状态追踪 (ExecutionHandle)
 *
 * 从 StudioServer 提取，消除业务编排与 HTTP 传输的耦合。
 */

import type { MorPexKernel, MorPexEvent } from '../../core/index.js';
import type { CrossDomainRouter } from '../../core/src/router/CrossDomainRouter.js';
import type { DomainDispatcher } from '../../core/src/router/DomainDispatcher.js';
import type { DomainClusterManager } from '../../core/src/domains/DomainClusterManager.js';
import type { MemoryBus } from '../../memory/src/core/MemoryBus.js';
import type { MemoryRetriever } from '../../memory/src/wiki/MemoryRetriever.js';
import { LLMProvider } from '../../core/src/services/LLMProvider.js';
import type { SessionStore } from './SessionStore.js';
import type { ArtifactWriter } from './ArtifactWriter.js';

// ── 执行状态记录 ──

export interface ExecutionRecord {
  executionId: string;
  status: 'running' | 'completed' | 'failed';
  input: string;
  output?: any;
  error?: string;
  dag?: any;
  nodes: Map<string, { taskId: string; domain: string; goal: string; status: string; result?: any; error?: string }>;
  startedAt: number;
  completedAt?: number;
  result?: any;
}

// ── StudioOrchestrator ──

export class StudioOrchestrator {
  private kernel: MorPexKernel;
  private crossDomainRouter?: CrossDomainRouter;
  private domainDispatcher?: DomainDispatcher;
  private domainManager?: DomainClusterManager;
  private memoryBus?: MemoryBus;
  private memoryRetriever?: MemoryRetriever;
  private sessionStore?: SessionStore;
  private artifactWriter?: ArtifactWriter;

  /** 当前 DAG 执行 ID */
  dagExecId: string = '';
  /** 当前会话 ID（用于 LLM 流式事件标识） */
  currentSessionId: string = '';

  /** 等待用户回复的 Promise resolvers（key = harnessId） */
  private steerResolvers: Map<string, (reply: string) => void> = new Map();

  /** Agent 专职路由表 */
  private agentDispatchMap: Map<string, (content: string, execId: string, sessionId?: string) => Promise<Record<string, any>>> = new Map();

  /** 执行状态追踪 */
  executionStore: Map<string, ExecutionRecord> = new Map();

  constructor(deps: {
    kernel: MorPexKernel;
    crossDomainRouter?: CrossDomainRouter;
    domainDispatcher?: DomainDispatcher;
    domainManager?: DomainClusterManager;
    memoryBus?: MemoryBus;
    memoryRetriever?: MemoryRetriever;
    sessionStore?: SessionStore;
    artifactWriter?: ArtifactWriter;
  }) {
    this.kernel = deps.kernel;
    this.crossDomainRouter = deps.crossDomainRouter;
    this.domainDispatcher = deps.domainDispatcher;
    this.domainManager = deps.domainManager;
    this.memoryBus = deps.memoryBus;
    this.memoryRetriever = deps.memoryRetriever;
    this.sessionStore = deps.sessionStore;
    this.artifactWriter = deps.artifactWriter;
    this.initAgentDispatchMap();
  }

  // ═══════════════════════════════════════════════════════════════
  // Agent 路由分发
  // ═══════════════════════════════════════════════════════════════

  /**
   * routeMessage — 路由用户消息到对应 Agent 或直接对话
   *
   * @param content - 用户输入内容
   * @param execId - 执行 ID
   * @param sessionId - 会话 ID
   * @param agent - 显式指定 Agent（可选）
   * @returns 回复结果
   */
  async routeMessage(
    content: string,
    execId: string,
    sessionId: string,
    agent?: string,
  ): Promise<Record<string, any>> {
    let agentKey: string | null = null;
    let cleanContent = content;

    if (agent && this.agentDispatchMap.has(agent)) {
      agentKey = agent;
    } else {
      const agentKeys = Array.from(this.agentDispatchMap.keys()).join('|');
      const agentRegex = new RegExp(`@(${agentKeys})`);
      const agentMatch = content.match(agentRegex);
      if (agentMatch) {
        agentKey = agentMatch[1];
        cleanContent = content.replace(agentRegex, '').trim();
      }
    }

    const finalContent = cleanContent || '你好';

    if (agentKey && this.agentDispatchMap.has(agentKey)) {
      const handler = this.agentDispatchMap.get(agentKey)!;
      const result = await handler(finalContent, execId, sessionId);
      return { ...result, sessionId };
    }

    // 无 @ 标签 → 默认闲聊（流式推送）
    const reply = await this.generateDirectReply(finalContent, execId, sessionId);
    if (this.memoryBus) {
      await this.memoryBus.remember({
        content: `[Chat] ${finalContent.substring(0, 200)}`,
        source: 'chat', sourceId: execId,
        tags: ['chat', 'direct_chat'], importance: 1,
        metadata: { executionId: execId, sessionId },
      }).catch(() => {});
    }
    return { ok: true, type: 'direct_chat', output: reply, executionId: execId, sessionId };
  }

  /**
   * getAgentList — 获取所有注册的 Agent 列表
   */
  getAgentList(): Array<{ key: string; name: string; desc: string }> {
    return [
      { key: '鲁班', name: '@鲁班', desc: '任务规划、创作执行、复杂工作流' },
      { key: '司马迁', name: '@司马迁', desc: '检索历史记忆和知识库' },
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // Harness Steer 管理
  // ═══════════════════════════════════════════════════════════════

  addSteerResolver(harnessId: string, resolve: (reply: string) => void): void {
    this.steerResolvers.set(harnessId, resolve);
  }

  resolveSteer(harnessId: string, reply: string): boolean {
    const resolve = this.steerResolvers.get(harnessId);
    if (!resolve) return false;
    this.steerResolvers.delete(harnessId);
    resolve(reply);
    return true;
  }

  /** 是否还有正在等待用户回复的 steer */
  get hasPendingSteer(): boolean {
    return this.steerResolvers.size > 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // 执行状态追踪 (ExecutionHandle)
  // ═══════════════════════════════════════════════════════════════

  registerExecution(execId: string, input: string, dag?: any): void {
    if (this.executionStore.has(execId)) return;
    const nodeMap = new Map<string, { taskId: string; domain: string; goal: string; status: string; result?: any; error?: string }>();
    if (dag?.nodes) {
      for (const n of dag.nodes) {
        nodeMap.set(n.taskId, { taskId: n.taskId, domain: n.domain, goal: n.goal, status: n.status || 'pending' });
      }
    }
    this.executionStore.set(execId, {
      executionId: execId, status: 'running', input, dag,
      nodes: nodeMap, startedAt: Date.now(),
    });
  }

  updateNodeStatus(execId: string, taskId: string, update: Partial<{ status: string; result: any; error: string }>): void {
    const exe = this.executionStore.get(execId);
    if (!exe) return;
    const existing = exe.nodes.get(taskId) ?? { taskId, domain: '', goal: '', status: 'pending' };
    Object.assign(existing, update);
    exe.nodes.set(taskId, existing);
  }

  finalizeExecution(execId: string, status: 'completed' | 'failed', result?: any, error?: string): void {
    const exe = this.executionStore.get(execId);
    if (!exe) return;
    exe.status = status;
    exe.completedAt = Date.now();
    exe.result = result;
    exe.error = error;
  }

  getExecution(execId: string): ExecutionRecord | undefined {
    return this.executionStore.get(execId);
  }

  // ═══════════════════════════════════════════════════════════════
  // 意图分类
  // ═══════════════════════════════════════════════════════════════

  async classifyIntent(content: string): Promise<'direct_chat' | 'task'> {
    const trimmed = content.trim();
    const greetings = ['你好','您好','hi','hello','hey','嗨','早上好','下午好','晚上好','good morning','good afternoon','test','你是谁','who are you','😀'];
    const lower = trimmed.toLowerCase();
    for (const g of greetings) {
      if (lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '？') || lower.startsWith(g + '?') || lower.startsWith(g + '，') || lower.startsWith(g + ',')) return 'direct_chat';
    }
    if (trimmed.length <= 4) return 'direct_chat';
    try {
      const callLLM = LLMProvider.get();
      const result = await callLLM(`判断以下用户输入是「闲聊」还是「任务」。只输出 "chat" 或 "task"。\n\n用户输入："${trimmed}"`, '你是一个精确的意图分类器。');
      return result.trim().toLowerCase().includes('chat') ? 'direct_chat' : 'task';
    } catch { return 'task'; }
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  private initAgentDispatchMap(): void {
    this.agentDispatchMap = new Map();

    // ── @鲁班：任务/创作模式 ──
    this.agentDispatchMap.set('鲁班', async (content, execId, sessionId) => {
      try {
        if (!this.crossDomainRouter || !this.domainDispatcher) {
          return { ok: false, error: 'CrossDomainRouter 未就绪' };
        }
        this.dagExecId = execId;
        const dag = await this.crossDomainRouter.dispatch(content);
        if (dag.nodes?.length > 0) {
          this.emit('cross_domain.dag_created', {
            dag: dag.nodes, flowId: execId,
            analysis: {
              globalIntent: dag.globalIntent, isMultiDomain: dag.isMultiDomain,
              involvedDomains: dag.involvedDomains, reasoning: dag.reasoning,
            },
          });
        }
        if (dag.nodes?.length > 0) {
          const sessionCtx = {
            sessionId: sessionId || `sess_${execId}`,
            executionId: execId, input: content, artifacts: {}, memory: [],
          };
          this.registerExecution(execId, content, dag);
          setImmediate(() => {
            this.domainDispatcher!.executeDAG(dag.nodes, sessionCtx)
              .then((execResult) => {
                console.log(`[@鲁班] ✅ 异步完成: ${execId} (${execResult.completedNodes}/${dag.nodes.length} 节点)`);
                const resultMap = new Map((execResult.results || []).map((r: any) => [r.taskId, r]));
                const finalNodes = dag.nodes.map((n: any) => {
                  const r = resultMap.get(n.taskId) as any;
                  return { ...n, status: (r?.status || 'completed') as string, result: r?.output ?? null, error: r?.error ?? null };
                });
                this.finalizeExecution(execId, execResult.success ? 'completed' : 'failed', execResult, execResult.error);
                this.sessionStore?.appendChatMessage(sessionId || '', {
                  role: 'system', content: `__dag__:${execId}`,
                  region: '系统', status: 'completed', executionId: execId,
                  dag: { ...dag, nodes: finalNodes },
                });
                if (this.memoryBus) {
                  this.memoryBus.remember({
                    content: `[Task] ${content.substring(0, 200)}`,
                    source: 'chat', sourceId: execId,
                    tags: ['task', '鲁班'], importance: 3,
                    metadata: { executionId: execId, sessionId, agent: '鲁班' },
                  }).catch(() => {});
                }
              }).catch((err: any) => {
                console.error(`[@鲁班] ❌ 异步失败: ${execId}`, err.message);
                this.finalizeExecution(execId, 'failed', undefined, err.message);
              });
          });
        }
        return {
          ok: true, type: 'dag_plan', executionId: execId,
          dag: {
            nodes: dag.nodes, isMultiDomain: dag.isMultiDomain,
            involvedDomains: dag.involvedDomains, globalIntent: dag.globalIntent,
            reasoning: dag.reasoning, agent: '@鲁班',
          },
        };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    });

    // ── @司马迁：记忆检索模式 ──
    this.agentDispatchMap.set('司马迁', async (content, execId, sessionId) => {
      try {
        const result = await this.memoryBus?.recall?.({ text: content, topK: 5 });
        const items = result?.items ?? [];
        const reply = items.length > 0
          ? `📖 找到 ${items.length} 条相关记忆：\n\n${items.map((r: any, i: number) => `[${i+1}] ${r.content?.substring(0,200) ?? '(无内容)'}`).join('\n---\n')}`
          : '📭 未找到相关记忆。';
        return { ok: true, type: 'direct_chat', output: reply, agent: '@司马迁', executionId: execId, sessionId };
      } catch (e: any) {
        return { ok: true, type: 'direct_chat', output: `⚠️ 记忆检索暂不可用：${e.message}`, executionId: execId, sessionId };
      }
    });

    console.log(`[StudioOrchestrator] ✅ AgentDispatchMap (${this.agentDispatchMap.size} 个专职 Agent)`);
  }

  private async generateDirectReply(content: string, execId: string, sessionId: string): Promise<string> {
    try {
      this.currentSessionId = sessionId;
      const callLLM = LLMProvider.get();
      const reply = await callLLM(
        `用户对你说："${content}"\n\n请用友好、自然的中文回复。你是 MorPex 智能系统助手。回复保持简洁（1-3句话），不要提技术细节、DAG、规划等。`,
        '你是一个友好、乐于助人的中文对话助手。',
      );
      this.currentSessionId = '';
      return reply.trim();
    } catch {
      this.currentSessionId = '';
      return '你好！我是 MorPex 智能助手，有什么可以帮你的吗？';
    }
  }

  private emit(type: string, payload: any, execId?: string): void {
    this.kernel.eventBus.emit({
      id: this.kernel.executionIdentity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: execId || this.dagExecId || 'studio',
      source: 'orchestrator',
      payload,
    });
  }
}
