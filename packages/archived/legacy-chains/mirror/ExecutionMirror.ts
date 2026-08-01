/**
 * ExecutionMirror — 镜像主控
 *
 * 职责：
 *   协调订阅 → 映射 → 存储的全流程。
 *   作为 observer 存在，不拦截、不修改、不影响执行路径。
 *
 * 设计约束：
 *   - Mirror 是 observer，不是 controller
 *   - 不阻塞主执行路径
 *   - 所有 runtime.* 事件都被记录
 *
 * 订阅的事件命名空间：
 *   - runtime.tool.*   — 工具调用
 *   - runtime.agent.*  — Agent 生命周期
 *   - runtime.task.*   — 任务状态
 *   - runtime.plan.*   — 规划事件
 *   - runtime.dag.*    — DAG 事件
 *   - runtime.unknown  — 未匹配事件（也记录）
 */

import type { MorPexEvent, ExecutionTrace, ContextSnapshot, MirrorRecord, MirrorStats } from '../common/types.js';
import type { MirrorStorage } from './storage/types.js';

/** 镜像订阅的事件命名空间模式 */
const SUBSCRIBED_PATTERNS = [
  'runtime.tool.*',
  'runtime.agent.*',
  'runtime.task.*',
  'runtime.plan.*',
  'runtime.dag.*',
  'runtime.execution.*',
  'runtime.unknown',
];

/**
 * ExecutionMirror — 镜像主控
 *
 * 订阅 EventBus 的 runtime.* 事件，
 * 写入 MirrorStorage。
 */
export class ExecutionMirror {
  private storage: MirrorStorage;
  private unsubscribers: Array<() => void> = [];
  private running: boolean = false;
  private stats: MirrorStats = {
    totalExecutions: 0,
    totalEvents: 0,
    totalSnapshots: 0,
    storageSizeBytes: 0,
    errorCount: 0,
  };

  constructor(
    storage: MirrorStorage,
  ) {
    this.storage = storage;
  }

  /**
   * 订阅 EventBus 事件（通过 subscribeFn 完成）
   *
   * @param subscribeFn - 外部提供的订阅函数，用于访问 EventBus
   */
  start(subscribeFn: (type: string, handler: (event: MorPexEvent) => void) => () => void): void {
    if (this.running) return;
    this.running = true;

    // 订阅所有 runtime 命名空间（使用通配符）
    for (const pattern of SUBSCRIBED_PATTERNS) {
      const unsub = subscribeFn(pattern, (event: MorPexEvent) => {
        this.handleEvent(event).catch(err => {
          console.error(`[ExecutionMirror] 事件处理错误:`, err);
          this.stats.errorCount++;
        });
      });
      this.unsubscribers.push(unsub);
    }

    console.log('[ExecutionMirror] 已启动，订阅模式:', SUBSCRIBED_PATTERNS.join(', '));
  }

  /**
   * 停止镜像，取消所有订阅
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.running = false;
    console.log('[ExecutionMirror] 已停止');
  }

  /**
   * 处理收到的 MorPexEvent
   *
   * 1. 作为 event 记录到存储
   * 2. 如果是 agent.started/completed/failed，同时记录执行轨迹
   * 3. 如果事件包含上下文快照，记录快照
   */
  private async handleEvent(event: MorPexEvent): Promise<void> {
    // 1. 记录事件
    const eventRecord: MirrorRecord = {
      type: 'event',
      data: event,
    };
    await this.storage.append(eventRecord);
    this.stats.totalEvents++;

    // 2. 如果是 agent 生命周期事件，记录执行轨迹
    if (event.type.startsWith('runtime.agent.')) {
      await this.recordExecutionTrace(event);
    }

    // 3. 如果事件包含快照数据，记录快照
    if (event.payload?.snapshot || event.payload?.contextSnapshot) {
      await this.recordContextSnapshot(event);
    }
  }

  /**
   * 记录执行轨迹
   */
  private async recordExecutionTrace(event: MorPexEvent): Promise<void> {
    const payload = event.payload ?? {};

    const trace: ExecutionTrace = {
      executionId: event.executionId,
      runtime: event.source,
      status: this.getStatusFromEventType(event.type),
      startedAt: payload.timestamp ?? event.timestamp,
      endedAt: event.type === 'runtime.agent.completed' || event.type === 'runtime.agent.failed'
        ? Date.now() : undefined,
      agentRole: payload.agentRole ?? payload.sessionId ?? 'unknown',
      input: payload.input,
      output: payload.response ?? payload.output,
      error: payload.error,
    };

    const traceRecord: MirrorRecord = {
      type: 'execution',
      data: trace,
    };

    await this.storage.append(traceRecord);
    this.stats.totalExecutions++;
  }

  /**
   * 记录上下文快照
   */
  private async recordContextSnapshot(event: MorPexEvent): Promise<void> {
    const snapshotData = event.payload?.snapshot ?? event.payload?.contextSnapshot ?? {};

    const snapshot: ContextSnapshot = {
      executionId: event.executionId,
      snapshotType: event.type === 'runtime.agent.failed' ? 'error'
        : event.type === 'runtime.agent.started' ? 'before' : 'after',
      systemPrompt: snapshotData.systemPrompt,
      taskInput: snapshotData.taskInput ?? event.payload?.input,
      toolResults: snapshotData.toolResults ?? [],
      timestamp: Date.now(),
    };

    const snapshotRecord: MirrorRecord = {
      type: 'snapshot',
      data: snapshot,
    };

    await this.storage.append(snapshotRecord);
    this.stats.totalSnapshots++;
  }

  /**
   * 从事件类型推断执行状态
   */
  private getStatusFromEventType(type: string): string {
    if (type.endsWith('.started')) return 'running';
    if (type.endsWith('.completed')) return 'completed';
    if (type.endsWith('.failed')) return 'failed';
    return 'unknown';
  }

  /**
   * 获取镜像统计
   */
  getStats(): MirrorStats {
    // 合并存储统计和内存统计
    const storageStats = this.storage.getStats();
    return {
      totalExecutions: this.stats.totalExecutions,
      totalEvents: this.stats.totalEvents,
      totalSnapshots: this.stats.totalSnapshots,
      storageSizeBytes: storageStats.storageSizeBytes,
      errorCount: this.stats.errorCount,
    };
  }

  /**
   * 查询执行数据
   */
  async query(executionId: string): Promise<MirrorRecord[]> {
    return this.storage.query(executionId);
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }
}
