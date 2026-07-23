/**
 * DAGEngine — STUB (replaced by DAGRuntime)
 * @deprecated Use DAGRuntime from runtime/dag/
 */
export class DAGEngine {
  nodeCount = 0; edgeCount = 0;
  private nodes: Map<string, any> = new Map();

  addNode(n: any) {
    const id = n.id;
    this.nodes.set(id, { ...n, retryCount: n.retryCount ?? 0, maxRetries: n.maxRetries ?? 3 });
    this.nodeCount = this.nodes.size;
    // Recompute edge count from deps
    this.edgeCount = 0;
    for (const node of this.nodes.values()) {
      if (node.deps) this.edgeCount += node.deps.length;
    }
    return id;
  }

  removeNode(id: string): boolean {
    const existed = this.nodes.has(id);
    this.nodes.delete(id);
    this.nodeCount = this.nodes.size;
    // Recompute edge count
    this.edgeCount = 0;
    for (const node of this.nodes.values()) {
      if (node.deps) this.edgeCount += node.deps.length;
    }
    return existed;
  }

  clear() { this.nodes.clear(); this.nodeCount = 0; this.edgeCount = 0; }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      const node = this.nodes.get(id);
      if (node?.deps) {
        for (const dep of node.deps) {
          if (dfs(dep)) return true;
        }
      }
      inStack.delete(id);
      return false;
    };
    for (const id of this.nodes.keys()) {
      if (dfs(id)) return true;
    }
    return false;
  }

  validate() {
    const errors: string[] = [];
    // Check for missing dependencies
    for (const [id, node] of this.nodes.entries()) {
      if (node.deps) {
        for (const dep of node.deps) {
          if (!this.nodes.has(dep)) {
            errors.push(`Node ${id} depends on missing node ${dep}`);
          }
        }
      }
    }
    // Check for cycles
    if (this.hasCycle()) {
      errors.push('Graph contains a cycle');
    }
    return { valid: errors.length === 0, errors };
  }

  topologicalSort() {
    // Kahn's algorithm for proper topological ordering
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const [id] of this.nodes) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const [, node] of this.nodes) {
      for (const dep of node.deps || []) {
        adj.get(dep)?.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const result: any[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = this.nodes.get(id);
      if (node) result.push(node);
      for (const neighbor of adj.get(id) || []) {
        const newDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    return result;
  }

  getReadyNodes() {
    return [...this.nodes.values()].filter((n: any) =>
      n.status === 'pending' &&
      (!n.deps || n.deps.length === 0 || n.deps.every((d: string) => {
        const depNode = this.nodes.get(d);
        return depNode && depNode.status === 'completed';
      }))
    );
  }

  startNode(id: string) {
    const n = this.nodes.get(id);
    if (n) n.status = 'running';
  }

  completeNode(id: string, _result?: any) {
    const n = this.nodes.get(id);
    if (n) n.status = 'completed';
  }

  failNode(id: string, _err?: string) {
    const n = this.nodes.get(id);
    if (n) {
      n.retryCount = (n.retryCount || 0) + 1;
      if (n.retryCount <= n.maxRetries) {
        n.status = 'pending';
      } else {
        n.status = 'failed';
      }
    }
  }

  isComplete() {
    return [...this.nodes.values()].every((n: any) => n.status === 'completed');
  }

  getNode(id: string) {
    return this.nodes.get(id);
  }

  getAllNodes() {
    return [...this.nodes.values()];
  }

  getStatus() {
    return { totalNodes: this.nodes.size };
  }

  insertAfter(afterId: string, newNode: any) {
    this.addNode(newNode);
    // Adjust deps: newNode depends on afterId, and nodes that depended on afterId now also depend on newNode
    if (afterId && this.nodes.has(afterId)) {
      if (!newNode.deps) newNode.deps = [];
      if (!newNode.deps.includes(afterId)) newNode.deps.push(afterId);
    }
  }

  rerouteNode(nodeId: string, newDepId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    if (!node.deps) node.deps = [];
    if (!node.deps.includes(newDepId)) node.deps.push(newDepId);
    this.edgeCount = 0;
    for (const n of this.nodes.values()) {
      if (n.deps) this.edgeCount += n.deps.length;
    }
    return true;
  }

  buildFromTasks(tasks: any[]) {
    for (const t of tasks) {
      this.addNode({
        id: t.id,
        name: t.name,
        agentType: t.assignedRole,
        deps: t.dependencies,
        status: 'pending',
        priority: t.priority,
      });
    }
  }
}
