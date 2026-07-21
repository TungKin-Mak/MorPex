/**
 * AgentGovernanceRepository — Agent 治理持久化仓储 (SQLite)
 *
 * v9.2 Stage 1: Agent 身份、能力、治理日志的 SQLite 持久化。
 *
 * 使用方式:
 *   const repo = new AgentGovernanceRepository(db);
 *   repo.saveAgent(identity);
 *   repo.recordGovernance(agentId, 'lifecycle_transition', 'DEPRECATED', 'Too many failures');
 */

import type Database from 'better-sqlite3'
import type { AgentIdentity } from '../identity/AgentIdentity.js'

export class AgentGovernanceRepository {
  constructor(private db: Database.Database) {}

  /** 持久化 Agent 身份 + 治理元数据 */
  saveAgent(identity: AgentIdentity): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, role, status, version, memory_scope, permission_scope,
        trust_level, max_risk_level, require_approval_for_collab, organization_tag, metadata_json, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      identity.id, identity.name, identity.role, identity.status, identity.version,
      identity.memoryScope, identity.permissionScope,
      identity.governance?.trustLevel ?? 0.5,
      identity.governance?.maxRiskLevel ?? 'medium',
      identity.governance?.requireApprovalForCollab ? 1 : 0,
      identity.governance?.organizationTag ?? null,
      JSON.stringify(identity.metadata ?? {}),
      identity.createdAt,
      Date.now(),
    )
  }

  /** 持久化能力分 */
  saveCapability(agentId: string, capabilityName: string, level: number, successRate: number, cost: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_capabilities (agent_id, capability_name, level, success_rate, cost, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, capabilityName, level, successRate, cost, Date.now())
  }

  /** 记录治理决策 */
  recordGovernance(agentId: string, eventType: string, decision: string, reason: string, details?: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO agent_governance_log (agent_id, event_type, decision, reason, details_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, eventType, decision, reason, JSON.stringify(details ?? {}), Date.now())
  }

  /** 更新 Agent 状态 */
  updateStatus(agentId: string, status: string): void {
    this.db.prepare('UPDATE agents SET status = ?, last_active_at = ? WHERE id = ?').run(status, Date.now(), agentId)
  }

  /** 更新信任等级 */
  updateTrustLevel(agentId: string, trustLevel: number): void {
    this.db.prepare('UPDATE agents SET trust_level = ? WHERE id = ?').run(Math.max(0, Math.min(1, trustLevel)), agentId)
  }

  /** 按 ID 获取 Agent */
  getAgent(id: string): any | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  }

  /** 获取 Agent 能力列表 */
  getCapabilities(agentId: string): any[] {
    return this.db.prepare('SELECT * FROM agent_capabilities WHERE agent_id = ?').all(agentId)
  }

  /** 查询治理日志 */
  queryGovernanceLog(agentId?: string, eventType?: string, limit?: number): any[] {
    let sql = 'SELECT * FROM agent_governance_log WHERE 1=1';
    const params: any[] = [];
    if (agentId) { sql += ' AND agent_id = ?'; params.push(agentId); }
    if (eventType) { sql += ' AND event_type = ?'; params.push(eventType); }
    sql += ' ORDER BY recorded_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(limit); }
    return this.db.prepare(sql).all(...params);
  }

  /** 记录协作结果 */
  recordCollaboration(agentId: string, collaboratorId: string, outcome: string, missionId?: string, durationMs?: number): void {
    this.db.prepare(`
      INSERT INTO agent_collaborations (agent_id, collaborator_id, outcome, mission_id, duration_ms, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, collaboratorId, outcome, missionId ?? null, durationMs ?? null, Date.now())
  }

  /** 获取协作统计 */
  getCollaborationStats(agentId: string): { total: number; successful: number; failed: number } {
    const total = this.db.prepare('SELECT COUNT(*) as c FROM agent_collaborations WHERE agent_id = ?').get(agentId) as any;
    const success = this.db.prepare("SELECT COUNT(*) as c FROM agent_collaborations WHERE agent_id = ? AND outcome = 'success'").get(agentId) as any;
    const failed = this.db.prepare("SELECT COUNT(*) as c FROM agent_collaborations WHERE agent_id = ? AND outcome = 'failure'").get(agentId) as any;
    return { total: total?.c ?? 0, successful: success?.c ?? 0, failed: failed?.c ?? 0 };
  }
}
