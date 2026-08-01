/**
 * ContextVersioner — 上下文版本管理器
 *
 * v9.1 Context Assembly Layer: 为 ExecutionContext 提供 Git-like 版本控制。
 *
 * 能力：
 *   - 快照（版本递增）
 *   - 按版本查询
 *   - 版本历史
 *   - 版本间差异
 *   - 回滚到指定版本
 */

import type { ExecutionContext } from './ContextBuilder.js'
import type { ContextPersistence } from './ContextPersistence.js'

// ── ContextSnapshot — 上下文快照 ──

export interface ContextSnapshot {
  /** 上下文 ID */
  contextId: string
  /** 版本号 */
  version: number
  /** 快照数据 */
  context: ExecutionContext
  /** 父版本号（回滚用） */
  parentVersion?: number
  /** 快照时间戳 */
  timestamp: number
  /** 变更说明 */
  changeDescription?: string
}

// ── DiffEntry — 差异条目 ──

export interface DiffEntry {
  /** 字段路径（如 "layers.base.userId"） */
  path: string
  /** 旧值 */
  from: unknown
  /** 新值 */
  to: unknown
}

// ── ContextVersioner — 版本管理器 ──

export class ContextVersioner {
  /** contextId → 有序快照列表 */
  private snapshots = new Map<string, ContextSnapshot[]>()
  /** contextId → 当前版本号 */
  private currentVersions = new Map<string, number>()
  /** ★ v9.1 Stage 1: 可选的持久化层 */
  private persistence?: ContextPersistence

  /**
   * @param persistence - 可选的持久化层（设置后将自动持久化每个快照）
   */
  constructor(persistence?: ContextPersistence) {
    this.persistence = persistence
  }

  /**
   * snapshot — 创建上下文快照
   *
   * 版本号自动递增（从 1 开始）。
   * 记录父版本以支持回滚链路。
   * 如果配置了 persistence，自动持久化到 SQLite。
   *
   * @param context - 要快照的 ExecutionContext
   * @param changeDescription - 变更说明（可选）
   * @returns 创建的快照
   */
  snapshot(context: ExecutionContext, changeDescription?: string): ContextSnapshot {
    const { contextId, version } = context
    const existing = this.snapshots.get(contextId) ?? []
    const parentVersion = existing.length > 0 ? existing[existing.length - 1].version : undefined

    const snap: ContextSnapshot = {
      contextId,
      version,
      context: JSON.parse(JSON.stringify(context)), // 深拷贝
      parentVersion,
      timestamp: Date.now(),
      changeDescription,
    }

    existing.push(snap)
    this.snapshots.set(contextId, existing)
    this.currentVersions.set(contextId, version)

    // ★ v9.1 Stage 1: 自动持久化
    if (this.persistence) {
      this.persistence.save(context, changeDescription)
    }

    return snap
  }

  /**
   * getCurrent — 获取指定上下文的当前快照
   */
  getCurrent(contextId: string): ContextSnapshot | undefined {
    const list = this.snapshots.get(contextId)
    if (!list || list.length === 0) return undefined
    return list[list.length - 1]
  }

  /**
   * getVersion — 获取指定版本的快照
   */
  getVersion(contextId: string, version: number): ContextSnapshot | undefined {
    const list = this.snapshots.get(contextId)
    if (!list) return undefined
    return list.find(s => s.version === version)
  }

  /**
   * getHistory — 获取上下文的完整版本历史
   *
   * @returns 按版本升序排列的快照列表
   */
  getHistory(contextId: string): ContextSnapshot[] {
    const list = this.snapshots.get(contextId)
    if (!list) return []
    return [...list].sort((a, b) => a.version - b.version)
  }

  /**
   * diff — 比较两个版本的差异
   *
   * 递归比较两层结构的字段差异。
   * 只比较 layers 中各层的顶层字段。
   *
   * @param contextId - 上下文 ID
   * @param v1 - 旧版本
   * @param v2 - 新版本
   * @returns 差异条目列表
   */
  diff(contextId: string, v1: number, v2: number): DiffEntry[] {
    const snap1 = this.getVersion(contextId, v1)
    const snap2 = this.getVersion(contextId, v2)

    if (!snap1 || !snap2) return []

    const result: DiffEntry[] = []
    const ctx1 = snap1.context
    const ctx2 = snap2.context

    // 比较各层
    const layers: Array<keyof ExecutionContext['layers']> = ['base', 'session', 'ephemeral']
    for (const layer of layers) {
      const data1 = ctx1.layers[layer] ?? {}
      const data2 = ctx2.layers[layer] ?? {}
      const allKeys = new Set([...Object.keys(data1), ...Object.keys(data2)])

      for (const key of allKeys) {
        const val1 = data1[key]
        const val2 = data2[key]
        if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          result.push({
            path: `layers.${layer}.${key}`,
            from: val1,
            to: val2,
          })
        }
      }
    }

    // 比较 fragments 数量
    if (ctx1.fragments.length !== ctx2.fragments.length) {
      result.push({
        path: 'fragments',
        from: ctx1.fragments.length,
        to: ctx2.fragments.length,
      })
    }

    // 比较 version
    if (ctx1.version !== ctx2.version) {
      result.push({
        path: 'version',
        from: ctx1.version,
        to: ctx2.version,
      })
    }

    return result
  }

  /**
   * rollback — 回滚到指定版本
   *
   * 返回目标版本的快照，当前版本号不变。
   * 调用方需使用返回的快照数据重建 ExecutionContext。
   *
   * @param contextId - 上下文 ID
   * @param targetVersion - 目标版本号
   * @returns 目标版本的快照，不存在时返回 undefined
   */
  rollback(contextId: string, targetVersion: number): ContextSnapshot | undefined {
    const target = this.getVersion(contextId, targetVersion)
    if (!target) return undefined

    // 将当前版本更新为目标版本
    this.currentVersions.set(contextId, targetVersion)
    return target
  }

  /**
   * has — 检查是否有指定上下文的任何快照
   */
  has(contextId: string): boolean {
    return this.snapshots.has(contextId) && (this.snapshots.get(contextId)?.length ?? 0) > 0
  }

  /**
   * loadFromDb — 从数据库加载指定上下文的最新版本
   *
   * 如果持久化层已配置且内存中无此上下文的快照，则从 SQLite 加载。
   *
   * @param contextId - 上下文 ID
   * @returns 加载的 ExecutionContext 或 undefined
   */
  loadFromDb(contextId: string): ExecutionContext | undefined {
    if (!this.persistence) return undefined
    if (this.has(contextId)) return undefined // 内存中已有，无需加载

    const ctx = this.persistence.loadLatest(contextId)
    if (!ctx) return undefined

    // 重建快照索引
    const existing = this.snapshots.get(contextId) ?? []
    const snap: ContextSnapshot = {
      contextId: ctx.contextId,
      version: ctx.version,
      context: JSON.parse(JSON.stringify(ctx)),
      timestamp: ctx.assembledAt,
    }
    existing.push(snap)
    this.snapshots.set(contextId, existing)
    this.currentVersions.set(contextId, ctx.version)

    return ctx
  }

  /**
   * clear — 清空所有快照（仅用于测试）
   */
  clear(): void {
    this.snapshots.clear()
    this.currentVersions.clear()
  }

  /**
   * getPersistence — 获取持久化层实例
   */
  getPersistence(): ContextPersistence | undefined {
    return this.persistence
  }
}
