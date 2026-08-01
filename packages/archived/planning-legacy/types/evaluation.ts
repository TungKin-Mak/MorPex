import type { PlanTemplate } from './plan-templates.js';

// ═══════════════════════════════════════════════════════════════
// Section 3: 计划评估
// ═══════════════════════════════════════════════════════════════

/**
 * PlanEvaluation — 计划质量评估结果
 */
export interface PlanEvaluation {
  /** 评估 ID */
  evaluationId: string;

  /** 被评估的执行记录 ID */
  recordId: string;

  /** 执行 ID */
  executionId: string;

  /** 综合评分 (0-1) */
  overallScore: number;

  /** 各维度评分 */
  dimensions: PlanDimensionScores;

  /** 与前 N 次执行相比的变化趋势 */
  trendVsHistory: PlanTrend;

  /** 建议改进点 */
  suggestions: PlanSuggestion[];

  /** 评估时间 */
  evaluatedAt: number;
}

/**
 * PlanDimensionScores — 各维度评分
 */
export interface PlanDimensionScores {
  /** 成功率维度 (0-1) */
  successRate: number;

  /** 效率维度：耗时是否优于同类 (0-1) */
  efficiency: number;

  /** Token 经济性 (0-1) */
  tokenEconomy: number;

  /** 产物质量：产物是否被下游消费 (0-1) */
  artifactUtility: number;

  /** 鲁棒性：自愈成功率 (0-1) */
  robustness: number;

  /** 可复用性：模板化程度 (0-1) */
  reusability: number;
}

/**
 * PlanTrend — 趋势指标
 */
export interface PlanTrend {
  /** 评分趋势：improving | stable | declining */
  direction: 'improving' | 'stable' | 'declining';

  /** 变化幅度 */
  delta: number;

  /** 对比的基线记录数 */
  baselineCount: number;
}

/**
 * PlanSuggestion — 优化建议
 */
export interface PlanSuggestion {
  /** 建议类型 */
  type: 'add_node' | 'remove_node' | 'reorder' | 'change_domain' | 'add_validation' | 'reduce_parallelism' | 'increase_timeout' | 'switch_model';

  /** 目标节点角色 */
  targetNodeRole?: string;

  /** 建议描述 */
  description: string;

  /** 预期改善幅度 (0-1) */
  expectedImprovement: number;

  /** 置信度 (0-1) */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// Section 4: 计划匹配
// ═══════════════════════════════════════════════════════════════

/**
 * PlanMatchResult — 模板匹配结果
 */
export interface PlanMatchResult {
  /** 匹配到的模板 */
  template: PlanTemplate;

  /** 相似度分数 (0-1) */
  similarityScore: number;

  /** 匹配原因 */
  matchReasons: string[];

  /** 建议的参数调整 */
  suggestedAdjustments: PlanAdjustment[];
}

/**
 * PlanAdjustment — 参数调整建议
 */
export interface PlanAdjustment {
  /** 调整类型 */
  type: 'add_node' | 'remove_node' | 'modify_timeout' | 'change_domain' | 'add_dependency';

  /** 调整描述 */
  description: string;

  /** 目标节点角色 */
  targetRole: string;
}

