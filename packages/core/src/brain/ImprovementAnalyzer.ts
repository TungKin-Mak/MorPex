export interface ImprovementInsight {
  id: string;
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  targetValue: number;
  estimatedImpact: string;
  suggestion: string;
}

export class ImprovementAnalyzer {
  analyze(metrics: {
    taskSuccessRate: number;
    avgLatency: number;
    failurePatterns: string[];
    artifactQuality: number;
  }): ImprovementInsight[] {
    const insights: ImprovementInsight[] = [];

    if (metrics.taskSuccessRate < 0.8) {
      insights.push({
        id: `impr_${Date.now()}_1`,
        title: '任务成功率偏低',
        description: `当前成功率 ${Math.round(metrics.taskSuccessRate * 100)}%，目标 80%`,
        metric: 'taskSuccessRate',
        currentValue: metrics.taskSuccessRate,
        targetValue: 0.8,
        estimatedImpact: '提升交付可靠性',
        suggestion: '检查失败模式并优化规划策略',
      });
    }

    if (metrics.avgLatency > 30000) {
      insights.push({
        id: `impr_${Date.now()}_2`,
        title: '执行延迟偏高',
        description: `平均延迟 ${Math.round(metrics.avgLatency / 1000)}s，目标 30s`,
        metric: 'avgLatency',
        currentValue: metrics.avgLatency,
        targetValue: 30000,
        estimatedImpact: '加快交付速度',
        suggestion: '考虑并行执行或使用更快的模型',
      });
    }

    if (metrics.failurePatterns.length > 3) {
      insights.push({
        id: `impr_${Date.now()}_3`,
        title: '失败模式集中',
        description: `检测到 ${metrics.failurePatterns.length} 种失败模式`,
        metric: 'failurePatterns',
        currentValue: metrics.failurePatterns.length,
        targetValue: 0,
        estimatedImpact: '减少重复失败',
        suggestion: `分析模式: ${metrics.failurePatterns.join(', ')}`,
      });
    }

    return insights;
  }
}
