/**
 * UnifiedExecutionEngine — 统一执行引擎
 *
 * ═══ 会话 15 去兜底化重构：单编排主路径 ═══
 *
 * 历史：本引擎曾是多执行引擎路由（mission/dag/fabric 三路并存 + 复杂度路由 + 降级链）。
 * 会话 3 起多 Agent 编排（orchestrator）成为生产主路径（99 任务审计：executeViaMission/DAG
 * 生产 0 调用）；会话 15 用户授权"不考虑向后兼容/fallback"→ 移除全部旧路由与降级链。
 *
 * 现行执行路径（唯一）：
 *   execute() → executeAuto()
 *     ├─ 简单操作类 + 高置信原语 → 原语快路径（NL→参数提取 + DomainPrimitiveRegistry.execute）
 *     └─ 其余（生成类/复杂/无匹配）→ 总大脑编排（OrchestratorAgent：分析→step-agent→审计→汇总）
 *
 * Bounded Autonomy：编排迭代上限由 OrchestratorAgent.maxIterations 强制；token 成本由
 * CostController（execution.gate.token_usage 事件）追踪；timeoutMs 仅作可选防御包络。
 *
 * @packageDocumentation
 */

import { EventBus } from '../infrastructure/common/EventBus.js';
import { DepartmentContext } from '../governance/control-plane/DepartmentContext.js';
import { makeProgressEvent } from '../infrastructure/common/ProgressCallback.js';
import type { DepartmentId } from '../governance/control-plane/department-types.js';
import type { ProgressCallback } from '../infrastructure/common/ProgressCallback.js';
import { DomainPrimitiveRegistry } from '../infrastructure/tools/DomainPrimitiveRegistry.js';
// ═══ 去黑盒化（黑盒⑥ 执行路径记录）═══
import { getSharedDeblackboxRecorder } from '../infrastructure/observability/deblackbox/DeblackboxRecorder.js';

/**
 * 生成类原语判断：生成类（artifact_generation）用户要求"做东西"（报表/代码/文档）——内容由
 * step-agent 经总大脑编排生成；操作类（file/shell/api/knowledge）需明确参数，走原语快路径。
 */
function isGenerativePrimitive(name: string): boolean {
  return name === 'artifact_generation';
}

// ── Types ──

export type ExecutionMode = 'auto' | 'orchestrator';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutionRequest {
  /** 执行目标 */
  goal: string;
  /** 部门 ID */
  departmentId?: DepartmentId;
  /** 执行上下文 */
  context?: Record<string, unknown>;
  /** 超时（毫秒，可选防御；默认不设限——LLM 任务可能数小时） */
  timeoutMs?: number;
  /**
   * 会话 16c（3+4）：任务级自动重跑次数上限（默认 1）——retryable 失败（空参/瞬态，非安全拦截）
   * 时带上次失败上下文重跑；0 = 禁用。
   */
  maxTaskRerun?: number;
  /**
   * 会话 16d（P3 人机协同）：外部注入的上文提示（如人工修正意见 / 上次失败原因）——
   * 透传给 orchestrator 的分析阶段。
   */
  contextHint?: string;
  /** 任务 ID（可选） */
  taskId?: string;
  /** P1 部门 Space：部门经理 persona（编排器分析 prompt 注入；可选） */
  managerPersona?: string;
  /** P1 部门 Space：工位能力提示（可选；仅作参考，工位由 LLM 动态编排） */
  capabilities?: string[];
  /** T0 多轮连续：orchestrator 账本路径（存在时 resume 同一本账，多轮对话历史不丢） */
  orchestratorSessionPath?: string;
  /** 进度回调（Phase 4.6） */
  onProgress?: ProgressCallback;
}

export interface ExecutionResult {
  ok: boolean;
  executionId: string;
  mode: ExecutionMode;
  status: ExecutionStatus;
  output?: unknown;
  error?: string;
  duration: number;
  metrics?: Record<string, unknown>;
}

