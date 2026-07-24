/**
 * MemorySnapshotService — 内存快照服务
 *
 * 定期创建共享内存的快照，用于恢复和审计。
 * 支持按范围（scope）创建快照，按需恢复。
 */

import type { MemoryScope } from './SharedMemoryManager.js'
import { SharedMemoryManager } from './SharedMemoryManager.js'

export interface MemorySnapshot {
  id: string
  scope: MemoryScope
  entries: { key: string; value: unknown; writtenBy: string; timestamp: number }[]
  takenAt: number
  size: number
}

export class MemorySnapshotService {
  private snapshots = new Map<string, MemorySnapshot>()
  private counter = 0
  private autoTimer: ReturnType<typeof setInterval> | null = null

  /**
   * takeSnapshot — 创建快照
   */
  takeSnapshot(scope: MemoryScope, manager: SharedMemoryManager): MemorySnapshot {
    const entries = manager.query('', scope)
    const snapshot: MemorySnapshot = {
      id: `snap_${scope}_${Date.now()}_${++this.counter}`,
      scope,
      entries,
      takenAt: Date.now(),
      size: entries.length,
    }

    this.snapshots.set(snapshot.id, snapshot)
    return snapshot
  }

  /**
   * restoreSnapshot — 恢复快照
   *
   * 将快照中的条目写回 SharedMemoryManager。
   */
  restoreSnapshot(snapshotId: string, manager: SharedMemoryManager): boolean {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) return false

    // 覆盖当前内存
    for (const entry of snapshot.entries) {
      manager.write(entry.key, entry.value, snapshot.scope, entry.writtenBy)
    }

    return true
  }

  /**
   * listSnapshots — 列出快照
   */
  listSnapshots(scope?: MemoryScope): MemorySnapshot[] {
    const all = [...this.snapshots.values()]
    if (scope) return all.filter(s => s.scope === scope)
    return all.sort((a, b) => b.takenAt - a.takenAt)
  }

  /**
   * getSnapshot — 获取快照
   */
  getSnapshot(id: string): MemorySnapshot | undefined {
    return this.snapshots.get(id)
  }

  /**
   * pruneSnapshots — 只保留最新的 N 个快照
   */
  pruneSnapshots(maxCount: number): number {
    const all = [...this.snapshots.entries()]
      .sort(([, a], [, b]) => b.takenAt - a.takenAt)

    let removed = 0
    for (let i = maxCount; i < all.length; i++) {
      this.snapshots.delete(all[i][0])
      removed++
    }

    return removed
  }

  /**
   * scheduleAutoSnapshot — 开始自动快照
   */
  scheduleAutoSnapshot(intervalMs: number, scope: MemoryScope, manager: SharedMemoryManager): void {
    if (this.autoTimer) return

    this.autoTimer = setInterval(() => {
      this.takeSnapshot(scope, manager)
    }, intervalMs)
  }

  /**
   * stopAutoSnapshot — 停止自动快照
   */
  stopAutoSnapshot(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer)
      this.autoTimer = null
    }
  }
}
