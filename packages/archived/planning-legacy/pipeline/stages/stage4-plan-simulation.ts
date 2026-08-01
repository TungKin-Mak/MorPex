/**
 * Stage 4: Plan Simulation (DES) — Run Discrete Event Simulation on candidates
 *
 * Uses stochastic DES with volatility matrices to simulate plan execution risk.
 * Integrates with TopologyExplorer for zero-token topology optimization.
 *
 * @see PipelineExecutor.ts — thin wrapper calls this function
 */

import * as crypto from 'node:crypto';
import type { ICandidatePlansOutput, ExperienceQueryResult, IShadowSimulationReport } from '../../types.js';
import type { CandidatePlanProfile, ShadowContext, DESNodeResult, SimulatedExceptionTrace, ResourceContention, ResourceBottleneck } from '../../types.js';
import { topologicalSort, findDownstreamNodes, seededRandom } from '../pipeline-helpers.js';
import type { PipelineStageContext } from './types.js';

export async function executeStage4PlanSimulation(
  ctx: PipelineStageContext,
  candidates: ICandidatePlansOutput,
  experience: ExperienceQueryResult | null,
): Promise<IShadowSimulationReport[]> {
  // ── Zero-Token Topology Exploration ──
  if (ctx.topologyExplorer) {
    const volatilityMatrix = buildVolatilityMatrix(experience);
    for (const candidate of candidates.candidates) {
      try {
        const report = ctx.topologyExplorer.exploreAndOptimize(
          candidate.dag,
          volatilityMatrix,
          ctx.desConfig,
        );
        if (report.wasOptimized) {
          candidate.dag = report.selectedDAG;
          console.log(`[TopologyExplorer] ${candidate.strategy}: ${report.totalVariantsSimulated} variants → improved ${(report.improvement * 100).toFixed(1)}% (${report.bestVariant.ordering})`);
        }
      } catch (err) {
        console.warn(`[TopologyExplorer] ${candidate.strategy} 探索失败: ${(err as Error).message}`);
      }
    }
  }

  // Delegate to simulateDES
  return simulateDES(ctx, candidates.candidates, experience);
}

/**
 * simulateDES — Run DES on all candidates with configurable parallel shadow contexts
 */
async function simulateDES(
  ctx: PipelineStageContext,
  candidateProfiles: CandidatePlanProfile[],
  experience: ExperienceQueryResult | null,
): Promise<IShadowSimulationReport[]> {
  const volatilityMatrix = buildVolatilityMatrix(experience);
  const numberOfShadowContexts = (ctx.desConfig as any).numberOfShadowContexts ?? 3;
  const allSimulations: IShadowSimulationReport[] = [];

  for (const candidate of candidateProfiles) {
    const shadowCtxs: ShadowContext[] = [];
    for (let i = 0; i < numberOfShadowContexts; i++) {
      shadowCtxs.push({
        shadowId: `shadow_${candidate.profileId}_${i}`,
        simulationId: '',
        startTime: 0,
        endTime: 0,
        completed: false,
        nodeResults: [],
        timeline: [],
      } as unknown as ShadowContext);
    }

    const candidateSimulations: IShadowSimulationReport[] = [];
    for (let runIdx = 0; runIdx < shadowCtxs.length; runIdx++) {
      const simulation = simulateSingleRun(ctx, candidate, volatilityMatrix, shadowCtxs[runIdx], runIdx);
      candidateSimulations.push(simulation);
    }

    // Average results across shadow contexts
    const averaged = averageSimulations(ctx, candidateSimulations, candidate.profileId, candidate.strategy);
    allSimulations.push(averaged);
  }

  return allSimulations;
}

/**
 * buildVolatilityMatrix — Compute failure probabilities per domain/role
 */
export function buildVolatilityMatrix(experience: ExperienceQueryResult | null): Map<string, number> {
  const matrix = new Map<string, number>();

  const domainDefaults: Record<string, number> = {
    security: 0.15, hardware: 0.20, ai_ml: 0.12, devops: 0.10,
    data_engineering: 0.08, web_dev: 0.05, testing: 0.03, general: 0.07,
  };

  for (const [domain, rate] of Object.entries(domainDefaults)) {
    matrix.set(domain, rate);
  }

  if (experience?.negativeSamples) {
    const domainFailureCount = new Map<string, number>();
    const domainTotalCount = new Map<string, number>();

    for (const sample of experience.negativeSamples) {
      for (const node of sample.dagNodes) {
        const d = node.domain ?? 'general';
        domainFailureCount.set(d, (domainFailureCount.get(d) ?? 0) + 1);
      }
    }
    for (const sample of experience.positiveSamples) {
      for (const node of sample.dagNodes) {
        const d = node.domain ?? 'general';
        domainTotalCount.set(d, (domainTotalCount.get(d) ?? 0) + 1);
      }
    }

    for (const [domain, failures] of domainFailureCount) {
      const total = (domainTotalCount.get(domain) ?? 0) + failures;
      if (total > 0) {
        const empiricalRate = failures / total;
        const defaultRate = domainDefaults[domain] ?? 0.07;
        const blended = empiricalRate * 0.6 + defaultRate * 0.4;
        matrix.set(domain, Math.min(0.5, Math.max(0.01, blended)));
      }
    }
  }

  return matrix;
}

