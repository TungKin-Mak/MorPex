/**
 * GovernanceAudit — 治理审计
 *
 * v9.2: 记录所有组织治理决策，用于审计和追溯。
 * 只追加（append-only），不可篡改。
 */

export interface GovernanceAuditEntry {
  id: string
  type: 'policy_check' | 'team_change' | 'budget_change' | 'escalation' | 'cross_team_collab'
  sourceAgentId: string
  targetAgentId?: string
  teamId?: string
  decision: string
  reason: string
  details: Record<string, unknown>
  timestamp: number
}

export class GovernanceAudit {
  private entries: GovernanceAuditEntry[] = []
  private counter = 0

  /**
   * record — 记录一条审计条目
   */
  record(entry: Omit<GovernanceAuditEntry, 'id'>): GovernanceAuditEntry {
    const full: GovernanceAuditEntry = {
      id: `gov_${Date.now()}_${++this.counter}`,
      ...entry,
    } as GovernanceAuditEntry
    this.entries.push(full)
    return full
  }

  /**
   * query — 按条件查询审计条目
   */
  query(filter: {
    teamId?: string
    sourceAgentId?: string
    type?: GovernanceAuditEntry['type']
    since?: number
    until?: number
  }): GovernanceAuditEntry[] {
    let results = [...this.entries]

    if (filter.teamId) results = results.filter(e => e.teamId === filter.teamId)
    if (filter.sourceAgentId) results = results.filter(e => e.sourceAgentId === filter.sourceAgentId)
    if (filter.type) results = results.filter(e => e.type === filter.type)
    if (filter.since) results = results.filter(e => e.timestamp >= filter.since!)
    if (filter.until) results = results.filter(e => e.timestamp <= filter.until!)

    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * getStats — 获取审计统计
   */
  getStats(): { total: number; byType: Record<string, number>; byDecision: Record<string, number> } {
    const byType: Record<string, number> = {}
    const byDecision: Record<string, number> = {}

    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1
      byDecision[e.decision] = (byDecision[e.decision] || 0) + 1
    }

    return {
      total: this.entries.length,
      byType,
      byDecision,
    }
  }

  /**
   * toJSON — 导出所有条目
   */
  toJSON(): GovernanceAuditEntry[] {
    return [...this.entries]
  }

  /**
   * fromJSON — 导入条目
   */
  fromJSON(data: GovernanceAuditEntry[]): void {
    this.entries.push(...data)
  }
}
