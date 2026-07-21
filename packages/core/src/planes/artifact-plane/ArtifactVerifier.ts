/**
 * ArtifactVerifier — 产物验证器
 *
 * v9.1: 验证产物内容的完整性、安全性、一致性。
 *
 * 验证维度：
 *   - 校验和匹配（内容未被篡改）
 *   - 内容完整性（可反序列化、无截断）
 *   - 安全扫描（检测危险内容）
 *   - Schema 一致性（如果定义了 schema）
 */

import type { ArtifactRecord, ArtifactVerificationResult, ArtifactMeta } from './types.js'

// ── VerificationConfig — 验证配置 ──

export interface VerificationConfig {
  /** 启用校验和验证 */
  enableChecksum: boolean
  /** 启用安全扫描 */
  enableSecurityScan: boolean
  /** 允许的最大内容长度（字符数） */
  maxContentLength: number
  /** 禁止的内容模式（正则数组） */
  forbiddenPatterns: RegExp[]
}

const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  enableChecksum: true,
  enableSecurityScan: true,
  maxContentLength: 10 * 1024 * 1024, // 10MB
  forbiddenPatterns: [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /process\.env/i,
    /process\.exit/i,
    /require\s*\(\s*['"]child_process['"]\s*\)/i,
  ],
}

// ── ArtifactVerifier ──

export class ArtifactVerifier {
  private config: VerificationConfig

  constructor(config?: Partial<VerificationConfig>) {
    this.config = { ...DEFAULT_VERIFICATION_CONFIG, ...config }
  }

  /**
   * verify — 执行完整验证
   *
   * @param record - 产物记录
   * @param content - 待验证的内容（可选，不传则使用 record.content）
   * @returns 验证结果
   */
  verify(record: ArtifactRecord, content?: unknown): ArtifactVerificationResult {
    const targetContent = content ?? record.content
    const errors: string[] = []
    const warnings: string[] = []

    // 1. 校验和匹配
    let checksumMatch = false
    if (this.config.enableChecksum) {
      const computedChecksum = this.computeChecksum(targetContent)
      checksumMatch = computedChecksum === record.checksum
      if (!checksumMatch) {
        errors.push(`Checksum mismatch: expected ${record.checksum}, got ${computedChecksum}`)
      }
    } else {
      checksumMatch = true
    }

    // 2. 内容完整性
    let integrityCheck = false
    try {
      integrityCheck = this.checkIntegrity(targetContent)
      if (!integrityCheck) {
        errors.push('Content integrity check failed: content may be truncated or malformed')
      }
    } catch (err) {
      errors.push(`Integrity check error: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 3. 安全扫描
    let securityScan: { passed: boolean; issues: string[] } | undefined
    if (this.config.enableSecurityScan) {
      securityScan = this.securityScan(targetContent)
      if (!securityScan.passed) {
        errors.push(...securityScan.issues.map(i => `Security: ${i}`))
      }
    }

    // 4. 内容长度检查
    const contentStr = typeof targetContent === 'string' ? targetContent : JSON.stringify(targetContent)
    if (contentStr.length > this.config.maxContentLength) {
      warnings.push(`Content length (${contentStr.length}) exceeds recommended max (${this.config.maxContentLength})`)
    }

    return {
      passed: errors.length === 0,
      checksumMatch,
      integrityCheck,
      securityScan,
      verifiedAt: Date.now(),
      verifiedBy: 'artifact-verifier',
      errors,
      warnings,
    }
  }

  /**
   * getConfig — 获取当前配置
   */
  getConfig(): VerificationConfig {
    return { ...this.config }
  }

  /**
   * updateConfig — 更新配置
   */
  updateConfig(partial: Partial<VerificationConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  // ── 内部方法 ──

  /**
   * computeChecksum — 计算内容校验和
   */
  private computeChecksum(content: unknown): string {
    const str = typeof content === 'string' ? content : JSON.stringify(content)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }

  /**
   * checkIntegrity — 检查内容完整性
   *
   * 检查内容是否可以正常序列化/反序列化。
   */
  private checkIntegrity(content: unknown): boolean {
    if (content === null || content === undefined) return false
    if (typeof content === 'string') return content.length > 0
    if (typeof content === 'object') {
      try {
        // 尝试序列化/反序列化
        const str = JSON.stringify(content)
        JSON.parse(str)
        return true
      } catch {
        return false
      }
    }
    return true // 基本类型（number, boolean）
  }

  /**
   * securityScan — 安全扫描
   *
   * 检测内容中的危险模式。
   */
  private securityScan(content: unknown): { passed: boolean; issues: string[] } {
    const issues: string[] = []
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)

    for (const pattern of this.config.forbiddenPatterns) {
      if (pattern.test(contentStr)) {
        issues.push(`Forbidden pattern detected: ${pattern}`)
      }
    }

    return { passed: issues.length === 0, issues }
  }
}
