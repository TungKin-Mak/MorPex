/**
 * ArtifactManager — 产物管理器
 *
 * v9.1: 产物 CRUD 操作的核心实现。
 *
 * 职责：
 *   - 创建、读取、更新、删除产物
 *   - 调用 Validator/Verifier/StagingArea/VersionService
 *   - 管理产物状态转换
 *   - 发射生命周期事件
 */

import type { ArtifactRecord, ArtifactMeta, ArtifactStatus, ArtifactQuery, ArtifactType, ArtifactStageEntry, ArtifactVerificationResult } from './types.js'
import { ArtifactRepository } from './ArtifactRepository.js'
import { ArtifactStagingArea } from './ArtifactStagingArea.js'
import { ArtifactValidator } from './ArtifactValidator.js'
import { ArtifactVerifier } from './ArtifactVerifier.js'
import { ArtifactVersionService } from './ArtifactVersionService.js'
import { ArtifactEventEmitter } from './ArtifactEventEmitter.js'

// ── ArtifactManagerConfig ──

export interface ArtifactManagerConfig {
  /** 默认创建者 */
  defaultCreator: string
  /** 启用自动验证 */
  autoVerify: boolean
}

const DEFAULT_MANAGER_CONFIG: ArtifactManagerConfig = {
  defaultCreator: 'system',
  autoVerify: true,
}

// ── CreateArtifactInput — 创建产物输入 ──

export interface CreateArtifactInput {
  /** 产物元数据 */
  meta: ArtifactMeta
  /** 产物内容 */
  content: unknown
  /** 创建者 */
  createdBy?: string
  /** 来源 */
  source?: string
  /** 依赖的产物 ID 列表 */
  dependencies?: string[]
}

// ── ArtifactManager ──

export class ArtifactManager {
  private repository: ArtifactRepository
  private stagingArea: ArtifactStagingArea
  private validator: ArtifactValidator
  private verifier: ArtifactVerifier
  private versionService: ArtifactVersionService
  private eventEmitter: ArtifactEventEmitter
  private config: ArtifactManagerConfig
  private idCounter = 0

