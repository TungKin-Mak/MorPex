export { ExperienceExtractor } from './ExperienceExtractor.js';
export { PlanEvaluator } from './PlanEvaluator.js';
export { StrategyOptimizer } from './StrategyOptimizer.js';
export { TemplateEvolutionEngine } from './TemplateEvolutionEngine.js';
export { LearningLoop } from './LearningLoop.js';
export type { ExecutionRecord, Experience } from './ExperienceExtractor.js';
export type { PlanEvaluation } from './PlanEvaluator.js';
export type { OptimizationSuggestion } from './StrategyOptimizer.js';
export type { PlanTemplate, TemplateRecommendation } from './TemplateEvolutionEngine.js';

// ── Cross-Agent Learning（L4：原 agent/learning 归位）──
export { CrossAgentLearningEngine } from './agent/index.js';
export { ExperienceRepository } from './agent/index.js';
export { KnowledgeDistiller } from './agent/index.js';
export { LearningPropagationService } from './agent/index.js';
export { ExperienceMatcher } from './agent/index.js';
export { ExperienceSqliteRepository } from './agent/index.js';
export type { GeneralizedExperience, ExperienceCategory, ExperienceQuery } from './agent/index.js';
