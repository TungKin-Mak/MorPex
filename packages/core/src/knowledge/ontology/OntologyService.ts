/**
 * OntologyService — 轻量 Ontology 服务
 *
 * 迭代1：适配层包装现有 SystemMetadataGraph / MetadataGraph，
 * 对外提供统一的查询接口，隐藏底层图实现细节。
 *
 * 底层复用：
 *   - SystemMetadataGraph（8 实体 × 10 关系）
 *   - 后续可接 EventStore projection
 */

import type {
  ObjectId,
  OntologyObject,
  OntologyRelation,
  QueryFilter,
  RetrievedFact,
} from '../../gate/types.js';
import type { SystemMetadataGraph, EntityType, RelationType } from '../../knowledge/graph/SystemMetadataGraph.js';
import { ObjectTypeRegistry } from './ObjectTypeRegistry.js';

/**
 * OntologyService — 迭代1 轻量本体服务
 *
 * 包装现有的 SystemMetadataGraph，提供 4 个供 LLM 调用的查询方法。
 */
export class OntologyService {
  /**
   * 本地 ID → Entity 索引缓存，避免 getObject/getRelated 全表扫描
   * 每次 registerEntity 或 upsertObject 时更新
   */
  private entityCache = new Map<string, { id: string; type: string; name: string; metadata: Record<string, unknown>; createdAt: number }>();

  constructor(
    private readonly graph: SystemMetadataGraph,
    private readonly typeRegistry?: ObjectTypeRegistry,
  ) {
    // 启动时预热缓存
    this.refreshCache();
  }

  /**
   * restoreFromEvents — 从 EventStore 重建 Ontology 缓存
   * 委托给 SystemMetadataGraph.restoreFromEvents()，然后刷新本地缓存
   */
  async restoreFromEvents(eventStore: import('../../infrastructure/protocol/events/store/IEventStore.js').IEventStore): Promise<void> {
    await this.graph.restoreFromEvents(eventStore);
    this.refreshCache();
    console.log(`[OntologyService] ✅ 缓存重建完成: ${this.entityCache.size} 条目`);
  }

  /**
   * refreshCache — 从 graph 重建本地索引
   */
  /**
   * normalizeEntityType — 转小写以匹配 SystemMetadataGraph.EntityType
   * 传入单个 type 字符串, 返回 EntityType | undefined。
   * 数组类型在 queryObjects 中独立处理。
   */
  private normalizeEntityType(type: string | undefined): EntityType | undefined {
    if (!type) return undefined;
    const lower = type.toLowerCase() as EntityType;
    const valid: EntityType[] = ['agent', 'tool', 'artifact', 'mission', 'memory', 'workflow', 'capability', 'goal'];
    return valid.includes(lower) ? lower : 'mission';
  }

  /** normalizeRelationType — 转小写以匹配 SystemMetadataGraph.RelationType */
  private normalizeRelationType(type: string): RelationType {
    const lower = type.toLowerCase() as RelationType;
    const valid: RelationType[] = ['created_by', 'used_by', 'depends_on', 'improved_from', 'verified_by', 'derived_from', 'generated_by', 'approved_by', 'deployed_from', 'related_to'];
    return valid.includes(lower) ? lower : 'related_to';
  }

  private refreshCache(): void {
    this.entityCache.clear();
    for (const e of this.graph.getEntities()) {
      this.entityCache.set(e.id, e);
    }
  }

  /**
   * invalidateCache — 使缓存失效（upsert 后调用）
   */
  private invalidateCache(id?: string): void {
    if (id) {
      this.entityCache.delete(id);
    } else {
      this.entityCache.clear();
    }
  }

