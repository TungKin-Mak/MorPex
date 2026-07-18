/**
 * Scheduler Plugin — 全局调度器插件
 *
 * 将 SchedulerEngine 包装为 MorPexPlugin。
 * 通过 EventBus 接收任务、广播调度事件。
 *
 * 事件协议：
 *   - 监听: 'scheduler.enqueue'        ← 外部入队请求
 *   - 监听: 'scheduler.complete'       ← 任务完成回调
 *   - 监听: 'scheduler.fail'           ← 任务失败回调
 *   - 监听: 'scheduler.cancel'         ← 取消任务
 *   - 广播: 'scheduler.task_ready'     → 任务就绪，可执行
 *   - 广播: 'scheduler.task_completed' → 任务完成
 *   - 广播: 'scheduler.task_failed'    → 任务失败
 *   - 广播: 'scheduler.backpressure'   → 背压告警
 *   - 广播: 'scheduler.stats'          → 统计信息
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { SchedulerEngine } from './SchedulerEngine.js';
import type { SchedulerPluginConfig, SchedulerTask } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<SchedulerPluginConfig> = {
  engine: {},
};

/**
 * SchedulerPlugin — 全局调度器插件
 */
export class SchedulerPlugin implements MorPexPlugin {
  name = 'scheduler-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private engine!: SchedulerEngine;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<SchedulerPluginConfig>;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.scheduler ?? {}) as SchedulerPluginConfig;
    this.config = {
      engine: { ...DEFAULT_CONFIG.engine, ...(userConfig.engine ?? {}) },
    };

    this.engine = new SchedulerEngine(this.config.engine);

    // 引擎回调 → EventBus
    this.engine.onTaskReady = (task) => {
      this.emitEvent('scheduler.task_ready', {
        task,
        queueDepth: this.engine.queueDepth,
        runningCount: this.engine.runningCount,
      });
    };

    this.engine.onBackpressure = (level, queueDepth) => {
      this.emitEvent('scheduler.backpressure', { level, queueDepth });
    };

    this.engine.onStatsChanged = (stats) => {
      // 每 10 次变更广播一次，避免高频
      if (stats.totalEnqueued % 10 === 0) {
        this.emitEvent('scheduler.stats', { stats });
      }
    };

    this.initialized = true;
    console.log('[SchedulerPlugin] 已初始化');
    console.log(`  ├─ 最大并发: ${this.config.engine.maxConcurrent ?? 16}`);
    console.log(`  └─ 最大队列: ${this.config.engine.maxQueueDepth ?? 200}`);
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[SchedulerPlugin] 请在 start() 前调用 initialize()');
    }

    // 监听入队请求
    this.unsubscribers.push(
      this.eventBus.on('scheduler.enqueue', (event: MorPexEvent) => {
        const task = event.payload?.task as Omit<SchedulerTask, 'state' | 'createdAt'> | undefined;
        if (task?.id) {
          const result = this.engine.enqueue(task);
          if (result === 'rejected') {
            this.emitEvent('scheduler.task_rejected', { taskId: task.id, reason: '队列满' });
          }
        }
      }),
    );

    // 监听任务完成回调
    this.unsubscribers.push(
      this.eventBus.on('scheduler.complete', (event: MorPexEvent) => {
        const { taskId, result } = event.payload ?? {};
        if (taskId) {
          this.engine.completeTask(taskId, result);
          this.emitEvent('scheduler.task_completed', { taskId, result });
        }
      }),
    );

    // 监听任务失败回调
    this.unsubscribers.push(
      this.eventBus.on('scheduler.fail', (event: MorPexEvent) => {
        const { taskId, error } = event.payload ?? {};
        if (taskId) {
          this.engine.failTask(taskId, error ?? 'unknown');
          this.emitEvent('scheduler.task_failed', { taskId, error });
        }
      }),
    );

    // 监听取消请求
    this.unsubscribers.push(
      this.eventBus.on('scheduler.cancel', (event: MorPexEvent) => {
        const taskId = event.payload?.taskId;
        if (taskId) {
          const cancelled = this.engine.cancelTask(taskId);
          if (cancelled) {
            this.emitEvent('scheduler.task_cancelled', { taskId });
          }
        }
      }),
    );

    // 监听统计查询
    this.unsubscribers.push(
      this.eventBus.on('scheduler.get_stats', () => {
        this.emitEvent('scheduler.stats', { stats: this.engine.getStats() });
      }),
    );

    console.log('[SchedulerPlugin] 已启动，正在监听 scheduler.* 事件');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.engine.clear();
    console.log('[SchedulerPlugin] 已停止');
  }

  /** 直接入队（供外部代码调用） */
  enqueueTask(task: Omit<SchedulerTask, 'state' | 'createdAt'>): 'enqueued' | 'rejected' {
    return this.engine.enqueue(task);
  }

  /** 获取引擎实例 */
  getEngine(): SchedulerEngine {
    return this.engine;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'scheduler-plugin',
      source: 'scheduler-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
