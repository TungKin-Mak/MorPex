/**
 * Reliability Plane — v8.9.2 可靠性层 (横切质量保障)
 *
 * 定位: 与 Control Plane 并列的横切质量保障层。
 *   类似 Kubernetes Operator / SRE Platform / CI/CD Pipeline。
 *
 * 横切范围: Runtime / Workflow / Memory / Evolution
 *
 * 包含:
 *   - Chaos Testing: 混沌工程，验证系统在故障下的行为
 *   - Replay: 事件流回放 (确定性重放)，用于调试和回归
 *   - Scoring: 可靠性评分 + ProductionScore = Q × R × S
 *   - Regression: 金数据集回归测试 (correctness/recovery/decision)
 *   - Promotion: 工作流晋升管道 (DRAFT→SIMULATED→TESTED→APPROVED→CANARY→PRODUCTION)
 *   - Report: 生产就绪证明 (ReliabilityReport)
 */

// ── Chaos ──
export { ChaosEngine, FaultInjector, BUILTIN_SCENARIOS } from './chaos/index.js'
export type { FailureScenario as FailureScenarioType } from './chaos/index.js'
export type { ChaosTestResult, InjectionResult, ChaosReport } from './chaos/index.js'

// ── Replay ──
export { ReplayEngine, EventReplayer } from './replay/index.js'
export type { ReplayState, ReplayComparison, DeterministicReplayContext } from './replay/index.js'

// ── Scoring ──
export { ReliabilityScorer, computeProductionScore, computeSafetyScore } from './scoring/index.js'
export type { ReliabilityMetrics } from './scoring/index.js'

// ── Regression ──
export { GoldenDatasetManager, RegressionRunner } from './regression/index.js'
export type { GoldenDataset, GoldenTestCase, GoldenTestCategory, RegressionReport, RegressionResult } from './regression/index.js'

// ── Promotion ──
export { WorkflowPromotion, WorkflowLifecycleStatus } from './promotion/index.js'
export type { WorkflowLifecycleEntry, CanaryConfig, CanaryMetrics } from './promotion/index.js'

// ── Report (v8.9.2) ──
export { ReliabilityReporter } from './ReliabilityReport.js'
export type { ReliabilityReport, ProductionVerdict } from './ReliabilityReport.js'
