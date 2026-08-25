/**
 * SystemMetadataGraph — 系统元数据图
 * Phase 2: 记录所有实体关系 + EventStore 事件写入 + 事件重建
 */
import type { IEventStore } from '../../infrastructure/protocol/events/store/IEventStore.js';
import { EventType } from '../../infrastructure/protocol/events/EventType.js';
import type { BaseEvent } from '../../infrastructure/protocol/events/BaseEvent.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataRoot } from '../../infrastructure/common/dataRoot.js';

export type EntityType = 'agent' | 'tool' | 'artifact' | 'mission' | 'memory' | 'workflow' | 'capability' | 'goal';
export type RelationType = 'created_by' | 'used_by' | 'depends_on' | 'improved_from' | 'verified_by' | 'derived_from' | 'generated_by' | 'approved_by' | 'deployed_from' | 'related_to';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface Relation {
  fromId: string;
  toId: string;
  type: RelationType;
  weight: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * 时间戳类易变字段（去重比较时忽略）——同 key 重复注册事件差异仅在这些字段时视为无业务变化，跳过 append。
 */
const VOLATILE_FIELDS = ['createdAt', 'recordedAt', 'updatedAt', 'recorded_at', 'updated_at'];

/**
 * 递归剔除易变时间戳字段后序列化（用于重复注册判定）。
 * metadata 内嵌的 recordedAt/updatedAt 同样忽略。
 */
function stableKey(payload: unknown): string {
  if (Array.isArray(payload)) {
    return '[' + payload.map(stableKey).join(',') + ']';
  }
  if (payload && typeof payload === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (VOLATILE_FIELDS.includes(k)) continue;
      copy[k] = stableKey(v);
    }
    return JSON.stringify(copy);
  }
  return JSON.stringify(payload);
}

export class SystemMetadataGraph {
  private entities: Map<string, Entity> = new Map();
  private relations: Relation[] = [];
  private eventStore?: IEventStore;
  /** id → 最近一次已 append 事件的稳定 payload（去重判定依据） */
  private registeredPayloads: Map<string, string> = new Map();
  /** ═══ P1-5（会话 16l·2）：按 type 的实体索引（避免 getEntities(type) O(n) 全扫） */
  private entitiesByType: Map<EntityType, Entity[]> = new Map();

  /**
   * setEventStore — 注入 EventStore（启用事件写入 + 可重建）
   */
  setEventStore(store: IEventStore): void {
    this.eventStore = store;
  }

  /**
   * restoreFromEvents — 从 EventStore 事件重建完整图状态
   * 遍历 SYSTEM_ENTITY_REGISTERED 和 SYSTEM_RELATION_ADDED 事件
   *
   * ═══ P0 修复（会话 16l）：此前未传 limit → SqliteEventStore.query 默认 limit=100
   *     实际只恢复 100 个实体（42k 的 0.2%）。改为显式传大 limit 分页拉全量。
   */
  async restoreFromEvents(eventStore: IEventStore): Promise<void> {
    this.entities.clear();
    this.entitiesByType.clear();
    this.relations = [];
    this.registeredPayloads.clear();

    // 分页拉全量（避免默认 limit=100 截断）
    const PAGE_SIZE = 5000;
    const entityEvents: BaseEvent[] = [];
    let offset = 0;
    for (;;) {
      const page = await eventStore.query({ type: EventType.SYSTEM_ENTITY_REGISTERED, limit: PAGE_SIZE, offset });
      entityEvents.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    for (const evt of entityEvents) {
      const p = evt.payload as { entityId?: string; entityType?: string; name?: string; metadata?: Record<string, unknown>; createdAt?: number } | undefined;
      if (p?.entityId) {
        this.entities.set(p.entityId, {
          id: p.entityId,
          type: p.entityType as EntityType,
          name: p.name || '',
          metadata: p.metadata || {},
          createdAt: p.createdAt || evt.timestamp,
        });
      }
    }

    const relEvents: BaseEvent[] = [];
    offset = 0;
    for (;;) {
      const page = await eventStore.query({ type: EventType.SYSTEM_RELATION_ADDED, limit: PAGE_SIZE, offset });
      relEvents.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    for (const evt of relEvents) {
      const p = evt.payload as { fromId?: string; toId?: string; relationType?: string; weight?: number; createdAt?: number; metadata?: Record<string, unknown> } | undefined;
      if (p?.fromId && p?.toId) {
        this.relations.push({
          fromId: p.fromId,
          toId: p.toId,
          type: p.relationType as RelationType,
          weight: p.weight ?? 1.0,
          createdAt: p.createdAt || evt.timestamp,
          metadata: p.metadata,
        });
      }
    }

    console.log(`[SystemMetadataGraph] ✅ 从 EventStore 重建: ${this.entities.size} 实体, ${this.relations.length} 关系`);
    this.loaded = true;

    // ═══ 会话 16l：restore 后重建去重基准（否则 restore 完首个 upsert 会误判为首次注册重新 append）
    for (const e of this.entities.values()) {
      this.registeredPayloads.set(e.id, stableKey({ entityId: e.id, entityType: e.type, name: e.name, metadata: e.metadata }));
      // ═══ P1-5：同步重建 type 索引
      const bucket = this.entitiesByType.get(e.type);
      if (bucket) bucket.push(e);
      else this.entitiesByType.set(e.type, [e]);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 会话 17i.19：图快照（启动快速恢复，事件重放兜底）
  // ═══════════════════════════════════════════════════════════
  private snapshotPath = path.resolve(getDataRoot(), 'graph.snapshot.json');
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  // ═══ 会话 17i.21：懒加载——启动不载入全图，首次读才从快照合并（启动 O(1)）═══
  private loaded = false;

  /** 懒加载：首次读时从快照合并实体/关系/去重基准（只补缺，不覆盖）。 */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.snapshotPath)) return;
      const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
      const data = JSON.parse(raw) as {
        version?: number;
        entities?: Entity[];
        relations?: Relation[];
        registeredPayloads?: Array<[string, string]>;
      };
      if (!data || !Array.isArray(data.entities)) return;
      let added = 0;
      for (const e of data.entities) {
        if (e && typeof e.id === 'string' && !this.entities.has(e.id)) {
          this.entities.set(e.id, { ...e, metadata: e.metadata ?? {} });
          const bucket = this.entitiesByType.get(e.type);
          if (bucket) bucket.push(e);
          else this.entitiesByType.set(e.type, [e]);
          added++;
        }
      }
      if (this.relations.length === 0 && Array.isArray(data.relations)) this.relations = data.relations;
      if (this.registeredPayloads.size === 0 && Array.isArray(data.registeredPayloads)) {
        this.registeredPayloads = new Map(data.registeredPayloads);
      }
      if (added > 0 || this.relations.length > 0) {
        console.log(`[SystemMetadataGraph] ⚡ 懒加载快照: 补入 ${added} 实体, ${this.relations.length} 关系`);
      }
    } catch (e) {
      console.warn(`[SystemMetadataGraph] ⚠️ 懒加载快照失败: ${(e as Error).message}`);
    }
  }

