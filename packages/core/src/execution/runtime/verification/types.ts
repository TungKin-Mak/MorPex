/**
 * Verification Engine — 类型定义
 *
 * Phase 4 / MorPex v8: 验证 Mission 执行结果的标准数据结构。
 *
 * 设计原则：
 *   - 每次验证产生一个 VerificationResult（不可变）
 *   - 每个验证点（check）有明确的权重和通过/不通过
 *   - Issue 区分三个严重等级：error / warning / info
 */

// ── VerificationResult — 验证结果 ──

/**
 * VerificationResult — 一次验证的完整结果
 *
 * passed 和 score 由所有 checks 汇总计算。
 * issues 包含所有未通过的 check 的详细信息。
 */
export interface VerificationResult {
  /** 关联的 Mission ID */
  missionId: string;
  /** 是否通过验证（无 error 级 issue） */
  passed: boolean;
  /** 综合评分 0-100（加权计算） */
  score: number;
  /** 所有验证点结果 */
  checks: VerificationCheck[];
  /** 所有未通过的问题 */
  issues: VerificationIssue[];
  /** 人类可读的汇总 */
  summary: string;
  /** 验证时间戳 */
  verifiedAt: number;
}

// ── VerificationCheck — 单个验证点 ──

/**
 * VerificationCheck — 一个验证点的结果
 *
 * weight 决定对总分的贡献比例。
 */
export interface VerificationCheck {
  /** 验证点名称（如 'step_completion'） */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 验证详情 */
  detail: string;
  /** 权重 0-1，影响总分 */
  weight: number;
}

// ── VerificationIssue — 验证问题 ──

/**
 * VerificationIssue — 验证中发现的单个问题
 */
export interface VerificationIssue {
  /** 所属验证点名称 */
  checkName: string;
  /** 严重等级 */
  severity: 'error' | 'warning' | 'info';
  /** 问题描述 */
  message: string;
  /** 修复建议（可选） */
  suggestion?: string;
}

// ── VerificationEngineConfig — 验证引擎配置 ──

/**
 * VerificationEngineConfig — 验证引擎配置
 *
 * 可自定义各检查的权重和启用/禁用。
 */
export interface VerificationEngineConfig {
  /** 步骤完成度检查权重（默认 0.4） */
  stepCompletionWeight?: number;
  /** 输出存在性检查权重（默认 0.3） */
  outputPresenceWeight?: number;
  /** 错误检查权重（默认 0.2） */
  errorCheckWeight?: number;
  /** 产物完整性检查权重（默认 0.1） */
  artifactCheckWeight?: number;
  /** 是否启用目标对齐检查（需要 LLM，默认 false） */
  enableGoalAlignment?: boolean;
}
