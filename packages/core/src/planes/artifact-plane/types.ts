/**
 * Artifact Plane — 类型定义
 *
 * v9.1: 独立产物管理平面的核心类型。
 *
 * 产物生命周期：
 *   DRAFT → STAGED → VERIFIED → COMMITTED → ARCHIVED → DEPRECATED
 *
 * 两阶段提交协议：
 *   stage() → verify() → commit() 或 rollback()
 */

// ── ArtifactType — 产物类型 ──

export type ArtifactType =
  | 'code'
  | 'document'
  | 'config'
  | 'schema'
  | 'report'
  | 'image'
  | 'structured_data'
  | 'plan'
  | 'workflow'
  | 'model'
  | 'other'

// ── ArtifactStatus — 产物状态 ──

export type ArtifactStatus =
  | 'draft'
  | 'staged'
  | 'verified'
  | 'committed'
  | 'archived'
  | 'deprecated'

// ── ArtifactMeta — 产物元数据 ──

export interface ArtifactMeta {
  /** 产物名称 */
  name: string
  /** 产物类型 */
  type: ArtifactType
  /** 描述 */
  description?: string
  /** 标签 */
  tags?: string[]
  /** 自定义元数据 */
  custom?: Record<string, unknown>
}

// ── ArtifactRef — 产物引用 ──

export interface ArtifactRef {
  /** 产物 ID */
  id: string
  /** 版本号 */
  version: number
  /** 产物类型 */
  type: ArtifactType
  /** 产物名称 */
  name: string
}

// ── ArtifactRecord — 完整的产物记录 ──

export interface ArtifactRecord {
  /** 唯一 ID */
  id: string
  /** 产物元数据 */
  meta: ArtifactMeta
  /** 当前状态 */
  status: ArtifactStatus
  /** 当前版本号 */
  version: number
  /** 内容（引用或内联） */
  content: unknown
  /** 内容校验和（SHA-256） */
  checksum: string
  /** 内容大小（bytes） */
  size: number
  /** 创建者 */
  createdBy: string
  /** 来源（missionId / toolCallId） */
  source: string
  /** 依赖的产物 ID 列表 */
  dependencies: string[]
  /** 两阶段提交锁 */
  lock?: {
    /** 锁定者 */
    holder: string
    /** 锁定时间 */
    lockedAt: number
    /** 锁超时时间 */
    expiresAt: number
  }
  /** 创建时间 */
  createdAt: number
  /** 最后修改时间 */
  updatedAt: number
}

// ── ArtifactStage — 暂存记录 ──

export interface ArtifactStageEntry {
  /** 暂存 ID */
  stageId: string
  /** 产物 ID */
  artifactId: string
  /** 版本号 */
  version: number
  /** 暂存内容 */
  content: unknown
  /** 校验和 */
  checksum: string
  /** 暂存者 */
  stagedBy: string
  /** 暂存时间 */
  stagedAt: number
  /** 过期时间（超时后自动清理） */
  expiresAt: number
  /** 状态 */
  status: 'pending' | 'verifying' | 'verified' | 'failed' | 'committed' | 'rolled_back'
  /** 验证结果 */
  verificationResult?: ArtifactVerificationResult
}

// ── ArtifactVerificationResult — 验证结果 ──

export interface ArtifactVerificationResult {
  /** 是否通过 */
  passed: boolean
  /** 校验和匹配 */
  checksumMatch: boolean
  /** 内容完整性 */
  integrityCheck: boolean
  /** 安全扫描结果 */
  securityScan?: { passed: boolean; issues: string[] }
  /** 验证时间 */
  verifiedAt: number
  /** 验证者 */
  verifiedBy: string
  /** 错误信息 */
  errors: string[]
  /** 警告 */
  warnings: string[]
}

// ── ArtifactEvent — 产物事件 ──

export interface ArtifactEvent {
  /** 事件类型 */
  type: ArtifactEventType
  /** 产物 ID */
  artifactId: string
  /** 版本号 */
  version: number
  /** 事件时间 */
  timestamp: number
  /** 触发者 */
  actor: string
  /** 事件数据 */
  data?: Record<string, unknown>
}

export type ArtifactEventType =
  | 'artifact.created'
  | 'artifact.staged'
  | 'artifact.verified'
  | 'artifact.committed'
  | 'artifact.archived'
  | 'artifact.deprecated'
  | 'artifact.rolled_back'
  | 'artifact.locked'
  | 'artifact.unlocked'

// ── ArtifactQuery — 查询参数 ──

export interface ArtifactQuery {
  type?: ArtifactType
  status?: ArtifactStatus
  name?: string
  createdBy?: string
  source?: string
  tags?: string[]
  limit?: number
  offset?: number
}
