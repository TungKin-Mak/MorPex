/** L7 Evolution 层 — ImprovementAnalyzer（Wave 3a 自 cognition/ 迁入）
 * 仅做指标→改进洞察分析，不产生任何执行副作用。 */
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
    /** 验证通过率 0-1（可选） */
    verificationPassRate?: number;
    /** 验证失败的检查点描述列表（可选） */
    failedCheckpoints?: string[];
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

    // 新增：验证通过率分析
    if (metrics.verificationPassRate !== undefined && metrics.verificationPassRate < 0.8) {
      const failedStr = metrics.failedCheckpoints && metrics.failedCheckpoints.length > 0
        ? metrics.failedCheckpoints.join('; ')
        : '未知检查点';
      insights.push({
        id: `impr_${Date.now()}_4`,
        title: '验证通过率偏低',
        description: `当前验证通过率 ${Math.round(metrics.verificationPassRate * 100)}%，目标 80%。失败检查点: ${failedStr}`,
        metric: 'verificationPassRate',
        currentValue: metrics.verificationPassRate,
        targetValue: 0.8,
        estimatedImpact: '提高结果正确性评分',
        suggestion: `确保 artifacts 包含检查点要求的内容: ${failedStr}。可参考之前成功案例中的产物模式。`,
      });
    }

    return insights;
  }
}
