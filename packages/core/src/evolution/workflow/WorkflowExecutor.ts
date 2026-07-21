/**
 * WorkflowExecutor — 工作流自动执行器
 *
 * Phase 5 / MorPex v8.5: 使用 MissionRuntime 自动执行已确认的工作流。
 *
 * 执行流程:
 *   1. 从 Registry 获取工作流定义
 *   2. 构造 Mission (goal = workflow 描述)
 *   3. 为每个步骤创建 MissionPlan
 *   4. 委托 MissionRuntime.executeMission() 执行
 *   5. 记录执行结果到 Registry
 *
 * 与 MissionRuntime 的关系:
 *   WorkflowExecutor 是 MissionRuntime 的上层调用者。
 *   MissionRuntime 不感知是否由 WorkflowExecutor 触发。
 */

import { WorkflowRegistry } from './WorkflowRegistry.js';
import type { RegisteredWorkflow, ExecutionResult, WorkflowStepDef } from './types.js';
import type { MissionRuntime } from '../../runtime/mission/MissionRuntime.js';
import type { MissionPlan, PlanStep } from '../../runtime/mission/types.js';
import type { IncomingMessage } from '../../interaction/types.js';

/** 执行配置 */
export interface ExecutorConfig {
  /** 默认用户 ID (自动执行时使用) */
  defaultUserId: string;
  /** 默认渠道 */
  defaultChannel: string;
  /** 最大并行执行数 */
  maxParallel: number;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  defaultUserId: 'system',
  defaultChannel: 'workflow-auto',
  maxParallel: 3,
};

export class WorkflowExecutor {
  private registry: WorkflowRegistry;
  private missionRuntime: MissionRuntime;
  private config: ExecutorConfig;

  /** 执行统计 */
  private stats = {
    totalExecuted: 0,
    totalSuccess: 0,
    totalDuration: 0,
  };

