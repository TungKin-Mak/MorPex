/**
 * Workflow Intelligence — 类型定义
 *
 * Phase 7 / MorPex v8: 工作流智能引擎数据类型。
 *
 * 四大能力：
 *   1. Pattern Detection — 重复行为模式检测
 *   2. Workflow Extraction — 从 Mission 历史提取流程
 *   3. Workflow Optimization — 流程优化建议
 *   4. Automation Assessment — 自动化成熟度评估
 */

// ── WorkflowPattern — 检测到的工作流模式 ──

export interface WorkflowPattern {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  frequency: number;
  firstSeen: number;
  lastSeen: number;
  domains: string[];
  confidence: number;
  sourceMissions: string[];
}

// ── WorkflowStep — 工作流步骤 ──

export interface WorkflowStep {
  name: string;
  description: string;
  domain: string;
  agentType: string;
  order: number;
  optional: boolean;
  averageDuration?: number;
}

// ── OptimizationSuggestion — 优化建议 ──

export interface OptimizationSuggestion {
  type: 'reorder' | 'merge' | 'parallelize' | 'remove' | 'add';
  description: string;
  affectedSteps: string[];
  rationale: string;
  confidence: number;       // 0-1
}

// ── AutomationAssessment — 自动化成熟度评估 ──

export interface AutomationAssessment {
  workflowId: string;
  isReady: boolean;
  score: number;             // 0-100
  reasons: string[];
  missingRequirements: string[];
  suggestedApprovalLevel: 'none' | 'low' | 'medium' | 'high';
}

// ── IntelligenceReport — 综合报告 ──

export interface IntelligenceReport {
  patternsFound: number;
  workflowsExtracted: number;
  optimizationsSuggested: number;
  automatableWorkflows: number;
  timestamp: number;
}
