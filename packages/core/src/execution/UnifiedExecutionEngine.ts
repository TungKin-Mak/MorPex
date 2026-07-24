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

import { EventBus } from '../common/EventBus.js';
import { DepartmentContext } from '../department/DepartmentContext.js';
import { makeProgressEvent } from '../common/ProgressCallback.js';
import type { DepartmentId } from '../department/types.js';
import type { ProgressCallback } from '../common/ProgressCallback.js';

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

  /** v13: 注册的 Action Executors */
  private actionExecutors: Map<string, ActionExecutorLike> = new Map();

  /** v14: ArtifactFacade 引用 */
  private artifactFacade: { createFromTask: (taskId: string, content: unknown, type: string) => Promise<unknown> } | null = null;

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
   * setArtifactFacade — 注入 ArtifactFacade（v14）
   * 执行成功后自动创建产物
   */
  setArtifactFacade(facade: { createFromTask: (taskId: string, content: unknown, type: string) => Promise<unknown> }): void {
    this.artifactFacade = facade;
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

      // v14: 执行成功时自动创建产物
      if (this.artifactFacade && result.ok) {
        this.artifactFacade.createFromTask(executionId, { goal: request.goal, output: result.output }, 'document')
          .catch(err => console.warn('[UnifiedExecutionEngine] 创建产物失败:', err));
      }

      // 记录执行质量
      this.recordExecutionQuality(mode, result.ok, result.duration);

      // v14: 执行成功 → 自动创建产物
      if (result.ok && this.artifactFacade) {
        this.artifactFacade.createFromTask(executionId, {
          goal: request.goal,
          output: result.output,
          mode,
        }, 'document').catch((err: Error) =>
          console.warn('[UnifiedExecutionEngine] 创建产物失败:', err.message)
        );
      }

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
   * Phase 4.6: 基于任务复杂度分析自动选择最佳模式
   *   - simple  → fabric（最快）
   *   - medium  → dag（并行）
   *   - complex → mission（完整 FSM 生命周期）
   */
  private resolveMode(request: ExecutionRequest): ExecutionMode {
    if (request.mode && request.mode !== 'auto') {
      return request.mode;
    }

    const complexity = this.analyzeComplexity(request);

    if (complexity === 'simple' && this.executionFabric) return 'fabric';
    if (complexity === 'medium' && this.dagRuntime) return 'dag';
    if (this.missionRuntime) return 'mission';
    if (this.dagRuntime) return 'dag';
    if (this.executionFabric) return 'fabric';

    return 'mission';
  }

  /**
   * analyzeComplexity — 分析任务复杂度
   *
   * 基于目标文本特征判断复杂度级别：
   *   - simple:   <10词，无双步骤指示
   *   - medium:   <30词或含多步暗示
   *   - complex:  ≥30词或含约束条件
   */
  private analyzeComplexity(request: ExecutionRequest): 'simple' | 'medium' | 'complex' {
    const goal = request.goal;
    const wordCount = goal.split(/\s+/).length;
    const hasMultiStep = /\n|1\.\s|2\.\s|first|then|finally|and\s+then|after\s+that|step|phase|stage/i.test(goal);
    const hasConstraints = request.context?.constraints !== undefined || request.departmentId !== undefined;

    if (wordCount < 10 && !hasMultiStep && !hasConstraints) return 'simple';
    if (wordCount < 30 && !hasMultiStep) return 'medium';
    return 'complex';
  }

  /**
   * executeViaMission — 通过 MissionRuntime 执行
   */
  private async executeViaMission(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.missionRuntime) {
      return {
        ok: false, executionId, mode: 'mission', status: 'failed',
        error: 'MissionRuntime 未注入', duration: 0,
      };
    }

    const result = await this.missionRuntime.start(request.goal, {
      ...request.context,
      departmentId: request.departmentId,
      executionId,
    });

    return {
      ok: true, executionId, mode: 'mission', status: 'running',
      output: result, duration: 0,
    };
  }

  /**
   * executeViaDAG — 通过 DAGRuntime 执行
   */
  private async executeViaDAG(request: ExecutionRequest, executionId: string): Promise<ExecutionResult> {
    if (!this.dagRuntime) {
      return {
        ok: false, executionId, mode: 'dag', status: 'failed',
        error: 'DAGRuntime 未注入', duration: 0,
      };
    }

    const result = await this.dagRuntime.execute(
      request.goal,
      [],
      { ...request.context, departmentId: request.departmentId, executionId },
    );

    return {
      ok: true, executionId, mode: 'dag', status: 'running',
      output: result, duration: 0,
    };
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
