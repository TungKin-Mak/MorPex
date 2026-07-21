/**
 * CognitivePipeline — 认知流水线
 *
 * MorPex v8.6: 替代 CognitiveLoop God Object，将 9 个阶段拆分为独立 Stage。
 *
 * 设计原则:
 *   1. 每个 Stage 只做一件事（Single Responsibility）
 *   2. 通过 CognitiveContext 传递状态（无共享可变状态）
 *   3. 每个 Stage 可以独立测试
 *   4. Control Plane 模块（RiskAnalyzer/PolicyEngine/AuditTrail）作为横切注入点
 *
 * 使用方式:
 *   const pipeline = new CognitivePipeline([
 *     new IntentStage(eventBus),
 *     new GoalStage(goalManager),
 *     new TwinStage(behaviorTwin, decisionTwin, preferenceModel),
 *     new PlanningStage(missionRuntime, plannerConstraint),
 *     new ExecutionStage(missionRuntime),
 *     new LearningStage(brain, behaviorTwin, decisionTwin),
 *     new EvolutionStage(workflowMiner, workflowRegistry, workflowSimulator),
 *     new PersistenceStage(brainPersistor),
 *   ]);
 *   const result = await pipeline.process(message);
 */

import { EventBus } from '../../common/EventBus.js';
import type { IncomingMessage } from '../../interaction/types.js';
import type { CognitiveContext, CognitivePhase } from './types.js';

// ═══════════════════════════════════════════════════════════════
// CognitiveStage 接口
// ═══════════════════════════════════════════════════════════════

/**
 * CognitiveStage — 认知流水线中单个阶段的接口
 *
 * 每个 Stage 接收 CognitiveContext，执行自己的逻辑，返回更新后的 context。
 * 阶段可以访问 EventBus 用于发射事件，也可以注入 Control Plane 模块。
 */
export interface CognitiveStage {
  /** 阶段名称（用于日志/追踪） */
  readonly name: string;

  /**
   * execute — 执行本阶段逻辑
   *
   * @param ctx - 当前认知上下文（包含之前所有阶段的结果）
   * @param bus - EventBus 引用（用于发射阶段事件）
   * @returns 更新后的 CognitiveContext
   */
  execute(ctx: CognitiveContext, bus: EventBus): Promise<CognitiveContext>;
}

// ═══════════════════════════════════════════════════════════════
// CognitivePipeline
// ═══════════════════════════════════════════════════════════════

export class CognitivePipeline {
  private stages: CognitiveStage[];
  private bus: EventBus;

  /**
   * @param stages - 按执行顺序排列的阶段列表
   * @param bus - EventBus 实例
   */
  constructor(stages: CognitiveStage[], bus: EventBus) {
    this.stages = stages;
    this.bus = bus;
  }

  /**
   * process — 按顺序执行所有阶段
   *
   * 每个阶段接收上一个阶段的输出，执行后更新 context。
   * 任何阶段抛出异常都会中止流水线，context 标记为 failed。
   *
   * @param msg - 用户消息
   * @returns 完整的 CognitiveContext
   */
  async process(msg: IncomingMessage): Promise<CognitiveContext> {
    const ctx: CognitiveContext = {
      message: msg,
      intent: { goal: '', keywords: [], confidence: 0, isNewGoal: false },
      matchedGoals: [],
      behaviorProfile: null,
      decisionProfile: null,
      preferenceProfile: null,
      mission: null,
      result: null,
      startedAt: Date.now(),
      phase: 'pipeline_start',
      errors: [],
    };

    for (const stage of this.stages) {
      ctx.phase = stage.name as CognitivePhase;
      try {
        const updated = await stage.execute(ctx, this.bus);
        // Merge updated fields back into ctx
        Object.assign(ctx, updated);
      } catch (err: any) {
        ctx.errors.push(`[${stage.name}] ${err?.message || String(err)}`);
        ctx.phase = 'failed';
        break;
      }
    }

    if (ctx.phase !== 'failed') {
      ctx.phase = 'completed';
    }
    ctx.completedAt = Date.now();
    return ctx;
  }

  /**
   * getStages — 获取当前注册的阶段列表
   */
  getStages(): ReadonlyArray<CognitiveStage> {
    return [...this.stages];
  }

  /**
   * getStage — 按名称获取阶段实例
   *
   * @param name - 阶段名称
   */
  getStage(name: string): CognitiveStage | undefined {
    return this.stages.find(s => s.name === name);
  }

  /**
   * getStats — 获取流水线统计
   */
  getStats(): { stageCount: number; stageNames: string[] } {
    return {
      stageCount: this.stages.length,
      stageNames: this.stages.map(s => s.name),
    };
  }
}
