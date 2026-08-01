/**
 * runtime/cognitive-loop — 认知运行时循环 Barrel
 *
 * Phase 6 / MorPex v8.5
 * v8.6: 新增 CognitivePipeline + CognitiveStage 接口 + 8 个阶段
 */

export { CognitiveLoop } from './CognitiveLoop.js';
export { CognitivePipeline } from './CognitivePipeline.js';
export type { CognitiveStage } from './CognitivePipeline.js';
export type {
  CognitiveContext,
  CognitivePhase,
  DetectedIntent,
  LoopStats,
  WorkflowCandidateEntry,
  BehaviorDriftEntry,
  TwinCandidate,
  EvidenceAggregation,
} from './types.js';

// ── v8.6: Pipeline Stages (v9.1: +ContextStage) ──
export {
  ContextStage,
  IntentStage,
  GoalStage,
  TwinStage,
  PlanningStage,
  ExecutionStage,
  LearningStage,
  EvolutionStage,
  PersistenceStage,
} from './stages/index.js';
