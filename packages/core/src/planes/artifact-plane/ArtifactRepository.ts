/**
 * ArtifactRepository — 产物存储仓库
 *
 * v9.1: 产物持久化存储抽象层。
 *
 * 支持多种后端：
 *   - 内存（默认，用于测试）
 *   - 本地文件系统
 *   - S3 兼容对象存储
 *
 * 当前实现使用内存 Map，后续可替换为实际后端。
 */

import type { ArtifactRecord, ArtifactQuery, ArtifactType, ArtifactStatus } from './types.js'

// ── ArtifactRepository ──

export class ArtifactRepository {
  /** id → ArtifactRecord */
  private store = new Map<string, ArtifactRecord>()

  /**
   * save — 保存产物记录
   *
   * @param record - 完整产物记录
   */
  save(record: ArtifactRecord): void {
    this.store.set(record.id, { ...record, updatedAt: Date.now() })
  }

  /**
   * get — 获取产物记录
   */
  get(id: string): ArtifactRecord | undefined {
    const record = this.store.get(id)
    return record ? { ...record } : undefined
  }

  /**
   * delete — 删除产物记录
   *
   * @returns 是否存在并删除
   */
  delete(id: string): boolean {
    return this.store.delete(id)
  }

  /**
   * query — 按条件查询产物
   */
  query(q: ArtifactQuery): ArtifactRecord[] {
    let results = [...this.store.values()]

    if (q.type) results = results.filter(r => r.meta.type === q.type)
    if (q.status) results = results.filter(r => r.status === q.status)
    if (q.name) results = results.filter(r => r.meta.name.toLowerCase().includes(q.name!.toLowerCase()))
    if (q.createdBy) results = results.filter(r => r.createdBy === q.createdBy)
    if (q.source) results = results.filter(r => r.source === q.source)
    if (q.tags && q.tags.length > 0) {
      results = results.filter(r => r.meta.tags?.some(t => q.tags!.includes(t)))
    }

    // 按更新时间倒序
    results.sort((a, b) => b.updatedAt - a.updatedAt)

    // 分页
    const offset = q.offset ?? 0
    const limit = q.limit ?? 50
    return results.slice(offset, offset + limit)
  }

  /**
   * count — 产物总数
   */
  count(): number {
    return this.store.size
  }

  /**
   * exists — 检查产物是否存在
   */
  exists(id: string): boolean {
    return this.store.has(id)
  }

  /**
   * all — 获取所有产物
   */
  all(): ArtifactRecord[] {
    return [...this.store.values()]
  }

  /**
   * clear — 清空所有产物（仅用于测试）
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * toJSON — 导出所有数据用于持久化
   */
  toJSON(): ArtifactRecord[] {
    return [...this.store.values()]
  }

  /**
   * fromJSON — 从持久化数据恢复
   */
  fromJSON(data: ArtifactRecord[]): void {
    for (const record of data) {
      this.store.set(record.id, record)
    }
  }
}
