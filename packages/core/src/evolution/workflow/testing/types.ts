/** 工作流测试用例 */
export interface WorkflowTestCase {
  name: string
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
  qualityThreshold: number
  timeout: number
}

/** 工作流测试结果 */
export interface WorkflowTestResult {
  testName: string
  passed: boolean
  score: number
  actualOutput?: unknown
  errors: string[]
  duration: number
}

/** 测试套件结果 */
export interface WorkflowTestSuiteResult {
  results: WorkflowTestResult[]
  passRate: number
  allPassed: boolean
  totalTests: number
  passedTests: number
  failedTests: number
}
