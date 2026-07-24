/**
 * MemoryLockService — 共享内存锁服务
 *
 * 读写锁：多个 Agent 可同时读，但写操作独占。
 * 防止并发写入导致的数据不一致。
 */

import type { MemoryScope } from './SharedMemoryManager.js'

export interface MemoryLock {
  key: string
  holderAgentId: string
  lockType: 'read' | 'write'
  acquiredAt: number
  expiresAt: number
  scope: MemoryScope
}

export class MemoryLockService {
  private locks = new Map<string, MemoryLock>()
  private defaultTimeoutMs = 30000 // 30s

  /**
   * acquireLock — 获取锁
   *
   * 读锁：可共享（多个读锁同时存在）
   * 写锁：独占（无其他读锁或写锁时可获取）
   */
  async acquireLock(
    key: string,
    agentId: string,
    type: 'read' | 'write',
    scope: MemoryScope,
    timeoutMs?: number
  ): Promise<boolean> {
    const existing = this.locks.get(key)
    const now = Date.now()

    // 清理过期锁
    if (existing && now > existing.expiresAt) {
      this.locks.delete(key)
    }

    if (type === 'write') {
      // 写锁需要独占
      if (this.locks.has(key)) return false
    } else {
      // 读锁：有写锁时不可获取
      if (existing && existing.lockType === 'write') return false
    }

    const lock: MemoryLock = {
      key,
      holderAgentId: agentId,
      lockType: type,
      acquiredAt: now,
      expiresAt: now + (timeoutMs ?? this.defaultTimeoutMs),
      scope,
    }

    this.locks.set(key, lock)
    return true
  }

  /**
   * releaseLock — 释放锁
   */
  releaseLock(key: string, agentId: string): boolean {
    const lock = this.locks.get(key)
    if (!lock || lock.holderAgentId !== agentId) return false

    // 读锁：解除后如果没有其他读锁，key 可被写
    // 写锁：直接释放
    this.locks.delete(key)
    return true
  }

  /**
   * isLocked — 检查 key 是否被锁定
   */
  isLocked(key: string): { locked: boolean; holder?: string; type?: string } {
    const lock = this.locks.get(key)
    if (!lock) return { locked: false }
    if (Date.now() > lock.expiresAt) {
      this.locks.delete(key)
      return { locked: false }
    }
    return { locked: true, holder: lock.holderAgentId, type: lock.lockType }
  }

  /**
   * cleanupExpiredLocks — 清理过期锁
   */
  cleanupExpiredLocks(): number {
    const now = Date.now()
    let cleaned = 0
    for (const [key, lock] of this.locks) {
      if (now > lock.expiresAt) {
        this.locks.delete(key)
        cleaned++
      }
    }
    return cleaned
  }

  /**
   * getActiveLocks — 获取所有活跃锁
   */
  getActiveLocks(): MemoryLock[] {
    this.cleanupExpiredLocks()
    return [...this.locks.values()]
  }
}
