/**
 * ArtifactVersionService — 产物版本管理
 *
 * v9.1: Git-like 版本管理，支持：
 *   - 版本递增（从 1 开始）
 *   - 版本历史（有序、可回溯）
 *   - 版本间差异（按字段比较）
 *   - 版本标签（如 "latest", "stable", "production"）
 *   - 版本回滚
 */

import type { ArtifactRecord } from './types.js'

// ── VersionTag — 版本标签 ──

export type VersionTag = 'latest' | 'stable' | 'production' | 'rollback' | string

// ── VersionInfo — 版本信息 ──

export interface VersionInfo {
  /** 产物 ID */
  artifactId: string
  /** 版本号 */
  version: number
  /** 记录快照 */
  record: ArtifactRecord
  /** 创建时间 */
  createdAt: number
  /** 创建者 */
  createdBy: string
  /** 变更说明 */
  changeLog?: string
  /** 标签 */
  tags: VersionTag[]
  /** 父版本号（回滚链路） */
  parentVersion?: number
}

// ── VersionDiff — 版本差异 ──

export interface VersionDiff {
  /** 产物 ID */
  artifactId: string
  /** 旧版本 */
  fromVersion: number
  /** 新版本 */
  toVersion: number
  /** 变更列表 */
  changes: Array<{
    field: string
    from: unknown
    to: unknown
  }>
}

// ── ArtifactVersionService ──

export class ArtifactVersionService {
  /** artifactId → 版本列表（按版本号升序） */
  private versions = new Map<string, VersionInfo[]>()
  /** artifactId → 标签映射 */
  private tags = new Map<string, Map<VersionTag, number>>()

  /**
   * createVersion — 创建新版本
   *
   * 版本号从 1 开始自动递增。
   *
   * @param record - 产物记录
   * @param changeLog - 变更说明（可选）
   * @param tag - 自动添加的标签（可选，默认 'latest'）
   * @returns 版本信息
   */
  createVersion(record: ArtifactRecord, changeLog?: string, tag?: VersionTag): VersionInfo {
    const list = this.versions.get(record.id) ?? []
    const prevVersion = list.length > 0 ? list[list.length - 1] : undefined
    const version = prevVersion ? prevVersion.version + 1 : 1

    const info: VersionInfo = {
      artifactId: record.id,
      version,
      record: JSON.parse(JSON.stringify(record)),
      createdAt: Date.now(),
      createdBy: record.createdBy,
      changeLog,
      tags: [tag ?? 'latest'],
      parentVersion: prevVersion?.version,
    }

    list.push(info)
    this.versions.set(record.id, list)

    // 更新 'latest' 标签
    this.setTag(record.id, 'latest', version)

    return info
  }

  /**
   * getVersion — 获取指定版本
   */
  getVersion(artifactId: string, version: number): VersionInfo | undefined {
    const list = this.versions.get(artifactId)
    if (!list) return undefined
    return list.find(v => v.version === version)
  }

  /**
   * getLatest — 获取最新版本
   */
  getLatest(artifactId: string): VersionInfo | undefined {
    const list = this.versions.get(artifactId)
    if (!list || list.length === 0) return undefined
    return list[list.length - 1]
  }

  /**
   * getHistory — 获取版本历史（按版本升序）
   */
  getHistory(artifactId: string): VersionInfo[] {
    const list = this.versions.get(artifactId)
    if (!list) return []
    return [...list].sort((a, b) => a.version - b.version)
  }

  /**
   * diff — 比较两个版本的差异
   */
  diff(artifactId: string, fromVersion: number, toVersion: number): VersionDiff {
    const from = this.getVersion(artifactId, fromVersion)
    const to = this.getVersion(artifactId, toVersion)
    const changes: VersionDiff['changes'] = []

    if (!from || !to) {
      return { artifactId, fromVersion, toVersion, changes }
    }

    // 比较 meta 字段
    const fromMeta = from.record.meta
    const toMeta = to.record.meta
    const metaKeys = new Set([...Object.keys(fromMeta), ...Object.keys(toMeta)])
    for (const key of metaKeys) {
      const fv = JSON.stringify((fromMeta as any)[key])
      const tv = JSON.stringify((toMeta as any)[key])
      if (fv !== tv) {
        changes.push({ field: `meta.${key}`, from: (fromMeta as any)[key], to: (toMeta as any)[key] })
      }
    }

    // 比较 status
    if (from.record.status !== to.record.status) {
      changes.push({ field: 'status', from: from.record.status, to: to.record.status })
    }

    // 比较 checksum
    if (from.record.checksum !== to.record.checksum) {
      changes.push({ field: 'checksum', from: from.record.checksum, to: to.record.checksum })
    }

    // 比较 dependencies
    const fDeps = JSON.stringify(from.record.dependencies)
    const tDeps = JSON.stringify(to.record.dependencies)
    if (fDeps !== tDeps) {
      changes.push({ field: 'dependencies', from: from.record.dependencies, to: to.record.dependencies })
    }

    return { artifactId, fromVersion, toVersion, changes }
  }

  /**
   * setTag — 设置版本标签
   */
  setTag(artifactId: string, tag: VersionTag, version: number): boolean {
    const list = this.versions.get(artifactId)
    if (!list || !list.find(v => v.version === version)) return false

    if (!this.tags.has(artifactId)) {
      this.tags.set(artifactId, new Map())
    }
    this.tags.get(artifactId)!.set(tag, version)
    return true
  }

  /**
   * getVersionByTag — 按标签获取版本
   */
  getVersionByTag(artifactId: string, tag: VersionTag): VersionInfo | undefined {
    const tagMap = this.tags.get(artifactId)
    if (!tagMap) return undefined
    const version = tagMap.get(tag)
    if (version == null) return undefined
    return this.getVersion(artifactId, version)
  }

  /**
   * rollback — 回滚到指定版本
   *
   * 返回目标版本的记录（深拷贝），调用方使用此记录创建新版本。
   *
   * @param artifactId - 产物 ID
   * @param targetVersion - 目标版本号
   * @returns 目标版本的记录副本
   */
  rollback(artifactId: string, targetVersion: number): ArtifactRecord | undefined {
    const target = this.getVersion(artifactId, targetVersion)
    if (!target) return undefined

    const record = JSON.parse(JSON.stringify(target.record))
    record.version = (this.getLatest(artifactId)?.version ?? 0) + 1

    // 创建回滚版本
    const info = this.createVersion(record, `Rollback to version ${targetVersion}`, 'rollback')
    this.setTag(artifactId, 'latest', info.version)

    return info.record
  }

  /**
   * has — 检查是否有指定产物的任何版本
   */
  has(artifactId: string): boolean {
    return this.versions.has(artifactId) && (this.versions.get(artifactId)?.length ?? 0) > 0
  }

  /**
   * count — 指定产物的版本数
   */
  count(artifactId: string): number {
    return this.versions.get(artifactId)?.length ?? 0
  }

  /**
   * clear — 清空所有版本（仅用于测试）
   */
  clear(): void {
    this.versions.clear()
    this.tags.clear()
  }
}
