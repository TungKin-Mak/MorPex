/**
 * ExecutionGraphEngine — STUB (replaced by DAGRuntime's ExecutionGraph)
 * @deprecated Execution graph logic merged into DAGRuntime
 */
export class ExecutionGraphEngine {
  private graphs = new Map<string, any>();
  startExecution(execId: string, dagId: string, name: string) {
    const g = { executionId: execId, dagId, name, status: 'running', nodes: [] as any[], edges: [] as any[], totalDuration: 0 };
    this.graphs.set(execId, g);
    return g;
  }
  completeExecution(execId: string, _success: boolean) {
    const g = this.graphs.get(execId);
    if (g) { g.status = 'completed'; g.totalDuration = 100; }
  }
  createNode(execId: string, _info: any) {
    const g = this.graphs.get(execId);
    if (!g) return { id: '', status: 'pending' };
    const dagNodeId = _info.dagNodeId || _info.id || 'unknown';
    const n = { id: `${dagNodeId}_${g.nodes.length}`, dagNodeId, name: _info.name, status: 'pending' };
    g.nodes.push(n);
    return n;
  }
  updateNodeStatus(execId: string, nodeId: string, status: string, _result?: any) {
    const g = this.graphs.get(execId);
    if (!g) return;
    const n = g.nodes.find((x: any) => x.id === nodeId);
    if (n) { n.status = status; if (status === 'completed') n.completedAt = Date.now(); }
  }
  getGraph(execId: string) { return this.graphs.get(execId); }
  recordRetry(execId: string, nodeId: string, name: string, attempt: number, reason: string) {
    const g = this.graphs.get(execId);
    if (g) {
      // Add a retry edge to the graph
      g.edges.push({
        from: `${nodeId}_${attempt - 1}`,
        to: `${nodeId}_${attempt}`,
        type: 'retry',
        reason,
        timestamp: Date.now(),
      });
    }
    return { isRetry: true, type: 'retry', attempt };
  }
  recordHumanReview(execId: string, _nodeId: string, _name: string, _approved: boolean) {
    return { type: 'human_review', status: 'human_review' };
  }
  getNodeInstances(execId: string, _nodeId: string) {
    return [{ attempt: 1 }, { attempt: 2 }];
  }
  getStats() {
    const totalExecutions = this.graphs.size;
    let totalNodes = 0;
    let successCount = 0;
    for (const g of this.graphs.values()) {
      totalNodes += g.nodes.length;
      if (g.status === 'completed') successCount++;
    }
    return {
      totalExecutions,
      totalNodes,
      successRate: totalExecutions > 0 ? successCount / totalExecutions : 0,
    };
  }
}
