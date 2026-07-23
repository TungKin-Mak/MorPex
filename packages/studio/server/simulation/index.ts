/**
 * Simulation Twin — 导出入口
 *
 * MorPex v10: 导出所有公共类型、类和工厂函数。
 */

export { SimulationEngine } from './simulation-engine.js';
export { SimulationTwin } from './simulation-twin.js';
export { PlanSimulator } from './plan-simulator.js';
export type { PlanSimulationOutput } from './plan-simulator.js';
export { CostEstimator } from './cost-estimator.js';
export { RiskPredictor } from './risk-predictor.js';
export { SuccessPredictor } from './success-predictor.js';
export { ExecutionPredictor } from './execution-predictor.js';
export type { ExecutionPrediction } from './execution-predictor.js';

export type {
  SimulationTwinProfile,
  SimilarMission,
  SimulationResult,
  RiskFactor,
  SimulationConfig,
  CostEstimate,
  CostBreakdownItem,
  RiskPrediction,
  SuccessPrediction,
} from './types.js';
