/**
 * CompactionService — SQLite 数据库压缩维护服务
 *
 * v9.2 Phase 2: 自动清理旧事件、快照、版本，VACUUM 回收磁盘空间。
 *
 * 使用方式:
 *   import Database from 'better-sqlite3';
 *   const db = new Database('./data/morpex-events.db');
 *   const svc = new CompactionService(db);
 *   await svc.compact();
 *   svc.startAuto(); // 定时自动维护
 */

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';

// ── 配置 ──

export interface CompactionConfig {
  /** 事件数量超过此阈值触发紧凑 */
  eventCountThreshold: number
  /** 数据库文件超过此字节数触发 VACUUM */
  dbSizeThresholdBytes: number
  /** 事件保留时长 (ms)，超过的将被删除 */
  maxEventAgeMs: number
  /** 每个 Mission 保留的上下文快照最大数 */
  maxSnapshotsPerMission: number
  /** 每个产物保留的版本最大数 */
  maxArtifactVersions: number
  /** 自动维护间隔 (ms)，0 表示手动 */
  autoRunIntervalMs: number
}

const DEFAULT_CONFIG: CompactionConfig = {
  eventCountThreshold: 100_000,
  dbSizeThresholdBytes: 100 * 1024 * 1024, // 100MB
  maxEventAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  maxSnapshotsPerMission: 20,
  maxArtifactVersions: 10,
  autoRunIntervalMs: 0,
}

// ── 压缩结果 ──

export interface CompactionResult {
  vacuumed: boolean
  eventsPruned: number
  snapshotsPruned: number
  versionsPruned: number
  sizeBeforeBytes: number
  sizeAfterBytes: number
  durationMs: number
}

// ═══════════════════════════════════════════════════════════════
// CompactionService
// ═══════════════════════════════════════════════════════════════

export class CompactionService {
  private db: Database.Database
  private config: CompactionConfig
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(db: Database.Database, config?: Partial<CompactionConfig>) {
    this.db = db
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * compact — 执行完整压缩：清理 → VACUUM
   *
   * 1. 删除超过 maxEventAgeMs 的事件
   * 2. 保留每个 Mission 最新的 maxSnapshotsPerMission 个快照
   * 3. 保留每个产物最新的 maxArtifactVersions 个版本
   * 4. 如果清理量 > 1000 或数据库大小超阈值，执行 VACUUM
   */
  async compact(): Promise<CompactionResult> {
    const start = Date.now()
    const sizeBefore = this.getDbFileSize()

    const eventsPruned = this.pruneOldEvents()
    const snapshotsPruned = this.pruneSnapshots()
    const versionsPruned = this.pruneArtifactVersions()

    let vacuumed = false
    if (eventsPruned + snapshotsPruned + versionsPruned > 1000 || this.shouldCompactBySize()) {
      this.vacuum()
      vacuumed = true
    }

    return {
      vacuumed,
      eventsPruned,
      snapshotsPruned,
      versionsPruned,
      sizeBeforeBytes: sizeBefore,
      sizeAfterBytes: this.getDbFileSize(),
      durationMs: Date.now() - start,
    }
  }

  /**
   * startAuto — 启动自动维护定时器
   */
  startAuto(): void {
    if (this.config.autoRunIntervalMs <= 0 || this.timer) return
    this.timer = setInterval(() => {
      this.compact().catch(err => console.error('[CompactionService] Auto compact error:', err))
    }, this.config.autoRunIntervalMs)
  }

  /**
   * stopAuto — 停止自动维护定时器
   */
  stopAuto(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * getDbStats — 获取数据库当前统计
   */
  getDbStats(): { eventCount: number; dbSizeBytes: number; walSizeBytes: number } {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }
    return {
      eventCount: row.c,
      dbSizeBytes: this.getDbFileSize(),
      walSizeBytes: this.getWalFileSize(),
    }
  }

  /**
   * getConfig — 获取当前配置（只读副本）
   */
  getConfig(): Readonly<CompactionConfig> {
    return { ...this.config }
  }

  // ── 内部方法 ──

  private pruneOldEvents(): number {
    const cutoff = Date.now() - this.config.maxEventAgeMs
    const result = this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff)
    this.db.prepare('DELETE FROM events_decision WHERE timestamp < ?').run(cutoff)
    return result.changes
  }

  private pruneSnapshots(): number {
    let total = 0
    const missions = this.db.prepare('SELECT DISTINCT mission_id FROM context_snapshots').all() as { mission_id: string }[]
    for (const { mission_id } of missions) {
      const count = this.db.prepare('SELECT COUNT(*) as c FROM context_snapshots WHERE mission_id = ?').get(mission_id) as { c: number }
      if (count.c > this.config.maxSnapshotsPerMission) {
        const excess = count.c - this.config.maxSnapshotsPerMission
        const toDelete = this.db.prepare(
          'SELECT context_id, version FROM context_snapshots WHERE mission_id = ? ORDER BY assembled_at ASC LIMIT ?'
        ).all(mission_id, excess) as { context_id: string; version: number }[]
        for (const row of toDelete) {
          this.db.prepare('DELETE FROM context_snapshots WHERE context_id = ? AND version = ?').run(row.context_id, row.version)
          total++
        }
      }
    }
    return total
  }

  private pruneArtifactVersions(): number {
    let total = 0
    const artifacts = this.db.prepare('SELECT DISTINCT id FROM artifacts_v2').all() as { id: string }[]
    for (const { id } of artifacts) {
      const count = this.db.prepare('SELECT COUNT(*) as c FROM artifact_versions_v2 WHERE artifact_id = ?').get(id) as { c: number }
      if (count.c > this.config.maxArtifactVersions) {
        const excess = count.c - this.config.maxArtifactVersions
        const toDelete = this.db.prepare(
          'SELECT id FROM artifact_versions_v2 WHERE artifact_id = ? ORDER BY created_at ASC LIMIT ?'
        ).all(id, excess) as { id: string }[]
        for (const row of toDelete) {
          this.db.prepare('DELETE FROM artifact_versions_v2 WHERE id = ?').run(row.id)
          total++
        }
      }
    }
    return total
  }

  private vacuum(): void {
    this.db.exec('PRAGMA page_count')
    this.db.exec('VACUUM')
  }

  private getDbFileSize(): number {
    const name = (this.db as any).name
    if (!name || name === ':memory:') return 0
    try { return fs.statSync(name).size } catch { return 0 }
  }

  private getWalFileSize(): number {
    const name = (this.db as any).name
    if (!name || name === ':memory:') return 0
    try { return fs.statSync(name + '-wal').size } catch { return 0 }
  }

  private shouldCompactBySize(): boolean {
    return this.getDbFileSize() > this.config.dbSizeThresholdBytes
  }
}