/**
 * simulateSingleRun — Run DES on one profile within one ShadowContext
 */
export function simulateSingleRun(
  ctx: PipelineStageContext,
  candidate: CandidatePlanProfile,
  volatilityMatrix: Map<string, number>,
  shadowCtx: ShadowContext,
  runSeed: number,
): IShadowSimulationReport {
  const simulationId = `sim_${candidate.profileId}_run${runSeed}_${Date.now()}`;
  const nodes = candidate.dag.nodes;
  const startedAt = Date.now();

  const topoOrder = topologicalSort(nodes);
  const nodeResults: DESNodeResult[] = [];
  const simulatedExceptionTraces: SimulatedExceptionTrace[] = [];
  const failedNodes = new Set<string>();
  let totalSimulatedLatencyMs = 0;
  let cascadeFailureCount = 0;

  const resourceLocks = new Map<string, { locked: boolean; waitTimeMs: number; contentionCount: number }>();

  for (const nodeId of topoOrder) {
    const node = nodes.find(n => n.taskId === nodeId);
    if (!node) continue;

    const domain = node.domain ?? 'general';
    const baseFailureRate = volatilityMatrix.get(domain) ?? 0.07;
    const deps = node.deps ?? [];
    const upstreamFailures = deps.filter(d => failedNodes.has(d));

    if (upstreamFailures.length > 0) {
      cascadeFailureCount++;
      nodeResults.push({
        nodeId,
        passed: false,
        simulatedLatencyMs: 0,
        retryCount: 0,
        failureReason: `Cascade from upstream failures: ${upstreamFailures.join(', ')}`,
        cascadeFailures: [],
        resourceContention: [],
      });
      failedNodes.add(nodeId);
      continue;
    }

    const resourceContention: ResourceContention[] = [];
    for (const req of (node as any).requires ?? []) {
      const lock = resourceLocks.get(req);
      if (lock?.locked) {
        const waitMs = Math.round(Math.random() * 200 + 50);
        resourceContention.push({ resourceId: req, waitTimeMs: waitMs });
        totalSimulatedLatencyMs += waitMs;
        lock.contentionCount++;
        lock.waitTimeMs += waitMs;
      } else {
        resourceLocks.set(req, { locked: true, waitTimeMs: 0, contentionCount: 1 });
      }
    }

    const sRandom = seededRandom(`${nodeId}_${runSeed}`);
    let passed = sRandom >= baseFailureRate * ctx.desConfig.volatilityAmplification;
    let retryCount = 0;
    let failureReason: string | undefined;
    const maxRetries = ctx.desConfig.maxRetriesPerNode;

    while (!passed && retryCount < maxRetries) {
      retryCount++;
      const retryRandom = seededRandom(`${nodeId}_retry${retryCount}_${runSeed}`);
      passed = retryRandom >= baseFailureRate * ctx.desConfig.volatilityAmplification + retryCount * 0.15;
      totalSimulatedLatencyMs += Math.round(200 + Math.random() * 800);
    }

    if (!passed) {
      failureReason = `Failed after ${retryCount} retries (domain=${domain}, baseRate=${baseFailureRate.toFixed(3)})`;
      simulatedExceptionTraces.push({
        nodeId,
        exceptionType: 'NodeExecutionFailed',
        message: failureReason,
        timestamp: Date.now() + Math.round(totalSimulatedLatencyMs),
      });
      failedNodes.add(nodeId);
    }

    const nodeLatency = Math.round(500 + Math.random() * 4500 * (passed ? 1 : 2));
    totalSimulatedLatencyMs += nodeLatency + resourceContention.reduce((s, c) => s + c.waitTimeMs, 0);

    nodeResults.push({
      nodeId,
      passed,
      simulatedLatencyMs: nodeLatency,
      retryCount,
      failureReason,
      cascadeFailures: [],
      resourceContention,
    });
  }

  for (const nr of nodeResults) {
    if (!nr.passed) {
      findDownstreamNodes(nr.nodeId, nodes, topoOrder, nodeResults);
    }
  }

  const passedNodes = nodeResults.filter(n => n.passed).length;
  const failedNodeCount = nodeResults.filter(n => !n.passed).length;
  const totalNodes = nodeResults.length;
  const survivalProbability = totalNodes > 0
    ? Math.max(0, Math.min(1,
      (passedNodes / totalNodes) * (1 - cascadeFailureCount / Math.max(totalNodes * 2, 1))
    ))
    : 0;

  const resourceBottlenecks: ResourceBottleneck[] = [];
  for (const [resourceId, info] of resourceLocks) {
    if (info.contentionCount > 1) {
      resourceBottlenecks.push({
        resourceId,
        contentionCount: info.contentionCount,
        avgWaitTimeMs: info.contentionCount > 0 ? info.waitTimeMs / info.contentionCount : 0,
      });
    }
  }

  const overallAssessment: IShadowSimulationReport['overallAssessment'] =
    survivalProbability >= 0.7 ? 'PASS'
      : survivalProbability >= 0.4 ? 'CONDITIONAL_PASS'
      : 'FAIL';

  return {
    simulationId,
    profileId: candidate.profileId,
    strategy: candidate.strategy,
    startedAt,
    completedAt: Date.now(),
    totalSimulatedLatencyMs,
    survivalProbability,
    nodeResults,
    passedNodes,
    failedNodes: failedNodeCount,
    cascadeFailureCount,
    resourceBottlenecks,
    simulatedExceptionTraces,
    overallAssessment,
  };
}

