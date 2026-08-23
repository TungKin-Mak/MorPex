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
 * ═══ 会话 15（去兜底化）：LLM 必填，失败即抛（fail loud，无静默降级）═══
 *   - llm 为必选项（生产恒注入）→ 移除 llm_unavailable_fallback
 *   - 任务拆解/审计/汇总 LLM 失败或 JSON 解析失败 → 抛错（run 失败，显式可诊断）
 *   - DAG 工具失败 → 抛错（移除“逐节点直跑”静默降级）
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
import { getSharedDeblackboxRecorder } from '../../infrastructure/observability/deblackbox/DeblackboxRecorder.js';
import { StepAgentExecutor } from '../runtime/dag/StepAgentExecutor.js';
import type { AgentSessionStore, AgentSessionHandle } from './AgentSessionStore.js';
import type { KnowledgeContextPackage } from '../../gate/context.js';
import { requestPlanConfirm } from '../PlanGateService.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  /** LLM 调用（规划/审计/汇总）。必填——去兜底化后无 LLM 不可执行（生产恒注入） */
  llm: {
    generateText: (opts: { prompt: string; temperature?: number }) => Promise<{
      text: string;
      /** 真实 token 用量（PiBridge.generateText 返回，用于精确计费） */
      usage?: { input?: number; output?: number; total?: number };
    }>;
  };
  /** DAG 工具（复杂任务分发；nodeHandler 已接 step-agent） */
  dagRuntime?: DAGRuntimeLike;
  /** step-agent 执行器（简单任务直跑 + 复杂任务单节点） */
  stepExecutor: StepAgentExecutor;
  /** 审计迭代上限（默认 3，防止无限补充循环） */
  maxIterations?: number;
  /**
   * ═══ P2-8（会话 16l·3）：步骤数上限（默认 8）——LLM 拆解失控时截断保底，
   *     呼应 Bounded Autonomy 铁律（超限终止不空转）。分析/重规划/补充任务产出的 steps 均受此约束。
   */
  maxSteps?: number;
  /**
   * ═══ P2-8（会话 16l·3）：编排总 token 预算（默认 200k）——分析/审计/重规划/汇总累计，
   *     超限抛错 fail loud（不静默截断产物）。0 = 不设限（兼容旧行为）。
   */
  maxTotalTokens?: number;
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
  /** 最终交付物（LLM 汇总文本）；部分失败时 = 基于成功步骤的降级交付物 */
  output?: unknown;
  iterations: number;
  stepsExecuted: number;
  auditLog: Array<{ iteration: number; pass: boolean; issues: string[]; reasoning: string }>;
  /** 各步骤原始成果（nodeName → output） */
  stepResults: Map<string, unknown>;
  /**
   * 会话 15 P1-② 部分成功 salvage：硬失败步骤报告（step → 原因）。
   * 存在时 success=false，但 output 仍为基于成功步骤的降级交付物（显式，非静默）。
   */
  failureReport?: Array<{ step: string; error: string }>;
  /**
   * 会话 16d（P2 规划质量评估）：规划 vs 执行指标——供引擎发射 evolution.planning.quality。
   */
  planQuality?: {
    plannedSteps: number;
    executedSteps: number;
    iterations: number;
    failedSteps: number;
    replanned: boolean;
    success: boolean;
  };
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

/**
 * 解析总大脑拆解结果。
 * ═══ 会话 15（去兜底化）：无合法 JSON / 无步骤 → 抛错（fail loud，由 run 失败显式可诊断）。
 */
function parseAnalysis(json: Record<string, unknown> | null): OrchestratorAnalysis {
  if (!json) {
    throw new Error('[OrchestratorAgent] 任务拆解响应无法解析为 JSON（LLM 输出为空或非 JSON）');
  }
  const complexity = json.complexity === 'complex' ? 'complex' : 'simple';
  const rawSteps = Array.isArray(json.steps) ? json.steps : [];
  const steps: OrchestratorStep[] = rawSteps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      name: typeof s.name === 'string' && s.name ? s.name : `step_${i}`,
      description: typeof s.description === 'string' && s.description ? s.description : '',
      deps: toStringList(s.deps),
    }));
  if (steps.length === 0) {
    throw new Error('[OrchestratorAgent] 任务拆解未产出任何步骤（steps 为空）');
  }
  if (steps.some(s => !s.description)) {
    throw new Error('[OrchestratorAgent] 任务拆解步骤缺失 description（无法执行）');
  }
  return { complexity, steps, reasoning: typeof json.reasoning === 'string' ? json.reasoning : '' };
}

