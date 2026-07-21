/**
 * cognition — MorPex Cognitive Layer Barrel
 *
 * Phase 5-6 / MorPex v8: 认知层模块统一入口。
 *
 * 子模块：
 *   cognition/twin/    — Personal Twin Graph（用户孪生图谱）
 *   cognition/memory/  — Personal Brain（五层记忆体系）
 *
 * 后续 Phase 将在此进一步扩展：
 *   cognition/decision/   — Decision Twin（决策孪生）
 *   cognition/workflow/   — Workflow Intelligence（工作流智能）
 */

// ── Personal Twin Graph ──
export { PersonalTwinGraph } from './twin/index.js';

// ── Behavior Twin (Phase 2 / v8.6) ──
export { BehaviorTwin } from './twin/BehaviorTwin.js';
export type { BehaviorProfile, VersionHistoryEntry, TwinVersion } from './twin/BehaviorTwin.js';

// ── Preference Model (Phase 2 / v8.5) ──
export { PreferenceModel } from './twin/PreferenceModel.js';
export type { Preference, PreferenceCategory, PreferenceStrength, PreferenceProfile } from './twin/PreferenceModel.js';

// ── Planner Constraint (Phase 2 / v8.5) ──
export { buildPlannerConstraint } from './twin/PlannerConstraint.js';
export type { PlannerConstraint } from './twin/PlannerConstraint.js';
export type {
  TwinNodeType,
  TwinEdgeType,
  TwinNode,
  TwinEdge,
  UserProperties,
  GoalProperties,
  ProjectProperties,
  DecisionProperties,
  PreferenceProperties,
  WorkflowProperties,
  ExperienceProperties,
  TwinQuery,
  TwinStats,
  DecisionProfile,
  SubgraphResult,
  TwinInsight,
} from './twin/index.js';

// ── Personal Brain (Phase 6) ──
export { PersonalBrain, WorkflowMemory, DecisionMemory, BrainPersistor } from './memory/index.js';
export type {
  MemoryLayer,
  MemoryEntry,
  MemoryQuery,
  MemoryQueryResult,
  BrainStats,
  WorkflowMemoryEntry,
  DecisionMemoryEntry,
  PreferenceMemoryEntry,
} from './memory/index.js';
export { ALL_LAYERS, LAYER_TTL } from './memory/index.js';

// ── Workflow Intelligence (Phase 7) ──
export { WorkflowIntelligence } from './workflow/index.js';
export type {
  WorkflowPattern,
  WorkflowStep,
  OptimizationSuggestion,
  AutomationAssessment,
  IntelligenceReport,
} from './workflow/index.js';

// ── Decision Twin (P1 架构完善) ──
export { DecisionTwin } from './decision/index.js';
export type {
  DecisionProfile as DecisionTwinProfile,
  FactorSummary,
  DecisionAnalysis,
  DecisionPrediction,
  OutcomeRecord,
  FactorCorrelation,
  DecisionPath,
  BiasReport,
  DetectedBias,
  OutcomeFeedbackStats,
} from './decision/index.js';

// ── Goal Plane (Phase 1 / v8.5) ──
export { GoalManager, GoalGraph } from './goal/index.js';
export type {
  Goal,
  GoalStatus,
  GoalLevel,
  Objective,
  KeyResult,
  GoalGraphNode,
  GoalCreateInput,
  GoalStats,
} from './goal/index.js';
