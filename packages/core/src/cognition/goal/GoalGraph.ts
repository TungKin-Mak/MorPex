/**
 * GoalGraph — 目标层级图谱
 *
 * 维护 Goal 的层级树结构:
 *   Life → Objective → Project → Milestone
 *
 * 支持:
 *   - 树构建 (buildTree)
 *   - 路径查询 (getPath)
 *   - 后代遍历 (getDescendants)
 *   - 进度递归计算 (recalculateProgress)
 *   - Mission 关联 (linkMission)
 */

import type { Goal, GoalGraphNode, GoalStatus, GoalLevel } from './types.js';

// ── ID 生成 ──

let idCounter = 0;
function generateId(): string {
  idCounter++;
  return `gol_${Date.now()}_${idCounter}`;
}

// ── GoalGraph ──

export class GoalGraph {
  private goals: Map<string, Goal> = new Map();
  private rootGoals: string[] = [];

  // ═══════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════

  createGoal(params: {
    name: string;
    description: string;
    level: GoalLevel;
    priority?: number;
    parentGoalId?: string;
    deadline?: number;
    metadata?: Record<string, unknown>;
  }): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: generateId(),
      name: params.name,
      description: params.description,
      level: params.level,
      priority: params.priority ?? 50,
      status: 'active',
      parentGoalId: params.parentGoalId,
      childrenIds: [],
      linkedMissionIds: [],
      progress: 0,
      deadline: params.deadline,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata ?? {},
    };

    this.goals.set(goal.id, goal);

    // 挂到父目标
    if (params.parentGoalId) {
      const parent = this.goals.get(params.parentGoalId);
      if (parent) {
        parent.childrenIds.push(goal.id);
        parent.updatedAt = now;
      }
    } else {
      this.rootGoals.push(goal.id);
    }

    return goal;
  }

  addGoal(goal: Goal): void {
    this.goals.set(goal.id, goal);
    if (!goal.parentGoalId && !this.rootGoals.includes(goal.id)) {
      this.rootGoals.push(goal.id);
    }
  }

  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  updateGoal(id: string, updates: Partial<Goal>): Goal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;
    Object.assign(goal, updates);
    goal.updatedAt = Date.now();

    // 如果父目标变了，重新挂接
    if (updates.parentGoalId !== undefined && updates.parentGoalId !== goal.parentGoalId) {
      const oldParentId = goal.parentGoalId;
      goal.parentGoalId = updates.parentGoalId;

      // 从旧父目标移除
      if (oldParentId) {
        const oldParent = this.goals.get(oldParentId);
        if (oldParent) {
          oldParent.childrenIds = oldParent.childrenIds.filter(cid => cid !== id);
          oldParent.updatedAt = Date.now();
        }
      } else {
        this.rootGoals = this.rootGoals.filter(rid => rid !== id);
      }

      // 挂到新父目标
      if (updates.parentGoalId) {
        const newParent = this.goals.get(updates.parentGoalId);
        if (newParent) {
          newParent.childrenIds.push(id);
          newParent.updatedAt = Date.now();
        }
      } else {
        if (!this.rootGoals.includes(id)) {
          this.rootGoals.push(id);
        }
      }
    }

    return { ...goal };
  }

  removeGoal(id: string): boolean {
    const goal = this.goals.get(id);
    if (!goal) return false;

    // 从父目标移除
    if (goal.parentGoalId) {
      const parent = this.goals.get(goal.parentGoalId);
      if (parent) {
        parent.childrenIds = parent.childrenIds.filter(cid => cid !== id);
        parent.updatedAt = Date.now();
      }
    } else {
      this.rootGoals = this.rootGoals.filter(rid => rid !== id);
    }

    // 递归删除子目标
    for (const childId of [...goal.childrenIds]) {
      this.removeGoal(childId);
    }

    this.goals.delete(id);
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════

  /** 所有没有父目标的根目标 */
  getRootGoals(): Goal[] {
    return this.rootGoals.map(id => this.goals.get(id)!).filter(Boolean);
  }

  /** 按层级获取 */
  getByLevel(level: GoalLevel): Goal[] {
    return [...this.goals.values()].filter(g => g.level === level);
  }

  /** 按状态获取 */
  getByStatus(status: GoalStatus): Goal[] {
    return [...this.goals.values()].filter(g => g.status === status);
  }

  /** 获取所有目标 */
  getAll(): Goal[] {
    return [...this.goals.values()];
  }

  /** 从根到指定目标的路径 */
  getPath(goalId: string): Goal[] {
    const path: Goal[] = [];
    let current = this.goals.get(goalId);
    while (current) {
      path.unshift(current);
      current = current.parentGoalId ? this.goals.get(current.parentGoalId) : undefined;
    }
    return path;
  }

  /** 获取所有后代节点 ID (包含自身) */
  getDescendants(goalId: string): Goal[] {
    const result: Goal[] = [];
    const goal = this.goals.get(goalId);
    if (!goal) return result;

    result.push(goal);
    for (const childId of goal.childrenIds) {
      result.push(...this.getDescendants(childId));
    }
    return result;
  }

  /** 构建完整的层级树 */
  buildTree(goalId: string): GoalGraphNode | null {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    return {
      goal,
      children: goal.childrenIds
        .map(cid => this.buildTree(cid)!)
        .filter(Boolean),
      objectives: [],
      depth: goal.parentGoalId ? 1 : 0, // caller should fix depth
    };
  }

  /** 所有根目标的树 */
  buildForest(): GoalGraphNode[] {
    const forest: GoalGraphNode[] = [];
    const assignDepth = (node: GoalGraphNode, depth: number): void => {
      node.depth = depth;
      for (const child of node.children) {
        assignDepth(child, depth + 1);
      }
    };

    for (const rootId of this.rootGoals) {
      const tree = this.buildTree(rootId);
      if (tree) {
        assignDepth(tree, 0);
        forest.push(tree);
      }
    }
    return forest;
  }

  // ═══════════════════════════════════════════════════════════
  // 进度管理
  // ═══════════════════════════════════════════════════════════

  /** 递归计算进度 (子目标进度平均) */
  recalculateProgress(goalId: string): number {
    const goal = this.goals.get(goalId);
    if (!goal) return 0;

    if (goal.childrenIds.length === 0) {
      // 叶子节点: 根据 Mission 完成情况算
      // 没有 Mission 则保持当前进度
      return goal.progress;
    }

    let total = 0;
    for (const childId of goal.childrenIds) {
      total += this.recalculateProgress(childId);
    }
    goal.progress = Math.round(total / goal.childrenIds.length);
    goal.updatedAt = Date.now();
    return goal.progress;
  }

  /** 全局进度 */
  getOverallProgress(): { total: number; active: number; completed: number; percentage: number } {
    const all = [...this.goals.values()];
    const total = all.length;
    const active = all.filter(g => g.status === 'active').length;
    const completed = all.filter(g => g.status === 'completed').length;
    const avgProgress = total > 0
      ? Math.round(all.reduce((s, g) => s + g.progress, 0) / total)
      : 0;
    return { total, active, completed, percentage: avgProgress };
  }

  // ═══════════════════════════════════════════════════════════
  // Mission 关联
  // ═══════════════════════════════════════════════════════════

  linkMission(goalId: string, missionId: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    if (!goal.linkedMissionIds.includes(missionId)) {
      goal.linkedMissionIds.push(missionId);
      goal.updatedAt = Date.now();
    }
  }

  unlinkMission(goalId: string, missionId: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.linkedMissionIds = goal.linkedMissionIds.filter(mid => mid !== missionId);
    goal.updatedAt = Date.now();
  }

  /** 获取关联某个 Mission 的所有 Goal */
  getGoalsForMission(missionId: string): Goal[] {
    return [...this.goals.values()].filter(
      g => g.linkedMissionIds.includes(missionId)
    );
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  toJSON(): { goals: Goal[]; rootGoals: string[] } {
    return {
      goals: [...this.goals.values()],
      rootGoals: [...this.rootGoals],
    };
  }

  static fromJSON(data: { goals: Goal[]; rootGoals: string[] }): GoalGraph {
    const graph = new GoalGraph();
    for (const goal of data.goals) {
      graph.goals.set(goal.id, { ...goal });
    }
    graph.rootGoals = [...data.rootGoals];
    return graph;
  }
}
