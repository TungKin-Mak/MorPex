/**
 * Behavior Verification Engine — 导出入口
 *
 * MorPex v10: 导出所有公共类型、类和工厂函数。
 */

export { BehaviorVerificationEngine } from './behavior-verification-engine.js';
export { ExpectedTraceBuilder } from './expected-trace-builder.js';
export { TraceComparator } from './trace-comparator.js';
export { QualityScoreEngine } from './quality-score.js';
export { ViolationDetector } from './violation-detector.js';
export { RegressionStore } from './regression-store.js';

export type {
  // 核心类型
  ExpectedTrace,
  ExpectedStep,
  TimingConstraints,
  QualityThresholds,
  RuntimeTrace,
  RuntimeStep,
  ComparisonResult,
  QualityScore,
  Violation,
  ViolationType,
  ViolationSeverity,
  VerificationReport,
  Grade,
  // 存储类型
  VerificationRecord,
  RegressionQuery,
  // 配置
  BehaviorVerificationConfig,
} from './types.js';
