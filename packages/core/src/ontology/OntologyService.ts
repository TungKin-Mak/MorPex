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
} from './types.js';
import type { SystemMetadataGraph } from '../metadata/SystemMetadataGraph.js';

/**
 * OntologyService — 迭代1 轻量本体服务
 *
 * 包装现有的 SystemMetadataGraph，提供 4 个供 LLM 调用的查询方法。
 */
export class OntologyService {
  constructor(
    private readonly graph: SystemMetadataGraph,
  ) {}

  /**
   * queryObjects — 查询 Ontology 中的对象与关系
   *
   * @param filter - 查询过滤条件
   * @returns 匹配的事实列表（含对象 + 关系）
   */
  async queryObjects(filter: QueryFilter): Promise<RetrievedFact[]> {
    const entities = this.graph.getEntities(
      filter.type as any,
    );

    const facts: RetrievedFact[] = [];

    for (const entity of entities) {
      // 应用属性过滤（简单匹配）
      if (filter.properties) {
        let matches = true;
        for (const [key, value] of Object.entries(filter.properties)) {
          if (entity.metadata[key] !== value) {
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
   */
  async getObject(id: ObjectId): Promise<OntologyObject | null> {
    // SystemMetadataGraph 没有直接的 getById，遍历查找
    const allEntities = this.graph.getEntities();
    const entity = allEntities.find(e => e.id === id);
    return entity ? this.toOntologyObject(entity) : null;
  }

  /**
   * getRelated — 获取与某对象通过指定关系相连的对象
   */
  async getRelated(id: ObjectId, relationType: string): Promise<RetrievedFact[]> {
    const rels = this.graph.getRelations(id);
    const filtered = rels.filter(r => r.type === relationType);

    const facts: RetrievedFact[] = [];

    for (const rel of filtered) {
      const targetId = rel.toId;
      const allEntities = this.graph.getEntities();
      const targetEntity = allEntities.find(e => e.id === targetId);
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
  }): Promise<OntologyObject> {
    const id = input.id ?? `${input.type.toLowerCase()}_${Date.now()}`;
    const name = String(input.properties.title ?? input.properties.name ?? id);
    const metadata = {
      ...input.properties,
      status: input.status,
      updatedAt: Date.now(),
    };

    // 检查是否已存在
    const existing = await this.getObject(id);
    if (existing) {
      // 更新已有对象
      this.graph.registerEntity(id, input.type as any, name, metadata);
    } else {
      this.graph.registerEntity(id, input.type as any, name, metadata);
    }

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
      type as any,
      properties?.weight as number | undefined,
      properties,
    );
  }

  /**
   * listByType — 按类型列出所有 Ontology 对象
   */
  async listByType(type: string): Promise<OntologyObject[]> {
    const entities = this.graph.getEntities(type as any);
    return entities.map((e) => this.toOntologyObject(e));
  }

  // ---------- 适配层 ----------

  private toOntologyObject(entity: { id: string; type: string; name: string; metadata: Record<string, unknown>; createdAt: number }): OntologyObject {
    return {
      id: entity.id,
      type: entity.type,
      properties: { name: entity.name, ...entity.metadata },
      version: 1,
      createdAt: entity.createdAt,
      updatedAt: entity.createdAt,
      metadata: entity.metadata,
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
