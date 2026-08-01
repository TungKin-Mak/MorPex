/**
 * PlanAnalyzer — 计划评估与优化引擎
 *
 * ═══════════════════════════════════════════════════════════════
 *  此文件合并了原 PlanEvaluator.ts + PlanOptimizer.ts。
 *  合并原因：PlanOptimizer 依赖 PlanEvaluator 的评分结果，
 *  两者共享 PlanSuggestion / PlanDimensionScores 等类型，
 *  且在 MetaPlanner 中总是成对调用。
 * ═══════════════════════════════════════════════════════════════
 *
 * 职责（原 PlanEvaluator）:
 *   1. 对单次执行记录进行多维度评分
 *   2. 对比历史趋势
 *   3. 生成优化建议
 *
 * 职责（原 PlanOptimizer）:
 *   4. 基于历史经验为新任务推荐最优 DAG 拓扑
 *   5. 失败模式驱动的自动计划修正
 *   6. 生成 LLM 可消费的优化 Prompt 注入
 *   7. 拓扑变体比较与优化排序
 *
 * 评分维度：
 *   - successRate:    是否成功 + 节点成功率
 *   - efficiency:     耗时是否优于同类模板均值
 *   - tokenEconomy:   Token 效率（产出/消耗比）
 *   - artifactUtility: 产物是否被下游消费
 *   - robustness:     自愈成功率
 *   - reusability:    模板匹配度
 *
 * 设计约束：
 *   - 评估部分纯函数，无副作用
 *   - 优化部分输出为建议（非强制执行），由 MetaPlanner 决策是否采纳
 *   - 所有分数归一化到 [0, 1]
 */

