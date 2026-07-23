/**
 * TraceStore — Trace 事件持久化存储
 *
 * 开发阶段：SQLite（better-sqlite3）
 * 生产阶段可迁移：ClickHouse
 *
 * 维护 trace_events 表和 module_registry 表。
 * 同时保留内存缓冲区（最近 10000 条）以加速查询。
 */

import Database from 'better-sqlite3';
import { type TraceEvent, type ModuleRegistration } from './types';
import { ObservationCollector } from './observation.js';
import path from 'path';
import fs from 'fs';

export class TraceStore {
  private db: Database.Database;
  private buffer: TraceEvent[] = [];
  private maxBufferSize = 10000;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'trace.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initTables();
    this.loadRecentIntoBuffer();
    console.log(`[TraceStore] ✅ SQLite store: ${resolvedPath}`);
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        execution_id TEXT DEFAULT '',
        module_name TEXT NOT NULL,
        module_layer TEXT DEFAULT '',
        module_version TEXT DEFAULT '',
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        input TEXT,
        output TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_task ON trace_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_events_exec ON trace_events(execution_id);
      CREATE INDEX IF NOT EXISTS idx_events_module ON trace_events(module_name);
      CREATE INDEX IF NOT EXISTS idx_events_type ON trace_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON trace_events(timestamp);

