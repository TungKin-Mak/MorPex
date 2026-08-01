/**
 * PipelineStageContext — Shared dependencies for all 7 pipeline stage functions
 *
 * Each stage function receives this context object instead of relying on `this`,
 * making stages independently testable and composable.
 *
 * @see PipelineExecutor.ts — creates this context via getStageContext()
 */

import type { PlanExperienceStore } from '../../PlanExperienceStore.js';
import type { PlanAnalyzer } from '../../PlanAnalyzer.js';
import type { DeviationGuard } from '../../guards/DeviationGuard.js';
import type { TopologyExplorer } from '../../engines/TopologyExplorer.js';
import type { HierarchicalCandidateGenerator, StatisticalPlanSimulator, WeightedPlanEvaluator } from '../../engines/HierarchicalPlanningEngine.js';
import type { PipelineLogger } from '../../PipelineLogger.js';
import type { MemoryWiki, MemoryRetriever, JSONLWriter } from '../../../../adapters/memory/index.js';
import type { DEFAULT_DES_CONFIG } from '../../types.js';
import type { SemanticTag } from '../../types.js';
import type { KnowledgeGraph } from '../../../../metadata/knowledge/KnowledgeGraph.js';
import type { ArtifactRegistry } from '../../../../artifact/registry/ArtifactRegistry.js';

/** 向量存储结构接口（zvec 已废弃移除；保留结构以兼容可选注入） */
export interface VectorStoreLike {
  search(text: string, topK: number): Promise<string[]>;
}

export interface PipelineStageContext {
  pipelineLogger: PipelineLogger;
  modelRegistry: Record<string, unknown>;
  desConfig: typeof DEFAULT_DES_CONFIG;
  store: PlanExperienceStore;
  knowledgeGraph: KnowledgeGraph;
  vectorStore: VectorStoreLike | null;
  topologyExplorer: TopologyExplorer | null;
  analyzer: PlanAnalyzer;
  deviationGuard: DeviationGuard;
  traceLogPath: string;
  artifactRegistry: ArtifactRegistry;
  memoryBus: Record<string, unknown>;
  wiki: MemoryWiki | null;
  memoryRetriever: MemoryRetriever | null;
  hierarchicalPlanner: {
    candidateGenerator: HierarchicalCandidateGenerator;
    simulator: StatisticalPlanSimulator;
    evaluator: WeightedPlanEvaluator;
  } | null;
  memoryContext: string;
  traceWriter: JSONLWriter | null;
  decisionWriter: JSONLWriter | null;
  categorizeTag: (tag: string) => SemanticTag['category'];
}