  /** 保存图快照（实体 + 关系 + 去重基准；data/ 已 gitignore）。 */
  saveSnapshot(): void {
    try {
      fs.mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
      fs.writeFileSync(
        this.snapshotPath,
        JSON.stringify({
          version: 1,
          savedAt: Date.now(),
          entities: [...this.entities.values()],
          relations: this.relations,
          registeredPayloads: [...this.registeredPayloads.entries()],
        }, null, 2),
        'utf-8',
      );
    } catch (e) {
      console.warn(`[SystemMetadataGraph] ⚠️ 快照保存失败: ${(e as Error).message}`);
    }
  }

  /** 从快照恢复；成功返回 true（缺失/损坏 → false，回退事件重放）。 */
  async restoreFromSnapshot(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.snapshotPath)) return false;
      const raw = fs.readFileSync(this.snapshotPath, 'utf-8');
      const data = JSON.parse(raw) as {
        version?: number;
        entities?: Entity[];
        relations?: Relation[];
        registeredPayloads?: Array<[string, string]>;
      };
      if (!data || !Array.isArray(data.entities)) return false;
      this.entities.clear();
      this.entitiesByType.clear();
      this.relations = Array.isArray(data.relations) ? data.relations : [];
      this.registeredPayloads = new Map(Array.isArray(data.registeredPayloads) ? data.registeredPayloads : []);
      for (const e of data.entities) {
        if (e && typeof e.id === 'string') {
          this.entities.set(e.id, { ...e, metadata: e.metadata ?? {} });
          const bucket = this.entitiesByType.get(e.type);
          if (bucket) bucket.push(e);
          else this.entitiesByType.set(e.type, [e]);
        }
      }
      console.log(`[SystemMetadataGraph] ✅ 从快照恢复: ${this.entities.size} 实体, ${this.relations.length} 关系`);
      this.loaded = true;
      return true;
    } catch (e) {
      console.warn(`[SystemMetadataGraph] ⚠️ 快照加载失败（回退事件重放）: ${(e as Error).message}`);
      return false;
    }
  }

  /** 图变更后防抖落盘（500ms）。 */
  scheduleSnapshot(): void {
    if (this.snapshotTimer !== undefined) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      this.saveSnapshot();
    }, 500);
  }

  /**
   * registerEntity — 注册/更新实体（upsert 语义）
   *
   * ═══ P0 去重（会话 16l）：同 key 重复注册且业务字段（entityType/name/metadata 剔除时间戳）
   *     无变化时跳过 append——restore 语义本就是「最新覆盖」，中间重复事件对状态恢复零价值
   *     （实测 44,377 事件 → 唯一 3,900，重复率 91%）。业务变化仍 append（记录最新状态快照）。
   */
  registerEntity(id: string, type: EntityType, name: string, metadata?: Record<string, unknown>): void {
    this.ensureLoaded();
    // ═══ P1-5（会话 16l·2）：单对象引用同时入 Map + type 索引桶（保证 getEntities(type) 与
    //     getEntities()/entities Map 返回同一引用 → OntologyService WeakMap 缓存一致性）
    const entity: Entity = { id, type, name, metadata: metadata || {}, createdAt: Date.now() };
    // 更新 type 索引：先移除旧 type 桶中的该实体，再加到新 type 桶（覆盖 type 变化场景）
    const prev = this.entities.get(id);
    if (prev && prev.type !== type) {
      const oldBucket = this.entitiesByType.get(prev.type);
      if (oldBucket) {
        const idx = oldBucket.findIndex(e => e.id === id);
        if (idx !== -1) oldBucket.splice(idx, 1);
      }
    }
    const bucket = this.entitiesByType.get(type);
    if (bucket) {
      const idx = bucket.findIndex(e => e.id === id);
      if (idx === -1) bucket.push(entity);
      else bucket[idx] = entity;
    } else {
      this.entitiesByType.set(type, [entity]);
    }
    this.entities.set(id, entity);
    this.scheduleSnapshot(); // 17i.19：图变更 → 防抖落盘快照
    // EventStore 写入（去重）
    if (this.eventStore) {
      const key = stableKey({ entityId: id, entityType: type, name, metadata: metadata || {} });
      const last = this.registeredPayloads.get(id);
      // 首次注册 或 业务有实质变化 → append；纯时间戳差异 → 跳过
      if (last === undefined || last !== key) {
        this.registeredPayloads.set(id, key);
        this.eventStore.append({
          id: `evt_${id}_registered_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: EventType.SYSTEM_ENTITY_REGISTERED,
          timestamp: Date.now(),
          executionId: id,
          source: 'system-metadata-graph',
          payload: { entityId: id, entityType: type, name, metadata: metadata || {}, createdAt: Date.now() },
        }).catch((err: Error) => console.warn('[SystemMetadataGraph] EventStore append failed:', err.message));
      }
    }
  }

  addRelation(fromId: string, toId: string, type: RelationType, weight?: number, metadata?: Record<string, unknown>): void {
    this.ensureLoaded();
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return;
    this.relations.push({ fromId, toId, type, weight: weight || 1.0, createdAt: Date.now(), metadata });
    this.scheduleSnapshot(); // 17i.19：图变更 → 防抖落盘快照
    // EventStore 写入
    if (this.eventStore) {
      this.eventStore.append({
        id: `evt_${fromId}_to_${toId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: EventType.SYSTEM_RELATION_ADDED,
        timestamp: Date.now(),
        executionId: fromId,
        source: 'system-metadata-graph',
        payload: { fromId, toId, relationType: type, weight: weight ?? 1.0, metadata, createdAt: Date.now() },
      }).catch((err: Error) => console.warn('[SystemMetadataGraph] EventStore append failed:', err.message));
    }
  }

  getRelations(entityId: string): Relation[] {
    this.ensureLoaded();
    return this.relations.filter(r => r.fromId === entityId || r.toId === entityId);
  }

  findRelated(entityId: string, relationType: RelationType, direction: 'outgoing' | 'incoming' = 'outgoing'): Entity[] {
    this.ensureLoaded();
    const rels = direction === 'outgoing'
      ? this.relations.filter(r => r.fromId === entityId && r.type === relationType)
      : this.relations.filter(r => r.toId === entityId && r.type === relationType);
    const ids = direction === 'outgoing' ? rels.map(r => r.toId) : rels.map(r => r.fromId);
    return ids.map(id => this.entities.get(id)).filter(Boolean) as Entity[];
  }

  getEntities(type?: EntityType): Entity[] {
    this.ensureLoaded();
    // ═══ P1-5（会话 16l·2）：type 命中走索引 O(桶内) ；无 type 全量返回
    if (type) {
      return [...(this.entitiesByType.get(type) ?? [])];
    }
    return [...this.entities.values()];
  }

  getAllRelations(): Relation[] { this.ensureLoaded(); return [...this.relations]; }

  getStats(): { entities: number; relations: number; byType: Record<string, string> } {
    this.ensureLoaded();
    const byType: Record<string, number> = {};
    for (const e of this.entities.values()) byType[e.type] = (byType[e.type] || 0) + 1;
    return { entities: this.entities.size, relations: this.relations.length, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, String(v)])) };
  }

  findPath(fromId: string, toId: string): Relation[] | null {
    this.ensureLoaded();
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return null;
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: Relation[] }> = [{ id: fromId, path: [] }];
    visited.add(fromId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const outgoing = this.relations.filter(r => r.fromId === current.id);
      for (const rel of outgoing) {
        if (rel.toId === toId) return [...current.path, rel];
        if (!visited.has(rel.toId)) {
          visited.add(rel.toId);
          queue.push({ id: rel.toId, path: [...current.path, rel] });
        }
      }
    }
    return null;
  }
}

export const systemMetadataGraph = new SystemMetadataGraph();
