/**
 * ArtifactEvaluator — 产物评估引擎
 *
 * 从完整性、一致性、可用性、性能等维度评估 Artifact 质量。
 */
import type { ArtifactNode, ArtifactEvaluation, ArtifactCapability } from './types.js';

export class ArtifactEvaluator {
  /** 评估单个 Artifact */
  evaluate(node: ArtifactNode): ArtifactEvaluation {
    const completeness = this.evaluateCompleteness(node);
    const consistency = this.evaluateConsistency(node);
    const usability = this.evaluateUsability(node);

    const dimensions = { completeness, consistency, usability };
    const score = completeness * 0.35 + consistency * 0.35 + usability * 0.30;

    const issues: string[] = [];
    if (completeness < 0.5) issues.push('Low completeness: missing key fields');
    if (consistency < 0.5) issues.push('Low consistency: capability/dependency mismatch');
    if (usability < 0.5) issues.push('Low usability: no usage history or low success rate');
    if (node.successRate < 0.3) issues.push('Low success rate: below 30%');

    const recommendations: string[] = [];
    if (!node.description) recommendations.push('Add a meaningful description');
    if (node.capabilities.length === 0) recommendations.push('Define artifact capabilities');
    if (node.dependencies.length === 0 && node.type !== 'document') recommendations.push('Declare dependencies');
    if (node.usageHistory.length === 0) recommendations.push('Track usage history for better evaluation');
    if (node.successRate < 0.5) recommendations.push('Improve artifact quality to increase success rate');

    return { artifactId: node.id, score, dimensions, issues, recommendations, evaluatedAt: Date.now() };
  }

  /** 批量评估 */
  evaluateAll(nodes: ArtifactNode[]): ArtifactEvaluation[] {
    return nodes.map(n => this.evaluate(n));
  }

  /** 比较两个 Artifact 的质量 */
  compare(a: ArtifactNode, b: ArtifactNode): { winner: string; scoreA: number; scoreB: number; details: string[] } {
    const evalA = this.evaluate(a);
    const evalB = this.evaluate(b);
    const details: string[] = [];

    for (const dim of ['completeness', 'consistency', 'usability'] as const) {
      const diff = evalA.dimensions[dim] - evalB.dimensions[dim];
      if (Math.abs(diff) > 0.1) {
        details.push(`${dim}: ${diff > 0 ? a.name : b.name} leads by ${(Math.abs(diff) * 100).toFixed(0)}%`);
      }
    }

    return {
      winner: evalA.score >= evalB.score ? a.id : b.id,
      scoreA: evalA.score,
      scoreB: evalB.score,
      details,
    };
  }

  /** 评估一致性：capability 和 dependency 是否匹配 */
  private evaluateConsistency(node: ArtifactNode): number {
    let score = 1.0;

    // Check: if artifact has dependencies, it should have capabilities that use them
    if (node.dependencies.length > 0 && node.capabilities.length === 0) {
      score -= 0.3;
    }

    // Check: version format consistency
    if (!node.version || !/^\d+\.\d+\.\d+/.test(node.version)) {
      score -= 0.2;
    }

    // Check: timestamps make sense
    if (node.updatedAt < node.createdAt) {
      score -= 0.3;
    }

    return Math.max(0, score);
  }

  /** 评估完整性：是否包含必要字段 */
  private evaluateCompleteness(node: ArtifactNode): number {
    let score = 0;

    if (node.name) score += 0.15;
    if (node.description) score += 0.15;
    if (node.type) score += 0.10;
    if (node.creator) score += 0.10;
    if (node.version) score += 0.10;
    if (node.capabilities.length > 0) score += 0.10;
    if (node.dependencies.length > 0) score += 0.10;
    if (node.usageHistory.length > 0) score += 0.10;
    if (node.metadata && Object.keys(node.metadata).length > 0) score += 0.10;

    return Math.min(1, score);
  }

  /** 评估可用性：基于历史记录和成功率 */
  private evaluateUsability(node: ArtifactNode): number {
    let score = 0.5; // base

    // Success rate
    score += node.successRate * 0.3;

    // Usage recency
    if (node.usageHistory.length > 0) {
      const latest = node.usageHistory[node.usageHistory.length - 1];
      const daysSinceLastUse = (Date.now() - latest.timestamp) / (1000 * 86400);
      if (daysSinceLastUse < 7) score += 0.1;
      else if (daysSinceLastUse < 30) score += 0.05;
    }

    // More usage = more proven
    score += Math.min(0.1, node.usageHistory.length * 0.02);

    return Math.min(1, Math.max(0, score));
  }
}