/**
 * averageSimulations — Average multiple ShadowContext runs into one report
 */
export function averageSimulations(
  ctx: PipelineStageContext,
  simulations: IShadowSimulationReport[],
  profileId: string,
  strategy: 'aggressive' | 'defensive' | 'fallback',
): IShadowSimulationReport {
  if (simulations.length === 0) {
    return {
      simulationId: `sim_avg_${profileId}`,
      profileId, strategy,
      startedAt: Date.now(), completedAt: Date.now(),
      totalSimulatedLatencyMs: 0, survivalProbability: 0,
      nodeResults: [], passedNodes: 0, failedNodes: 0,
      cascadeFailureCount: 0, resourceBottlenecks: [],
      simulatedExceptionTraces: [],
      overallAssessment: 'FAIL',
    };
  }

  const avgSurvival = simulations.reduce((s, r) => s + r.survivalProbability, 0) / simulations.length;
  const avgLatency = Math.round(simulations.reduce((s, r) => s + r.totalSimulatedLatencyMs, 0) / simulations.length);
  const avgPassed = Math.round(simulations.reduce((s, r) => s + r.passedNodes, 0) / simulations.length);
  const avgFailed = Math.round(simulations.reduce((s, r) => s + r.failedNodes, 0) / simulations.length);
  const avgCascade = Math.round(simulations.reduce((s, r) => s + r.cascadeFailureCount, 0) / simulations.length);

  return {
    simulationId: `sim_avg_${profileId}`,
    profileId, strategy,
    startedAt: Math.min(...simulations.map(r => r.startedAt)),
    completedAt: Date.now(),
    totalSimulatedLatencyMs: avgLatency,
    survivalProbability: avgSurvival,
    nodeResults: simulations[0].nodeResults,
    passedNodes: avgPassed,
    failedNodes: avgFailed,
    cascadeFailureCount: avgCascade,
    resourceBottlenecks: mergeBottlenecks(simulations),
    simulatedExceptionTraces: simulations.flatMap(r => r.simulatedExceptionTraces).slice(0, 20),
    overallAssessment: avgSurvival >= 0.7 ? 'PASS' : avgSurvival >= 0.4 ? 'CONDITIONAL_PASS' : 'FAIL',
  };
}

/**
 * mergeBottlenecks — Merge resource bottleneck info across runs
 */
export function mergeBottlenecks(simulations: IShadowSimulationReport[]): ResourceBottleneck[] {
  const merged = new Map<string, { contentionCount: number; waitTimeMs: number }>();
  for (const sim of simulations) {
    for (const b of sim.resourceBottlenecks) {
      const existing = merged.get(b.resourceId) ?? { contentionCount: 0, waitTimeMs: 0 };
      existing.contentionCount += b.contentionCount;
      existing.waitTimeMs += b.avgWaitTimeMs * b.contentionCount;
      merged.set(b.resourceId, existing);
    }
  }
  return Array.from(merged.entries()).map(([resourceId, info]) => ({
    resourceId,
    contentionCount: info.contentionCount,
    avgWaitTimeMs: info.contentionCount > 0 ? info.waitTimeMs / info.contentionCount : 0,
  }));
}
