/**
 * Goal Plane — 数据类型定义
 *
 * Phase 1 / MorPex v8.5: 用户长期目标管理。
 *
 * Goal 位于 Mission 之上:
 *   Life Goal → Objective → Project → Mission → Task
 *
 * GoalManager 管理 Goal 的完整生命周期,
 * GoalGraph 维护层级关系,
 * ObjectiveTracker 追踪关键结果 (OKR-style)。
 */

// ── GoalStatus — 目标状态 ──

export type GoalStatus = 'active' | 'completed' | 'paused' | 'abandoned';

// ── GoalLevel — 目标层级 ──

export type GoalLevel = 'life' | 'objective' | 'project' | 'milestone';

// ── Goal — 长期目标 ──

export interface Goal {
  /** 唯一标识 gol_{timestamp}_{shortUUID} */
  id: string;
  /** 目标名称 */
  name: string;
  /** 详细描述 */
  description: string;
  /** 层级: life > objective > project > milestone */
  level: GoalLevel;
  /** 优先级 0-100, 越高越重要 */
  priority: number;
  /** 状态 */
  status: GoalStatus;
  /** 父目标 ID (层级树) */
  parentGoalId?: string;
  /** 子目标 ID 列表 */
  childrenIds: string[];
  /** 关联的 Mission ID 列表 */
  linkedMissionIds: string[];
  /** 进度 0-100, 从子目标/Missions 自动计算 */
  progress: number;
  /** 截止日期 (epoch ms) */
  deadline?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

// ── KeyResult — 关键结果 (OKR-style) ──

export interface KeyResult {
  id: string;
  description: string;
  target: number;
  current: number;
  unit: string;  // '%', 'count', 'dollars', 'days', etc.
}

// ── Objective — 目标下的可量化目标 ──

export interface Objective {
  id: string;
  goalId: string;
  description: string;
  keyResults: KeyResult[];
  deadline?: number;
  progress: number;  // 0-100, keyResults 平均值
  status: 'active' | 'completed' | 'failed';
  createdAt: number;
}

// ── GoalGraphNode — 树形渲染节点 ──

export interface GoalGraphNode {
  goal: Goal;
  children: GoalGraphNode[];
  objectives: Objective[];
  depth: number;
}

// ── GoalCreateInput — 创建 Goal 的参数 ──

export interface GoalCreateInput {
  name: string;
  description: string;
  level: GoalLevel;
  priority?: number;
  parentGoalId?: string;
  deadline?: number;
  metadata?: Record<string, unknown>;
}

// ── GoalStats — 目标统计 ──

export interface GoalStats {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  byLevel: Record<GoalLevel, number>;
  overallProgress: number;
  activeObjectives: number;
}
