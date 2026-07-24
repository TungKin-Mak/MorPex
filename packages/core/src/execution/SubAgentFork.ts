/**
 * SubAgentFork — 无状态子 Agent 执行肢（Fleet）
 *
 * Phase 2 / 交付层
 *
 * 增强 Phase 0 的 ForkExecuteTool（单次 bash/JS 执行）为完整的
 * "子 Agent 舰队"管理：
 *   1. 创建临时子 Agent 执行任务（通过 fork）
 *   2. 子 Agent 有独立的 DepartmentContext 分区
 *   3. 执行完成后记忆快照自动写入部门 Memory
 *   4. 通过 EventBus 广播生命周期事件
 *   5. 支持超时、重试、并发控制
 *
 * 对比 ForkExecuteTool：
 *   - ForkExecuteTool：单次 bash/JS 代码执行（低级）
 *   - SubAgentFork：任务级子 Agent 舰队（高级抽象）
 *
 * 使用方式：
 *   const subAgent = new SubAgentFork(eventBus, executionFabric);
 *   const fleet = await subAgent.spawnFleet(deptId, tasks);
 *   const results = await subAgent.waitForFleet(fleet.id);
 */

import { EventBus } from '../common/EventBus.js';
import { DepartmentContext } from '../department/DepartmentContext.js';
import { makeProgressEvent } from '../common/ProgressCallback.js';
import type { DepartmentId } from '../department/types.js';
import type { ProgressCallback, ProgressEvent } from '../common/ProgressCallback.js';

// ── Types ──

export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
export type FleetStatus = 'spawning' | 'running' | 'all_completed' | 'partial_failed' | 'all_failed';

export interface SubAgentTask {
  id: string;
  description: string;
  capability: string;
  params: Record<string, unknown>;
  status: SubAgentStatus;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  timeoutMs: number;
  retryCount: number;
  maxRetries: number;
}

export interface SubAgentFleet {
  id: string;
  departmentId: DepartmentId;
  name: string;
  tasks: SubAgentTask[];
  status: FleetStatus;
  createdAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface FleetStats {
  totalFleets: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  timedOutTasks: number;
  activeFleets: number;
}

/**
 * ConnectorRegistryLike — ConnectorRegistry 的松耦合接口
 *
 * P3 修复：SubAgentFork 通过此接口直接调用 ConnectorRegistry，
 * 绕过 UnifiedExecutionEngine → ExecutionFabric 的 4 跳链路。
 */
export interface ConnectorRegistryLike {
  execute(request: { action: string; params: Record<string, unknown>; timeout?: number }): Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export interface SubAgentForkConfig {
  /** 默认超时（毫秒） */
  defaultTimeoutMs: number;
  /** 默认最大重试次数 */
  defaultMaxRetries: number;
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 是否开启记忆快照 */
  memorySnapshotEnabled: boolean;
}

const DEFAULT_CONFIG: SubAgentForkConfig = {
  defaultTimeoutMs: 120_000,
  defaultMaxRetries: 2,
  maxConcurrency: 5,
  memorySnapshotEnabled: true,
};

// ── SubAgentFork ──

export class SubAgentFork {
  name = 'SubAgentFork';
  version = '1.0.0';

  private eventBus: EventBus;
  private fleets: Map<string, SubAgentFleet> = new Map();
  private config: SubAgentForkConfig;
  private fleetCounter = 0;

