/**
 * LineageTracker — STUB (replaced by ArtifactLineageTracker)
 * @deprecated Use ArtifactLineageTracker from planes/artifact-plane/
 */
export class LineageTracker {
  name = 'LineageTracker';
  version = '1.0.0';
  constructor(_opts?: any) {}
  getStats() { return { totalNodes: 0, totalEdges: 0 }; }
  getStatus() { return { name: 'LineageTracker', phase: 'running' }; }
  getUpstream(_uri: string) { return []; }
  getDownstream(_uri: string) { return []; }
  getByURI(_uri: string) { return undefined; }
  getByExecution(_execId: string) { return []; }
  getGraphSnapshot() { return { nodes: new Map(), edges: [] }; }
  isReachable(_a: string, _b: string) { return false; }
}
