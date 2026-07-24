/**
 * ConflictResolver — 写冲突解决器
 *
 * 当多个 Agent 同时写入同一 key 时，按策略解决冲突。
 */

import type { MemoryScope } from './SharedMemoryManager.js'

export type ConflictResolutionStrategy = 'last_write_wins' | 'first_write_wins' | 'merge' | 'majority_vote'

export interface ConflictRecord {
  key: string
  scope: MemoryScope
  conflictingValues: { agentId: string; value: unknown; timestamp: number }[]
  resolvedValue: unknown
  strategy: ConflictResolutionStrategy
  resolvedAt: number
}

export class ConflictResolver {
  private history = new Map<string, ConflictRecord[]>()

  /**
   * resolve — 解决冲突
   */
  resolve(
    key: string,
    conflicts: { agentId: string; value: unknown; timestamp: number }[],
    strategy: ConflictResolutionStrategy,
    scope: MemoryScope
  ): { value: unknown; record: ConflictRecord } {
    let resolvedValue: unknown

    switch (strategy) {
      case 'last_write_wins':
        resolvedValue = conflicts.reduce((latest, c) =>
          c.timestamp > latest.timestamp ? c : latest
        ).value
        break

      case 'first_write_wins':
        resolvedValue = conflicts.reduce((earliest, c) =>
          c.timestamp < earliest.timestamp ? c : earliest
        ).value
        break

      case 'merge':
        // 如果所有值都是对象，尝试深度合并；否则 last_write_wins
        if (conflicts.every(c => c.value && typeof c.value === 'object' && !Array.isArray(c.value))) {
          const merged: Record<string, unknown> = {}
          for (const c of conflicts) {
            Object.assign(merged, c.value as Record<string, unknown>)
          }
          resolvedValue = merged
        } else {
          resolvedValue = conflicts.reduce((latest, c) =>
            c.timestamp > latest.timestamp ? c : latest
          ).value
        }
        break

      case 'majority_vote': {
        // 统计相同值的数量
        const valueCounts = new Map<string, number>()
        let maxCount = 0
        let mostCommon: unknown = null

        for (const c of conflicts) {
          const key = JSON.stringify(c.value)
          const count = (valueCounts.get(key) || 0) + 1
          valueCounts.set(key, count)
          if (count > maxCount) {
            maxCount = count
            mostCommon = c.value
          }
        }

        resolvedValue = mostCommon ?? conflicts[0].value
        break
      }

      default:
        resolvedValue = conflicts[0].value
    }

    const record: ConflictRecord = {
      key,
      scope,
      conflictingValues: [...conflicts],
      resolvedValue,
      strategy,
      resolvedAt: Date.now(),
    }

    if (!this.history.has(key)) {
      this.history.set(key, [])
    }
    this.history.get(key)!.push(record)

    return { value: resolvedValue, record }
  }

  /**
   * getHistory — 获取冲突历史
   */
  getHistory(key: string): ConflictRecord[] {
    return [...(this.history.get(key) || [])]
  }

  /**
   * getStats — 获取冲突统计
   */
  getStats(): { totalConflicts: number; byStrategy: Record<string, number> } {
    const byStrategy: Record<string, number> = {}
    let totalConflicts = 0

    for (const records of this.history.values()) {
      for (const record of records) {
        byStrategy[record.strategy] = (byStrategy[record.strategy] || 0) + 1
        totalConflicts++
      }
    }

    return { totalConflicts, byStrategy }
  }
}
