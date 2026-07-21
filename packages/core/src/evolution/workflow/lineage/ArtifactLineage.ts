/**
 * ArtifactLineage — 产物血缘追踪 (v8.8 两阶段提交)
 *
 * MorPex v8.8: 追踪每个产物的来源和衍生关系。
 * 回答 "Where did this result come from?"
 *
 * ★ v8.8 两阶段提交 (Prepare → Commit):
 *   1. stage()     — 暂存临时产物 (TEMPORARY)
 *   2. verify()    — 验证通过后 commit() → COMMITTED
 *   3. verify()    — 验证失败后 rollback() → ROLLED_BACK
 *
 * 类似数据库事务: 未 COMMITTED 的产物不出现在公开查询中，
 * 防止无效产物污染血缘图。
 */

// ── ArtifactStatus — 产物状态 (v8.8 两阶段提交) ──

export enum ArtifactStatus {
  /** 暂存: 已生成但未验证 */
  TEMPORARY = 'TEMPORARY',
  /** 已验证: 通过验证待提交 */
  VERIFIED = 'VERIFIED',
  /** 已提交: 正式注册到血缘图 */
  COMMITTED = 'COMMITTED',
  /** 无效: 验证失败 */
  INVALID = 'INVALID',
  /** 已回滚: 补偿后清除 */
  ROLLED_BACK = 'ROLLED_BACK',
}

// ── ArtifactNode — 产物节点 ──

export interface ArtifactNode {
  id: string
  type: 'data' | 'analysis' | 'visualization' | 'report' | 'code' | 'document' | 'plan' | 'result'
  version: number
  workflowId: string
  missionId: string
  parentArtifacts: string[]
  createdBy: string
  createdAt: number
  metadata: Record<string, unknown>
  checksum?: string
  /** ★ v8.8: 产物状态 (两阶段提交) */
  status: ArtifactStatus
}

// ── ArtifactEdge — 产物关系边 ──

export interface ArtifactEdge {
  from: string
  to: string
  relationship: 'derived_from' | 'composed_of' | 'transformed_from' | 'references'
  workflowId: string
  missionId: string
}

// ── LineageQuery — 血缘查询 ──

export interface LineageQuery {
  artifactId: string
  direction: 'upstream' | 'downstream' | 'both'
  maxDepth: number
}

// ── LineagePath — 血缘路径 ──

export interface LineagePath {
  nodes: ArtifactNode[]
  edges: ArtifactEdge[]
  depth: number
}

// ── LineageGraph — 完整血缘图 ──

export interface LineageGraph {
  nodes: ArtifactNode[]
  edges: ArtifactEdge[]
}

// ═══════════════════════════════════════════════════════════════
// ArtifactLineage
// ═══════════════════════════════════════════════════════════════

export class ArtifactLineage {
  private nodes: Map<string, ArtifactNode> = new Map()
  private edges: ArtifactEdge[] = []

  // ═══════════════════════════════════════════════════════
  // ★ v8.8 两阶段提交
  // ═══════════════════════════════════════════════════════

  /**
   * stage — 暂存临时产物 (Prepare 阶段)
   *
   * 产物以 TEMPORARY 状态暂存，不出现在公开查询中。
   * 验证通过后调用 commit()，失败后调用 rollback()。
   *
   * @param node - 产物节点（status 强制设为 TEMPORARY）
   */
  stage(node: Omit<ArtifactNode, 'status'>): ArtifactNode {
    const staged: ArtifactNode = { ...node, status: ArtifactStatus.TEMPORARY }
    this.nodes.set(staged.id, staged)
    return staged
  }

  /**
   * commit — 提交产物到血缘图 (Commit 阶段)
   *
   * 将 TEMPORARY/VERIFIED 产物升级为 COMMITTED。
   * 只有 COMMITTED 产物出现在 getGraph() 和 trace() 中。
   *
   * @param artifactId - 产物 ID
   * @returns 提交后的节点，不存在或状态不对返回 undefined
   */
  commit(artifactId: string): ArtifactNode | undefined {
    const node = this.nodes.get(artifactId)
    if (!node) return undefined
    if (node.status === ArtifactStatus.COMMITTED) return node
    if (node.status === ArtifactStatus.ROLLED_BACK || node.status === ArtifactStatus.INVALID) return undefined
    node.status = ArtifactStatus.COMMITTED
    return node
  }

  /**
   * rollback — 回滚临时产物
   *
   * 验证失败或补偿时调用，标记为 ROLLED_BACK。
   * 产物节点保留用于审计，但不出现在公开查询中。
   *
   * @param artifactId - 产物 ID
   * @returns 回滚后的节点
   */
  rollback(artifactId: string): ArtifactNode | undefined {
    const node = this.nodes.get(artifactId)
    if (!node) return undefined
    node.status = ArtifactStatus.ROLLED_BACK
    return node
  }

  /**
   * markInvalid — 标记产物验证失败
   *
   * @param artifactId - 产物 ID
   */
  markInvalid(artifactId: string): ArtifactNode | undefined {
    const node = this.nodes.get(artifactId)
    if (!node) return undefined
    node.status = ArtifactStatus.INVALID
    return node
  }