import type {
  PlanExecutionRecord,
  PlanEvaluation,
  PlanDimensionScores,
  PlanSuggestion,
  PlanTrend,
  PlanTemplate,
  PlanMatchResult,
  FailureDetail,
  FailureCategory,
  TopologySignature,
  TopologyVariantRecord,
  TopologyComparisonResult,
} from './types.js';
import type { PlanExperienceStore, FailurePatternReport } from './PlanExperienceStore.js';
import { DEFAULT_TOPOLOGY_COMPARISON_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════
// 评分常量化
// ═══════════════════════════════════════════════════════════════

/** 各维度权重 */
const DIMENSION_WEIGHTS: PlanDimensionScores = {
  successRate: 0.30,
  efficiency: 0.20,
  tokenEconomy: 0.15,
  artifactUtility: 0.15,
  robustness: 0.10,
  reusability: 0.10,
};

// ═══════════════════════════════════════════════════════════════
// PlanAnalyzer
// ═══════════════════════════════════════════════════════════════

export class PlanAnalyzer {
  private store: PlanExperienceStore;

  constructor(store: PlanExperienceStore) {
    this.store = store;
  }

  // ═══════════════════════════════════════════════════════════
  // 评估（原 PlanEvaluator）
  // ═══════════════════════════════════════════════════════════

  /**
   * evaluate — 评估单次执行记录
   *
   * @param record - 执行记录
   * @returns 评估结果
   */
  evaluate(record: PlanExecutionRecord): PlanEvaluation {
    const dimensions = this.computeDimensions(record);
    const overallScore = this.computeOverallScore(dimensions);
    const trend = this.computeTrend(record, dimensions);
    const suggestions = this.generateSuggestions(record, dimensions);

    // 更新记录的评分
    record.score = overallScore;

    return {
      evaluationId: `eval_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      recordId: record.recordId,
      executionId: record.executionId,
      overallScore,
      dimensions,
      trendVsHistory: trend,
      suggestions,
      evaluatedAt: Date.now(),
    };
  }

  /**
   * evaluateBatch — 批量评估（用于定期统计）
   */
  evaluateBatch(records: PlanExecutionRecord[]): PlanEvaluation[] {
    return records.map(r => this.evaluate(r));
  }

  // ── 维度计算 ──

  private computeDimensions(record: PlanExecutionRecord): PlanDimensionScores {
    return {
      successRate: this.scoreSuccessRate(record),
      efficiency: this.scoreEfficiency(record),
      tokenEconomy: this.scoreTokenEconomy(record),
      artifactUtility: this.scoreArtifactUtility(record),
      robustness: this.scoreRobustness(record),
      reusability: this.scoreReusability(record),
    };
  }

  /** 成功率维度 */
  private scoreSuccessRate(record: PlanExecutionRecord): number {
    if (!record.success) return 0;

    const totalNodes = record.dagNodes.length;
    if (totalNodes === 0) return 1;

    const successfulNodes = record.dagNodes.filter(
      n => n.status === 'success' || n.status === 'skipped',
    ).length;

    return successfulNodes / totalNodes;
  }

  /** 效率维度 */
  private scoreEfficiency(record: PlanExecutionRecord): number {
    const templates = this.store.getAllTemplates();
    if (templates.length === 0) return 0.5;

    const similarTemplates = templates.filter(
      t => t.tags.some(tag => record.inputTags.includes(tag)),
    );

    if (similarTemplates.length === 0) return 0.5;

    const avgDuration = similarTemplates.reduce((s, t) => s + t.avgDurationMs, 0) / similarTemplates.length;
    if (avgDuration === 0) return 0.5;

    const ratio = avgDuration / Math.max(record.totalDurationMs, 1);
    return Math.min(1, ratio);
  }

  /** Token 经济性维度 */
  private scoreTokenEconomy(record: PlanExecutionRecord): number {
    const totalNodes = record.dagNodes.length;
    if (totalNodes === 0) return 0.5;

    const avgTokensPerNode = record.totalTokensUsed / totalNodes;
    const pruningBonus = record.totalTokensUsed > 0
      ? record.pruningTokensSaved / (record.totalTokensUsed + record.pruningTokensSaved)
      : 0;

    const baseScore = Math.max(0, 1 - avgTokensPerNode / 50_000);
    return baseScore * 0.7 + pruningBonus * 0.3;
  }

  /** 产物效用维度 */
  private scoreArtifactUtility(record: PlanExecutionRecord): number {
    const totalArtifacts = record.dagNodes.reduce(
      (s, n) => s + n.artifactUris.length, 0,
    );

    if (totalArtifacts === 0) return 0.3;

    const artifactPerNode = totalArtifacts / Math.max(record.dagNodes.length, 1);
    return Math.min(1, artifactPerNode);
  }

  /** 鲁棒性维度 */
  private scoreRobustness(record: PlanExecutionRecord): number {
    if (!record.success) {
      return record.selfHealingRetries > 0 ? 0.3 : 0;
    }

    if (record.selfHealingRetries === 0) return 1;

    return Math.max(0.3, 1 - record.selfHealingRetries * 0.2);
  }

  /** 可复用性维度 */
  private scoreReusability(record: PlanExecutionRecord): number {
    if (!record.templateId) return 0.2;

    const template = this.store.getTemplate(record.templateId);
    if (!template) return 0.3;

    const usageScore = Math.min(1, template.usageCount / 20);
    const qualityScore = template.qualityScore;

    return usageScore * 0.4 + qualityScore * 0.6;
  }

  /** 综合评分 */
  private computeOverallScore(dimensions: PlanDimensionScores): number {
    return (
      dimensions.successRate * DIMENSION_WEIGHTS.successRate +
      dimensions.efficiency * DIMENSION_WEIGHTS.efficiency +
      dimensions.tokenEconomy * DIMENSION_WEIGHTS.tokenEconomy +
      dimensions.artifactUtility * DIMENSION_WEIGHTS.artifactUtility +
      dimensions.robustness * DIMENSION_WEIGHTS.robustness +
      dimensions.reusability * DIMENSION_WEIGHTS.reusability
    );
  }

  /** 趋势分析 */
  private computeTrend(
    record: PlanExecutionRecord,
    dimensions: PlanDimensionScores,
  ): PlanTrend {
    const recentRecords = this.store.queryRecent(10).filter(
      r => r.recordId !== record.recordId,
    );

    if (recentRecords.length === 0) {
      return { direction: 'stable', delta: 0, baselineCount: 0 };
    }

    const recentAvgScore = recentRecords.reduce((s, r) => s + r.score, 0) / recentRecords.length;
    const currentScore = this.computeOverallScore(dimensions);
    const delta = currentScore - recentAvgScore;

    let direction: PlanTrend['direction'];
    if (delta > 0.05) direction = 'improving';
    else if (delta < -0.05) direction = 'declining';
    else direction = 'stable';

    return { direction, delta, baselineCount: recentRecords.length };
  }

  /** 建议生成 */
  private generateSuggestions(
    record: PlanExecutionRecord,
    dimensions: PlanDimensionScores,
  ): PlanSuggestion[] {
    const suggestions: PlanSuggestion[] = [];

    if (dimensions.tokenEconomy < 0.3) {
      suggestions.push({
        type: 'reduce_parallelism',
        description: 'Token 消耗过高，建议启用 ContextPruner 并设置 maxTokensBudget',
        expectedImprovement: 0.3,
        confidence: 0.8,
      });
    }

    if (dimensions.efficiency < 0.3) {
      suggestions.push({
        type: 'increase_timeout',
        description: '执行效率偏低，考虑增加节点超时或减少并行度',
        expectedImprovement: 0.2,
        confidence: 0.6,
      });
    }

    if (record.failureDetails && record.failureDetails.length > 0) {
      const failurePatterns = this.analyzeFailurePatterns(record.failureDetails);
      for (const fp of failurePatterns) {
        suggestions.push({
          type: 'add_validation',
          targetNodeRole: fp.nodeId,
          description: `节点频繁失败 (${fp.category}): ${fp.suggestion}`,
          expectedImprovement: 0.15,
          confidence: 0.7,
        });
      }
    }

    if (dimensions.robustness < 0.4) {
      suggestions.push({
        type: 'switch_model',
        description: '自愈成功率偏低，建议配置降级模型',
        expectedImprovement: 0.2,
        confidence: 0.7,
      });
    }

    return suggestions;
  }

  private analyzeFailurePatterns(
    failures: FailureDetail[],
  ): Array<{ nodeId: string; category: string; suggestion: string }> {
    const patterns: Array<{ nodeId: string; category: string; suggestion: string }> = [];
    const seen = new Set<string>();

    for (const f of failures) {
      const key = `${f.nodeId}:${f.category}`;
      if (seen.has(key)) continue;
      seen.add(key);

      patterns.push({
        nodeId: f.nodeId,
        category: f.category,
        suggestion: this.getSuggestionForCategory(f.category),
      });
    }

    return patterns;
  }

  private getSuggestionForCategory(category: string): string {
    switch (category) {
      case 'llm_timeout': return '增加超时或使用更快模型';
      case 'token_exhaustion': return '启用 ContextPruner 或减少上下文';
      case 'validation_failure': return '在产出节点后添加验证步骤';
      case 'mcp_crash': return '启用 McpProcessGuard 自愈';
      default: return '检查节点日志';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 优化（原 PlanOptimizer）
  // ═══════════════════════════════════════════════════════════

  /**
   * recommendTemplate — 为给定输入推荐最优模板
   *
   * 返回排序后的匹配结果，最优者可直接用于实例化 DAG。
   */
  recommendTemplate(userInput: string, tags: string[]): PlanMatchResult[] {
    return this.store.findSimilarTemplates(userInput, tags);
  }

  /**
   * optimizeDAG — 基于历史数据优化 DAG 结构
   *
   * 输入当前 DAG 的节点骨架，返回优化建议。
   * 不修改原始 DAG，仅返回建议列表。
   */
  optimizeDAG(
    nodeRoles: string[],
    domain: string,
    tags: string[],
  ): PlanSuggestion[] {
    const suggestions: PlanSuggestion[] = [];

    // 1. 失败模式分析
    const failurePatterns = this.store.getFailurePatterns();
    const relevantFailures = failurePatterns.filter(
      fp => nodeRoles.includes(fp.nodeRole) || tags.some(t => fp.nodeRole.includes(t)),
    );

    for (const fp of relevantFailures.slice(0, 3)) {
      suggestions.push({
        type: 'add_validation',
        targetNodeRole: fp.nodeRole,
        description: `节点 "${fp.nodeRole}" 历史上 ${fp.occurrenceCount} 次失败 (${fp.category})。建议: ${fp.suggestedAction}`,
        expectedImprovement: Math.min(0.3, fp.occurrenceCount * 0.05),
        confidence: Math.min(0.9, fp.occurrenceCount * 0.1),
      });
    }

    // 2. 成功模板分析
    const allTemplates = this.store.getAllTemplates();
    const successfulTemplates = allTemplates.filter(
      t => t.successRate > 0.7 && t.usageCount >= 3,
    );

    for (const template of successfulTemplates.slice(0, 3)) {
      for (const skeleton of template.nodeSkeletons) {
        if (!nodeRoles.includes(skeleton.role) && skeleton.role !== '*') {
          const alreadySuggested = suggestions.some(
            s => s.targetNodeRole === skeleton.role,
          );
          if (!alreadySuggested) {
            suggestions.push({
              type: 'add_node',
              targetNodeRole: skeleton.role,
              description: `模板 "${template.name}" (成功率 ${(template.successRate * 100).toFixed(0)}%) 包含 "${skeleton.role}" 节点，建议添加`,
              expectedImprovement: template.successRate * 0.2,
              confidence: 0.6,
            });
          }
        }
      }
    }

    // 3. Token 效率优化
    const stats = this.store.getStats();
    if (stats.totalRecords > 10 && stats.avgTokensUsed > 100_000) {
      suggestions.push({
        type: 'reduce_parallelism',
        description: `历史平均 Token 消耗 ${stats.avgTokensUsed.toLocaleString()}，建议降低并行度以控制 Token 预算`,
        expectedImprovement: 0.15,
        confidence: 0.5,
      });
    }

    return suggestions;
  }

  /**
   * buildOptimizationPrompt — 构建可注入 LLM Planner 的优化提示
   *
   * 生成的 prompt 片段可直接追加到 Planner 的 system prompt 中。
   */
  buildOptimizationPrompt(userInput: string, tags: string[]): string {
    const parts: string[] = [];

    // 1. 推荐模板
    const matches = this.recommendTemplate(userInput, tags);
    if (matches.length > 0) {
      parts.push('## Historical Plan Templates (for reference)');
      for (const match of matches.slice(0, 3)) {
        const t = match.template;
        parts.push(
          `- **${t.name}**: ${t.nodeSkeletons.length} nodes, ` +
          `success rate ${(t.successRate * 100).toFixed(0)}%, ` +
          `avg ${(t.avgDurationMs / 1000).toFixed(1)}s, ` +
          `${t.usageCount} uses. Tags: ${t.tags.join(', ')}`,
        );
        if (match.suggestedAdjustments.length > 0) {
          for (const adj of match.suggestedAdjustments) {
            parts.push(`  - Suggestion: ${adj.description}`);
          }
        }
      }
      parts.push('');
    }

    // 2. 失败模式警告
    const failures = this.store.getFailurePatterns();
    const relevantFailures = failures.filter(
      fp => tags.some(t => fp.nodeRole.includes(t) || fp.category.includes(t as any)),
    );

    if (relevantFailures.length > 0) {
      parts.push('## Known Failure Patterns (avoid these)');
      for (const fp of relevantFailures.slice(0, 5)) {
        parts.push(
          `- **${fp.nodeRole}** (${fp.category}): ` +
          `occurred ${fp.occurrenceCount} times. Action: ${fp.suggestedAction}`,
        );
      }
      parts.push('');
    }

    // 3. 全局统计
    const stats = this.store.getStats();
    if (stats.totalRecords > 5) {
      parts.push('## Global Optimization Hints');
      parts.push(`- Overall success rate: ${(stats.successRate * 100).toFixed(0)}% (${stats.totalRecords} executions)`);
      parts.push(`- Recent success rate: ${(stats.recentSuccessRate * 100).toFixed(0)}% (last 20)`);
      parts.push(`- Average execution time: ${(stats.avgDurationMs / 1000).toFixed(1)}s`);
      parts.push(`- Average token usage: ${stats.avgTokensUsed.toLocaleString()}`);
      if (stats.totalTokensSaved > 0) {
        parts.push(`- Total tokens saved by pruning: ${stats.totalTokensSaved.toLocaleString()}`);
      }
      if (stats.totalSelfHealingRecoveries > 0) {
        parts.push(`- Total self-healing recoveries: ${stats.totalSelfHealingRecoveries}`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  /**
   * getModelRecommendation — 基于历史数据推荐模型选择
   */
  getModelRecommendation(tags: string[]): {
    recommendedProvider: string;
    recommendedModel: string;
    reason: string;
  } | null {
    const failures = this.store.getFailurePatterns();

    const llmFailures = failures.filter(
      fp => fp.category === 'llm_timeout' || fp.category === 'llm_hallucination',
    );

    if (llmFailures.length === 0) return null;

    const timeoutCount = llmFailures.filter(f => f.category === 'llm_timeout').length;
    const hallucinationCount = llmFailures.filter(f => f.category === 'llm_hallucination').length;

    if (hallucinationCount > timeoutCount) {
      return {
        recommendedProvider: 'deepseek',
        recommendedModel: 'deepseek-v4-flash',
        reason: `检测到 ${hallucinationCount} 次幻觉问题，建议使用低温度 (0.1-0.3) 的 DeepSeek 模型`,
      };
    }

    return {
      recommendedProvider: 'openai',
      recommendedModel: 'gpt-4o-mini',
      reason: `检测到 ${timeoutCount} 次超时，建议切换到更快的 OpenAI gpt-4o-mini`,
    };
  }

  /**
   * shouldSkipNode — 判断是否应该跳过某类节点
   */
  shouldSkipNode(nodeRole: string, tags: string[]): {
    shouldSkip: boolean;
    reason: string;
  } | null {
    const failures = this.store.getFailurePatterns();

    const relevantFailures = failures.filter(fp => fp.nodeRole === nodeRole);
    if (relevantFailures.length === 0) return null;

    const totalFailures = relevantFailures.reduce((s, f) => s + f.occurrenceCount, 0);

    if (totalFailures >= 5) {
      return {
        shouldSkip: true,
        reason: `节点 "${nodeRole}" 累计失败 ${totalFailures} 次，建议标记为 optional 或移除`,
      };
    }

    return null;
  }

  // ═════════════════════════════════════════════════════════════
  // Topology Variant Comparison
  // ═════════════════════════════════════════════════════════════

  /**
   * computeTopologySignature — Create a canonical signature from a DAG's
   * topological ordering.
   */
  computeTopologySignature(nodeRoles: string[], domains: string[]): TopologySignature {
    const nodeSequence = nodeRoles.map((role, i) => ({
      domain: domains[i] ?? 'general',
      role,
    }));
    const signature = nodeSequence
      .map(({ domain, role }) => `${domain}:${role}`)
      .join('→');
    return { signature, nodeSequence };
  }

  /**
   * buildTopologyVariants — Build topology variant records from the
   * PlanExperienceStore. Groups all execution records by their topological
   * ordering signature and computes success metrics per variant.
   */
  buildTopologyVariants(): TopologyVariantRecord[] {
    const variantMap = new Map<string, {
      signature: TopologySignature;
      totalAttempts: number;
      successes: number;
      totalDurationMs: number;
      totalTokens: number;
      lastAttemptedAt: number;
      sourceRecordIds: string[];
    }>();

    const allRecords = this.store.getAllRecords?.() ?? [];

    for (const record of allRecords) {
      if (!record.dagNodes || record.dagNodes.length === 0) continue;

      const roles = record.dagNodes.map(n => n.role || n.nodeId);
      const domains = record.dagNodes.map(n => n.domain || 'general');
      const sig = this.computeTopologySignature(roles, domains);

      const existing = variantMap.get(sig.signature) ?? {
        signature: sig,
        totalAttempts: 0,
        successes: 0,
        totalDurationMs: 0,
        totalTokens: 0,
        lastAttemptedAt: 0,
        sourceRecordIds: [],
      };

      existing.totalAttempts++;
      if (record.success) existing.successes++;
      existing.totalDurationMs += record.totalDurationMs || 0;
      existing.totalTokens += record.totalTokensUsed || 0;
      existing.lastAttemptedAt = Math.max(existing.lastAttemptedAt, record.createdAt || 0);
      existing.sourceRecordIds.push(record.recordId);

      variantMap.set(sig.signature, existing);
    }

    return Array.from(variantMap.values()).map(v => ({
      signature: v.signature,
      totalAttempts: v.totalAttempts,
      successes: v.successes,
      failures: v.totalAttempts - v.successes,
      successRate: v.totalAttempts > 0 ? v.successes / v.totalAttempts : 0,
      avgDurationMs: v.totalAttempts > 0 ? v.totalDurationMs / v.totalAttempts : 0,
      avgTokensUsed: v.totalAttempts > 0 ? v.totalTokens / v.totalAttempts : 0,
      lastAttemptedAt: v.lastAttemptedAt,
      sourceRecordIds: v.sourceRecordIds,
    }));
  }

  /**
   * compareTopologyVariants — Compare different topological orderings
   * of the SAME set of node roles.
   */
  compareTopologyVariants(
    nodeRoles: string[],
    domains: string[],
  ): TopologyComparisonResult {
    const allVariants = this.buildTopologyVariants();

    const nodeSetId = nodeRoles
      .map((r, i) => `${domains[i] ?? 'general'}:${r}`)
      .sort()
      .join(',');

    const matchingVariants = allVariants.filter(v => {
      const variantSet = v.signature.nodeSequence
        .map(n => `${n.domain}:${n.role}`)
        .sort()
        .join(',');
      return variantSet === nodeSetId;
    });

    const sorted = [...matchingVariants].sort((a, b) => b.successRate - a.successRate);

    const bestVariant = sorted.length > 0 ? sorted[0] : null;
    const worstVariant = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    let recommendedOrdering: string[] = [];
    if (bestVariant) {
      recommendedOrdering = bestVariant.signature.nodeSequence.map(n => n.role);
    }

    const totalAttempts = matchingVariants.reduce((s, v) => s + v.totalAttempts, 0);
    const config = DEFAULT_TOPOLOGY_COMPARISON_CONFIG;

    let confidence = 0;
    let isSignificant = false;

    if (totalAttempts >= config.minTotalAttempts && bestVariant && worstVariant) {
      const gap = bestVariant.successRate - worstVariant.successRate;
      confidence = Math.min(0.95, totalAttempts / 30 * 0.8);
      if (gap >= config.minSuccessGap) confidence += 0.1;
      if (gap >= 0.5) confidence += 0.05;

      isSignificant = gap >= config.minSuccessGap
        && bestVariant.successes >= config.minBestSuccesses;
    } else if (bestVariant) {
      confidence = Math.min(0.3, totalAttempts / config.minTotalAttempts * 0.3);
    }

    return {
      variants: sorted,
      bestVariant,
      worstVariant,
      totalVariants: matchingVariants.length,
      recommendedOrdering,
      confidence: Math.min(1, confidence),
      isSignificant,
    };
  }

  /**
   * suggestOptimalReorder — Generate a reorder suggestion based on
   * historical topology comparison.
   */
  suggestOptimalReorder(
    currentNodeRoles: string[],
    domains: string[],
  ): PlanSuggestion | null {
    const comparison = this.compareTopologyVariants(currentNodeRoles, domains);

    if (!comparison.isSignificant || !comparison.bestVariant) {
      return null;
    }

    const currentSig = this.computeTopologySignature(currentNodeRoles, domains);

    if (currentSig.signature === comparison.bestVariant.signature.signature) {
      return null;
    }

    return {
      type: 'reorder',
      targetNodeRole: currentNodeRoles[0],
      description: `历史数据显示执行顺序可优化：
当前顺序: ${currentSig.signature}
        成功率 ${this.getVariantRate(comparison.variants, currentSig.signature)}
推荐顺序: ${comparison.bestVariant.signature.signature}
        成功率 ${(comparison.bestVariant.successRate * 100).toFixed(1)}%
置信度: ${(comparison.confidence * 100).toFixed(0)}%`,
      expectedImprovement: comparison.bestVariant.successRate - this.getVariantRateValue(comparison.variants, currentSig.signature),
      confidence: comparison.confidence,
    };
  }

  private getVariantRate(variants: TopologyVariantRecord[], signature: string): string {
    const v = variants.find(v => v.signature.signature === signature);
    return v ? `${(v.successRate * 100).toFixed(1)}% (${v.successes}/${v.totalAttempts})` : '无数据';
  }

  private getVariantRateValue(variants: TopologyVariantRecord[], signature: string): number {
    const v = variants.find(v => v.signature.signature === signature);
    return v ? v.successRate : 0;
  }
}
