/**
 * ArtifactDependencyResolver — 产物依赖解析器
 *
 * 解析 Artifact 之间的依赖关系，检测循环依赖，拓扑排序。
 */
import type { ArtifactNode, ArtifactDependency, ArtifactEdge } from './types.js';
import { ArtifactGraph } from './ArtifactGraph.js';

export interface ResolveResult {
  order: ArtifactNode[];
  cycles: string[][];
  missing: string[];
  resolved: Map<string, ArtifactNode>;
}

export class ArtifactDependencyResolver {
  constructor(private graph: ArtifactGraph) {}

  /** 解析依赖顺序（拓扑排序） */
  resolve(startId?: string): ResolveResult {
    const allNodes = startId
      ? [this.graph.getNode(startId)].filter(Boolean) as ArtifactNode[]
      : this.graph.getAllNodes();

    const resolved = new Map<string, ArtifactNode>();
    const visited = new Set<string>();
    const cycles: string[][] = [];
    const missing: string[] = [];

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const node of allNodes) {
      adj.set(node.id, node.dependencies.map(d => d.artifactId));
    }

    // DFS-based topological sort with cycle detection
    const inStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId) && !inStack.has(nodeId)) return;
      if (inStack.has(nodeId)) {
        // Cycle detected
        const cycleStart = currentPath.indexOf(nodeId);
        if (cycleStart >= 0) {
          cycles.push([...currentPath.slice(cycleStart), nodeId]);
        }
        return;
      }

      const node = this.graph.getNode(nodeId);
      if (!node) { missing.push(nodeId); return; }

      visited.add(nodeId);
      inStack.add(nodeId);
      currentPath.push(nodeId);

      const deps = adj.get(nodeId) || [];
      for (const depId of deps) {
        if (this.graph.hasNode(depId)) {
          dfs(depId);
        } else {
          missing.push(depId);
        }
      }

      currentPath.pop();
      inStack.delete(nodeId);
      resolved.set(nodeId, node);
    };

    for (const node of allNodes) {
      if (!visited.has(node.id)) dfs(node.id);
    }

    // Topological order: reverse of resolution order
    const order = [...resolved.values()].reverse();

    return { order, cycles, missing, resolved };
  }

  /** 检测循环依赖 */
  detectCycles(): string[][] {
    return this.resolve().cycles;
  }

  /** 获取缺失的依赖 */
  getMissingDependencies(): string[] {
    const missing = new Set<string>();
    for (const node of this.graph.getAllNodes()) {
      for (const dep of node.dependencies) {
        if (!this.graph.hasNode(dep.artifactId)) {
          missing.add(dep.artifactId);
        }
      }
    }
    return [...missing];
  }

  /** 验证依赖图是否健康 */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const result = this.resolve();

    for (const cycle of result.cycles) {
      issues.push(`Circular dependency: ${cycle.join(' → ')}`);
    }
    for (const m of result.missing) {
      issues.push(`Missing dependency: "${m}" not found in graph`);
    }

    // Check for duplicate dependencies
    for (const node of this.graph.getAllNodes()) {
      const depIds = node.dependencies.map(d => d.artifactId);
      const unique = new Set(depIds);
      if (depIds.length !== unique.size) {
        issues.push(`Duplicate dependencies in "${node.name}": ${depIds.filter(d => depIds.indexOf(d) !== depIds.lastIndexOf(d)).join(', ')}`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /** 获取执行顺序（拓扑排序后） */
  getExecutionOrder(): ArtifactNode[] {
    return this.resolve().order;
  }
}
