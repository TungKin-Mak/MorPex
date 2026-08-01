/**
 * DAGExecutorAdapter — 将 DAGRuntime 适配为 MissionExecutor 接口
 *
 * P0 架构完善: 连接 MissionRuntime → DAGRuntime
 *
 * MissionRuntime 通过 MissionExecutor 接口委托执行工作。
 * 此适配器将现有的 DAGRuntime（TaskGraph/Scheduler/ParallelExecutor）包装为 MissionExecutor。
 *
 * 使用方式：
 *   const adapter = new DAGExecutorAdapter(dagRuntime);
 *   missionRuntime.setExecutor(adapter);
 */

import type { MissionExecutor } from '../MissionRuntime.js';
import type { Mission, MissionPlan, MissionResult } from '../types.js';
import { MissionState } from '../types.js';

// DAGRuntime 类型声明（动态导入避免编译时强依赖）
type DAGRuntimeInstance = {
  run(dag: any, context: unknown): Promise<{
    success: boolean;
    dagId: string;
    totalNodes: number;
    completedNodes: number;
    failedNodes: number;
    skippedNodes: number;
    duration: number;
    nodeResults: Map<string, unknown>;
    errors: Array<{ nodeId: string; error: string }>;
    executionTrace: Array<{ nodeId: string; nodeName: string; action: string; timestamp: number }>;
  }>;
};

export class DAGExecutorAdapter implements MissionExecutor {
  /** DAGRuntime 实例 */
  private dagRuntime: DAGRuntimeInstance | null = null;

  /** 适配器就绪状态 */
  private _ready = false;

  /**
   * @param dagRuntime - DAGRuntime 实例或 null
   */
  constructor(dagRuntime: DAGRuntimeInstance | null) {
    this.dagRuntime = dagRuntime;
    this._ready = dagRuntime != null;
  }

  /**
   * 获取适配器就绪状态
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * execute — 执行 Mission 的计划
   *
   * 将 MissionPlan 转换为 ExecutionDAG，委托 DAGRuntime 执行，
   * 并将 DAG 结果转换为 MissionResult。
   *
   * @param mission - 待执行的 Mission
   * @param plan - 待执行的计划
   * @returns MissionResult
   */
  async execute(mission: Mission, plan: MissionPlan): Promise<MissionResult> {
    if (!this._ready || !this.dagRuntime) {
      console.warn('[DAGExecutorAdapter] DAGRuntime 未就绪，返回模拟结果');
      return this.simulatedResult(mission, plan);
    }

    const startTime = Date.now();
    console.log(`[DAGExecutorAdapter] 🚀 执行 Mission ${mission.id}, ${plan.steps.length} 步`);

    try {
      // 将 MissionPlan 转换为 DAGRuntime 可接受的 DAG 格式
      const executionDag = this.convertPlanToDAG(plan, mission);

      // 执行 DAG
      const dagResult = await this.dagRuntime.run(executionDag, {
        missionId: mission.id,
        goal: mission.goal,
        channel: mission.context.channel,
        sessionId: mission.context.sessionId,
      });

      // 提取执行产物列表
      const artifacts = dagResult.executionTrace
        .filter(t => t.action === 'complete')
        .map(t => `step://${t.nodeId}`);

      // 构建 MissionResult
      const result: MissionResult = {
        missionId: mission.id,
        state: dagResult.success ? MissionState.VERIFYING : MissionState.FAILED,
        stepsCompleted: dagResult.completedNodes,
        stepsTotal: plan.steps.length,
        output: dagResult.nodeResults.size > 0
          ? Object.fromEntries(dagResult.nodeResults)
          : undefined,
        artifacts,
        duration: dagResult.duration,
        error: dagResult.errors.length > 0
          ? dagResult.errors.map(e => `[${e.nodeId}] ${e.error}`).join('; ')
          : undefined,
      };

      console.log(`[DAGExecutorAdapter] ✅ 执行完成: ${dagResult.completedNodes}/${plan.steps.length} steps, ${dagResult.duration}ms`);
      return result;

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[DAGExecutorAdapter] ❌ 执行失败: ${errorMsg}`);

      return {
        missionId: mission.id,
        state: MissionState.FAILED,
        stepsCompleted: 0,
        stepsTotal: plan.steps.length,
        artifacts: [],
        duration: Date.now() - startTime,
        error: errorMsg,
      };
    }
  }

  /**
   * convertPlanToDAG — 将 MissionPlan 转换为 DAGRuntime 兼容格式
   *
   * DAGRuntime.run() 接受的 DAG 格式:
   *   { nodes: Array<{ id, name, goal, domain, agentType, deps, status, priority }>,
   *     edges: Array<{ from, to }>,
   *     metadata: Record<string, unknown> }
   */
  private convertPlanToDAG(plan: MissionPlan, mission: Mission): any {
    // 将 MissionPlan 步骤转换为 DAG 节点
    const nodes = plan.steps.map(step => ({
      id: step.id,
      name: step.name,
      goal: step.description || step.name,
      domain: step.domain,
      agentType: step.agentType,
      deps: step.deps || [],
      status: 'pending' as const,
      priority: step.priority || 1,
      maxRetries: 2,
      canRetry: true,
    }));

    // 从 deps 构建边
    const edgeSet = new Set<string>();
    for (const step of plan.steps) {
      for (const depId of (step.deps || [])) {
        edgeSet.add(`${depId}|${step.id}`);
      }
    }
    const edges = [...edgeSet].map(pair => {
      const [from, to] = pair.split('|');
      return { from, to };
    });

    return {
      nodes,
      edges,
      metadata: {
        planId: plan.id,
        missionId: plan.missionId,
        riskLevel: plan.riskLevel,
        goal: mission.goal,
      },
    };
  }

  /**
   * simulatedResult — DAGRuntime 不可用时的模拟执行结果
   */
  private simulatedResult(mission: Mission, plan: MissionPlan): MissionResult {
    return {
      missionId: mission.id,
      state: MissionState.VERIFYING,
      stepsCompleted: plan.steps.length,
      stepsTotal: plan.steps.length,
      artifacts: [],
      duration: 0,
      error: 'Simulated: DAGRuntime not available',
    };
  }
}
