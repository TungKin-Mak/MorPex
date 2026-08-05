/**
 * StepAgentExecutor — DAG 节点 step-agent 执行器（多 Agent 框架 P0c）
 *
 * 会话 3 架构落点：DAG 节点（总大脑拆分的 step）由【step-agent + 执行肢】执行，
 * 取代原先 ExecutionFabric 的单次 LLM 生成（无工具调用能力 → 生成类任务空转/卡死）。
 *
 * 执行流程：
 *   1. 组装 step-agent systemPrompt（职责 + 原语工具使用守则 + 知识优先原则）
 *   2. 注入上游成果（P1：upstreamResults → prompt 上下文）
 *   3. agentSpawner.spawn 创建执行肢（pi-agent-core Agent：LLM 思考 + 工具调用循环）
 *   4. prompt(node.description) 执行 → 提取最终输出
 *   5. 失败/Agent 不可用 → fallbackExecutor（ExecutionFabric 单次 LLM 生成）降级
 *
 * 输出形态（MVP）：文本（step-agent 的最终总结/产物说明）。
 * 产物落盘由 agent 通过 artifact_generation 原语工具完成。
 *
 * @packageDocumentation
 */

import { agentSpawner } from '../../../infrastructure/adapters/agent-spawner.js';
import { createPrimitiveAgentTools } from '../../../infrastructure/tools/primitiveAgentTools.js';
import type { AgentTool } from '../../../infrastructure/adapters/pi-bridge/index.js';
import type { AgentSessionStore, AgentSessionHandle } from '../../orchestration/AgentSessionStore.js';
import type { KnowledgeContextPackage } from '../../../gate/context.js';

/** DAG 节点的窄接口（避免依赖 DAG 内部类型） */
export interface StepNodeInfo {
  id: string;
  name: string;
  description: string;
  agentType: string;
}

export interface StepAgentExecutorOptions {
  /** 部门 ID（原语隔离 + 知识路由） */
  departmentId?: string;
  /** 总目标（上下文锚点） */
  goal?: string;
  /** 额外注入的工具（叠加在原语工具之上） */
  extraTools?: AgentTool[];
  /**
   * 兜底执行器：Agent spawn/执行失败时降级（单次 LLM 生成）。
   * 不传时失败直接返回（由上层决定重试/失败）。
   */
  fallbackExecutor?: (node: StepNodeInfo, upstreamText: string) => Promise<unknown>;
  /** 是否禁用 Agent（纯 fallback 模式，测试用） */
  agentDisabled?: boolean;
  /**
   * step-agent 执行超时（会话 11c：默认【不设限】——LLM 任务长短不一，复杂任务可能数小时；
   * 传入 timeoutMs>0 时启用超时 → abort + 降级 fallback，供需要防御的场景使用）。
   */
  timeoutMs?: number;
  /**
   * 会话 9：空内容纠正性重试次数（默认 1）——GLM 思考模式下拿到工具错误后
   * 常只输出 reasoning_content 而 content 为空（extractText 判空）。重试一次带纠正指令
   * （重新调用工具/直接给交付摘要），再降级 fallback。0 = 禁用（回到直接降级）。
   */
  correctiveRetries?: number;
  /** 会话 4（Session 化）：组件会话仓库——启用后本步骤创建持久化 step-agent 会话 */
  sessionStore?: AgentSessionStore;
  /** 会话 4（执行肢解锁）：Gate 凭证（orchestrator 签发；未在 stepOpts 提供时回退此值） */
  gateContext?: KnowledgeContextPackage;
}

export interface StepAgentResult {
  success: boolean;
  /** 执行模式：'agent' = step-agent 工具循环 ｜ 'fallback' = 单次 LLM 生成 */
  mode: 'agent' | 'fallback';
  output?: unknown;
  error?: string;
  duration: number;
  /** 会话 4：本步骤持久化会话 ID/路径（sessionStore 启用时存在；跨会话引用锚点） */
  sessionId?: string;
  sessionPath?: string;
}

/** 组装 step-agent 系统提示词 */
function buildStepSystemPrompt(node: StepNodeInfo, opts: StepAgentExecutorOptions): string {
  return [
    '你是一名 MorPex step-agent，负责完成总大脑分配给你的一个执行步骤。',
    `【本步骤职责】${node.name}`,
    node.description ? `【职责详情】${node.description}` : '',
    opts.goal ? `【总目标】${opts.goal}` : '',
    '',
    '【工作守则】',
    '1. 知识优先：任何生成/创建前，先用 knowledge 工具查询知识库；查询有结果再行动。',
    '2. 使用工具完成动手工作：file 读写文件、shell 执行命令、api 调用接口、artifact 生成产物。',
    '3. artifact 工具负责把最终产物落盘（代码/文档/数据/报告），并报告产物路径与内容摘要。',
    '4. 完成后输出：最终交付摘要（含产物路径、关键决策、遗留风险），格式精炼。',
    '5. 若某工具不可用或失败，说明原因并尝试替代方案，不要假装成功。',
    '',
    '输出格式要求：最后以 "## 交付摘要" 开头输出最终总结。',
  ].filter(Boolean).join('\n');
}

