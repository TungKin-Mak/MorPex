/**
 * ArtifactStagingArea — 产物暂存区
 *
 * v9.1: 两阶段提交的第一阶段（stage）。
 * 暂存内容在 verify/commit 前不对外可见。
 *
 * 设计原则：
 *   - 暂存区数据以内存为主，可配置持久化
 *   - 暂存条目有过期时间（防止残留）
 *   - 同一产物同一时刻只能有一个活跃暂存（加锁）
 */

import type { ArtifactStageEntry, ArtifactRecord } from './types.js'

// ── StagingConfig — 暂存配置 ──

export interface StagingConfig {
  /** 暂存条目 TTL（ms），超时后自动清理 */
  entryTtlMs: number
  /** 最大暂存条目数 */
  maxEntries: number
  /** 自动清理间隔（ms） */
  cleanupIntervalMs: number
}

const DEFAULT_STAGING_CONFIG: StagingConfig = {
  entryTtlMs: 30 * 60 * 1000, // 30 分钟
  maxEntries: 1000,
  cleanupIntervalMs: 5 * 60 * 1000, // 5 分钟
}

// ── ArtifactStagingArea ──

export class ArtifactStagingArea {
  /** stageId → ArtifactStageEntry */
  private entries = new Map<string, ArtifactStageEntry>()
  /** artifactId → stageId（用于快速查找活跃暂存） */
  private activeStages = new Map<string, string>()
  private config: StagingConfig
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private counter = 0

  constructor(config?: Partial<StagingConfig>) {
    this.config = { ...DEFAULT_STAGING_CONFIG, ...config }
    this.startCleanup()
  }

  /**
   * stage — 暂存产物内容
   *
   * 如果该产物已有活跃暂存或已锁定，则拒绝暂存。
   *
   * @param artifact - 原始产物记录（用于读取 meta）
   * @param content - 新内容
   * @param stagedBy - 暂存者
   * @returns 暂存条目
   */
  stage(artifact: ArtifactRecord, content: unknown, stagedBy: string): ArtifactStageEntry {
    // 检查是否已锁定
    if (artifact.lock) {
      if (artifact.lock.holder !== stagedBy && Date.now() < artifact.lock.expiresAt) {
        throw new Error(`Artifact "${artifact.id}" is locked by "${artifact.lock.holder}"`)
      }
    }

    // 检查是否有活跃暂存
    const existingStageId = this.activeStages.get(artifact.id)
    if (existingStageId) {
      const existing = this.entries.get(existingStageId)
      if (existing && existing.status === 'pending') {
        throw new Error(`Artifact "${artifact.id}" already has a pending stage (${existingStageId})`)
      }
    }

    const now = Date.now()
    const stageId = `stage_${artifact.id}_${now}_${++this.counter}`
    const checksum = this.computeChecksum(content)

    const entry: ArtifactStageEntry = {
      stageId,
      artifactId: artifact.id,
      version: artifact.version + 1, // 新版本 = 当前版本 + 1
      content,
      checksum,
      stagedBy,
      stagedAt: now,
      expiresAt: now + this.config.entryTtlMs,
      status: 'pending',
    }

    this.entries.set(stageId, entry)
    this.activeStages.set(artifact.id, stageId)
    return entry
  }

  /**
   * getStage — 获取暂存条目
   */
  getStage(stageId: string): ArtifactStageEntry | undefined {
    return this.entries.get(stageId)
  }

  /**
   * getActiveStage — 获取产物的活跃暂存
   */
  getActiveStage(artifactId: string): ArtifactStageEntry | undefined {
    const stageId = this.activeStages.get(artifactId)
    if (!stageId) return undefined
    return this.entries.get(stageId)
  }

  /**
   * markVerifying — 标记暂存为验证中
   */
  markVerifying(stageId: string): boolean {
    const entry = this.entries.get(stageId)
    if (!entry || entry.status !== 'pending') return false
    entry.status = 'verifying'
    return true
  }

  /**
   * markVerified — 标记暂存为已验证
   */
  markVerified(stageId: string, result: ArtifactStageEntry['verificationResult']): boolean {
    const entry = this.entries.get(stageId)
    if (!entry || entry.status !== 'verifying') return false
    entry.status = result?.passed ? 'verified' : 'failed'
    entry.verificationResult = result
    return true
  }

  /**
   * markCommitted — 标记暂存为已提交
   */
  markCommitted(stageId: string): boolean {
    const entry = this.entries.get(stageId)
    if (!entry || entry.status !== 'verified') return false
    entry.status = 'committed'
    this.activeStages.delete(entry.artifactId)
    return true
  }

  /**
   * markRolledBack — 标记暂存为已回滚
   */
  markRolledBack(stageId: string): boolean {
    const entry = this.entries.get(stageId)
    if (!entry) return false
    entry.status = 'rolled_back'
    this.activeStages.delete(entry.artifactId)
    return true
  }

  /**
   * hasActiveStage — 检查产物是否有活跃暂存
   */
  hasActiveStage(artifactId: string): boolean {
    return this.activeStages.has(artifactId)
  }

  /**
   * cleanupExpired — 清理过期暂存
   *
   * @returns 清理数量
   */
  cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0
    for (const [stageId, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(stageId)
        if (this.activeStages.get(entry.artifactId) === stageId) {
          this.activeStages.delete(entry.artifactId)
        }
        cleaned++
      }
    }
    return cleaned
  }

  /**
   * getActiveEntries — 获取所有活跃暂存
   */
  getActiveEntries(): ArtifactStageEntry[] {
    return [...this.entries.values()].filter(e => e.status === 'pending' || e.status === 'verifying')
  }

  /**
   * count — 暂存条目总数
   */
  count(): number {
    return this.entries.size
  }

  /**
   * dispose — 释放资源（停止清理定时器）
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * clear — 清空所有暂存（仅用于测试）
   */
  clear(): void {
    this.entries.clear()
    this.activeStages.clear()
  }

  // ── 内部方法 ──

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired()
    }, this.config.cleanupIntervalMs)
    this.cleanupTimer.unref()
  }

  /**
   * computeChecksum — 计算内容校验和（简化版）
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
}
