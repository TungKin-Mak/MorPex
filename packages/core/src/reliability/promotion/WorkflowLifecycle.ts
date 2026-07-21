/**
 * WorkflowLifecycle — 工作流生命周期定义 (v8.9)
 *
 * 工作流从 DRAFT 到 PRODUCTION 的完整升级路径。
 * 每个阶段都有严格的准入要求。
 *
 * ★ v8.9 CANARY 阶段: 灰度发布 (5% → 25% → 50% → 100%)
 *   真实生产环境不会 TESTED → 100% PRODUCTION。
 *   先 CANARY (小流量) 观察 success rate / latency / cost / failure，
 *   逐步放量到 100%。
 */

export enum WorkflowLifecycleStatus {
  DRAFT = 'DRAFT',
  SIMULATED = 'SIMULATED',
  TESTED = 'TESTED',
  APPROVED = 'APPROVED',
  /** ★ v8.9: 灰度发布 (5% → 25% → 50% → 100%) */
  CANARY = 'CANARY',
  PRODUCTION = 'PRODUCTION',
  DEPRECATED = 'DEPRECATED',
}

export interface CanaryConfig {
  trafficPercentage: number        // 0-100, 当前流量百分比
  minObservationPeriod: number     // ms, 每阶段最少观察时间
  successThreshold: number         // 0-1, 最低成功率
  maxLatencyIncrease: number       // 倍数, e.g. 1.5 = 最多允许 50% 延迟增加
  maxCostIncrease: number          // 倍数
}

export interface CanaryMetrics {
  trafficPercentage: number
  successRate: number
  avgLatency: number
  costPerExecution: number
  failureRate: number
  observationPeriod: number        // ms
  passed: boolean
  startedAt: number
  lastUpdated: number
}

export interface WorkflowLifecycleEntry {
  workflowId: string
  status: WorkflowLifecycleStatus
  qualityScore: number
  reliabilityScore: number
  safetyScore: number              // ★ v8.9: 安全评分 (P = Q × R × S)
  productionScore: number
  simulationPassed: boolean
  testsPassed: boolean
  chaosTestPassed: boolean
  regressionPassed: boolean
  approvedBy?: string
  approvedAt?: number
  promotedAt?: number
  canaryConfig?: CanaryConfig      // ★ v8.9: 灰度配置
  canaryMetrics?: CanaryMetrics    // ★ v8.9: 灰度指标
  deprecationReason?: string
  history: { from: WorkflowLifecycleStatus; to: WorkflowLifecycleStatus; at: number; by: string }[]
}
