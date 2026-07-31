/**
 * ArtifactValidator — 产物校验器
 *
 * v9.1: 校验产物内容是否符合预定义规则。
 *
 * 校验维度：
 *   - 类型约束（特定类型要求特定字段）
 *   - Schema 校验（JSON Schema）
 *   - 大小限制
 *   - 必需字段
 *   - 自定义规则
 */

import type { ArtifactMeta, ArtifactType, ArtifactRecord } from './types.js'

// ── ValidationRule — 校验规则接口 ──

export interface ValidationRule {
  /** 规则名称 */
  name: string
  /** 规则描述 */
  description: string
  /** 校验方法 */
  validate(record: Partial<ArtifactRecord>): ValidationIssue | null
}

// ── ValidationIssue — 校验问题 ──

export interface ValidationIssue {
  /** 规则名称 */
  rule: string
  /** 严重级别 */
  severity: 'error' | 'warning'
  /** 问题描述 */
  message: string
  /** 相关字段 */
  field?: string
}

// ── ValidationResult — 校验结果 ──

export interface ValidationResult {
  /** 是否通过 */
  passed: boolean
  /** 问题列表 */
  issues: ValidationIssue[]
  /** 校验时间 */
  validatedAt: number
}

// ── ArtifactValidator ──

export class ArtifactValidator {
  private rules: ValidationRule[] = []

  constructor() {
    this.registerDefaultRules()
  }

  /**
   * registerRule — 注册校验规则
   */
  registerRule(rule: ValidationRule): void {
    this.rules.push(rule)
  }

  /**
   * validate — 执行全部校验规则
   *
   * @param record - 待校验的产物记录（可为部分）
   * @returns 校验结果
   */
  validate(record: Partial<ArtifactRecord>): ValidationResult {
    const issues: ValidationIssue[] = []

    for (const rule of this.rules) {
      try {
        const issue = rule.validate(record)
        if (issue) issues.push(issue)
      } catch (err) {
        issues.push({
          rule: rule.name,
          severity: 'error',
          message: `Rule "${rule.name}" threw: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    return {
      passed: issues.every(i => i.severity !== 'error'),
      issues,
      validatedAt: Date.now(),
    }
  }

  /**
   * getRules — 获取所有已注册规则
   */
  getRules(): ValidationRule[] {
    return [...this.rules]
  }

  /**
   * clearRules — 清空所有规则
   */
  clearRules(): void {
    this.rules = []
  }

  // ── 默认规则 ──

  private registerDefaultRules(): void {
    // 名称不能为空
    this.registerRule({
      name: 'name-required',
      description: '产物名称不能为空',
      validate(record) {
        if (!record.meta?.name || record.meta.name.trim() === '') {
          return { rule: 'name-required', severity: 'error', message: 'Artifact name is required', field: 'meta.name' }
        }
        return null
      },
    })

    // 类型必须有效
    this.registerRule({
      name: 'type-valid',
      description: '产物类型必须是有效类型',
      validate(record) {
        const validTypes: ArtifactType[] = ['code', 'document', 'config', 'schema', 'report', 'image', 'structured_data', 'plan', 'workflow', 'model', 'other']
        if (record.meta?.type && !validTypes.includes(record.meta.type)) {
          return { rule: 'type-valid', severity: 'error', message: `Invalid artifact type: ${record.meta.type}`, field: 'meta.type' }
        }
        return null
      },
    })

    // 内容大小限制（100MB）
    this.registerRule({
      name: 'size-limit',
      description: '产物大小不超过 100MB',
      validate(record) {
        if (record.size != null && record.size > 100 * 1024 * 1024) {
          return { rule: 'size-limit', severity: 'error', message: `Artifact size ${record.size} exceeds 100MB limit`, field: 'size' }
        }
        return null
      },
    })

    // 必须有创建者
    this.registerRule({
      name: 'creator-required',
      description: '产物必须有创建者',
      validate(record) {
        if (!record.createdBy) {
          return { rule: 'creator-required', severity: 'error', message: 'Artifact must have a creator', field: 'createdBy' }
        }
        return null
      },
    })

    // 必须有来源
    this.registerRule({
      name: 'source-required',
      description: '产物必须有来源',
      validate(record) {
        if (!record.source) {
          return { rule: 'source-required', severity: 'warning', message: 'Artifact source is recommended', field: 'source' }
        }
        return null
      },
    })
  }
}
