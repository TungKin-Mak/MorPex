/**
 * CheckpointManager — 检查点管理器 (v9.2 Phase 1 Enhanced)
 *
 * 负责保存和加载执行快照，支持中断继续执行和失败恢复。
 * 支持双后端: 原有 JSONL（默认）+ SQLite（当传入 db）
 *
 * v9.2 Phase 1 增强:
 *   - SQLite 后端 (checkpoints 表)
 *   - saveMissionCheckpoint: 富检查点 (stage/context/artifacts/team)
 *   - loadMissionCheckpoint: 按 mission 恢复最新检查点
 *   - listCheckpoints: 按 mission 列出所有检查点
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as fsSync from 'node:fs';

// better-sqlite3 Database type (any to avoid complex CJS/ESM type interop)
type Database = any;
export interface NodeState {
  nodeId: string;
  name: string;
  status: 'pending' | 'ready' | 'running' | 'success' | 'failed' | 'skipped';
  attempts: number;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionSnapshot {
  executionId: string;
  dagId: string;
  dagState: {
    nodeStates: NodeState[];
    edges: Array<{ from: string; to: string }>;
  };
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface MissionCheckpoint {
  missionId: string;
  stage: string;
  contextSnapshotId: string;
  artifactVersions: Record<string, number>;
  agentTeamState: Record<string, unknown>;
  timestamp: number;
}

export interface CheckpointManagerConfig {
  /** 存储目录 (默认 ./data/checkpoints) */
  baseDir?: string;
  /** SQLite 数据库实例 (可选，优先使用) */
  db?: Database;
}

export class CheckpointManager {
  private baseDir: string;
  private db: Database | null;

  constructor(config?: CheckpointManagerConfig) {
    this.baseDir = config?.baseDir ?? './data/checkpoints';
    this.db = config?.db ?? null;
    fsSync.mkdirSync(this.baseDir, { recursive: true });
    if (this.db) {
      this.ensureTable();
    }
  }

  private ensureTable(): void {
    try {
      this.db!.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        dag_snapshot TEXT NOT NULL,
        node_states TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )`);
    } catch { /* already exists */ }
  }

  /**
   * 保存快照
   */
  async save(snapshotId: string, state: ExecutionSnapshot): Promise<void> {
    if (this.db) {
      this.db.prepare(`INSERT OR REPLACE INTO checkpoints (id, execution_id, dag_snapshot, node_states, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(
        snapshotId,
        state.executionId,
        JSON.stringify(state.dagState),
        JSON.stringify(state.metadata),
        Math.floor(Date.now() / 1000)
      );
    } else {
      const filePath = this.getPath(snapshotId);
      await fs.appendFile(filePath, JSON.stringify(state) + '\n', 'utf-8');
    }
  }

