/**
 * WorkflowOptimizer — 工作流持续优化器
 *
 * Phase 5 / MorPex v8.5: 基于执行性能数据持续优化工作流。
 *
 * 职责:
 *   1. 分析工作流执行性能
 *   2. 使用 WorkflowIntelligence 生成优化建议
 *   3. 应用优化 (创建新版本)
 *   4. 检测性能退化并自动触发重新优化
 */

import { WorkflowIntelligence } from '../../cognition/workflow/WorkflowIntelligence.js';
import { WorkflowMemory } from '../../cognition/memory/WorkflowMemory.js';
import { WorkflowRegistry } from './WorkflowRegistry.js';
import type { RegisteredWorkflow, WorkflowVersion, OptimizationPlan } from './types.js';
import type { OptimizationSuggestion } from '../../cognition/workflow/types.js';

/** 优化配置 */
export interface OptimizerConfig {
  /** 自动触发优化的最低执行次数 */
  minExecutionsForOptimization: number;
  /** 认为性能退化的阈值 (成功率下降百分点) */
  degradationThreshold: number;
  /** 最大优化建议数 */
  maxSuggestions: number;
}

const DEFAULT_CONFIG: OptimizerConfig = {
  minExecutionsForOptimization: 5,
  degradationThreshold: 0.15,
  maxSuggestions: 5,
};

export class WorkflowOptimizer {
  private intelligence: WorkflowIntelligence;
  private memory: WorkflowMemory;
  private registry: WorkflowRegistry;
  private config: OptimizerConfig;

