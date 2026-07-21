/**
 * WorkflowMiner — 工作流持续挖掘器
 *
 * Phase 5 / MorPex v8.5: 从完成的 Mission 历史中持续挖掘工作流候选。
 *
 * 职责:
 *   1. 定期扫描完成的 Mission
 *   2. 委托 WorkflowIntelligence 进行模式检测
 *   3. 过滤高置信度模式生成 WorkflowCandidate
 *   4. 避免重复发现 (跳过已在 Registry 中的模式)
 *
 * 与 WorkflowIntelligence 的分工:
 *   WorkflowIntelligence: 算法层 — detectPatterns / extractWorkflow
 *   WorkflowMiner: 调度层 — 何时挖掘、如何过滤、生成候选
 */

import { WorkflowIntelligence } from '../../cognition/workflow/WorkflowIntelligence.js';
import { WorkflowMemory } from '../../cognition/memory/WorkflowMemory.js';
import type { Mission } from '../../runtime/mission/types.js';
import type { WorkflowCandidate, WorkflowStepDef } from './types.js';
import type { WorkflowPattern } from '../../cognition/workflow/types.js';

/** 挖掘配置 */
export interface MiningConfig {
  /** 最小置信度 (0-1), 默认 0.6 */
  minConfidence: number;
  /** 最少 Mission 数, 默认 3 */
  minMissions: number;
  /** 最大候选数 (单次挖掘), 默认 10 */
  maxCandidates: number;
}

const DEFAULT_CONFIG: MiningConfig = {
  minConfidence: 0.6,
  minMissions: 3,
  maxCandidates: 10,
};

export class WorkflowMiner {
  private intelligence: WorkflowIntelligence;
  private memory: WorkflowMemory;
  private config: MiningConfig;

  /** 已知的模式名称 (避免重复发现) */
  private knownPatterns: Set<string> = new Set();

  /** 挖掘统计 */
  private stats = {
    totalMined: 0,
    lastMineTime: 0,
    candidatesFound: 0,
  };

  constructor(
    workflowMemory: WorkflowMemory,
    config?: Partial<MiningConfig>
  ) {
    this.memory = workflowMemory;
    this.intelligence = new WorkflowIntelligence(workflowMemory);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * mine — 从完成的 Mission 中挖掘候选工作流
   *
   * @param missions - 已完成的 Mission 列表
   * @param existingWorkflowNames - 已注册的工作流名称 (避免重复)
   * @returns WorkflowCandidate 列表
   */
  async mine(
    missions: Mission[],
    existingWorkflowNames: string[] = []
  ): Promise<WorkflowCandidate[]> {
    if (missions.length < this.config.minMissions) {
      return [];
    }

    // 记录已知名称
    for (const name of existingWorkflowNames) {
      this.knownPatterns.add(name.toLowerCase());
    }

    // 1. 使用 WorkflowIntelligence 检测模式
    const patterns = await this.intelligence.detectPatterns(missions);

    // 2. 过滤: 高置信度 + 不重复
    const candidates: WorkflowCandidate[] = [];
    for (const pattern of patterns) {
      if (pattern.confidence < this.config.minConfidence) continue;
      if (pattern.sourceMissions.length < this.config.minMissions) continue;
      if (this.knownPatterns.has(pattern.name.toLowerCase())) continue;

      // 3. 转换为 WorkflowCandidate
      const candidate = this.patternToCandidate(pattern);
      candidates.push(candidate);
      this.knownPatterns.add(pattern.name.toLowerCase());

      if (candidates.length >= this.config.maxCandidates) break;
    }

    // 4. 更新统计
    this.stats.totalMined++;
    this.stats.lastMineTime = Date.now();
    this.stats.candidatesFound += candidates.length;

    return candidates;
  }

  /**
   * shouldRemine — 判断是否有足够新数据重新挖掘
   *
   * @param lastMineTime - 上次挖掘时间
   * @param newMissionCount - 上次挖掘以来的新 Mission 数
   */
  shouldRemine(lastMineTime: number, newMissionCount: number): boolean {
    // 至少需要 minMissions 个新 mission 才值得重新挖掘
    return newMissionCount >= this.config.minMissions;
  }

  /**
   * getStats — 获取挖掘统计
   */
  getStats(): { totalMined: number; lastMineTime: number; candidatesFound: number } {
    return { ...this.stats };
  }

  /**
   * resetKnownPatterns — 重置已知模式列表 (重新发现所有)
   */
  resetKnownPatterns(): void {
    this.knownPatterns.clear();
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * patternToCandidate — 将 WorkflowPattern 转换为 WorkflowCandidate
   */
  private patternToCandidate(pattern: WorkflowPattern): WorkflowCandidate {
    const steps: WorkflowStepDef[] = pattern.steps.map((s, i) => ({
      name: s.name,
      description: s.description,
      domain: s.domain,
      agentType: s.agentType,
      deps: pattern.steps
        .filter((ps, pi) => pi < i && ps.order < s.order)
        .map(ps => ps.name),
      timeoutMs: s.averageDuration
        ? Math.round(s.averageDuration * 1.5)
        : undefined,
      retryCount: 2,
    }));

    return {
      name: pattern.name,
      description: pattern.description,
      steps,
      confidence: pattern.confidence,
      sourceMissionIds: pattern.sourceMissions,
      detectedAt: Date.now(),
      suggestedFrequency: this.inferFrequency(pattern.frequency),
    };
  }

  /**
   * inferFrequency — 从观察次数推断执行频率
   */
  private inferFrequency(frequency: number): WorkflowCandidate['suggestedFrequency'] {
    if (frequency >= 20) return 'daily';
    if (frequency >= 10) return 'regular';
    if (frequency >= 5) return 'occasional';
    return 'once';
  }
}
