/**
 * EventRegistry — 事件 Schema 注册表
 *
 * MorPex v10: 管理事件 schema 的注册、版本控制和查询。
 * 提供 schema 的 CRUD 操作，用于验证事件格式的向后兼容性。
 */

import type { EventSchema } from './types.js';
import type Database from 'better-sqlite3';

// ── Schema ──

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS event_schemas (
    type TEXT NOT NULL,
    version INTEGER NOT NULL,
    schema_json TEXT NOT NULL DEFAULT '{}',
    backward_compatible INTEGER NOT NULL DEFAULT 1,
    changelog TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (type, version)
  );
  CREATE INDEX IF NOT EXISTS idx_es_type ON event_schemas(type);
`;

// ── EventRegistry ──

export class EventRegistry {
  private db: Database.Database | null;
  private schemas: Map<string, EventSchema> = new Map();
  private initialized = false;

  constructor(db?: Database.Database) {
    this.db = db ?? null;
    if (this.db) this.initDb();
  }

  private initDb(): void {
    if (this.initialized) return;
    this.db!.exec(SCHEMA_SQL);
    this.initialized = true;
  }

  /**
   * register — 注册一个新的事件 schema
   */
  register(type: string, schema: Record<string, unknown>, options?: {
    version?: number;
    backwardCompatible?: boolean;
    changelog?: string;
  }): EventSchema {
    const now = Date.now();
    const version = options?.version ?? this.getNextVersion(type);

    const eventSchema: EventSchema = {
      type,
      version,
      schema,
      backwardCompatible: options?.backwardCompatible ?? true,
      createdAt: now,
      updatedAt: now,
      changelog: options?.changelog,
    };

    const key = `${type}@${version}`;
    this.schemas.set(key, eventSchema);

    // 持久化
    if (this.db) {
      this.db.prepare(`
        INSERT OR REPLACE INTO event_schemas (type, version, schema_json, backward_compatible, changelog, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(type, version, JSON.stringify(schema), eventSchema.backwardCompatible ? 1 : 0, options?.changelog ?? null, now, now);
    }

    console.log(`[EventRegistry] Registered schema: ${type} v${version}`);
    return eventSchema;
  }

  /**
   * getSchema — 获取指定类型和版本的 schema
   */
  getSchema(type: string, version?: number): EventSchema | undefined {
    const ver = version ?? this.getLatestVersion(type);
    if (!ver) return undefined;

    return this.schemas.get(`${type}@${ver}`);
  }

  /**
   * getLatestVersion — 获取最新版本号
   */
  getLatestVersion(type: string): number | undefined {
    let latest: number | undefined;
    for (const [key, schema] of this.schemas) {
      if (key.startsWith(`${type}@`)) {
        if (latest === undefined || schema.version > latest) {
          latest = schema.version;
        }
      }
    }

    // 如果内存中没有，尝试从数据库加载
    if (latest === undefined && this.db) {
      const row = this.db.prepare(`
        SELECT MAX(version) as v FROM event_schemas WHERE type = ?
      `).get(type) as any;
      if (row?.v) {
        latest = row.v;
        // 加载到内存
        this.loadFromDb(type);
      }
    }

    return latest;
  }

  /**
   * getNextVersion — 获取下一个版本号
   */
  getNextVersion(type: string): number {
    const latest = this.getLatestVersion(type);
    return (latest ?? 0) + 1;
  }

  /**
   * listTypes — 列出所有已注册的事件类型
   */
  listTypes(): string[] {
    const types = new Set<string>();
    for (const key of this.schemas.keys()) {
      types.add(key.split('@')[0]);
    }
    return [...types].sort();
  }

  /**
   * listSchemas — 列出所有 schema（可选按类型筛选）
   */
  listSchemas(type?: string): EventSchema[] {
    const result: EventSchema[] = [];
    for (const schema of this.schemas.values()) {
      if (!type || schema.type === type) {
        result.push(schema);
      }
    }
    return result.sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);
  }

  /**
   * health — 健康检查
   */
  health(): { ok: boolean; name: string; uptime: number; schemaCount: number } {
    return {
      ok: true,
      name: 'EventRegistry',
      uptime: Date.now(),
      schemaCount: this.schemas.size,
    };
  }

  // ── 私有方法 ──

  private loadFromDb(type: string): void {
    if (!this.db) return;
    const rows = this.db.prepare(`
      SELECT * FROM event_schemas WHERE type = ? ORDER BY version
    `).all(type) as any[];

    for (const row of rows) {
      const key = `${row.type}@${row.version}`;
      if (!this.schemas.has(key)) {
        this.schemas.set(key, {
          type: row.type,
          version: row.version,
          schema: JSON.parse(row.schema_json || '{}'),
          backwardCompatible: !!row.backward_compatible,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          changelog: row.changelog,
        });
      }
    }
  }
}
