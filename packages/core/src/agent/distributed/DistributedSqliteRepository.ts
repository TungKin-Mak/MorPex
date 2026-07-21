/**
 * DistributedSqliteRepository — 分布式运行时 SQLite 持久化
 *
 * v9.2 Stage 2: Agent 实例注册、心跳、远程消息的持久化。
 */
import type Database from 'better-sqlite3';

export class DistributedSqliteRepository {
  constructor(private db: Database.Database) {}

  // ── Agent Instances ──
  registerInstance(nodeId: string, agentId: string, address: string, capabilities: string[]): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_instances (node_id, agent_id, status, last_heartbeat, address, capabilities_json, load)
      VALUES (?, ?, 'online', ?, ?, ?, 0)
    `).run(nodeId, agentId, Date.now(), address, JSON.stringify(capabilities));
  }
  heartbeat(nodeId: string, agentId: string, load?: number): void {
    const sql = load !== undefined
      ? 'UPDATE agent_instances SET status = \'online\', last_heartbeat = ?, load = ? WHERE node_id = ? AND agent_id = ?'
      : 'UPDATE agent_instances SET status = \'online\', last_heartbeat = ? WHERE node_id = ? AND agent_id = ?';
    if (load !== undefined) {
      this.db.prepare(sql).run(Date.now(), load, nodeId, agentId);
    } else {
      this.db.prepare(sql).run(Date.now(), nodeId, agentId);
    }
  }
  markOffline(nodeId: string, agentId: string): void {
    this.db.prepare("UPDATE agent_instances SET status = 'offline' WHERE node_id = ? AND agent_id = ?").run(nodeId, agentId);
  }
  getOnlineInstances(): any[] {
    return this.db.prepare("SELECT * FROM agent_instances WHERE status = 'online' ORDER BY last_heartbeat DESC").all();
  }
  listByAgent(agentId: string): any[] {
    return this.db.prepare('SELECT * FROM agent_instances WHERE agent_id = ?').all(agentId);
  }
  cleanupStale(timeoutMs: number): number {
    const cutoff = Date.now() - timeoutMs;
    return this.db.prepare("UPDATE agent_instances SET status = 'offline' WHERE last_heartbeat < ? AND status = 'online'").run(cutoff).changes;
  }

  // ── Remote Messages ──
  sendMessage(msg: any): void {
    this.db.prepare(`
      INSERT INTO remote_messages (id, from_node, to_node, correlation_id, type, payload, status, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, 'sent', ?)
    `).run(msg.id, msg.fromNode, msg.toNode, msg.correlationId ?? null, msg.type,
      JSON.stringify(msg.payload ?? {}), msg.sentAt ?? Date.now());
  }
  receiveMessages(toNode: string, markReceived?: boolean): any[] {
    const msgs = this.db.prepare("SELECT * FROM remote_messages WHERE to_node = ? AND status = 'sent' ORDER BY sent_at ASC").all(toNode);
    if (markReceived && msgs.length > 0) {
      const ids = msgs.map((m: any) => m.id);
      this.db.prepare(`UPDATE remote_messages SET status = 'received', received_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
        .run(Date.now(), ...ids);
    }
    return msgs.map((m: any) => ({ ...m, payload: JSON.parse(m.payload || '{}') }));
  }
  getMessageStatus(correlationId: string): any[] {
    return this.db.prepare('SELECT * FROM remote_messages WHERE correlation_id = ? ORDER BY sent_at').all(correlationId);
  }
}