  constructor(
    repository?: ArtifactRepository,
    stagingArea?: ArtifactStagingArea,
    validator?: ArtifactValidator,
    verifier?: ArtifactVerifier,
    versionService?: ArtifactVersionService,
    eventEmitter?: ArtifactEventEmitter,
    config?: Partial<ArtifactManagerConfig>
  ) {
    this.repository = repository ?? new ArtifactRepository()
    this.stagingArea = stagingArea ?? new ArtifactStagingArea()
    this.validator = validator ?? new ArtifactValidator()
    this.verifier = verifier ?? new ArtifactVerifier()
    this.versionService = versionService ?? new ArtifactVersionService()
    this.eventEmitter = eventEmitter ?? new ArtifactEventEmitter()
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config }
  }

  // ═══════════════════════════════════════════════════════════════
  // 创建
  // ═══════════════════════════════════════════════════════════════

  /**
   * create — 创建产物（直接创建，不走两阶段提交）
   *
   * 产物状态：DRAFT
   *
   * @param input - 创建输入
   * @returns 创建的产物记录
   */
  create(input: CreateArtifactInput): ArtifactRecord {
    const now = Date.now()
    const id = this.generateId()

    const record: ArtifactRecord = {
      id,
      meta: { ...input.meta },
      status: 'draft',
      version: 1,
      content: input.content,
      checksum: this.computeChecksum(input.content),
      size: this.estimateSize(input.content),
      createdBy: input.createdBy ?? this.config.defaultCreator,
      source: input.source ?? 'manual',
      dependencies: input.dependencies ?? [],
      createdAt: now,
      updatedAt: now,
    }

    // 校验
    const validation = this.validator.validate(record)
    if (!validation.passed) {
      const errors = validation.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')
      throw new Error(`Artifact validation failed: ${errors}`)
    }

    this.repository.save(record)
    this.versionService.createVersion(record, 'Initial creation')
    this.eventEmitter.emitCreated(record, record.createdBy)

    return record
  }

  // ═══════════════════════════════════════════════════════════════
  // 两阶段提交
  // ═══════════════════════════════════════════════════════════════

  /**
   * stage — 暂存新版本（两阶段提交 Phase 1）
   *
   * @param artifactId - 产物 ID
   * @param newContent - 新内容
   * @param stagedBy - 暂存者
   * @returns 暂存条目 ID
   */
  stage(artifactId: string, newContent: unknown, stagedBy: string): string {
    const record = this.repository.get(artifactId)
    if (!record) throw new Error(`Artifact not found: ${artifactId}`)

    const entry = this.stagingArea.stage(record, newContent, stagedBy)
    this.eventEmitter.emitStaged(record, stagedBy, entry.stageId)

    return entry.stageId
  }

  /**
   * verify — 验证暂存内容（两阶段提交 Phase 2）
   *
   * @param stageId - 暂存条目 ID
   * @returns 验证结果
   */
  async verify(stageId: string): Promise<ArtifactVerificationResult> {
    const entry = this.stagingArea.getStage(stageId)
    if (!entry) throw new Error(`Stage not found: ${stageId}`)

    if (entry.status !== 'pending') {
      throw new Error(`Stage ${stageId} is in status "${entry.status}", expected "pending"`)
    }

    this.stagingArea.markVerifying(stageId)

    // 获取原始记录
    const record = this.repository.get(entry.artifactId)
    if (!record) throw new Error(`Artifact not found: ${entry.artifactId}`)

    // 构造临时记录用于验证
    const tempRecord: ArtifactRecord = {
      ...record,
      content: entry.content,
      checksum: entry.checksum,
      version: entry.version,
    }

    const result = this.verifier.verify(tempRecord, entry.content)

    this.stagingArea.markVerified(stageId, result)

    return result
  }

  /**
   * commit — 提交暂存内容（两阶段提交 Phase 3）
   *
   * 将暂存内容正式写入产物记录，递增版本号。
   *
   * @param stageId - 暂存条目 ID
   * @param changeLog - 变更说明
   * @returns 更新后的产物记录
   */
  commit(stageId: string, changeLog?: string): ArtifactRecord {
    const entry = this.stagingArea.getStage(stageId)
    if (!entry) throw new Error(`Stage not found: ${stageId}`)

    if (entry.status !== 'verified') {
      throw new Error(`Stage ${stageId} is in status "${entry.status}", expected "verified"`)
    }

    const record = this.repository.get(entry.artifactId)
    if (!record) throw new Error(`Artifact not found: ${entry.artifactId}`)

    // 更新产物记录
    const updatedRecord: ArtifactRecord = {
      ...record,
      content: entry.content,
      checksum: entry.checksum,
      size: this.estimateSize(entry.content),
      version: entry.version,
      status: 'committed',
      updatedAt: Date.now(),
    }

    this.repository.save(updatedRecord)
    this.stagingArea.markCommitted(stageId)
    this.versionService.createVersion(updatedRecord, changeLog ?? `Version ${entry.version}`)
    this.eventEmitter.emitCommitted(updatedRecord, entry.stagedBy)

    return updatedRecord
  }

  /**
   * rollback — 回滚暂存内容
   *
   * @param stageId - 暂存条目 ID
   */
  rollback(stageId: string): void {
    const entry = this.stagingArea.getStage(stageId)
    if (!entry) throw new Error(`Stage not found: ${stageId}`)

    this.stagingArea.markRolledBack(stageId)
    this.eventEmitter.emitRolledBack(
      { id: entry.artifactId, version: entry.version } as ArtifactRecord,
      entry.stagedBy,
      stageId
    )
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /**
   * get — 获取产物
   */
  get(id: string): ArtifactRecord | undefined {
    return this.repository.get(id)
  }

  /**
   * query — 查询产物
   */
  query(q: ArtifactQuery): ArtifactRecord[] {
    return this.repository.query(q)
  }

  /**
   * getHistory — 获取产物版本历史
   */
  getHistory(artifactId: string): import('./ArtifactVersionService.js').VersionInfo[] {
    return this.versionService.getHistory(artifactId)
  }

  /**
   * getVersion — 获取产物的指定版本
   */
  getVersion(artifactId: string, version: number): import('./ArtifactVersionService.js').VersionInfo | undefined {
    return this.versionService.getVersion(artifactId, version)
  }

  /**
   * getActiveStage — 获取产物的活跃暂存
   */
  getActiveStage(artifactId: string): ArtifactStageEntry | undefined {
    return this.stagingArea.getActiveStage(artifactId)
  }

  // ═══════════════════════════════════════════════════════════════
  // 状态管理
  // ═══════════════════════════════════════════════════════════════

  /**
   * archive — 归档产物
   */
  archive(id: string, actor: string): ArtifactRecord | undefined {
    const record = this.repository.get(id)
    if (!record) return undefined

    record.status = 'archived'
    record.updatedAt = Date.now()
    this.repository.save(record)
    this.eventEmitter.emitArchived(record, actor)
    return record
  }

  /**
   * deprecate — 废弃产物
   */
  deprecate(id: string, actor: string): ArtifactRecord | undefined {
    const record = this.repository.get(id)
    if (!record) return undefined

    record.status = 'deprecated'
    record.updatedAt = Date.now()
    this.repository.save(record)
    this.eventEmitter.emitDeprecated(record, actor)
    return record
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════════════════════════

  getRepository(): ArtifactRepository { return this.repository }
  getStagingArea(): ArtifactStagingArea { return this.stagingArea }
  getValidator(): ArtifactValidator { return this.validator }
  getVerifier(): ArtifactVerifier { return this.verifier }
  getVersionService(): ArtifactVersionService { return this.versionService }
  getEventEmitter(): ArtifactEventEmitter { return this.eventEmitter }

  private generateId(): string {
    return `art_${Date.now()}_${++this.idCounter}`
  }

  private computeChecksum(content: unknown): string {
    const str = typeof content === 'string' ? content : JSON.stringify(content)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) ^ str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(16).padStart(8, '0')
  }

  private estimateSize(content: unknown): number {
    const str = typeof content === 'string' ? content : JSON.stringify(content)
    return new TextEncoder().encode(str).length
  }
}
