/**
 * runtime/mission — Mission Runtime 模块统一入口
 *
 * Phase 3 / MorPex v8: 用户意图 → Mission → Plan → Execution 的核心编排。
 *
 * 导出:
 *   - MissionState:          业务级生命周期枚举（8 状态）
 *   - MISSION_VALID_TRANSITIONS: 有效转换映射
 *   - MissionRuntime:        运行时主引擎
 *   - MissionPlanner/MissionExecutor: 规划器/执行器接口
 *   - Mission/MissionPlan/PlanStep/MissionResult/MissionContext/MissionPermissions: 数据类型
 */

// ── 枚举 ──
export { MissionState, MISSION_VALID_TRANSITIONS } from './types.js';

// ── 运行时 ──
export { MissionRuntime } from './MissionRuntime.js';
export type { MissionPlanner, MissionExecutor, MissionRuntimeConfig } from './MissionRuntime.js';
export type {
  MissionStateTransitionEvent,
} from './types.js';

// ── 类型 ──
export type {
  Mission,
  MissionPlan,
  PlanStep,
  MissionResult,
  MissionContext,
  MissionPermissions,
} from './types.js';

// ── 适配器 (P0 架构完善) ──
export { MetaPlannerAdapter, DAGExecutorAdapter } from './adapters/index.js';
