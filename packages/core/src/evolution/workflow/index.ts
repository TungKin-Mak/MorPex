/**
 * evolution/workflow — Workflow Evolution Engine Barrel
 *
 * Phase 5 / MorPex v8.5
 */

export { WorkflowMiner } from './WorkflowMiner.js';
export { WorkflowRegistry } from './WorkflowRegistry.js';
export { WorkflowOptimizer } from './WorkflowOptimizer.js';
export { WorkflowExecutor } from './WorkflowExecutor.js';
export { WorkflowSimulator } from './WorkflowSimulator.js';

// ── v8.8 Workflow Contract ──
export { ContractValidator } from './contract/index.js';
export type {
  WorkflowContract,
  ContractValidationResult,
} from './contract/index.js';

// ── v8.8 Workflow Testing ──
export { WorkflowTestRunner } from './testing/index.js';
export type {
  WorkflowTestCase,
  WorkflowTestResult,
  WorkflowTestSuiteResult,
} from './testing/index.js';

// ── v8.8 Artifact Lineage ──
export { ArtifactLineage } from './lineage/index.js';
export type {
  ArtifactNode,
  ArtifactEdge,
  LineageQuery,
  LineagePath,
} from './lineage/index.js';

export type {
  WorkflowStatus,
  WorkflowVersion,
  WorkflowStepDef,
  VersionPerformance,
  RegisteredWorkflow,
  WorkflowCandidate,
  EvolutionReport,
  ExecutionResult,
  OptimizationPlan,
  SimulationResult,
  SimulationMetrics,
  SimulatorConfig,
  WorkflowSimulationContext,
  WorkflowFailureMode,
} from './types.js';
