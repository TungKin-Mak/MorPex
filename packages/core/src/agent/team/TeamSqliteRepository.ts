/**
 * TeamSqliteRepository — 团队组建 SQLite 持久化
 *
 * v9.2 Stage 2: Agent 团队生命周期管理持久化。
 */
import type Database from 'better-sqlite3';

export class TeamSqliteRepository {
  constructor(private db: Database.Database) {}

  createTeam(teamId: string, missionId: string, leaderId?: string): void {
    this.db.prepare(`
      INSERT INTO agent_teams (team_id, mission_id, status, leader_id, composition_json, context_json, formed_at)
      VALUES (?, ?, 'forming', ?, '{}', '{}', ?)
    `).run(teamId, missionId, leaderId ?? null, Date.now());
  }

  getTeam(teamId: string): any | undefined {
    const row = this.db.prepare('SELECT * FROM agent_teams WHERE team_id = ?').get(teamId) as any;
    if (!row) return undefined;
    return {
      ...row,
      composition: JSON.parse(row.composition_json || '{}'),
      context: JSON.parse(row.context_json || '{}'),
    };
  }

  updateStatus(teamId: string, status: string): void {
    this.db.prepare('UPDATE agent_teams SET status = ? WHERE team_id = ?').run(status, teamId);
  }

  setLeader(teamId: string, leaderId: string): void {
    this.db.prepare('UPDATE agent_teams SET leader_id = ? WHERE team_id = ?').run(leaderId, teamId);
  }

  updateComposition(teamId: string, composition: Record<string, unknown>): void {
    this.db.prepare('UPDATE agent_teams SET composition_json = ? WHERE team_id = ?').run(JSON.stringify(composition), teamId);
  }

  updateContext(teamId: string, context: Record<string, unknown>): void {
    this.db.prepare('UPDATE agent_teams SET context_json = ? WHERE team_id = ?').run(JSON.stringify(context), teamId);
  }

  getTeamsByMission(missionId: string): any[] {
    const rows = this.db.prepare('SELECT * FROM agent_teams WHERE mission_id = ? ORDER BY formed_at DESC').all(missionId) as any[];
    return rows.map(r => ({
      ...r,
      composition: JSON.parse(r.composition_json || '{}'),
      context: JSON.parse(r.context_json || '{}'),
    }));
  }

  dissolveTeam(teamId: string): void {
    this.db.prepare("UPDATE agent_teams SET status = 'dissolved', dissolved_at = ? WHERE team_id = ?").run(Date.now(), teamId);
  }

  listActiveTeams(): any[] {
    const rows = this.db.prepare("SELECT * FROM agent_teams WHERE status NOT IN ('dissolved','failed') ORDER BY formed_at DESC").all() as any[];
    return rows.map(r => ({
      ...r,
      composition: JSON.parse(r.composition_json || '{}'),
      context: JSON.parse(r.context_json || '{}'),
    }));
  }
}