/** 序列化上游成果（Map<nodeId, output> → 文本） */
function formatUpstreamResults(upstreamResults: Map<string, unknown> | Record<string, unknown> | undefined): string {
  if (!upstreamResults) return '';
  const entries = upstreamResults instanceof Map ? [...upstreamResults.entries()] : Object.entries(upstreamResults);
  if (entries.length === 0) return '';
  const lines = entries.map(([id, out]) => {
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? null);
    return `### 上游节点 ${id}\n${text}`;
  });
  return `\n\n【上游步骤成果（供你参考，是你的输入）】\n${lines.join('\n\n')}`;
}

/** 序列化上游会话引用（depName → sessionPath，跨会话讨论锚点） */
function formatUpstreamSessionRefs(upstreamSessions: Map<string, string> | undefined): string {
  if (!upstreamSessions || upstreamSessions.size === 0) return '';
  const lines = [...upstreamSessions.entries()].map(([name, p]) => `- ${name}: ${p}`);
  return `\n\n【上游步骤会话引用（可打开 jsonl 查看完整对话/审计）】\n${lines.join('\n')}`;
}

/** 会话 ID 清洗：非 [A-Za-z0-9_-] → '_'，截断 40 */
function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'unknown';
}

/** 输出预览截断（防巨型 JSONL） */
function previewText(v: unknown, max = 2000): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…[截断]` : s;
}

/**
 * StepAgentExecutor — step-agent 节点执行器
 */
export class StepAgentExecutor {
  private opts: StepAgentExecutorOptions;

  constructor(opts: StepAgentExecutorOptions = {}) {
    this.opts = opts;
  }

  /**
   * executeStep — 执行单个 DAG 节点（step-agent + 执行肢）
   *
   * @param node - 节点信息（name/description/agentType）
   * @param upstreamResults - 上游节点成果（nodeId → output，P1）
   * @param stepOpts - 会话 4：会话注入（session/sessionPath）+ 上游会话引用（upstreamSessions）
   */
  async executeStep(
    node: StepNodeInfo,
    upstreamResults?: Map<string, unknown> | Record<string, unknown>,
    stepOpts?: {
      session?: unknown;
      sessionPath?: string;
      upstreamSessions?: Map<string, string>;
      /** 会话 4（执行肢解锁）：orchestrator 经 Gate 两阶段签发的凭证，注入原语工具（破坏性操作放行） */
      gateContext?: KnowledgeContextPackage;
    },
  ): Promise<StepAgentResult> {
    const start = Date.now();
    const upstreamText = formatUpstreamResults(upstreamResults) + formatUpstreamSessionRefs(stepOpts?.upstreamSessions);

    // ═══ 会话 4（Session 化）：创建/复用本步骤持久化会话 ═══
    let stepSession: AgentSessionHandle | null = null;
    if (stepOpts?.session) {
      stepSession = {
        sessionId: '',
        path: stepOpts.sessionPath ?? '',
        session: stepOpts.session as AgentSessionHandle['session'],
      };
    } else if (this.opts.sessionStore) {
      try {
        const firstUpstream = stepOpts?.upstreamSessions?.values().next().value;
        stepSession = await this.opts.sessionStore.createSession({
          component: 'step-agent',
          id: `step_${sanitizeSessionId(node.id)}_${Date.now()}`,
          goal: this.opts.goal,
          departmentId: this.opts.departmentId,
          parentSessionPath: firstUpstream,
          metadata: {
            nodeId: node.id,
            nodeName: node.name,
            agentType: node.agentType,
            description: node.description,
            upstreamSessionIds: [...(stepOpts?.upstreamSessions?.keys() ?? [])],
          },
        });
      } catch (err) {
        console.warn(`[StepAgentExecutor] ⚠️ step-agent 会话创建失败（不影响执行）: ${(err as Error).message}`);
      }
    }

    // ── 降级路径：Agent 禁用/未就绪 → fallback（单次 LLM 生成）──
    if (this.opts.agentDisabled) {
      const res = await this.runFallback(node, upstreamText, start);
      await this.recordStepResult(stepSession, node, res);
      return this.withSessionMeta(res, stepSession);
    }

    let agent: {
      prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      abort: () => Promise<void>;
    } | null = null;
    try {
      const tools = [
        ...createPrimitiveAgentTools({
          departmentId: this.opts.departmentId,
          // ⬅️ 会话 4（执行肢解锁）：Gate 凭证注入——step-agent 可执行破坏性操作（file write/shell build 等）
          gateContext: stepOpts?.gateContext ?? this.opts.gateContext,
        }),
        ...(this.opts.extraTools ?? []),
      ];

      agent = await agentSpawner.spawn({
        identityToken: `step-agent:${node.id}`,
        ring: 0,
        tools,
        systemPrompt: buildStepSystemPrompt(node, this.opts),
        domainId: this.opts.departmentId ?? 'general',
        // ⬅️ 会话 4：注入持久化会话（对话/工具调用自动落盘）
        session: stepSession?.session,
      });

      const input = [
        `请开始执行本步骤。${node.description ? `\n\n${node.description}` : ''}`,
        upstreamText,
        '\n\n请按守则执行并给出交付摘要。',
      ].join('\n');

      const raw = await this.withTimeout(agent.prompt(input), this.opts.timeoutMs);
      let text = extractText(raw.content);

      // ═══ 会话 9：空内容纠正性重试（保留思考模式）═══
      // GLM 思考模式：工具错误后下一轮常只输出 reasoning_content、content 为空 → extractText 判空。
      // 不直接降级：带纠正指令重试（agent session 上下文仍在，含失败的工具调用与错误反馈），
      // 让模型重新调用工具（补全参数）或直接产出交付摘要；重试仍空才降级。
      if (!text.trim() && (this.opts.correctiveRetries ?? 1) > 0) {
        const retries = this.opts.correctiveRetries ?? 1;
        for (let attempt = 1; attempt <= retries; attempt++) {
          const correctiveInput = [
            '你的上一步执行没有产出可见文本（可能工具调用参数不完整，或只进行了思考未输出）。',
            '请【直接输出交付摘要】完成本步骤：',
            `- 若需要知识/文件/接口数据：重新调用对应工具并提供【完整必需参数】（如 knowledge 需 query、shell 需 command、api 需 url+method）。`,
            `- 若信息已足够：直接以 "## 交付摘要" 开头输出最终总结（含产物路径、关键决策、遗留风险）。`,
            '注意：最终输出必须是可见文本（不要只思考），格式精炼。',
          ].join('\n');
          console.warn(`[StepAgentExecutor] ⚠️ Agent 返回空内容，纠正性重试 ${attempt}/${retries}…`);
          const retryRaw = await this.withTimeout(agent.prompt(correctiveInput), this.opts.timeoutMs);
          text = extractText(retryRaw.content);
          if (text.trim()) break;
        }
      }

      if (!text.trim()) {
        throw new Error('[StepAgentExecutor] Agent 返回空内容');
      }

      const res: StepAgentResult = {
        success: true,
        mode: 'agent',
        output: { text: text.trim(), nodeId: node.id, agentType: node.agentType },
        duration: Date.now() - start,
      };
      await this.recordStepResult(stepSession, node, res);
      return this.withSessionMeta(res, stepSession);
    } catch (err) {
      // 异常/超时 → 尝试中止 Agent 清理（避免孤儿 LLM 会话）
      if (agent) {
        try { await agent.abort(); } catch { /* abort 失败忽略，不影响降级 */ }
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[StepAgentExecutor] ⚠️ step-agent 执行失败（${msg}），降级 fallback`);
      const res = await this.runFallback(node, upstreamText, start);
      await this.recordStepResult(stepSession, node, res, msg);
      return this.withSessionMeta(res, stepSession);
    }
  }

  /** 记录本步骤会话条目（step-result；失败原因一并记录） */
  private async recordStepResult(
    stepSession: AgentSessionHandle | null,
    node: StepNodeInfo,
    res: StepAgentResult,
    agentError?: string,
  ): Promise<void> {
    if (!stepSession || !this.opts.sessionStore) return;
    await this.opts.sessionStore.appendCustom(stepSession.session, 'step-result', {
      nodeId: node.id,
      nodeName: node.name,
      agentType: node.agentType,
      success: res.success,
      mode: res.mode,
      duration: res.duration,
      error: res.error ?? agentError ?? undefined,
      outputPreview: previewText(res.output),
    });
  }

  /** 结果补充会话元数据（跨会话引用） */
  private async withSessionMeta(res: StepAgentResult, stepSession: AgentSessionHandle | null): Promise<StepAgentResult> {
    if (!stepSession) return res;
    if (stepSession.sessionId) return { ...res, sessionId: stepSession.sessionId, sessionPath: stepSession.path };
    try {
      const meta = await (stepSession.session as unknown as { getMetadata(): Promise<{ id: string; path: string }> }).getMetadata();
      return { ...res, sessionId: meta.id, sessionPath: meta.path };
    } catch {
      return res;
    }
  }

  /**
   * 带超时的 Promise 执行（timeoutMs 未设置/<=0 → 不设限，让 LLM 自然跑完；
   * >0 时超时 → reject，由上层 catch 走 fallback 降级）
   */
  private async withTimeout<T>(p: Promise<T>, timeoutMs?: number): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) return p;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`step-agent 执行超时（${timeoutMs}ms）`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async runFallback(node: StepNodeInfo, upstreamText: string, start: number): Promise<StepAgentResult> {
    if (!this.opts.fallbackExecutor) {
      return {
        success: false,
        mode: 'fallback',
        error: '[StepAgentExecutor] Agent 不可用且未配置 fallbackExecutor',
        duration: Date.now() - start,
      };
    }
    try {
      const output = await this.opts.fallbackExecutor(node, upstreamText);
      return { success: true, mode: 'fallback', output, duration: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, mode: 'fallback', error: msg, duration: Date.now() - start };
    }
  }
}

/** 从 Agent prompt 返回的 content 中提取文本 */
export function extractText(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => (c as { text: string }).text)
    .join('\n')
    .trim();
}
