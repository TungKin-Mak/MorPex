/**
 * ArtifactLineage — 产物血缘追踪
 *
 * 追踪 Artifact 的血缘关系：谁生成了它，它基于什么生成，它被谁使用。
 */
import type { ArtifactNode, ArtifactEdge, LineageQuery, LineagePath } from './types.js';
import { ArtifactGraph } from './ArtifactGraph.js';

export class ArtifactLineage {
  constructor(private graph: ArtifactGraph) {}

  /** 查询血缘路径 */
  query(query: LineageQuery): LineagePath[] {
    const paths: LineagePath[] = [];

    const node = this.graph.getNode(query.artifactId);
    if (!node) return paths;

    if (query.direction === 'downstream' || query.direction === 'both') {
      paths.push(this.traceDownstream(query.artifactId, query.maxDepth ?? 10, query.types));
    }
    if (query.direction === 'upstream' || query.direction === 'both') {
      paths.push(this.traceUpstream(query.artifactId, query.maxDepth ?? 10, query.types));
    }

    return paths;
  }

  /** 获取完整血缘树 */
  getFullLineage(id: string): { ancestors: ArtifactNode[]; descendants: ArtifactNode[] } {
    return {
      ancestors: this.graph.getDependents(id),
      descendants: this.graph.getDependencyChain(id),
    };
  }

  /** 判断两个 Artifact 是否同源 */
  areSiblings(idA: string, idB: string): boolean {
    const lineageA = this.graph.getDependents(idA);
    const lineageB = this.graph.getDependents(idB);
    return lineageA.some(n => lineageB.some(m => m.id === n.id));
  }

  /** 找出两个 Artifact 的最近公共祖先 */
  findLCA(idA: string, idB: string): ArtifactNode | null {
    const ancestorsA = this.graph.getDependents(idA);
    const ancestorsB = new Set(this.graph.getDependents(idB).map(n => n.id));
    for (const node of ancestorsA) {
      if (ancestorsB.has(node.id)) return node;
    }
    return null;
  }

  private traceDownstream(start: string, maxDepth: number, types?: string[]): LineagePath {
    const visited = new Set<string>();
    const nodes: ArtifactNode[] = [];
    const edges: ArtifactEdge[] = [];
    let depth = 0;

    const traverse = (nodeId: string, currentDepth: number) => {
      if (visited.has(nodeId) || currentDepth > maxDepth) return;
      visited.add(nodeId);
      const node = this.graph.getNode(nodeId);
      if (node && (!types || types.includes(node.type))) nodes.push(node);
      depth = Math.max(depth, currentDepth);

      for (const edge of this.graph.getOutgoing(nodeId)) {
        edges.push(edge);
        traverse(edge.to, currentDepth + 1);
      }
    };

    traverse(start, 0);
    return { nodes, edges, depth };
  }

  private traceUpstream(start: string, maxDepth: number, types?: string[]): LineagePath {
    const visited = new Set<string>();
    const nodes: ArtifactNode[] = [];
    const edges: ArtifactEdge[] = [];
    let depth = 0;

    const traverse = (nodeId: string, currentDepth: number) => {
      if (visited.has(nodeId) || currentDepth > maxDepth) return;
      visited.add(nodeId);
      const node = this.graph.getNode(nodeId);
      if (node && (!types || types.includes(node.type))) nodes.push(node);
      depth = Math.max(depth, currentDepth);

      for (const edge of this.graph.getIncoming(nodeId)) {
        edges.push(edge);
        traverse(edge.from, currentDepth + 1);
      }
    };

    traverse(start, 0);
    return { nodes, edges, depth };
  }
}
