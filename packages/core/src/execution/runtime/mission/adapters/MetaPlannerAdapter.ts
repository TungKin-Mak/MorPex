/**
 * MetaPlannerAdapter — 将 MetaPlanner 适配为 MissionPlanner 接口
 *
 * P0 架构完善: 连接 MissionRuntime → MetaPlanner
 *
 * ★ v8.5 升级: 读取 Twin 约束 (PlannerConstraint) 并注入 MetaPlanner
 *
 * MissionRuntime 通过 MissionPlanner 接口委托规划工作。
 * 此适配器将现有的 MetaPlanner（7-Stage Pipeline）包装为 MissionPlanner。
 *
 * 使用方式：
 *   const adapter = new MetaPlannerAdapter(metaPlanner);
 *   missionRuntime.setPlanner(adapter);
 */

import type { MissionPlanner } from '../MissionRuntime.js';
import type { Mission, MissionPlan } from '../types.js';

/** Twin 约束接口（与 PlannerConstraint 兼容） */
interface PlannerConstraintShape {
  avoidDomains?: string[];
  preferredAgentTypes?: string[];
  suggestedMaxSteps?: number;
  suggestedParallelism?: number;
  requireApproval?: boolean;
}

export class MetaPlannerAdapter implements MissionPlanner {
  /** MetaPlanner 实例（通过 any 接口避免类型依赖） */
  private metaPlanner: any;

  /** 适配器就绪状态 */
  private _ready = false;

  /**
   * @param metaPlanner - MetaPlanner 实例（any 类型，接受 MetaPlanner 或 null）
   */
  constructor(metaPlanner: any) {
    this.metaPlanner = metaPlanner;
    this._ready = metaPlanner != null;
  }

  /**
   * 获取适配器就绪状态
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * createPlan — 为 Mission 生成执行计划
   *
   * ★ v8.5: 从 mission.metadata.plannerConstraint 读取 Twin 约束，
   *   注入到 MetaPlanner 的 orchestrate 参数中。
   *
   * @param mission - 待规划的 Mission
   * @returns MissionPlan 兼容格式
   */
  async createPlan(mission: Mission): Promise<MissionPlan> {
    // ★ v8.5: 提取 Twin 约束
    const constraint = this.extractConstraint(mission);

    if (!this._ready) {
      console.warn('[MetaPlannerAdapter] MetaPlanner 未就绪，使用回退逻辑');
      return this.fallbackPlan(mission, constraint);
    }

    try {
      // 尝试调用 MetaPlanner 的 orchestrate 方法
      const orchestrateFn =
        typeof (this.metaPlanner as any).wrapOrchestrate === 'function'
          ? (this.metaPlanner as any).wrapOrchestrate.bind(this.metaPlanner)
          : typeof (this.metaPlanner as any).orchestrate === 'function'
            ? (this.metaPlanner as any).orchestrate.bind(this.metaPlanner)
            : null;

      if (!orchestrateFn) {
        console.warn('[MetaPlannerAdapter] MetaPlanner 无 orchestrator 方法，使用回退');
        return this.fallbackPlan(mission, constraint);
      }

      // ★ v8.5: 将 Twin 约束注入 orchestrate 参数
      const context: Record<string, unknown> = {
        ...mission.context,
        missionId: mission.id,
        userId: mission.owner,
      };

      if (constraint) {
        context.constraint = {
          avoidDomains: constraint.avoidDomains ?? [],
          preferredAgentTypes: constraint.preferredAgentTypes ?? [],
          suggestedMaxSteps: constraint.suggestedMaxSteps ?? 8,
          suggestedParallelism: constraint.suggestedParallelism ?? 2,
          requireApproval: constraint.requireApproval ?? false,
        };
      }

      const metaResult = await orchestrateFn({
        goal: mission.goal,
        context,
      });

      // 从 MetaPlanner 结果中提取节点/DAG
      const nodes = metaResult?.dag?.nodes || metaResult?.nodes || [];

      if (!Array.isArray(nodes) || nodes.length === 0) {
        console.warn('[MetaPlannerAdapter] MetaPlanner 返回空节点，使用回退');
        return this.fallbackPlan(mission, constraint);
      }

      // 转换为 MissionPlan 步骤
      const steps = nodes.map((node: any, idx: number) => ({
        id: node.id || `step_${idx + 1}`,
        name: node.name || node.taskName || `Step ${idx + 1}`,
        description: node.goal || node.description || '',
        domain: node.domain || 'general',
        agentType: node.agentType || 'general',
        deps: node.deps || [],
        priority: node.priority || (idx + 1),
      }));

      // 评估风险等级
      const riskLevel = metaResult?.riskLevel
        || this.evaluateRisk(steps)
        || 'low';

      // 构建 MissionPlan
      const plan: MissionPlan = {
        id: `plan_${mission.id}_${Date.now()}`,
        missionId: mission.id,
        steps,
        estimatedDuration: metaResult?.estimatedDuration || (steps.length * 30000),
        riskLevel,
        reasoning: metaResult?.reasoning
          || `Generated ${steps.length} step plan via MetaPlanner`,
      };

      return plan;
    } catch (err: unknown) {
      console.error('[MetaPlannerAdapter] 规划失败:', err instanceof Error ? err.message : String(err));
      return this.fallbackPlan(mission, constraint);
    }
  }

