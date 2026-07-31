/**
 * ArtifactLineageTracker — 增强型产物血缘追踪器
 *
 * v9.1: 独立于 Knowledge Plane 的全新血缘追踪实现。
 *
 * 追踪维度：
 *   - 派生关系（A → B：B 由 A 生成）
 *   - 依赖关系（A depends on B：A 需要 B）
 *   - 替代关系（A supersedes B：A 替代 B）
 *   - 引用关系（A references B：A 引用 B）
 */

import type { ArtifactRecord, ArtifactType } from './types.js'

// ── LineageRelation — 血缘关系类型 ──

export type LineageRelation = 'derives_from' | 'depends_on' | 'supersedes' | 'references'

// ── LineageEdge — 血缘边 ──

export interface LineageEdge {
  /** 源产物 ID */
  fromId: string
  /** 目标产物 ID */
  toId: string
  /** 关系类型 */
  relation: LineageRelation
  /** 创建时间 */
  createdAt: number
  /** 权重（0-1，用于重要性排序） */
  weight: number
}

// ── LineagePath — 血缘路径 ──

export interface LineagePath {
  /** 路径中的节点（有序） */
  nodes: ArtifactRecord[]
  /** 路径中的边（有序） */
  edges: LineageEdge[]
  /** 路径深度 */
  depth: number
}

// ── ArtifactLineageTracker ──

export class ArtifactLineageTracker {
  /** 所有边 */
  private edges: LineageEdge[] = []
  /** fromId → 出边 */
  private outgoing = new Map<string, LineageEdge[]>()
  /** toId → 入边 */
  private incoming = new Map<string, LineageEdge[]>()

  /**
   * addRelation — 添加血缘关系
   *
   * @param fromId - 源产物 ID
   * @param toId - 目标产物 ID
   * @param relation - 关系类型
   * @param weight - 权重（0-1）
   */
  addRelation(fromId: string, toId: string, relation: LineageRelation, weight: number = 1): void {
    const edge: LineageEdge = {
      fromId,
      toId,
      relation,
      createdAt: Date.now(),
      weight: Math.max(0, Math.min(1, weight)),
    }

    this.edges.push(edge)

    if (!this.outgoing.has(fromId)) this.outgoing.set(fromId, [])
    this.outgoing.get(fromId)!.push(edge)

    if (!this.incoming.has(toId)) this.incoming.set(toId, [])
    this.incoming.get(toId)!.push(edge)
  }

  /**
   * getUpstream — 获取上游（哪些产物影响了指定产物）
   *
   * @param artifactId - 产物 ID
   * @param maxDepth - 最大深度
   * @param records - 产物记录 Map（用于查询节点详情）
   * @returns 上游路径
   */
  getUpstream(artifactId: string, maxDepth: number = 10, records: Map<string, ArtifactRecord>): LineagePath {
    return this.trace(artifactId, 'upstream', maxDepth, records)
  }

  /**
   * getDownstream — 获取下游（指定产物影响了哪些产物）
   *
   * @param artifactId - 产物 ID
   * @param maxDepth - 最大深度
   * @param records - 产物记录 Map
   * @returns 下游路径
   */
  getDownstream(artifactId: string, maxDepth: number = 10, records: Map<string, ArtifactRecord>): LineagePath {
    return this.trace(artifactId, 'downstream', maxDepth, records)
  }

  /**
   * getFullLineage — 获取完整血缘
   */
  getFullLineage(artifactId: string, maxDepth: number = 10, records: Map<string, ArtifactRecord>): {
    upstream: LineagePath
    downstream: LineagePath
  } {
    return {
      upstream: this.getUpstream(artifactId, maxDepth, records),
      downstream: this.getDownstream(artifactId, maxDepth, records),
    }
  }

  /**
   * findLCA — 查找两个产物的最近公共祖先
   *
   * @param idA - 产物 A
   * @param idB - 产物 B
   * @param records - 产物记录 Map
   * @returns 最近公共祖先，不存在则返回 undefined
   */
  findLCA(idA: string, idB: string, records: Map<string, ArtifactRecord>): ArtifactRecord | undefined {
    // 收集 A 的所有祖先
    const ancestorsA = this.collectAncestors(idA, new Set())
    // 收集 B 的所有祖先
    const ancestorsB = this.collectAncestors(idB, new Set())

    // 按深度从浅到深排序，找第一个交集
    for (const id of ancestorsA) {
      if (ancestorsB.has(id)) {
        return records.get(id)
      }
    }
    return undefined
  }

  /**
   * areSiblings — 判断两个产物是否同源（有公共祖先）
   */
  areSiblings(idA: string, idB: string): boolean {
    if (idA === idB) return true
    const ancestorsA = this.collectAncestors(idA, new Set())
    const ancestorsB = this.collectAncestors(idB, new Set())

    for (const id of ancestorsA) {
      if (ancestorsB.has(id)) return true
    }
    return false
  }

  /**
   * getRelations — 获取产物的所有关系
   */
  getRelations(artifactId: string): { outgoing: LineageEdge[]; incoming: LineageEdge[] } {
    return {
      outgoing: this.outgoing.get(artifactId) ?? [],
      incoming: this.incoming.get(artifactId) ?? [],
    }
  }

  /**
   * clear — 清空所有血缘数据（仅用于测试）
   */
  clear(): void {
    this.edges = []
    this.outgoing.clear()
    this.incoming.clear()
  }

  /**
   * count — 边的总数
   */
  count(): number {
    return this.edges.length
  }

  // ── 内部方法 ──

  private trace(
    start: string,
    direction: 'upstream' | 'downstream',
    maxDepth: number,
    records: Map<string, ArtifactRecord>
  ): LineagePath {
    const visited = new Set<string>()
    const pathNodes: ArtifactRecord[] = []
    const pathEdges: LineageEdge[] = []
    let depth = 0

    const traverse = (nodeId: string, currentDepth: number) => {
      if (visited.has(nodeId) || currentDepth > maxDepth) return
      visited.add(nodeId)

      const record = records.get(nodeId)
      if (record) pathNodes.push(record)
      depth = Math.max(depth, currentDepth)

      const edges = direction === 'upstream'
        ? (this.outgoing.get(nodeId) ?? [])   // upstream = things this node depends on
        : (this.incoming.get(nodeId) ?? [])   // downstream = things that depend on this node

      for (const edge of edges) {
        pathEdges.push(edge)
        const nextId = direction === 'upstream' ? edge.toId : edge.fromId
        traverse(nextId, currentDepth + 1)
      }
    }

    traverse(start, 0)
    return { nodes: pathNodes, edges: pathEdges, depth }
  }

  private collectAncestors(nodeId: string, visited: Set<string>): Set<string> {
    if (visited.has(nodeId)) return visited
    visited.add(nodeId)

    const outgoing = this.outgoing.get(nodeId) ?? []
    for (const edge of outgoing) {
      this.collectAncestors(edge.toId, visited)
    }

    return visited
  }
}
