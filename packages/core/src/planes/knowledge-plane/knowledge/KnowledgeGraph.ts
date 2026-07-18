/**
 * KnowledgeGraph — 知识图谱引擎
 *
 * 整合 Agent / Task / Artifact / Decision / Memory 的统一视图。
 * 从各数据源自动构建实体和关系，提供跨源查询。
 *
 * 数据源整合：
 *   - Artifact Registry → artifact 实体 + produces/supersedes 关系
 *   - Memory Engine    → memory 实体 + remembers 关系
 *   - Execution Graph  → execution/task 实体 + triggers/depends_on 关系
 *   - Planner Plugin   → goal 实体 + decides 关系
 *
 * 查询能力：
 *   - 实体搜索（按类型/标签/文本）
 *   - 路径发现（两实体间的最短路径）
 *   - 子图提取（指定实体的邻域）
 *
 * 持久化（Phase 5: JSONL 写入已移除，仅保留读取）：
 *   - JSONL 文件可被 loadFromDisk() 读取，用于从备份重建内存索引
 *   - addEntity/addRelation 仅更新内存 Map，不再写 JSONL
 *   - saveSnapshot() 全量快照保存到 JSON
 */

import type {
  KnowledgeEntity,
  KnowledgeRelation,
  EntityType,
  RelationType,
  KnowledgeQuery,
  KnowledgePath,
  KnowledgeStats,
} from './types.js';
import { ExecutionIdentity } from '../../../common/ExecutionIdentity.js';
import * as fs from 'fs';
import * as path from 'path';
// JSONLWriter removed in Phase 5 — memory Map is the primary store
import { AsyncResourceLocker } from '../../../utils/AsyncResourceLocker.js';
import { MemoryWiki } from '../../../../../memory/src/index.js';

const identity = new ExecutionIdentity();

/** 默认配置 */
const DEFAULT_CONFIG = { maxEntities: 1000, dataDir: './data/knowledge' };

/**
 * KnowledgeGraph — 知识图谱引擎（内存图谱，JSONL 读取回退）
 */
export class KnowledgeGraph {
  private entities: Map<string, KnowledgeEntity> = new Map();
  private relations: KnowledgeRelation[] = [];
  private config: typeof DEFAULT_CONFIG;
  private dataDir: string;
  private entitiesFile: string;
  private relationsFile: string;
  private _loaded = false;

  // JSONL writers removed in Phase 5

  /** 邻接表（用于路径搜索） */
  private adjList: Map<string, Map<string, KnowledgeRelation[]>> = new Map();

  /** 事件回调 */
  onEntityAdded: ((entity: KnowledgeEntity) => void) | null = null;
  onRelationAdded: ((relation: KnowledgeRelation) => void) | null = null;

  /** ★ MemoryWiki 持久化后端 */
  private wiki: MemoryWiki | null = null;

  /** L1: per-resource async mutex for concurrent write isolation */
  private _locker: AsyncResourceLocker;

  constructor(config?: Partial<typeof DEFAULT_CONFIG> & { dataDir?: string }, locker?: AsyncResourceLocker) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = path.resolve(config?.dataDir ?? DEFAULT_CONFIG.dataDir);
    this.entitiesFile = path.join(this.dataDir, 'entities.jsonl');
    this.relationsFile = path.join(this.dataDir, 'relations.jsonl');
    this._locker = locker ?? new AsyncResourceLocker();

