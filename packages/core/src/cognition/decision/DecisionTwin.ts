/**
 * Decision Twin — 用户决策模式分析引擎
 *
 * P1 架构完善: 从决策历史中学习用户的决策模式、风险偏好、关键因素。
 *
 * 职责:
 *   1. 构建用户决策画像（buildProfile）
 *   2. 分析特定决策场景（analyze）
 *   3. 预测用户选择（predict）
 *   4. 提取常见决策因素（extractCommonFactors）
 *
 * 数据来源:
 *   - DecisionMemory: 存储的历史决策记录
 *   - PersonalTwinGraph: 用户孪生图谱中的决策节点（可选）
 *
 * 使用方式:
 *   const twin = new DecisionTwin(decisionMemory, personalTwinGraph);
 *   const profile = await twin.buildProfile('user_123');
 *   const analysis = await twin.analyze('选择编程语言', ['TypeScript', 'Python', 'Rust']);
 */

import { DecisionMemory } from '../memory/DecisionMemory.js';
import type { DecisionMemoryEntry } from '../memory/types.js';
import type { PersonalTwinGraph } from '../twin/PersonalTwinGraph.js';
import type { BehaviorTwin } from '../twin/BehaviorTwin.js';
import type {
  DecisionProfile,
  FactorSummary,
  DecisionAnalysis,
  DecisionPrediction,
  OutcomeRecord,
  FactorCorrelation,
  DecisionPath,
  BiasReport,
  DetectedBias,
  OutcomeFeedbackStats,
} from './types.js';

export class DecisionTwin {
  private decisionMemory: DecisionMemory;
  private twinGraph: PersonalTwinGraph | null;
  private behaviorTwin: BehaviorTwin | null;
  private outcomes: OutcomeRecord[] = [];

  constructor(decisionMemory: DecisionMemory, twinGraph?: PersonalTwinGraph, behaviorTwin?: BehaviorTwin) {
    this.decisionMemory = decisionMemory;
    this.twinGraph = twinGraph ?? null;
    this.behaviorTwin = behaviorTwin ?? null;
  }

  /**
   * buildProfile — 构建用户决策画像
   *
   * 从所有历史决策中提取：
   *   - 风险偏好（保守/适中/激进）
   *   - 常见决策因素（按权重排序）
   *   - 决策一致性评分
   *   - 信心指数（基于决策数量）
   *
   * @param userId - 用户 ID
   * @returns DecisionProfile
   */
  async buildProfile(userId: string): Promise<DecisionProfile> {
    const allDecisions = this.decisionMemory.getAll();
    const recentDecisions = allDecisions.length;

    // 提取所有决策因素
    const factorMap = this.extractCommonFactors(allDecisions);

    // 计算风险偏好
    const riskTolerance = this.assessRiskTolerance(allDecisions);

    // 计算一致性
    const consistency = this.calculateConsistency(allDecisions);

    // 计算信心指数（基于决策数量，最多 1.0）
    const confidence = Math.min(recentDecisions / 10, 1.0);

    return {
      userId,
      confidence,
      riskTolerance,
      commonFactors: factorMap.slice(0, 10),
      recentDecisions,
      consistency,
      lastUpdated: Date.now(),
    };
  }

