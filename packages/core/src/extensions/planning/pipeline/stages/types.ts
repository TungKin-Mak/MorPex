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
import type { KnowledgeGraph } from '../../../../planes/knowledge-plane/knowledge/KnowledgeGraph.js';
import type { ArtifactRegistry } from '../../../../planes/knowledge-plane/artifacts/ArtifactRegistry.js';
import type { VectorStore } from '../../../../planes/knowledge-plane/memory/VectorStore.js';

export interface PipelineStageContext {
  pipelineLogger: PipelineLogger;
  modelRegistry: Record<string, unknown>;
  desConfig: typeof DEFAULT_DES_CONFIG;
  store: PlanExperienceStore;
  knowledgeGraph: KnowledgeGraph;
  vectorStore: VectorStore;
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
