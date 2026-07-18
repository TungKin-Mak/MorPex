/**
 * TopologyExplorer — Zero-Token DAG Topology Exploration Engine
 *
 * Generates topological permutations of a DAG, simulates each via DES,
 * ranks by predicted outcomes, and selects the optimal ordering.
 *
 * ZERO TOKENS: Pure computation, no LLM calls, no real execution.
 * This is "what-if analysis" applied to DAG topology.
 *
 * ── Data Flow ──
 *   Stage 3 (candidate) → TopologyExplorer → best ordering → Stage 4 (DES) → Stage 5 (MCDA)
 *
 * ── Design ──
 *   - Runs inside Stage 4 (plan simulation)
 *   - Generates valid topological permutations respecting deps
 *   - Each variant gets 1 fast DES pass (not the full 3-run average)
 *   - Ranked by composite = survival × 0.6 + (1 − latency/maxLatency) × 0.4
 *   - Best variant gets full 3-run DES for final report
 *   - Non-critical: failures don't abort pipeline
 */

import type { ExecutionDAG } from '../../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { DESConfig, IShadowSimulationReport } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

/** Single variant simulation result */
export interface VariantSimulationResult {
  /** The permutation's topological ordering description */
  ordering: string;
  /** The DAG with nodes in this ordering */
  dag: ExecutionDAG;
  /** Simulated survival probability 0-1 */
  survivalProbability: number;
  /** Simulated total latency in ms */
  totalSimulatedLatencyMs: number;
  /** Passed node count */
  passedNodes: number;
  /** Failed node count */
  failedNodes: number;
  /** Composite score: survival × 0.6 + (1 − latency/maxLatency) × 0.4 */
  compositeScore: number;
}

/** Full exploration report */
export interface TopologyExplorationReport {
  /** Original DAG before exploration */
  originalDAG: ExecutionDAG;
  /** Total permutations generated */
  totalVariantsGenerated: number;
  /** Total permutations simulated */
  totalVariantsSimulated: number;
  /** All simulated variant results */
  variantsSimulated: VariantSimulationResult[];
  /** Best variant by composite score */
  bestVariant: VariantSimulationResult;
  /** Composite score of the original ordering */
  originalScore: number;
  /** Best composite score found */
  bestScore: number;
  /** Relative improvement (best − original) / original */
  improvement: number;
  /** Selected (optimized) DAG to execute */
  selectedDAG: ExecutionDAG;
  /** Wall-clock time spent exploring in ms */
  explorationTimeMs: number;
  /** Whether the original DAG was modified */
  wasOptimized: boolean;
}

/** Permutation generation limits */
const DEFAULT_MAX_PERMUTATIONS = 24;
const DEFAULT_MAX_NODES_FOR_EXPLORATION = 7;
const DEFAULT_SIMULATIONS_PER_VARIANT = 1; // fast: 1 pass instead of 3

// ═══════════════════════════════════════════════════════════════════════
// TopologyExplorer
// ═══════════════════════════════════════════════════════════════════════

export class TopologyExplorer {
  private maxPermutations: number;
  private maxNodesForExploration: number;
  private simulationsPerVariant: number;

