/**
 * evolution/workflow — Workflow Evolution Engine Barrel
 *
 * Phase 5 / MorPex v8.5
 */

export { WorkflowRegistry } from './WorkflowRegistry.js';
export { WorkflowSimulator } from './WorkflowSimulator.js';
export { WorkflowOptimizer } from './WorkflowOptimizer.js';
export { WorkflowExecutor } from './WorkflowExecutor.js';

// ── v8.8 Workflow Contract ──
export { ContractValidator } from './contract/index.js';
export type {
  WorkflowContract,
  ContractValidationResult,
} from './contract/index.js';

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