  /**
   * analyze — 分析特定决策场景
   *
   * 找到相似的历史决策，推荐最可能的选择。
   *
   * @param context - 决策上下文描述
   * @param options - 可选项列表
   * @returns DecisionAnalysis
   */
  async analyze(context: string, options: string[]): Promise<DecisionAnalysis> {
    const allDecisions = this.decisionMemory.getAll();

    // 查找相似决策（上下文包含相同关键词）
    const keywords = context.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const similar = allDecisions.filter(d => {
      const ctx = d.decision?.context?.toLowerCase() ?? '';
      return keywords.some(k => ctx.includes(k));
    });

    // 从相似决策中提取推荐
    const similarDecisions = similar.slice(0, 5).map(d => ({
      context: d.decision?.context ?? d.content,
      chosen: d.decision?.chosen ?? 'unknown',
      outcome: d.decision?.outcome,
    }));

    // 从相似决策中提取建议因素
    const suggestedFactors = new Set<string>();
    for (const d of similar) {
      const factors = d.decision?.factors;
      if (factors && typeof factors === 'object') {
        Object.keys(factors).forEach((f: string) => suggestedFactors.add(f));
      }
    }

    // 风险评估
    const riskAssessment = this.assessRiskTolerance(allDecisions);
    const riskLevel: 'low' | 'medium' | 'high' = 
      riskAssessment === 'aggressive' ? 'high' :
      riskAssessment === 'conservative' ? 'low' : 'medium';

    return {
      context,
      recommendation: similarDecisions.length > 0
        ? `Based on ${similarDecisions.length} similar past decisions, consider: ${this.predictTopChoice(similarDecisions, options)}`
        : 'No sufficient historical data for recommendation',
      confidence: Math.min(similar.length / 3, 1.0),
      similarDecisions,
      riskAssessment: riskLevel,
      suggestedFactors: [...suggestedFactors],
    };
  }

