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
 *   4. prompt(node.description) 执行 → 提取最终输出（空内容带纠正指令重试）
 *   5. 失败/超时 → 中止 Agent 清理 + 返回失败（会话 15 去兜底化：移除 fallback 降级）
 *
 * 输出形态（MVP）：文本（step-agent 的最终总结/产物说明）。
 * 产物落盘由 agent 通过 artifact_generation 原语工具完成。
 *
 * @packageDocumentation
 */

import { agentSpawner } from '../../../infrastructure/adapters/agent-spawner.js';
import { createPrimitiveAgentTools, createPrimitiveBeforeToolCall } from '../../../infrastructure/tools/primitiveAgentTools.js';
import type { AgentTool } from '../../../infrastructure/adapters/pi-bridge/index.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AgentSessionStore, AgentSessionHandle } from '../../orchestration/AgentSessionStore.js';
import type { KnowledgeContextPackage } from '../../../gate/context.js';
import type { EventBus } from '../../../infrastructure/common/EventBus.js';

/** DAG 节点的窄接口（避免依赖 DAG 内部类型） */
export interface StepNodeInfo {
  id: string;
  name: string;
  description: string;
  agentType: string;
}

/**
 * 步骤输出错误分类（会话 15 P1-① 步骤级重试精细化）
 * - 'retryable'：空内容 / 工具调用失败（缺失参数/校验失败/放弃工具）——LLM 重新调用工具即可恢复
 * - 'non-retryable'：安全/权限拦截（Gate 凭证缺失等）——重试仍会被硬拦，立即失败
 * - 'none'：正常输出
 */
export type StepErrorClass = 'retryable' | 'non-retryable' | 'none';

/** 输出携带工具失败/放弃工具标记（可重试） */
function isToolFailureOutput(text: string): boolean {
  return (
    /\[primitive:[\w]+ failed\]/.test(text) ||
    /缺失必需参数|参数不完整|请【重新调用】/.test(text) ||
    /validation failed for tool/i.test(text) ||
    /工具 .* 调用参数不完整/i.test(text)
  );
}

/** 输出携带安全/权限拦截标记（不可重试） */
function isSafetyBlockedOutput(text: string): boolean {
  return (
    /GateContextRequiredError/.test(text) ||
    /需要 Gate 凭证|缺少知识凭证/.test(text) ||
    /安全拦截|权限不足|被 Gate 硬拦/.test(text)
  );
}

/** 分类步骤输出/错误（供重试决策 + 步骤级质量信号） */
export function classifyStepOutput(text: string): StepErrorClass {
  if (isSafetyBlockedOutput(text)) return 'non-retryable';
  if (!text.trim() || isToolFailureOutput(text)) return 'retryable';
  return 'none';
}

/**
 * 分类步骤错误消息（异常路径）：
 * - Gate 安全拦截 → 'non-retryable'（重试仍会被硬拦）
 * - 超时/空结果/工具失败 → 'retryable'（瞬态/可恢复）
 */
export function classifyStepError(msg: string): StepErrorClass {
  if (
    /GateContextRequiredError/.test(msg) ||
    /需要 Gate 凭证|缺少知识凭证/.test(msg) ||
    /安全拦截|权限不足|被 Gate 硬拦/.test(msg)
  ) {
    return 'non-retryable';
  }
  return 'retryable';
}

