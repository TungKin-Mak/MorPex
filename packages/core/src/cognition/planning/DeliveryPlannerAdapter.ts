/**
 * DeliveryPlannerAdapter — 将 DeliveryPlanner 适配为 MissionPlanner 接口
 *
 * L3 全功能实现：把理想架构第 3 层（DeliveryPlanner，真实 piBridge + Ontology Gate）
 * 接入 MissionRuntime 的任务 FSM 规划阶段（此前规划层不可达）。
 *
 * 深度接入（vNext+ L3）：
 *   - 主规划：DeliveryPlanner.createPlan（Ontology Grounded）
 *   - 重规划（replan）：HierarchicalPlanner（HTN）细粒度重排
 *   - 跨部门仲裁：CrossDepartmentArbitrationEngine（计划任务跨多域时检测并仲裁冲突）
 *
 * 映射：
 *   Mission → PlanningRequest
 *   Plan（tasks + ontologyRefs）→ MissionPlan（steps/riskLevel/reasoning）
 */

import type { MissionPlanner } from '../../execution/runtime/mission/MissionRuntime.js';
import type { Mission, MissionPlan, PlanStep } from '../../execution/runtime/mission/types.js';
import { DeliveryPlanner } from './DeliveryPlanner.js';
import type { PlanningRequest, PlanTask } from './DeliveryPlanner.js';
import { CrossDepartmentArbitrationEngine } from './CrossDepartmentArbitrationEngine.js';
import type { PlanWithTasks, Conflict } from './CrossDepartmentArbitrationEngine.js';
import type { HierarchicalPlanner } from './HierarchicalPlanner.js';

export class DeliveryPlannerAdapter implements MissionPlanner {
  constructor(
    private readonly deliveryPlanner: DeliveryPlanner,
    private readonly opts: {
      /** HTN 重规划器（可选） */
      hierarchicalPlanner?: HierarchicalPlanner;
      /** 跨部门仲裁引擎（可选） */
      arbitration?: CrossDepartmentArbitrationEngine;
    } = {},
  ) {}

  /**
   * createPlan — 为 Mission 生成执行计划（经 DeliveryPlanner → Ontology Gate + 跨部门仲裁）
   */
  async createPlan(mission: Mission): Promise<MissionPlan> {
    const request: PlanningRequest = {
      goal: mission.goal,
      departmentId: (mission as unknown as { departmentId?: string }).departmentId,
      context: { missionId: mission.id },
    };

    const plan = await this.deliveryPlanner.createPlan(request);

    const tasks = plan.tasks ?? [];
    const steps: PlanStep[] = tasks.map((t, i) => ({
      id: t.id,
      name: (t.description || '').slice(0, 50) || `step-${i}`,
      description: t.description,
      domain: t.capabilities?.[0] ?? 'general',
      agentType: t.capabilities?.[0] ?? 'general',
      deps: t.deps ?? [],
      priority: i,
    }));

    // ── vNext+ L3：跨部门仲裁（计划任务跨多域时检测资源/依赖冲突）──
    let arbitrationNote = '';
    if (this.opts.arbitration && tasks.length > 1) {
      const domains = new Set(tasks.map((t) => t.capabilities?.[0] ?? 'general'));
      if (domains.size > 1) {
        const planWithTasks: PlanWithTasks = {
          subGoals: steps.map((s) => ({
            id: s.id, description: s.description,
            priority: 'medium' as const,
            estimatedDuration: 1000, dependencies: s.deps,
          })),
          tasks: tasks.map((t) => ({
            id: t.id, task: t.description, capabilities: t.capabilities ?? [], deps: t.deps ?? [],
          })),
        };
        // 检测依赖冲突：跨域步骤若有依赖且优先级冲突 → 标记
        const conflicts: Conflict[] = [];
        for (let i = 0; i < tasks.length; i++) {
          for (let j = i + 1; j < tasks.length; j++) {
            if (tasks[j].deps?.includes(tasks[i].id) && domains.has(tasks[i].capabilities?.[0] ?? '') && domains.size > 1) {
              conflicts.push({
                type: 'dependency', deptA: tasks[i].capabilities?.[0] ?? 'general',
                deptB: tasks[j].capabilities?.[0] ?? 'general',
                description: `跨域依赖: ${tasks[i].description.slice(0, 30)} → ${tasks[j].description.slice(0, 30)}`,
                severity: 'low', conflictingNodes: [tasks[i].id, tasks[j].id],
              });
            }
          }
        }
        if (conflicts.length > 0) {
          const result = await this.opts.arbitration.arbitrate(planWithTasks, conflicts, {
            mode: 'priority',
            deptPriorities: [...domains].map((d, i) => ({ deptId: d, priority: i + 1 })),
          });
          arbitrationNote = `[Arbitration] conflicts=${conflicts.length}, resolved=${result.resolved.length}, unresolved=${result.unresolved.length}`;
        }
      }
    }

    return {
      id: plan.id,
      missionId: mission.id,
      steps,
      estimatedDuration: tasks.reduce((sum, t) => sum + (t.estimatedDuration ?? 1000), 0),
      riskLevel: ((plan.metadata as { riskLevel?: 'low' | 'medium' | 'high' } | undefined)?.riskLevel ?? 'low'),
      reasoning: `[DeliveryPlanner] mode=${plan.mode}, ontologyRefs=${(plan.ontologyRefs ?? []).length}${arbitrationNote ? ' ' + arbitrationNote : ''}`,
    };
  }

  /**
   * replan — 运行时重规划（HTN 细粒度重排，回退主规划器）
   */
  async replan(mission: Mission, reason: string): Promise<MissionPlan> {
    if (this.opts.hierarchicalPlanner) {
      try {
        const dagPlan = await this.opts.hierarchicalPlanner.createPlan(mission.goal, {
          missionId: mission.id,
          originalGoal: mission.goal,
        } as unknown as import('./HierarchicalPlanner.js').PlanContext);
        const steps: PlanStep[] = (dagPlan.subGoals ?? []).map((s: { id: string; description: string; dependencies: string[] }, i: number) => ({
          id: s.id, name: (s.description || '').slice(0, 50),
          description: s.description, domain: 'general',
          agentType: 'general', deps: s.dependencies ?? [], priority: i,
        }));
        return {
          id: `plan_htn_${Date.now()}`, missionId: mission.id, steps,
          estimatedDuration: (dagPlan.metadata?.estimatedTotalDuration ?? steps.length * 1000),
          riskLevel: dagPlan.metadata?.riskLevel ?? 'medium',
          reasoning: `[HTN replan] ${reason}; tasks=${steps.length}`,
        };
      } catch {
        // HTN 失败回退主规划器
      }
    }
    return this.createPlan(mission);
  }
}