  /**
   * predict — 预测用户会选择的选项
   *
   * 基于历史决策模式，为每个选项打分，预测最可能的选择。
   *
   * @param context - 决策上下文
   * @param options - 可选项列表
   * @returns DecisionPrediction
   */
  async predict(context: string, options: string[]): Promise<DecisionPrediction> {
    if (options.length === 0) {
      return {
        context,
        options: [],
        predictedChoice: 'No options provided',
        confidence: 0,
        reasoning: 'Empty option list',
        alternatives: [],
      };
    }

    const allDecisions = this.decisionMemory.getAll();
    const factorMap = this.extractCommonFactors(allDecisions);

    // 为每个选项计算得分
    const alternatives = options.map(option => {
      // 基础分 = 该选项在历史中的选择频率
      const historyCount = allDecisions.filter(d => {
        const chosen = d.decision?.chosen;
        return chosen?.toLowerCase() === option.toLowerCase();
      }).length;

      const baseScore = allDecisions.length > 0 ? historyCount / allDecisions.length : 0;

      // 加成分 = 与常见因素的匹配度
      const factorBonus = factorMap.reduce((sum, f) => sum + f.weight * 0.1, 0);

      const score = Math.min(baseScore + factorBonus, 1.0);

      return {
        option,
        score: Math.round(score * 100) / 100,
        reason: historyCount > 0
          ? `Chosen ${historyCount} time(s) before (${Math.round(baseScore * 100)}%)`
          : 'No historical preference for this option',
      };
    });

    // 按得分排序，取最高分
    alternatives.sort((a, b) => b.score - a.score);
    const top = alternatives[0];
    const confidence = Math.min(allDecisions.length / 5, 0.9) * top.score;

    const lowerBound = Math.max(0, confidence * 0.7);
    const upperBound = Math.min(1.0, confidence * 1.15 + 0.05);

    return {
      context,
      options,
      predictedChoice: top.option,
      confidence: Math.round(confidence * 100) / 100,
      confidenceInterval: {
        lower: Math.round(lowerBound * 100) / 100,
        upper: Math.round(upperBound * 100) / 100,
        confidenceLevel: 0.95,
      },
      reasoning: `Top choice based on ${allDecisions.length} past decisions and ${factorMap.length} tracked factors`,
      alternatives,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  /**
   * extractCommonFactors — 从决策历史中提取常见因素
   */
  private extractCommonFactors(decisions: DecisionMemoryEntry[]): FactorSummary[] {
    const factorCounts = new Map<string, { total: number; count: number; weights: number[] }>();

    for (const d of decisions) {
      const factors = d.decision?.factors;
      if (!factors || typeof factors !== 'object') continue;

      for (const [factor, weight] of Object.entries(factors)) {
        if (!factorCounts.has(factor)) {
          factorCounts.set(factor, { total: 0, count: 0, weights: [] });
        }
        const entry = factorCounts.get(factor)!;
        entry.total += (weight as number) || 0;
        entry.count++;
        entry.weights.push(weight as number);
      }
    }

    const summaries: FactorSummary[] = [];
    for (const [name, data] of factorCounts) {
      summaries.push({
        name,
        weight: data.count > 0 ? Math.round((data.total / data.count) * 100) / 100 : 0,
        frequency: data.count,
        trend: this.determineTrend(data.weights),
      });
    }

    summaries.sort((a, b) => b.weight - a.weight);
    return summaries;
  }

  /**
   * determineTrend — 判断因素权重的趋势
   */
  private determineTrend(weights: number[]): 'stable' | 'increasing' | 'decreasing' {
    if (weights.length < 3) return 'stable';

    const recent = weights.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const avgAll = weights.reduce((a, b) => a + b, 0) / weights.length;

    if (avgRecent > avgAll * 1.1) return 'increasing';
    if (avgRecent < avgAll * 0.9) return 'decreasing';
    return 'stable';
  }

  /**
   * assessRiskTolerance — 从历史决策评估风险偏好
   */
  private assessRiskTolerance(decisions: DecisionMemoryEntry[]): 'conservative' | 'moderate' | 'aggressive' {
    if (decisions.length < 3) return 'moderate';

    let riskScore = 0;
    let count = 0;

    for (const d of decisions) {
      const decision = d.decision;
      if (!decision) continue;

      // 检查选择是否偏向高风险选项
      const context = decision.context?.toLowerCase?.() ?? '';
      const chosen = decision.chosen?.toLowerCase?.() ?? '';

      // 关键词分析
      if (context.includes('risk') || context.includes('投资') || context.includes('冒险')) {
        if (chosen.includes('fast') || chosen.includes('quick') || chosen.includes('aggressive')) {
          riskScore += 1;
        } else if (chosen.includes('safe') || chosen.includes('stable') || chosen.includes('保守')) {
          riskScore -= 1;
        }
      }

      // 因素分析
      const factors = decision.factors;
      if (factors) {
        if (factors.performance && factors.performance > 0.7) riskScore += 0.5;
        if (factors.safety && factors.safety > 0.7) riskScore -= 0.5;
        if (factors.stability && factors.stability > 0.7) riskScore -= 0.3;
        if (factors.innovation && factors.innovation > 0.7) riskScore += 0.5;
      }

      count++;
    }

    const avgScore = count > 0 ? riskScore / count : 0;

    if (avgScore > 0.3) return 'aggressive';
    if (avgScore > -0.3) return 'moderate';
    return 'conservative';
  }

  /**
   * calculateConsistency — 计算决策一致性
   *
   * 基于相似场景中是否选择了相似的选项。
   */
  private calculateConsistency(decisions: DecisionMemoryEntry[]): number {
    if (decisions.length < 4) return 0.5; // 数据不足，返回中性值

    let consistentPairs = 0;
    let totalPairs = 0;

    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const d1 = decisions[i].decision;
        const d2 = decisions[j].decision;
        if (!d1 || !d2) continue;

        // 检查两个决策的上下文是否相似
        const ctx1 = d1.context?.toLowerCase?.() ?? '';
        const ctx2 = d2.context?.toLowerCase?.() ?? '';
        const keywords1 = ctx1.split(/\s+/).filter((w: string) => w.length > 3);
        const keywords2 = ctx2.split(/\s+/).filter((w: string) => w.length > 3);

        const overlap = keywords1.filter((k: string) => keywords2.includes(k));
        if (overlap.length >= 2) {
          // 相似上下文 — 检查选择是否一致
          totalPairs++;
          if (d1.chosen?.toLowerCase() === d2.chosen?.toLowerCase()) {
            consistentPairs++;
          }
        }
      }
    }

    return totalPairs > 0 ? consistentPairs / totalPairs : 0.5;
  }

