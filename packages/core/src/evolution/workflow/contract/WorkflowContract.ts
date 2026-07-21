/**
 * WorkflowContract — 工作流契约
 *
 * MorPex v8.8: 每个工作流必须定义输入/输出/前置条件/成功标准/失败策略。
 * 在注册和执行前进行契约验证。
 *
 * 设计原则:
 *   1. 契约即文档：工作流契约是 Workflow 的"类型签名"
 *   2. 先验证后执行：契约验证不通过则不执行
 *   3. 版本化：契约版本随工作流版本递增
 */

export interface WorkflowSuccessCriterion {
  metric: string       // 'accuracy' | 'completeness' | 'latency' | 'coverage'
  threshold: number    // 0-1 for ratios, or absolute value
  weight?: number      // importance weight (default 1.0)
}

export interface WorkflowFailurePolicy {
  retry: number              // max retry count
  compensation: boolean      // whether compensation is available
  maxRetryMs: number         // max total retry time (ms)
  retryBackoff: number[]     // backoff intervals [1000, 5000, 30000]
}

export interface WorkflowContract {
  workflowId: string
  inputSchema: Record<string, string>
  outputSchema: Record<string, string>
  preconditions: string[]
  postconditions: string[]
  successCriteria: WorkflowSuccessCriterion[]
  failurePolicy: WorkflowFailurePolicy
  timeout: number
  owner: string
  version: number
}

export interface ContractValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  schemaMatch: boolean
  preconditionsMet: boolean
  score: number
}

export class ContractValidator {
  /**
   * validate — 验证候选工作流是否满足契约
   *
   * @param contract - 工作流契约
   * @param candidate - 候选工作流数据
   * @returns ContractValidationResult
   */
  validate(contract: WorkflowContract, candidate: Record<string, unknown>): ContractValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    const inputResult = this.validateInput(contract, (candidate.input as Record<string, unknown>) || {})
    errors.push(...inputResult.missing.map(f => `Missing input: ${f}`))
    warnings.push(...inputResult.extra.map(f => `Extra input: ${f}`))

    const outputResult = this.validateOutput(contract, (candidate.output as Record<string, unknown>) || {})
    errors.push(...outputResult.missing.map(f => `Missing output: ${f}`))

    const preconditionsResult = this.checkPreconditions(contract, (candidate.context as Record<string, unknown>) || {})
    errors.push(...preconditionsResult.unmet.map(p => `Unmet precondition: ${p}`))

    // 计算评分
    const totalChecks = Object.keys(contract.inputSchema).length + Object.keys(contract.outputSchema).length + contract.preconditions.length
    const failedChecks = inputResult.missing.length + outputResult.missing.length + preconditionsResult.unmet.length
    const score = totalChecks > 0 ? Math.max(0, 1 - failedChecks / totalChecks) : 1

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      schemaMatch: errors.length === 0,
      preconditionsMet: preconditionsResult.unmet.length === 0,
      score,
    }
  }

  /**
   * validateInput — 验证输入是否匹配契约的 inputSchema
   */
  validateInput(contract: WorkflowContract, input: Record<string, unknown>): { valid: boolean; missing: string[]; extra: string[] } {
    const missing: string[] = []
    const extra: string[] = []

    for (const [field, requirement] of Object.entries(contract.inputSchema)) {
      if (requirement === 'required' && (input[field] === undefined || input[field] === null)) {
        missing.push(field)
      }
    }

    for (const field of Object.keys(input)) {
      if (!(field in contract.inputSchema)) {
        extra.push(field)
      }
    }

    return { valid: missing.length === 0, missing, extra }
  }

  /**
   * validateOutput — 验证输出是否匹配契约的 outputSchema
   */
  validateOutput(contract: WorkflowContract, output: Record<string, unknown>): { valid: boolean; missing: string[] } {
    const missing: string[] = []

    for (const [field, requirement] of Object.entries(contract.outputSchema)) {
      if (requirement === 'required' && (output[field] === undefined || output[field] === null)) {
        missing.push(field)
      }
    }

    return { valid: missing.length === 0, missing }
  }

  /**
   * checkPreconditions — 检查前置条件是否满足
   */
  checkPreconditions(contract: WorkflowContract, context: Record<string, unknown>): { met: string[]; unmet: string[] } {
    const met: string[] = []
    const unmet: string[] = []

    for (const precondition of contract.preconditions) {
      // 简单检查：context 中是否存在对应的键值
      const key = precondition.replace(/\s+/g, '_').toLowerCase()
      if (context[key] === true || context[key] === 'true' || context[key] === 'met') {
        met.push(precondition)
      } else {
        unmet.push(precondition)
      }
    }

    return { met, unmet }
  }
}
