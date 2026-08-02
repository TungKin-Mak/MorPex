/**
 * UnifiedExecutionEngine — 统一执行引擎（Facade）
 *
 * Phase 2 / 交付层
 *
 * 对外提供统一的执行入口，对内委托给三个现有执行模块:
 *   - MissionRuntime (24 状态 FSM)
 *   - DAGRuntime (DAG 调度)
 *   - ExecutionFabric (v11 Agent 能力解析 + Connector 调用)
 *
 * 设计原则：
 *   - Facade 模式：不修改现有模块，只在外部包裹统一 API
 *   - 根据执行模式（mode）自动路由到正确的引擎
 *   - 聚合状态查询：统一从三个引擎获取状态
 *
 * 执行模式：
 *   - 'mission': 标准 Mission 生命周期（FSM → DAG）
 *   - 'dag': 直接 DAG 执行（绕过 FSM）
 *   - 'fabric': 通过 ExecutionFabric 执行（Agent 级）
 *   - 'auto': 自动选择（默认）
 *
 * 使用方式：
 *   const engine = new UnifiedExecutionEngine(missionRuntime, dagRuntime, executionFabric);
 *   const result = await engine.execute({ goal: '优化登录模块', mode: 'auto' });
 *   const status = engine.getStatus(executionId);
 */

import { EventBus } from '../infrastructure/common/EventBus.js';
import { DepartmentContext } from '../governance/control-plane/DepartmentContext.js';
import { makeProgressEvent } from '../infrastructure/common/ProgressCallback.js';
import type { DepartmentId } from '../governance/control-plane/department-types.js';
import type { ProgressCallback } from '../infrastructure/common/ProgressCallback.js';
import { DomainPrimitiveRegistry } from '../infrastructure/tools/DomainPrimitiveRegistry.js';

// ── Types ──

