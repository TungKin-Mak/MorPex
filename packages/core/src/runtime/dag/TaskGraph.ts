/**
 * TaskGraph — DAG 图结构
 *
 * 管理节点和边的数据结构和组织。
 */
import type { DAGEdge, DAGStatus, ExecutionDAG } from '../../planes/runtime-kernel/dag/types.js';
import { TaskNode } from './TaskNode.js';

export class TaskGraph {
  private _nodes: Map<string, TaskNode> = new Map();
  private _edges: DAGEdge[] = [];
  private _id: string;

  constructor(id?: string) {
    this._id = id ?? `dag_${Date.now()}`;
  }

  get id(): string { return this._id; }
  get nodes(): TaskNode[] { return [...this._nodes.values()]; }
  get edges(): DAGEdge[] { return [...this._edges]; }

  addNode(node: TaskNode): void {
    this._nodes.set(node.id, node);
  }

  getNode(id: string): TaskNode | undefined {
    return this._nodes.get(id);
  }

  addEdge(from: string, to: string, weight: number = 1): void {
    this._edges.push({ from, to, weight });
  }

  /**
   * 获取就绪节点（所有依赖已完成的节点）
   */
  getReadyNodes(): TaskNode[] {
    const completedIds = new Set(
      [...this._nodes.values()]
        .filter(n => n.status === 'success')
        .map(n => n.id)
    );

    return [...this._nodes.values()].filter(n => {
      if (n.status !== 'pending') return false;
      return n.deps.every(depId => completedIds.has(depId));
    });
  }

  /**
   * 获取正在运行的节点
   */
  getRunningNodes(): TaskNode[] {
    return [...this._nodes.values()].filter(n => n.status === 'running');
  }

  /**
   * 获取失败的节点
   */
  getFailedNodes(): TaskNode[] {
    return [...this._nodes.values()].filter(n => n.status === 'failed');
  }

  /**
   * 所有节点是否已完成
   */
  isComplete(): boolean {
    return [...this._nodes.values()].every(n =>
      n.status === 'success' || n.status === 'failed' || n.status === 'skipped'
    );
  }

  /**
   * 是否全部成功
   */
  isSuccess(): boolean {
    return [...this._nodes.values()].every(n => n.status === 'success');
  }

  /**
   * 拓扑排序（Kahn 算法）
   */
  topologicalSort(): TaskNode[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of this._nodes.values()) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    for (const edge of this._edges) {
      adjList.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: TaskNode[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const node = this._nodes.get(nodeId);
      if (node) sorted.push(node);

      for (const neighbor of adjList.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  /**
   * 获取 DAG 状态
   */
  getStatus(): DAGStatus {
    return {
      totalNodes: this._nodes.size,
      totalEdges: this._edges.length,
      mutations: 0,
      isCyclic: this.topologicalSort().length !== this._nodes.size,
      canRollback: true,
      isComplete: this.isComplete(),
    };
  }

  /**
   * 从 ExecutionDAG 构建 TaskGraph
   */
  static fromExecutionDAG(dag: ExecutionDAG): TaskGraph {
    const graph = new TaskGraph(dag.id);
    for (const dn of dag.nodes) {
      graph.addNode(new TaskNode(dn));
    }
    for (const edge of dag.edges) {
      graph.addEdge(edge.from, edge.to, edge.weight);
    }
    return graph;
  }

  /**
   * 转换为 ExecutionDAG
   */
  toExecutionDAG(): ExecutionDAG {
    return {
      id: this._id,
      nodes: [...this._nodes.values()].map(n => n.toDAGNode()),
      edges: [...this._edges],
      status: this.getStatus(),
      createdAt: Date.now(),
    };
  }
}
