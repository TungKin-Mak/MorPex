/**
// ═══════════════════════════════════════════════════════════════
// Section 1: 计划模板
// ═══════════════════════════════════════════════════════════════

/**
 * PlanTemplate — 可复用的 DAG 计划模板
 *
 * 从历史成功执行中提炼。包含节点骨架、领域分配和期望产物。
 * 新任务到来时，MetaPlanner 匹配最相似的模板进行实例化。
 */
export interface PlanTemplate {
  /** 模板唯一 ID */
  templateId: string;

  /** 模板名称（如 "startup_validation_strategy"） */
  name: string;

  /** 模板描述 */
  description: string;

  /** 适用的任务类别标签 */
  tags: string[];

  /** 模板中的节点骨架（不含具体参数，仅为类型 + 依赖关系） */
  nodeSkeletons: PlanNodeSkeleton[];

  /** 成功率 (0-1) */
  successRate: number;

  /** 平均执行耗时（毫秒） */
  avgDurationMs: number;

  /** 平均 token 消耗 */
  avgTokensUsed: number;

  /** 使用次数 */
  usageCount: number;

  /** 最后使用时间 */
  lastUsedAt: number;

  /** 创建时间 */
  createdAt: number;

  /** 来源执行 ID 列表（哪些成功执行贡献了这个模板） */
  sourceExecutionIds: string[];

  /** 模板版本 */
  version: number;

  /** 模板质量评分 (0-1) */
  qualityScore: number;
}

/**
 * PlanNodeSkeleton — 计划节点骨架
 *
 * 不含具体输入参数，仅包含节点类型、依赖关系、期望产物类型。
 * 实例化时由 Planner 根据实际输入填充。
 */
export interface PlanNodeSkeleton {
  /** 节点角色/类型（如 "market_research", "code_generation", "validation"） */
  role: string;

  /** 目标领域 */
  domain: string;

  /** 依赖的角色列表 */
  deps: string[];

  /** 期望产出的产物类型 */
  expectedArtifacts: string[];

  /** 是否可选（失败不终止 DAG） */
  optional?: boolean;

  /** 典型超时（毫秒） */
  typicalTimeoutMs?: number;
}

// ═══════════════════════════════════════════════════════════════
// Section 2: 计划执行记录
// ═══════════════════════════════════════════════════════════════

/**
 * PlanExecutionRecord — 单次计划执行的完整记录
 *
 * 每次 ExecutionOrchestrator.orchestrate() 完成后持久化一条记录。
 * 用于后续的相似度匹配、质量评估和模式挖掘。
 */
export interface PlanExecutionRecord {
  /** 记录唯一 ID */
  recordId: string;

  /** 执行 ID */
  executionId: string;

  /** 关联的模板 ID（如果基于模板生成） */
  templateId?: string;

  /** 原始用户输入（用于相似度匹配） */
  userInput: string;

  /** 输入的关键词/标签 */
  inputTags: string[];

  /** DAG 节点列表 */
  dagNodes: DAGNodeRecord[];

  /** 是否成功 */
  success: boolean;

  /** 总耗时（毫秒） */
  totalDurationMs: number;

  /** 总 token 消耗 */
  totalTokensUsed: number;

  /** 产物数量 */
  artifactCount: number;

  /** 失败节点信息（如有） */
  failureDetails?: FailureDetail[];

  /** 自愈重试次数 */
  selfHealingRetries: number;

  /** 剪枝节省的 token 数 */
  pruningTokensSaved: number;

  /** 评分 (0-1) */
  score: number;

  /** 创建时间 */
  createdAt: number;
}

/**
 * DAGNodeRecord — DAG 节点的执行记录
 */
export interface DAGNodeRecord {
  /** 节点 ID */
  nodeId: string;

  /** 节点角色 */
  role: string;

  /** 领域 */
  domain: string;

  /** 状态 */
  status: 'success' | 'failed' | 'skipped';

  /** 耗时（毫秒） */
  durationMs: number;

  /** Token 消耗 */
  tokensUsed: number;

  /** 产出的产物 URI 列表 */
  artifactUris: string[];

  /** 重试次数 */
  retries: number;

  /** 错误信息（如有） */
  error?: string;
}

/**
 * FailureDetail — 失败详情
 */
export interface FailureDetail {
  /** 失败节点 ID */
  nodeId: string;

  /** 失败原因分类 */
  category: FailureCategory;

  /** 错误消息摘要 */
  summary: string;

  /** 发生时间 */
  timestamp: number;
}

/**
 * FailureCategory — 失败原因分类
 */
export type FailureCategory =
  | 'llm_timeout'
  | 'llm_hallucination'
  | 'tool_error'
  | 'mcp_crash'
  | 'token_exhaustion'
  | 'validation_failure'
  | 'dependency_missing'
  | 'timeout'
  | 'unknown';

