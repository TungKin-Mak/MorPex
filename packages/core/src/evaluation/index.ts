// L6 Evaluation 评价层
export { EvaluationEngine } from './EvaluationEngine.js';
export { QualityScorer } from './QualityScorer.js';
export type { ScoreReport, SystemScore } from './QualityScorer.js';
export type { EvaluationInput, EvaluationReport } from './EvaluationEngine.js';
export { scoreOntologyCompliance } from './ontologyCompliance.js';
export type { OntologyComplianceScore } from './ontologyCompliance.js';
export { scoreLineageHealth } from './lineageCompliance.js';
export type { LineageHealthScore } from './lineageCompliance.js';
export type { EvaluationScoredPayload, EvaluationEngineOptions } from './EvaluationEngine.js';

// ── L6 验证子域（Wave 8a：自 governance/ 迁入）──
export { VerificationEngine } from './verification/VerificationEngine.js';
export { QualityRule } from './verification/QualityRule.js';
export type { QualityCheck } from './verification/QualityRule.js';
export { ArtifactChecker } from './verification/ArtifactChecker.js';
export type { CheckResult } from './verification/ArtifactChecker.js';
export { ExecutionVerifier } from './verification/ExecutionVerifier.js';
export type { VerificationResult } from './verification/ExecutionVerifier.js';
export { RepairPlanner } from './verification/RepairPlanner.js';
export type { RepairPlan } from './verification/RepairPlanner.js';
