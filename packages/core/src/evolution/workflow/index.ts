/**
 * evolution/workflow — Workflow Evolution Engine Barrel
 *
 * Phase 5 / MorPex v8.5
 *
 * ⚠️ P2 边界说明（勿使 L7 变成第二个工作流引擎）：
 *   本目录负责「工作流工件」的注册/校验/执行/仿真/优化（Registry/Simulator/Optimizer/Executor/Contract），
 *   是 L7 演化层的【工件承载子域】，不是独立的演化流水线。
 *   「核心演化流水线」是事件驱动的单轨：ActiveEvolutionTrigger（消费 L6 事件）
 *   → SelfImprovementLoop（只产 pending 提案）→ EvolutionSandbox.approveAndApply（Gate 硬校验晋升）。
 *   工作流工件若需晋升，必须经该核心流水线；本目录不得自行触发生产变更或绕过 Gate。
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
