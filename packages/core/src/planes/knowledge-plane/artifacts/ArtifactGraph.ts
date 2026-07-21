/**
 * ArtifactGraph — 产物关系图
 *
 * 以图结构表示 Artifact 之间的依赖/引用关系，
 * 支持血缘追踪和影响分析。
 */
import type { ArtifactNode, ArtifactEdge } from './types.js';

export class ArtifactGraph {
  private nodes = new Map<string, ArtifactNode>();
  private edges: ArtifactEdge[] = [];

  addNode(node: ArtifactNode): void { this.nodes.set(node.id, node); }

  getNode(id: string): ArtifactNode | undefined { return this.nodes.get(id); }

  hasNode(id: string): boolean { return this.nodes.has(id); }

  getAllNodes(): ArtifactNode[] { return [...this.nodes.values()]; }

  addEdge(from: string, to: string, type: ArtifactEdge['type']): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return;
    this.edges.push({ from, to, type });
  }

  getOutgoing(id: string): ArtifactEdge[] {
    return this.edges.filter(e => e.from === id);
  }

  getIncoming(id: string): ArtifactEdge[] {
    return this.edges.filter(e => e.to === id);
  }

  /** 获取依赖链（downstream） */
  getDependencyChain(id: string): ArtifactNode[] {
    const visited = new Set<string>();
    const result: ArtifactNode[] = [];
    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) result.push(node);
      for (const edge of this.getOutgoing(nodeId)) traverse(edge.to);
    };
    traverse(id);
    return result;
  }

  /** 获取上游依赖（谁依赖我） */
  getDependents(id: string): ArtifactNode[] {
    const visited = new Set<string>();
    const result: ArtifactNode[] = [];
    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) result.push(node);
      for (const edge of this.getIncoming(nodeId)) traverse(edge.from);
    };
    traverse(id);
    return result;
  }

  /** 影响分析：如果某个节点变更，哪些节点会受影响 */
  impactAnalysis(id: string): { direct: ArtifactNode[]; indirect: ArtifactNode[] } {
    const dependents = this.getDependents(id);
    const direct = dependents.filter(d => {
      return this.edges.some(e => e.from === id && e.to === d.id);
    });
    const indirect = dependents.filter(d => !direct.includes(d));
    return { direct, indirect };
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
  }

  size(): number { return this.nodes.size; }
  edgeCount(): number { return this.edges.length; }

  /** 导出为 JSON */
  toJSON(): { nodes: ArtifactNode[]; edges: ArtifactEdge[] } {
    return { nodes: [...this.nodes.values()], edges: [...this.edges] };
  }

  /** 从 JSON 导入 */
  static fromJSON(data: { nodes: ArtifactNode[]; edges: ArtifactEdge[] }): ArtifactGraph {
    const g = new ArtifactGraph();
    for (const n of data.nodes) g.addNode(n);
    for (const e of data.edges) g.addEdge(e.from, e.to, e.type);
    return g;
  }
}
