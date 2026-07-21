/**
 * EventProjection — 事件投影：从事件流计算当前状态
 *
 * Phase 4 / MorPex v8.5: 纯函数集合。接受事件流，输出状态视图。
 * 不修改任何状态，无副作用。
 *
 * 核心原则:
 *   状态 = 投影(事件流)
 *   禁止: mission.state = "COMPLETED"
 *   必须: missionState = EventProjection.projectMission(missionId, events).currentState
 *
 * 使用方式:
 *   const proj = EventProjection.projectMission('mis_001', events);
 *   if (proj.currentState === 'COMPLETED') { ... }
 */

import type { BaseEvent } from '../BaseEvent.js';
import { EventType } from '../EventType.js';

// ── Mission 投影结果 ──

export interface MissionProjection {
  /** Mission ID */
  missionId: string;
  /** 当前状态（从事件流推导） */
  currentState: string;
  /** 计划步骤数 */
  planSteps: number;
  /** 已完成步骤数 */
  completedSteps: number;
  /** 审批状态 */
  approvalStatus: 'none' | 'pending' | 'approved' | 'denied';
  /** 验证评分（如果有） */
  verificationScore?: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 事件总数 */
  eventCount: number;
  /** 最后事件时间 */
  lastEventAt: number;
}

// ── 系统级投影 ──

export interface SystemProjection {
  /** 活跃 Mission 数 */
  activeMissions: number;
  /** 已完成 Mission 数 */
  completedMissions: number;
  /** 失败 Mission 数 */
  failedMissions: number;
  /** 待审批 Mission 数 */
  pendingApprovals: number;
  /** 事件总数 */
  totalEvents: number;
  /** 最后活动时间 */
  lastActivityAt: number;
  /** 按状态分组的 Mission 数 */
  missionsByState: Record<string, number>;
}

// ── EventProjection ──

export class EventProjection {
  /**
   * projectMission — 从事件流投影 Mission 状态
   *
   * 纯函数。扫描事件流，从 MISSION_CREATED → MISSION_COMPLETED/MISSION_FAILED
   * 推导出 Mission 的当前状态。
   *
   * @param missionId - Mission ID
   * @param events - 该 Mission 的事件流（按时间排序）
   * @returns MissionProjection
   */
  static projectMission(missionId: string, events: BaseEvent[]): MissionProjection {
    // 按时间排序（升序）
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    const result: MissionProjection = {
      missionId,
      currentState: 'CREATED',
      planSteps: 0,
      completedSteps: 0,
      approvalStatus: 'none',
      eventCount: sorted.length,
      lastEventAt: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : Date.now(),
    };

    for (const event of sorted) {
      switch (event.type) {
        case EventType.MISSION_CREATED: {
          const payload = event.payload as Record<string, unknown> || {};
          result.currentState = 'CREATED';
          result.startedAt = result.startedAt ?? event.timestamp;
          const planSteps = payload.planSteps;
          if (typeof planSteps === 'number') result.planSteps = planSteps;
          break;
        }

        case EventType.PLAN_CREATED: {
          result.currentState = 'PLANNING';
          const payload = event.payload as Record<string, unknown> || {};
          const steps = payload.steps;
          if (Array.isArray(steps)) result.planSteps = steps.length;
          break;
        }

        case EventType.EXECUTION_STARTED: {
          result.currentState = 'EXECUTING';
          break;
        }

        case EventType.NODE_COMPLETED: {
          result.completedSteps++;
          break;
        }

        case EventType.NODE_FAILED: {
          result.completedSteps = Math.max(0, result.completedSteps - 1);
          break;
        }

        case EventType.APPROVAL_REQUIRED: {
          result.currentState = 'WAIT_APPROVAL';
          result.approvalStatus = 'pending';
          break;
        }

        case EventType.APPROVAL_GRANTED: {
          result.approvalStatus = 'approved';
          result.currentState = 'EXECUTING';
          break;
        }

        case EventType.APPROVAL_DENIED: {
          result.approvalStatus = 'denied';
          result.currentState = 'CANCELLED';
          break;
        }

        case EventType.MISSION_COMPLETED: {
          result.currentState = 'COMPLETED';
          result.completedAt = event.timestamp;
          const payload = event.payload as Record<string, unknown> || {};
          const verificationScore = payload.verificationScore;
          if (typeof verificationScore === 'number') result.verificationScore = verificationScore;
          break;
        }

        case EventType.MISSION_FAILED: {
          result.currentState = 'FAILED';
          result.completedAt = event.timestamp;
          const payload = event.payload as Record<string, unknown> || {};
          const error = payload.error;
          if (typeof error === 'string') result.error = error;
          break;
        }

        case EventType.EXECUTION_CANCELLED: {
          result.currentState = 'CANCELLED';
          result.completedAt = event.timestamp;
          break;
        }

        case EventType.MISSION_UPDATED: {
          const payload = event.payload as Record<string, unknown> || {};
          const state = payload.newState || payload.toState;
          if (typeof state === 'string') result.currentState = state as string;
          break;
        }
      }
    }

    return result;
  }

