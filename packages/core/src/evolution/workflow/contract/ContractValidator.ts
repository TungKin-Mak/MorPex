/**
 * WorkflowContract — 工作流契约
 *
 * MorPex v8.8: 每个工作流必须定义输入/输出/前置条件/成功标准/失败策略。
 * 在执行前验证契约，确保可交付性。
 */

import type { WorkflowContract, ContractValidationResult } from './types.js'

// ═══════════════════════════════════════════════════════════════
// ContractValidator
// ═══════════════════════════════════════════════════════════════

export class ContractValidator {
  /**
   * validate — 验证工作流契约的完整性和合理性
   *
   * @param contract - 工作流契约
   * @param candidate - 候选工作流数据（可选）
   * @returns ContractValidationResult
   */
  validate(contract: WorkflowContract, candidate?: Record<string, unknown>): ContractValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // 1. 必需字段检查
    if (!contract.workflowId) errors.push('workflowId is required')
    if (!contract.failurePolicy) errors.push('failurePolicy is required')
    if (contract.timeout === undefined) warnings.push('timeout not set, using default')

    // 2. inputSchema 检查
    const inputRequiredFields = Object.entries(contract.inputSchema || {})
      .filter(([, v]) => v === 'required')
      .map(([k]) => k)
    if (inputRequiredFields.length === 0) warnings.push('No required input fields defined')

    // 3. outputSchema 检查
    if (!contract.outputSchema || Object.keys(contract.outputSchema).length === 0) {
      errors.push('outputSchema is required')
    }

    // 4. 成功标准检查
    if (!contract.successCriteria || contract.successCriteria.length === 0) {
      warnings.push('No success criteria defined — quality verification will be skipped')
    }

    // 5. failurePolicy 检查
    if (contract.failurePolicy) {
      if (contract.failurePolicy.retry < 0) errors.push('retry count cannot be negative')
      if (contract.failurePolicy.maxRetryMs < 0) errors.push('maxRetryMs cannot be negative')
    }

    // 6. 版本检查
    if (contract.version <= 0) warnings.push('Contract version not set, defaulting to 1')

    // 如果传入了候选数据，验证结构
    let schemaMatch = true
    if (candidate) {
      const inputCheck = this.validateInput(contract, candidate)
      if (inputCheck.missing.length > 0) {
        schemaMatch = false
        errors.push(`Missing required input fields: ${inputCheck.missing.join(', ')}`)
      }
    }

    const preconditionsMet = true // preconditions 由调用方检查

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      schemaMatch,
      preconditionsMet,
      score: errors.length === 0 ? (warnings.length === 0 ? 1.0 : 0.8) : 0.2,
    }
  }

  /**
   * validateInput — 检查输入是否符合契约的 inputSchema
   *
   * @param contract - 工作流契约
   * @param input - 实际输入
   * @returns { valid, missing, extra }
   */
  validateInput(contract: WorkflowContract, input: Record<string, unknown>): { valid: boolean; missing: string[]; extra: string[] } {
    const missing: string[] = []
    const extra: string[] = []

    // 检查必需的输入字段
    for (const [field, requirement] of Object.entries(contract.inputSchema || {})) {
      if (requirement === 'required' && !(field in input)) {
        missing.push(field)
      }
    }

    // 检查多余的字段
    for (const field of Object.keys(input)) {
      if (!(field in (contract.inputSchema || {}))) {
        extra.push(field)
      }
    }

    return { valid: missing.length === 0, missing, extra }
  }

  /**
   * validateOutput — 检查输出是否符合契约的 outputSchema
   *
   * @param contract - 工作流契约
   * @param output - 实际输出
   * @returns { valid, missing }
   */
  validateOutput(contract: WorkflowContract, output: Record<string, unknown>): { valid: boolean; missing: string[] } {
    const missing: string[] = []

    for (const [field, requirement] of Object.entries(contract.outputSchema || {})) {
      if (requirement === 'required' && !(field in output)) {
        missing.push(field)
      }
    }

    return { valid: missing.length === 0, missing }
  }

  /**
   * checkPreconditions — 检查前置条件是否满足
   *
   * @param contract - 工作流契约
   * @param context - 当前上下文
   * @returns { met, unmet }
   */
  checkPreconditions(contract: WorkflowContract, context: Record<string, unknown>): { met: string[]; unmet: string[] } {
    const met: string[] = []
    const unmet: string[] = []

    for (const precondition of (contract.preconditions || [])) {
      if (precondition in context && context[precondition]) {
        met.push(precondition)
      } else {
        unmet.push(precondition)
      }
    }

    return { met, unmet }
  }
}
