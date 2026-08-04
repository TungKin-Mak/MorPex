/**
 * OrchestratorAgent — 总大脑（多 Agent 编排框架，会话 3 定稿 · P2 审计循环）
 *
 * 双职责：
 *   1. 任务开始：分析复杂度 → 编排
 *        - 简单 → 单 step-agent（不走 DAG）
 *        - 复杂 → 调用 DAG 工具创建 N 个 step-agent（依赖传递 + 上游成果注入）
 *   2. 后期：汇总所有 step 成果 → LLM 审计
 *        - pass → 生成最终交付物
 *        - fail → 生成补充任务 → 再分发（迭代，上限 maxIterations）
 *
 * 组件边界（会话 3 定稿）：
 *   - 总大脑 = 本类（规划 + 审计，纯编排不执行）
 *   - DAG 工具 = DAGRuntimeLike（调度/分发/依赖传递）
 *   - step-agent = StepAgentExecutor（每节点一个，LLM 工具调用循环）
 *   - 执行肢 = agentSpawner（原语工具 knowledge/file/shell/api/artifact）
 *
 * @packageDocumentation
 */

import type { DAGRuntimeLike } from '../UnifiedExecutionEngine.js';
import { StepAgentExecutor } from '../runtime/dag/StepAgentExecutor.js';
import type { AgentSessionStore, AgentSessionHandle } from './AgentSessionStore.js';
import type { KnowledgeContextPackage } from '../../gate/context.js';

// ── 类型 ──

export interface OrchestratorStep {
  name: string;
  description: string;
  /** 依赖的上游步骤名（第一步为空） */
  deps: string[];
}

export interface OrchestratorAnalysis {
  complexity: 'simple' | 'complex';
  steps: OrchestratorStep[];
  reasoning: string;
}

export interface AuditResult {
  pass: boolean;
  issues: string[];
  /** fail 时生成的补充任务（再分发） */
  supplementaryTasks: OrchestratorStep[];
  reasoning: string;
}

export interface OrchestratorOptions {
  /** LLM 调用（规划/审计/汇总）。未提供 → 降级：单 step-agent 直跑 + 跳过审计 */
  llm?: {
    generateText: (opts: { prompt: string; temperature?: number }) => Promise<{
      text: string;
      /** 真实 token 用量（PiBridge.generateText 返回，用于精确计费） */
      usage?: { input?: number; output?: number; total?: number };
    }>;
  };
  /** DAG 工具（复杂任务分发；nodeHandler 已接 step-agent） */
  dagRuntime?: DAGRuntimeLike;
  /** step-agent 执行器（简单任务直跑 + 复杂任务单节点兜底） */
  stepExecutor: StepAgentExecutor;
  /** 审计迭代上限（默认 3，防止无限补充循环） */
  maxIterations?: number;
  /** token 用量回调（可选，接入 CostController） */
  onTokenUsage?: (tokens: number) => void;
  /** 会话 4（Session 化）：组件会话仓库——总大脑/step-agent 独立持久化会话 */
  sessionStore?: AgentSessionStore;
  /**
   * 会话 4（执行肢解锁）：Gate 两阶段签发回调（ServiceContainer 注入）。
   * 返回 KnowledgeContextPackage 或 null（不可用/失败 → 不阻断，破坏性操作维持硬拦截）。
   * 一次签发覆盖整个编排（分析/审计/汇总的 token 已计，不重复两阶段）。
   */
  gateRunner?: (goal: string, departmentId?: string) => Promise<KnowledgeContextPackage | null>;
}

export interface OrchestrationResult {
  success: boolean;
  /** 最终交付物（LLM 汇总文本） */
  output?: unknown;
  iterations: number;
  stepsExecuted: number;
  auditLog: Array<{ iteration: number; pass: boolean; issues: string[]; reasoning: string }>;
  /** 各步骤原始成果（nodeName → output） */
  stepResults: Map<string, unknown>;
  /** 会话 4：各步骤持久化会话路径（stepName → sessionPath；跨会话讨论锚点） */
  stepSessions: Map<string, string>;
  /** 会话 4：总大脑会话 ID/路径 */
  sessionId?: string;
  sessionPath?: string;
  error?: string;
  duration: number;
}

// ── 工具函数 ──

/** 提取 LLM 响应 token 用量（真实 usage.total；缺失时回退字符数估算，保证单调非零） */
function tokenCount(res?: { text: string; usage?: { input?: number; output?: number; total?: number } } | null): number {
  if (!res) return 0;
  if (typeof res.usage?.total === 'number' && res.usage.total > 0) return res.usage.total;
  return res.text.length;
}

/** 从 LLM 响应中提取 JSON 对象（与 bootstrap 参数提取同模式，容错） */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 会话 ID 清洗（与 StepAgentExecutor 一致） */
function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'unknown';
}