  /**
   * 执行引擎引用（可选，Phase 2b 接入 UnifiedExecutionEngine）
   * 如果未传入，使用内置模拟执行（Phase 2 默认）
   */
  private executionEngine?: { execute: (capability: string, params: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown> };

  /**
   * ConnectorRegistry 引用（可选，P3 修复）
   * 直接调用 Connector 绕过 UEE+Fabric 的 4 跳链路
   */
  private connectorRegistry?: ConnectorRegistryLike;

  /** 每个 fleet 的进度回调（Phase 4.6：结构化进度） */
  private progressCallbacks: Map<string, ProgressCallback> = new Map();

  /** 工具质量追踪器（Phase 4.6：可选注入） */
  private toolQualityTracker?: { recordCall: (toolName: string, success: boolean, latencyMs: number, error?: string) => void };

  /** 支持直接 Connector 执行的能力列表 */
  private static readonly CONNECTOR_CAPABILITIES = [
    'fs', 'file', 'shell', 'bash', 'sh',
    'read', 'write', 'delete', 'list', 'mkdir', 'copy', 'move', 'stat',
    'git', 'npm', 'npx', 'node', 'python', 'pip',
  ];

  constructor(
    eventBus: EventBus,
    config?: Partial<SubAgentForkConfig>,
  ) {
    if (!eventBus) throw new Error('[SubAgentFork] EventBus 是必填参数');
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * setExecutionEngine — 设置执行引擎
   *
   * Phase 2b 接入 UnifiedExecutionEngine 后调用。
   * Phase 2a 使用内置模拟执行。
   */
  setExecutionEngine(engine: { execute: (capability: string, params: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown> }): void {
    this.executionEngine = engine;
  }

  /**
   * setConnectorRegistry — 注入 ConnectorRegistry
   *
   * P3 修复：SubAgentFork 可直接调用 Connector，
   * 绕过 UnifiedExecutionEngine → ExecutionFabric → ConnectorRegistry 的 4 跳链路。
   */
  setConnectorRegistry(registry: ConnectorRegistryLike): void {
    this.connectorRegistry = registry;
  }

  /**
   * setToolQualityTracker — 注入工具质量追踪器
   *
   * Phase 4.6: 记录每次任务执行的成败和延迟
   */
  setToolQualityTracker(tracker: { recordCall: (toolName: string, success: boolean, latencyMs: number, error?: string) => void }): void {
    this.toolQualityTracker = tracker;
  }

  // ═══════════════════════════════════════════════════════════════
  // Fleet 管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * spawnFleet — 创建子 Agent 舰队
   *
   * 将一组任务作为子 Agent 舰队派出执行。
   * 每个任务在一个隔离的 fork 中运行。
   *
   * @param departmentId - 部门 ID
   * @param tasks - 子任务列表
   * @param options - 舰队选项
   * @returns 创建的 Fleet
   */
  async spawnFleet(
    departmentId: DepartmentId,
    tasks: Array<{
      description: string;
      capability: string;
      params: Record<string, unknown>;
    }>,
    options?: {
      name?: string;
      timeoutMs?: number;
      maxRetries?: number;
      metadata?: Record<string, unknown>;
      /** 进度回调（Phase 4.6） */
      onProgress?: ProgressCallback;
    },
  ): Promise<SubAgentFleet> {
    const fleetId = `fleet_${++this.fleetCounter}_${Date.now()}`;
    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    const maxRetries = options?.maxRetries ?? this.config.defaultMaxRetries;

    const fleet: SubAgentFleet = {
      id: fleetId,
      departmentId,
      name: options?.name ?? `Fleet-${this.fleetCounter}`,
      tasks: tasks.map((t, i) => ({
        id: `task_${fleetId}_${i}`,
        description: t.description,
        capability: t.capability,
        params: t.params,
        status: 'pending',
        timeoutMs,
        retryCount: 0,
        maxRetries,
      })),
      status: 'spawning',
      createdAt: Date.now(),
      metadata: options?.metadata,
    };

    this.fleets.set(fleetId, fleet);

    // 发射舰队创建事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'sub_agent.fleet.created',
      timestamp: Date.now(),
      executionId: fleetId,
      source: 'sub-agent-fork',
      payload: {
        fleetId,
        departmentId,
        fleetName: fleet.name,
        taskCount: tasks.length,
      },
    });

    // 存储进度回调
    if (options?.onProgress) {
      this.progressCallbacks.set(fleetId, options.onProgress);
    }

    // 异步执行舰队（不 await，让调用方选择 waitForFleet）
    this.executeFleet(fleet).catch(err => {
      console.error(`[SubAgentFork] 舰队"${fleet.name}"执行异常:`, err);
    });

    return fleet;
  }

  /**
   * executeFleet — 执行舰队中的所有任务
   *
   * 内部方法。按并发限制调度任务。
   * 每个任务在 DepartmentContext 分区中执行。
   */
  private async executeFleet(fleet: SubAgentFleet): Promise<void> {
    fleet.status = 'running';

    const cb = this.progressCallbacks.get(fleet.id);
    cb?.(makeProgressEvent('task.started', `舰队"${fleet.name}"开始执行 (${fleet.tasks.length} 个子任务)`, 0, {
      taskId: fleet.id,
      departmentId: fleet.departmentId,
    }));

    // 按并发限制调度
    const concurrency = Math.min(this.config.maxConcurrency, fleet.tasks.length);
    const executing = new Set<Promise<void>>();

    for (const task of fleet.tasks) {
      // 等待，直到有空闲槽位
      while (executing.size >= concurrency) {
        await Promise.race(executing);
      }

      const promise = this.executeTask(fleet, task);
      executing.add(promise.then(() => { executing.delete(promise); }));
    }

    // 等待所有任务完成
    await Promise.allSettled([...executing]);
    // 清理残留的 promise 引用
    executing.clear();

    // 更新舰队状态
    const completed = fleet.tasks.filter(t => t.status === 'completed').length;
    const failed = fleet.tasks.filter(t => t.status === 'failed' || t.status === 'timed_out').length;
    const pct = fleet.tasks.length > 0 ? Math.round((completed / fleet.tasks.length) * 100) : 100;

    if (completed === fleet.tasks.length) {
      fleet.status = 'all_completed';
    } else if (failed === fleet.tasks.length) {
      fleet.status = 'all_failed';
    } else {
      fleet.status = 'partial_failed';
    }

    fleet.completedAt = Date.now();

    // 进度回调：舰队完成
    cb?.(makeProgressEvent('task.completed', `舰队"${fleet.name}"${fleet.status === 'all_completed' ? '全部完成' : '部分完成'} (${completed}/${fleet.tasks.length})`, pct, {
      taskId: fleet.id,
      departmentId: fleet.departmentId,
      metadata: { completed, failed, total: fleet.tasks.length, status: fleet.status },
    }));

    // 清理进度回调
    this.progressCallbacks.delete(fleet.id);

    // 发射舰队完成事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'sub_agent.fleet.completed',
      timestamp: Date.now(),
      executionId: fleet.id,
      source: 'sub-agent-fork',
      payload: {
        fleetId: fleet.id,
        departmentId: fleet.departmentId,
        status: fleet.status,
        completed,
        failed,
        total: fleet.tasks.length,
      },
    });
  }

