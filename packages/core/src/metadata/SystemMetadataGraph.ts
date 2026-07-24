/**
 * SystemMetadataGraph — 系统元数据图
 * Phase 2: 记录所有实体关系 (Agent/Tool/Artifact/Mission/Memory/Workflow)
 */
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

  registerEntity(id: string, type: EntityType, name: string, metadata?: Record<string, unknown>): void {
    this.entities.set(id, { id, type, name, metadata: metadata || {}, createdAt: Date.now() });
  }

  addRelation(fromId: string, toId: string, type: RelationType, weight?: number, metadata?: Record<string, unknown>): void {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) return;
    this.relations.push({ fromId, toId, type, weight: weight || 1.0, createdAt: Date.now(), metadata });
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

  getAllRelations(): Relation[] {
    return [...this.relations];
  }

  getStats(): { entities: number; relations: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const e of this.entities.values()) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { entities: this.entities.size, relations: this.relations.length, byType };
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
