/**
 * ReliabilityScorer — 可靠性评分器 (v8.9)
 *
 * 计算工作流的可靠性和生产就绪度评分。
 *
 * ProductionScore = QualityScore × ReliabilityScore
 *
 * 评分阈值:
 *   A (优秀): >= 0.9
 *   B (良好): >= 0.75
 *   C (合格): >= 0.6
 *   D (需改进): >= 0.4
 *   F (不可用): < 0.4
 */

import type { ReliabilityMetrics } from './ReliabilityMetrics.js'

export class ReliabilityScorer {
  calculate(m: ReliabilityMetrics): number {
    const score =
      m.successRate * 0.4 +
      m.recoveryRate * 0.3 +
      (1 - m.failureRate) * 0.2 +
      (1 - m.humanIntervention) * 0.1

    return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
  }

  calculateProductionScore(qualityScore: number, reliabilityScore: number, safetyScore: number = 1): number {
    return Math.round(qualityScore * reliabilityScore * safetyScore * 1000) / 1000
  }

  isProductionReady(productionScore: number): boolean {
    return productionScore >= 0.85
  }

  /** ★ v8.9.2: 乘法模型安全评分 (补偿不能完全抵消风险) */
  computeSafety(params: {
    domainRisk: number
    toolRisk: number
    failureSeverity: number
    compensationCapability: number
  }): number {
    const baseSafety = (1 - params.domainRisk) * (1 - params.toolRisk) * (1 - params.failureSeverity)
    const recoveryModifier = 1 + params.compensationCapability * 0.1
    const score = baseSafety * recoveryModifier
    return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
  }

  needsImprovement(productionScore: number): boolean {
    return productionScore < 0.6
  }

  getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 0.9) return 'A'
    if (score >= 0.75) return 'B'
    if (score >= 0.6) return 'C'
    if (score >= 0.4) return 'D'
    return 'F'
  }
}
