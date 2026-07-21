/**
 * Pipeline Stage Helpers — pure utility functions extracted from PipelineExecutor
 */
import type { SemanticTag } from '../../types.js';
import type { ExecutionDAG } from '../../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { DESNodeResult } from '../../types.js';

// ═══════════════════════════════════════════════════════════════════
// Deterministic pseudo-random utilities
// ═══════════════════════════════════════════════════════════════════

/** seededRandom — Deterministic pseudo-random based on a seed string */
export function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const x = Math.abs(hash) % 2147483647;
  return (x * 16807) % 2147483647 / 2147483647;
}

/**
 * topologicalSort — Return node IDs in dependency order
 */
export function topologicalSort(nodes: ExecutionDAG['nodes']): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    const id = node.taskId;
    adj.set(id, []);
    if (!inDegree.has(id)) inDegree.set(id, 0);
  }

  for (const node of nodes) {
    const id = node.taskId;
    for (const dep of node.deps ?? []) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const neighbor of adj.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }
  return result;
}

/**
 * findDownstreamNodes — Mark downstream nodes with cascade failures
 */
export function findDownstreamNodes(
  failedNodeId: string,
  nodes: ExecutionDAG['nodes'],
  topoOrder: string[],
  nodeResults: DESNodeResult[],
): void {
  const downstream = new Set<string>();
  const findDependents = (nodeId: string) => {
    for (const node of nodes) {
      if ((node.deps ?? []).includes(nodeId)) {
        const childId = node.taskId;
        if (!downstream.has(childId)) {
          downstream.add(childId);
          findDependents(childId);
        }
      }
    }
  };
  findDependents(failedNodeId);
  for (const result of nodeResults) {
    if (downstream.has(result.nodeId) && !result.cascadeFailures.includes(failedNodeId)) {
      result.cascadeFailures.push(failedNodeId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Tag categorization
// ═══════════════════════════════════════════════════════════════════

/** categorizeTag — Classify a semantic tag by category */
export function categorizeTag(tag: string): SemanticTag['category'] {
  const domainTags = ['ai_ml', 'web_dev', 'mobile', 'data_engineering', 'devops', 'hardware', 'security', 'testing', 'startup'];
  const actionTags = ['build', 'analyze', 'fix', 'optimize', 'design', 'deploy'];
  const complexityTags = ['low_complexity', 'high_complexity'];

  if (domainTags.includes(tag)) return 'domain';
  if (actionTags.includes(tag)) return 'action';
  if (complexityTags.includes(tag)) return 'complexity';
  return 'constraint';
}
