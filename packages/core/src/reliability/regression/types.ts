/**
 * Regression — 类型定义
 *
 * MorPex v8.9: 回归测试的类型定义。
 */

export interface RegressionResult {
  testName: string
  passed: boolean
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
  actualOutput: unknown
  score: number
  errors: string[]
  duration: number
}

export interface RegressionReport {
  workflowId: string
  workflowType: string
  totalTests: number
  passed: number
  failed: number
  passRate: number
  results: RegressionResult[]
  regressions: RegressionResult[]
}
