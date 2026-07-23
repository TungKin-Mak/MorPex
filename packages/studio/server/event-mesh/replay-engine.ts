/**
 * ReplayEngine — 事件重放引擎
 *
 * MorPex v10: 从事件存储中读取历史事件并重新 dispatch。
 * 支持按类型、Mission、时间范围筛选。
 * 用于故障恢复、状态重建、调试分析。
 */

import type { ReplayRequest, ReplayResult, ReplayError } from './types.js';
import type { EventBus } from '../../../core/src/common/EventBus.js';

// ── ReplayEngine ──

export class ReplayEngine {
  private bus: EventBus | null;
  private eventSource: () => Array<{ id: string; type: string; timestamp: number; executionId: string; source: string; payload: any }>;
  private startTime: number;

  constructor(
    bus: EventBus | null,
    eventSource: () => Array<{ id: string; type: string; timestamp: number; executionId: string; source: string; payload: any }>
  ) {
    this.bus = bus;
    this.eventSource = eventSource;
    this.startTime = Date.now();
  }

  /**
   * replay — 重放事件
   *
   * @param request - 重放请求参数
   * @returns ReplayResult
   */
  async replay(request: ReplayRequest): Promise<ReplayResult> {
    const startTime = Date.now();
    console.log(`[ReplayEngine] Starting replay: ${JSON.stringify(request)}`);

    // 1. 获取全部事件（从 eventSource）
    const allEvents = this.eventSource();
    console.log(`[ReplayEngine] Total events available: ${allEvents.length}`);

    // 2. 筛选
    let filtered = allEvents;

    if (request.eventTypes && request.eventTypes.length > 0) {
      filtered = filtered.filter(e => request.eventTypes!.includes(e.type));
    }

    if (request.missionId) {
      filtered = filtered.filter(e => e.executionId === request.missionId);
    }

    if (request.startTime) {
      filtered = filtered.filter(e => e.timestamp >= request.startTime!);
    }

    if (request.endTime) {
      filtered = filtered.filter(e => e.timestamp <= request.endTime!);
    }

    // 按时间排序
    filtered.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[ReplayEngine] Filtered events: ${filtered.length}`);

    // 3. 重放
    const errors: ReplayError[] = [];
    let processed = 0;

    for (const event of filtered) {
      if (!this.bus) {
        errors.push({ eventId: event.id, type: event.type, error: 'EventBus not available' });
        continue;
      }

      try {
        this.bus.emit({
          id: `replay_${event.id}`,
          type: event.type,
          timestamp: Date.now(),
          executionId: event.executionId,
          source: 'replay-engine',
          payload: {
            ...event.payload,
            __replayed: true,
            __originalId: event.id,
            __originalTimestamp: event.timestamp,
          },
        });
        processed++;
      } catch (err: any) {
        errors.push({
          eventId: event.id,
          type: event.type,
          error: err?.message || String(err),
        });
      }
    }

    const duration = Date.now() - startTime;
    const result: ReplayResult = {
      totalEvents: filtered.length,
      processed,
      failed: errors.length,
      duration,
      errors,
    };

    console.log(`[ReplayEngine] Replay complete: ${processed}/${filtered.length} processed, ${errors.length} failed, ${duration}ms`);
    return result;
  }

  /**
   * replayByMission — 按 Mission ID 重放
   */
  async replayByMission(missionId: string): Promise<ReplayResult> {
    return this.replay({ missionId });
  }

  /**
   * replayByType — 按事件类型重放
   */
  async replayByType(eventTypes: string[]): Promise<ReplayResult> {
    return this.replay({ eventTypes });
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number; elapsed: number } {
    return {
      ok: true,
      name: 'ReplayEngine',
      uptime: this.startTime,
      elapsed: Date.now() - this.startTime,
    };
  }
}
