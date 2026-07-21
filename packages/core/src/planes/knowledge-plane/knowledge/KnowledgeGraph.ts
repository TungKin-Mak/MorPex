/**
 * KnowledgeGraph — STUB (replaced by PersonalBrain/BehaviorTwin)
 */
export class KnowledgeGraph {
  name = 'KnowledgeGraph';
  version = '1.0.0';
  constructor(_opts?: any) {}
  addEntity(_e: any) { return this; }
  addRelation(_r: any) {}
  get(_id: string) { return null; }
  searchEntities(_query: string | { text: string; limit?: number }, _limit?: number) {
    return [] as Array<{ type: string; name: string; description?: string }>;
  }
  getNeighborhood(_id: string, _depth?: number) { return { entities: [], relations: [] }; }
  findPath(_from: string, _to: string) { return { path: [] }; }
  getStats() { return { totalEntities: 0, totalRelations: 0, totalEdges: 0 }; }
  toJSON() { return { entities: [], relations: [] }; }
  fromJSON(_data: any) {}
  loadFromDisk(_path?: string) { return this; }
  clear() {}
  getStatus() { return true; }
}