  /**
   * executeTask — 执行单个子任务
   *
   * 执行路径：
   *   Phase 2a: 内置模拟执行
   *   Phase 2b: 通过 UnifiedExecutionEngine 执行
   *   Phase 3:  通过 ExecutionFabric + Connectors 执行
   */
  private async executeTask(fleet: SubAgentFleet, task: SubAgentTask): Promise<void> {
    const startTime = Date.now();
    const pctBase = fleet.tasks.findIndex(t => t.id === task.id);
    const totalTasks = fleet.tasks.length;
    const cb = this.progressCallbacks.get(fleet.id);

    task.status = 'running';
    task.startedAt = startTime;

    // 设置 DepartmentContext
    DepartmentContext.partitionKey(fleet.departmentId);

    // 进度回调：子任务开始
    const startPct = totalTasks > 0 ? Math.round((pctBase / totalTasks) * 100) : 0;
    cb?.(makeProgressEvent('subtask.spawned', `开始: ${task.description.substring(0, 60)}`, startPct, {
      taskId: task.id,
      departmentId: fleet.departmentId,
      metadata: { subTaskIndex: pctBase, totalTasks, capability: task.capability },
    }));

    // 发射任务开始事件
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'sub_agent.task.started',
      timestamp: startTime,
      executionId: fleet.id,
      source: 'sub-agent-fork',
      payload: {
        taskId: task.id,
        fleetId: fleet.id,
        departmentId: fleet.departmentId,
        description: task.description,
        capability: task.capability,
      },
    });

