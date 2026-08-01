/**
 * PipelineExecutor Shared Helpers — Extracted for stage file imports without circular deps
 *
 * These were originally defined inside PipelineExecutor.ts as module-level functions.
 * Extracted here so stage files can import them without creating circular dependencies.
 */

import type { DAGNode } from '../../../domains/types.js';
import type { DESNodeResult } from '../types.js';

/**
 * seededRandom — Deterministic pseudo-random based on a seed string
 */
export function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs((hash % 10000) / 10000);
}

/**
 * topologicalSort — Sort DAG nodes by dependency order (Kahn's algorithm)
 */
export function topologicalSort(nodes: DAGNode[]): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const nodeIds = new Set<string>();

  for (const n of nodes) {
    nodeIds.add(n.taskId);
    if (!adj.has(n.taskId)) adj.set(n.taskId, []);
    if (!inDegree.has(n.taskId)) inDegree.set(n.taskId, 0);
  }

  for (const n of nodes) {
    if (n.deps) {
      for (const dep of n.deps) {
        if (nodeIds.has(dep)) {
          adj.get(dep)!.push(n.taskId);
          inDegree.set(n.taskId, (inDegree.get(n.taskId) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return result;
}

/**
 * findDownstreamNodes — Recursively find nodes downstream of a failed node
 */
export function findDownstreamNodes(
  failedNodeId: string,
  nodes: DAGNode[],
  topoOrder: string[],
  nodeResults: DESNodeResult[],
): void {
  const failedIdx = topoOrder.indexOf(failedNodeId);
  if (failedIdx === -1) return;

  for (let i = failedIdx + 1; i < topoOrder.length; i++) {
    const downstreamId = topoOrder[i];
    const downstreamNode = nodes.find(n => n.taskId === downstreamId);
    if (!downstreamNode) continue;

    const deps = downstreamNode.deps ?? [];
    const hasFailedDep = deps.some(d => {
      const depResult = nodeResults.find(nr => nr.nodeId === d);
      return depResult && !depResult.passed;
    });

    if (hasFailedDep) {
      const existingResult = nodeResults.find(nr => nr.nodeId === downstreamId);
      if (existingResult && existingResult.passed !== false) {
        existingResult.passed = false;
        existingResult.failureReason = `Cascade from ${failedNodeId}`;
        existingResult.cascadeFailures.push(failedNodeId);
        // Continue cascading
        findDownstreamNodes(downstreamId, nodes, topoOrder, nodeResults);
      }
    }
  }
}