  /**
   * predictTopChoice — 从相似决策中预测最可能的选择
   */
  private predictTopChoice(
    similarDecisions: Array<{ context: string; chosen: string; outcome?: string }>,
    options: string[]
  ): string {
    const counts = new Map<string, number>();
    for (const opt of options) counts.set(opt.toLowerCase(), 0);

    for (const d of similarDecisions) {
      const key = d.chosen.toLowerCase();
      if (counts.has(key)) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    let bestOption = options[0];
    let bestCount = 0;

    for (const [opt, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestOption = opt;
      }
    }

    return bestOption;
  }

  // ═══════════════════════════════════════════════════════════
  // v8.5 Phase 3: Outcome Feedback Loop
  // ═══════════════════════════════════════════════════════════

  /**
   * recordOutcome — 记录决策的实际结果，用于反馈学习
   */
  recordOutcome(context: string, chosen: string, actualOutcome: string, success: boolean): void {
    const outcome: OutcomeRecord = {
      context,
      chosen,
      actualOutcome,
      success,
      recordedAt: Date.now(),
      relatedFactors: this.extractFactorsFromContext(context),
    };
    this.outcomes.push(outcome);
  }

  /**
   * getOutcomes — 获取所有结果记录
   */
  getOutcomes(): OutcomeRecord[] {
    return [...this.outcomes];
  }

  /**
   * getOutcomeStats — 获取结果反馈统计
   */
  getOutcomeStats(): OutcomeFeedbackStats {
    if (this.outcomes.length === 0) {
      return { totalOutcomes: 0, successRate: 0, byOption: {} };
    }
    const byOption: Record<string, { total: number; success: number; rate: number }> = {};
    for (const o of this.outcomes) {
      if (!byOption[o.chosen]) byOption[o.chosen] = { total: 0, success: 0, rate: 0 };
      byOption[o.chosen].total++;
      if (o.success) byOption[o.chosen].success++;
      byOption[o.chosen].rate = Math.round((byOption[o.chosen].success / byOption[o.chosen].total) * 100) / 100;
    }
    const totalSuccess = this.outcomes.filter(o => o.success).length;
    return {
      totalOutcomes: this.outcomes.length,
      successRate: Math.round((totalSuccess / this.outcomes.length) * 100) / 100,
      byOption,
    };
  }

  /**
   * getSuccessFactors — 分析与成功结果相关的因素
   */
  getSuccessFactors(): FactorSummary[] {
    const successFactors = new Map<string, { total: number; successCount: number; weights: number[] }>();
    for (const outcome of this.outcomes) {
      for (const factor of outcome.relatedFactors) {
        if (!successFactors.has(factor)) {
          successFactors.set(factor, { total: 0, successCount: 0, weights: [] });
        }
        const entry = successFactors.get(factor)!;
        entry.total++;
        if (outcome.success) entry.successCount++;
        entry.weights.push(outcome.success ? 1 : 0);
      }
    }
    const summaries: FactorSummary[] = [];
    for (const [name, data] of successFactors) {
      summaries.push({
        name,
        weight: data.total > 0 ? Math.round((data.successCount / data.total) * 100) / 100 : 0,
        frequency: data.total,
        trend: data.weights.length >= 3 ? this.determineTrend(data.weights) : 'stable',
      });
    }
    summaries.sort((a, b) => b.weight - a.weight);
    return summaries;
  }

  // ═══════════════════════════════════════════════════════════
  // v8.5 Phase 3: Factor Correlation
  // ═══════════════════════════════════════════════════════════

  /**
   * analyzeFactorCorrelation — 分析因素间的共现相关性
   */
  analyzeFactorCorrelation(): FactorCorrelation[] {
    const allDecisions = this.decisionMemory.getAll();
    const factorPairs = new Map<string, { cooccurrence: number; a: string; b: string }>();
    const factorCounts = new Map<string, number>();

    for (const d of allDecisions) {
      const factors = d.decision?.factors;
      if (!factors || typeof factors !== 'object') continue;
      const names = Object.keys(factors);
      // 统计单因素出现次数
      for (const name of names) {
        factorCounts.set(name, (factorCounts.get(name) || 0) + 1);
      }
      // 统计因素对共现次数
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = [names[i], names[j]].sort().join('::');
          if (!factorPairs.has(key)) {
            factorPairs.set(key, { cooccurrence: 0, a: names[i], b: names[j] });
          }
          factorPairs.get(key)!.cooccurrence++;
        }
      }
    }