// ── 提示词 ──

const ANALYSIS_PROMPT = (goal: string, persona?: string): string => `你是 MorPex 总大脑（编排 Agent）。请将用户目标拆解为可执行步骤。
${persona ? `
【部门经理角色】${persona}
（本部门可用能力仅作参考，工位按任务复杂度动态编排，不硬性绑定。）
` : ''}
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

// ═══ 会话 16d（P2 规划动态性·动态重规划）：失败后重新拆解（带失败上下文，替换原计划）═══
const REPLAN_PROMPT = (goal: string, resultsText: string, failuresText: string): string => `你是 MorPex 总大脑。原计划执行中出现步骤失败，请重新规划。

目标: ${goal}

已产出的成果:
${resultsText}

失败的步骤与原因:
${failuresText}

要求：
1. 基于已有成果 + 失败原因重新拆解 2-6 步（避免重蹈失败路径；可复用已成功成果）。
2. 每步一个职责，deps 引用步骤 name。

只输出 JSON：
{"complexity":"simple|complex","steps":[{"name":"步骤名","description":"步骤详细描述","deps":["上游步骤名"]}],"reasoning":"重规划理由"}`;

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

  /**
   * run — 总大脑完整闭环：编排 → 执行 → 审计（迭代）→ 汇总
   */
  async run(goal: string, opts: { departmentId?: string; contextHint?: string; managerPersona?: string; capabilities?: string[]; /** T0 多轮连续：外部传入的 orchestrator 账本路径——存在时 resume 而非新建（同一 chat 会话复用同一本账） */ orchestratorSessionPath?: string } = {}): Promise<OrchestrationResult> {
    const start = Date.now();
    const maxIterations = this.opts.maxIterations ?? 3;
    // ═══ P2-8（会话 16l·3）：步骤数 cap + 总 token 预算 ═══
    const maxSteps = this.opts.maxSteps ?? 8;
    const maxTotalTokens = this.opts.maxTotalTokens ?? 200_000;
    let totalTokens = 0;
    // 累计 token 并检查总预算（超限 → fail loud，不空转）
    const chargeTokens = (tokens: number): void => {
      totalTokens += tokens;
      if (maxTotalTokens > 0 && totalTokens > maxTotalTokens) {
        throw new Error(`[OrchestratorAgent] 编排 token 预算超限（${totalTokens} > ${maxTotalTokens}）——终止以防失控`);
      }
    };
    // 步骤 cap：截断 + 警告（LLM 拆解失控时保底，不静默丢弃关键前置步骤的语义）
    const capSteps = (steps: OrchestratorStep[]): OrchestratorStep[] => {
      if (steps.length <= maxSteps) return steps;
      console.warn(`[OrchestratorAgent] ⚠️ 步骤数 ${steps.length} 超过上限 ${maxSteps} → 截断（Bounded Autonomy）`);
      return steps.slice(0, maxSteps);
    };
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
    // ═══ T0 多轮连续：opts.orchestratorSessionPath 存在 → resume 既有账本（pi 引擎重放全部历史为 LLM 上下文）；否则新建 ═══
    let orchSession: AgentSessionHandle | null = null;
    if (this.opts.sessionStore) {
      try {
        orchSession = opts.orchestratorSessionPath
          ? await this.opts.sessionStore.openHandle(opts.orchestratorSessionPath)
          : await this.opts.sessionStore.createSession({
              component: 'orchestrator',
              id: `orch_${Date.now()}`,
              goal,
              departmentId: opts.departmentId,
              metadata: { goal, departmentId: opts.departmentId },
            });
        if (!opts.orchestratorSessionPath) {
          await this.opts.sessionStore.appendSessionName(orchSession.session, goal.slice(0, 60));
        }
      } catch (err) {
        console.warn(`[OrchestratorAgent] ⚠️ 总大脑会话创建/恢复失败（降级为无账本执行，不影响主流程）: ${(err as Error).message}`);
      }
    }

    // ═══ T0 多轮连续③：resume 时回读账本中的历史对话注入分析；并把本轮目标写进账本（对话内容入账）═══
    let historyBlock = '';
    if (orchSession && this.opts.sessionStore) {
      try {
        if (opts.orchestratorSessionPath) {
          const priorEntries = await this.opts.sessionStore.readEntries(orchSession.path);
          const turns = priorEntries
            .filter((e) => e.type === 'message' && (e.role === 'user' || e.role === 'assistant'))
            .slice(-8)
            .map((e) => `${e.role === 'user' ? '用户' : 'AI'}: ${previewText(e.content, 300)}`);
          if (turns.length > 0) {
            historyBlock = `\n\n【与该用户的近期对话历史（供理解本轮诉求；勿重复执行其中已完成的旧任务）】\n${turns.join('\n')}`;
          }
        }
        await this.opts.sessionStore.appendMessage(orchSession.session, { role: 'user', content: goal });
      } catch (err) {
        console.warn(`[OrchestratorAgent] ⚠️ 会话历史读写失败（按无历史继续）: ${(err as Error).message}`);
      }
    }

    // ── ① 编排：分析复杂度 + 拆解（LLM 失败/JSON 非法 → 抛错，fail loud）──
    // ═══ 会话 16c（3+4）：contextHint = 任务级自动重跑注入的上次失败参考（避免重蹈）═══
    // ═══ P1：managerPersona/capabilities = 部门经理 persona 注入（由 StudioServer 路由选中的部门 Space 提供）═══
    const personaBlock = opts.managerPersona
      ? `${opts.managerPersona}${opts.capabilities?.length ? `\n本部门可用能力：${opts.capabilities.join('、')}` : ''}`
      : undefined;
    const analysisPromptBase = opts.contextHint
      ? `${ANALYSIS_PROMPT(goal, personaBlock)}\n\n【上次尝试失败参考（仅作规避指引，勿照抄失败路径）】\n${opts.contextHint}`
      : ANALYSIS_PROMPT(goal, personaBlock);
    const analysisPrompt = `${analysisPromptBase}${historyBlock}`;
    const res = await this.llm.generateText({ prompt: analysisPrompt, temperature: 0 });
    this.opts.onTokenUsage?.(tokenCount(res));
    chargeTokens(tokenCount(res));
    const analysis = parseAnalysis(res ? extractJsonObject(res.text) : null);
    analysis.steps = capSteps(analysis.steps);
    if (orchSession && this.opts.sessionStore) {
      await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.analysis', {
        complexity: analysis.complexity,
        steps: analysis.steps,
        reasoning: analysis.reasoning,
      });
    }

    // ═══ 会话 17i.22：规划方案确认门——Goal 模式跳过（全自动）；交互模式暂停等用户确认（发 plan.ready）═══
    try {
      const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const planFile = this.writePlanFile(planId, goal, analysis);
      const waited = await requestPlanConfirm(
        planId,
        goal,
        planFile,
        analysis.steps.map((s) => s.name || '步骤'),
      );
      if (waited) console.log(`[OrchestratorAgent] ✅ 用户已确认方案（${planId}），继续执行`);
      else console.log(`[OrchestratorAgent] ⚡ Goal 模式：方案自动放行（${planId}）`);
    } catch (err) {
      console.warn('[OrchestratorAgent] ⚠️ 方案确认门异常（不阻断）:', (err as Error).message);
    }

    let steps = analysis.steps;
    let iterations = 0;
    let stepsExecuted = 0;
    // ═══ 会话 16d（P2 规划动态性）：动态重规划标记（有界 replan=1）═══
    let replanned = false;

    // ── ② 执行 + 审计迭代 ──
    // ═══ 会话 15 P1-②：跨轮累积硬失败（供最终 salvage 报告）═══
    const stepFailures = new Map<string, string>();
    while (iterations < maxIterations) {
      iterations++;

      // 执行本轮步骤（简单 → 单 step-agent；复杂 → DAG 工具）
      const round = await this.executeSteps(goal, steps, opts.departmentId, gateContext);
      for (const [k, v] of round.results) stepResults.set(k, v);
      for (const [k, v] of round.sessions) stepSessions.set(k, v);
      for (const [k, v] of round.failures) stepFailures.set(k, v);
      stepsExecuted += round.results.size;

      // 审计（LLM 失败/JSON 非法 → 抛错，绝不静默 pass）
      const resultsText = this.formatResults(round.results);
      const auditRes = await this.llm.generateText({ prompt: AUDIT_PROMPT(goal, resultsText), temperature: 0 });
      this.opts.onTokenUsage?.(tokenCount(auditRes));
      chargeTokens(tokenCount(auditRes));
      const json = auditRes ? extractJsonObject(auditRes.text) : null;
      if (!json) {
        throw new Error('[OrchestratorAgent] 审计响应无法解析为 JSON（禁止静默 pass）');
      }
      const audit: AuditResult = {
        pass: json.pass === true,
        issues: toStringList(json.issues),
        supplementaryTasks: Array.isArray(json.supplementaryTasks)
          ? json.supplementaryTasks
              .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
              .map((s, i) => ({
                name: typeof s.name === 'string' ? s.name : `supplement_${i}`,
                description: typeof s.description === 'string' ? s.description : '',
                deps: toStringList(s.deps),
              }))
          : [],
        reasoning: typeof json.reasoning === 'string' ? json.reasoning : '',
      };

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

      // ═══ 会话 16d（P2 规划动态性·动态重规划）═══
      // 有硬失败步骤 + 未重规划 → 优先触发重新规划（带失败上下文），用新计划替换原计划（有界 replan=1）。
      if (stepFailures.size > 0 && !replanned) {
        const failuresText = [...stepFailures.entries()].map(([s, e]) => `${s}: ${e}`).join('；');
        const replanRes = await this.llm.generateText({ prompt: REPLAN_PROMPT(goal, resultsText, failuresText), temperature: 0 });
        this.opts.onTokenUsage?.(tokenCount(replanRes));
        chargeTokens(tokenCount(replanRes));
        const replanJson = replanRes ? extractJsonObject(replanRes.text) : null;
        if (!replanJson) throw new Error('[OrchestratorAgent] 重规划响应无法解析为 JSON');
        const replannedAnalysis = parseAnalysis(replanJson);
        replannedAnalysis.steps = capSteps(replannedAnalysis.steps);
        console.warn(`[OrchestratorAgent] 🔄 动态重规划（失败 ${stepFailures.size} 步）→ ${replannedAnalysis.steps.length} 步新计划`);
        if (orchSession && this.opts.sessionStore) {
          await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.replan', {
            failures: failuresText,
            steps: replannedAnalysis.steps,
            reasoning: replannedAnalysis.reasoning,
          });
        }
        steps = replannedAnalysis.steps;
        replanned = true;
        // 新计划取代旧计划：清除旧计划内的失败（避免误走 salvage；新计划失败会重新累积）
        for (const k of stepFailures.keys()) stepResults.delete(k);
        stepFailures.clear();
        continue; // 直接用新计划再执行一轮
      }

      if (audit.pass || audit.supplementaryTasks.length === 0) break;
      steps = capSteps(audit.supplementaryTasks); // fail → 补充任务再分发（受步骤 cap 约束）
    }

    // ── ③ 汇总 ──
    const resultsText = this.formatResults(stepResults);

    // ═══ 会话 15 P1-② 部分成功 salvage ═══
    // 存在硬失败步骤：显式 success=false + 基于成功步骤的降级交付物 + 失败原因报告。
    // （非静默——调用方看到 ok=false 与失败明细，而非伪装成功的降级输出）
    if (stepFailures.size > 0) {
      let partialOutput: unknown;
      try {
        const synth = await this.llm.generateText({ prompt: SYNTHESIS_PROMPT(goal, resultsText), temperature: 0 });
        this.opts.onTokenUsage?.(tokenCount(synth));
        chargeTokens(tokenCount(synth));
        partialOutput = synth?.text?.trim() ?? resultsText;
      } catch {
        partialOutput = resultsText;
      }
      if (orchSession && this.opts.sessionStore) {
        await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.synthesis', {
          outputPreview: previewText(partialOutput),
          partial: true,
        });
      }
      const failureReport = [...stepFailures.entries()].map(([step, error]) => ({ step, error }));
      const planQuality = {
        plannedSteps: analysis.steps.length,
        executedSteps: stepsExecuted,
        iterations,
        failedSteps: failureReport.length,
        replanned,
        success: false,
      };
      // ═══ 去黑盒化（黑盒⑨）：步骤结果内存态快照（失败路径）═══
      this.snapshotStepResults(goal, stepResults, stepFailures.size, stepsExecuted, iterations, replanned, false);
      return {
        success: false,
        output: partialOutput,
        iterations,
        stepsExecuted,
        auditLog,
        stepResults,
        stepSessions,
        failureReport,
        planQuality,
        sessionId: orchSession?.sessionId,
        sessionPath: orchSession?.path,
        error: `部分步骤失败（${failureReport.length}）：${failureReport[0].error}`,
        duration: Date.now() - start,
      };
    }

    // 正常路径：LLM 生成最终交付物（失败 → 抛错，fail loud）
    const synthRes = await this.llm.generateText({ prompt: SYNTHESIS_PROMPT(goal, resultsText), temperature: 0 });
    this.opts.onTokenUsage?.(tokenCount(synthRes));
    chargeTokens(tokenCount(synthRes));
    const finalOutput = synthRes?.text?.trim() ?? '';
    if (!finalOutput) {
      throw new Error('[OrchestratorAgent] 汇总 LLM 未产出交付物');
    }
    if (orchSession && this.opts.sessionStore) {
      await this.opts.sessionStore.appendCustom(orchSession.session, 'orchestration.synthesis', {
        outputPreview: previewText(finalOutput),
      });
      // ═══ T0 多轮连续④：最终交付物以 assistant 消息入账（下轮 resume 可见）═══
      await this.opts.sessionStore.appendMessage(orchSession.session, { role: 'assistant', content: previewText(finalOutput, 4000) });
    }

    const failed = [...stepResults.values()].length === 0;
    const planQuality = {
      plannedSteps: analysis.steps.length,
      executedSteps: stepsExecuted,
      iterations,
      failedSteps: stepFailures.size,
      replanned,
      success: !failed,
    };
    // ═══ 去黑盒化（黑盒⑨）：步骤结果内存态快照（正常路径）═══
    this.snapshotStepResults(goal, stepResults, stepFailures.size, stepsExecuted, iterations, replanned, !failed);
    return {
      success: !failed,
      output: finalOutput,
      iterations,
      stepsExecuted,
      auditLog,
      stepResults,
      stepSessions,
      planQuality,
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
  ): Promise<{ results: Map<string, unknown>; sessions: Map<string, string>; failures: Map<string, string> }> {
    const results = new Map<string, unknown>();
    const sessions = new Map<string, string>();
    const failures = new Map<string, string>();

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

    // 复杂任务：DAG 工具分发（nodeHandler 已接 step-agent + 上游成果注入）
    // ═══ 会话 15 P1-②：DAG 失败节点不抛错——收集进 failures（仍合并成功节点成果），run 返回显式部分成果 ═══
    if (this.opts.dagRuntime && steps.length > 1) {
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
      // 失败节点 → 收集进 failures（不伪装，不阻断成功节点成果）
      const dagMeta = dagResult as unknown as { success?: boolean; failedNodes?: number; errors?: Array<{ error?: string }>; nodeResults?: Map<string, unknown> };
      if (dagMeta.success === false || (typeof dagMeta.failedNodes === 'number' && dagMeta.failedNodes > 0)) {
        const failedCount = dagMeta.failedNodes ?? 0;
        const producedOutputs = dagMeta.nodeResults?.size ?? 0;
        // ═══ 16m·2 修复：failedNodes=0 且已有产物产出 → DAG 状态统计残留误判（节点非 failed 态但
        //     整体未判 success，如 skipped/pending 残留），任务实际已成功产出，不标记失败 ═══
        if (failedCount === 0 && producedOutputs > 0) {
          // 实际成功（有产物），不标记失败
        } else {
          const errText = dagMeta.errors?.[0]?.error ?? `${failedCount} 个节点失败`;
          failures.set('__dag__', errText);
        }
      }
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
      return { results, sessions, failures };
    }

    // 简单任务：单 step-agent 直跑（会话 3：简单任务不走 DAG；步骤失败 → 收集进 failures）
    if (steps.length === 1 && this.opts.stepExecutor) {
      const step = steps[0];
      const sess = await ensureStepSession(step);
      const r = await this.opts.stepExecutor.executeStep(
        { id: step.name, name: step.name, description: step.description, agentType: 'general' },
        new Map<string, unknown>(),
        { session: sess.session, sessionPath: sess.sessionPath, upstreamSessions: new Map(), gateContext: gateContext ?? undefined },
      );
      if (!r.success) {
        failures.set(step.name, r.error ?? '未知错误');
        results.set(step.name, { error: r.error });
      } else {
        results.set(step.name, r.output);
      }
      return { results, sessions, failures };
    }

    throw new Error('[OrchestratorAgent] 编排失败：复杂任务无 DAG 工具（dagRuntime 未注入）');
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

  /** ═══ 去黑盒化（黑盒⑨）：步骤结果内存态快照（L1 永久，重启可查）═══ */
  private snapshotStepResults(
    goal: string,
    stepResults: Map<string, unknown>,
    failedSteps: number,
    stepsExecuted: number,
    iterations: number,
    replanned: boolean,
    success: boolean,
  ): void {
    try {
      getSharedDeblackboxRecorder().recordStateSnapshot({
        name: 'orchestrator-step-results',
        trigger: 'orchestration-complete',
        state: {
          goal: goal.substring(0, 80),
          success,
          stepResultCount: stepResults.size,
          stepKeys: [...stepResults.keys()],
          failedSteps,
          stepsExecuted,
          iterations,
          replanned,
        },
      });
    } catch (err) {
      console.warn('[OrchestratorAgent] ⚠️ 步骤快照失败（忽略）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 17i.22：生成规划方案 markdown 文件（供前端展示/用户审阅），返回文件路径。 */
  private writePlanFile(planId: string, goal: string, analysis: { complexity?: string; steps: Array<{ name?: string; description?: string; deps?: string[] }>; reasoning?: string }): string {
    try {
      const dir = path.resolve('data/plans');
      fs.mkdirSync(dir, { recursive: true });
      const lines: string[] = [
        `# 规划方案（${planId}）`,
        '',
        `**目标**：${goal}`,
        `**复杂度**：${analysis.complexity ?? '未知'}`,
        `**生成时间**：${new Date().toLocaleString('zh-CN')}`,
        '',
        '## 执行步骤',
        '',
      ];
      analysis.steps.forEach((s, i) => {
        lines.push(`${i + 1}. **${s.name ?? '步骤'}**${s.deps?.length ? `（依赖: ${s.deps.join(', ')}）` : ''}`);
        if (s.description) lines.push(`   ${s.description}`);
        lines.push('');
      });
      if (analysis.reasoning) {
        lines.push('## 编排思路');
        lines.push('');
        lines.push(analysis.reasoning);
        lines.push('');
      }
      const file = path.join(dir, `${planId}.md`);
      fs.writeFileSync(file, lines.join('\n'), 'utf-8');
      return file;
    } catch (err) {
      console.warn('[OrchestratorAgent] ⚠️ 方案文件生成失败:', (err as Error).message);
      return `data/plans/${planId}.md`; // 兜底返回路径（文件可能未写入）
    }
  }
}
