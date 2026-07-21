/**
 * DAGEngine — STUB (replaced by DAGRuntime)
 * @deprecated Use DAGRuntime from runtime/dag/
 */
export class DAGEngine {
  nodeCount = 0; edgeCount = 0;
  private nodes: any[] = [];
  addNode(n: any) { this.nodes.push(n); this.nodeCount = this.nodes.length; }
  clear() { this.nodes = []; this.nodeCount = 0; this.edgeCount = 0; }
  hasCycle() { return false; }
  validate() { return { valid: true, errors: [] }; }
  topologicalSort() { return [...this.nodes]; }
  getReadyNodes() { return this.nodes.filter((n: any) => n.status === 'pending' && (!n.deps || n.deps.length === 0)); }
  startNode(id: string) { const n = this.nodes.find((x: any) => x.id === id); if (n) n.status = 'running'; }
  completeNode(id: string, _result?: any) { const n = this.nodes.find((x: any) => x.id === id); if (n) n.status = 'completed'; }
  failNode(id: string, _err?: string) { const n = this.nodes.find((x: any) => x.id === id); if (n) { n.status = this.getNode(id)?.retryCount < this.getNode(id)?.maxRetries ? 'pending' : 'failed'; n.retryCount = (n.retryCount || 0) + 1; } }
  isComplete() { return this.nodes.every((n: any) => n.status === 'completed'); }
  getNode(id: string) { return this.nodes.find((x: any) => x.id === id); }
  getStatus() { return { totalNodes: this.nodes.length }; }
  insertAfter(_afterId: string, newNode: any) { this.nodes.push(newNode); this.nodeCount = this.nodes.length; }
  buildFromTasks(tasks: any[]) { for (const t of tasks) this.addNode({ id: t.id, name: t.name, agentType: t.assignedRole, deps: t.dependencies, status: 'pending', priority: t.priority }); }
}
