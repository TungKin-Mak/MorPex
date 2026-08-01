/**
 * DependencyResolver — 依赖解析器
 *
 * 管理 DAG 节点间的依赖关系，判断哪些节点可以执行。
 */
import { TaskNode } from './TaskNode.js';
import { TaskGraph } from './TaskGraph.js';

export interface ResolvedDependencies {
  completed: string[];
  failed: string[];
  pending: string[];
  blocked: string[];
}

export class DependencyResolver {
  private graph: TaskGraph;

  constructor(graph: TaskGraph) {
    this.graph = graph;
  }

  /**
   * 获取指定节点的所有依赖
   */
  getDependencies(nodeId: string): string[] {
    const node = this.graph.getNode(nodeId);
    return node ? [...node.deps] : [];
  }

  /**
   * 依赖是否都已满足
   */
  areDependenciesMet(nodeId: string): boolean {
    const node = this.graph.getNode(nodeId);
    if (!node) return false;
    if (node.deps.length === 0) return true;

    return node.deps.every(depId => {
      const depNode = this.graph.getNode(depId);
      return depNode && depNode.status === 'success';
    });
  }

  /**
   * 获取被阻塞的节点（有依赖未完成）
   */
  getBlockedNodes(): TaskNode[] {
    return this.graph.nodes.filter(n => {
      if (n.status !== 'pending') return false;
      return !this.areDependenciesMet(n.id);
    });
  }

  /**
   * 解析所有依赖状态
   */
  resolveAll(): ResolvedDependencies {
    const completed: string[] = [];
    const failed: string[] = [];
    const pending: string[] = [];
    const blocked: string[] = [];

    for (const node of this.graph.nodes) {
      switch (node.status) {
        case 'success':
          completed.push(node.id);
          break;
        case 'failed':
          failed.push(node.id);
          break;
        case 'pending':
          if (this.areDependenciesMet(node.id)) {
            pending.push(node.id);
          } else {
            blocked.push(node.id);
          }
          break;
        case 'running':
          pending.push(node.id);
          break;
      }
    }

    return { completed, failed, pending, blocked };
  }

  /**
   * 是否有循环依赖
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const node of this.graph.nodes) {
      if (this.detectCycle(node.id, visited, recursionStack)) {
        return true;
      }
    }
    return false;
  }

  private detectCycle(nodeId: string, visited: Set<string>, recStack: Set<string>): boolean {
    if (recStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recStack.add(nodeId);

    const node = this.graph.getNode(nodeId);
    if (node) {
      for (const depId of node.deps) {
        if (this.detectCycle(depId, visited, recStack)) {
          return true;
        }
      }
    }

    recStack.delete(nodeId);
    return false;
  }
}