      CREATE TABLE IF NOT EXISTS module_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'unknown',
        version TEXT NOT NULL DEFAULT '1.0.0'
      );
    `);
  }

  private loadRecentIntoBuffer(): void {
    try {
      const rows = this.db
        .prepare('SELECT * FROM trace_events ORDER BY timestamp DESC LIMIT ?')
        .all(this.maxBufferSize) as Array<Record<string, unknown>>;

      this.buffer = rows.reverse().map(r => this.rowToEvent(r));
    } catch {
      this.buffer = [];
    }
  }

  private rowToEvent(row: Record<string, unknown>): TraceEvent {
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      executionId: (row.execution_id as string) || '',
      timestamp: row.timestamp as number,
      module: {
        name: row.module_name as string,
        layer: (row.module_layer as string) || '',
        version: (row.module_version as string) || '',
      },
      eventType: row.event_type as TraceEvent['eventType'],
      input: row.input ? this.safeParse(row.input as string) : undefined,
      output: row.output ? this.safeParse(row.output as string) : undefined,
      metadata: (row.metadata ? this.safeParse(row.metadata as string) : undefined) as TraceEvent['metadata'],
    };
  }

  private safeParse(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return json;
    }
  }

  append(event: TraceEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO trace_events
          (id, task_id, execution_id, module_name, module_layer, module_version, event_type, timestamp, input, output, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        event.id,
        event.taskId,
        event.executionId || '',
        event.module.name,
        event.module.layer || '',
        event.module.version || '',
        event.eventType,
        event.timestamp,
        event.input !== undefined ? JSON.stringify(event.input) : null,
        event.output !== undefined ? JSON.stringify(event.output) : null,
        event.metadata !== undefined ? JSON.stringify(event.metadata) : null,
      );
    } catch (e) {
      console.warn('[TraceStore] Insert error:', e);
    }
  }

  getEventsByTask(taskId: string): TraceEvent[] {
    return this.buffer.filter(e => e.taskId === taskId);
  }

  getAllEvents(limit = 5000): TraceEvent[] {
    return this.buffer.slice(-limit);
  }

  getRecentEvents(limit = 100): TraceEvent[] {
    return this.buffer.slice(-limit);
  }

  getEventsByModule(moduleName: string): TraceEvent[] {
    return this.buffer.filter(e => e.module.name === moduleName);
  }

  getEventsByType(eventType: TraceEvent['eventType']): TraceEvent[] {
    return this.buffer.filter(e => e.eventType === eventType);
  }

  registerModule(module: ModuleRegistration): void {
    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO module_registry (id, name, layer, version) VALUES (?, ?, ?, ?)',
      );
      stmt.run(module.id, module.name, module.layer, module.version);
    } catch (e) {
      console.warn('[TraceStore] Register module error:', e);
    }
  }

  getRegisteredModules(): ModuleRegistration[] {
    try {
      return this.db
        .prepare('SELECT * FROM module_registry')
        .all() as ModuleRegistration[];
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Module Heartbeat
  // ═══════════════════════════════════════════════════════════════

  private heartbeats = new Map<string, import('./types.js').ModuleHeartbeat>();

  heartbeat(mod: { name: string; version: string; layer: string; status?: string }): void {
    const now = Date.now();
    const existing = this.heartbeats.get(mod.name);
    if (!existing) {
      this.heartbeats.set(mod.name, {
        name: mod.name,
        version: mod.version || '1.0.0',
        layer: mod.layer || 'unknown',
        status: (mod.status as 'online' | 'degraded' | 'offline') || 'online',
        registeredAt: now,
        lastHeartbeat: now,
      });
    } else {
      existing.lastHeartbeat = now;
      existing.status = (mod.status as 'online' | 'degraded' | 'offline') || existing.status;
    }
  }

  /**
   * syncFromObservation — Projection: keep TraceStore heartbeats in sync with OC.
   * Called automatically via ObservationCollector.onStateChange().
   */
  syncFromObservation(name: string, state: import('./observation.js').ModuleState): void {
    this.heartbeat({
      name,
      version: '9.2.0',
      layer: state.layer,
      status: state.displayStatus,
    });
  }

  getHeartbeats(): import('./types.js').ModuleHeartbeat[] {
    return Array.from(this.heartbeats.values());
  }

  getHealthReport(): import('./types.js').ModuleHealthReport {
    const hbs = Array.from(this.heartbeats.values());
    const hbNames = new Set(hbs.map(h => h.name));

    // Merge registered modules that have no heartbeat yet
    const registered = this.getRegisteredModules();
    for (const mod of registered) {
      if (!hbNames.has(mod.name)) {
        hbs.push({
          name: mod.name,
          version: mod.version || '1.0.0',
          layer: mod.layer || 'unknown',
          status: 'unknown' as const,
          registeredAt: 0,
          lastHeartbeat: 0,
        });
      }
    }

    const onlineModules = hbs.filter(h => h.status === 'online').map(h => h.name);

    // Which modules have been exercised:
    // 1. ObservationCollector (Phase 4 unified: single source of truth)
    // 2. Modules with MODULE_START/MODULE_END events in the trace buffer (legacy)
    const exercisedModules = new Set<string>(ObservationCollector.getExercisedModules());
    for (const ev of this.buffer) {
      if (ev.eventType === 'MODULE_START' || ev.eventType === 'MODULE_END') {
        exercisedModules.add(ev.module.name);
      }
    }

    // Online but never exercised
    const onlineButUnused = hbs
      .filter(h => h.status === 'online' && !exercisedModules.has(h.name))
      .map(h => ({ name: h.name, layer: h.layer }));

    return {
      heartbeats: hbs,
      onlineCount: onlineModules.length,
      totalCount: hbs.length,
      onlineButUnused,
      exercisedModules: Array.from(exercisedModules),
    };
  }

  clear(): void {
    this.buffer = [];
    ObservationCollector.clear();
    this.db.exec('DELETE FROM trace_events');
  }

  clearAll(): void {
    this.buffer = [];
    this.heartbeats.clear();
    ObservationCollector.reset();
    this.db.exec('DELETE FROM trace_events');
    this.db.exec('DELETE FROM module_registry');
  }

  resetToDefaults(defaults: import('./types.js').ModuleRegistration[]): void {
    this.clear();
    for (const mod of defaults) {
      this.registerModule(mod);
    }
  }

  clearRegistry(): void {
    this.db.exec('DELETE FROM module_registry');
    this.heartbeats.clear();
  }

  close(): void {
    this.db.close();
  }
}
