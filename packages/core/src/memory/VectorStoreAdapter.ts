/**
 * VectorStoreAdapter — STUB (removed during v4→v9 refactor)
 * @deprecated Use @zvec/zvec directly for vector operations.
 */
export class VectorStoreAdapter {
  name = 'VectorStoreAdapter';
  version = '1.0.0';
  constructor(_opts?: any) {}
  async store(_vectors: any[]) { return []; }
  async search(_query: any, _topK: number) { return []; }
  async delete(_ids: string[]) {}
  getStats() { return { totalVectors: 0 }; }
}
