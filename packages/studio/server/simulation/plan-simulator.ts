/**
 * PlanSimulator — 计划仿真器
 *
 * MorPex v10: 对 MissionPlan 进行仿真推演。
 * 分析步骤依赖关系、时序、潜在瓶颈，输出仿真结果供决策。
 */

import type { MissionPlan, PlanStep } from '../../../core/src/runtime/mission/types.js';
import type { SimulationTwinProfile } from './types.js';

// ── PlanSimulator ──

export class PlanSimulator {
  /**
   * simulate — 仿真推演计划
   *
   * 分析：
   *   1. 关键路径识别（最长依赖链）
   *   2. 并行度分析
   *   3. 潜在瓶颈检测
   *   4. 预计完成时间
   *
   * @param plan - MissionPlan
   * @param twinProfile - 可选孪生画像
   * @returns 仿真推演结果
   */
  simulate(
    plan: MissionPlan,
    twinProfile?: SimulationTwinProfile
  ): PlanSimulationOutput {
    const steps = plan.steps;
    const stepMap = new Map(steps.map(s => [s.id, s]));

    // 1. 计算关键路径
    const criticalPath = this.findCriticalPath(steps);

    // 2. 并行度分析
    const parallelism = this.analyzeParallelism(steps);

    // 3. 瓶颈检测
    const bottlenecks = this.detectBottlenecks(steps, criticalPath);

    // 4. 预计完成时间（基于关键路径）
    const baseDuration = plan.estimatedDuration;
    const estimatedCompletion = baseDuration * (1 + bottlenecks.length * 0.1);

    // 5. 历史匹配度
    const historyMatch = twinProfile
      ? this.calculateHistoryMatch(plan, twinProfile)
      : undefined;

    return {
      missionId: plan.missionId,
      planId: plan.id,
      criticalPath: criticalPath.map(id => ({
        stepId: id,
        name: stepMap.get(id)?.name ?? id,
      })),
      criticalPathLength: criticalPath.length,
      maxParallelism: parallelism.maxConcurrent,
      averageParallelism: Math.round(parallelism.average * 10) / 10,
      bottlenecks: bottlenecks.map(b => ({
        stepId: b.stepId,
        name: stepMap.get(b.stepId)?.name ?? b.stepId,
        reason: b.reason,
        severity: b.severity,
      })),
      estimatedCompletionMs: Math.round(estimatedCompletion),
      historyMatch: historyMatch,
      simulatedAt: Date.now(),
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'PlanSimulator',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  /**
   * findCriticalPath — 寻找关键路径（最长依赖链）
   * 使用拓扑排序 + 动态规划
   */
  private findCriticalPath(steps: PlanStep[]): string[] {
    if (steps.length === 0) return [];

    // 构建入度和依赖图
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>(); // 依赖 → 被依赖者
    const depth = new Map<string, number>();
    const parent = new Map<string, string | null>();

    for (const step of steps) {
      inDegree.set(step.id, step.deps.length);
      depth.set(step.id, 0);
      parent.set(step.id, null);

      for (const dep of step.deps) {
        if (!adjList.has(dep)) adjList.set(dep, []);
        adjList.get(dep)!.push(step.id);
      }
    }

    // 拓扑排序 + 最长路径
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    let maxDepth = 0;
    let deepestNode = '';

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current) ?? 0;

      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
        deepestNode = current;
      }

      const neighbors = adjList.get(current) ?? [];
      for (const neighbor of neighbors) {
        const newDepth = currentDepth + 1;
        if (newDepth > (depth.get(neighbor) ?? 0)) {
          depth.set(neighbor, newDepth);
          parent.set(neighbor, current);
        }
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 1) - 1);
        if ((inDegree.get(neighbor) ?? 0) === 0) {
          queue.push(neighbor);
        }
      }
    }

    // 回溯构建关键路径
    const path: string[] = [];
    let current: string | null = deepestNode;
    while (current) {
      path.unshift(current);
      current = parent.get(current) ?? null;
    }

    return path;
  }

  /**
   * analyzeParallelism — 分析并行度
   */
  private analyzeParallelism(steps: PlanStep[]): { maxConcurrent: number; average: number } {
    if (steps.length === 0) return { maxConcurrent: 0, average: 0 };

    // 按层级分组（层 = 到根节点的最大距离）
    const levelMap = new Map<number, number>();
    const depthMap = new Map<string, number>();

    const computeDepth = (stepId: string, visited: Set<string> = new Set()): number => {
      if (visited.has(stepId)) return 0;
      visited.add(stepId);

      const step = steps.find(s => s.id === stepId);
      if (!step || step.deps.length === 0) {
        depthMap.set(stepId, 0);
        return 0;
      }

      const maxDepDepth = Math.max(...step.deps.map(d => computeDepth(d, visited)));
      const depth = maxDepDepth + 1;
      depthMap.set(stepId, depth);
      return depth;
    };

    for (const step of steps) {
      const d = computeDepth(step.id);
      levelMap.set(d, (levelMap.get(d) ?? 0) + 1);
    }

    const maxConcurrent = Math.max(...levelMap.values(), 1);
    const totalLevels = levelMap.size;
    const average = totalLevels > 0 ? steps.length / totalLevels : 1;

    return { maxConcurrent, average };
  }

  /**
   * detectBottlenecks — 检测瓶颈
   */
  private detectBottlenecks(
    steps: PlanStep[],
    criticalPath: string[]
  ): Array<{ stepId: string; reason: string; severity: 'high' | 'medium' | 'low' }> {
    const bottlenecks: Array<{ stepId: string; reason: string; severity: 'high' | 'medium' | 'low' }> = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    // 关键路径上的聚合步骤（被很多后续步骤依赖）
    for (const stepId of criticalPath) {
      const step = stepMap.get(stepId);
      if (!step) continue;

      // 被多少步骤依赖
      const dependents = steps.filter(s => s.deps.includes(stepId));
      if (dependents.length >= 3) {
        bottlenecks.push({
          stepId,
          reason: `被 ${dependents.length} 个后续步骤依赖，失败将阻塞大量任务`,
          severity: dependents.length >= 5 ? 'high' : 'medium',
        });
      }
    }

    // 另：检测环状依赖
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (stepId: string): boolean => {
      if (recursionStack.has(stepId)) return true;
      if (visited.has(stepId)) return false;

      visited.add(stepId);
      recursionStack.add(stepId);

      const step = stepMap.get(stepId);
      if (step) {
        for (const dep of step.deps) {
          if (hasCycle(dep)) return true;
        }
      }

      recursionStack.delete(stepId);
      return false;
    };

    for (const step of steps) {
      if (hasCycle(step.id)) {
        bottlenecks.push({
          stepId: step.id,
          reason: '检测到循环依赖',
          severity: 'high',
        });
        break;
      }
    }

    return bottlenecks;
  }

  /**
   * calculateHistoryMatch — 计算与历史孪生的匹配度
   */
  private calculateHistoryMatch(
    plan: MissionPlan,
    twinProfile: SimulationTwinProfile
  ): { score: number; details: string } {
    const stepCount = plan.steps.length;
    const avgHistorySteps = twinProfile.similarMissions.length > 0
      ? twinProfile.similarMissions.reduce((s, m) => s + (m.score > 0 ? 3 : 0), 0) / twinProfile.similarMissions.length
      : 3;

    const stepMatch = 1 - Math.abs(stepCount - avgHistorySteps) / Math.max(stepCount, avgHistorySteps);
    const score = Math.round(Math.max(0, stepMatch * 100));

    return {
      score,
      details: `计划步骤数 ${stepCount} vs 历史平均 ${avgHistorySteps.toFixed(1)}，匹配度 ${score}%`,
    };
  }
}

// ── 输出类型 ──

export interface PlanSimulationOutput {
  missionId: string;
  planId: string;
  criticalPath: { stepId: string; name: string }[];
  criticalPathLength: number;
  maxParallelism: number;
  averageParallelism: number;
  bottlenecks: { stepId: string; name: string; reason: string; severity: 'high' | 'medium' | 'low' }[];
  estimatedCompletionMs: number;
  historyMatch?: { score: number; details: string };
  simulatedAt: number;
}
