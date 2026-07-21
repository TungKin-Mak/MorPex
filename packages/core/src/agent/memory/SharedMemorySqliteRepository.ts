/**
 * SharedMemorySqliteRepository — 共享内存一致性 SQLite 持久化
 *
 * v9.2 Stage 2: 共享内存条目、锁、版本共识的持久化。
 */
import type Database from 'better-sqlite3';

export interface SharedMemoryRow {
  key: string;
  value: string;
  version: number;
  lockOwner: string | null;
  lockExpiresAt: number | null;
  consensusVersion: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export class SharedMemorySqliteRepository {
  constructor(private db: Database.Database) {}

  write(key: string, value: unknown, agentId: string): void {
    const existing = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (existing) {
      this.db.prepare(`
        UPDATE shared_memory_entries SET value = ?, version = version + 1, updated_at = ? WHERE key = ?
      `).run(JSON.stringify(value), Date.now(), key);
    } else {
      this.db.prepare(`
        INSERT INTO shared_memory_entries (key, value, version, lock_owner, lock_expires_at, consensus_version, created_by, created_at, updated_at)
        VALUES (?, ?, 1, NULL, NULL, 1, ?, ?, ?)
      `).run(key, JSON.stringify(value), agentId, Date.now(), Date.now());
    }
  }

  read(key: string): SharedMemoryRow | undefined {
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return undefined;
    return this.hydrate(row);
  }

  acquireLock(key: string, owner: string, ttlMs: number): boolean {
    const now = Date.now();
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return false; // Entry must exist first

    // Lock is free or expired
    if (!row.lock_owner || (row.lock_expires_at && row.lock_expires_at < now)) {
      this.db.prepare('UPDATE shared_memory_entries SET lock_owner = ?, lock_expires_at = ? WHERE key = ?')
        .run(owner, now + ttlMs, key);
      return true;
    }
    return row.lock_owner === owner; // Already owned by this agent
  }

  releaseLock(key: string, owner: string): boolean {
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return false;
    if (row.lock_owner !== owner) return false;
    this.db.prepare('UPDATE shared_memory_entries SET lock_owner = NULL, lock_expires_at = NULL WHERE key = ?').run(key);
    return true;
  }

  getWithConsensus(key: string, minVersion?: number): SharedMemoryRow | undefined {
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return undefined;
    const hydrated = this.hydrate(row);
    if (minVersion !== undefined && hydrated.consensusVersion < minVersion) return undefined;
    return hydrated;
  }

  incrementConsensusVersion(key: string): number {
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return 0;
    this.db.prepare('UPDATE shared_memory_entries SET consensus_version = consensus_version + 1, updated_at = ? WHERE key = ?')
      .run(Date.now(), key);
    return row.consensus_version + 1;
  }

  writeWithConsensus(key: string, value: unknown, agentId: string): boolean {
    // Must acquire lock first (checked externally)
    const row = this.db.prepare('SELECT * FROM shared_memory_entries WHERE key = ?').get(key) as any;
    if (!row) return false;
    if (row.lock_owner !== agentId) return false;
    this.db.prepare(`
      UPDATE shared_memory_entries SET value = ?, version = version + 1, consensus_version = consensus_version + 1, updated_at = ? WHERE key = ?
    `).run(JSON.stringify(value), Date.now(), key);
    return true;
  }

  listKeys(): string[] {
    const rows = this.db.prepare('SELECT key FROM shared_memory_entries ORDER BY key').all() as any[];
    return rows.map(r => r.key);
  }

  cleanupExpiredLocks(): number {
    const now = Date.now();
    return this.db.prepare('UPDATE shared_memory_entries SET lock_owner = NULL, lock_expires_at = NULL WHERE lock_expires_at < ?').run(now).changes;
  }

  private hydrate(row: any): SharedMemoryRow {
    return {
      key: row.key,
      value: row.value,
      version: row.version,
      lockOwner: row.lock_owner,
      lockExpiresAt: row.lock_expires_at,
      consensusVersion: row.consensus_version,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