    // JSONL writers removed in Phase 5
  }

  /** 是否已从磁盘加载 */
  get isLoaded(): boolean { return this._loaded; }

  /** ★ MemoryWiki 注入 */
  setWiki(wiki: MemoryWiki): void {
    this.wiki = wiki;
  }

  // ═══════════════════════════════════════════════════════════════
  // JSONL file I/O（仅用于 loadFromDisk 从备份重建内存索引）
  // ═══════════════════════════════════════════════════════════════

  // JSONL append + shutdown methods removed in Phase 5 — memory Map is the primary store

  /**
   * 从 JSONL 文件加载实体和关系，重建内存索引。
   * 必须在构造后显式调用（不在构造函数中自动加载，以支持测试和按需初始化）。
   *
   * @returns 加载统计 { entities, relations }
   */
  async loadFromDisk(): Promise<{ entities: number; relations: number }> {
    let entityCount = 0;
    let relationCount = 0;

    // ── 加载实体 ──
    if (fs.existsSync(this.entitiesFile)) {
      try {
        const content = fs.readFileSync(this.entitiesFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entity: KnowledgeEntity = JSON.parse(line);
            this.entities.set(entity.id, entity);
            this.adjList.set(entity.id, new Map());
            entityCount++;
          } catch {
            console.warn('[KG] ⚠️ 跳过损坏的实体行');
          }
        }
      } catch (err: any) {
        console.warn(`[KG] ⚠️ 读取实体文件失败: ${err.message}`);
      }
    }

    // ── 加载关系 ──
    if (fs.existsSync(this.relationsFile)) {
      try {
        const content = fs.readFileSync(this.relationsFile, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const relation: KnowledgeRelation = JSON.parse(line);

            // 验证源和目标实体存在（容忍孤儿关系：实体可能后来被删除）
            if (this.entities.has(relation.source) && this.entities.has(relation.target)) {
              this.relations.push(relation);

              // 重建邻接表
              if (!this.adjList.has(relation.source)) {
                this.adjList.set(relation.source, new Map());
              }
              const srcNeighbors = this.adjList.get(relation.source)!;
              if (!srcNeighbors.has(relation.target)) {
                srcNeighbors.set(relation.target, []);
              }
              srcNeighbors.get(relation.target)!.push(relation);

              relationCount++;
            }
          } catch {
            console.warn('[KG] ⚠️ 跳过损坏的关系行');
          }
        }
      } catch (err: any) {
        console.warn(`[KG] ⚠️ 读取关系文件失败: ${err.message}`);
      }
    }

    this._loaded = true;
    console.log(`[KG] ✅ 从磁盘加载: ${entityCount} 实体, ${relationCount} 关系`);
    return { entities: entityCount, relations: relationCount };
  }

  /**
   * 全量快照保存（用于备份/迁移）
   * 保存到 data/knowledge/snapshots/snapshot-<timestamp>.json
   */
  async saveSnapshot(): Promise<void> {
    const snapshotDir = path.join(this.dataDir, 'snapshots');
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const snapFile = path.join(snapshotDir, `snapshot-${ts}.json`);
    const data = {
      exportedAt: Date.now(),
      entities: [...this.entities.values()],
      relations: [...this.relations],
    };
    fs.writeFileSync(snapFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[KG] 📸 快照已保存: ${snapFile}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 纠错（支持 Cognee 风格的记忆修正）
  // ═══════════════════════════════════════════════════════════════

  /**
   * 修正实体
   * 更新内存 + 追加修正版本到 JSONL（旧行保留作为审计轨迹）
   */
  correctEntity(id: string, updates: Partial<KnowledgeEntity>): KnowledgeEntity | undefined {
    const entity = this.entities.get(id);
    if (!entity) return undefined;
    Object.assign(entity, updates, { id }); // 防止 id 被覆盖
    // JSONL persist removed in Phase 5
    return entity;
  }

  /**
   * 修正关系
   */
  correctRelation(id: string, updates: Partial<KnowledgeRelation>): KnowledgeRelation | undefined {
    const idx = this.relations.findIndex(r => r.id === id);
    if (idx === -1) return undefined;
    Object.assign(this.relations[idx], updates, { id });
    // JSONL persist removed in Phase 5
    return this.relations[idx];
  }

  // ═══════════════════════════════════════════════════════════════
  // 实体管理
  // ═══════════════════════════════════════════════════════════════

  /** 添加实体（更新内存 Map）
   *
   * @param overrides - 实体数据
   * @param domainId - 可选，所属领域（Phase 12：跨领域知识图谱）
   */
  async addEntity(overrides: {
    type: EntityType;
    name: string;
    description?: string;
    refId?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }, domainId?: string): Promise<KnowledgeEntity> {
    return this._locker.withLock(`entity:${overrides.name}`, async () => {
      // 检查上限
      if (this.entities.size >= this.config.maxEntities) {
        const oldest = [...this.entities.values()]
          .sort((a, b) => a.timestamp - b.timestamp)[0];
        if (oldest) {
          this.removeEntity(oldest.id);
        }
      }

      const entity: KnowledgeEntity = {
        id: `keg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        domainId,
        type: overrides.type,
        name: overrides.name,
        description: overrides.description,
        refId: overrides.refId,
        timestamp: Date.now(),
        tags: overrides.tags ?? [],
        metadata: overrides.metadata,
      };

      this.entities.set(entity.id, entity);
      this.adjList.set(entity.id, new Map());

      // ★ MemoryWiki 持久化
      if (this.wiki?.ready) {
        this.wiki.remember({
          id: entity.id,
          type: 'KgEntity',
          name: entity.name,
          data: {
            domain: entity.domainId,
            tags: JSON.stringify(entity.tags ?? []),
            importance: 0.5,
          },
        }).catch(() => {});
      }

      this.onEntityAdded?.(entity);
      return entity;
    });
  }

  /** 批量添加实体 */
  async addEntities(
    items: Array<{
      type: EntityType;
      name: string;
      description?: string;
      refId?: string;
      tags?: string[];
    }>,
  ): Promise<KnowledgeEntity[]> {
    const results: KnowledgeEntity[] = [];
    for (const item of items) {
      results.push(await this.addEntity(item));
    }
    return results;
  }

  /** 删除实体（同时删除关联关系） */
  async removeEntity(id: string): Promise<boolean> {
    return this._locker.withLock(`entity:${id}`, async () => {
      // L2 级联检查：有入边关系的实体不可删
      const hasIncoming = this.relations.some(r => r.target === id);
      if (hasIncoming) {
        throw new Error(
          `[KnowledgeGraph] 无法删除实体 ${id}：存在 ${this.relations.filter(r => r.target === id).length} 条入边关系。` +
          `请先删除关联关系再删除实体。`
        );
      }

      const existed = this.entities.delete(id);
      if (existed) {
        // 删除相关出边关系
        const outgoing = this.relations.filter(r => r.source === id);
        this.relations = this.relations.filter(r => r.source !== id && r.target !== id);
        this.adjList.delete(id);
        // 从其他节点的邻接表中删除
        for (const [, neighbors] of this.adjList) {
          neighbors.delete(id);
        }
      }
      return existed;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Phase 12: 跨领域知识图谱
  // ═══════════════════════════════════════════════════════════════

  /**
   * searchCrossDomain — 跨领域搜索实体
   *
   * 在指定的多个领域中搜索匹配文本的实体。
   *
   * @param query - 搜索文本
   * @param domains - 要搜索的领域 ID 列表
   * @returns 匹配的实体列表
   */
  searchCrossDomain(query: string, domains: string[]): KnowledgeEntity[] {
    const lower = query.toLowerCase();
    const domainSet = new Set(domains);
    const results: KnowledgeEntity[] = [];

    for (const entity of this.entities.values()) {
      // 只搜索指定领域（如果 entity 没有 domainId，不匹配跨领域搜索）
      if (!entity.domainId || !domainSet.has(entity.domainId)) continue;

      if (
        entity.name.toLowerCase().includes(lower) ||
        (entity.description ?? '').toLowerCase().includes(lower)
      ) {
        results.push(entity);
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * findCrossDomainLinks — 查找跨领域关联
   *
   * 找到与指定实体关联且所属领域不同的实体之间的关系。
   *
   * @param entityId - 实体 ID
   * @returns 跨领域关系列表
   */
  findCrossDomainLinks(entityId: string): KnowledgeRelation[] {
    const entity = this.entities.get(entityId);
    if (!entity || !entity.domainId) return [];

    const crossDomainRels: KnowledgeRelation[] = [];

    for (const rel of this.relations) {
      if (rel.source === entityId) {
        const target = this.entities.get(rel.target);
        if (target && target.domainId && target.domainId !== entity.domainId) {
          crossDomainRels.push(rel);
        }
      } else if (rel.target === entityId) {
        const source = this.entities.get(rel.source);
        if (source && source.domainId && source.domainId !== entity.domainId) {
          crossDomainRels.push(rel);
        }
      }
    }

    return crossDomainRels;
  }

  /**
   * getDomainSubgraph — 提取领域子图
   *
   * 获取指定领域内的所有实体和关系。
   *
   * @param domainId - 领域 ID
   * @returns 领域子图（实体列表 + 关系列表）
   */
  getDomainSubgraph(domainId: string): {
    entities: KnowledgeEntity[];
    relations: KnowledgeRelation[];
  } {
    const domainEntities = [...this.entities.values()]
      .filter(e => e.domainId === domainId);

    const domainEntityIds = new Set(domainEntities.map(e => e.id));
    const domainRelations = this.relations.filter(
      r => domainEntityIds.has(r.source) && domainEntityIds.has(r.target),
    );

    return { entities: domainEntities, relations: domainRelations };
  }

  /**
   * autoLinkCrossDomain — 自动构建跨领域关联
   *
   * 当两个不同领域的实体共享相似名称时，自动创建 `related_to` 关系。
   * 名称相似度基于公共子串长度（简单算法）。
   *
   * @param threshold - 最低相似度阈值（默认 0.5）
   * @returns 新创建的关系列表
   */
  async autoLinkCrossDomain(threshold: number = 0.5): Promise<KnowledgeRelation[]> {
    const created: KnowledgeRelation[] = [];

    // 按领域分组
    const byDomain = new Map<string, KnowledgeEntity[]>();
    for (const entity of this.entities.values()) {
      if (!entity.domainId) continue;
      if (!byDomain.has(entity.domainId)) {
        byDomain.set(entity.domainId, []);
      }
      byDomain.get(entity.domainId)!.push(entity);
    }

    const domainIds = [...byDomain.keys()];

    // 跨领域两两比较
    for (let i = 0; i < domainIds.length; i++) {
      for (let j = i + 1; j < domainIds.length; j++) {
        const domainA = domainIds[i];
        const domainB = domainIds[j];
        const entitiesA = byDomain.get(domainA)!;
        const entitiesB = byDomain.get(domainB)!;

        for (const entityA of entitiesA) {
          for (const entityB of entitiesB) {
            const similarity = this.computeNameSimilarity(entityA.name, entityB.name);
            if (similarity >= threshold) {
              // 检查是否已存在关系
              const exists = this.relations.some(
                r =>
                  (r.source === entityA.id && r.target === entityB.id) ||
                  (r.source === entityB.id && r.target === entityA.id),
              );
              if (!exists) {
                const rel = await this.addRelation({
                  source: entityA.id,
                  target: entityB.id,
                  type: 'related_to',
                  weight: similarity,
                  metadata: {
                    autoLinked: true,
                    domainA,
                    domainB,
                    similarity,
                  },
                });
                if (rel) {
                  created.push(rel);
                }
              }
            }
          }
        }
      }
    }

    if (created.length > 0) {
      console.log(`[KG] 🔗 自动创建 ${created.length} 个跨领域关联`);
    }

    return created;
  }

  /**
   * computeNameSimilarity — 计算两个名称的相似度
   *
   * 简单实现：基于最长公共子串长度 / 较长名称长度。
   *
   * @param nameA - 名称 A
   * @param nameB - 名称 B
   * @returns 相似度 (0-1)
   */
  private computeNameSimilarity(nameA: string, nameB: string): number {
    const a = nameA.toLowerCase();
    const b = nameB.toLowerCase();

    if (a === b) return 1.0;
    if (a.includes(b) || b.includes(a)) return 0.8;

    // 最长公共子串
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    let maxLen = 0;

    for (let i = 0; i < shorter.length; i++) {
      for (let j = i + 1; j <= shorter.length; j++) {
        const substr = shorter.substring(i, j);
        if (longer.includes(substr) && substr.length > maxLen) {
          maxLen = substr.length;
        }
      }
    }

    return longer.length > 0 ? maxLen / longer.length : 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // 关系管理
  // ═══════════════════════════════════════════════════════════════

  /** 添加关系（更新内存 Map） */
  async addRelation(overrides: {
    source: string;
    target: string;
    type: RelationType;
    weight?: number;
    metadata?: Record<string, any>;
  }): Promise<KnowledgeRelation | null> {
    return this._locker.withLock(`relation:${overrides.source}→${overrides.target}:${overrides.type}`, async () => {
      if (!this.entities.has(overrides.source) || !this.entities.has(overrides.target)) {
        return null; // 实体不存在
      }

      const relation: KnowledgeRelation = {
        id: `krel_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        source: overrides.source,
        target: overrides.target,
        type: overrides.type,
        weight: overrides.weight ?? 1.0,
        createdAt: Date.now(),
        metadata: overrides.metadata,
      };

      this.relations.push(relation);

      // 更新邻接表
      if (!this.adjList.has(overrides.source)) {
        this.adjList.set(overrides.source, new Map());
      }
      const srcNeighbors = this.adjList.get(overrides.source)!;
      if (!srcNeighbors.has(overrides.target)) {
        srcNeighbors.set(overrides.target, []);
      }
      srcNeighbors.get(overrides.target)!.push(relation);

      // ★ MemoryWiki 持久化
      if (this.wiki?.ready) {
        this.wiki.remember({
          id: relation.id,
          type: 'KgRelation',
          name: `${overrides.source}→${overrides.target}`,
          data: {
            from_id: overrides.source,
            to_id: overrides.target,
            type: overrides.type,
            weight: overrides.weight ?? 1.0,
            metadata: overrides.metadata,
          },
        }).catch(() => {});
      }

      this.onRelationAdded?.(relation);
      return relation;
    });
  }

  /** 批量添加关系 */
  async addRelations(
    items: Array<{
      source: string;
      target: string;
      type: RelationType;
      weight?: number;
    }>,
  ): Promise<KnowledgeRelation[]> {
    const results: KnowledgeRelation[] = [];
    for (const item of items) {
      const r = await this.addRelation(item);
      if (r) results.push(r);
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  // 查询
  // ═══════════════════════════════════════════════════════════════

  /** 搜索实体 */
  searchEntities(query: KnowledgeQuery): KnowledgeEntity[] {
    let results = [...this.entities.values()];

    if (query.entityType) {
      results = results.filter(e => e.type === query.entityType);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(e =>
        query.tags!.some(t => e.tags.includes(t))
      );
    }

    if (query.text) {
      const lower = query.text.toLowerCase();
      results = results.filter(e =>
        e.name.toLowerCase().includes(lower) ||
        (e.description ?? '').toLowerCase().includes(lower)
      );
    }

    if (query.since) results = results.filter(e => e.timestamp >= query.since!);
    if (query.until) results = results.filter(e => e.timestamp <= query.until!);

    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, query.limit ?? 50);
  }

  /** 查询关系 */
  searchRelations(query: KnowledgeQuery): KnowledgeRelation[] {
    let results = [...this.relations];

    if (query.relationType) {
      results = results.filter(r => r.type === query.relationType);
    }

    if (query.since) results = results.filter(r => r.createdAt >= query.since!);
    if (query.until) results = results.filter(r => r.createdAt <= query.until!);

    results.sort((a, b) => b.createdAt - a.createdAt);
    return results.slice(0, query.limit ?? 50);
  }

  /** 获取实体的邻域（关联实体 + 关系） */
  getNeighborhood(entityId: string, depth: number = 1): {
    entities: KnowledgeEntity[];
    relations: KnowledgeRelation[];
  } {
    if (!this.entities.has(entityId)) {
      return { entities: [], relations: [] };
    }

    const visited = new Set<string>();
    const resultEntities: KnowledgeEntity[] = [];
    const resultRelations: KnowledgeRelation[] = [];

    const dfs = (currentId: string, currentDepth: number): void => {
      if (currentDepth > depth || visited.has(currentId)) return;
      visited.add(currentId);

      const entity = this.entities.get(currentId);
      if (entity) resultEntities.push(entity);

      // 出边
      const outNeighbors = this.adjList.get(currentId);
      if (outNeighbors) {
        for (const [targetId, rels] of outNeighbors) {
          resultRelations.push(...rels);
          dfs(targetId, currentDepth + 1);
        }
      }

      // 入边（反向查找）
      for (const rel of this.relations) {
        if (rel.target === currentId && !visited.has(rel.source)) {
          resultRelations.push(rel);
          dfs(rel.source, currentDepth + 1);
        }
      }
    };

    dfs(entityId, 0);
    return { entities: resultEntities, relations: resultRelations };
  }

  /** 查找两实体间的路径（BFS） */
  findPath(fromId: string, toId: string): KnowledgePath | null {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return null;

    const queue: Array<{ id: string; path: KnowledgeRelation[] }> = [
      { id: fromId, path: [] },
    ];
    const visited = new Set<string>();
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      const outNeighbors = this.adjList.get(current.id);
      if (outNeighbors) {
        for (const [targetId, rels] of outNeighbors) {
          if (targetId === toId) {
            const pathRels = [...current.path, rels[0]];
            const pathEntities: KnowledgeEntity[] = [];
            const allIds = new Set<string>();
            allIds.add(fromId);
            for (const r of pathRels) {
              allIds.add(r.source);
              allIds.add(r.target);
            }
            for (const id of allIds) {
              const e = this.entities.get(id);
              if (e) pathEntities.push(e);
            }
            return {
              entities: pathEntities,
              relations: pathRels,
              totalWeight: pathRels.reduce((s, r) => s + r.weight, 0),
            };
          }

          if (!visited.has(targetId)) {
            visited.add(targetId);
            queue.push({ id: targetId, path: [...current.path, rels[0]] });
          }
        }
      }
    }

    return null; // 无路径
  }

  // ═══════════════════════════════════════════════════════════════
  // 从外部系统导入
  // ═══════════════════════════════════════════════════════════════

  /** 从 Artifact 导入实体 */
  async importFromArtifact(artifact: { id: string; name: string; type: string; status: string }): Promise<KnowledgeEntity> {
    return this.addEntity({
      type: 'artifact',
      name: artifact.name,
      refId: artifact.id,
      tags: [artifact.type, artifact.status],
      metadata: { artifactType: artifact.type, status: artifact.status },
    });
  }

  /** 从记忆导入实体 */
  async importFromMemory(memory: { id: string; content: string; type: string; tags: string[] }): Promise<KnowledgeEntity> {
    return this.addEntity({
      type: 'memory',
      name: memory.content.substring(0, 100),
      refId: memory.id,
      tags: memory.tags,
      metadata: { memoryType: memory.type },
    });
  }

  /** 从执行记录导入 */
  async importFromExecution(execution: { id: string; goal: string; status: string }): Promise<KnowledgeEntity> {
    return this.addEntity({
      type: 'execution',
      name: execution.goal,
      refId: execution.id,
      tags: [execution.status],
      metadata: { status: execution.status },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════════

  /** 获取统计 */
  getStats(): KnowledgeStats {
    const byEntityType: Record<string, number> = {};
    const byRelationType: Record<string, number> = {};

    for (const e of this.entities.values()) {
      byEntityType[e.type] = (byEntityType[e.type] ?? 0) + 1;
    }
    for (const r of this.relations) {
      byRelationType[r.type] = (byRelationType[r.type] ?? 0) + 1;
    }

    return {
      totalEntities: this.entities.size,
      totalRelations: this.relations.length,
      byEntityType,
      byRelationType,
    };
  }

  /** 清空（内存清空，不删除文件） */
  clear(): void {
    this.entities.clear();
    this.relations = [];
    this.adjList.clear();
    this._loaded = false;
  }
}