export interface EngineHealth {
  orchestrator: boolean;
  mode: ExecutionMode;
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════════
// 执行模块接口（松耦合，不直接引用具体类）
// ═══════════════════════════════════════════════════════════════════

export interface DAGRuntimeLike {
  execute(goal: string, tasks: unknown[], context?: Record<string, unknown>): Promise<{ executionId: string }>;
  getStatus(executionId: string): unknown;
  cancel(executionId: string): Promise<void>;
  readonly name: string;
}

/** OrchestratorAgentLike — 多 Agent 总大脑（会话 3）：编排 → 执行 → 审计（迭代）→ 汇总 */
export interface OrchestratorAgentLike {
  readonly name: string;
  run(goal: string, opts?: { departmentId?: string; contextHint?: string; managerPersona?: string; capabilities?: string[]; orchestratorSessionPath?: string }): Promise<{
    success: boolean;
    output?: unknown;
    iterations: number;
    stepsExecuted: number;
    auditLog: Array<{ iteration: number; pass: boolean; issues: string[]; reasoning: string }>;
    stepResults: Map<string, unknown>;
    /** 会话 15 P1-②：部分成功 salvage 失败报告 */
    failureReport?: Array<{ step: string; error: string }>;
    /** 会话 16d（P2 规划质量评估）：规划 vs 执行指标 */
    planQuality?: { plannedSteps: number; executedSteps: number; iterations: number; failedSteps: number; replanned: boolean; success: boolean };
    error?: string;
    duration: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// UnifiedExecutionEngine
// ═══════════════════════════════════════════════════════════════════

export class UnifiedExecutionEngine {
  name = 'UnifiedExecutionEngine';
  version = '3.0.0';

  private eventBus: EventBus;
  private orchestrator: OrchestratorAgentLike | null = null;
  private executionRecords: Map<string, ExecutionResult> = new Map();
  private engineCounter = 0;
  private startedAt = Date.now();

  /** 执行质量追踪（按模式统计成功/失败/延迟） */
  private executionQuality: Record<string, { success: number; total: number; avgDuration: number }> = {};

  /** NL→结构化参数提取钩子（简单操作类任务路由到原语时使用；bootstrap 注入） */
  private paramExtractor: ((goal: string, primitiveName: string, inputSchema: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[UnifiedExecutionEngine] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  /** 会话 3：注入总大脑（OrchestratorAgent）——现行唯一执行后端 */
  setOrchestratorAgent(orchestrator: OrchestratorAgentLike): void {
    this.orchestrator = orchestrator;
  }

  /**
   * setParamExtractor — 注入 NL→结构化参数提取器
   *
   * 简单操作类任务路由到原语时，将自然语言目标提取为符合原语 inputSchema 的参数。
   */
  setParamExtractor(extractor: (goal: string, primitiveName: string, inputSchema: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
    this.paramExtractor = extractor;
  }

  /**
   * isReady — 执行引擎是否就绪（总大脑已注入）
   */
  isReady(): boolean {
    return !!this.orchestrator;
  }

  // ═══════════════════════════════════════════════════════════════
  // 统一执行入口
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — 统一执行入口
   *
   * 现行单路径：executeAuto（简单操作类 → 原语快路径；其余 → 总大脑编排）。
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 设置部门上下文
    if (request.departmentId) {
      DepartmentContext.partitionKey(request.departmentId);
    }

    // 生成执行 ID
    const executionId = request.taskId || `exec_${++this.engineCounter}_${Date.now()}`;

    // 进度回调：开始执行
    request.onProgress?.(makeProgressEvent('task.started', `执行开始: ${request.goal.substring(0, 60)}`, 5, {
      taskId: executionId,
      departmentId: request.departmentId,
      metadata: { mode: 'auto' },
    }));

    // 发射执行开始事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'execution.engine.started',
      timestamp: Date.now(),
      executionId,
      source: 'unified-execution-engine',
      payload: {
        goal: request.goal,
        mode: 'auto',
        departmentId: request.departmentId,
      },
    });

    try {
      const result = await this.executeAuto(request, executionId);

      result.duration = Date.now() - startTime;
      result.executionId = executionId;

      // 记录
      this.executionRecords.set(executionId, result);

      // 进度回调：执行完成
      request.onProgress?.(makeProgressEvent(
        result.ok ? 'task.completed' : 'task.failed',
        result.ok ? `执行完成 (${result.duration}ms)` : `执行失败: ${result.error}`,
        100,
        { taskId: executionId, departmentId: request.departmentId },
      ));

      // 记录执行质量
      this.recordExecutionQuality(result.mode, result.ok, result.duration);

      // 产物创建由上层（MorPexRuntime）统一处理，Engine 不再创建

      // 发射执行完成事件
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: result.ok ? 'execution.engine.completed' : 'execution.engine.failed',
        timestamp: Date.now(),
        executionId,
        source: 'unified-execution-engine',
        payload: {
          goal: request.goal,
          mode: result.mode,
          ok: result.ok,
          duration: result.duration,
          error: result.error,
        },
      });

      return result;
    } catch (err) {
      const errorMsg = (err as Error).message;
      const failed: ExecutionResult = {
        ok: false,
        executionId,
        mode: 'auto',
        status: 'failed',
        error: errorMsg,
        duration: Date.now() - startTime,
      };

      this.executionRecords.set(executionId, failed);

      // 进度回调：执行异常
      request.onProgress?.(makeProgressEvent('task.failed', `执行异常: ${errorMsg}`, 100, {
        taskId: executionId, departmentId: request.departmentId,
        metadata: { error: errorMsg },
      }));

      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'execution.engine.failed',
        timestamp: Date.now(),
        executionId,
        source: 'unified-execution-engine',
        payload: { goal: request.goal, mode: 'auto', error: errorMsg },
      });

