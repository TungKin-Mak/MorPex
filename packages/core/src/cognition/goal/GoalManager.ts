/**
 * GoalManager — 目标管理器
 *
 * 职责:
 *   1. Goal 的完整生命周期管理 (create → update → archive)
 *   2. OKR-style Objective 追踪
 *   3. Goal → Mission 关联
 *   4. 全局进度汇总
 *
 * GoalManager 是 GoalPlane 的门面类,
 * 上层 (CognitiveLoop, StudioServer) 通过它操作目标。
 *
 * 使用方式:
 *   const gm = new GoalManager();
 *   const goal = gm.createGoal({ name: "融资成功", level: "objective" });
 *   gm.linkMissionToGoal(goal.id, mission);
 *   const tree = gm.getFullTree();
 */

import { GoalGraph } from './GoalGraph.js';
import type {
  Goal, GoalStatus, GoalLevel, Objective, KeyResult,
  GoalGraphNode, GoalCreateInput, GoalStats,
} from './types.js';

// ── ID 生成 ──

let krCounter = 0;
let objCounter = 0;
function generateKrId(): string { krCounter++; return `kr_${Date.now()}_${krCounter}`; }
function generateObjId(): string { objCounter++; return `obj_${Date.now()}_${objCounter}`; }

// ── GoalManager ──

export class GoalManager {
  private graph: GoalGraph;
  private objectives: Map<string, Objective> = new Map();

  constructor() {
    this.graph = new GoalGraph();
  }

  // ═══════════════════════════════════════════════════════════
  // Goal CRUD
  // ═══════════════════════════════════════════════════════════

  createGoal(input: GoalCreateInput): Goal {
    return this.graph.createGoal({
      name: input.name,
      description: input.description,
      level: input.level,
      priority: input.priority,
      parentGoalId: input.parentGoalId,
      deadline: input.deadline,
      metadata: input.metadata,
    });
  }

  getGoal(id: string): Goal | undefined {
    return this.graph.getGoal(id);
  }

  updateGoal(id: string, updates: Partial<Goal>): Goal | undefined {
    return this.graph.updateGoal(id, updates);
  }

  archiveGoal(id: string): void {
    const goal = this.graph.getGoal(id);
    if (!goal) return;
    if (goal.status === 'completed' || goal.status === 'abandoned') return;
    this.graph.updateGoal(id, { status: 'abandoned', completedAt: Date.now() });
  }

  completeGoal(id: string): void {
    const goal = this.graph.getGoal(id);
    if (!goal) return;
    this.graph.updateGoal(id, {
      status: 'completed',
      progress: 100,
      completedAt: Date.now(),
    });
  }

  pauseGoal(id: string): void {
    this.graph.updateGoal(id, { status: 'paused' });
  }

  resumeGoal(id: string): void {
    this.graph.updateGoal(id, { status: 'active' });
  }

  removeGoal(id: string): boolean {
    // 同时删除关联的 Objective
    for (const [objId, obj] of this.objectives) {
      if (obj.goalId === id) this.objectives.delete(objId);
    }
    return this.graph.removeGoal(id);
  }

  // ═══════════════════════════════════════════════════════════
  // 层级查询
  // ═══════════════════════════════════════════════════════════

  /** 完整的层级森林 */
  getFullTree(): GoalGraphNode[] {
    const forest = this.graph.buildForest();
    // 注入 objectives
    for (const root of forest) {
      this.injectObjectives(root);
    }
    return forest;
  }

  /** 从根到目标的路径 */
  getGoalPath(goalId: string): Goal[] {
    return this.graph.getPath(goalId);
  }

  /** 获取根目标 */
  getRootGoals(): Goal[] {
    return this.graph.getRootGoals();
  }

  /** 按层级获取 */
  getByLevel(level: GoalLevel): Goal[] {
    return this.graph.getByLevel(level);
  }

  /** 所有活跃目标 */
  getActiveGoals(): Goal[] {
    return this.graph.getByStatus('active');
  }

  /** 所有目标 */
  getAllGoals(): Goal[] {
    return this.graph.getAll();
  }

