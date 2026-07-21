/**
 * Workflow Evolution Engine — 类型定义
 *
 * Phase 5 / MorPex v8.5: 工作流持续演化系统的数据模型。
 *
 * 与 cognition/workflow/ 的区别:
 *   cognition/workflow/ — 工作流智能: 模式检测、提取、优化建议 (一次性分析)
 *   evolution/workflow/ — 工作流演化: 持续挖掘、注册管理、版本化、自动执行 (生命周期)
 *
 * 生命周期:
 *   candidate (系统发现) → confirmed (用户确认) → active (自动执行) → deprecated (废弃)
 */

/** 工作流状态 */
export type WorkflowStatus = 'candidate' | 'confirmed' | 'active' | 'paused' | 'deprecated';

/** 工作流版本定义 */
export interface WorkflowVersion {
  /** 版本号 (从 1 开始递增) */
  version: number;
  /** 步骤定义 */
  steps: WorkflowStepDef[];
  /** 创建时间 */
  createdAt: number;
  /** 创建者 ('system' 或 userId) */
  createdBy: string;
  /** 变更说明 */
  changeDescription: string;
  /** 该版本的性能数据 */
  performance?: VersionPerformance;
}

/** 工作流步骤定义 */
export interface WorkflowStepDef {
  /** 步骤名称 */
  name: string;
  /** 步骤描述 (作为 Mission goal) */
  description: string;
  /** 执行领域 (用于 DomainDispatcher 路由) */
  domain: string;
  /** Agent 类型 ('coding' | 'research' | 'writing' | 'business') */
  agentType: string;
  /** 依赖的步骤 ID 列表 */
  deps: string[];
  /** 自定义配置 */
  config?: Record<string, unknown>;
  /** 超时时间 (ms) */
  timeoutMs?: number;
  /** 失败重试次数 */
  retryCount?: number;
}

/** 版本性能数据 */
export interface VersionPerformance {
  /** 平均执行时长 (ms) */
  avgDuration: number;
  /** 成功率 (0-1) */
  successRate: number;
  /** 执行次数 */
  executionCount: number;
  /** 最后执行时间 */
  lastExecutedAt?: number;
}

/** 已注册的正式工作流 */
export interface RegisteredWorkflow {
  /** 唯一标识 (wf_{timestamp}_{seq}) */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 当前状态 */
  status: WorkflowStatus;
  /** 当前版本号 */
  currentVersion: number;
  /** 所有历史版本 */
  versions: WorkflowVersion[];
  /** 来源 Mission ID 列表 (触发此工作流发现的 mission) */
  sourceMissions: string[];
  /** 总执行次数 */
  executionCount: number;
  /** 总体成功率 (0-1) */
  successRate: number;
  /** 平均执行时长 (ms) */
  avgDuration: number;
  /** 最后执行时间 */
  lastExecutedAt?: number;
  /** 最后优化时间 */
  lastOptimizedAt?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

/** 系统发现的候选工作流 */
export interface WorkflowCandidate {
  /** 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 步骤定义 */
  steps: WorkflowStepDef[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 来源 Mission ID */
  sourceMissionIds: string[];
  /** 发现时间 */
  detectedAt: number;
  /** 建议的执行频率 */
  suggestedFrequency: 'once' | 'occasional' | 'regular' | 'daily';
}

/** 演化报告 */
export interface EvolutionReport {
  /** 生成的候选数 */
  candidatesGenerated: number;
  /** 用户确认数 */
  workflowsConfirmed: number;
  /** 优化次数 */
  workflowsOptimized: number;
  /** 自动执行次数 */
  autoExecuted: number;
  /** 预估节省时间 (ms) */
  totalSavedTimeMs: number;
  /** 报告生成时间 */
  timestamp: number;
}

/** 执行结果 */
export interface ExecutionResult {
  /** 工作流 ID */
  workflowId: string;
  /** 对应的 Mission ID */
  missionId: string;
  /** 是否成功 */
  success: boolean;
  /** 执行时长 (ms) */
  duration: number;
  /** 输出 */
  output?: unknown;
  /** 错误信息 */
  error?: string;
}

/** 优化计划 */
export interface OptimizationPlan {
  /** 工作流 ID */
  workflowId: string;
  /** 优化建议列表 */
  suggestions: import('../../cognition/workflow/types.js').OptimizationSuggestion[];
  /** 预期改进百分比 */
  expectedImprovement: number;
  /** 风险等级 */
  risk: 'low' | 'medium' | 'high';
}

/** 模拟指标 */
export interface SimulationMetrics {
  /** 预测成功率 (0-1) */
  successRate: number;
  /** 预测平均执行时长 (ms) */
  avgDurationMs: number;
  /** 资源效率 (0-1, 越高越好) */
  resourceEfficiency: number;
  /** 预测错误率 (0-1, 越低越好) */
  errorRate: number;
  /** 步骤合理性 (0-1) */
  stepReasonableness: number;
}

/** 工作流失败模式分类 */
export interface WorkflowFailureMode {
  /** 失败模式名称 */
  name: string
  /** 出现次数 */
  count: number
  /** 占所有失败的比例 (0-1) */
  ratio: number
  /** 示例 Mission ID */
  exampleMissionId: string
}

/** 仿真上下文 — 提供给仿真引擎的外部约束 */
export interface WorkflowSimulationContext {
  workflowType: string           // 'coding' | 'finance' | 'writing' | 'research' | 'deployment' | 'general'
  riskTolerance: 'low' | 'medium' | 'high'
  historicalExecutions: number
  domainConstraints: string[]
}

/** 仿真结果 — v8.7 扩展: 不再只给单一 score，提供完整上下文供 PolicyEngine 决策 */
export interface SimulationResult {
  /** 候选工作流名称/ID */
  workflowId: string
  /** 候选工作流名称 */
  candidateName: string
  /** 参考的历史执行次数 */
  executions: number
  /** 预测成功率 (0-1) */
  successRate: number
  /** 失败模式列表（按原因分类） */
  failureModes: WorkflowFailureMode[]
  /** 预测平均延迟/执行时长 (ms) */
  avgLatency: number
  /** 资源消耗 (0-1, 越低越好) */
  resourceCost: number
  /** 风险评分 (0-100, 由 RiskAnalyzer 或内置检测产生) */
  riskScore: number
  /** 综合质量评分 (0-1) */
  qualityScore: number
  /** 仿真置信度 (0-1) */
  confidence: number
  /** 是否通过模拟 (默认 true; PolicyEngine 接管后此字段由策略决定) */
  passed: boolean
  /** 详细模拟指标 (保留向后兼容) */
  metrics: SimulationMetrics
  /** 改进建议 */
  recommendations: string[]
  /** 模拟耗时 (ms) */
  simulationDurationMs: number
  /** 参考的历史 Mission 数 */
  referenceMissions: number
}

/** 模拟配置 — 注意: 质量阈值已由 PolicyEngine 接管，此处仅保留仿真内部参数 */
export interface SimulatorConfig {
  defaultQualityScore: number
  minReferenceMissions: number
}