      return failed;
    }
  }

  /**
   * analyzeComplexity — 多维度任务复杂度分析
   *
   * 仅用于决策：简单操作类（可走原语快路径）vs 其余（走总大脑编排）。
   */
  private analyzeComplexity(request: ExecutionRequest): 'simple' | 'medium' | 'complex' {
    const goal = request.goal;
    const wordCount = goal.split(/\s+/).length;
    const charCount = goal.length;

    // 维度 1: 结构化提示检测
    const hasNumberedSteps = /\n\s*\d+\.\s/.test(goal);
    const hasBulletPoints = /\n\s*[-*]\s/.test(goal);
    const hasNewlines = goal.includes('\n');
    const hasMultiStepKeywords = /\bfirst\b|\bthen\b|\bfinally\b|\band\s+then\b|\bafter\s+that\b|\bstep\b|\bphase\b|\bstage\b/i.test(goal);

    // 维度 2: 能力需求检测
    const contextCaps = request.context?.requiredCapabilities;
    const hasMultipleCapabilities = Array.isArray(contextCaps) && contextCaps.length > 1;

    // 维度 3: 约束条件
    const hasConstraints = request.context?.constraints !== undefined
      || request.context?.budget !== undefined
      || request.context?.deadline !== undefined
      || request.departmentId !== undefined;

    // 多维度综合判断
    const structureScore = (hasNumberedSteps ? 2 : 0) + (hasBulletPoints ? 1 : 0) + (hasNewlines ? 1 : 0) + (hasMultiStepKeywords ? 1 : 0);
    const lengthScore = charCount > 500 ? 3 : charCount > 200 ? 2 : charCount > 80 ? 1 : 0;
    const capScore = hasMultipleCapabilities ? 2 : 0;
    const constraintScore = hasConstraints ? 1 : 0;
    const totalScore = structureScore + lengthScore + capScore + constraintScore;

    if (totalScore <= 2 && wordCount < 15) return 'simple';
    if (totalScore <= 5 && wordCount < 50) return 'medium';
    return 'complex';
  }

  /**
   * executeViaOrchestrator — 通过总大脑（多 Agent 编排）执行（会话 3，现行唯一执行后端）
   *
   * 总大脑分析复杂度 → 单 step-agent 或 DAG 分发 → LLM 审计（迭代）→ 汇总交付物。
   * timeoutMs 仅作可选防御包络（默认不设限——LLM 任务可能数小时）。
   */
  private async executeViaOrchestrator(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.orchestrator) {
      return {
        ok: false, executionId, mode: 'auto', status: 'failed',
        error: 'OrchestratorAgent 未注入', duration: 0,
      };
    }

    const startTime = Date.now();
    request.onProgress?.(makeProgressEvent('task.progress', `任务 → 多 Agent 编排（总大脑 + step-agent）`, 10, {
      taskId: executionId, departmentId: request.departmentId,
    }));

    try {
      // ═══ 会话 16c（3+4）：任务级自动重跑 ═══
      // retryable 失败（空参/瞬态，非安全拦截）→ 带上次失败上下文重跑一次（有界，默认 1 次）。
      const runOnce = async (contextHint?: string) => {
        const p = this.orchestrator!.run(request.goal, {
          departmentId: request.departmentId,
          contextHint,
          managerPersona: request.managerPersona,
          capabilities: request.capabilities,
          orchestratorSessionPath: request.orchestratorSessionPath,
        });
        return (request.timeoutMs && request.timeoutMs > 0)
          ? this.withTimeout(p, request.timeoutMs, `编排执行超时（${request.timeoutMs}ms）`)
          : p;
      };

      // 首跑带外部注入 hint（人工修正 / 重跑参考），自动重跑 hint 在内部覆盖
      let result = await runOnce(request.contextHint);
      let reran = false;
      const maxTaskRerun = request.maxTaskRerun ?? 1;
      if (!result.success && maxTaskRerun > 0 && result.failureReport && this.hasRetryableFailure(result.failureReport)) {
        const hint = `上次执行失败（仅作规避指引）：${result.failureReport.map(f => `${f.step}: ${f.error}`).join('；')}`;
        console.warn(`[UnifiedExecutionEngine] 🔁 任务级自动重跑（retryable 失败）…`);
        result = await runOnce(hint);
        reran = true;
      }

      // ═══ 会话 16d（P2 规划质量评估）：发射规划质量事件（规划步数 vs 实际/失败率）═══
      if (result.planQuality) {
        this.eventBus.emit({
          id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'evolution.planning.quality',
          timestamp: Date.now(),
          executionId,
          source: 'unified-execution-engine',
          payload: {
            goal: request.goal.slice(0, 120),
            ...result.planQuality,
          },
        });
      }

      return {
        ok: result.success,
        executionId,
        mode: 'orchestrator',
        status: result.success ? 'completed' : 'failed',
        output: result.output,
        error: result.error,
        duration: result.duration || (Date.now() - startTime),
        metrics: {
          iterations: result.iterations,
          stepsExecuted: result.stepsExecuted,
          audit: result.auditLog,
          // ⬅️ 会话 16c（3+4）：失败步骤报告透传（经验沉淀/观测消费）
          failureReport: result.failureReport,
          // ⬅️ 会话 16d（P2 规划质量）：规划 vs 执行指标透传
          planQuality: result.planQuality,
          // ⬅️ 会话 16c：是否经过任务级自动重跑
          ...(reran ? { reran: true } : {}),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false, executionId, mode: 'orchestrator', status: 'failed',
        error: msg, duration: Date.now() - startTime,
      };
    }
  }

  /** retryable 失败判定（非安全拦截——安全拦截重跑无效，不浪费成本） */
  private hasRetryableFailure(failureReport: Array<{ step: string; error: string }>): boolean {
    return failureReport.some(f => !/GateContextRequiredError|需要 Gate 凭证|安全拦截|权限不足/.test(f.error));
  }

  /**
   * executeAuto — 现行单路径执行
   *
   *   1. 简单操作类 + 高置信原语（非生成类）→ 原语快路径（NL→参数提取 + 原语执行）
   *   2. 其余（生成类 / 复杂 / 无匹配原语）→ 总大脑编排（唯一执行后端）
   *
   * ⚠️ Gate 凭证边界（Wave 8d）：原语快路径经 DomainPrimitiveRegistry.execute 调用原语时不携带
   * KnowledgeContextPackage。这是【有意的安全默认】（知识优先 + 副作用隔离）：
   *   - 只读原语缺凭证 → WARN 计数放行；破坏性原语（write/POST 等）→ GateContextRequiredError 硬拦截
   * 需要执行破坏性简单任务时须经 Ontology Gate 取得凭证（或走编排路径——orchestrator 已签发 Gate 凭证）。
   */
  private async executeAuto(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    const complexity = this.analyzeComplexity(request);

    // 简单操作类 + 高置信原语（非生成类）→ 原语快路径
    if (complexity === 'simple') {
      const primMatch = DomainPrimitiveRegistry.matchBest(request.goal);
      if (primMatch && primMatch.confidence >= 0.7 && !isGenerativePrimitive(primMatch.primitive.name)) {
        const primName = primMatch.primitive.name;
        request.onProgress?.(makeProgressEvent('task.progress', `匹配通用原语: ${primName} (${(primMatch.confidence * 100).toFixed(0)}%)`, 10, {
          taskId: executionId, departmentId: request.departmentId,
          metadata: { reason: primMatch.reason },
        }));
        // ═══ 去黑盒化（黑盒⑥）：执行路径留痕——原语快路径 ═══
        this.recordExecutionPath(request, executionId, 'primitive-fast', `复杂度=${complexity}，匹配原语 ${primName}（置信度 ${(primMatch.confidence * 100).toFixed(0)}%，非生成类）`);
        const primParams: Record<string, unknown> = { goal: request.goal, ...(request.context as Record<string, unknown>) };
        if (this.paramExtractor) {
          try {
            const extracted = await this.paramExtractor(
              request.goal,
              primName,
              (primMatch.primitive as { inputSchema?: Record<string, unknown> }).inputSchema ?? {},
            );
            Object.assign(primParams, extracted);
          } catch {
            // 提取失败不阻断，原语用 goal 透传兜底
          }
        }
        const primResult = await DomainPrimitiveRegistry.execute(
          primMatch.primitive.name,
          primParams,
          { departmentId: request.departmentId },
        );
        // ═══ 16m·2 修复：快路径破坏性原语被 Gate 硬拦（无凭证）→ 降级多 Agent 编排（编排会签发 Gate 凭证）═══
        //     GLM-4.7-Flash 等强模型在简单任务上会用 python3/git 等合法破坏性命令，快路径无凭证必拦；
        //     此类任务本应走编排路径（step-agent 已签发凭证），而非直接失败。
        if (!primResult.success && /Gate 硬拦|KnowledgeContextPackage|需要知识凭证/.test(primResult.error ?? '')) {
          console.warn(`[UnifiedExecutionEngine] 快路径 ${primName} 被 Gate 硬拦（${primResult.error}）→ 降级多 Agent 编排（签发凭证）`);
          // ═══ 去黑盒化（黑盒⑥）：执行路径留痕——快路径→编排降级 ═══
          this.recordExecutionPath(request, executionId, 'primitive-fast→orchestrator-downgrade', `快路径 ${primName} 被 Gate 硬拦（${primResult.error}），降级编排以签发凭证`);
          return this.executeViaOrchestrator(request, executionId);
        }
        return {
          ok: primResult.success,
          executionId,
          mode: 'auto',
          status: primResult.success ? 'completed' : 'failed',
          output: primResult.data,
          error: primResult.error,
          duration: 0,
        };
      }
    }

    // 其余（生成类 / 复杂 / 无匹配）→ 总大脑编排（唯一执行后端）
    request.onProgress?.(makeProgressEvent('task.progress', `任务 → 多 Agent 编排（总大脑）`, 10, {
      taskId: executionId, departmentId: request.departmentId,
      metadata: { complexity },
    }));
    // ═══ 去黑盒化（黑盒⑥）：执行路径留痕——编排路径 ═══
    this.recordExecutionPath(request, executionId, 'orchestrator', `复杂度=${complexity}${complexity === 'simple' ? '（简单但无高置信非生成原语匹配）' : '（复杂/生成类）'}，走总大脑多 Agent 编排`);
    return this.executeViaOrchestrator(request, executionId);
  }

  /** ═══ 去黑盒化（黑盒⑥）：执行路径决策记录（L1 决策单永久）——回答"为什么走这条路、为什么重试/降级" */
  private recordExecutionPath(
    request: ExecutionRequest,
    executionId: string,
    path: string,
    reason: string,
  ): void {
    try {
      getSharedDeblackboxRecorder().record({
        category: 'execution.path',
        source: 'unified-execution-engine',
        executionId,
        level: 'L1',
        summary: {
          goal: request.goal,
          path,
          complexity: this.analyzeComplexity(request),
          reason,
          departmentId: request.departmentId ?? null,
          decision: `执行路径: ${path}`,
          reasoning: reason,
        },
      });
    } catch (err) {
      console.warn('[UnifiedExecutionEngine] ⚠️ 执行路径记录失败（忽略）:', err instanceof Error ? err.message : String(err));
    }
  }

  /** 带超时的 Promise 执行（timeoutMs<=0/未设置 → 不设限；超时 → reject 由调用方转失败） */
  private async withTimeout<T>(p: Promise<T>, timeoutMs: number, msg: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(msg)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 执行质量追踪
  // ═══════════════════════════════════════════════════════════════

  /**
   * recordExecutionQuality — 记录执行质量
   */
  private recordExecutionQuality(mode: ExecutionMode, ok: boolean, duration: number): void {
    const q = this.executionQuality[mode] || { success: 0, total: 0, avgDuration: 0 };
    q.total++;
    if (ok) q.success++;
    q.avgDuration = q.total === 1 ? duration : (q.avgDuration * (q.total - 1) + duration) / q.total;
    this.executionQuality[mode] = q;
  }

  /**
   * getExecutionQuality — 获取各执行模式的质量统计
   */
  getExecutionQuality(): Record<string, { success: number; total: number; avgDuration: number; successRate: number }> {
    const result: Record<string, { success: number; total: number; avgDuration: number; successRate: number }> = {};
    for (const [mode, q] of Object.entries(this.executionQuality)) {
      result[mode] = { ...q, successRate: q.total > 0 ? q.success / q.total : 0 };
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // 状态查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getExecution — 获取执行记录
   */
  getExecution(executionId: string): ExecutionResult | undefined {
    return this.executionRecords.get(executionId);
  }

  /**
   * listExecutions — 列出执行记录
   *
   * @param limit - 最大条数（默认 20，最新的在前）
   */
  listExecutions(limit: number = 20): ExecutionResult[] {
    return [...this.executionRecords.values()]
      .sort((a, b) => b.duration - a.duration) // 按持续时间倒序
      .slice(0, limit);
  }

  /**
   * cancel — 取消执行（编排路径暂不支持运行时取消，返回 false）
   */
  async cancel(executionId: string): Promise<boolean> {
    const record = this.executionRecords.get(executionId);
    if (!record) return false;
    record.status = 'cancelled';
    return true;
  }

  /**
   * getHealth — 获取引擎健康状态
   */
  getHealth(): EngineHealth & { executionQuality: Record<string, { success: number; total: number; avgDuration: number; successRate: number }> } {
    return {
      orchestrator: !!this.orchestrator,
      mode: 'auto',
      uptime: Date.now() - this.startedAt,
      executionQuality: this.getExecutionQuality(),
    };
  }
}