  // ═══════════════════════════════════════════════════════════
  // Mission 关联
  // ═══════════════════════════════════════════════════════════

  linkMissionToGoal(goalId: string, missionId: string): void {
    this.graph.linkMission(goalId, missionId);
  }

  unlinkMissionToGoal(goalId: string, missionId: string): void {
    this.graph.unlinkMission(goalId, missionId);
  }

  getMissionsForGoal(goalId: string): string[] {
    const goal = this.graph.getGoal(goalId);
    return goal ? [...goal.linkedMissionIds] : [];
  }

  getGoalsForMission(missionId: string): Goal[] {
    return this.graph.getGoalsForMission(missionId);
  }

  // ═══════════════════════════════════════════════════════════
  // Objective (OKR-style) 管理
  // ═══════════════════════════════════════════════════════════

  addObjective(
    goalId: string,
    description: string,
    keyResults: Array<Omit<KeyResult, 'id'>>,
    deadline?: number,
  ): Objective {
    const now = Date.now();
    const objective: Objective = {
      id: generateObjId(),
      goalId,
      description,
      keyResults: keyResults.map(kr => ({
        ...kr,
        id: generateKrId(),
      })),
      deadline,
      progress: 0,
      status: 'active',
      createdAt: now,
    };

    this.objectives.set(objective.id, objective);
    return objective;
  }

  updateKeyResult(objectiveId: string, krId: string, current: number): void {
    const obj = this.objectives.get(objectiveId);
    if (!obj) return;

    const kr = obj.keyResults.find(k => k.id === krId);
    if (!kr) return;

    kr.current = Math.min(current, kr.target);

    // 重新计算 Objective 进度
    const totalTarget = obj.keyResults.reduce((s, k) => s + k.target, 0);
    const totalCurrent = obj.keyResults.reduce((s, k) => s + k.current, 0);
    obj.progress = totalTarget > 0
      ? Math.round((totalCurrent / totalTarget) * 100)
      : 0;

    // 检查是否完成
    if (obj.keyResults.every(k => k.current >= k.target)) {
      obj.status = 'completed';
    }
  }

  getObjectives(goalId: string): Objective[] {
    return [...this.objectives.values()].filter(o => o.goalId === goalId);
  }

  getAllObjectives(): Objective[] {
    return [...this.objectives.values()];
  }

  // ═══════════════════════════════════════════════════════════
  // 进度 & 统计
  // ═══════════════════════════════════════════════════════════

  recalculateAllProgress(): void {
    for (const root of this.graph.getRootGoals()) {
      this.graph.recalculateProgress(root.id);
    }
  }

  getOverallProgress(): { total: number; active: number; completed: number; percentage: number } {
    return this.graph.getOverallProgress();
  }

  getStats(): GoalStats {
    const all = this.graph.getAll();
    const byLevel: Record<GoalLevel, number> = {
      life: 0, objective: 0, project: 0, milestone: 0,
    };
    for (const g of all) byLevel[g.level]++;

    return {
      totalGoals: all.length,
      activeGoals: all.filter(g => g.status === 'active').length,
      completedGoals: all.filter(g => g.status === 'completed').length,
      byLevel,
      overallProgress: this.graph.getOverallProgress().percentage,
      activeObjectives: [...this.objectives.values()].filter(o => o.status === 'active').length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部工具
  // ═══════════════════════════════════════════════════════════

  private injectObjectives(node: GoalGraphNode): void {
    node.objectives = this.getObjectives(node.goal.id);
    for (const child of node.children) {
      this.injectObjectives(child);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 序列化
  // ═══════════════════════════════════════════════════════════

  toJSON(): object {
    return {
      graph: this.graph.toJSON(),
      objectives: [...this.objectives.values()],
    };
  }

  static fromJSON(data: { graph: { goals: Goal[]; rootGoals: string[] }; objectives: Objective[] }): GoalManager {
    const gm = new GoalManager();
    gm.graph = GoalGraph.fromJSON(data.graph);
    for (const obj of data.objectives) {
      gm.objectives.set(obj.id, obj);
    }
    return gm;
  }
}
