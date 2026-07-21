/**
 * ExecutionPolicyGenerator — 执行策略生成器
 *
 * 综合目标、约束、优先级、风险，生成执行策略。
 */
import type { StructuredGoal } from './GoalExtractor.js';
import type { Constraints } from './ConstraintAnalyzer.js';
import type { PriorityResult } from './PriorityEngine.js';
import type { Risk } from './RiskDetector.js';

export interface ExecutionPolicy {
  /** 策略模式 */
  mode: 'autonomous' | 'supervised' | 'step-by-step' | 'exploratory';
  /** 最大并行度 */
  maxParallelism: number;
  /** 是否需要人工确认 */
  requireHumanReview: boolean;
  /** 检查点频率 */
  checkpointFrequency: 'none' | 'per-step' | 'per-phase' | 'per-milestone';
  /** 错误处理策略 */
  errorStrategy: 'fail-fast' | 'retry' | 'fallback' | 'ignore';
  /** 回滚策略 */
  rollbackStrategy: 'none' | 'auto-rollback' | 'manual-rollback';
  /** 策略理由 */
  reasoning: string[];
}

export class ExecutionPolicyGenerator {
  /** 生成执行策略 */
  generate(
    goal: StructuredGoal,
    constraints: Constraints,
    priority: PriorityResult,
    risks: Risk[],
  ): ExecutionPolicy {
    const reasoning: string[] = [];

    // 决定模式
    const mode = this.determineMode(goal, constraints, priority, risks, reasoning);

    // 决定并行度
    const maxParallelism = this.determineParallelism(constraints, priority, reasoning);

    // 决定人工审查
    const requireHumanReview = this.determineReview(risks, priority, reasoning);

    // 决定检查点频率
    const checkpointFrequency = this.determineCheckpoint(risks, priority, reasoning);

    // 决定错误策略
    const errorStrategy = this.determineErrorStrategy(constraints, risks, reasoning);

    // 决定回滚策略
    const rollbackStrategy = this.determineRollback(risks, reasoning);

    return { mode, maxParallelism, requireHumanReview, checkpointFrequency, errorStrategy, rollbackStrategy, reasoning };
  }

  private determineMode(
    goal: StructuredGoal, constraints: Constraints, priority: PriorityResult, risks: Risk[], reasoning: string[],
  ): ExecutionPolicy['mode'] {
    if (risks.some(r => r.severity === 'critical')) {
      reasoning.push('Critical risks detected → step-by-step mode');
      return 'step-by-step';
    }
    if (priority.label === 'critical' || priority.label === 'high') {
      if (goal.type === 'analyze') {
        reasoning.push('High priority analysis → exploratory mode');
        return 'exploratory';
      }
      reasoning.push('High priority → supervised mode');
      return 'supervised';
    }
    if (goal.type === 'learn') {
      reasoning.push('Learning goal → exploratory mode');
      return 'exploratory';
    }
    if (goal.subGoals.length <= 2 && constraints.time.length === 0) {
      reasoning.push('Simple, low-risk task → autonomous mode');
      return 'autonomous';
    }
    reasoning.push('Default: step-by-step for safety');
    return 'step-by-step';
  }

  private determineParallelism(constraints: Constraints, priority: PriorityResult, reasoning: string[]): number {
    if (constraints.quality.some(q => /test|coverage/.test(q))) {
      reasoning.push('Quality constraints limit parallelism to 1');
      return 1;
    }
    if (priority.label === 'critical') {
      reasoning.push('Critical priority → limited to 2 parallel');
      return 2;
    }
    reasoning.push('Standard: 3 parallel tasks');
    return 3;
  }

  private determineReview(risks: Risk[], priority: PriorityResult, reasoning: string[]): boolean {
    if (risks.some(r => r.type === 'security' && r.severity === 'critical')) {
      reasoning.push('Security risks require human review');
      return true;
    }
    if (priority.label === 'critical') {
      reasoning.push('Critical priority benefits from human oversight');
      return true;
    }
    return false;
  }

  private determineCheckpoint(risks: Risk[], priority: PriorityResult, reasoning: string[]): ExecutionPolicy['checkpointFrequency'] {
    if (risks.some(r => r.severity === 'critical')) {
      reasoning.push('Critical risks → checkpoint per step');
      return 'per-step';
    }
    if (priority.label === 'critical' || priority.label === 'high') {
      reasoning.push('High priority → checkpoint per phase');
      return 'per-phase';
    }
    return 'per-milestone';
  }

  private determineErrorStrategy(constraints: Constraints, risks: Risk[], reasoning: string[]): ExecutionPolicy['errorStrategy'] {
    if (constraints.quality.some(q => /critical|production|live/.test(q))) {
      reasoning.push('Production-critical → retry on failure');
      return 'retry';
    }
    if (risks.some(r => r.severity === 'critical')) {
      reasoning.push('High risk → fail-fast');
      return 'fail-fast';
    }
    reasoning.push('Standard: fallback allowed');
    return 'fallback';
  }

  private determineRollback(risks: Risk[], reasoning: string[]): ExecutionPolicy['rollbackStrategy'] {
    if (risks.some(r => r.type === 'security' && r.severity === 'critical')) {
      reasoning.push('Security risk → auto-rollback');
      return 'auto-rollback';
    }
    if (risks.length > 0) {
      reasoning.push('Some risks → manual rollback');
      return 'manual-rollback';
    }
    return 'none';
  }
}
