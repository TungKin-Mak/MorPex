/**
 * KnowledgeGraph — 轻量级知识图谱 (实体 + 关系 + JSONL 持久化)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

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
  version = '1.0.0';
  private entities: Map<string, KGEntity> = new Map();
  private relations: KGRelation[] = [];
  private config: KGConfig;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: KGConfig) {
    this.config = {
      dataDir: config?.dataDir ?? './data/knowledge',
      maxEntities: config?.maxEntities ?? 10000,
    };
  }

  private _generateId(): string {
    return `keg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private _scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 500);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const dir = this.config.dataDir!;
    fs.mkdirSync(dir, { recursive: true });
    const entitiesFile = path.join(dir, 'entities.jsonl');
    const relationsFile = path.join(dir, 'relations.jsonl');
    const lines: string[] = [];
    for (const e of this.entities.values()) {
      lines.push(JSON.stringify(e));
    }
    fs.writeFileSync(entitiesFile, lines.join('\n') + '\n', 'utf-8');
    const relLines: string[] = [];
    for (const r of this.relations) {
      relLines.push(JSON.stringify(r));
    }
    fs.writeFileSync(relationsFile, relLines.join('\n') + '\n', 'utf-8');
    this.dirty = false;
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
    this._scheduleFlush();
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
    this._scheduleFlush();
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
    // Simple BFS
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

  loadFromDisk(dir?: string): this {
    const dataDir = dir ?? this.config.dataDir!;
    const entitiesFile = path.join(dataDir, 'entities.jsonl');
    const relationsFile = path.join(dataDir, 'relations.jsonl');

    if (fs.existsSync(entitiesFile)) {
      const content = fs.readFileSync(entitiesFile, 'utf-8');
      for (const line of content.trim().split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line) as KGEntity;
          this.entities.set(e.id, e);
        } catch {}
      }
    }

    if (fs.existsSync(relationsFile)) {
      const content = fs.readFileSync(relationsFile, 'utf-8');
      for (const line of content.trim().split('\n').filter(Boolean)) {
        try {
          const r = JSON.parse(line) as KGRelation;
          this.relations.push(r);
        } catch {}
      }
    }

    return this;
  }

  correctEntity(id: string, updates: Partial<{ name: string; type: string; tags: string[]; metadata: Record<string, any> }>): KGEntity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    const updated: KGEntity = { ...entity, ...updates, id: entity.id, createdAt: entity.createdAt };
    if (updates.tags) updated.tags = [...(entity.tags ?? []), ...updates.tags];
    this.entities.set(id, updated);
    this._scheduleFlush();
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
    this._scheduleFlush();
    return existed;
  }

  clear(): void {
    this.entities.clear();
    this.relations = [];
    this.dirty = false;
  }

  async saveSnapshot(_path?: string): Promise<void> {
    await this.flush();
  }

  getStatus(): boolean {
    return true;
  }
}
