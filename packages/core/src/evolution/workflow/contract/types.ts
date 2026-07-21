/**
 * Workflow Contract — 类型定义
 *
 * MorPex v8.8: 工作流契约的类型定义。
 * 每个工作流在注册前必须定义其契约。
 */

/** 工作流契约 */
export interface WorkflowContract {
  /** 工作流 ID（须与 RegisteredWorkflow.id 一致） */
  workflowId: string

  /** 输入模式: field → 'required' | 'optional' */
  inputSchema: Record<string, string>

  /** 输出模式: field → 'required' | 'optional' */
  outputSchema: Record<string, string>

  /** 前置条件列表 */
  preconditions: string[]

  /** 后置条件列表 */
  postconditions: string[]

  /** 成功标准 */
  successCriteria: {
    metric: string
    threshold: number
  }[]

  /** 失败策略 */
  failurePolicy: {
    retry: number
    compensation: boolean
    maxRetryMs: number
  }

  /** 工作流超时 (ms) */
  timeout: number

  /** 契约所有者 */
  owner: string

  /** 契约版本号 */
  version: number
}

/** 契约验证结果 */
export interface ContractValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  schemaMatch: boolean
  preconditionsMet: boolean
  score: number
}