  /**
   * replan — 重新规划 Mission
   *
   * @param mission - 需要重新规划的 Mission
   * @param reason - 重新规划原因
   * @returns 更新后的 MissionPlan
   */
  async replan(mission: Mission, reason: string): Promise<MissionPlan> {
    console.log(`[MetaPlannerAdapter] Replan requested: ${reason}`);
    const plan = await this.createPlan(mission);
    plan.reasoning = `Replan (${reason}): ${plan.reasoning}`;
    return plan;
  }

  /**
   * extractConstraint — 从 mission.metadata 提取 Twin 约束
   *
   * ★ v8.5: CognitiveLoop 在 Phase 5 已将 PlannerConstraint 注入
   *   mission.metadata.plannerConstraint。
   */
  private extractConstraint(mission: Mission): PlannerConstraintShape | null {
    const raw = mission.metadata?.plannerConstraint;
    if (!raw || typeof raw !== 'object') return null;

    const c = raw as Record<string, unknown>;

    // 验证关键字段存在
    if (!c.suggestedMaxSteps && !c.preferredAgentTypes && !c.avoidDomains) {
      return null; // 无有效约束
    }

    return {
      avoidDomains: Array.isArray(c.avoidDomains) ? c.avoidDomains as string[] : undefined,
      preferredAgentTypes: Array.isArray(c.preferredAgentTypes) ? c.preferredAgentTypes as string[] : undefined,
      suggestedMaxSteps: typeof c.suggestedMaxSteps === 'number' ? c.suggestedMaxSteps : undefined,
      suggestedParallelism: typeof c.suggestedParallelism === 'number' ? c.suggestedParallelism : undefined,
      requireApproval: typeof c.requireApproval === 'boolean' ? c.requireApproval : undefined,
    };
  }

  /**
   * fallbackPlan — 当 MetaPlanner 不可用时的回退规划
   *
   * ★ v8.5: 尊重 constraint.suggestedMaxSteps 将长目标拆为多步
   *
   * @param mission - 待规划的 Mission
   * @param constraint - Twin 约束（可选）
   */
  private fallbackPlan(mission: Mission, constraint?: PlannerConstraintShape | null): MissionPlan {
    const maxSteps = constraint?.suggestedMaxSteps ?? 1;

    // 如果 suggestedMaxSteps > 1，尝试将目标拆为多步
    const steps = this.buildFallbackSteps(mission.goal, maxSteps);

    return {
      id: `plan_${mission.id}_fallback_${Date.now()}`,
      missionId: mission.id,
      steps,
      estimatedDuration: steps.length * 30000,
      riskLevel: steps.length > 3 ? 'medium' : 'low',
      reasoning: constraint
        ? `Fallback: ${steps.length}-step plan (MetaPlanner unavailable, Twin-constrained max=${maxSteps})`
        : `Fallback: ${steps.length}-step plan (MetaPlanner unavailable)`,
    };
  }

  /**
   * buildFallbackSteps — 根据约束创建回退步骤
   *
   * 如果目标文本较长 (>100 字符) 且 maxSteps > 1，拆为多步；
   * 否则单步执行。
   */
  private buildFallbackSteps(goal: string, maxSteps: number): Array<{
    id: string;
    name: string;
    description: string;
    domain: string;
    agentType: string;
    deps: string[];
    priority: number;
  }> {
    if (maxSteps <= 1 || goal.length < 100) {
      return [{
        id: 'step_1',
        name: `Execute: ${goal.substring(0, 80)}`,
        description: goal,
        domain: 'general',
        agentType: 'general',
        deps: [],
        priority: 1,
      }];
    }

    // 按句子或逗号分割，形成多个子步骤
    const segments = goal.split(/[。，；\n.,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 10)
      .slice(0, maxSteps);

    if (segments.length <= 1) {
      return [{
        id: 'step_1',
        name: `Execute: ${goal.substring(0, 80)}`,
        description: goal,
        domain: 'general',
        agentType: 'general',
        deps: [],
        priority: 1,
      }];
    }

    return segments.map((seg, idx) => ({
      id: `step_${idx + 1}`,
      name: seg.substring(0, 60),
      description: seg,
      domain: 'general',
      agentType: 'general',
      deps: idx > 0 ? [`step_${idx}`] : [],
      priority: idx + 1,
    }));

  }
  /**
   * evaluateRisk — 基于步骤数量评估风险等级
   */
  private evaluateRisk(steps: any[]): 'low' | 'medium' | 'high' {
    if (steps.length > 10) return 'high';
    if (steps.length > 5) return 'medium';
    return 'low';
  }

}

