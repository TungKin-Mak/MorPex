/**
 * learning/LearningLoop — L4 单一学习入口（Wave 8c P1-1 合并：原 LearningLoop + MetaLearner）
 *
 * 背景：BrainFacade 原有两个学习槽（learningLoop 程序性 + metaLearner 声明性），
 * 由 bootstrap 双路径喂入（事件订阅 + Facade.learn），构成"多入口学习"。
 * 本类合并两者为单一 L4 学习入口：
 *   - 程序性学习：extractExperience → ExperienceExtractor（执行记录 → 经验）
 *                   evaluatePlan   → PlanEvaluator（经验 → 计划评分）
 *                   optimize       → StrategyOptimizer（评分历史 → 优化建议）
 *   - 声明性学习：learnFromTask  → 偏好模型 + 部门模式 + 用户反馈（原 MetaLearner）
 *
 * 设计约束：不直接触发生产变更；只沉淀知识/偏好；事件（brain.meta.learned）仅作可观测信号。
 */

import { EventBus } from '../../infrastructure/common/EventBus.js';
import { ExperienceExtractor, type ExecutionRecord, type Experience } from './ExperienceExtractor.js';
import { PlanEvaluator, type PlanEvaluation } from './PlanEvaluator.js';
import { StrategyOptimizer, type OptimizationSuggestion } from './StrategyOptimizer.js';
import type { LearningLoopLike } from '../../cognition/BrainFacade.js';

// ── 声明性学习类型（原 MetaLearner） ──

export interface TaskRecord {
  taskId: string;
  goal: string;
  result: 'success' | 'failure';
  duration: number;
  departmentId?: string;
  planUsed?: string;
  capabilities?: string[];
}

export interface UserFeedback {
  rating: number; // 1-5
  comments?: string;
  corrections?: string;
}

export interface LearningResult {
  preferencesUpdated: boolean;
  patternsLearned: number;
  confidenceDelta: number;
  insights: string[];
}

interface DepartmentPattern {
  successRate: number;
  avgDuration: number;
  commonTasks: string[];
  taskCount: number;
  successCount: number;
}

interface PreferenceModel {
  preferredPlanMode: 'quick' | 'full' | 'auto';
  preferredCapabilities: string[];
  departmentPatterns: Map<string, DepartmentPattern>;
  userRatingHistory: number[];
  lastUpdated: number;
}

// ── 程序性学习辅助 ──

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

  // 程序性（经验/计划/策略）
  private extractor: ExperienceExtractor;
  private evaluator: PlanEvaluator;
  private optimizer: StrategyOptimizer;
  private experiences: Experience[] = [];

  // 声明性（偏好/部门模式）
  private eventBus?: EventBus;
  private model: PreferenceModel;

  constructor(eventBus?: EventBus) {
    this.extractor = new ExperienceExtractor();
    this.evaluator = new PlanEvaluator();
    this.optimizer = new StrategyOptimizer();
    this.eventBus = eventBus;
    this.model = {
      preferredPlanMode: 'auto',
      preferredCapabilities: [],
      departmentPatterns: new Map(),
      userRatingHistory: [],
      lastUpdated: Date.now(),
    };
  }

  // ══════════ 程序性学习（原 LearningLoop） ══════════

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

  // ══════════ 声明性学习（原 MetaLearner） ══════════

  /** 任务 → 偏好/部门模式（学习成功路径与反馈） */
  async learnFromTask(task: TaskRecord, feedback?: UserFeedback): Promise<LearningResult> {
    const changes: string[] = [];
    let preferencesUpdated = false;

    if (task.departmentId) {
      this.updateDepartmentPattern(task);
      changes.push('department_pattern_updated');
    }

    if (feedback) {
      this.model.userRatingHistory.push(feedback.rating);
      if (feedback.rating >= 4 && task.result === 'success') {
        this.model.preferredPlanMode = task.planUsed === 'full' ? 'full' : 'quick';
        preferencesUpdated = true;
        changes.push('plan_mode_preference_updated');
      }
      if (feedback.corrections) {
        changes.push('user_correction_received');
      }
    }

    if (task.capabilities && task.result === 'success') {
      for (const cap of task.capabilities) {
        if (!this.model.preferredCapabilities.includes(cap)) {
          this.model.preferredCapabilities.push(cap);
        }
      }
      changes.push('capabilities_extended');
    }

    this.model.lastUpdated = Date.now();

    this.eventBus?.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'brain.meta.learned',
      timestamp: Date.now(),
      executionId: task.taskId,
      source: 'meta-learner',
      payload: {
        taskId: task.taskId,
        result: task.result,
        preferencesUpdated,
        patternsLearned: changes.length,
        changes,
      },
    });

    return {
      preferencesUpdated,
      patternsLearned: changes.length,
      confidenceDelta: feedback ? (feedback.rating - 3) / 5 : 0,
      insights: changes,
    };
  }

  private updateDepartmentPattern(task: TaskRecord): void {
    const deptId = task.departmentId!;
    let pattern = this.model.departmentPatterns.get(deptId);

    if (!pattern) {
      pattern = { successRate: 0, avgDuration: 0, commonTasks: [], taskCount: 0, successCount: 0 };
      this.model.departmentPatterns.set(deptId, pattern);
    }

    pattern.taskCount++;
    if (task.result === 'success') pattern.successCount++;
    pattern.successRate = pattern.successCount / pattern.taskCount;
    pattern.avgDuration = (pattern.avgDuration * (pattern.taskCount - 1) + task.duration) / pattern.taskCount;

    const goalPrefix = task.goal.substring(0, 20);
    if (!pattern.commonTasks.includes(goalPrefix)) {
      pattern.commonTasks.push(goalPrefix);
      if (pattern.commonTasks.length > 20) pattern.commonTasks.shift();
    }
  }

  getPreferenceModel(): Readonly<PreferenceModel> {
    return this.model;
  }

  getDepartmentPattern(deptId: string): DepartmentPattern | undefined {
    return this.model.departmentPatterns.get(deptId);
  }

  /** 统计（程序性 + 声明性，合并自原 MetaLearner.getStats） */
  getStats(): { experiences: number; evaluations: number; suggestions: number; totalDepartments: number; userFeedbackCount: number; preferredMode: string } {
    return {
      experiences: this.experiences.length,
      evaluations: this.optimizer.getHistory().length,
      suggestions: this.optimizer.optimize().length,
      totalDepartments: this.model.departmentPatterns.size,
      userFeedbackCount: this.model.userRatingHistory.length,
      preferredMode: this.model.preferredPlanMode,
    };
  }
}