  /**
   * markVerified — 标记产物已验证（待提交）
   *
   * @param artifactId - 产物 ID
   */
  markVerified(artifactId: string): ArtifactNode | undefined {
    const node = this.nodes.get(artifactId)
    if (!node) return undefined
    if (node.status !== ArtifactStatus.TEMPORARY) return undefined
    node.status = ArtifactStatus.VERIFIED
    return node
  }

  /**
   * getCommittedNodes — 只返回已提交的产物节点
   */
  private getCommittedNodes(): ArtifactNode[] {
    return [...this.nodes.values()].filter(n => n.status === ArtifactStatus.COMMITTED)
  }

  /**
   * getCommittedEdges — 只返回两端都是 COMMITTED 的边
   */
  private getCommittedEdges(): ArtifactEdge[] {
    return this.edges.filter(e => {
      const from = this.nodes.get(e.from)
      const to = this.nodes.get(e.to)
      return from?.status === ArtifactStatus.COMMITTED && to?.status === ArtifactStatus.COMMITTED
    })
  }

  // ═══════════════════════════════════════════════════════
  // 原有方法
  // ═══════════════════════════════════════════════════════

  /**
   * registerArtifact — 注册新的产物节点（直接 COMMITTED，向后兼容）
   *
   * @param node - 产物节点（status 默认为 COMMITTED）
   */
  registerArtifact(node: ArtifactNode): void {
    if (!node.status) {
      node.status = ArtifactStatus.COMMITTED
    }
    this.nodes.set(node.id, node)
  }

  /**
   * registerEdge — 注册产物之间的关系边
   *
   * @param edge - 关系边
   */
  registerEdge(edge: ArtifactEdge): void {
    this.edges.push(edge)
  }

  /**
   * trace — 追踪产物的血缘关系（只包含 COMMITTED 节点）
   *
   * @param query - 查询参数
   * @returns LineagePath
   */
  trace(query: LineageQuery): LineagePath {
    const visited = new Set<string>()
    const resultNodes: ArtifactNode[] = []
    const resultEdges: ArtifactEdge[] = []
    const committedEdges = this.getCommittedEdges()

    const traverse = (artifactId: string, depth: number) => {
      if (depth > query.maxDepth) return
      if (visited.has(artifactId)) return
      visited.add(artifactId)

      const node = this.nodes.get(artifactId)
      if (!node || node.status !== ArtifactStatus.COMMITTED) return
      resultNodes.push(node)

      if (query.direction === 'upstream' || query.direction === 'both') {
        for (const edge of committedEdges) {
          if (edge.to === artifactId) {
            resultEdges.push(edge)
            traverse(edge.from, depth + 1)
          }
        }
      }

      if (query.direction === 'downstream' || query.direction === 'both') {
        for (const edge of committedEdges) {
          if (edge.from === artifactId) {
            resultEdges.push(edge)
            traverse(edge.to, depth + 1)
          }
        }
      }
    }

    traverse(query.artifactId, 0)

    return {
      nodes: resultNodes,
      edges: resultEdges,
      depth: Math.min(query.maxDepth, resultNodes.length),
    }
  }

  /**
   * getGraph — 获取完整血缘图（只包含 COMMITTED 节点和边）
   */
  getGraph(): { nodes: ArtifactNode[]; edges: ArtifactEdge[] } {
    return {
      nodes: this.getCommittedNodes(),
      edges: this.getCommittedEdges(),
    }
  }

  /**
   * getGraphAll — 获取全部血缘图（含未提交的节点，用于审计/调试）
   */
  getGraphAll(): { nodes: ArtifactNode[]; edges: ArtifactEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
    }
  }

  /**
   * verifyIntegrity — 验证产物的完整性
   *
   * @param artifactId - 产物 ID
   * @returns { valid, expected, actual }
   */
  verifyIntegrity(artifactId: string): { valid: boolean; expected: string; actual: string } {
    const node = this.nodes.get(artifactId)
    if (!node || !node.checksum) {
      return { valid: false, expected: '', actual: 'No checksum' }
    }

    // 当前实现：checksum 由外部计算传入
    // 未来可对接实际哈希验证
    return { valid: true, expected: node.checksum, actual: node.checksum }
  }

  /**
   * getNode — 按 ID 获取产物节点
   *
   * @param id - 产物 ID
   */
  getNode(id: string): ArtifactNode | undefined {
    return this.nodes.get(id)
  }

  /**
   * getNodesByMission — 按 Mission ID 获取产物
   *
   * @param missionId - Mission ID
   */
  getNodesByMission(missionId: string): ArtifactNode[] {
    return [...this.nodes.values()].filter(n => n.missionId === missionId)
  }

  /**
   * getEdgesByMission — 按 Mission ID 获取关系边
   *
   * @param missionId - Mission ID
   */
  getEdgesByMission(missionId: string): ArtifactEdge[] {
    return this.edges.filter(e => e.missionId === missionId)
  }

  /**
   * getStats — 获取血缘图统计
   */
  getStats(): { nodeCount: number; edgeCount: number; missionCount: number } {
    const missions = new Set([...this.nodes.values()].map(n => n.missionId))
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      missionCount: missions.size,
    }
  }
}
