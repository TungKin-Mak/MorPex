export interface ScoreReport {
  overall: number;
  dimensions: Array<{ name: string; score: number; weight: number }>;
  suggestions: string[];
}

export interface SystemScore {
  overall: number;
  dimensions: Array<{ name: string; score: number; weight: number; details?: string }>;
  suggestions: string[];
}

export class QualityScorer {
  /**
   * 任务级评分（保留原接口，向后兼容）
   */
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
  /**
   * 系统级评价 — 5 维度加权评分
   * Plan Quality: 规划合理性
   * Agent Quality: Agent 选择和执行质量
   * Tool Quality: 工具调用成功率/效率
   * Output Quality: 产物质量
   * Memory Quality: 记忆/知识利用质量
   */
  scoreSystem(metrics: {
    planQuality: number; agentQuality: number; toolQuality: number;
    outputQuality: number; memoryQuality: number;
  }): SystemScore {
    const dimensions = [
      { name: 'Plan Quality', score: metrics.planQuality * 100, weight: 0.25 },
      { name: 'Agent Quality', score: metrics.agentQuality * 100, weight: 0.20 },
      { name: 'Tool Quality', score: metrics.toolQuality * 100, weight: 0.20 },
      { name: 'Output Quality', score: metrics.outputQuality * 100, weight: 0.25 },
      { name: 'Memory Quality', score: metrics.memoryQuality * 100, weight: 0.10 },
    ];
    const overall = Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0));
    const suggestions: string[] = [];
    if (metrics.planQuality < 0.7) suggestions.push('规划质量偏低，考虑使用 HierarchicalPlanner 增强分解');
    if (metrics.agentQuality < 0.7) suggestions.push('Agent 执行质量偏低，检查 AgentCapabilityRegistry 中的信誉分');
    if (metrics.toolQuality < 0.7) suggestions.push('工具质量偏低，检查 ToolRegistry 中的工具统计');
    if (metrics.outputQuality < 0.7) suggestions.push('产物质量偏低，加强 VerificationEngine 规则');
    if (metrics.memoryQuality < 0.7) suggestions.push('记忆利用不足，检查 MemoryWiki 检索覆盖率');
    return { overall, dimensions, suggestions };
  }

  /**
   * ≥85: continue | ≥65: retry | ≥40: replan | <40: abort
   */
  decide(score: number): 'continue' | 'retry' | 'replan' | 'abort' {
    if (score >= 85) return 'continue';
    if (score >= 65) return 'retry';
    if (score >= 40) return 'replan';
    return 'abort';
  }
}