  /**
   * 加载最新快照
   */
  async load(snapshotId: string): Promise<ExecutionSnapshot | null> {
    if (this.db) {
      const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(snapshotId) as any;
      if (!row) return null;
      return this.hydrateSnapshot(row);
    } else {
      const filePath = this.getPath(snapshotId);
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        const lines = data.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return null;
        return JSON.parse(lines[lines.length - 1]) as ExecutionSnapshot;
      } catch {
        return null;
      }
    }
  }

  /**
   * saveMissionCheckpoint — 保存富检查点 (v9.2 Phase 1)
   */
  async saveMissionCheckpoint(checkpoint: MissionCheckpoint): Promise<void> {
    const doc: ExecutionSnapshot = {
      executionId: checkpoint.missionId,
      dagId: '',
      dagState: { nodeStates: [], edges: [] },
      timestamp: checkpoint.timestamp,
      metadata: {
        stage: checkpoint.stage,
        contextSnapshotId: checkpoint.contextSnapshotId,
        artifactVersions: checkpoint.artifactVersions,
        agentTeamState: checkpoint.agentTeamState,
      },
    };
    await this.save(`mission_${checkpoint.missionId}_${checkpoint.stage}`, doc);
  }

  /**
   * loadMissionCheckpoint — 按 mission 恢复最新检查点
   */
  async loadMissionCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    if (this.db) {
      const rows = this.db.prepare(
        "SELECT * FROM checkpoints WHERE execution_id = ? ORDER BY created_at DESC LIMIT 1"
      ).all(missionId) as any[];
      if (rows.length === 0) return null;
      const snap = this.hydrateSnapshot(rows[0]);
      return this.toMissionCheckpoint(snap);
    } else {
      const files = await this.list();
      const missionFiles = files.filter(f => f.startsWith(`mission_${missionId}_`));
      if (missionFiles.length === 0) return null;
      const latestId = missionFiles.sort().reverse()[0];
      const snap = await this.load(latestId);
      return snap ? this.toMissionCheckpoint(snap) : null;
    }
  }

  /**
   * listCheckpoints — 列出指定 mission 的所有检查点
   */
  async listCheckpoints(missionId: string): Promise<{ checkpointId: string; stage: string; timestamp: number }[]> {
    if (this.db) {
      const rows = this.db.prepare(
        'SELECT id, created_at FROM checkpoints WHERE execution_id = ? ORDER BY created_at DESC'
      ).all(missionId) as any[];
      return rows.map((r: any) => ({
        checkpointId: r.id,
        stage: r.id.split('_').pop() || '',
        timestamp: r.created_at * 1000,
      }));
    } else {
      const files = await this.list();
      const missionFiles = files.filter(f => f.startsWith(`mission_${missionId}_`));
      return missionFiles.map(f => ({
        checkpointId: f,
        stage: f.split('_').pop() || '',
        timestamp: Date.now(),
      }));
    }
  }

  /**
   * 列出所有检查点
   */
  async list(): Promise<string[]> {
    if (this.db) {
      const rows = this.db.prepare('SELECT id FROM checkpoints').all() as any[];
      return rows.map((r: any) => r.id);
    } else {
      try {
        const files = await fs.readdir(this.baseDir);
        return files
          .filter(f => f.endsWith('.jsonl'))
          .map(f => f.replace('.jsonl', ''));
      } catch {
        return [];
      }
    }
  }

  /**
   * 清理过期检查点
   */
  async cleanup(maxAge: number): Promise<number> {
    const threshold = Math.floor((Date.now() - maxAge) / 1000);
    if (this.db) {
      const result = this.db.prepare('DELETE FROM checkpoints WHERE created_at <= ?').run(threshold);
      return result.changes;
    } else {
      const now = Date.now();
      let removed = 0;
      try {
        const files = await fs.readdir(this.baseDir);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(this.baseDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > maxAge) {
              await fs.unlink(filePath);
              removed++;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return removed;
    }
  }

  /**
   * 删除指定检查点
   */
  async delete(snapshotId: string): Promise<boolean> {
    if (this.db) {
      return this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(snapshotId).changes > 0;
    } else {
      try {
        await fs.unlink(this.getPath(snapshotId));
        return true;
      } catch {
        return false;
      }
    }
  }

  private getPath(snapshotId: string): string {
    return path.join(this.baseDir, `${snapshotId}.jsonl`);
  }

  private hydrateSnapshot(row: any): ExecutionSnapshot {
    return {
      executionId: row.execution_id,
      dagId: '',
      dagState: JSON.parse(row.dag_snapshot || '{"nodeStates":[],"edges":[]}'),
      timestamp: (row.created_at || Math.floor(Date.now() / 1000)) * 1000,
      metadata: JSON.parse(row.node_states || '{}'),
    };
  }

  private toMissionCheckpoint(snap: ExecutionSnapshot): MissionCheckpoint {
    const meta = snap.metadata as Record<string, any>;
    return {
      missionId: snap.executionId,
      stage: (meta?.stage as string) || '',
      contextSnapshotId: (meta?.contextSnapshotId as string) || '',
      artifactVersions: (meta?.artifactVersions as Record<string, number>) || {},
      agentTeamState: (meta?.agentTeamState as Record<string, unknown>) || {},
      timestamp: snap.timestamp,
    };
  }
}