  /**
   * queryObjects — 查询 Ontology 中的对象与关系
   *
   * @param filter - 查询过滤条件
   * @returns 匹配的事实列表（含对象 + 关系）
   */
  async queryObjects(filter: QueryFilter): Promise<RetrievedFact[]> {
    // normalizeEntityType 只接受 string, 数组类型单独处理
    const typeFilter = filter.type;
    const entities = Array.isArray(typeFilter)
      ? this.graph.getEntities().filter(e => typeFilter.includes(e.type))
      : this.graph.getEntities(this.normalizeEntityType(typeFilter));

    const facts: RetrievedFact[] = [];

    for (const entity of entities) {
      // 应用属性过滤（宽松比较）
      // P1-5: 使用宽松比较，避免类型不匹配导致过滤失效
      if (filter.properties) {
        let matches = true;
        for (const [key, value] of Object.entries(filter.properties)) {
          const fieldValue = entity.metadata[key];
          if (!looseEqual(fieldValue, value)) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      const object = this.toOntologyObject(entity);
      let relations: OntologyRelation[] = [];

      if (filter.relations?.length) {
        const rels = this.graph.getRelations(entity.id);
        relations = (rels ?? [])
          .filter(r => filter.relations!.includes(r.type))
          .map(r => this.toRelation(r));
      }

      facts.push({ object, relations });
    }

    // 应用 limit
    if (filter.limit && filter.limit > 0) {
      return facts.slice(0, filter.limit);
    }

    return facts;
  }

  /**
   * getObject — 按 ID 获取单个对象
   *
   * 使用本地索引缓存，避免全表扫描。
   */
  async getObject(id: ObjectId): Promise<OntologyObject | null> {
    // 优先查本地缓存
    const cached = this.entityCache.get(id);
    if (cached) return this.toOntologyObject(cached);

    // 缓存未命中 → 全表扫描一次并更新缓存
    const allEntities = this.graph.getEntities();
    for (const e of allEntities) {
      this.entityCache.set(e.id, e);
    }
    const refetched = this.entityCache.get(id);
    return refetched ? this.toOntologyObject(refetched) : null;
  }

  /**
   * getRelated — 获取与某对象通过指定关系相连的对象
   *
   * 使用本地索引缓存，避免在循环中全表扫描。
   */
  async getRelated(id: ObjectId, relationType: string): Promise<RetrievedFact[]> {
    const rels = this.graph.getRelations(id);
    const filtered = rels.filter(r => r.type === relationType);

    const facts: RetrievedFact[] = [];

    // 确保本地缓存已预热
    if (this.entityCache.size === 0) {
      this.refreshCache();
    }

    for (const rel of filtered) {
      const targetId = rel.toId;
      const targetEntity = this.entityCache.get(targetId);
      if (targetEntity) {
        facts.push({
          object: this.toOntologyObject(targetEntity),
          relations: [this.toRelation(rel)],
        });
      }
    }

    return facts;
  }

  /**
   * getCurrentState — 获取 Mission 当前真实状态
   *
   * 从 graph 中读取指定 mission 的完整状态。
   */
  async getCurrentState(missionId: ObjectId): Promise<Record<string, unknown>> {
    const obj = await this.getObject(missionId);
    if (!obj) return { exists: false, missionId };

    // 获取与该 mission 相关的所有关系
    const rels = this.graph.getRelations(missionId);

    return {
      exists: true,
      id: obj.id,
      type: obj.type,
      status: obj.status,
      properties: obj.properties,
      relations: rels.map(r => ({
        type: r.type,
        targetId: r.toId === missionId ? r.fromId : r.toId,
        weight: r.weight,
      })),
      updatedAt: obj.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 迭代2: 写入方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * upsertObject — 创建或更新 Ontology 对象
   *
   * 如果 id 存在则更新，否则创建。
   * 底层委托给 SystemMetadataGraph.registerEntity。
   */
  async upsertObject(input: {
    id?: string;
    type: string;
    properties: Record<string, unknown>;
    status?: string;
    /** vNext+ P2：事实来源（bootstrap/knowledge-plugin/人工等） */
    source?: string;
    /** vNext+ P2：事实置信度 0-1 */
    confidence?: number;
  }): Promise<OntologyObject> {
    // 校验必填属性（P1.1）——status 是 upsertObject 顶层参数（投影器/调用方惯用），
    // 合并进 properties 参与校验（写入 metadata 时已合并 status，校验不应遗漏）
    if (this.typeRegistry) {
      const propsForValidation =
        input.status !== undefined
          ? { ...input.properties, status: input.status }
          : input.properties;
      const errors = this.typeRegistry.validateProperties(input.type, propsForValidation);
      if (errors.length > 0) {
        throw new Error(`[OntologyService] 类型 "${input.type}" 属性校验失败: ${errors.join('; ')}`);
      }
    }

    const id = input.id ?? `${input.type.toLowerCase()}_${Date.now()}`;
    // ═══ vNext+ P2：简单冲突策略（同 key 高置信覆盖，否则标记 conflict）═══
    const existing = await this.getObject(id);
    if (existing) {
      const existingConf = (existing.metadata?.confidence as number | undefined) ?? 0.5;
      const newConf = input.confidence ?? 0.5;
      if (newConf < existingConf) {
        // 新写入置信度更低 → 不覆盖，标记冲突（保留高置信旧值）
        this.graph.registerEntity(id, this.normalizeEntityType(input.type) ?? 'mission', String(input.properties.title ?? input.properties.name ?? id), {
          ...existing.metadata,
          conflict: true,
          conflictDetail: `low-confidence(${newConf}) write blocked by existing(${existingConf})`,
          updatedAt: Date.now(),
        });
        this.invalidateCache(id);
        return (await this.getObject(id))!;
      }
    }

    const name = String(input.properties.title ?? input.properties.name ?? id);
    const metadata = {
      ...input.properties,
      status: input.status,
      // ═══ vNext+ P2：事实元数据（source/confidence/version/timestamp）═══
      source: input.source ?? 'system',
      confidence: input.confidence ?? 0.5,
      version: (existing?.version ?? 0) + 1,
      recordedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 写入底层 graph（覆盖语义，同名 id 自动覆盖）
    const entityType = this.normalizeEntityType(input.type)! ?? 'mission';
    this.graph.registerEntity(id, entityType, name, metadata);

    // 使缓存失效，下次 getObject 重新加载
    this.invalidateCache(id);

    const obj = await this.getObject(id);
    if (!obj) throw new Error(`[OntologyService] upsert 失败: ${id}`);
    return obj;
  }

  /**
   * ensureRelation — 确保一条关系存在（幂等写入）
   */
  async ensureRelation(
    from: string,
    to: string,
    type: string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    // 检查是否已存在相同关系
    const existingRels = this.graph.getRelations(from);
    const alreadyExists = existingRels.some(
      (r) => r.toId === to && r.type === type,
    );
    if (alreadyExists) return;

    this.graph.addRelation(
      from,
      to,
      this.normalizeRelationType(type),
      properties?.weight as number | undefined,
      properties,
    );

    // 关系变更不影响实体缓存，无需 invalidate
  }

  /**
   * listByType — 按类型列出所有 Ontology 对象
   */
  async listByType(type: string): Promise<OntologyObject[]> {
    const entities = this.graph.getEntities(this.normalizeEntityType(type));
    return entities.map((e) => this.toOntologyObject(e));
  }

  // ---------- 适配层 ----------

  private toOntologyObject(entity: { id: string; type: string; name: string; metadata: Record<string, unknown>; createdAt: number }): OntologyObject {
    const metadata = entity.metadata ?? {};
    return {
      id: entity.id,
      type: entity.type,
      properties: { name: entity.name, ...metadata },
      status: (metadata.status as string | undefined) ?? undefined,
      version: 1,
      createdAt: entity.createdAt,
      updatedAt: (metadata.updatedAt as number | undefined) ?? entity.createdAt,
      metadata,
    };
  }

  private toRelation(rel: { fromId: string; toId: string; type: string; weight: number; createdAt: number; metadata?: Record<string, unknown> }): OntologyRelation {
    return {
      id: `${rel.fromId}-${rel.type}-${rel.toId}`,
      from: rel.fromId,
      to: rel.toId,
      type: rel.type,
      properties: { weight: rel.weight, ...rel.metadata },
      createdAt: rel.createdAt,
    };
  }
}

/**
 * looseEqual — 宽松比较两个值是否相等
 *
 * 处理布尔/字符串/数字之间的类型不一致：
 *   looseEqual(true, 'true') === true
 *   looseEqual('1', 1) === true
 *   looseEqual('isTestCase', true) === false (排除非布尔字段名)
 */
function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;

  // 布尔 vs 字符串
  if (typeof a === 'boolean' && typeof b === 'string') {
    return a === (b === 'true' || b === '1');
  }
  if (typeof b === 'boolean' && typeof a === 'string') {
    return b === (a === 'true' || a === '1');
  }

  // 数字 vs 字符串
  if (typeof a === 'number' && typeof b === 'string') {
    return a === Number(b);
  }
  if (typeof b === 'number' && typeof a === 'string') {
    return b === Number(a);
  }

  return String(a) === String(b);
}
