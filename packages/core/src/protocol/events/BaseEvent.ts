/**
 * MorPex Event Protocol — Base Event Interface
 *
 * Phase 1 / MorPex v8: 系统中所有事件的基础接口。
 *
 * BaseEvent 定义了事件的最小通用结构：
 *   - id:         唯一标识（evt_{YYYYMMDD}_{shortUUID}）
 *   - type:       标准事件类型（EventType 枚举或扩展字符串）
 *   - timestamp:   时间戳（Date.now()）
 *   - executionId: 关联执行 ID（始终必填）
 *   - source:      事件来源组件
 *   - payload:     事件负载数据
 *
 * 与现有 MorPexEvent 的关系：
 *   BaseEvent 是正式协议层接口。
 *   MorPexEvent（common/types.ts）保持向后兼容。
 *   新代码应使用 BaseEvent，旧代码逐步迁移。
 *
 * 使用方式：
 *   import type { BaseEvent } from './BaseEvent.js';
 *   import { EventType } from './EventType.js';
 *
 *   const event: BaseEvent = {
 *     id: 'evt_20260720_a1b2c3d4',
 *     type: EventType.MISSION_CREATED,
 *     timestamp: Date.now(),
 *     executionId: 'exe_20260720_e5f6g7h8',
 *     source: 'mission-runtime',
 *     payload: { missionId: 'mis_...', goal: '准备投资人会议' },
 *   };
 */

import { EventType } from './EventType.js';

/**
 * BaseEvent — 系统事件基础接口
 *
 * 所有事件必须符合此结构。
 * type 字段支持 EventType 枚举值或自定义扩展字符串。
 */
export interface BaseEvent {
  /** 唯一事件 ID（格式：evt_{YYYYMMDD}_{shortUUID}） */
  id: string;

  /** 标准事件类型（EventType 枚举）或扩展字符串 */
  type: EventType | string;

  /** 事件时间戳（Date.now()） */
  timestamp: number;

  /** 关联执行 ID（始终必填，kernel 事件使用 'kernel'） */
  executionId: string;

  /** 事件来源组件名称（如 'kernel', 'mission-runtime', 'dag-runtime'） */
  source: string;

  /** 事件负载数据 */
  payload: Record<string, unknown>;
}

/**
 * 判断事件类型是否为标准 EventType
 *
 * 用于区分标准事件与自定义扩展事件。
 *
 * @param type - 事件类型字符串
 * @returns 如果是标准 EventType 枚举值则返回 true
 */
export function isStandardEvent(type: string): type is EventType {
  return Object.values(EventType).includes(type as EventType);
}

/**
 * 判断事件是否属于指定架构层
 *
 * @param event - 事件对象
 * @param layer - 层名称（如 'mission', 'execution', 'control'）
 * @returns 如果事件属于该层则返回 true
 */
export function isEventInLayer(
  event: { type: EventType | string },
  layer: string
): boolean {
  if (typeof event.type !== 'string') return false;
  return event.type.startsWith(`${layer}.`);
}

/**
 * 从事件中提取层名称
 * 例如：'mission.created' → 'mission'
 *
 * @param type - 事件类型
 * @returns 层名称，如果无法解析则返回 'unknown'
 */
export function extractEventLayer(type: string): string {
  const dotIndex = type.indexOf('.');
  return dotIndex === -1 ? 'unknown' : type.substring(0, dotIndex);
}
