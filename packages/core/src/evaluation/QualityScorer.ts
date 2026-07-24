export interface ScoreReport {
  overall: number;
  dimensions: Array<{ name: string; score: number; weight: number }>;
  suggestions: string[];
}

export class QualityScorer {
  score(metrics: {
    taskSuccessRate: number;
    avgLatency: number;
    artifactQuality: number;
    retryCount: number;
    costEfficiency: number;
  }): ScoreReport {
    const dimensions = [
      { name: '成功率', score: metrics.taskSuccessRate * 100, weight: 0.30 },
      { name: '延迟', score: Math.max(0, 100 - metrics.avgLatency / 1000), weight: 0.15 },
      { name: '产物质量', score: metrics.artifactQuality * 100, weight: 0.25 },
      { name: '重试率', score: Math.max(0, 100 - metrics.retryCount * 20), weight: 0.15 },
      { name: '成本效率', score: metrics.costEfficiency * 100, weight: 0.15 },
    ];
    const overall = Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0));
    const suggestions: string[] = [];
    if (metrics.taskSuccessRate < 0.8) suggestions.push('成功率偏低，检查失败模式');
    if (metrics.avgLatency > 30000) suggestions.push('延迟偏高，考虑并行化');
    if (metrics.artifactQuality < 0.7) suggestions.push('产物质量不足，加强验证');
    if (metrics.retryCount > 3) suggestions.push('重试过多，检查根本原因');
    return { overall, dimensions, suggestions };
  }

  decide(score: number): 'continue' | 'retry' | 'replan' | 'abort' {
    if (score >= 80) return 'continue';
    if (score >= 50) return 'retry';
    if (score >= 30) return 'replan';
    return 'abort';
  }
}
