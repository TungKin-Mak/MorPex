/**
 * MetaPlannerEngines — MetaPlanner engine initialization helpers
 *
 * Extracted from MetaPlanner constructor to reduce file size and clarify
 * the engine composition pattern. This module contains all engine creation,
 * configuration, and wiring logic.
 *
 * @see MetaPlanner.ts — consumer of this module
 */

import { PlanExperienceStore } from '../PlanExperienceStore.js';
import { PlanAnalyzer } from '../PlanAnalyzer.js';
import { ToolQualityManager, DEFAULT_TOOL_QUALITY_CONFIG, type DegradationAlert, type ToolQualityConfig } from '../ToolQualityManager.js';
import { TemplateManager, EvolutionType, DEFAULT_EVOLUTION_CONFIG, type TemplateLineage, type TemplateFrontmatter } from '../TemplateManager.js';
import { RuntimeController } from '../RuntimeController.js';
import { DeviationGuard } from '../guards/DeviationGuard.js';
import { V1CapabilityAdapter } from '../engines/V1CapabilityAdapter.js';
import { StrategicDeconstructor } from '../engines/StrategicDeconstructor.js';
import { LookAheadSimulator } from '../engines/LookAheadSimulator.js';
import { DynamicReflexEngine } from '../engines/DynamicReflexEngine.js';
import { TopologyExplorer } from '../engines/TopologyExplorer.js';
import { SessionErrorExtractor } from '../SessionErrorExtractor.js';
// PlanningIntelligenceEngine created by caller (needs MetaPlanner `this` reference)
import { HierarchicalCandidateGenerator, StatisticalPlanSimulator, WeightedPlanEvaluator } from '../engines/HierarchicalPlanningEngine.js';
import { PipelineExecutor, type PipelineDeps } from '../pipeline/PipelineExecutor.js';
import { PipelineLogger } from '../PipelineLogger.js';
import type { MetaPlannerConfig, MetaPlannerV2Config, IPlanningExtension } from '../types.js';
import { DEFAULT_META_PLANNER_CONFIG, DEFAULT_META_PLANNER_V2_CONFIG, DEFAULT_DES_CONFIG } from '../types.js';
import { MemoryWiki, MemoryRetriever } from '../../../adapters/memory/index.js';
import type { PlanningIntelligenceEngine } from '../PlanningIntelligenceEngine.js';
import * as path from 'node:path';

// ── Engine Context Object (return type) ──

export interface MetaPlannerEngineContext {
  store: PlanExperienceStore;
  analyzer: PlanAnalyzer;
  deviationGuard: DeviationGuard;
  v1Adapter: V1CapabilityAdapter;
  strategicDeconstructor: StrategicDeconstructor | null;
  lookAheadSimulator: LookAheadSimulator | null;
  dynamicReflexEngine: DynamicReflexEngine | null;
  topologyExplorer: TopologyExplorer | null;
  toolQuality: ToolQualityManager;
  templateManager: TemplateManager;
  sessionErrorExtractor: SessionErrorExtractor;
  planningIntelligence: PlanningIntelligenceEngine | null;
  pipelineLogger: PipelineLogger;
  pipeline: PipelineExecutor;
  extensions: IPlanningExtension[];
  hierarchicalPlanner: {
    candidateGenerator: HierarchicalCandidateGenerator;
    simulator: StatisticalPlanSimulator;
    evaluator: WeightedPlanEvaluator;
  };
}

/**
 * setupMetaPlannerEngines — Create all MetaPlanner subsystem engines
 *
 * Extracted from the MetaPlanner constructor for:
 *   1. Testability — engines can be created independently
 *   2. Readability — engine composition is visible as a single function
 *   3. Maintainability — adding/removing engines doesn't bloat the constructor
 *
 * @param config - MetaPlanner configuration
 * @param v2Config - MetaPlanner V2 configuration
 * @param externals - External dependencies (knowledgeGraph, memoryBus, etc.)
 * @returns All engines wired together, ready for MetaPlanner.initialize()
 */
