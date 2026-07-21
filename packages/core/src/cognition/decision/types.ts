/**
 * Decision Twin — 类型定义
 *
 * P1 架构完善: 用户决策模式的数据模型。
 */

/** 决策画像 — 聚合的用户决策模式 */
export interface DecisionProfile {
  /** 用户 ID */
  userId: string;
  /** 信心指数 (0-1)：对用户了解程度 */
  confidence: number;
  /** 风险偏好 */
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  /** 常见决策因素（按权重排序） */
  commonFactors: FactorSummary[];
  /** 近期决策数量 */
  recentDecisions: number;
  /** 决策一致性 (0-1) */
  consistency: number;
  /** 最后更新时间 */
  lastUpdated: number;
}

/** 决策因素摘要 */
export interface FactorSummary {
  /** 因素名称（如 'team_familiarity', 'cost', 'performance'） */
  name: string;
  /** 权重 (0-1)：在用户决策中的重要性 */
  weight: number;
  /** 频率：被考虑的次数 */
  frequency: number;
  /** 趋势 */
  trend: 'stable' | 'increasing' | 'decreasing';
}

/** 决策分析结果 */
export interface DecisionAnalysis {
  /** 决策上下文 */
  context: string;
  /** 推荐选择 */
  recommendation: string;
  /** 信心指数 (0-1) */
  confidence: number;
  /** 相似历史决策 */
  similarDecisions: Array<{
    context: string;
    chosen: string;
    outcome?: string;
  }>;
  /** 风险评估 */
  riskAssessment: 'low' | 'medium' | 'high';
  /** 建议考虑的因素 */
  suggestedFactors: string[];
}

/** 决策预测结果 */
export interface DecisionPrediction {
  /** 决策上下文 */
  context: string;
  /** 可选项 */
  options: string[];
  /** 预测的选择 */
  predictedChoice: string;
  /** 信心指数 (0-1) */
  confidence: number;
  /** 预测理由 */
  reasoning: string;
  /** 各选项评分 */
  alternatives: Array<{
    option: string;
    score: number;
    reason: string;
  }>;
  /** 置信区间 (v8.5) */
  confidenceInterval?: {
    lower: number;
    upper: number;
    confidenceLevel: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// v8.5 Phase 3: Outcome Tracking
// ═══════════════════════════════════════════════════════════════

/** 决策结果记录 */
export interface OutcomeRecord {
  context: string;
  chosen: string;
  actualOutcome: string;
  success: boolean;
  recordedAt: number;
  relatedFactors: string[];
}

/** 结果反馈统计 */
export interface OutcomeFeedbackStats {
  totalOutcomes: number;
  successRate: number;
  byOption: Record<string, { total: number; success: number; rate: number }>;
}

// ═══════════════════════════════════════════════════════════════
// v8.5 Phase 3: Factor Correlation
// ═══════════════════════════════════════════════════════════════

/** 因素相关性分析 */
export interface FactorCorrelation {
  factorA: string;
  factorB: string;
  correlation: number;
  cooccurrenceCount: number;
  strength: 'weak' | 'moderate' | 'strong';
}

/** 决策路径（选择→结果） */
export interface DecisionPath {
  context: string;
  choice: string;
  outcome?: string;
  success?: boolean;
  frequency: number;
}

// ═══════════════════════════════════════════════════════════════
// v8.5 Phase 3: Bias Detection
// ═══════════════════════════════════════════════════════════════

/** 偏差检测报告 */
export interface BiasReport {
  biases: DetectedBias[];
  overallBiasScore: number;
  recommendations: string[];
}

/** 检测到的偏差 */
export interface DetectedBias {
  type: 'status_quo' | 'recency' | 'overconfidence' | 'anchoring' | 'confirmation';
  description: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;
  affectedDecisions: number;
}