export type ExecutionMode = 'mission' | 'dag' | 'fabric' | 'auto';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExecutionRequest {
  /** 执行目标 */
  goal: string;
  /** 执行模式 */
  mode?: ExecutionMode;
  /** 部门 ID */
  departmentId?: DepartmentId;
  /** 执行上下文 */
  context?: Record<string, unknown>;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** vNext+: Bounded Autonomy — 最大轮询/步骤迭代次数（默认 300） */
  maxIterations?: number;
  /** vNext+: Bounded Autonomy — Token 成本上限（可选，需配合成本钩子） */
  maxCostTokens?: number;
  /** 任务 ID（可选） */
  taskId?: string;
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
  missionRuntime: boolean;
  dagRuntime: boolean;
  executionFabric: boolean;
  mode: ExecutionMode;
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════════
// 执行模块接口（松耦合，不直接引用具体类）
// ═══════════════════════════════════════════════════════════════════

export interface MissionRuntimeLike {
  start(goal: string, context?: Record<string, unknown>): Promise<{ executionId: string }>;
  getStatus(executionId: string): unknown;
  cancel(executionId: string): Promise<void>;
  readonly name: string;
}

export interface DAGRuntimeLike {
  execute(goal: string, tasks: unknown[], context?: Record<string, unknown>): Promise<{ executionId: string }>;
  getStatus(executionId: string): unknown;
  cancel(executionId: string): Promise<void>;
  readonly name: string;
}

export interface ExecutionFabricLike {
  execute(capability: string, action: string, params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ success: boolean; error?: string; data?: unknown; duration: number }>;
  getFabricStatus(): Record<string, unknown>;
  readonly name: string;
}

/** ActionExecutorLike — v13: 真实世界执行器接口 */
export interface ActionExecutorLike {
  name: string;
  canHandle(goal: string): boolean;
  execute(params: Record<string, unknown>, context?: { departmentId?: string }): Promise<{ success: boolean; data?: unknown; error?: string; duration: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// UnifiedExecutionEngine
// ═══════════════════════════════════════════════════════════════════

export class UnifiedExecutionEngine {
  name = 'UnifiedExecutionEngine';
  version = '2.0.0';

  private eventBus: EventBus;
  private missionRuntime: MissionRuntimeLike | null = null;
  private dagRuntime: DAGRuntimeLike | null = null;
  private executionFabric: ExecutionFabricLike | null = null;
  private executionRecords: Map<string, ExecutionResult> = new Map();
  private engineCounter = 0;
  private startedAt = Date.now();

  // 执行质量追踪（按模式统计成功/失败/延迟）
  private executionQuality: Record<string, { success: number; total: number; avgDuration: number }> = {};

  /** vNext+: 可选成本钩子：每次迭代累计 Token 消耗 */
  private costRecorder: ((executionId: string, tokens: number) => void) | null = null;

  /** vNext+ 全功能实现：NL→结构化参数提取钩子（简单任务路由到原语时使用） */
  private paramExtractor: ((goal: string, primitiveName: string, inputSchema: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;

  /** vNext+: 每次执行的累计 Token 成本 */
  private executionCosts: Map<string, number> = new Map();

  /** v13: 注册的 Action Executors */
  private actionExecutors: Map<string, ActionExecutorLike> = new Map();

  /** v14: ArtifactFacade 引用 */
  private artifactFacade: { createFromTask: (taskId: string, content: unknown, type: string) => Promise<unknown>; } | null = null;

  constructor(eventBus: EventBus) {
    if (!eventBus) throw new Error('[UnifiedExecutionEngine] EventBus 是必填参数');
    this.eventBus = eventBus;
  }

  /**
   * setMissionRuntime — 注入 MissionRuntime 实现
   */
  setMissionRuntime(runtime: MissionRuntimeLike): void {
    this.missionRuntime = runtime;
  }

  /**
   * setDAGRuntime — 注入 DAGRuntime 实现
   */
  setDAGRuntime(runtime: DAGRuntimeLike): void {
    this.dagRuntime = runtime;
  }

  /**
   * setExecutionFabric — 注入 ExecutionFabric 实现
   */
  setExecutionFabric(fabric: ExecutionFabricLike): void {
    this.executionFabric = fabric;
  }

  /**
   * registerActionExecutor — 注册 Action Executor（v13）
   */
  registerActionExecutor(executor: ActionExecutorLike): void {
    this.actionExecutors.set(executor.name, executor);
    console.log(`[UnifiedExecutionEngine] ✅ ActionExecutor 已注册: ${executor.name}`);
  }

  /**
   * setCostRecorder — 注入成本记录钩子（vNext+ Bounded Autonomy）
   *
   * 每次迭代调用，累计 Token 消耗以触发 Cost Ceiling。
   */
  setCostRecorder(recorder: (executionId: string, tokens: number) => void): void {
    this.costRecorder = recorder;
  }

  /**
   * setParamExtractor — 注入 NL→结构化参数提取器（vNext+ 全功能实现）
   *
   * 简单任务路由到原语时，将自然语言目标提取为符合原语 inputSchema 的参数。
   */
  setParamExtractor(extractor: (goal: string, primitiveName: string, inputSchema: Record<string, unknown>) => Promise<Record<string, unknown>>): void {
    this.paramExtractor = extractor;
  }

  /**
   * setArtifactFacade — 注入 ArtifactFacade（v14）
   * 执行成功后自动创建产物
   */
  setArtifactFacade(facade: { createFromTask(taskId: string, content: unknown, type: string): Promise<unknown> }): void {
    this.artifactFacade = facade;
  }

  /**
   * getExecutionCost — 获取执行累计成本（vNext+）
   */
  getExecutionCost(executionId: string): number {
    return this.executionCosts.get(executionId) ?? 0;
  }

  /**
   * emitBudgetExceeded — 发射预算超限事件并返回失败结果（vNext+）
   */
  private emitBudgetExceeded(
    executionId: string,
    goal: string,
    mode: ExecutionMode,
    reason: string,
    duration: number,
  ): ExecutionResult {
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'execution.budget.exceeded',
      timestamp: Date.now(),
      executionId,
      source: 'unified-execution-engine',
      payload: { goal, mode, reason, duration },
    });
    return {
      ok: false,
      executionId,
      mode,
      status: 'failed',
      error: `[Bounded Autonomy] ${reason}`,
      duration,
      metrics: { reason, costTokens: this.getExecutionCost(executionId) },
    };
  }

  /**
   * isReady — 检查执行引擎是否就绪
   *
   * 至少需要一个执行引擎可用。
   */
  isReady(): boolean {
    return !!(this.missionRuntime || this.dagRuntime || this.executionFabric);
  }

  // ═══════════════════════════════════════════════════════════════
  // 统一执行入口
  // ═══════════════════════════════════════════════════════════════

  /**
   * execute — 统一执行入口
   *
   * 根据 executionMode 自动路由到正确的引擎：
   *   - 'mission' → MissionRuntime (标准 FSM 路径)
   *   - 'dag'     → DAGRuntime (直接 DAG 路径)
   *   - 'fabric'  → ExecutionFabric (Agent 级执行)
   *   - 'auto'    → 根据复杂度自动选择
   *
   * @param request - 执行请求
   * @returns 执行结果
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const mode = this.resolveMode(request);

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
      metadata: { mode },
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
        mode,
        departmentId: request.departmentId,
      },
    });

    try {
      let result: ExecutionResult;

      switch (mode) {
        case 'mission':
          result = await this.executeViaMission(request, executionId);
          break;
        case 'dag':
          result = await this.executeViaDAG(request, executionId);
          break;
        case 'fabric':
          result = await this.executeViaFabric(request, executionId);
          break;
        default:
          result = await this.executeAuto(request, executionId);
      }

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
      this.recordExecutionQuality(mode, result.ok, result.duration);

      // ⚠️ 产物创建由上层（MorPexRuntime）统一处理，Engine 不再创建
      // 见 MorPexRuntime.run() Phase 3: Artifact Creation

      // 发射执行完成事件
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: result.ok ? 'execution.engine.completed' : 'execution.engine.failed',
        timestamp: Date.now(),
        executionId,
        source: 'unified-execution-engine',
        payload: {
          goal: request.goal,
          mode,
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
        mode,
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
        payload: { goal: request.goal, mode, error: errorMsg },
      });

      return failed;
    }
  }

  /**
   * resolveMode — 智能决定执行模式
   *
   * ⭐ P0 升级：优先使用 GoalIntelligence 的分析结果（如果可用），
   *   否则使用多维度启发式判断替代纯词数正则。
   *
   * 判断维度：
   *   - simple  → fabric（最快）
   *   - medium  → dag（并行）
   *   - complex → mission（完整 FSM 生命周期）
   */
  private resolveMode(request: ExecutionRequest): ExecutionMode {
    if (request.mode && request.mode !== 'auto') {
      return request.mode;
    }

    const complexity = this.analyzeComplexity(request);

    // vNext+ 全功能实现：简单任务 + 高置信原语/ActionExecutor → 走 executeAuto
    // （原语优先于 fabric/LLM 生成，让第 6 层真正可执行）
    if (complexity === 'simple') {
      const primMatch = DomainPrimitiveRegistry.matchBest(request.goal);
      if (primMatch && primMatch.confidence >= 0.7) return 'auto';
      if (this.executionFabric) return 'fabric';
      if (this.dagRuntime) return 'dag';
    }

    if (complexity === 'medium' && this.dagRuntime) return 'dag';
    if (this.missionRuntime) return 'mission';
    if (this.dagRuntime) return 'dag';
    if (this.executionFabric) return 'fabric';

    return 'mission';
  }

  /**
   * analyzeComplexity — 多维度任务复杂度分析
   *
   * ⭐ P0 升级：从纯词数正则升级为多维度启发式：
   *   1. 目标文本长度（词数 + 字符数）
   *   2. 结构化提示（序号列表、换行分割）
   *   3. 能力需求（context 中的 requiredCapabilities）
   *   4. 约束条件（budget, deadline, quality）
   *
   * 仍然简单但不依赖单一词数阈值。
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
   * executeViaMission — 通过 MissionRuntime 执行
   *
   * ⭐ P0 修复：等待 Mission 完整生命周期，而非直接返回 status:'running'
   */
  private async executeViaMission(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.missionRuntime) {
      return {
        ok: false, executionId, mode: 'mission', status: 'failed',
        error: 'MissionRuntime 未注入', duration: 0,
      };
    }

    const startTime = Date.now();
    try {
      const result = await this.missionRuntime.start(request.goal, {
        ...request.context,
        departmentId: request.departmentId,
        executionId,
      });

      // 等待 Mission 生命周期完成
      const missionId = result.executionId;
      const maxWait = request.timeoutMs || 300000; // 默认 5 分钟
      const maxIterations = request.maxIterations ?? 300; // vNext+: 迭代上限
      const maxCostTokens = request.maxCostTokens; // vNext+: Token 成本上限
      let waited = 0;
      let iterations = 0;
      let costTokens = 0;
      const pollInterval = 1000;

      while (waited < maxWait) {
        // vNext+: Bounded Autonomy — 迭代/成本上限
        iterations++;
        costTokens += 1;
        this.executionCosts.set(missionId, costTokens);
        this.costRecorder?.(missionId, 1);
        if (maxCostTokens !== undefined && costTokens >= maxCostTokens) {
          return this.emitBudgetExceeded(missionId, request.goal, 'mission', `Cost ceiling reached (${costTokens}/${maxCostTokens} tokens)`, Date.now() - startTime);
        }
        if (iterations > maxIterations) {
          return this.emitBudgetExceeded(missionId, request.goal, 'mission', `Iteration cap reached (${iterations}/${maxIterations})`, Date.now() - startTime);
        }

        const status = this.missionRuntime.getStatus(missionId);
        if (!status) break;
        const state = (status as any).state;
        // 终态判断
        if (state === 'COMPLETED' || state === 'completed') {
          const duration = Date.now() - startTime;
          return {
            ok: true, executionId: missionId, mode: 'mission', status: 'completed',
            output: { missionId, state, result },
            duration,
          };
        }
        if (state === 'FAILED' || state === 'MISSION_FAILED' || state === 'CANCELLED' ||
            state === 'failed' || state === 'mission_failed' || state === 'cancelled') {
          const duration = Date.now() - startTime;
          return {
            ok: false, executionId: missionId, mode: 'mission', status: 'failed',
            error: `Mission ${missionId} ended with state: ${state}`,
            duration,
          };
        }
        await new Promise(r => setTimeout(r, pollInterval));
        waited += pollInterval;
      }

      // 超时（Wave 4：硬拦截 — 发 budget.exceeded 事件 + status failed，禁止静默返回 running）
      const duration = Date.now() - startTime;
      this.executionCosts.set(missionId, costTokens);
      return this.emitBudgetExceeded(
        missionId,
        request.goal,
        'mission',
        `执行超时 (${maxWait}ms)`,
        duration,
      );
    } catch (err) {
      return {
        ok: false, executionId, mode: 'mission', status: 'failed',
        error: (err as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * executeViaDAG — 通过 DAGRuntime 执行
   *
   * ⭐ P0 修复：等待 DAG 执行完成，而非直接返回 status:'running'
   */
  private async executeViaDAG(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.dagRuntime) {
      return {
        ok: false, executionId, mode: 'dag', status: 'failed',
        error: 'DAGRuntime 未注入', duration: 0,
      };
    }

    const startTime = Date.now();
    try {
      const result = await this.dagRuntime.execute(
        request.goal,
        [],
        { ...request.context, departmentId: request.departmentId, executionId },
      );

      // 等待 DAG 执行完成
      const dagExecutionId = result.executionId;
      const maxWait = request.timeoutMs || 300000;
      const maxIterations = request.maxIterations ?? 300; // vNext+: 迭代上限
      const maxCostTokens = request.maxCostTokens; // vNext+: Token 成本上限
      let waited = 0;
      let iterations = 0;
      let costTokens = 0;
      const pollInterval = 1000;

      while (waited < maxWait) {
        // vNext+: Bounded Autonomy — 迭代/成本上限
        iterations++;
        costTokens += 1;
        this.executionCosts.set(dagExecutionId, costTokens);
        this.costRecorder?.(dagExecutionId, 1);
        if (maxCostTokens !== undefined && costTokens >= maxCostTokens) {
          return this.emitBudgetExceeded(dagExecutionId, request.goal, 'dag', `Cost ceiling reached (${costTokens}/${maxCostTokens} tokens)`, Date.now() - startTime);
        }
        if (iterations > maxIterations) {
          return this.emitBudgetExceeded(dagExecutionId, request.goal, 'dag', `Iteration cap reached (${iterations}/${maxIterations})`, Date.now() - startTime);
        }

        const status = this.dagRuntime.getStatus(dagExecutionId);
        if (!status) break;
        const state = (status as any).state;
        if (state === 'completed' || state === 'COMPLETED') {
          return {
            ok: true, executionId: dagExecutionId, mode: 'dag', status: 'completed',
            output: result,
            duration: Date.now() - startTime,
          };
        }
        if (state === 'failed' || state === 'FAILED' || state === 'cancelled' || state === 'CANCELLED') {
          return {
            ok: false, executionId: dagExecutionId, mode: 'dag', status: 'failed',
            error: `DAG ${dagExecutionId} ended with state: ${state}`,
            duration: Date.now() - startTime,
          };
        }
        await new Promise(r => setTimeout(r, pollInterval));
        waited += pollInterval;
      }

      // 超时（Wave 4：硬拦截 — 发 budget.exceeded 事件 + status failed，与 mission 路径同口径）
      const duration = Date.now() - startTime;
      this.executionCosts.set(dagExecutionId, costTokens);
      return this.emitBudgetExceeded(
        dagExecutionId,
        request.goal,
        'dag',
        `执行超时 (${maxWait}ms)`,
        duration,
      );
    } catch (err) {
      return {
        ok: false, executionId, mode: 'dag', status: 'failed',
        error: (err as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * executeViaFabric — 通过 ExecutionFabric 执行
   */
  private async executeViaFabric(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.executionFabric) {
      return {
        ok: false, executionId, mode: 'fabric', status: 'failed',
        error: 'ExecutionFabric 未注入', duration: 0,
      };
    }

    const result = await this.executionFabric.execute(
      request.goal,
      request.goal,
      { ...request.context, departmentId: request.departmentId },
      { executionId },
    );

    return {
      ok: result.success, executionId, mode: 'fabric', status: result.success ? 'completed' : 'failed',
      output: result.data,
      error: result.error,
      duration: result.duration,
    };
  }

  /**
   * executeAuto — 基于复杂度自动选择执行路径
   */
  private async executeAuto(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    // v13: 优先检查是否有匹配的 ActionExecutor
    for (const executor of this.actionExecutors.values()) {
      if (executor.canHandle(request.goal)) {
        request.onProgress?.(makeProgressEvent('task.progress', `匹配 ActionExecutor: ${executor.name}`, 10, {
          taskId: executionId, departmentId: request.departmentId,
        }));
        const result = await executor.execute(
          { goal: request.goal, ...request.context as Record<string, unknown> },
          { departmentId: request.departmentId },
        );
        return {
          ok: result.success,
          executionId,
          mode: 'auto',
          status: result.success ? 'completed' : 'failed',
          output: result.data,
          error: result.error,
          duration: result.duration,
        };
      }
    }

    const complexity = this.analyzeComplexity(request);

    // vNext+ 全功能实现：第 6 层原语注册中心兜底（仅 simple 任务，避免复杂任务被通用原语误截）
    if (complexity === 'simple') {
      const primMatch = DomainPrimitiveRegistry.matchBest(request.goal);
      if (primMatch && primMatch.confidence >= 0.7) {
        request.onProgress?.(makeProgressEvent('task.progress', `匹配通用原语: ${primMatch.primitive.name} (${(primMatch.confidence * 100).toFixed(0)}%)`, 10, {
          taskId: executionId, departmentId: request.departmentId,
          metadata: { reason: primMatch.reason },
        }));
        const primParams: Record<string, unknown> = { goal: request.goal, ...(request.context as Record<string, unknown>) };
        // 全功能实现：用参数提取器把自然语言目标转成原语结构化参数（失败则回退 goal 透传）
        if (this.paramExtractor) {
          try {
            const extracted = await this.paramExtractor(
              request.goal,
              primMatch.primitive.name,
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

    // simple → fabric（最快路径）
    if (complexity === 'simple' && this.executionFabric) {
      request.onProgress?.(makeProgressEvent('task.progress', `简单任务 → Fabric 直连`, 10, {
        taskId: executionId, departmentId: request.departmentId,
        metadata: { complexity },
      }));
      return this.executeViaFabric(request, executionId);
    }

    // medium → dag（并行路径）
    if (complexity === 'medium' && this.dagRuntime) {
      request.onProgress?.(makeProgressEvent('task.progress', `中等任务 → DAG 并行`, 10, {
        taskId: executionId, departmentId: request.departmentId,
        metadata: { complexity },
      }));
      return this.executeViaDAG(request, executionId);
    }

    // complex → mission（完整 FSM 生命周期）
    if (this.missionRuntime) {
      request.onProgress?.(makeProgressEvent('task.progress', `复杂任务 → Mission FSM`, 10, {
        taskId: executionId, departmentId: request.departmentId,
        metadata: { complexity },
      }));
      return this.executeViaMission(request, executionId);
    }

    // 降级路径
    if (this.executionFabric) return this.executeViaFabric(request, executionId);
    if (this.dagRuntime) return this.executeViaDAG(request, executionId);
    if (this.missionRuntime) return this.executeViaMission(request, executionId);

    return {
      ok: false, executionId, mode: 'auto', status: 'failed',
      error: '没有可用的执行引擎。请至少注入 MissionRuntime / DAGRuntime / ExecutionFabric 之一',
      duration: 0,
    };
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
   * cancel — 取消执行
   *
   * 委托到对应的执行引擎。
   */
  async cancel(executionId: string): Promise<boolean> {
    const record = this.executionRecords.get(executionId);
    if (!record) return false;

    try {
      switch (record.mode) {
        case 'mission':
          if (this.missionRuntime) await this.missionRuntime.cancel(executionId);
          break;
        case 'dag':
          if (this.dagRuntime) await this.dagRuntime.cancel(executionId);
          break;
        // fabric 执行是同步的，不需要取消
      }
      record.status = 'cancelled';
      return true;
    } catch {
      return false;
    }
  }

  /**
   * getHealth — 获取引擎健康状态
   */
  getHealth(): EngineHealth & { executionQuality: Record<string, { success: number; total: number; avgDuration: number; successRate: number }> } {
    return {
      missionRuntime: !!this.missionRuntime,
      dagRuntime: !!this.dagRuntime,
      executionFabric: !!this.executionFabric,
      mode: 'auto',
      uptime: Date.now() - this.startedAt,
      executionQuality: this.getExecutionQuality(),
    };
  }
}
