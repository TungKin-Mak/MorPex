/**
 * Simulation Twin — 类型定义
 *
 * MorPex v10: 仿真孪生的类型系统。
 * Simulation Twin 在执行前预测执行质量，帮助决定批准/拒绝。
 */

// ═══════════════════════════════════════════════════════════════
// 核心类型
// ═══════════════════════════════════════════════════════════════

export interface SimulationTwinProfile {
  twinId: string;
  missionId: string;
  goal: string;
  /** 相似历史 Mission 列表 */
  similarMissions: SimilarMission[];
  /** 历史成功率 (0-1) */
  historicalSuccessRate: number;
  /** 历史平均耗时 (ms) */
  historicalAvgDuration: number;
  /** 历史平均成本 */
  historicalAvgCost: number;
  /** 建议风险等级 */
  suggestedRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 最近执行时间 */
  lastExecutedAt?: number;
}

export interface SimilarMission {
  missionId: string;
  goal: string;
  similarity: number;  // 0-1
  success: boolean;
  duration: number;
  score: number;
}

// ═══════════════════════════════════════════════════════════════
// 仿真结果
// ═══════════════════════════════════════════════════════════════

export interface SimulationResult {
  missionId: string;
  twinId: string;
  /** 仿真状态 */
  status: 'simulated' | 'pending' | 'failed';
  /** 预测成功率 (0-100) */
  successProbability: number;
  /** 预测成本 */
  expectedCost: number;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 预测耗时 (ms) */
  estimatedDuration: number;
  /** 置信度 (0-1) */
  confidence: number;
  /** 风险因子 */
  riskFactors: RiskFactor[];
  /** 建议 */
  suggestion: 'approve' | 'reject' | 'review';
  /** 仿真时间 */
  simulatedAt: number;
}

export interface RiskFactor {
  name: string;
  score: number;  // 0-100
  weight: number;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

export interface SimulationConfig {
  /** 相似 Mission 匹配阈值 */
  similarityThreshold?: number;
  /** 最大参考 Mission 数 */
  maxReferenceMissions?: number;
  /** 默认最大耗时 (ms) */
  defaultMaxDuration?: number;
  /** 成本系数 */
  costMultiplier?: number;
  /** 风险权重 */
  riskWeights?: {
    complexity: number;
    duration: number;
    history: number;
    goal: number;
  };
}

export interface CostEstimate {
  estimatedCost: number;
  currency: string;
  breakdown: CostBreakdownItem[];
  confidence: number;
}

export interface CostBreakdownItem {
  category: string;
  amount: number;
  description: string;
}

export interface RiskPrediction {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  factors: RiskFactor[];
  mitigations: string[];
}

export interface SuccessPrediction {
  probability: number;  // 0-100
  confidence: number;   // 0-1
  factors: { name: string; impact: number; detail: string }[];
}