    const correlations: FactorCorrelation[] = [];
    for (const [, pair] of factorPairs) {
      const countA = factorCounts.get(pair.a) || 1;
      const countB = factorCounts.get(pair.b) || 1;
      // Jaccard-like similarity: cooccurrence / (countA + countB - cooccurrence)
      const jaccard = pair.cooccurrence / (countA + countB - pair.cooccurrence);
      if (jaccard > 0.1) { // 只保留有意义的关联
        correlations.push({
          factorA: pair.a,
          factorB: pair.b,
          correlation: Math.round(jaccard * 100) / 100,
          cooccurrenceCount: pair.cooccurrence,
          strength: jaccard > 0.5 ? 'strong' : jaccard > 0.3 ? 'moderate' : 'weak',
        });
      }
    }

    correlations.sort((a, b) => b.correlation - a.correlation);
    return correlations.slice(0, 20);
  }

  /**
   * getDecisionNetwork — 构建决策网络（选择→结果→频率）
   */
  getDecisionNetwork(): DecisionPath[] {
    const allDecisions = this.decisionMemory.getAll();
    const pathMap = new Map<string, { count: number; outcome?: string; success?: boolean }>();

    for (const d of allDecisions) {
      const decision = d.decision;
      if (!decision) continue;
      const pathKey = `${decision.context}|${decision.chosen}`;
      if (!pathMap.has(pathKey)) {
        pathMap.set(pathKey, { count: 0, outcome: decision.outcome });
      }
      const entry = pathMap.get(pathKey)!;
      entry.count++;
      // Check outcomes for success
      const matchedOutcome = this.outcomes.find(
        o => o.context === decision.context && o.chosen === decision.chosen
      );
      if (matchedOutcome) {
        entry.success = matchedOutcome.success;
      }
    }

    const paths: DecisionPath[] = [];
    for (const [key, data] of pathMap) {
      const [context, choice] = key.split('|');
      paths.push({ context, choice, outcome: data.outcome, success: data.success, frequency: data.count });
    }

    paths.sort((a, b) => b.frequency - a.frequency);
    return paths.slice(0, 30);
  }

  // ═══════════════════════════════════════════════════════════
  // v8.5 Phase 3: Bias Detection
  // ═══════════════════════════════════════════════════════════

  /**
   * detectBiases — 检测用户决策中的系统性偏差
   */
  detectBiases(): BiasReport {
    const biases: DetectedBias[] = [];
    const allDecisions = this.decisionMemory.getAll();

    // 1. Status Quo Bias: 总是选择同一种选项
    const choiceCounts = new Map<string, number>();
    for (const d of allDecisions) {
      const chosen = d.decision?.chosen;
      if (chosen) choiceCounts.set(chosen, (choiceCounts.get(chosen) || 0) + 1);
    }
    if (choiceCounts.size > 0) {
      const maxCount = Math.max(...choiceCounts.values());
      const total = allDecisions.length;
      if (total >= 5 && maxCount / total > 0.7) {
        const dominant = [...choiceCounts.entries()].find(([, c]) => c === maxCount)?.[0] || '';
        biases.push({
          type: 'status_quo',
          description: `Strongly prefers "${dominant}" (${maxCount}/${total} decisions)`,
          severity: maxCount / total > 0.85 ? 'high' : 'medium',
          evidence: `${dominant} chosen in ${Math.round((maxCount/total)*100)}% of cases`,
          affectedDecisions: maxCount,
        });
      }
    }

    // 2. Recency Bias: 最近的选择主导
    if (allDecisions.length >= 5) {
      const recent = allDecisions.slice(-3);
      const recentChoices = new Map<string, number>();
      for (const d of recent) {
        const chosen = d.decision?.chosen;
        if (chosen) recentChoices.set(chosen, (recentChoices.get(chosen) || 0) + 1);
      }
      const older = allDecisions.slice(0, -3);
      const olderChoices = new Map<string, number>();
      for (const d of older) {
        const chosen = d.decision?.chosen;
        if (chosen) olderChoices.set(chosen, (olderChoices.get(chosen) || 0) + 1);
      }
      for (const [choice, recentCount] of recentChoices) {
        const olderCount = olderChoices.get(choice) || 0;
        const recentRate = recentCount / recent.length;
        const olderRate = older.length > 0 ? olderCount / older.length : 0;
        if (recentRate > olderRate * 1.5 && older.length >= 5) {
          biases.push({
            type: 'recency',
            description: `Recent decisions increasingly favor "${choice}"`,
            severity: 'medium',
            evidence: `Recent: ${Math.round(recentRate*100)}% | Historical: ${Math.round(olderRate*100)}%`,
            affectedDecisions: recentCount,
          });
        }
      }
    }

    // 3. Overconfidence Bias: 数据少但预测置信度高
    if (allDecisions.length < 5 && allDecisions.length > 0) {
      biases.push({
        type: 'overconfidence',
        description: `Limited decision data (${allDecisions.length}) may lead to unreliable patterns`,
        severity: 'high',
        evidence: `Only ${allDecisions.length} decisions recorded`,
        affectedDecisions: allDecisions.length,
      });
    }

    // 4. Confirmation Bias: 同一场景下总是解释为同一因素
    const factorContexts = new Map<string, Set<string>>();
    for (const d of allDecisions) {
      const factors = d.decision?.factors;
      const context = d.decision?.context;
      if (!factors || !context) continue;
      for (const factor of Object.keys(factors)) {
        if (!factorContexts.has(factor)) factorContexts.set(factor, new Set());
        factorContexts.get(factor)!.add(context);
      }
    }
    for (const [factor, contexts] of factorContexts) {
      if (contexts.size === 1 && allDecisions.length >= 3) {
        biases.push({
          type: 'confirmation',
          description: `Factor "${factor}" only appears in one context — may be overapplied`,
          severity: 'low',
          evidence: `Factor appears in ${contexts.size} context(s) across ${allDecisions.length} decisions`,
          affectedDecisions: allDecisions.length,
        });
      }
    }

    // 综合评分
    const severityScores: Record<string, number> = { high: 30, medium: 20, low: 10 };
    const overallBiasScore = Math.min(
      biases.reduce((sum, b) => sum + (severityScores[b.severity] || 0), 0),
      100
    );

    // 建议
    const recommendations: string[] = [];
    for (const bias of biases) {
      switch (bias.type) {
        case 'status_quo':
          recommendations.push('Consider deliberately trying alternatives to avoid status quo bias.');
          break;
        case 'recency':
          recommendations.push('Review past successful choices before defaulting to recent preferences.');
          break;
        case 'overconfidence':
          recommendations.push('Seek more information before making decisions with limited data.');
          break;
        case 'confirmation':
          recommendations.push('Actively seek disconfirming evidence when evaluating options.');
          break;
      }
    }

    return { biases, overallBiasScore, recommendations: [...new Set(recommendations)] };
  }

  /**
   * extractFactorsFromContext — 从上下文提取因素关键词（辅助方法）
   */
  private extractFactorsFromContext(context: string): string[] {
    const allDecisions = this.decisionMemory.getAll();
    const factorSet = new Set<string>();
    for (const d of allDecisions) {
      const factors = d.decision?.factors;
      if (factors && typeof factors === 'object') {
        for (const factor of Object.keys(factors)) {
          const ctx = d.decision?.context?.toLowerCase() ?? '';
          if (ctx.includes(context.toLowerCase().substring(0, 10))) {
            factorSet.add(factor);
          }
        }
      }
    }
    return [...factorSet];
  }
}