  constructor(
    registry: WorkflowRegistry,
    missionRuntime: MissionRuntime,
    config?: Partial<ExecutorConfig>
  ) {
    this.registry = registry;
    this.missionRuntime = missionRuntime;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * execute — 执行注册的工作流
   *
   * 创建一个 Mission，将工作流步骤映射为 MissionPlan，然后执行。
   *
   * @param workflowId - 工作流 ID
   * @param params - 可选参数 (会覆盖步骤中的 config)
   * @returns ExecutionResult
   */
  async execute(
    workflowId: string,
    params?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const wf = this.registry.get(workflowId);
    if (!wf) {
      return {
        workflowId,
        missionId: '',
        success: false,
        duration: 0,
        error: `Workflow not found: ${workflowId}`,
      };
    }

    const startTime = Date.now();

    try {
      // 1. 构造 IncomingMessage (作为 Mission 的输入)
      const currentVersion = wf.versions[wf.versions.length - 1];
      const goal = params?.customGoal
        ? String(params.customGoal)
        : `${wf.name}: ${wf.description}`;

      const message: IncomingMessage = {
        channel: this.config.defaultChannel,
        userId: this.config.defaultUserId,
        sessionId: `wf_${workflowId}_${Date.now()}`,
        content: goal,
        metadata: {
          workflowId,
          workflowName: wf.name,
          version: wf.currentVersion,
          steps: currentVersion.steps.map(s => s.name),
          ...(params || {}),
        },
      };

      // 2. 创建 Mission (通过 MissionRuntime)
      const mission = await this.missionRuntime.createMission(message);

      // 3. 构造 MissionPlan (从工作流步骤)
      const steps: PlanStep[] = currentVersion.steps.map((step, idx) => ({
        id: `step_${idx}`,
        name: step.name,
        description: step.description,
        domain: step.domain,
        agentType: step.agentType,
        deps: step.deps.map(depName => {
          // 将依赖名称转换为对应的 step ID
          const depIdx = currentVersion.steps.findIndex(s => s.name === depName);
          return depIdx >= 0 ? `step_${depIdx}` : depName;
        }),
        priority: idx + 1,
      }));

      // 将步骤注入 mission
      mission.plan = {
        id: `plan_${mission.id}`,
        missionId: mission.id,
        steps,
        estimatedDuration: currentVersion.steps.reduce(
          (sum, s) => sum + (s.timeoutMs || 60000), 0
        ),
        riskLevel: wf.successRate > 0.8 ? 'low' : 'medium',
        reasoning: `Auto-executed workflow "${wf.name}" v${wf.currentVersion}`,
      };

      // 4. 执行 Mission
      const result = await this.missionRuntime.executeMission(mission.id);

      const success = result.state !== 'FAILED';
      const duration = Date.now() - startTime;

      // 5. 记录执行结果到 Registry
      this.registry.recordExecution(workflowId, success, duration);

      // 6. 更新统计
      this.stats.totalExecuted++;
      if (success) this.stats.totalSuccess++;
      this.stats.totalDuration += duration;

      return {
        workflowId,
        missionId: mission.id,
        success,
        duration,
        output: result.output,
        error: result.error,
      };

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;

      this.registry.recordExecution(workflowId, false, duration);

      this.stats.totalExecuted++;
      this.stats.totalDuration += duration;

      return {
        workflowId,
        missionId: '',
        success: false,
        duration,
        error: errorMsg,
      };
    }
  }

  /**
   * canAutoExecute — 检查工作流是否可以自动执行
   *
   * @param workflowId - 工作流 ID
   */
  canAutoExecute(workflowId: string): boolean {
    return this.registry.getAutoExecutable().some(w => w.id === workflowId);
  }

  /**
   * executeAllAutoExecutable — 执行所有可自动执行的工作流
   *
   * 用于定时调度: 每天早上检查并执行到期的自动工作流。
   *
   * @returns 执行的数量
   */
  async executeAllAutoExecutable(): Promise<number> {
    const workflows = this.registry.getAutoExecutable();
    let executed = 0;

    // 分批次执行，防止系统过载
    const batches: RegisteredWorkflow[][] = [];
    for (let i = 0; i < workflows.length; i += this.config.maxParallel) {
      batches.push(workflows.slice(i, i + this.config.maxParallel));
    }

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(wf => this.execute(wf.id))
      );
      executed += results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    }

    return executed;
  }

  /**
   * executeScheduled — 执行到期的定期工作流
   *
   * 根据 suggestedFrequency 判断是否该执行:
   *   daily: 距上次执行 > 24h
   *   regular: 距上次执行 > 72h
   *   occasional: 距上次执行 > 168h (1周)
   *
   * @returns 执行的数量
   */
  async executeScheduled(): Promise<number> {
    const now = Date.now();
    const active = this.registry.getByStatus('active');
    let executed = 0;

    const scheduleChecks: Record<string, number> = {
      daily: 24 * 60 * 60 * 1000,
      regular: 3 * 24 * 60 * 60 * 1000,
      occasional: 7 * 24 * 60 * 60 * 1000,
    };

    for (const wf of active) {
      const frequency = (wf.metadata?.suggestedFrequency as string) || 'regular';
      const interval = scheduleChecks[frequency] || scheduleChecks.regular;

      if (!wf.lastExecutedAt || (now - wf.lastExecutedAt) > interval) {
        // 只执行成功率足够高的
        if (wf.successRate >= 0.8 || wf.executionCount < 3) {
          const result = await this.execute(wf.id);
          if (result.success) executed++;
        }
      }
    }

    return executed;
  }

  /**
   * getStats — 获取执行统计
   */
  getStats(): { totalExecuted: number; successRate: number; avgDuration: number } {
    return {
      totalExecuted: this.stats.totalExecuted,
      successRate: this.stats.totalExecuted > 0
        ? this.stats.totalSuccess / this.stats.totalExecuted
        : 0,
      avgDuration: this.stats.totalExecuted > 0
        ? Math.round(this.stats.totalDuration / this.stats.totalExecuted)
        : 0,
    };
  }
}
