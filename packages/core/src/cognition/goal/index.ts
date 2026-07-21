/**
 * cognition/goal — Goal Plane 统一出口
 *
 * Phase 1 / MorPex v8.5: 长期目标管理。
 *
 * 导出:
 *   GoalManager — 目标管理器 (门面)
 *   GoalGraph   — 目标层级图谱 (底层)
 *   Goal        — 目标数据类型
 *   all types   — 数据类型
 */

export { GoalManager } from './GoalManager.js';
export { GoalGraph } from './GoalGraph.js';
export type {
  Goal,
  GoalStatus,
  GoalLevel,
  Objective,
  KeyResult,
  GoalGraphNode,
  GoalCreateInput,
  GoalStats,
} from './types.js';