/** 输出预览截断（防巨型 JSONL） */
function previewText(v: unknown, max = 2000): string {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…[截断]` : s;
}

/** 解析总大脑拆解结果（容错：解析失败 → 单 step 直跑） */
function parseAnalysis(json: Record<string, unknown> | null, goal: string, llmAvailable: boolean): OrchestratorAnalysis {
  if (!json) {
    return {
      complexity: 'simple',
      steps: [{ name: goal.slice(0, 50), description: goal, deps: [] }],
      reasoning: llmAvailable ? 'analysis_failed' : 'llm_unavailable_fallback',
    };
  }
  const complexity = json.complexity === 'complex' ? 'complex' : 'simple';
  const rawSteps = Array.isArray(json.steps) ? json.steps : [];
  const steps: OrchestratorStep[] = rawSteps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      name: typeof s.name === 'string' && s.name ? s.name : `step_${i}`,
      description: typeof s.description === 'string' && s.description ? s.description : goal,
      deps: toStringList(s.deps),
    }));
  if (steps.length === 0) {
    return { complexity: 'simple', steps: [{ name: goal.slice(0, 50), description: goal, deps: [] }], reasoning: 'empty_steps_fallback' };
  }
  return { complexity, steps, reasoning: typeof json.reasoning === 'string' ? json.reasoning : '' };
}

// ── 提示词 ──

const ANALYSIS_PROMPT = (goal: string): string => `你是 MorPex 总大脑（编排 Agent）。请将用户目标拆解为可执行步骤。

目标: ${goal}

要求：
1. 判断复杂度：能一步完成（查询/简单生成）→ simple；需多步配合（研究+生成/多领域/多阶段）→ complex。
2. 复杂任务拆解 2-6 步，每步一个职责（如：调研知识 → 设计 → 实现 → 验证）。
3. 步骤间有依赖用 deps 引用步骤 name（第一步 deps 为空数组）。
4. 步骤 description 需包含足够上下文供 step-agent 独立执行。

只输出 JSON（不要多余文字）：
{"complexity":"simple|complex","steps":[{"name":"步骤名","description":"步骤详细描述","deps":["上游步骤名"]}],"reasoning":"拆解理由"}`;

const AUDIT_PROMPT = (goal: string, resultsText: string): string => `你是 MorPex 审计 Agent。请评估以下任务是否已达成目标。

目标: ${goal}

各步骤成果:
${resultsText}

要求：
1. 判断 pass/fail：成果是否完整覆盖目标、是否有关键缺口/错误。
2. fail 时给出 supplementaryTasks（补做任务，deps 可为空），pass 时为空数组。

只输出 JSON：
{"pass":true|false,"issues":["问题1"],"supplementaryTasks":[{"name":"补做步骤","description":"补做内容","deps":[]}],"reasoning":"审计理由"}`;

const SYNTHESIS_PROMPT = (goal: string, resultsText: string): string => `你是 MorPex 总大脑。请汇总所有步骤成果，生成最终交付物（完整报告/文档/代码说明）。

目标: ${goal}

各步骤成果:
${resultsText}

要求：输出结构完整、可直接交付的最终成果（不要引用步骤编号，不要写"汇总"字样开头，直接给交付物本体）。`;

// ── OrchestratorAgent ──

export class OrchestratorAgent {
  name = 'OrchestratorAgent';

  private opts: OrchestratorOptions;
  private llm: OrchestratorOptions['llm'];

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.llm = opts.llm;
  }

  get llmAvailable(): boolean {
    return !!this.llm;
  }

  /**
   * run — 总大脑完整闭环：编排 → 执行 → 审计（迭代）→ 汇总
   */
  async run(goal: string, opts: { departmentId?: string } = {}): Promise<OrchestrationResult> {
    const start = Date.now();
    const maxIterations = this.opts.maxIterations ?? 3;
    const auditLog: OrchestrationResult['auditLog'] = [];
    const stepResults = new Map<string, unknown>();
    const stepSessions = new Map<string, string>();

    // ═══ 会话 4（执行肢解锁）：Gate 两阶段签发凭证（一次，覆盖整个编排）═══
    let gateContext: KnowledgeContextPackage | null = null;
    if (this.opts.gateRunner) {
      try {
        gateContext = await this.opts.gateRunner(goal, opts.departmentId);
        if (gateContext) {
          console.log(`[OrchestratorAgent] 🎫 Gate 凭证签发成功（queryCallCount=${gateContext.queryCallCount}）——step-agent 破坏性操作已解锁`);
        }
      } catch (err) {
        console.warn(`[OrchestratorAgent] ⚠️ Gate 凭证签发失败（破坏性操作保持硬拦截）: ${(err as Error).message}`);
      }
    }

    // ═══ 会话 4（Session 化）：总大脑会话 ═══
    let orchSession: AgentSessionHandle | null = null;
    if (this.opts.sessionStore) {
      try {
        orchSession = await this.opts.sessionStore.createSession({
          component: 'orchestrator',
          id: `orch_${Date.now()}`,
          goal,
          departmentId: opts.departmentId,
          metadata: { goal, departmentId: opts.departmentId },
        });
        await this.opts.sessionStore.appendSessionName(orchSession.session, goal.slice(0, 60));
      } catch (err) {
        console.warn(`[OrchestratorAgent] ⚠️ 总大脑会话创建失败（不影响执行）: ${(err as Error).message}`);
      }
    }

    // ── ① 编排：分析复杂度 + 拆解 ──
    let analysis: OrchestratorAnalysis;
    try {
      const res = await this.llm?.generateText({ prompt: ANALYSIS_PROMPT(goal), temperature: 0 });
      this.opts.onTokenUsage?.(tokenCount(res));
      analysis = parseAnalysis(res ? extractJsonObject(res.text) : null, goal, !!this.llm);
    } catch {
      analysis = { complexity: 'simple', steps: [{ name: goal.slice(0, 50), description: goal, deps: [] }], reasoning: 'analysis_failed' };
    }
    if (orchSession && this.opts.sessionStore) {
      await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.analysis', {
        complexity: analysis.complexity,
        steps: analysis.steps,
        reasoning: analysis.reasoning,
      });
    }

    let steps = analysis.steps;
    let iterations = 0;
    let stepsExecuted = 0;

    // ── ② 执行 + 审计迭代 ──
    while (iterations < maxIterations) {
      iterations++;

      // 执行本轮步骤（简单 → 单 step-agent；复杂 → DAG 工具）
      const round = await this.executeSteps(goal, steps, opts.departmentId, gateContext);
      for (const [k, v] of round.results) stepResults.set(k, v);
      for (const [k, v] of round.sessions) stepSessions.set(k, v);
      stepsExecuted += round.results.size;

      // 审计
      let audit: AuditResult;
      try {
        const resultsText = this.formatResults(round.results);
        const res = await this.llm?.generateText({ prompt: AUDIT_PROMPT(goal, resultsText), temperature: 0 });
        this.opts.onTokenUsage?.(tokenCount(res));
        const json = res ? extractJsonObject(res.text) : null;
        audit = json
          ? {
              pass: json.pass === true,
              issues: toStringList(json.issues),
              supplementaryTasks: Array.isArray(json.supplementaryTasks)
                ? json.supplementaryTasks
                    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
                    .map((s, i) => ({
                      name: typeof s.name === 'string' ? s.name : `supplement_${i}`,
                      description: typeof s.description === 'string' ? s.description : goal,
                      deps: toStringList(s.deps),
                    }))
                : [],
              reasoning: typeof json.reasoning === 'string' ? json.reasoning : '',
            }
          : { pass: true, issues: [], supplementaryTasks: [], reasoning: 'llm_unavailable_pass' };
      } catch {
        audit = { pass: true, issues: [], supplementaryTasks: [], reasoning: 'audit_failed_pass' };
      }

      auditLog.push({ iteration: iterations, pass: audit.pass, issues: audit.issues, reasoning: audit.reasoning });
      if (orchSession && this.opts.sessionStore) {
        await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.audit', {
          iteration: iterations,
          pass: audit.pass,
          issues: audit.issues,
          supplementaryTasks: audit.supplementaryTasks,
          reasoning: audit.reasoning,
        });
      }

      if (audit.pass || audit.supplementaryTasks.length === 0) break;
      steps = audit.supplementaryTasks; // fail → 补充任务再分发
    }

    // ── ③ 汇总：LLM 生成最终交付物 ──
    let finalOutput: unknown;
    try {
      const resultsText = this.formatResults(stepResults);
      const res = await this.llm?.generateText({ prompt: SYNTHESIS_PROMPT(goal, resultsText), temperature: 0 });
      this.opts.onTokenUsage?.(tokenCount(res));
      finalOutput = res?.text?.trim() ?? this.formatResults(stepResults);
    } catch {
      finalOutput = this.formatResults(stepResults);
    }
    if (orchSession && this.opts.sessionStore) {
      await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.synthesis', {
        outputPreview: previewText(finalOutput),
      });
    }

    const failed = [...stepResults.values()].length === 0;
    return {
      success: !failed,
      output: finalOutput,
      iterations,
      stepsExecuted,
      auditLog,
      stepResults,
      stepSessions,
      sessionId: orchSession?.sessionId,
      sessionPath: orchSession?.path,
      error: failed ? '所有步骤均未产出成果' : undefined,
      duration: Date.now() - start,
    };
  }

  // ── 内部：执行一轮步骤 ──

  private async executeSteps(
    goal: string,
    steps: OrchestratorStep[],
    departmentId?: string,
    gateContext?: KnowledgeContextPackage | null,
  ): Promise<{ results: Map<string, unknown>; sessions: Map<string, string> }> {
    const results = new Map<string, unknown>();
    const sessions = new Map<string, string>();

    // 会话 4：预创建本步骤会话（parentSessionPath = 第一个依赖步骤的会话路径）
    const ensureStepSession = async (step: OrchestratorStep): Promise<{ session?: unknown; sessionPath?: string }> => {
      if (!this.opts.sessionStore) return {};
      const parentPath = (step.deps || []).map(d => sessions.get(d)).find(Boolean);
      const handle = await this.opts.sessionStore.createSession({
        component: 'step-agent',
        id: `step_${sanitizeSessionId(step.name)}_${Date.now()}`,
        goal,
        departmentId,
        parentSessionPath: parentPath,
        metadata: { stepName: step.name, deps: step.deps || [] },
      });
      sessions.set(step.name, handle.path);
      return { session: handle.session, sessionPath: handle.path };
    };

    // 简单任务：单 step-agent 直跑（会话 3：简单任务不走 DAG）
    if (steps.length === 1 && this.opts.stepExecutor) {
      const step = steps[0];
      const sess = await ensureStepSession(step);
      const r = await this.opts.stepExecutor.executeStep(
        { id: step.name, name: step.name, description: step.description, agentType: 'general' },
        new Map<string, unknown>(),
        { session: sess.session, sessionPath: sess.sessionPath, upstreamSessions: new Map(), gateContext: gateContext ?? undefined },
      );
      results.set(step.name, r.success ? r.output : { error: r.error });
      return { results, sessions };
    }

    // 复杂任务：DAG 工具分发（nodeHandler 已接 step-agent + 上游成果注入）
    if (this.opts.dagRuntime && steps.length > 1) {
      try {
        // 会话 4：预创建所有 step 会话（parentSessionPath 按依赖链），经 ctx 传给 nodeHandler
        const handles = new Map<string, { session: unknown; sessionPath: string }>();
        for (const s of steps) {
          const h = await ensureStepSession(s);
          if (h.sessionPath) handles.set(s.name, { session: h.session, sessionPath: h.sessionPath });
        }
        const dagResult = await this.opts.dagRuntime.execute(
          goal,
          steps.map(s => ({ name: s.name, description: s.description, deps: s.deps })),
          { goal, departmentId, stepSessions: handles, gateContext: gateContext ?? undefined },
        );
        // nodeResults: Map<nodeId, output> — 合并到按步骤名索引的结果
        const raw = (dagResult as unknown as { nodeResults?: Map<string, unknown> }).nodeResults;
        if (raw) {
          const nodes = steps.map(s => ({ id: s.name, name: s.name, description: s.description, deps: s.deps }));
          for (const [nodeId, out] of raw) {
            const idxMatch = nodeId.match(/^node_(\d+)_/);
            const idx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
            const step = (idx >= 0 && idx < nodes.length)
              ? nodes[idx]
              : nodes.find(n => n.id === nodeId || nodeId.includes(n.name)) ?? nodes[0];
            results.set(step?.id ?? nodeId, out);
          }
        }
        return { results, sessions };
      } catch (err) {
        console.warn(`[OrchestratorAgent] ⚠️ DAG 执行失败: ${(err as Error).message}，降级逐节点直跑`);
      }
    }

    // 降级：无 DAG 工具或 DAG 失败 → 逐节点 step-agent 直跑（依赖注入上游成果）
    for (const step of steps) {
      const upstream = new Map<string, unknown>();
      const upstreamSessions = new Map<string, string>();
      for (const dep of step.deps || []) {
        if (results.has(dep)) upstream.set(dep, results.get(dep));
        if (sessions.has(dep)) upstreamSessions.set(dep, sessions.get(dep)!);
      }
      const sess = await ensureStepSession(step);
      const r = await this.opts.stepExecutor.executeStep(
        { id: step.name, name: step.name, description: step.description, agentType: 'general' },
        upstream,
        { session: sess.session, sessionPath: sess.sessionPath, upstreamSessions, gateContext: gateContext ?? undefined },
      );
      results.set(step.name, r.success ? r.output : { error: r.error });
    }
    return { results, sessions };
  }

  private formatResults(results: Map<string, unknown>): string {
    if (results.size === 0) return '(无步骤成果)';
    const lines: string[] = [];
    for (const [name, out] of results) {
      const text = typeof out === 'string' ? out : JSON.stringify(out ?? null);
      lines.push(`### ${name}\n${text}`);
    }
    return lines.join('\n\n');
  }
}
