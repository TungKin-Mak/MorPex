/**
 * BudgetManager — 预算管理器
 *
 * MorPex v8.8: 防止 Agent 无限消耗 Token/步骤/费用。
 * 每个 Mission 有独立的预算上限，超限时触发告警或阻止执行。
 */

export interface BudgetConfig {
  maxTokens: number
  maxSteps: number
  maxCost: number
  maxDuration: number
  alertThreshold: number
}

export interface BudgetStatus {
  missionId: string
  tokensUsed: number
  stepsUsed: number
  costEstimate: number
  elapsed: number
  remaining: { tokens: number; steps: number; cost: number }
  alerts: string[]
}

interface MissionBudget {
  tokensUsed: number
  stepsUsed: number
  costEstimate: number
  startTime: number
}

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: 50000,
  maxSteps: 30,
  maxCost: 2,
  maxDuration: 600000,
  alertThreshold: 0.8,
}

// Token 到 USD 的估算比率（OpenAI GPT-4 参考）
const TOKEN_COST_RATE = 0.00003

export class BudgetManager {
  private config: BudgetConfig
  private missionBudgets: Map<string, MissionBudget> = new Map()
  private stats = {
    totalTokens: 0,
    totalCost: 0,
    missionsTracked: 0,
    limitsHit: 0,
  }

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * check — 检查 Mission 是否可以在预算内继续执行
   *
   * @param missionId - Mission ID
   * @returns { allowed, reason }
   */
  check(missionId: string): { allowed: boolean; reason: string } {
    const budget = this.missionBudgets.get(missionId)
    if (!budget) {
      this.missionBudgets.set(missionId, { tokensUsed: 0, stepsUsed: 0, costEstimate: 0, startTime: Date.now() })
      this.stats.missionsTracked++
      return { allowed: true, reason: 'Budget initialized' }
    }

    // 检查 Token 上限
    if (budget.tokensUsed >= this.config.maxTokens) {
      this.stats.limitsHit++
      return { allowed: false, reason: `Token limit reached: ${budget.tokensUsed}/${this.config.maxTokens}` }
    }

    // 检查步骤上限
    if (budget.stepsUsed >= this.config.maxSteps) {
      this.stats.limitsHit++
      return { allowed: false, reason: `Step limit reached: ${budget.stepsUsed}/${this.config.maxSteps}` }
    }

    // 检查费用上限
    if (budget.costEstimate >= this.config.maxCost) {
      this.stats.limitsHit++
      return { allowed: false, reason: `Cost limit reached: $${budget.costEstimate.toFixed(2)}/$${this.config.maxCost.toFixed(2)}` }
    }

    // 检查时长上限
    const elapsed = Date.now() - budget.startTime
    if (elapsed >= this.config.maxDuration) {
      this.stats.limitsHit++
      return { allowed: false, reason: `Duration limit reached: ${elapsed}ms/${this.config.maxDuration}ms` }
    }

    return { allowed: true, reason: 'Budget OK' }
  }

  /**
   * consume — 记录 Token 消耗
   *
   * @param missionId - Mission ID
   * @param tokens - 消耗的 Token 数
   */
  consume(missionId: string, tokens: number): void {
    const budget = this.missionBudgets.get(missionId)
    if (!budget) return

    budget.tokensUsed += tokens
    budget.costEstimate = budget.tokensUsed * TOKEN_COST_RATE
    this.stats.totalTokens += tokens
    this.stats.totalCost = this.stats.totalTokens * TOKEN_COST_RATE
  }

  /**
   * trackStep — 记录步骤执行
   *
   * @param missionId - Mission ID
   */
  trackStep(missionId: string): void {
    const budget = this.missionBudgets.get(missionId)
    if (!budget) return
    budget.stepsUsed++
  }

  /**
   * getStatus — 获取 Mission 的预算状态
   *
   * @param missionId - Mission ID
   * @returns BudgetStatus
   */
  getStatus(missionId: string): BudgetStatus {
    const budget = this.missionBudgets.get(missionId)
    if (!budget) {
      return {
        missionId,
        tokensUsed: 0,
        stepsUsed: 0,
        costEstimate: 0,
        elapsed: 0,
        remaining: {
          tokens: this.config.maxTokens,
          steps: this.config.maxSteps,
          cost: this.config.maxCost,
        },
        alerts: [],
      }
    }

    const elapsed = Date.now() - budget.startTime
    const alerts: string[] = []

    const tokenRatio = budget.tokensUsed / this.config.maxTokens
    const stepRatio = budget.stepsUsed / this.config.maxSteps
    const costRatio = budget.costEstimate / this.config.maxCost
    const durationRatio = elapsed / this.config.maxDuration

    if (tokenRatio >= this.config.alertThreshold) alerts.push(`Token usage at ${(tokenRatio * 100).toFixed(0)}%`)
    if (stepRatio >= this.config.alertThreshold) alerts.push(`Step usage at ${(stepRatio * 100).toFixed(0)}%`)
    if (costRatio >= this.config.alertThreshold) alerts.push(`Cost at $${budget.costEstimate.toFixed(2)}`)
    if (durationRatio >= this.config.alertThreshold) alerts.push(`Elapsed ${(elapsed / 1000).toFixed(0)}s`)

    return {
      missionId,
      tokensUsed: budget.tokensUsed,
      stepsUsed: budget.stepsUsed,
      costEstimate: budget.costEstimate,
      elapsed,
      remaining: {
        tokens: Math.max(0, this.config.maxTokens - budget.tokensUsed),
        steps: Math.max(0, this.config.maxSteps - budget.stepsUsed),
        cost: Math.max(0, this.config.maxCost - budget.costEstimate),
      },
      alerts,
    }
  }

  /**
   * reset — 重置 Mission 的预算
   *
   * @param missionId - Mission ID
   */
  reset(missionId: string): void {
    this.missionBudgets.delete(missionId)
  }

  /**
   * getConfig — 获取当前配置
   */
  getConfig(): BudgetConfig {
    return { ...this.config }
  }

  /**
   * getStats — 获取预算统计
   */
  getStats(): { totalTokens: number; totalCost: number; missionsTracked: number; limitsHit: number } {
    return { ...this.stats }
  }
}
