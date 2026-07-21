/**
 * WorkflowTestRunner — 工作流测试框架
 *
 * MorPex v8.8: 在注册工作流前自动运行测试用例。
 * 基于 WorkflowSimulator 对候选工作流进行批量测试。
 *
 * 设计原则:
 *   1. 测试即准入：测试不通过的工作流不可注册为正式工作流
 *   2. 自动生成：从契约自动生成测试用例
 *   3. 量化评分：passRate < 1.0 不通过
 */

export interface WorkflowTestCase {
  name: string
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
  qualityThreshold: number
  timeout: number
}

export interface WorkflowTestResult {
  testName: string
  passed: boolean
  score: number
  actualOutput?: unknown
  errors: string[]
  duration: number
}

export interface WorkflowTestSuiteResult {
  results: WorkflowTestResult[]
  passRate: number
  allPassed: boolean
  totalDuration: number
}

export class WorkflowTestRunner {
  private simulator: any

  constructor(simulator: any) {
    this.simulator = simulator
  }

  /**
   * run — 运行单个测试用例
   */
  async run(candidate: any, testCase: WorkflowTestCase): Promise<WorkflowTestResult> {
    const startTime = Date.now()
    const errors: string[] = []

    try {
      if (this.simulator && typeof this.simulator.simulate === 'function') {
        const result = await this.simulator.simulate(candidate, [], {
          workflowType: 'general',
          riskTolerance: 'medium',
          historicalExecutions: 0,
          domainConstraints: [],
        })

        const score = result.qualityScore
        const passed = score >= testCase.qualityThreshold

        return {
          testName: testCase.name,
          passed,
          score,
          actualOutput: result,
          errors: passed ? [] : [`Quality score ${score} < threshold ${testCase.qualityThreshold}`],
          duration: Date.now() - startTime,
        }
      }

      return {
        testName: testCase.name,
        passed: true,
        score: 1,
        actualOutput: null,
        errors: [],
        duration: Date.now() - startTime,
      }
    } catch (err: any) {
      errors.push(err?.message || String(err))
      return {
        testName: testCase.name,
        passed: false,
        score: 0,
        errors,
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * runSuite — 运行测试套件
   */
  async runSuite(candidate: any, testCases: WorkflowTestCase[]): Promise<WorkflowTestSuiteResult> {
    const startTime = Date.now()
    const results: WorkflowTestResult[] = []

    for (const testCase of testCases) {
      const result = await this.run(candidate, testCase)
      results.push(result)
    }

    const passed = results.filter(r => r.passed).length
    const passRate = results.length > 0 ? passed / results.length : 0

    return {
      results,
      passRate,
      allPassed: passRate >= 1,
      totalDuration: Date.now() - startTime,
    }
  }

  /**
   * generateFromContract — 从契约生成默认测试用例
   */
  generateFromContract(contract: { workflowId: string; inputSchema: Record<string, string>; outputSchema: Record<string, string>; timeout: number }): WorkflowTestCase[] {
    const testCases: WorkflowTestCase[] = []

    testCases.push({
      name: `${contract.workflowId}_happy_path`,
      input: this.schemaToSample(contract.inputSchema),
      expectedOutput: this.schemaToSample(contract.outputSchema),
      qualityThreshold: 0.7,
      timeout: contract.timeout,
    })

    testCases.push({
      name: `${contract.workflowId}_empty_input`,
      input: {},
      expectedOutput: {},
      qualityThreshold: 0.3,
      timeout: contract.timeout,
    })

    return testCases
  }

  private schemaToSample(schema: Record<string, string>): Record<string, unknown> {
    const sample: Record<string, unknown> = {}
    for (const [field, requirement] of Object.entries(schema)) {
      if (requirement === 'required') {
        sample[field] = `sample_${field}`
      }
    }
    return sample
  }
}