  constructor(
    intelligence: WorkflowIntelligence,
    workflowMemory: WorkflowMemory,
    registry: WorkflowRegistry,
    config?: Partial<OptimizerConfig>
  ) {
    this.intelligence = intelligence;
    this.memory = workflowMemory;
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * analyze — 分析工作流性能，生成优化计划
   *
   * @param workflowId - 工作流 ID
   * @returns OptimizationPlan (含建议列表)
   */
  async analyze(workflowId: string): Promise<OptimizationPlan | null> {
    const wf = this.registry.get(workflowId);
    if (!wf || wf.executionCount < this.config.minExecutionsForOptimization) {
      return null;
    }

    // 获取当前版本步骤
    const currentVersion = wf.versions[wf.versions.length - 1];
    if (!currentVersion) return null;

    // 使用 WorkflowIntelligence 生成优化建议
    const suggestions = await this.intelligence.optimizeWorkflow(workflowId);

    // 过滤: 只保留高置信度的建议
    const highConfidence = suggestions.filter(s => s.confidence > 0.5);
    const topSuggestions = highConfidence.slice(0, this.config.maxSuggestions);

    if (topSuggestions.length === 0) return null;

    // 估算预期改进
    const expectedImprovement = this.estimateImprovement(topSuggestions);

    // 评估风险
    const risk = this.assessRisk(topSuggestions, wf);

    return {
      workflowId,
      suggestions: topSuggestions,
      expectedImprovement,
      risk,
    };
  }

  /**
   * applyOptimization — 应用优化计划 (创建新版本)
   *
   * @param workflowId - 工作流 ID
   * @param plan - 优化计划
   * @returns 更新后的 RegisteredWorkflow
   */
  async applyOptimization(
    workflowId: string,
    plan: OptimizationPlan
  ): Promise<RegisteredWorkflow | undefined> {
    const wf = this.registry.get(workflowId);
    if (!wf) return undefined;

    const currentVersion = wf.versions[wf.versions.length - 1];
    if (!currentVersion) return undefined;

    // 根据优化建议调整步骤
    const newSteps = [...currentVersion.steps];

    for (const suggestion of plan.suggestions) {
      switch (suggestion.type) {
        case 'parallelize': {
          // 如果两个连续步骤可以并行，移除前一步对后一步的依赖
          const [a, b] = suggestion.affectedSteps;
          const stepB = newSteps.find(s => s.name === b);
          if (stepB) {
            stepB.deps = stepB.deps.filter(d => d !== a);
          }
          break;
        }
        case 'merge': {
          // 合并两个步骤 (保留第一步，扩展其描述)
          const [first, second] = suggestion.affectedSteps;
          const stepA = newSteps.find(s => s.name === first);
          const stepB = newSteps.find(s => s.name === second);
          if (stepA && stepB) {
            stepA.description += `\n(合并: ${stepB.description})`;
            stepA.deps = [...new Set([...stepA.deps, ...stepB.deps.filter(d => d !== first)])];
            // 移除被合并的步骤
            const idx = newSteps.indexOf(stepB);
            newSteps.splice(idx, 1);
          }
          break;
        }
        case 'reorder': {
          // 调整步骤顺序 (在 affectedSteps 中按建议顺序)
          const [earlier, later] = suggestion.affectedSteps;
          const stepLater = newSteps.find(s => s.name === later);
          if (stepLater && !stepLater.deps.includes(earlier)) {
            stepLater.deps.push(earlier);
          }
          break;
        }
        case 'remove': {
          // 移除冗余步骤
          for (const name of suggestion.affectedSteps) {
            const idx = newSteps.findIndex(s => s.name === name);
            if (idx >= 0) {
              newSteps.splice(idx, 1);
              // 从依赖列表中移除
              for (const step of newSteps) {
                step.deps = step.deps.filter(d => d !== name);
              }
            }
          }
          break;
        }
      }
    }

    // 添加新版本
    const changeDescription = plan.suggestions
      .map(s => `[${s.type}] ${s.description}`)
      .join('; ');

    return this.registry.addVersion(workflowId, {
      createdAt: Date.now(),
      createdBy: 'system',
      changeDescription,
      steps: newSteps,
    });
  }

  /**
   * needsOptimization — 检测是否需要重新优化
   *
   * @param workflowId - 工作流 ID
   * @returns true 如果性能退化或数据充足
   */
  needsOptimization(workflowId: string): boolean {
    const wf = this.registry.get(workflowId);
    if (!wf || wf.executionCount < this.config.minExecutionsForOptimization) {
      return false;
    }

    // 检查性能退化
    if (wf.successRate < 0.7) return true;

    // 检查版本之间的退化
    const versions = wf.versions;
    if (versions.length >= 2) {
      const latest = versions[versions.length - 1].performance;
      const previous = versions[versions.length - 2].performance;
      if (latest && previous) {
        if (previous.successRate - latest.successRate > this.config.degradationThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * autoOptimize — 自动优化所有需要优化的活跃工作流
   *
   * @returns 优化的工作流数量
   */
  async autoOptimize(): Promise<number> {
    const active = this.registry.getByStatus('active');
    let optimized = 0;

    for (const wf of active) {
      if (this.needsOptimization(wf.id)) {
        const plan = await this.analyze(wf.id);
        if (plan) {
          await this.applyOptimization(wf.id, plan);
          optimized++;
        }
      }
    }

    return optimized;
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * estimateImprovement — 估算建议的预期改进百分比
   */
  private estimateImprovement(suggestions: OptimizationSuggestion[]): number {
    let improvement = 0;
    for (const s of suggestions) {
      switch (s.type) {
        case 'parallelize': improvement += 15; break;
        case 'merge': improvement += 10; break;
        case 'reorder': improvement += 5; break;
        case 'remove': improvement += 8; break;
        default: improvement += 3;
      }
    }
    return Math.min(improvement, 60); // 上限 60%
  }

  /**
   * assessRisk — 评估优化风险
   */
  private assessRisk(
    suggestions: OptimizationSuggestion[],
    wf: RegisteredWorkflow
  ): OptimizationPlan['risk'] {
    // 高成功率 + 多执行次数 = 高风险 (优化可能破坏现有的好表现)
    if (wf.successRate > 0.9 && wf.executionCount > 20) return 'high';
    if (wf.successRate > 0.8 && wf.executionCount > 10) return 'medium';
    return 'low';
  }
}