export interface StepAgentExecutorOptions {
  /** 部门 ID（原语隔离 + 知识路由） */
  departmentId?: string;
  /** 总目标（上下文锚点） */
  goal?: string;
  /** 额外注入的工具（叠加在原语工具之上） */
  extraTools?: AgentTool[];
  /**
   * step-agent 执行超时（会话 11c：默认【不设限】——LLM 任务长短不一，复杂任务可能数小时；
   * 传入 timeoutMs>0 时启用超时 → abort + 失败返回，供需要防御的场景使用）。
   */
  timeoutMs?: number;
  /**
   * 会话 9：空内容纠正性重试次数（默认 1）——GLM/opencode 思考模式下拿到工具错误后
   * 常只输出 reasoning_content 而 content 为空（extractText 判空）。重试一次带纠正指令
   * （重新调用工具/直接给交付摘要）。0 = 禁用（首次空内容即失败）。
   */
  correctiveRetries?: number;
  /**
   * 会话 12：沙箱工作目录根（默认 data/agent-workspace）——每个 step 在
   * workspaceRoot/<nodeId>/ 下独立沙箱，file write / shell cwd 默认落沙箱，防写仓库根。
   */
  workspaceRoot?: string;
  /** 会话 4（Session 化）：组件会话仓库——启用后本步骤创建持久化 step-agent 会话 */
  sessionStore?: AgentSessionStore;
  /** 会话 4（执行肢解锁）：Gate 凭证（orchestrator 签发；未在 stepOpts 提供时回退此值） */
  gateContext?: KnowledgeContextPackage;
  /**
   * 会话 16c（3+4）：EventBus——步骤结果/质量事件出口（execution.step.result），
   * 供观测聚合端点 + 学习闭环消费；未注入则不发射。
   */
  eventBus?: EventBus;
  /**
   * 会话 16j（B2 指针消费端）：按 taskRef 拉取历史上下文（装配「可拉取详情」指针的消费端），
   * 透传给 recall_task 工具。未注入 → 不暴露该工具。
   */
  recallTask?: (taskRef: string) => Promise<string | null>;
  /** P2：跨部门/工位交流（mail 原语）发起方上下文——eventBus + mailboxCtx 齐备才暴露 mail 工具。 */
  mailboxCtx?: { from: string; spaceId?: string; taskId?: string; goal?: string };
  /** P-A：任务级关联键（投影/前端按 missionId 归集；事件 payload 透传）。 */
  missionId?: string;
  executionId?: string;
}

export interface StepAgentResult {
  success: boolean;
  /** 执行模式：'agent' = step-agent 工具循环（去兜底化后唯一模式；会话 15 移除 fallback） */
  mode: 'agent';
  output?: unknown;
  error?: string;
  duration: number;
  /**
   * 会话 15 P1-③ 步骤级质量信号：纠正性重试次数（0 = 一次通过）
   */
  retries?: number;
  /**
   * 会话 15 P1-③ 步骤级质量信号：最终结果错误分类
   * （'none' = 正常；'retryable' = 空参/工具失败；'non-retryable' = 安全拦截）
   */
  errorClass?: StepErrorClass;
  /** 会话 4：本步骤持久化会话 ID/路径（sessionStore 启用时存在；跨会话引用锚点） */
  sessionId?: string;
  sessionPath?: string;
}