  /**
   * projectSystem — 从全局事件流投影系统状态
   *
   * @param events - 全局事件流
   * @returns SystemProjection
   */
  static projectSystem(events: BaseEvent[]): SystemProjection {
    const missionsByState: Record<string, number> = {};
    const missionEvents = new Map<string, BaseEvent[]>();

    // 按 executionId 分组
    for (const event of events) {
      const existing = missionEvents.get(event.executionId);
      if (existing) existing.push(event);
      else missionEvents.set(event.executionId, [event]);
    }

    let activeMissions = 0;
    let completedMissions = 0;
    let failedMissions = 0;
    let pendingApprovals = 0;
    let lastActivityAt = 0;

    // 对每个 Mission 投影状态
    for (const [execId, evts] of missionEvents) {
      const proj = EventProjection.projectMission(execId, evts);

      missionsByState[proj.currentState] = (missionsByState[proj.currentState] ?? 0) + 1;

      if (proj.currentState === 'COMPLETED') completedMissions++;
      else if (proj.currentState === 'FAILED') failedMissions++;
      else if (proj.currentState !== 'CANCELLED') activeMissions++;

      if (proj.approvalStatus === 'pending') pendingApprovals++;

      if (proj.lastEventAt > lastActivityAt) lastActivityAt = proj.lastEventAt;
    }

    return {
      activeMissions,
      completedMissions,
      failedMissions,
      pendingApprovals,
      totalEvents: events.length,
      lastActivityAt,
      missionsByState,
    };
  }

  /**
   * validateStream — 检查事件流是否有效
   *
   * 验证状态转换顺序是否合法。
   *
   * @returns { valid, issues }
   */
  static validateStream(events: BaseEvent[]): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    let currentState = 'CREATED';

    const validNextStates: Record<string, string[]> = {
      CREATED:     ['PLANNING', 'CANCELLED'],
      PLANNING:    ['EXECUTING', 'FAILED', 'CANCELLED'],
      EXECUTING:   ['WAIT_APPROVAL', 'VERIFYING', 'FAILED', 'CANCELLED'],
      WAIT_APPROVAL: ['EXECUTING', 'CANCELLED'],
      VERIFYING:   ['COMPLETED', 'FAILED', 'EXECUTING'],
      COMPLETED:   [],
      FAILED:      [],
      CANCELLED:   [],
    };

    for (const event of sorted) {
      let nextState = currentState;

      switch (event.type) {
        case EventType.MISSION_CREATED:   nextState = 'CREATED'; break;
        case EventType.PLAN_CREATED:
        case EventType.MISSION_UPDATED: {
          const payload = event.payload as Record<string, unknown> || {};
          nextState = (payload.newState || payload.toState || currentState) as string;
          break;
        }
        case EventType.EXECUTION_STARTED:   nextState = 'EXECUTING'; break;
        case EventType.APPROVAL_REQUIRED:   nextState = 'WAIT_APPROVAL'; break;
        case EventType.APPROVAL_GRANTED:    nextState = 'EXECUTING'; break;
        case EventType.APPROVAL_DENIED:
        case EventType.EXECUTION_CANCELLED: nextState = 'CANCELLED'; break;
        case EventType.MISSION_COMPLETED:   nextState = 'COMPLETED'; break;
        case EventType.MISSION_FAILED:      nextState = 'FAILED'; break;
      }

      if (nextState !== currentState) {
        const allowed = validNextStates[currentState] || [];
        if (!allowed.includes(nextState)) {
          issues.push(
            `Invalid transition: ${currentState} → ${nextState} (event: ${event.type} @ ${event.timestamp})`
          );
        }
        currentState = nextState;
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * rebuildState — 从全局事件流重建所有 Mission 状态
   */
  static rebuildState(events: BaseEvent[]): Record<string, MissionProjection> {
    const executionGroups = new Map<string, BaseEvent[]>();

    for (const event of events) {
      const group = executionGroups.get(event.executionId);
      if (group) group.push(event);
      else executionGroups.set(event.executionId, [event]);
    }

    const result: Record<string, MissionProjection> = {};
    for (const [execId, evts] of executionGroups) {
      result[execId] = EventProjection.projectMission(execId, evts);
    }

    return result;
  }
}
