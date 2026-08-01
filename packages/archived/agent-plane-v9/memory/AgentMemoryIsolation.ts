/**
 * AgentMemoryScope — v9 Agent 内存隔离
 *
 * 每个 Agent 拥有独立的 Private Memory 分区。
 * Shared Memory 用于跨 Agent 协作。
 *
 * 架构:
 *   Knowledge Plane
 *     ├── Shared Memory (跨 Agent 可读)
 *     └── Private Memory (per Agent 分区)
 *           ├── planner-001/private
 *           ├── coder-001/private
 *           └── reviewer-001/private
 */

export interface AgentMemoryPartition {
  agentId: string
  privateEntries: Map<string, unknown>    // key → value
  sharedReadAccess: string[]              // 可读的 shared memory keys
  maxEntries: number
  createdAt: number
  lastAccessedAt: number
}

export interface SharedMemoryEntry {
  key: string
  value: unknown
  writtenBy: string                       // agentId
  timestamp: number
  ttl?: number                            // time-to-live ms
}

export class AgentMemoryIsolation {
  private privatePartitions: Map<string, AgentMemoryPartition> = new Map()
  private sharedMemory: Map<string, SharedMemoryEntry> = new Map()

  /**
   * createPartition — 为 Agent 创建私有内存分区
   */
  createPartition(agentId: string, maxEntries: number = 1000): AgentMemoryPartition {
    const partition: AgentMemoryPartition = {
      agentId,
      privateEntries: new Map(),
      sharedReadAccess: [],
      maxEntries,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    }
    this.privatePartitions.set(agentId, partition)
    return partition
  }

  /**
   * writePrivate — 写入 Agent 私有内存
   */
  writePrivate(agentId: string, key: string, value: unknown): boolean {
    const partition = this.privatePartitions.get(agentId)
    if (!partition) return false
    if (partition.privateEntries.size >= partition.maxEntries) return false
    partition.privateEntries.set(key, value)
    partition.lastAccessedAt = Date.now()
    return true
  }

  /**
   * readPrivate — 读取 Agent 私有内存
   */
  readPrivate(agentId: string, key: string): unknown | undefined {
    const partition = this.privatePartitions.get(agentId)
    if (!partition) return undefined
    partition.lastAccessedAt = Date.now()
    return partition.privateEntries.get(key)
  }

  /**
   * queryPrivate — 按前缀查询私有内存
   */
  queryPrivate(agentId: string, prefix: string): { key: string; value: unknown }[] {
    const partition = this.privatePartitions.get(agentId)
    if (!partition) return []
    const results: { key: string; value: unknown }[] = []
    for (const [key, value] of partition.privateEntries) {
      if (key.startsWith(prefix)) results.push({ key, value })
    }
    return results
  }

  /**
   * writeShared — 写入共享内存
   */
  writeShared(agentId: string, key: string, value: unknown, ttl?: number): void {
    this.sharedMemory.set(key, {
      key, value, writtenBy: agentId, timestamp: Date.now(), ttl,
    })
  }

  /**
   * readShared — 读取共享内存
   */
  readShared(key: string): unknown | undefined {
    const entry = this.sharedMemory.get(key)
    if (!entry) return undefined
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.sharedMemory.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * grantSharedAccess — 授权 Agent 读取共享内存
   */
  grantSharedAccess(agentId: string, sharedKeys: string[]): void {
    const partition = this.privatePartitions.get(agentId)
    if (!partition) return
    for (const key of sharedKeys) {
      if (!partition.sharedReadAccess.includes(key)) {
        partition.sharedReadAccess.push(key)
      }
    }
  }

  /**
   * getStats — 获取内存隔离统计
   */
  getStats(): {
    agentCount: number
    totalPrivateEntries: number
    sharedEntries: number
    partitions: { agentId: string; entries: number; maxEntries: number; usagePercent: number }[]
  } {
    const partitions = [...this.privatePartitions.values()].map(p => ({
      agentId: p.agentId,
      entries: p.privateEntries.size,
      maxEntries: p.maxEntries,
      usagePercent: Math.round((p.privateEntries.size / p.maxEntries) * 100),
    }))

    let totalPrivate = 0
    for (const p of this.privatePartitions.values()) {
      totalPrivate += p.privateEntries.size
    }

    return {
      agentCount: this.privatePartitions.size,
      totalPrivateEntries: totalPrivate,
      sharedEntries: this.sharedMemory.size,
      partitions,
    }
  }

  /**
   * clearAgent — 清空 Agent 的私有内存
   */
  clearAgent(agentId: string): void {
    this.privatePartitions.delete(agentId)
  }

  /**
   * cleanupExpired — 清理过期的共享内存条目
   */
  cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0
    for (const [key, entry] of this.sharedMemory) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        this.sharedMemory.delete(key)
        cleaned++
      }
    }
    return cleaned
  }
}