/** 组装 step-agent 系统提示词 */
function buildStepSystemPrompt(node: StepNodeInfo, opts: StepAgentExecutorOptions, workspaceDir?: string): string {
  return [
    '你是一名 MorPex step-agent，负责完成总大脑分配给你的一个执行步骤。',
    `【本步骤职责】${node.name}`,
    node.description ? `【职责详情】${node.description}` : '',
    opts.goal ? `【总目标】${opts.goal}` : '',
    '',
    '【工作守则】',
    '1. 知识优先：任何生成/创建前，先用 knowledge 工具查询知识库；查询有结果再行动。',
    '2. 使用工具完成动手工作：file 读写文件、shell 执行命令（⚠️ 仅限白名单命令：ls, cat, head, tail, echo, pwd, which, gcc, make, cmake, python3, node, tsc, npx, git, docker, pip, npm，其他命令会被安全拦截）、api 调用接口、artifact 生成产物。',
    '2.5 ⚠️ 评估/分析/审查/合规/方案类任务不需要执行 shell 命令——用 knowledge 查询信息 + file/artifact 产出文档即可；shell 仅用于确实需要编译/构建/运行代码的步骤，且只调白名单命令，禁止编造命令名。',
    '3. artifact 工具负责把最终产物落盘（代码/文档/数据/报告），并报告产物路径与内容摘要。',
    // 会话 12：沙箱工作目录——告诉 agent 产物应写到沙箱，不在仓库根
    ...(workspaceDir
      ? [`4. 【工作目录】你的沙箱工作目录是 ${workspaceDir}。所有文件/命令产物请写到该目录内（file 工具 write 用相对路径自动落入、shell 工具 cwd 已指向）。不要写到仓库根或其他目录。`]
      : []),
    '5. 完成后输出：最终交付摘要（含产物路径、关键决策、遗留风险），格式精炼。',
    '6. 若某工具不可用或失败，说明原因并尝试替代方案，不要假装成功。',
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
    // ⬅️ 会话 15 P1-③ 步骤级质量信号：纠正性重试计数（try/catch 共享）
    let retriesUsed = 0;

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

    // ── 主路径：step-agent 工具循环（agentSpawner + 原语工具）──

    let agent: {
      prompt: (input: string) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      abort: () => Promise<void>;
      /** 17i.12：流式事件订阅（透传 harness.subscribe）。 */
      subscribe?: (listener: (event: Record<string, unknown>) => void) => void;
    } | null = null;
    try {
      // ═══ 会话 12：沙箱工作目录——每个 step 独立目录，file write / shell cwd 默认落此，防写仓库根 ═══
      let workspaceDir: string | undefined;
      const workspaceRoot = this.opts.workspaceRoot ?? 'data/agent-workspace';
      try {
        workspaceDir = path.join(workspaceRoot, sanitizeSessionId(node.id) || 'step');
        fs.mkdirSync(workspaceDir, { recursive: true });
      } catch (err) {
        console.warn(`[StepAgentExecutor] ⚠️ 沙箱目录创建失败（降级无沙箱）: ${(err as Error).message}`);
        workspaceDir = undefined;
      }

      const tools = [
        ...createPrimitiveAgentTools({
          departmentId: this.opts.departmentId,
          // ⬅️ 会话 4（执行肢解锁）：Gate 凭证注入——step-agent 可执行破坏性操作（file write/shell build 等）
          gateContext: stepOpts?.gateContext ?? this.opts.gateContext,
          // ⬅️ 会话 12：沙箱工作目录（file/shell 默认落此）
          workspaceDir,
          // ⬅️ 会话 13：step 目标（knowledge 空 query 兜底）
          goal: this.opts.goal,
          // ⬅️ 会话 16j（B2）：指针消费端——按 taskRef 拉取被裁详情（零丢失闭环）
          recallTask: this.opts.recallTask,
          // ⬅️ 会话 17i.15：ask_user 工具（LLM 自主问用户）——EventBus 事件 + 会话归属
          eventBus: this.opts.eventBus,
          sessionId: stepSession?.sessionId || this.opts.goal,
          // ⬅️ P2：mail 工具（跨部门/工位交流）发起方上下文
          mailboxCtx: this.opts.mailboxCtx,
        }),
        ...(this.opts.extraTools ?? []),
      ];

      agent = await agentSpawner.spawn({
        identityToken: `step-agent:${node.id}`,
        ring: 0,
        tools,
        systemPrompt: buildStepSystemPrompt(node, this.opts, workspaceDir),
        domainId: this.opts.departmentId ?? 'general',
        // ⬅️ 会话 4：注入持久化会话（对话/工具调用自动落盘）
        session: stepSession?.session,
        // ⬅️ 会话 15（工具可靠性 P0）：工具执行前钩子——空参拦截强制重发 + knowledge goal 兜底
        beforeToolCall: createPrimitiveBeforeToolCall({
          departmentId: this.opts.departmentId,
          goal: this.opts.goal,
        }),
      });

      // ═══ 会话 17i.12：流式 token 转发（Codex 式实时输出）→ EventBus → SSE → 前端终端转录 ═══
      // harness.subscribe 收 message_update（text_delta/thinking_delta），按节点节流合并后发
      // execution.stream.text/think（execution.* 非 internal，可投射到 SSE）。
      const streamBuf: Record<string, { kind: 'text' | 'think'; buf: string; timer?: ReturnType<typeof setTimeout> }> = {};
      const flushStream = (key: string): void => {
        const s = streamBuf[key];
        if (!s) return;
        if (s.timer !== undefined) { clearTimeout(s.timer); s.timer = undefined; }
        if (!s.buf || !this.opts.eventBus) { delete streamBuf[key]; return; }
        const kind = s.kind;
        const delta = s.buf;
        delete streamBuf[key];
        this.opts.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: kind === 'think' ? 'execution.stream.think' : 'execution.stream.text',
          timestamp: Date.now(),
          executionId: `step_${node.id}`,
          source: 'step-agent-executor',
          payload: { nodeId: node.id, nodeName: node.name, delta },
        });
      };
      if (typeof agent.subscribe === 'function') {
        agent.subscribe((evt) => {
          const e = evt as Record<string, unknown>;
          if (e.type !== 'message_update') return;
          const ae = (e.assistantMessageEvent ?? {}) as Record<string, unknown>;
          const atype = String(ae.type ?? '');
          const delta = typeof ae.delta === 'string' ? ae.delta : '';
          if (!delta) return;
          const kind = atype === 'thinking_delta' ? 'think' : 'text';
          const key = `${node.id}:${kind}`;
          const slot = (streamBuf[key] ??= { kind, buf: '' });
          slot.buf += delta;
          if (slot.timer === undefined) {
            slot.timer = setTimeout(() => flushStream(key), 120);
          }
        });
      }

      const input = [
        `请开始执行本步骤。${node.description ? `\n\n${node.description}` : ''}`,
        upstreamText,
        '\n\n请按守则执行并给出交付摘要。',
      ].join('\n');

      // ═══ 会话 17i.3：步骤开始即上报（长步骤执行期前端可实时显示当前步骤）═══
      // 17i.4：带上 stepSession.path 供前端轮询思考/输出
      this.emitStepStarted(node, stepSession?.path);

      const raw = await this.withTimeout(agent.prompt(input), this.opts.timeoutMs);
      let text = extractText(raw.content);

      // ═══ 会话 9 + 会话 15 P1-①：纠正性重试（分类精细化）═══
      // 首轮输出分类：
      //   - 'non-retryable'（安全/权限拦截）→ 立即失败，不重试（重试仍会被 Gate 硬拦）
      //   - 'retryable'（空内容 / 工具调用失败标记）→ 带纠正指令重试：
      //        工具失败 → 【必须重新调用工具填全参数】（不给"直接输出摘要"逃生口——那正是空参空转的放弃路径）
      //        空内容   → 保持原纠正指令（信息已足够可直出摘要）
      const firstClass = classifyStepOutput(text);
      if (firstClass === 'non-retryable') {
        throw new Error(`[StepAgentExecutor] 步骤被安全拦截（不可重试）: ${text.slice(0, 200)}`);
      }
      if (firstClass === 'retryable' && (this.opts.correctiveRetries ?? 2) > 0) {
        const retries = this.opts.correctiveRetries ?? 2; // ═══ 16m·2：1→2（GLM-4-Flash 弱函数调用，多一次纠正机会）═══
        for (let attempt = 1; attempt <= retries; attempt++) {
          retriesUsed = attempt;
          const correctiveInput = text.trim() && !/不在允许列表中|安全拦截|权限不足|被 Gate 硬拦/.test(text)
            ? [
                '你的上一步工具调用失败或参数不完整（见上述错误反馈）。',
                '你必须【重新调用】对应工具并填全所有必需参数，一次调用填全，不要省略、不要留空、不要改为输出文字：',
                '- knowledge 需 query、shell 需 command（⚠️ shell 仅限白名单命令：ls, cat, head, tail, echo, pwd, which, gcc, make, cmake, python3, node, tsc, npx, git, docker, pip, npm；禁止编造/猜测命令名，否则会被安全拦截）、api 需 url+method、file 需 operation+path、artifact 需 type+specification。',
                '工具成功返回后再以 "## 交付摘要" 开头输出最终总结（含产物路径、关键决策、遗留风险）。',
              ].join('\n')
            : [
                '你的上一步执行没有产出可见文本（可能工具调用参数不完整，或只进行了思考未输出）。',
                '请【直接输出交付摘要】完成本步骤：',
                `- 若需要知识/文件/接口数据：重新调用对应工具并提供【完整必需参数】（如 knowledge 需 query、shell 需 command、api 需 url+method）。`,
                `- 若信息已足够：直接以 "## 交付摘要" 开头输出最终总结（含产物路径、关键决策、遗留风险）。`,
                '注意：最终输出必须是可见文本（不要只思考），格式精炼。',
              ].join('\n');
          console.warn(`[StepAgentExecutor] ⚠️ Agent 输出需纠正（class=${firstClass}），纠正性重试 ${attempt}/${retries}…`);
          const retryRaw = await this.withTimeout(agent.prompt(correctiveInput), this.opts.timeoutMs);
          text = extractText(retryRaw.content);
          if (text.trim() && classifyStepOutput(text) === 'none') break;
        }
      }

      // ═══ 16m·2 最终兜底：纠正重试耗尽仍无效 → 强制无工具直出交付摘要
      //     （GLM-4-Flash 顽固工具调用/编造命令时，防止节点因工具反复失败而失败）═══
      if (!text.trim() || classifyStepOutput(text) !== 'none') {
        console.warn('[StepAgentExecutor] ⚠️ 纠正重试耗尽，强制无工具直出摘要（最终兜底）…');
        const finalRaw = await this.withTimeout(
          agent.prompt('不要调用任何工具。直接以 "## 交付摘要" 开头输出本步骤的最终总结（基于已有知识/上下文，包含关键决策、结果、遗留风险）。不要输出工具调用 JSON，不要留空。'),
          this.opts.timeoutMs,
        );
        text = extractText(finalRaw.content);
      }
      if (!text.trim() || classifyStepOutput(text) !== 'none') {
        throw new Error(`[StepAgentExecutor] Agent 未产出有效结果（class=${classifyStepOutput(text)}）`);
      }

      const res: StepAgentResult = {
        success: true,
        mode: 'agent',
        output: { text: text.trim(), nodeId: node.id, agentType: node.agentType },
        duration: Date.now() - start,
        // ⬅️ 会话 15 P1-③ 步骤级质量信号
        retries: retriesUsed,
        errorClass: 'none',
      };
      await this.recordStepResult(stepSession, node, res);
      this.emitStepResult(node, res);
      return this.withSessionMeta(res, stepSession);
    } catch (err) {
      // 异常/超时 → 尝试中止 Agent 清理（避免孤儿 LLM 会话）
      if (agent) {
        try { await agent.abort(); } catch { /* abort 失败忽略，不影响失败返回 */ }
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[StepAgentExecutor] ✗ step-agent 执行失败（${msg}）`);
      const res: StepAgentResult = {
        success: false,
        mode: 'agent',
        error: msg,
        duration: Date.now() - start,
        // ⬅️ 会话 15 P1-③ 步骤级质量信号：错误分类（安全拦截=non-retryable；超时/工具失败=retryable）
        retries: retriesUsed,
        errorClass: classifyStepError(msg),
      };
      await this.recordStepResult(stepSession, node, res, msg);
      this.emitStepResult(node, res);
      return this.withSessionMeta(res, stepSession);
    }
  }

  /**
   * 会话 17i.3：发射步骤开始事件（execution.step.started）——前端实时任务卡片据此显示「正在执行：<步骤名>」。
   * 必须在 agent.prompt 之前发射（步骤可能耗时数分钟，仅靠 completion 事件会在整段执行期无反馈）。
   * 注意：execution.step.* 不在 EventBus 的 INTERNAL 前缀白名单内 → 可投射到前端 SSE。
   */
  private emitStepStarted(node: StepNodeInfo, sessionPath?: string): void {
    if (!this.opts.eventBus) return;
    this.opts.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'execution.step.started',
      timestamp: Date.now(),
      executionId: `step_${node.id}`,
      source: 'step-agent-executor',
      payload: {
        nodeId: node.id,
        nodeName: node.name,
        agentType: node.agentType,
        missionId: this.opts.missionId,
        ...(this.opts.executionId ? { executionId: this.opts.executionId } : {}),
        ...(this.opts.goal ? { goal: this.opts.goal } : {}),
        ...(sessionPath ? { sessionPath } : {}),
      },
    });
  }

  /**
   * 会话 16c（3+4）：发射步骤结果事件（execution.step.result）——观测/学习闭环数据源。
   * 事件体含步骤级质量信号（success/retries/errorClass/duration/error）。
   */
  private emitStepResult(node: StepNodeInfo, res: StepAgentResult): void {
    if (!this.opts.eventBus) return;
    this.opts.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'execution.step.result',
      timestamp: Date.now(),
      executionId: `step_${node.id}`,
      source: 'step-agent-executor',
      payload: {
        nodeId: node.id,
        nodeName: node.name,
        agentType: node.agentType,
        missionId: this.opts.missionId,
        ...(this.opts.executionId ? { executionId: this.opts.executionId } : {}),
        ...(this.opts.goal ? { goal: this.opts.goal } : {}),
        success: res.success,
        duration: res.duration,
        retries: res.retries ?? 0,
        errorClass: res.errorClass ?? (res.success ? 'none' : 'retryable'),
        error: res.error,
      },
    });
  }

  /** 记录本步骤会话条目（step-result；失败原因与质量信号一并记录） */
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
      // ⬅️ 会话 15 P1-③ 步骤级质量信号：重试次数 + 错误分类（供经验/评价消费）
      retries: res.retries ?? 0,
      errorClass: res.errorClass ?? (res.success ? 'none' : 'retryable'),
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
