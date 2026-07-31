/**
 * @deprecated Brain 模块已合并到 cognition/ 层。
 * 请统一从 '@morpex/core/cognition' 或 packages/core/src/cognition/index.js 导入。
 * 此文件仅保留向后兼容，将在未来版本移除。
 */

export { ReflectionEngine } from './ReflectionEngine.js';
export type { BrainReflectionState, BrainReflectionResult, ReflectionEngineLike } from './ReflectionEngine.js';

export { MetaLearner } from './MetaLearner.js';
export type { TaskRecord, UserFeedback, LearningResult, MetaLearnerLike } from './MetaLearner.js';

export { SelfImprovementLoop } from './SelfImprovementLoop.js';
export { ImprovementAnalyzer } from './ImprovementAnalyzer.js';
export { EvolutionProposal } from './EvolutionProposal.js';
export { SafetyMonitor } from './SafetyMonitor.js';
export type { ImprovementInsight } from './ImprovementAnalyzer.js';
export type { Proposal } from './EvolutionProposal.js';
export type { Observation } from './SafetyMonitor.js';

// ── v16+ 新增 ──
export { CrossDepartmentKnowledgeSynthesizer } from './CrossDepartmentKnowledgeSynthesizer.js';
export type {
  SynthesisCandidate,
  SynthesisResult,
  MigrationResult,
  CrossDeptSynthesisStats,
  MemoryWikiQueryLike,
  MetaLearnerPatternLike,
  BehaviorTwinCompareLike,
} from './CrossDepartmentKnowledgeSynthesizer.js';