export function setupMetaPlannerEngines(
  config: MetaPlannerConfig,
  v2Config: MetaPlannerV2Config,
  externals: {
    knowledgeGraph?: Record<string, unknown>;
    artifactRegistry?: Record<string, unknown>;
    vectorStore?: Record<string, unknown>;
    memoryBus?: Record<string, unknown> | null;
    dagEngine?: Record<string, unknown> | null;
    eventBus?: Record<string, unknown>;
    pipelineLogger?: PipelineLogger;
    modelRegistry?: Record<string, unknown>;
    desConfig?: Partial<typeof DEFAULT_DES_CONFIG>;
    wiki?: MemoryWiki;
    memoryRetriever?: MemoryRetriever;
  },
): MetaPlannerEngineContext {
  // ── Core stores ──
  const store = new PlanExperienceStore(config);
  const analyzer = new PlanAnalyzer(store);

  // ── Deviation guard ──
  const deviationGuard = new DeviationGuard({
    maxDeviationsPerSession: v2Config.maxDeviationCount,
    traceLogPath: v2Config.traceLogPath + 'deviation-traces.jsonl',
  });

  // ── Inject MemoryWiki into downstream components ──
  if (externals.wiki) {
    store.setWiki(externals.wiki);
    deviationGuard.setWiki(externals.wiki);
  }

  // ── Pipeline infrastructure ──
  const pipelineLogger = externals.pipelineLogger ?? new PipelineLogger({ traceLogPath: v2Config.traceLogPath });
  const resolvedDesConfig = { ...DEFAULT_DES_CONFIG, ...externals.desConfig };

  // ── v2.6 Session error extractor (planning intelligence created by caller) ──
  const sessionErrorExtractor = new SessionErrorExtractor();
  const planningIntelligence: PlanningIntelligenceEngine | null = null;

  // ── Inject MemoryWiki into v2.6 components ──
  if (externals.wiki) {
    sessionErrorExtractor.setWiki(externals.wiki);
  }

  // ── v2.6 Hierarchical planning engines ──
  const hierCandidates = new HierarchicalCandidateGenerator();
  const hierSimulator = new StatisticalPlanSimulator(store);
  const hierEvaluator = new WeightedPlanEvaluator();
  const hierarchicalPlanner = {
    candidateGenerator: hierCandidates,
    simulator: hierSimulator,
    evaluator: hierEvaluator,
  };

  // ── TopologyExplorer (always created, used by PipelineExecutor) ──
  const topologyExplorer = new TopologyExplorer({
    maxPermutations: 24,
    maxNodesForExploration: 7,
    simulationsPerVariant: 1,
  });

  // ── PipelineExecutor ──
  const pipelineDeps: PipelineDeps = {
    pipelineLogger,
    modelRegistry: externals.modelRegistry ?? null,
    desConfig: resolvedDesConfig,
    store,
    knowledgeGraph: externals.knowledgeGraph ?? null,
    vectorStore: externals.vectorStore ?? null,
    topologyExplorer,
    analyzer,
    deviationGuard,
    traceLogPath: v2Config.traceLogPath,
    artifactRegistry: externals.artifactRegistry ?? null,
    wiki: externals.wiki ?? null,
    memoryRetriever: externals.memoryRetriever ?? null,
    hierarchicalPlanner,
  };
  const pipeline = new PipelineExecutor(pipelineDeps);

  // ── Extensions list ──
  const extensions: IPlanningExtension[] = [];

  // v1 adapter
  const v1Adapter = new V1CapabilityAdapter({ store, analyzer, enabled: true });
  extensions.push(v1Adapter);

  // StrategicDeconstructor
  let strategicDeconstructor: StrategicDeconstructor | null = null;
  if (v2Config.enableStrategicDeconstructor) {
    strategicDeconstructor = new StrategicDeconstructor({
      knowledgeGraph: externals.knowledgeGraph,
      artifactRegistry: externals.artifactRegistry,
      enabled: true,
    });
    extensions.push(strategicDeconstructor);
  }

  // LookAheadSimulator
  let lookAheadSimulator: LookAheadSimulator | null = null;
  if (v2Config.enableLookAheadSimulator) {
    lookAheadSimulator = new LookAheadSimulator({
      vectorStore: externals.vectorStore,
      store,
      riskThreshold: v2Config.simulationRejectionThreshold,
      enabled: true,
    });
    extensions.push(lookAheadSimulator);
  }

  // DynamicReflexEngine
  let dynamicReflexEngine: DynamicReflexEngine | null = null;
  if (v2Config.enableDynamicReflexEngine) {
    dynamicReflexEngine = new DynamicReflexEngine({
      guard: deviationGuard,
      enabled: true,
    });
    extensions.push(dynamicReflexEngine);
  }

  // Sort by priority
  extensions.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  // ── v3.0 OpenSpace Fusion components ──
  const basePath = config.experienceStorePath ?? './data/planning';
  const templateManager = new TemplateManager(
    store,
    { useLLMForFix: false },
    path.join(basePath, 'templates'),
  );
  if (externals.wiki) {
    templateManager.setWiki(externals.wiki);
  }

  const toolQuality = new ToolQualityManager({
    storePath: path.join(basePath, 'tool-quality.jsonl'),
    autoFixOnDegradation: true,
  });
  if (externals.wiki) toolQuality.setWiki(externals.wiki);

  return {
    store,
    analyzer,
    deviationGuard,
    v1Adapter,
    strategicDeconstructor,
    lookAheadSimulator,
    dynamicReflexEngine,
    topologyExplorer,
    toolQuality,
    templateManager,
    sessionErrorExtractor,
    planningIntelligence,
    pipelineLogger,
    pipeline,
    extensions,
    hierarchicalPlanner,
  };
}
