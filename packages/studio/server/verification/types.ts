/**
 * Behavior Verification Engine — 类型定义
 *
 * MorPex v10: 行为验证引擎的类型系统。
 * 与现有 VerificationEngine (runtime/verification/) 不同，本引擎专注于
 * 预期轨迹 vs 运行时轨迹的比对，而非执行结果检查。
 */

// ═══════════════════════════════════════════════════════════════
// Expected Trace（预期轨迹）
// ═══════════════════════════════════════════════════════════════

/** ExpectedTrace — 从 MissionPlan 构建的预期执行轨迹 */
export interface ExpectedTrace {
  missionId: string;
  steps: ExpectedStep[];
  timingConstraints?: TimingConstraints;
  qualityThresholds?: QualityThresholds;
}

export interface ExpectedStep {
  stepId: string;
  name: string;
  expectedInput?: Record<string, unknown>;
  expectedOutput?: Record<string, unknown>;
  constraints?: string[];
  maxDuration?: number; // 最大执行时长（毫秒）
}

export interface TimingConstraints {
  maxDurationMs: number;
  maxStepDurationMs: number;
}

export interface QualityThresholds {
  minScore: number;
  requiredChecks: string[];
}

// ═══════════════════════════════════════════════════════════════
// Runtime Trace（运行时轨迹）
// ═══════════════════════════════════════════════════════════════

/** RuntimeTrace — 从执行日志构建的实际运行轨迹 */
export interface RuntimeTrace {
  missionId: string;
  steps: RuntimeStep[];
  totalDuration: number;
  error?: string;
}

export interface RuntimeStep {
  stepId: string;
  actualInput?: Record<string, unknown>;
  actualOutput?: Record<string, unknown>;
  duration: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// Comparison Result（比对结果）
// ═══════════════════════════════════════════════════════════════

export interface ComparisonResult {
  stepId: string;
  name: string;
  completeness: number;  // 0-1 — 步骤完成度
  accuracy: number;      // 0-1 — 输出准确度
  efficiency: number;    // 0-1 — 执行效率
  /** 蓝图 §6: 策略合规性 (0-1)，可选降级为 1 */
  policy?: number;
  /** 蓝图 §6: 产物质量 (0-1)，可选降级为 1 */
  artifactQuality?: number;
  /** 蓝图 §6: 恢复能力 (0-1)，可选降级为 1 */
  recovery?: number;
  issues: string[];
  matched: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Quality Score（质量评分）
// ═══════════════════════════════════════════════════════════════

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface QualityScore {
  missionId: string;
  score: number;       // 0-100
  grade: Grade;
  details: {
    /** 蓝图 §6 五维维度分 */
    executionCorrectnessScore: number;
    policyComplianceScore: number;
    artifactQualityScore: number;
    efficiencyScore: number;
    recoveryCapabilityScore: number;
    stepScores: ComparisonResult[];
  };
}

// ═══════════════════════════════════════════════════════════════
// Violation（违规/偏差）
// ═══════════════════════════════════════════════════════════════

export type ViolationType =
  | 'INPUT_MISMATCH'
  | 'OUTPUT_MISMATCH'
  | 'TIMEOUT'
  | 'MISSING_STEP'
  | 'UNEXPECTED_STEP'
  | 'QUALITY_VIOLATION';

export type ViolationSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface Violation {
  type: ViolationType;
  stepId: string;
  severity: ViolationSeverity;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// Verification Report（验证报告）
// ═══════════════════════════════════════════════════════════════

export interface VerificationReport {
  missionId: string;
  score: number;
  grade: Grade;
  violations: Violation[];
  comparisonResults: ComparisonResult[];
  qualityScore: QualityScore;
  duration: number;
  recordedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// Regression Store（回归存储）
// ═══════════════════════════════════════════════════════════════

export interface VerificationRecord {
  id: string;
  missionId: string;
  score: number;
  grade: string;
  violations: string;  // JSON stringified array
  recordedAt: number;
}

export interface RegressionQuery {
  missionId?: string;
  startTime?: number;
  endTime?: number;
  grade?: Grade;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════
// Engine Config
// ═══════════════════════════════════════════════════════════════

export interface BehaviorVerificationConfig {
  executionCorrectnessWeight?: number;
  policyComplianceWeight?: number;
  artifactQualityWeight?: number;
  efficiencyWeight?: number;
  recoveryCapabilityWeight?: number;
  dbPath?: string;
  enableAutoRecord?: boolean;
}
