/**
 * SharedMemoryManager — 共享内存管理器
 *
 * v9.2: 支持三级内存范围（private / team_shared / org_shared）。
 * 扩展 AgentMemoryIsolation，支持更细粒度的访问控制。
 */

export type MemoryConsistencyLevel = 'eventual' | 'causal' | 'linearizable'
export type MemoryScope = 'private' | 'team_shared' | 'org_shared'

export interface SharedMemoryConfig {
  maxEntries: number
  defaultTTL: number
  consistencyLevel: MemoryConsistencyLevel
  autoCleanupInterval: number
}

interface ScopedEntry {
  key: string
  value: unknown
  writtenBy: string
  timestamp: number
  ttl?: number
}

const DEFAULT_CONFIG: SharedMemoryConfig = {
  maxEntries: 10000,
  defaultTTL: 3600000, // 1 hour
  consistencyLevel: 'eventual',
  autoCleanupInterval: 60000, // 1 min
}

export class SharedMemoryManager {
  private stores = {
    private: new Map<string, ScopedEntry>(),
    team_shared: new Map<string, ScopedEntry>(),
    org_shared: new Map<string, ScopedEntry>(),
  } as const

  private accessControls = {
    private: new Map<string, Set<string>>(), // agentId → allowedKeys
    team_shared: new Map<string, Set<string>>(),
    org_shared: new Map<string, Set<string>>(),
  } as const

  private config: SharedMemoryConfig

  constructor(config?: Partial<SharedMemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * write — 写入指定范围的内存
   */
  write(key: string, value: unknown, scope: MemoryScope, agentId: string, ttl?: number): void {
    const store = this.stores[scope]
    if (store.size >= this.config.maxEntries) return

    store.set(key, {
      key,
      value,
      writtenBy: agentId,
      timestamp: Date.now(),
      ttl: ttl ?? this.config.defaultTTL,
    })
  }

  /**
   * read — 读取指定范围的内存
   */
  read(key: string, scope: MemoryScope): unknown | undefined {
    const store = this.stores[scope]
    const entry = store.get(key)
    if (!entry) return undefined

    // TTL 检查
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      store.delete(key)
      return undefined
    }

    return entry.value
  }

  /**
   * query — 按前缀查询
   */
  query(prefix: string, scope: MemoryScope): { key: string; value: unknown; writtenBy: string; timestamp: number }[] {
    const store = this.stores[scope]
    const results: { key: string; value: unknown; writtenBy: string; timestamp: number }[] = []

    for (const [key, entry] of store) {
      if (key.startsWith(prefix)) {
        results.push({
          key,
          value: entry.value,
          writtenBy: entry.writtenBy,
          timestamp: entry.timestamp,
        })
      }
    }

    return results
  }

  /**
   * delete — 删除指定 key（仅写入者可删除）
   */
  delete(key: string, scope: MemoryScope, agentId: string): boolean {
    const store = this.stores[scope]
    const entry = store.get(key)
    if (!entry) return false
    if (entry.writtenBy !== agentId) return false

    return store.delete(key)
  }

  /**
   * grantAccess — 授权 Agent 访问特定 key
   */
  grantAccess(agentId: string, scope: MemoryScope, keys: string[]): void {
    const control = this.accessControls[scope]
    if (!control.has(agentId)) {
      control.set(agentId, new Set())
    }
    const allowed = control.get(agentId)!
    for (const key of keys) {
      allowed.add(key)
    }
  }

  /**
   * revokeAccess — 撤销 Agent 访问权限
   */
  revokeAccess(agentId: string, scope: MemoryScope, keys: string[]): void {
    const control = this.accessControls[scope]
    const allowed = control.get(agentId)
    if (!allowed) return
    for (const key of keys) {
      allowed.delete(key)
    }
  }

  /**
   * cleanupExpired — 清理过期条目
   */
  cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0
    for (const scope of ['private', 'team_shared', 'org_shared'] as MemoryScope[]) {
      const store = this.stores[scope]
      for (const [key, entry] of store) {
        if (entry.ttl && now - entry.timestamp > entry.ttl) {
          store.delete(key)
          cleaned++
        }
      }
    }
    return cleaned
  }

  /**
   * getStats — 获取统计
   */
  getStats(): { private: number; team_shared: number; org_shared: number; total: number } {
    return {
      private: this.stores.private.size,
      team_shared: this.stores.team_shared.size,
      org_shared: this.stores.org_shared.size,
      total: this.stores.private.size + this.stores.team_shared.size + this.stores.org_shared.size,
    }
  }
}