  constructor(config?: {
    maxPermutations?: number;
    maxNodesForExploration?: number;
    simulationsPerVariant?: number;
  }) {
    this.maxPermutations = config?.maxPermutations ?? DEFAULT_MAX_PERMUTATIONS;
    this.maxNodesForExploration = config?.maxNodesForExploration ?? DEFAULT_MAX_NODES_FOR_EXPLORATION;
    this.simulationsPerVariant = config?.simulationsPerVariant ?? DEFAULT_SIMULATIONS_PER_VARIANT;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  /**
   * exploreAndOptimize — Generate permutations, simulate, rank, select best.
   *
   * @param dag - The DAG to explore variants of
   * @param volatilityMatrix - Domain→failureRate map for DES seeding
   * @param desConfig - DES parameters
   * @returns Full exploration report with selected DAG
   */
  exploreAndOptimize(
    dag: ExecutionDAG,
    volatilityMatrix: Map<string, number>,
    desConfig: DESConfig,
  ): TopologyExplorationReport {
    const startTime = Date.now();
    const nodes = dag.nodes;

    // Skip if too many nodes (permutation explosion)
    if (nodes.length > this.maxNodesForExploration) {
      return this.skippedReport(dag, startTime, `节点数 ${nodes.length} > ${this.maxNodesForExploration}，跳过拓扑探索`);
    }

    // Generate all valid topological permutations
    const permutations = this.generateValidPermutations(nodes, this.maxPermutations);
    if (permutations.length <= 1) {
      return this.skippedReport(dag, startTime, '仅 1 种有效排序，无需探索');
    }

    // Build permuted DAGs
    const permutedDAGs = this.buildPermutedDAGs(dag, permutations);

    // Simulate each variant (1 fast pass each)
    const variantResults: VariantSimulationResult[] = [];
    for (const permutedDAG of permutedDAGs) {
      const sim = this.simulateSingleVariant(permutedDAG, volatilityMatrix, desConfig);
      variantResults.push(sim);
    }

    // Find the original ordering's score
    const originalSignature = nodes.map(n => n.taskId).join('→');
    const originalResult = variantResults.find(v => v.ordering === originalSignature)
      ?? variantResults[0];
    const originalScore = originalResult.compositeScore;

    // Rank by composite score (descending)
    variantResults.sort((a, b) => b.compositeScore - a.compositeScore);
    const bestVariant = variantResults[0];
    const bestScore = bestVariant.compositeScore;

    // Compute improvement
    const improvement = originalScore > 0
      ? (bestScore - originalScore) / originalScore
      : bestScore - originalScore;

    const wasOptimized = improvement > 0.01 && bestVariant.ordering !== originalSignature;

    return {
      originalDAG: dag,
      totalVariantsGenerated: permutations.length,
      totalVariantsSimulated: variantResults.length,
      variantsSimulated: variantResults,
      bestVariant,
      originalScore,
      bestScore,
      improvement: Math.max(0, improvement),
      selectedDAG: wasOptimized ? bestVariant.dag : dag,
      explorationTimeMs: Date.now() - startTime,
      wasOptimized,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Permutation Generation (Kahn's algorithm with backtracking)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * generateValidPermutations — All valid topological sorts via Kahn backtracking.
   *
   * At each step: find all nodes with in-degree 0, try each as the next candidate,
   * recurse. This generates every topological ordering of the DAG.
   */
  generateValidPermutations(
    nodes: ExecutionDAG['nodes'],
    limit: number = DEFAULT_MAX_PERMUTATIONS,
  ): string[][] {
    // Build adjacency + in-degree
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeSet = new Set<string>();

    for (const n of nodes) {
      const id = n.taskId;
      adj.set(id, []);
      inDegree.set(id, 0);
      nodeSet.add(id);
    }
    for (const n of nodes) {
      for (const dep of n.deps ?? []) {
        if (adj.has(dep)) {
          adj.get(dep)!.push(n.taskId);
          inDegree.set(n.taskId, (inDegree.get(n.taskId) ?? 0) + 1);
        }
      }
    }

    const results: string[][] = [];
    const current: string[] = [];

    // Use a mutable copy of in-degree that we restore during backtracking
    const backtrack = () => {
      if (results.length >= limit) return;

      // Find nodes with in-degree 0 not yet placed
      const candidates: string[] = [];
      for (const id of nodeSet) {
        if (!current.includes(id) && (inDegree.get(id) ?? 0) === 0) {
          candidates.push(id);
        }
      }

      if (candidates.length === 0) {
        // All nodes placed → valid ordering
        if (current.length === nodes.length) {
          results.push([...current]);
        }
        return;
      }

      for (const candidate of candidates) {
        // Place candidate
        current.push(candidate);

        // Decrement in-degree of its dependents
        const dependents = adj.get(candidate) ?? [];
        for (const dep of dependents) {
          inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
        }

        backtrack();

        // Restore
        for (const dep of dependents) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
        }
        current.pop();

        if (results.length >= limit) return;
      }
    };

    backtrack();
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DAG Rebuilding
  // ═══════════════════════════════════════════════════════════════════

  /**
   * buildPermutedDAGs — Rebuild DAGs with nodes in each permutation order.
   *
   * The node order in the DAG representation matters because DES simulation
   * traverses nodes in their topological sort order. By reordering the nodes
   * array, we change which nodes get simulated first.
   */
  private buildPermutedDAGs(
    originalDAG: ExecutionDAG,
    permutations: string[][],
  ): ExecutionDAG[] {
    const nodeMap = new Map<string, ExecutionDAG['nodes'][0]>();
    for (const n of originalDAG.nodes) {
      nodeMap.set(n.taskId, n);
    }

    return permutations.map((order) => ({
      ...originalDAG,
      nodes: order.map(id => nodeMap.get(id)!).filter(Boolean),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // DES Simulation (single fast pass)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * simulateSingleVariant — Run 1 DES pass on a DAG variant.
   *
   * Uses the same seededRandom, topologicalSort, and resource contention
   * logic as MetaPlanner.stage4PlanSimulation's simulateSingleRun.
   */
  private simulateSingleVariant(
    dag: ExecutionDAG,
    volatilityMatrix: Map<string, number>,
    desConfig: DESConfig,
  ): VariantSimulationResult {
    const nodes = dag.nodes;
    const ordering = nodes.map(n => n.taskId).join('→');

    // Topological order (should already be in order, but verify)
    const topoOrder = this.topologicalSort(nodes);

    let totalLatencyMs = 0;
    let passedNodes = 0;
    let failedNodes = 0;
    const failedSet = new Set<string>();
    let cascadeCount = 0;

    // Resource contention tracking
    const resourceLocks = new Map<string, { locked: boolean; waitTimeMs: number; contentionCount: number }>();

    for (const nodeId of topoOrder) {
      const node = nodes.find(n => n.taskId === nodeId);
      if (!node) continue;

      const domain = node.domain ?? 'general';
      const baseFailureRate = volatilityMatrix.get(domain) ?? 0.07;

      // Check cascade from upstream failures
      const deps = node.deps ?? [];
      const upstreamFailures = deps.filter(d => failedSet.has(d));
      if (upstreamFailures.length > 0) {
        cascadeCount++;
        failedNodes++;
        failedSet.add(nodeId);
        continue;
      }

      // Resource contention
      for (const req of (node as any).requires ?? []) {
        const lock = resourceLocks.get(req);
        if (lock?.locked) {
          const waitMs = Math.round(Math.random() * 200 + 50);
          totalLatencyMs += waitMs;
          lock.contentionCount++;
          lock.waitTimeMs += waitMs;
        } else {
          resourceLocks.set(req, { locked: true, waitTimeMs: 0, contentionCount: 1 });
        }
      }

      // Stochastic probability roll
      const seededRandom = this.seededRandom(`${nodeId}_topo`);
      let passed = seededRandom >= baseFailureRate * desConfig.volatilityAmplification;

      // Micro-retry
      let retryCount = 0;
      while (!passed && retryCount < desConfig.maxRetriesPerNode) {
        retryCount++;
        const retryRandom = this.seededRandom(`${nodeId}_retry${retryCount}_topo`);
        passed = retryRandom >= baseFailureRate * desConfig.volatilityAmplification + retryCount * 0.15;
        totalLatencyMs += Math.round(200 + Math.random() * 800);
      }

      if (!passed) {
        failedNodes++;
        failedSet.add(nodeId);
      } else {
        passedNodes++;
      }

      const nodeLatency = Math.round(500 + Math.random() * 4500 * (passed ? 1 : 2));
      totalLatencyMs += nodeLatency;
    }

    // Survival probability
    const totalNodes = topoOrder.length;
    const survivalProbability = totalNodes > 0
      ? Math.max(0, Math.min(1,
        (passedNodes / totalNodes) * (1 - cascadeCount / Math.max(totalNodes * 2, 1))
      ))
      : 0;

    // Composite score
    const maxLatency = Math.max(totalLatencyMs, 1);
    const latencyScore = 1 - Math.min(totalLatencyMs / (maxLatency * 2), 1);
    const compositeScore = survivalProbability * 0.6 + latencyScore * 0.4;

    return {
      ordering,
      dag,
      survivalProbability,
      totalSimulatedLatencyMs: totalLatencyMs,
      passedNodes,
      failedNodes,
      compositeScore,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  private topologicalSort(nodes: ExecutionDAG['nodes']): string[] {
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const n of nodes) {
      const id = n.taskId;
      adj.set(id, []);
      if (!inDegree.has(id)) inDegree.set(id, 0);
    }
    for (const n of nodes) {
      for (const dep of n.deps ?? []) {
        if (adj.has(dep)) {
          adj.get(dep)!.push(n.taskId);
          inDegree.set(n.taskId, (inDegree.get(n.taskId) ?? 0) + 1);
        }
      }
    }
    const queue: string[] = [];
    for (const [id, d] of inDegree) {
      if (d === 0) queue.push(id);
    }
    const result: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);
      for (const neighbor of adj.get(id) ?? []) {
        const nd = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, nd);
        if (nd === 0) queue.push(neighbor);
      }
    }
    return result;
  }

  private seededRandom(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    const x = Math.abs(hash) % 2147483647;
    return (x * 16807) % 2147483647 / 2147483647;
  }

  private skippedReport(dag: ExecutionDAG, startTime: number, reason: string): TopologyExplorationReport {
    const survival = 0.5;
    const latency = 10000;
    return {
      originalDAG: dag,
      totalVariantsGenerated: 1,
      totalVariantsSimulated: 1,
      variantsSimulated: [{
        ordering: dag.nodes.map(n => n.taskId).join('→'),
        dag,
        survivalProbability: survival,
        totalSimulatedLatencyMs: latency,
        passedNodes: dag.nodes.length,
        failedNodes: 0,
        compositeScore: 0.5,
      }],
      bestVariant: {
        ordering: dag.nodes.map(n => n.taskId).join('→'),
        dag,
        survivalProbability: survival,
        totalSimulatedLatencyMs: latency,
        passedNodes: dag.nodes.length,
        failedNodes: 0,
        compositeScore: 0.5,
      },
      originalScore: 0.5,
      bestScore: 0.5,
      improvement: 0,
      selectedDAG: dag,
      explorationTimeMs: Date.now() - startTime,
      wasOptimized: false,
    };
  }
}