    try {
      // 执行任务（带超时）
      let result: unknown;

      // P3: 优先通过 ConnectorRegistry 直接执行（绕过 UEE+Fabric）
      if (this.connectorRegistry && this.isConnectorTask(task.capability)) {
        result = await this.withTimeout(
          this.executeViaConnector(task),
          task.timeoutMs,
        );
      }
      // Phase 2b+: 通过执行引擎
      else if (this.executionEngine) {
        result = await this.withTimeout(
          this.executionEngine.execute(task.capability, task.params, {
            departmentId: fleet.departmentId,
            fleetId: fleet.id,
            taskId: task.id,
          }),
          task.timeoutMs,
        );
      }
      // Phase 2a: 内置模拟执行
      else {
        result = await this.simulateExecution(task);
      }

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;

      // 进度回调：子任务完成
      const completedPct = totalTasks > 0 ? Math.round(((pctBase + 1) / totalTasks) * 100) : 100;
      cb?.(makeProgressEvent('subtask.completed', `完成: ${task.description.substring(0, 60)}`, completedPct, {
        taskId: task.id,
        departmentId: fleet.departmentId,
      }));

      // 工具质量追踪
      this.toolQualityTracker?.recordCall(
        `fleet:${task.capability}`,
        true,
        Date.now() - startTime,
      );

      // 记忆快照（可选）
      if (this.config.memorySnapshotEnabled) {
        this.snapshotTaskMemory(fleet.departmentId, task);
      }

      // 发射任务完成事件
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'sub_agent.task.completed',
        timestamp: Date.now(),
        executionId: fleet.id,
        source: 'sub-agent-fork',
        payload: {
          taskId: task.id,
          fleetId: fleet.id,
          departmentId: fleet.departmentId,
          duration: Date.now() - startTime,
        },
      });
    } catch (err) {
      const errorMsg = (err as Error).message;

      // 判断是否可重试
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        console.warn(`[SubAgentFork] 任务"${task.description}"重试 (${task.retryCount}/${task.maxRetries}): ${errorMsg}`);
        // 递归执行重试
        return this.executeTask(fleet, task);
      }

      // 判断是否超时
      task.status = errorMsg.includes('timeout') ? 'timed_out' : 'failed';
      task.error = errorMsg;

      // 进度回调：子任务失败
      const failPct = totalTasks > 0 ? Math.round(((pctBase + 1) / totalTasks) * 100) : 100;
      cb?.(makeProgressEvent('subtask.failed', `失败: ${task.description.substring(0, 60)}`, failPct, {
        taskId: task.id,
        departmentId: fleet.departmentId,
        metadata: { error: errorMsg, retryCount: task.retryCount },
      }));

      // 工具质量追踪（失败）
      this.toolQualityTracker?.recordCall(
        `fleet:${task.capability}`,
        false,
        Date.now() - startTime,
        errorMsg,
      );

      // 发射任务失败事件
      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'sub_agent.task.failed',
        timestamp: Date.now(),
        executionId: fleet.id,
        source: 'sub-agent-fork',
        payload: {
          taskId: task.id,
          fleetId: fleet.id,
          departmentId: fleet.departmentId,
          error: errorMsg,
          retryCount: task.retryCount,
          duration: Date.now() - startTime,
        },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // P3: Connector 直接执行
  // ═══════════════════════════════════════════════════════════

  /**
   * isConnectorTask — 判断任务是否可通过 Connector 直接执行
   *
   * 匹配规则：如果 capability 名称出现在 CONNECTOR_CAPABILITIES 列表中，
   * 或是常见 shell/文件操作动词，则走 Connector 直连路径。
   */
  private isConnectorTask(capability: string): boolean {
    const lower = capability.toLowerCase();
    return SubAgentFork.CONNECTOR_CAPABILITIES.some(c => lower.includes(c) || lower === c);
  }

  /**
   * executeViaConnector — 通过 ConnectorRegistry 直接执行
   *
   * 将 SubAgentTask 映射为 Connector 的 ActionRequest 并执行。
   * 如果 Connector 执行失败，抛出异常让 executeTask 走重试逻辑。
   */
  private async executeViaConnector(task: SubAgentTask): Promise<string> {
    if (!this.connectorRegistry) {
      throw new Error('ConnectorRegistry 未注入');
    }

    // 将 capability 映射为 connector action
    const action = this.mapCapabilityToAction(task.capability);

    const result = await this.connectorRegistry.execute({
      action,
      params: task.params,
      timeout: task.timeoutMs,
    });

    if (!result.success) {
      throw new Error(`Connector 执行失败: ${result.error ?? '未知错误'}`);
    }

    // 将结果序列化为字符串（与 executeTask 的返回类型一致）
    const output = typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data, null, 2);

    return `[Connector:${action}] ${output}`;
  }

  /**
   * mapCapabilityToAction — 将能力名映射为 Connector action
   *
   * shell/bash/sh → 'shell'
   * fs/file/read/write/delete/list/mkdir → 'fs'
   * git/npm/npx/node/python/pip → action 本身
   * 默认 → capability 本身
   */
  private mapCapabilityToAction(capability: string): string {
    const lower = capability.toLowerCase();
    if (['shell', 'bash', 'sh'].includes(lower)) return 'shell';
    if (['fs', 'file', 'read', 'write', 'delete', 'list', 'mkdir', 'copy', 'move', 'stat'].includes(lower)) return 'fs';
    return lower;
  }

  /**
   * simulateExecution — Phase 2a 内置模拟执行
   */
  private async simulateExecution(task: SubAgentTask): Promise<string> {
    // 模拟任务执行耗时（100-500ms）
    await new Promise(r => setTimeout(r, 100 + Math.random() * 400));
    return `[SubAgentFork] 任务"${task.description}"模拟执行完成`;
  }

  /**
   * withTimeout — 带超时的 Promise 包装
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`执行超时 (${ms}ms)`)), ms),
      ),
    ]);
  }

  /**
   * snapshotTaskMemory — 任务记忆快照
   *
   * 将任务结果快照写入部门 Memory 分区。
   * Phase 3 接入真实 MemoryCore。
   */
  private snapshotTaskMemory(departmentId: DepartmentId, task: SubAgentTask): void {
    // Phase 2: 通过 EventBus 发射记忆事件
    // Phase 3: 接入 MemoryCore.remember()
    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'memory.snapshot',
      timestamp: Date.now(),
      executionId: task.id,
      source: 'sub-agent-fork',
      payload: {
        departmentId,
        taskId: task.id,
        description: task.description,
        status: task.status,
        result: task.result,
        error: task.error,
        timestamp: Date.now(),
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * getFleet — 获取舰队信息
   */
  getFleet(fleetId: string): SubAgentFleet | undefined {
    return this.fleets.get(fleetId);
  }

  /**
   * waitForFleet — 等待舰队执行完成
   *
   * 轮询舰队状态直到 all_completed / all_failed / partial_failed。
   *
   * @param fleetId - 舰队 ID
   * @param pollIntervalMs - 轮询间隔（默认 100ms）
   * @param timeoutMs - 总超时（默认 300s）
   * @returns 完成的舰队
   */
  async waitForFleet(
    fleetId: string,
    pollIntervalMs: number = 100,
    timeoutMs: number = 300_000,
  ): Promise<SubAgentFleet> {
    const startTime = Date.now();

    while (true) {
      const fleet = this.fleets.get(fleetId);
      if (!fleet) throw new Error(`舰队 "${fleetId}" 不存在`);

      if (fleet.status === 'all_completed' || fleet.status === 'all_failed' || fleet.status === 'partial_failed') {
        return fleet;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`等待舰队 "${fleetId}" 超时 (${timeoutMs}ms)`);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  /**
   * listFleets — 列出舰队
   *
   * @param departmentId - 可选，按部门过滤
   */
  listFleets(departmentId?: DepartmentId): SubAgentFleet[] {
    const all = [...this.fleets.values()];
    return departmentId ? all.filter(f => f.departmentId === departmentId) : all;
  }

  /**
   * getStats — 获取统计
   */
  getStats(): FleetStats {
    let totalTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;
    let timedOutTasks = 0;
    let activeFleets = 0;

    for (const fleet of this.fleets.values()) {
      if (fleet.status === 'spawning' || fleet.status === 'running') activeFleets++;
      for (const task of fleet.tasks) {
        totalTasks++;
        if (task.status === 'completed') completedTasks++;
        if (task.status === 'failed') failedTasks++;
        if (task.status === 'timed_out') timedOutTasks++;
      }
    }

    return {
      totalFleets: this.fleets.size,
      totalTasks,
      completedTasks,
      failedTasks,
      timedOutTasks,
      activeFleets,
    };
  }

  /**
   * cancelFleet — 取消舰队（标记所有未完成的任务为 failed）
   */
  cancelFleet(fleetId: string): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    for (const task of fleet.tasks) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'failed';
        task.error = '舰队被取消';
      }
    }

    fleet.status = 'partial_failed';
    fleet.completedAt = Date.now();

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'sub_agent.fleet.cancelled',
      timestamp: Date.now(),
      executionId: fleetId,
      source: 'sub-agent-fork',
      payload: { fleetId, departmentId: fleet.departmentId },
    });

    return true;
  }
}
