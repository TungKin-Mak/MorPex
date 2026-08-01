/**
 * ReliabilityMetrics — 可靠性指标定义 (v8.9)
 *
 * 衡量工作流执行的可信度。
 */

export interface ReliabilityMetrics {
  workflowId: string
  successRate: number
  failureRate: number
  recoveryRate: number
  avgRecoveryTime: number
  humanIntervention: number
  retryCount: number
  chaosTestResults: { total: number; passed: number; avgRecoveryRate: number }
  replayAccuracy: number
  regressionPassRate: number
  /** ★ v8.9.1: 安全评分 (0-1), 基于领域/工具/故障严重度评估 */
  safetyScore: number
  /** ★ v8.9.1: 金丝雀放量评分 (0-1) */
  canaryScore: number
}

/**
 * 最终公式: ProductionScore = QualityScore × ReliabilityScore × SafetyScore
 *
 * 三个维度相乘确保:
 *   - 高质量但高风险 → 低 SafetyScore → 被降权
 *   - 低质量但低风险 → 低 QualityScore → 被降权
 *   - 只有三项都高 → 高 ProductionScore
 */
export function computeProductionScore(
  qualityScore: number,
  reliabilityScore: number,
  safetyScore: number,
): number {
  return Math.round(qualityScore * reliabilityScore * safetyScore * 1000) / 1000
}

/**
 * SafetyScore — 安全评分 (v8.9.2 multiplicative model)
 *
 * 乘法模型: 补偿能力不能完全抵消风险。
 *   即使可以恢复备份，删除生产数据库的风险仍然存在。
 *
 * 公式:
 *   SafetyScore = (1 - domainRisk) × (1 - toolRisk) × (1 - failureSeverity) × (1 + compensationCapability × 0.1)
 *
 * 示例:
 *   finance(0.9) × delete(0.9) × dataLoss(0.95) × compensation(0.8)
 *   = (0.1) × (0.1) × (0.05) × (1.08) = 0.00054 ← 几乎为 0，正确！
 *
 *   coding(0.3) × read(0.1) × timeout(0.3) × compensation(0.5)
 *   = (0.7) × (0.9) × (0.7) × (1.05) = 0.463 ← 安全
 *
 * @param params - 风险评估参数
 */
export function computeSafetyScore(params: {
  domainRisk: number              // 0-1 (finance=1, coding=0.3)
  toolRisk: number                // 0-1 (delete=1, read=0.1)
  failureSeverity: number         // 0-1 (data loss=1, timeout=0.3)
  compensationCapability: number  // 0-1 (有完整 Saga=1, 无补偿=0)
}): number {
  const baseSafety = (1 - params.domainRisk) * (1 - params.toolRisk) * (1 - params.failureSeverity)
  const recoveryModifier = 1 + params.compensationCapability * 0.1
  const score = baseSafety * recoveryModifier
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
}
