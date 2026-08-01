/**
 * learning/LearningLoop — 学习循环聚合实现（S22 审计补全）
 *
 * 背景：BrainFacade.setLearningLoop 的 learningEngine 容器从未赋值，LearningLoopLike
 * 接口存在但无实现类。learning/ 目录的 ExperienceExtractor / PlanEvaluator /
 * StrategyOptimizer 三件套也从未被装配（死代码）。
 *
 * 本类聚合三件套为完整学习管线，满足 BrainFacade.LearningLoopLike：
 *   extractExperience → ExperienceExtractor（执行记录 → 经验）
 *   evaluatePlan      → PlanEvaluator（经验 → 计划评分）
 *   optimize          → StrategyOptimizer（评分历史 → 优化建议）
 *
 * 由 bootstrap 装配注入 BrainFacade（S22）。
 */

import { ExperienceExtractor, type ExecutionRecord, type Experience } from './ExperienceExtractor.js';
import { PlanEvaluator, type PlanEvaluation } from './PlanEvaluator.js';
import { StrategyOptimizer, type OptimizationSuggestion } from './StrategyOptimizer.js';
import type { LearningLoopLike } from '../../cognition/BrainFacade.js';

/** 宽松映射：Record → ExecutionRecord（缺失字段兜底） */
function toExecutionRecord(record: Record<string, unknown>): ExecutionRecord {
  const nodes = Array.isArray(record.nodes) ? (record.nodes as ExecutionRecord['nodes']) : [];
  return {
    executionId: String(record.executionId ?? record.id ?? record.taskId ?? `exec_${Date.now()}`),
    goal: String(record.goal ?? record.task ?? ''),
    planId: String(record.planId ?? record.plan ?? ''),
    nodes,
    success: Boolean(record.success ?? (record.result === 'success')),
    duration: Number(record.duration ?? 0),
    errors: Array.isArray(record.errors) ? (record.errors as string[]) : [],
    startTime: Number(record.startTime ?? Date.now()),
    endTime: Number(record.endTime ?? Date.now()),
  };
}

/** 判断对象是否满足 PlanEvaluation 形状（供 optimize 吸收） */
function isPlanEvaluation(v: unknown): v is PlanEvaluation {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.planId === 'string' && typeof o.score === 'number' && typeof o.goal === 'string';
}

export class LearningLoop implements LearningLoopLike {
  readonly name = 'LearningLoop';
  version = '1.0.0';

  private extractor: ExperienceExtractor;
  private evaluator: PlanEvaluator;
  private optimizer: StrategyOptimizer;
  private experiences: Experience[] = [];

  constructor() {
    this.extractor = new ExperienceExtractor();
    this.evaluator = new PlanEvaluator();
    this.optimizer = new StrategyOptimizer();
  }

  /** 执行记录 → 经验（提取模式/教训/成功率） */
  async extractExperience(record: Record<string, unknown>): Promise<Experience | null> {
    try {
      const exp = this.extractor.extract(toExecutionRecord(record));
      if (exp) this.experiences.push(exp);
      return exp;
    } catch {
      return null;
    }
  }

  /** 计划 → 评分（含经验提取 + 六维评估） */
  async evaluatePlan(plan: Record<string, unknown>): Promise<PlanEvaluation | null> {
    try {
      const record = toExecutionRecord({ ...plan, planId: plan.planId ?? plan.id, goal: plan.goal ?? plan.description });
      const exp = this.extractor.extract(record);
      const fallbackExp: Experience = {
        id: `exp_${Date.now()}`, goal: record.goal, goalType: 'plan', outcome: 'partial', duration: record.duration,
        patterns: [], lessons: [], nodeCount: record.nodes.length, errorCount: record.errors.length,
        successRate: record.success ? 1 : 0, timestamp: Date.now(),
      };
      const evalResult = this.evaluator.evaluate(exp ?? fallbackExp, record);
      this.optimizer.addEvaluation(evalResult);
      return evalResult;
    } catch {
      return null;
    }
  }

  /** 优化建议（吸收 insights 中类 PlanEvaluation 的补充评估） */
  async optimize(insights: unknown[]): Promise<OptimizationSuggestion[]> {
    for (const i of insights) {
      if (isPlanEvaluation(i)) this.optimizer.addEvaluation(i);
    }
    return this.optimizer.optimize();
  }

  /** 统计（供 getStats 聚合） */
  getStats(): { experiences: number; evaluations: number; suggestions: number } {
    return {
      experiences: this.experiences.length,
      evaluations: this.optimizer.getHistory().length,
      suggestions: this.optimizer.optimize().length,
    };
  }
}
