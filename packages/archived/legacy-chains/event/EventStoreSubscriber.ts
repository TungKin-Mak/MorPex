/**
 * EventStoreSubscriber — EventStore 的事件订阅适配器（v2.4）
 *
 * 订阅 EventBus 上的 fsm.transition、tool.state_change 等事件，
 * 自动写入 EventStore JSONL 日志。
 *
 * 迁移：FSMEngine/ToolCallTracker 只发射事件，EventStore 独立订阅持久化。
 * 实现真正的关注点分离，双方不直接依赖。
 *
 * 变更记录：
 *   - v2.5: 替换空 catch 块，添加错误计数和告警。
 *     保持优雅降级（不因持久化失败导致系统崩溃）。
 */

import type { EventBus, MorPexEvent } from '../common/types.js';
import { EventStore } from './EventStore.js';

/**
 * EventStoreSubscriber — 事件溯源持久化订阅器
 *
 * @example
 * ```typescript
 * const subscriber = new EventStoreSubscriber(eventBus, eventStore);
 * subscriber.start();
 * // 系统运行中...
 * console.log(subscriber.getErrorCount()); // 查看持久化错误数
 * subscriber.stop(); // 关闭时取消订阅
 * ```
 */
export class EventStoreSubscriber {
  private unsubscribers: Array<() => void> = [];

  /** 持久化错误计数器 */
  private _persistenceErrorCount: number = 0;

  /** 持久化错误回调（用于监控/告警） */
  private _onError?: (error: Error, eventType: string) => void;

  constructor(
    private eventBus: EventBus,
    private eventStore: EventStore,
    options?: { onError?: (error: Error, eventType: string) => void },
  ) {
    this._onError = options?.onError;
  }

  /**
   * getErrorCount — 获取持久化错误累计次数
   */
  getErrorCount(): number {
    return this._persistenceErrorCount;
  }

  /**
   * resetErrorCount — 重置错误计数器
   */
  resetErrorCount(): void {
    this._persistenceErrorCount = 0;
  }

  /**
   * onError — 注册持久化错误回调
   */
  onError(callback: (error: Error, eventType: string) => void): void {
    this._onError = callback;
  }

  /**
   * start — 注册事件监听
   *
   * 订阅以下事件并持久化到 EventStore：
   *   - fsm.transition → FSM 状态转换
   *   - tool.state_change → 工具调用状态变化
   */
  start(): void {
    // 订阅 FSM 状态转换
    this.unsubscribers.push(
      this.eventBus.on('fsm.transition', (event: MorPexEvent) => {
        const p = event.payload as Record<string, unknown> | undefined;
        if (!p) return;
        this.eventStore.append({
          type: 'fsm_transition',
          taskId: (p.taskId as string) ?? '',
          from: (p.from as string) ?? '',
          to: (p.to as string) ?? '',
          ts: (p.timestamp as number) ?? Date.now(),
          execId: event.executionId,
        }).catch((err: Error) => {
          this._persistenceErrorCount++;
          console.error(`[EventStoreSubscriber] FSM 事件持久化失败: ${err.message}`, {
            eventType: 'fsm.transition',
            taskId: p.taskId,
            errorCount: this._persistenceErrorCount,
          });
          this._onError?.(err, 'fsm.transition');
        });
      }),
    );

    // 订阅工具调用状态变化
    this.unsubscribers.push(
      this.eventBus.on('tool.state_change', (event: MorPexEvent) => {
        const p = event.payload as Record<string, unknown> | undefined;
        if (!p) return;
        this.eventStore.append({
          type: 'tool_call_state_change',
          toolCallId: (p.toolCallId as string) ?? '',
          from: (p.from as string) ?? '',
          to: (p.to as string) ?? '',
          ts: (p.timestamp as number) ?? Date.now(),
          execId: event.executionId,
        }).catch((err: Error) => {
          this._persistenceErrorCount++;
          console.error(`[EventStoreSubscriber] 工具状态事件持久化失败: ${err.message}`, {
            eventType: 'tool.state_change',
            toolCallId: p.toolCallId,
            errorCount: this._persistenceErrorCount,
          });
          this._onError?.(err, 'tool.state_change');
        });
      }),
    );
  }

  /**
   * stop — 取消所有事件监听
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
