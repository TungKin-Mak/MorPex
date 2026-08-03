/**
 * SystemMetadataGraph — 系统元数据图
 * Phase 2: 记录所有实体关系 + EventStore 事件写入 + 事件重建
 */
import type { IEventStore } from '../../infrastructure/protocol/events/store/IEventStore.js';
import { EventType } from '../../infrastructure/protocol/events/EventType.js';
import type { BaseEvent } from '../../infrastructure/protocol/events/BaseEvent.js';

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

export class SystemMetadataGraph {
  private entities: Map<string, Entity> = new Map();
  private relations: Relation[] = [];
  private eventStore?: IEventStore;

  /**
   * setEventStore — 注入 EventStore（启用事件写入 + 可重建）
   */
  setEventStore(store: IEventStore): void {
    this.eventStore = store;
  }

  /**
   * restoreFromEvents — 从 EventStore 事件重建完整图状态
   * 遍历 SYSTEM_ENTITY_REGISTERED 和 SYSTEM_RELATION_ADDED 事件
   */
  async restoreFromEvents(eventStore: IEventStore): Promise<void> {
    this.entities.clear();
    this.relations = [];

    const entityEvents = await eventStore.query({ type: EventType.SYSTEM_ENTITY_REGISTERED });
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

    const relEvents = await eventStore.query({ type: EventType.SYSTEM_RELATION_ADDED });
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
  }

  registerEntity(id: string, type: EntityType, name: string, metadata?: Record<string, unknown>): void {
    this.entities.set(id, { id, type, name, metadata: metadata || {}, createdAt: Date.now() });
    // EventStore 写入
    if (this.eventStore) {
      this.eventStore.append({
        id: `evt_${id}_registered`,
        type: EventType.SYSTEM_ENTITY_REGISTERED,
        timestamp: Date.now(),
        executionId: id,
        source: 'system-metadata-graph',
        payload: { entityId: id, entityType: type, name, metadata: metadata || {}, createdAt: Date.now() },
      }).catch((err: Error) => console.warn('[SystemMetadataGraph] EventStore append failed:', err.message));
    }
  }

  addRelation(fromId: string, toId: string, type: RelationType, weight?: number, metadata?: Record<string, unknown>): void {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return;
    this.relations.push({ fromId, toId, type, weight: weight || 1.0, createdAt: Date.now(), metadata });
    // EventStore 写入
    if (this.eventStore) {
      this.eventStore.append({
        id: `evt_${fromId}_to_${toId}_${Date.now()}`,
        type: EventType.SYSTEM_RELATION_ADDED,
        timestamp: Date.now(),
        executionId: fromId,
        source: 'system-metadata-graph',
        payload: { fromId, toId, relationType: type, weight: weight ?? 1.0, metadata, createdAt: Date.now() },
      }).catch((err: Error) => console.warn('[SystemMetadataGraph] EventStore append failed:', err.message));
    }
  }

  getRelations(entityId: string): Relation[] {
    return this.relations.filter(r => r.fromId === entityId || r.toId === entityId);
  }

  findRelated(entityId: string, relationType: RelationType, direction: 'outgoing' | 'incoming' = 'outgoing'): Entity[] {
    const rels = direction === 'outgoing'
      ? this.relations.filter(r => r.fromId === entityId && r.type === relationType)
      : this.relations.filter(r => r.toId === entityId && r.type === relationType);
    const ids = direction === 'outgoing' ? rels.map(r => r.toId) : rels.map(r => r.fromId);
    return ids.map(id => this.entities.get(id)).filter(Boolean) as Entity[];
  }

  getEntities(type?: EntityType): Entity[] {
    return type ? [...this.entities.values()].filter(e => e.type === type) : [...this.entities.values()];
  }

  getAllRelations(): Relation[] { return [...this.relations]; }

  getStats(): { entities: number; relations: number; byType: Record<string, string> } {
    const byType: Record<string, number> = {};
    for (const e of this.entities.values()) byType[e.type] = (byType[e.type] || 0) + 1;
    return { entities: this.entities.size, relations: this.relations.length, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, String(v)])) };
  }

  findPath(fromId: string, toId: string): Relation[] | null {
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
