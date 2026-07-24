/**
 * cognition/twin — Personal Twin Graph Barrel
 *
 * Phase 5 / MorPex v8: 个人孪生图谱模块统一导出。
 *
 * 导出：
 *   - PersonalTwinGraph: 孪生图谱主类
 *   - TwinNode/TwinEdge/TwinNodeType/TwinEdgeType: 核心类型
 *   - 属性类型：UserProperties, GoalProperties, ProjectProperties 等
 *   - 查询/统计类型：TwinQuery, TwinStats, DecisionProfile, TwinInsight
 */

// ── 主类 ──
export { PersonalTwinGraph } from './PersonalTwinGraph.js';

// ── Behavior Twin (Phase 2 / v8.6) ──
export { BehaviorTwin } from './BehaviorTwin.js';
export type { BehaviorProfile, VersionHistoryEntry, TwinVersion } from './BehaviorTwin.js';

// ── Preference Model (Phase 2 / v8.5) ──
export { PreferenceModel } from './PreferenceModel.js';
export type { Preference, PreferenceCategory, PreferenceStrength, PreferenceProfile } from './PreferenceModel.js';

// ── Planner Constraint (Phase 2 / v8.5) ──
export { buildPlannerConstraint } from './PlannerConstraint.js';
export type { PlannerConstraint } from './PlannerConstraint.js';

// ── 类型 ──
export type {
  TwinNodeType,
  TwinEdgeType,
  TwinNode,
  TwinEdge,
  UserProperties,
  GoalProperties,
  ProjectProperties,
  DecisionProperties,
  PreferenceProperties,
  WorkflowProperties,
  ExperienceProperties,
  TwinQuery,
  TwinStats,
  DecisionProfile,
  SubgraphResult,
  TwinInsight,
} from './types.js';

// ── Organization Twin (Phase 2) ──
export { OrganizationTwin } from './OrganizationTwin.js';
export type { OrgRole, OrgDecision } from './OrganizationTwin.js';
