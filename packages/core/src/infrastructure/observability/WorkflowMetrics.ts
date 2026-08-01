/**
 * WorkflowMetrics — 工作流运行指标
 *
 * MorPex v8.8: 聚合工作流运行的关键业务指标。
 */

export interface WorkflowMetricsSnapshot {
  timestamp: number
  workflowSuccessRate: number
  taskFailureRate: number
  avgLatencyMs: number
  tokenCost: number
  humanInterventionRate: number
  retryCount: number
  activeMissions: number
  completedMissions: number
  failedMissions: number
  sandboxRejections: number
  budgetLimitsHit: number
  avgVerificationScore: number
}

// ═══════════════════════════════════════════════════════════════
// WorkflowMetrics
// ═══════════════════════════════════════════════════════════════

export class WorkflowMetrics {
  private executions: { success: boolean; duration: number; tokens: number }[] = []
  private retries = 0
  private humanInterventions = 0
  private sandboxRejections = 0
  private budgetLimits = 0
  private verificationScores: number[] = []
  private activeCount = 0
  private completedCount = 0
  private failedCount = 0

  /**
   * recordExecution — 记录一次执行
   */
  recordExecution(missionId: string, success: boolean, duration: number, tokens: number): void {
    this.executions.push({ success, duration, tokens })
    if (success) {
      this.completedCount++
    } else {
      this.failedCount++
    }
  }

  /**
   * recordRetry — 记录一次重试
   */
  recordRetry(missionId: string): void {
    this.retries++
  }

  /**
   * recordHumanIntervention — 记录一次人工干预
   */
  recordHumanIntervention(missionId: string): void {
    this.humanInterventions++
  }

  /**
   * recordSandboxRejection — 记录一次沙箱拒绝
   */
  recordSandboxRejection(missionId: string): void {
    this.sandboxRejections++
  }

  /**
   * recordBudgetLimit — 记录一次预算超限
   */
  recordBudgetLimit(missionId: string): void {
    this.budgetLimits++
  }

  /**
   * recordVerification — 记录一次验证分数
   */
  recordVerification(missionId: string, score: number): void {
    this.verificationScores.push(score)
  }

  /**
   * setActiveCount — 设置活跃 Mission 数
   */
  setActiveCount(count: number): void {
    this.activeCount = count
  }

  /**
   * snapshot — 获取当前快照
   */
  snapshot(): WorkflowMetricsSnapshot {
    const total = this.executions.length
    const successful = this.executions.filter(e => e.success).length
    const failed = this.executions.filter(e => !e.success).length
    const totalDuration = this.executions.reduce((s, e) => s + e.duration, 0)
    const totalTokens = this.executions.reduce((s, e) => s + e.tokens, 0)
    const interventionTotal = this.humanInterventions + this.sandboxRejections + this.budgetLimits

    return {
      timestamp: Date.now(),
      workflowSuccessRate: total > 0 ? successful / total : 0,
      taskFailureRate: total > 0 ? failed / total : 0,
      avgLatencyMs: total > 0 ? Math.round(totalDuration / total) : 0,
      tokenCost: totalTokens,
      humanInterventionRate: total > 0 ? interventionTotal / total : 0,
      retryCount: this.retries,
      activeMissions: this.activeCount,
      completedMissions: this.completedCount,
      failedMissions: this.failedCount,
      sandboxRejections: this.sandboxRejections,
      budgetLimitsHit: this.budgetLimits,
      avgVerificationScore: this.verificationScores.length > 0
        ? this.verificationScores.reduce((s, v) => s + v, 0) / this.verificationScores.length
        : 0,
    }
  }

  /**
   * getStats — 获取当前指标
   */
  getStats(): WorkflowMetricsSnapshot {
    return this.snapshot()
  }

  /**
   * reset — 重置所有指标
   */
  reset(): void {
    this.executions = []
    this.retries = 0
    this.humanInterventions = 0
    this.sandboxRejections = 0
    this.budgetLimits = 0
    this.verificationScores = []
    this.activeCount = 0
    this.completedCount = 0
    this.failedCount = 0
  }
}
