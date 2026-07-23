/**
 * QualityScore — 质量评分引擎
 *
 * MorPex v10 — 蓝图 §6 五维评分公式:
 *   30% Execution correctness  (执行正确性)
 *   20% Policy compliance       (策略合规性)
 *   20% Artifact quality        (产物质量)
 *   15% Efficiency              (执行效率)
 *   15% Recovery capability     (恢复能力)
 *
 * 等级:
 *   A (90-100): 优秀
 *   B (75-89):  良好
 *   C (50-74):  及格
 *   D (<50):    不及格
 *
 * 向后兼容: 保留旧 3 维权重构造器参数，但默认使用蓝图 5 维公式。
 */

import type { ComparisonResult, QualityScore, Grade } from './types.js';

// ── 蓝图 §6 权重常量 ──

const BLUEPRINT_WEIGHTS = {
  executionCorrectness: 0.30,
  policyCompliance: 0.20,
  artifactQuality: 0.20,
  efficiency: 0.15,
  recoveryCapability: 0.15,
} as const;

// ── QualityScoreEngine (蓝图版) ──

export class QualityScoreEngine {
  private executionCorrectnessWeight: number;
  private policyComplianceWeight: number;
  private artifactQualityWeight: number;
  private efficiencyWeight: number;
  private recoveryCapabilityWeight: number;

  constructor(config?: {
    executionCorrectnessWeight?: number;
    policyComplianceWeight?: number;
    artifactQualityWeight?: number;
    efficiencyWeight?: number;
    recoveryCapabilityWeight?: number;
  }) {
    this.executionCorrectnessWeight = config?.executionCorrectnessWeight ?? BLUEPRINT_WEIGHTS.executionCorrectness;
    this.policyComplianceWeight = config?.policyComplianceWeight ?? BLUEPRINT_WEIGHTS.policyCompliance;
    this.artifactQualityWeight = config?.artifactQualityWeight ?? BLUEPRINT_WEIGHTS.artifactQuality;
    this.efficiencyWeight = config?.efficiencyWeight ?? BLUEPRINT_WEIGHTS.efficiency;
    this.recoveryCapabilityWeight = config?.recoveryCapabilityWeight ?? BLUEPRINT_WEIGHTS.recoveryCapability;

    // 验证权重总和
    const total = this.executionCorrectnessWeight + this.policyComplianceWeight
      + this.artifactQualityWeight + this.efficiencyWeight + this.recoveryCapabilityWeight;
    if (Math.abs(total - 1) > 0.001) {
      console.warn(`[QualityScoreEngine] Weights sum to ${total}, normalizing...`);
      const factor = 1 / total;
      this.executionCorrectnessWeight *= factor;
      this.policyComplianceWeight *= factor;
      this.artifactQualityWeight *= factor;
      this.efficiencyWeight *= factor;
      this.recoveryCapabilityWeight *= factor;
    }
  }

  /**
   * score — 蓝图 §6 五维聚合评分
   *
   * @param missionId - Mission ID
   * @param comparisonResults - 轨迹比对结果列表
   * @param extras - 可选: { policyScore, artifactQualityScore, recoveryScore }
   *                  若未提供则从 comparisonResults 中提取降级值
   * @returns QualityScore
   */
  score(
    missionId: string,
    comparisonResults: ComparisonResult[],
    extras?: {
      policyScore?: number;
      artifactQualityScore?: number;
      recoveryScore?: number;
    }
  ): QualityScore {
    if (comparisonResults.length === 0) {
      return {
        missionId,
        score: 0,
        grade: 'D',
        details: {
          executionCorrectnessScore: 0,
          policyComplianceScore: 0,
          artifactQualityScore: 0,
          efficiencyScore: 0,
          recoveryCapabilityScore: 0,
          stepScores: [],
        },
      };
    }

    // 1. Execution correctness: 基于 comparison 的 completeness
    const executionCorrectnessScore = this.average(comparisonResults.map(r => r.completeness));

    // 2. Policy compliance: 从 extras 或降级 (policy 字段在 ComparisonResult 中可选)
    const policyComplianceScore = extras?.policyScore ?? this.average(
      comparisonResults.map(r => (r as any).policy ?? 1)
    );

    // 3. Artifact quality: 从 extras 或降级
    const artifactQualityScore = extras?.artifactQualityScore ?? this.average(
      comparisonResults.map(r => (r as any).artifactQuality ?? 1)
    );

    // 4. Efficiency: 从 comparison
    const efficiencyScore = this.average(comparisonResults.map(r => r.efficiency));

    // 5. Recovery capability: 从 extras 或降级
    const recoveryCapabilityScore = extras?.recoveryScore ?? this.average(
      comparisonResults.map(r => (r as any).recovery ?? 1)
    );

    // 加权总分 (0-1 → 0-100)
    const rawScore =
      executionCorrectnessScore * this.executionCorrectnessWeight +
      policyComplianceScore * this.policyComplianceWeight +
      artifactQualityScore * this.artifactQualityWeight +
      efficiencyScore * this.efficiencyWeight +
      recoveryCapabilityScore * this.recoveryCapabilityWeight;
    const score = Math.round(rawScore * 100);

    // 等级判定
    const grade = this.determineGrade(score);

    return {
      missionId,
      score,
      grade,
      details: {
        executionCorrectnessScore: Math.round(executionCorrectnessScore * 100) / 100,
        policyComplianceScore: Math.round(policyComplianceScore * 100) / 100,
        artifactQualityScore: Math.round(artifactQualityScore * 100) / 100,
        efficiencyScore: Math.round(efficiencyScore * 100) / 100,
        recoveryCapabilityScore: Math.round(recoveryCapabilityScore * 100) / 100,
        stepScores: comparisonResults,
      },
    };
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number } {
    return {
      ok: true,
      name: 'QualityScoreEngine',
      uptime: Date.now(),
    };
  }

  // ── 私有方法 ──

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  private determineGrade(score: number): Grade {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  }
}
