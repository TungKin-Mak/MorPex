/**
 * GoldenDataset — 黄金数据集 (v8.9.1)
 *
 * 回归测试的标准参考数据集。分为三类:
 *
 *   A. correctness — 功能正确性
 *      input → expected artifact
 *      "系统是否产生正确产物"
 *
 *   B. recovery — 异常恢复
 *      failure injection → expected recovery
 *      "系统在故障下是否能恢复"
 *
 *   C. decision — 决策质量
 *      scenario → expected strategy
 *      "Agent 的决策是否符合预期"
 */

export type GoldenTestCategory = 'correctness' | 'recovery' | 'decision'

export interface GoldenTestCase {
  name: string
  category: GoldenTestCategory
  description: string

  // ── correctness ──
  input?: Record<string, unknown>
  expectedOutput?: Record<string, unknown>
  expectedType?: string

  // ── recovery ──
  failureInjection?: { target: string; scenario: string }
  expectedRecovery?: string

  // ── decision ──
  scenario?: string
  expectedStrategy?: string
  decisionTrace?: { step: string; expectedDecision: string }[]

  // ── common ──
  qualityThreshold: number
  tags: string[]
}

export interface GoldenDataset {
  name: string
  workflowType: string
  version: number
  testCases: GoldenTestCase[]
  createdAt: number
  updatedAt: number
}

export class GoldenDatasetManager {
  private datasets: Map<string, GoldenDataset> = new Map()

  load(dataset: GoldenDataset): void {
    this.datasets.set(dataset.workflowType, dataset)
  }

  get(workflowType: string): GoldenDataset | undefined {
    return this.datasets.get(workflowType)
  }

  addTestCase(workflowType: string, testCase: GoldenTestCase): void {
    const ds = this.datasets.get(workflowType)
    if (ds) {
      ds.testCases.push(testCase)
      ds.updatedAt = Date.now()
    }
  }

  removeTestCase(workflowType: string, testCaseName: string): boolean {
    const ds = this.datasets.get(workflowType)
    if (!ds) return false
    const idx = ds.testCases.findIndex(t => t.name === testCaseName)
    if (idx === -1) return false
    ds.testCases.splice(idx, 1)
    ds.updatedAt = Date.now()
    return true
  }

  list(): string[] {
    return [...this.datasets.keys()]
  }

  export(workflowType: string): GoldenDataset | undefined {
    const ds = this.datasets.get(workflowType)
    return ds ? { ...ds, testCases: [...ds.testCases] } : undefined
  }

  /**
   * createCorrectnessDataset — 创建功能正确性数据集
   */
  createCorrectnessDataset(
    workflowType: string,
    name: string,
    testCases: { name: string; input: Record<string, unknown>; expectedOutput: Record<string, unknown>; expectedType?: string; qualityThreshold?: number }[]
  ): GoldenDataset {
    return this.createTypedDataset(workflowType, name, 'correctness', testCases)
  }

  /**
   * createRecoveryDataset — 创建异常恢复数据集
   */
  createRecoveryDataset(
    workflowType: string,
    name: string,
    testCases: { name: string; failureInjection: { target: string; scenario: string }; expectedRecovery: string; qualityThreshold?: number }[]
  ): GoldenDataset {
    return this.createTypedDataset(workflowType, name, 'recovery', testCases)
  }

  /**
   * createDecisionDataset — 创建决策质量数据集
   */
  createDecisionDataset(
    workflowType: string,
    name: string,
    testCases: { name: string; scenario: string; expectedStrategy: string; decisionTrace?: { step: string; expectedDecision: string }[]; qualityThreshold?: number }[]
  ): GoldenDataset {
    return this.createTypedDataset(workflowType, name, 'decision', testCases)
  }

  private createTypedDataset(
    workflowType: string,
    name: string,
    category: GoldenTestCategory,
    rawCases: { name: string; [key: string]: unknown }[]
  ): GoldenDataset {
    const now = Date.now()
    const testCases: GoldenTestCase[] = rawCases.map((r, i) => ({
      name: r.name as string,
      category,
      description: `${category} test case ${i + 1}`,
      qualityThreshold: ((r as any).qualityThreshold ?? 0.8) as number,
      tags: [category, workflowType],
      ...((r as any).input !== undefined ? { input: r.input as Record<string, unknown> } : {}),
      ...((r as any).expectedOutput !== undefined ? { expectedOutput: r.expectedOutput as Record<string, unknown> } : {}),
      ...((r as any).expectedType !== undefined ? { expectedType: r.expectedType as string } : {}),
      ...((r as any).failureInjection !== undefined ? { failureInjection: r.failureInjection as { target: string; scenario: string } } : {}),
      ...((r as any).expectedRecovery !== undefined ? { expectedRecovery: r.expectedRecovery as string } : {}),
      ...((r as any).scenario !== undefined ? { scenario: r.scenario as string } : {}),
      ...((r as any).expectedStrategy !== undefined ? { expectedStrategy: r.expectedStrategy as string } : {}),
      ...((r as any).decisionTrace !== undefined ? { decisionTrace: r.decisionTrace as { step: string; expectedDecision: string }[] } : {}),
    }))

    const dataset: GoldenDataset = {
      name,
      workflowType,
      version: 1,
      testCases,
      createdAt: now,
      updatedAt: now,
    }

    this.load(dataset)
    return dataset
  }
}
