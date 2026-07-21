/**
 * GovernanceSqliteRepository — 组织治理 SQLite 持久化
 *
 * v9.2 Stage 2: 组织策略、团队治理、预算分配的持久化。
 */
import type Database from 'better-sqlite3';

export interface OrgPolicyRow {
  id: string; name: string; description?: string; priority: number;
  action: string; ruleCondition?: string; overrideBy?: string; enabled: number; createdAt: number;
}

export interface TeamGovernanceRow {
  teamId: string; teamName: string; memberRoles?: string;
  maxConcurrentCollabs: number; budgetAllocation: number;
  allowExternal: number; requireApproval: number; escalationPath?: string; createdAt: number;
}

export class GovernanceSqliteRepository {
  constructor(private db: Database.Database) {}

  // ── Org Policies ──
  savePolicy(p: OrgPolicyRow): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO org_policies (id, name, description, priority, action, rule_condition, override_by, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.name, p.description ?? null, p.priority, p.action, p.ruleCondition ?? null, p.overrideBy ?? null, p.enabled ? 1 : 0, p.createdAt);
  }
  getPolicy(id: string): OrgPolicyRow | undefined {
    return this.db.prepare('SELECT * FROM org_policies WHERE id = ?').get(id) as any;
  }
  listPolicies(enabledOnly?: boolean): OrgPolicyRow[] {
    let sql = 'SELECT * FROM org_policies';
    if (enabledOnly) sql += ' WHERE enabled = 1';
    sql += ' ORDER BY priority DESC';
    return this.db.prepare(sql).all() as any[];
  }
  deletePolicy(id: string): boolean {
    return this.db.prepare('DELETE FROM org_policies WHERE id = ?').run(id).changes > 0;
  }

  // ── Team Governance ──
  saveTeam(t: TeamGovernanceRow): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO team_governance (team_id, team_name, member_roles, max_concurrent_collabs,
        budget_allocation, allow_external, require_approval, escalation_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.teamId, t.teamName, t.memberRoles ?? null, t.maxConcurrentCollabs,
      t.budgetAllocation, t.allowExternal ? 1 : 0, t.requireApproval ? 1 : 0,
      t.escalationPath ?? null, t.createdAt);
  }
  getTeam(teamId: string): TeamGovernanceRow | undefined {
    const row = this.db.prepare(`
      SELECT team_id as teamId, team_name as teamName, member_roles as memberRoles,
        max_concurrent_collabs as maxConcurrentCollabs, budget_allocation as budgetAllocation,
        allow_external as allowExternal, require_approval as requireApproval,
        escalation_path as escalationPath, created_at as createdAt
      FROM team_governance WHERE team_id = ?
    `).get(teamId) as any;
    return row;
  }
  listTeams(): TeamGovernanceRow[] {
    const rows = this.db.prepare(`
      SELECT team_id as teamId, team_name as teamName, member_roles as memberRoles,
        max_concurrent_collabs as maxConcurrentCollabs, budget_allocation as budgetAllocation,
        allow_external as allowExternal, require_approval as requireApproval,
        escalation_path as escalationPath, created_at as createdAt
      FROM team_governance
    `).all() as any[];
    return rows;
  }
  addMember(agentId: string, teamId: string, role: string, permissions?: string[]): void {
    this.db.prepare('INSERT OR REPLACE INTO team_memberships (agent_id, team_id, team_role, permissions, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(agentId, teamId, role, permissions ? JSON.stringify(permissions) : null, Date.now());
  }
  removeMember(agentId: string, teamId: string): boolean {
    return this.db.prepare('DELETE FROM team_memberships WHERE agent_id = ? AND team_id = ?').run(agentId, teamId).changes > 0;
  }
  getMembers(teamId: string): any[] {
    return this.db.prepare('SELECT * FROM team_memberships WHERE team_id = ?').all(teamId);
  }

  // ── Budget ──
  getOrgBudget(): any {
    return this.db.prepare("SELECT * FROM org_budget WHERE id = 'singleton'").get() ?? { total_budget: 1000000, allocated: 0, reserved: 0 };
  }
  allocate(teamId: string, amount: number): boolean {
    const org = this.getOrgBudget();
    const available = org.total_budget - org.allocated - org.reserved;
    if (amount > available) return false;
    this.db.prepare('UPDATE org_budget SET allocated = allocated + ?, updated_at = ? WHERE id = ?').run(amount, Date.now(), 'singleton');
    this.db.prepare('INSERT OR REPLACE INTO budget_allocations (team_id, allocated, spent, last_updated) VALUES (?, ?, ?, ?)')
      .run(teamId, amount, 0, Date.now());
    return true;
  }
  deallocate(teamId: string, amount: number): boolean {
    const team = this.db.prepare('SELECT * FROM budget_allocations WHERE team_id = ?').get(teamId) as any;
    if (!team) return false;
    if (amount > team.allocated - team.spent) return false;
    this.db.prepare('UPDATE org_budget SET allocated = allocated - ?, updated_at = ? WHERE id = ?').run(amount, Date.now(), 'singleton');
    this.db.prepare('UPDATE budget_allocations SET allocated = allocated - ?, last_updated = ? WHERE team_id = ?').run(amount, Date.now(), teamId);
    return true;
  }
  spend(teamId: string, amount: number): boolean {
    const team = this.db.prepare('SELECT * FROM budget_allocations WHERE team_id = ?').get(teamId) as any;
    if (!team) return false;
    if (amount > team.allocated - team.spent) return false;
    this.db.prepare('UPDATE budget_allocations SET spent = spent + ?, last_updated = ? WHERE team_id = ?').run(amount, Date.now(), teamId);
    return true;
  }
  getTeamBudget(teamId: string): any {
    return this.db.prepare('SELECT * FROM budget_allocations WHERE team_id = ?').get(teamId);
  }
}
