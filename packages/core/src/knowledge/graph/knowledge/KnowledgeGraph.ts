/**
 * KnowledgeGraph — 轻量级知识图谱（实体 + 关系）
 *
 * ★ 记忆统一：存储由 JSONL 文件改为 SQLite（better-sqlite3，实时持久化）。
 *   接口完全不变（addEntity/searchEntities/getNeighborhood/findPath/…），
 *   消费方（AgentHarness/MetaPlanner/StrategicDeconstructor 等）零感知。
 *   兼容：loadFromDisk 时若 SQLite 为空且存在旧 JSONL，自动迁移一次。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';

export interface KGEntity {
  id: string;
  type: string;
  name: string;
  tags?: string[];
  refId?: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface KGRelation {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface KGConfig {
  dataDir?: string;
  maxEntities?: number;
}

export class KnowledgeGraph {
  name = 'KnowledgeGraph';
  version = '2.0.0';
  private entities: Map<string, KGEntity> = new Map();
  private relations: KGRelation[] = [];
  private config: KGConfig;
  private db: Database.Database;
  private dbPath: string;

  constructor(config?: KGConfig) {
    this.config = {
      dataDir: config?.dataDir ?? './data/knowledge',
      maxEntities: config?.maxEntities ?? 10000,
    };
    this.dbPath = path.join(this.config.dataDir!, 'knowledge.db');
    fs.mkdirSync(this.config.dataDir!, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT,
        ref_id TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kg_relations (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kg_rel_src ON kg_relations(source);
      CREATE INDEX IF NOT EXISTS idx_kg_rel_tgt ON kg_relations(target);
    `);
    this._loadAll();
    this._migrateLegacyJsonl();
  }

  // ── SQLite 持久化 ─────────────────────────────────────────────────

  private _loadAll(): void {
    this.entities.clear();
    this.relations = [];
    const rows = this.db.prepare('SELECT * FROM kg_entities').all() as Array<Record<string, any>>;
    for (const r of rows) {
      this.entities.set(r.id, {
        id: r.id,
        type: r.type,
        name: r.name,
        tags: r.tags ? JSON.parse(r.tags) : [],
        refId: r.ref_id ?? undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
        createdAt: r.created_at,
      });
    }
    const relRows = this.db.prepare('SELECT * FROM kg_relations').all() as Array<Record<string, any>>;
    for (const r of relRows) {
      this.relations.push({
        id: r.id,
        source: r.source,
        target: r.target,
        type: r.type,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        createdAt: r.created_at,
      });
    }
  }

  /** 兼容旧 JSONL：SQLite 为空且存在 entities.jsonl 时迁移一次 */
  private _migrateLegacyJsonl(): void {
    const dir = this.config.dataDir!;
    const entitiesFile = path.join(dir, 'entities.jsonl');
    const relationsFile = path.join(dir, 'relations.jsonl');
    if (this.entities.size > 0) return;
    if (!fs.existsSync(entitiesFile)) return;

    const tx = this.db.transaction(() => {
      if (fs.existsSync(entitiesFile)) {
        const content = fs.readFileSync(entitiesFile, 'utf-8');
        for (const line of content.trim().split('\n').filter(Boolean)) {
          try {
            const e = JSON.parse(line) as KGEntity;
            this.entities.set(e.id, e);
            this.db.prepare(
              'INSERT OR REPLACE INTO kg_entities (id, name, type, tags, ref_id, metadata, created_at) VALUES (?,?,?,?,?,?,?)',
            ).run(e.id, e.name, e.type, e.tags ? JSON.stringify(e.tags) : null, e.refId ?? null,
              e.metadata ? JSON.stringify(e.metadata) : null, e.createdAt);
          } catch (err) {
            console.warn(`[KnowledgeGraph] ⚠️ 旧 JSONL 实体迁移插入失败 (line=${line.slice(0, 80)}):`, err instanceof Error ? err.message : String(err));
          }
        }
      }
      if (fs.existsSync(relationsFile)) {
        const content = fs.readFileSync(relationsFile, 'utf-8');
        for (const line of content.trim().split('\n').filter(Boolean)) {
          try {
            const r = JSON.parse(line) as KGRelation;
            this.relations.push(r);
            this.db.prepare(
              'INSERT OR REPLACE INTO kg_relations (id, source, target, type, metadata, created_at) VALUES (?,?,?,?,?,?)',
            ).run(r.id, r.source, r.target, r.type, r.metadata ? JSON.stringify(r.metadata) : null, r.createdAt);
          } catch (err) {
            console.warn(`[KnowledgeGraph] ⚠️ 旧 JSONL 关系迁移插入失败 (line=${line.slice(0, 80)}):`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    });
    tx();
    console.log(`[KnowledgeGraph] ✅ 已迁移旧 JSONL → SQLite（${this.entities.size} 实体 / ${this.relations.length} 关系）`);
  }

  private _generateId(): string {
    return `keg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /** ★ SQLite 实时持久化：写入已同步，flush 为空操作（保持旧 async 签名兼容） */
  async flush(): Promise<void> {
    return;
  }

  addEntity(entity: {
    type: string;
    name: string;
    tags?: string[];
    refId?: string;
    metadata?: Record<string, any>;
  }, domain?: string): KGEntity {
    const id = this._generateId();
    const e: KGEntity = {
      id,
      type: entity.type,
      name: entity.name,
      tags: entity.tags ?? [],
      refId: entity.refId,
      metadata: { ...entity.metadata, domain },
      createdAt: Date.now(),
    };
    this.entities.set(id, e);
    this.db.prepare(
      'INSERT OR REPLACE INTO kg_entities (id, name, type, tags, ref_id, metadata, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(e.id, e.name, e.type, e.tags ? JSON.stringify(e.tags) : null, e.refId ?? null,
      e.metadata ? JSON.stringify(e.metadata) : null, e.createdAt);
    return e;
  }

  addEntities(entities: Array<{
    type: string;
    name: string;
    tags?: string[];
    refId?: string;
    metadata?: Record<string, any>;
  }>, domain?: string): KGEntity[] {
    return entities.map(e => this.addEntity(e, domain));
  }

  addRelation(relation: {
    id?: string;
    source: string;
    target: string;
    type: string;
    metadata?: Record<string, any>;
    timestamp?: number;
  }): KGRelation | null {
    if (!this.entities.has(relation.source) || !this.entities.has(relation.target)) {
      return null;
    }
    const r: KGRelation = {
      id: relation.id ?? `rel_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      source: relation.source,
      target: relation.target,
      type: relation.type,
      metadata: relation.metadata,
      createdAt: relation.timestamp ?? Date.now(),
    };
    this.relations.push(r);
    this.db.prepare(
      'INSERT OR REPLACE INTO kg_relations (id, source, target, type, metadata, created_at) VALUES (?,?,?,?,?,?)',
    ).run(r.id, r.source, r.target, r.type, r.metadata ? JSON.stringify(r.metadata) : null, r.createdAt);
    return r;
  }

  get(id: string): KGEntity | null {
    return this.entities.get(id) ?? null;
  }

  searchEntities(query: { text?: string; tags?: string[]; entityType?: string; limit?: number } | string, limit?: number): KGEntity[] {
    let results = [...this.entities.values()];

    if (typeof query === 'string') {
      const q = query.toLowerCase();
      results = results.filter(e => e.name.toLowerCase().includes(q) || (e.tags && e.tags.some(t => t.toLowerCase().includes(q))));
    } else {
      if (query.text) {
        const q = query.text.toLowerCase();
        results = results.filter(e => e.name.toLowerCase().includes(q) || (e.tags && e.tags.some(t => t.toLowerCase().includes(q))));
      }
      if (query.tags && query.tags.length > 0) {
        results = results.filter(e => e.tags && query.tags!.some(t => e.tags!.includes(t)));
      }
      if (query.entityType) {
        results = results.filter(e => e.type === query.entityType);
      }
      if (query.limit) {
        results = results.slice(0, query.limit);
      }
    }

    if (limit) {
      results = results.slice(0, limit);
    }

    return results;
  }

  getNeighborhood(id: string, depth: number = 1): { entities: KGEntity[]; relations: KGRelation[] } {
    const visitedEntities = new Set<string>();
    const visitedRelations = new Set<string>();
    const resultEntities: KGEntity[] = [];
    const resultRelations: KGRelation[] = [];

    const traverse = (entityId: string, currentDepth: number) => {
      if (currentDepth > depth || visitedEntities.has(entityId)) return;
      visitedEntities.add(entityId);

      const entity = this.entities.get(entityId);
      if (entity) resultEntities.push(entity);

      for (const rel of this.relations) {
        if (rel.source === entityId || rel.target === entityId) {
          if (!visitedRelations.has(rel.id)) {
            visitedRelations.add(rel.id);
            resultRelations.push(rel);
          }
          const otherId = rel.source === entityId ? rel.target : rel.source;
          traverse(otherId, currentDepth + 1);
        }
      }
    };

    traverse(id, 0);
    return { entities: resultEntities, relations: resultRelations };
  }

  findPath(from: string, to: string): { entities: KGEntity[]; relations: KGRelation[] } | null {
    const queue: Array<{ id: string; path: { entities: KGEntity[]; relations: KGRelation[] } }> = [
      { id: from, path: { entities: [], relations: [] } }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      if (id === to) {
        const finalEntity = this.entities.get(to);
        if (finalEntity) path.entities.push(finalEntity);
        return path;
      }
      if (visited.has(id)) continue;
      visited.add(id);

      const entity = this.entities.get(id);
      if (entity && !path.entities.some(e => e.id === id)) {
        path.entities.push(entity);
      }

      for (const rel of this.relations) {
        let nextId: string | null = null;
        if (rel.source === id) nextId = rel.target;
        else if (rel.target === id) nextId = rel.source;

        if (nextId && !visited.has(nextId)) {
          const newPath = {
            entities: [...path.entities],
            relations: [...path.relations, rel],
          };
          queue.push({ id: nextId, path: newPath });
        }
      }
    }

    return null;
  }

  getStats(): { totalEntities: number; totalRelations: number } {
    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
    };
  }

  importFromArtifact(artifact: { id: string; name: string; type: string; status: string }): KGEntity {
    return this.addEntity({
      type: 'artifact',
      name: artifact.name,
      tags: [artifact.type, artifact.status],
      refId: artifact.id,
      metadata: { artifactType: artifact.type, status: artifact.status },
    });
  }

  importFromMemory(memory: { id: string; content: string; type: string; tags?: string[] }): KGEntity {
    return this.addEntity({
      type: 'memory',
      name: memory.content.slice(0, 100),
      tags: memory.tags ?? [memory.type],
      refId: memory.id,
      metadata: { memoryType: memory.type },
    });
  }

  importFromExecution(execution: { id: string; goal: string; status: string }): KGEntity {
    return this.addEntity({
      type: 'execution',
      name: execution.goal,
      tags: [execution.status],
      refId: execution.id,
      metadata: { status: execution.status },
    });
  }

  toJSON(): { entities: KGEntity[]; relations: KGRelation[] } {
    return {
      entities: [...this.entities.values()],
      relations: this.relations,
    };
  }

  fromJSON(data: { entities: KGEntity[]; relations: KGRelation[] }): void {
    this.entities.clear();
    this.relations = [];
    for (const e of data.entities) {
      this.entities.set(e.id, e);
    }
    this.relations = data.relations;
  }

  /** 兼容旧调用：从 SQLite 重载（数据已在构造时加载） */
  loadFromDisk(dir?: string): this {
    if (dir && dir !== this.config.dataDir) {
      this.config.dataDir = dir;
      this.dbPath = path.join(dir, 'knowledge.db');
      fs.mkdirSync(dir, { recursive: true });
      this.db.close();
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this._loadAll();
      this._migrateLegacyJsonl();
    } else {
      this._loadAll();
    }
    return this;
  }

  correctEntity(id: string, updates: Partial<{ name: string; type: string; tags: string[]; metadata: Record<string, any> }>): KGEntity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    const updated: KGEntity = { ...entity, ...updates, id: entity.id, createdAt: entity.createdAt };
    if (updates.tags) updated.tags = [...(entity.tags ?? []), ...updates.tags];
    this.entities.set(id, updated);
    this.db.prepare(
      'UPDATE kg_entities SET name = ?, type = ?, tags = ?, metadata = ? WHERE id = ?',
    ).run(updated.name, updated.type, updated.tags ? JSON.stringify(updated.tags) : null,
      updated.metadata ? JSON.stringify(updated.metadata) : null, id);
    return updated;
  }

  searchCrossDomain(query: string | { text: string; tags?: string[] }, domains: string[]): KGEntity[] {
    let results = [...this.entities.values()];
    const text = typeof query === 'string' ? query : query.text;
    const q = text.toLowerCase();
    results = results.filter(e => e.name.toLowerCase().includes(q) || (e.tags && e.tags.some(t => t.toLowerCase().includes(q))));
    if (!Array.isArray(domains) || domains.length === 0) return results.slice(0, 10);
    return results.filter(e => e.metadata?.domain && domains.includes(e.metadata.domain)).slice(0, 10);
  }

  removeEntity(id: string): boolean {
    const existed = this.entities.has(id);
    this.entities.delete(id);
    this.relations = this.relations.filter(r => r.source !== id && r.target !== id);
    this.db.prepare('DELETE FROM kg_entities WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM kg_relations WHERE source = ? OR target = ?').run(id, id);
    return existed;
  }

  clear(): void {
    this.entities.clear();
    this.relations = [];
    this.db.exec('DELETE FROM kg_entities; DELETE FROM kg_relations;');
  }

  async saveSnapshot(_path?: string): Promise<void> {
    // 已实时写 SQLite，无需快照
    return;
  }

  getStatus(): boolean {
    return true;
  }

  close(): void {
    this.db.close();
  }
}
