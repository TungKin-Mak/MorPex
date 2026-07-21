/**
 * types.ts — Planning Intelligence Layer 统一类型契约
 *
 * ═══════════════════════════════════════════════════════════════
 *  此文件是 PlanTypes.ts + PipelineTypes.ts 的合并产物
 *  合并原因：消除交叉引用（PipelineTypes 从 PlanTypes 导入 PlanExecutionRecord）
 *  合并后：两个旧文件降级为 barrel re-export，此文件为单一事实来源
 * ═══════════════════════════════════════════════════════════════
 *
 * 包含 MetaPlanner 及其所有子系统的全部类型定义：
 *   - 计划模板 / 执行记录 / 评估 / 匹配
 *   - v2 三大认知引擎（战略拆解、前瞻模拟、动态反射）
 *   - 偏差守卫 / 扩展生命周期接口
 *   - 7-Stage Pipeline（S1 意图分析 → S7 计划激活）
 *   - 拓扑探索器 / 自主规划引擎（v8 自我改进回路）
 *
 * 分层定位：
 *   Control Plane  ───  MetaPlanner (战略规划)
 *   Runtime Kernel  ───  WorkflowEngine (可靠执行)
 *   Knowledge Plane ───  PlanExperienceStore (经验知识)
 *
 * 设计约束：
 *   - 零侵入现有 CrossDomainRouter / ExecutionOrchestrator
 *   - 所有持久化使用 JSONL（与现有存储体系一致）
 *   - 通过 EventBus + ExtensionRegistry 非侵入集成
 *   - 契约先行：引擎代码消费类型，而非反向
 */

import type { ExecutionDAG } from '../../planes/control-plane/orchestrator/ExecutionOrchestrator.js';
import type { DAGNode } from '../../domains/types.js';
import type { DAGNode as DAGEngineNode } from '../../planes/runtime-kernel/dag/types.js';

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
  [key: string]: unknown;
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
  [key: string]: unknown;
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

// ═══════════════════════════════════════════════════════════════
// Section 5: MetaPlanner 配置
// ═══════════════════════════════════════════════════════════════

/**
 * MetaPlannerConfig — MetaPlanner 配置
 */
export interface MetaPlannerConfig {
  /** 是否启用 */
  enabled: boolean;

  /** 最小相似度阈值（低于此值不使用模板） */
  similarityThreshold: number;

  /** 最少执行次数（低于此次数不信任模板） */
  minUsageThreshold: number;

  /** 最多返回的匹配模板数 */
  maxMatches: number;

  /** 是否自动将高分执行提炼为模板 */
  autoExtractTemplates: boolean;

  /** 提炼模板的最低评分阈值 */
  templateExtractionScoreThreshold: number;

  /** 计划经验存储路径 */
  experienceStorePath: string;

  /** 模板存储路径 */
  templateStorePath: string;

  /** 最大存储记录数 */
  maxRecords: number;

  /** 是否启用失败模式挖掘（用于自动优化） */
  enableFailurePatternMining: boolean;

  /** 失败模式最小出现次数（触发自动优化建议） */
  minFailurePatternCount: number;
}

/**
 * DEFAULT_META_PLANNER_CONFIG — 默认配置
 */
export const DEFAULT_META_PLANNER_CONFIG: MetaPlannerConfig = {
  enabled: true,
  similarityThreshold: 0.4,
  minUsageThreshold: 3,
  maxMatches: 5,
  autoExtractTemplates: true,
  templateExtractionScoreThreshold: 0.7,
  experienceStorePath: './data/planning/experiences/',
  templateStorePath: './data/planning/templates/',
  maxRecords: 10_000,
  enableFailurePatternMining: true,
  minFailurePatternCount: 3,
};

// ═══════════════════════════════════════════════════════════════
// Section 6: v2 扩展 - 战略拆解类型 (StrategicDeconstructor)
// ═══════════════════════════════════════════════════════════════

/**
 * Milestone — 层次化战略里程碑
 *
 * StrategicDeconstructor 将宏观意图拆解为高维度的里程碑骨架约束。
 * 每个里程碑代表一个逻辑阶段，包含目标领域、预期产物和优先级。
 */
export interface Milestone {
  /** 里程碑唯一 ID */
  id: string;

  /** 里程碑名称 */
  name: string;

  /** 里程碑描述 */
  description: string;

  /** 目标领域 */
  domain: string;

  /** 预期产物类型列表 */
  expectedArtifacts: string[];

  /** 优先级 (1-10, 越高越关键) */
  priority: number;

  /** 依赖的上游里程碑 ID 列表 */
  dependsOn: string[];

  /** 额外约束（如时间预算、最大节点数） */
  constraints?: Record<string, unknown>;

  /** 关联的 KnowledgeGraph 实体 ID（可选） */
  relatedEntityIds?: string[];

  /** 关联的 ArtifactRegistry 产物 ID（可选） */
  relatedArtifactIds?: string[];
}

// ═══════════════════════════════════════════════════════════════
// Section 7: v2 扩展 - 前瞻模拟类型 (LookAheadSimulator)
// ═══════════════════════════════════════════════════════════════

/**
 * SimulationReport — 前瞻模拟报告
 *
 * LookAheadSimulator 对生成的 DAG 进行模拟推演，
 * 评估风险、检测死锁、给出建议。
 */
export interface SimulationReport {
  /** 综合风险评分 (0-1) */
  overallRiskScore: number;

  /** 高风险节点列表 */
  riskNodes: RiskNode[];

  /** 死锁警告列表 */
  deadlockWarnings: DeadlockWarning[];

  /** 优化建议列表 */
  recommendations: SimulationRecommendation[];

  /** 模拟执行时间 */
  simulatedAt: number;

  /** 模拟用时（毫秒） */
  durationMs: number;

  /** 如果 rejected，给出原因 */
  rejectionReason?: string;
}

/**
 * RiskNode — 风险节点
 */
export interface RiskNode {
  /** 节点 ID */
  nodeId: string;

  /** 风险类型 */
  riskType: 'deadlock_candidate' | 'high_failure_rate' | 'long_running' | 'excessive_tokens' | 'missing_dependency';

  /** 风险评分 (0-1) */
  riskScore: number;

  /** 风险原因 */
  reason: string;

  /** 历史数据支撑 */
  evidence?: {
    historicalFailureRate?: number;
    historicalAvgDuration?: number;
    similarRecordCount?: number;
  };
}

/**
 * DeadlockWarning — 死锁警告
 */
export interface DeadlockWarning {
  /** 形成循环的节点 ID 列表 */
  cycleNodes: string[];

  /** 死锁概率 (0-1) */
  probability: number;

  /** 检测依据 */
  basis: string;
}

/**
 * SimulationRecommendation — 模拟建议
 */
export interface SimulationRecommendation {
  /** 建议操作 */
  action: 'rework' | 'add_validation' | 'increase_timeout' | 'mark_optional' | 'split_node' | 'add_dependency';

  /** 目标节点 ID */
  targetNodeId: string;

  /** 建议理由 */
  reason: string;

  /** 预期改善幅度 (0-1) */
  expectedImprovement: number;
}

// ═══════════════════════════════════════════════════════════════
// Section 8: v2 扩展 - 动态反射/重规划类型 (DynamicReflexEngine)
// ═══════════════════════════════════════════════════════════════

/**
 * DAGPatch — 运行时热修补指令集
 *
 * DynamicReflexEngine 在检测到运行时偏离时，
 * 生成 DAGPatch 并通过 DAGEngine 的现有方法（removeNode/addNode/insertAfter/rerouteNode）
 * 对未执行的 DAG 拓扑进行修正。
 */
export interface DAGPatch {
  /** 补丁唯一 ID */
  patchId: string;

  /** 触发原因 */
  reason: string;

  /** 触发时间 */
  timestamp: number;

  /** 修补操作列表 */
  operations: DAGPatchOperation[];

  /** 受影响的节点 ID 列表 */
  affectedNodes: string[];
}

/**
 * DAGPatchOperation — 单次修补操作
 */
export interface DAGPatchOperation {
  /** 操作类型 */
  type: 'remove_node' | 'add_node' | 'insert_after' | 'reroute';

  /** 目标节点 ID */
  nodeId: string;

  /** 操作负载 */
  payload?: {
    /** 新增/替换的节点定义（用于 add_node / insert_after） */
    newNode?: DAGEngineNode;
    /** 插入锚点（用于 insert_after） */
    afterNodeId?: string;
    /** 备选节点 ID（用于 reroute） */
    alternateNodeId?: string;
  };
}

/**
 * DeviationEvent — MemoryBus 偏离事件载荷
 *
 * Context Intelligence 推送的运行时状态偏离事件。
 * DynamicReflexEngine 订阅此事件并触发局部重规划。
 */
export interface DeviationEvent {
  /** 事件类型 */
  type: 'STATE_DEVIATION' | 'SELF_HEALING_FAILED' | 'NODE_FAILED' | 'ARTIFACT_MISSING';

  /** Session ID */
  sessionId: string;

  /** 执行 ID */
  executionId: string;

  /** 事件时间 */
  timestamp: number;

  /** 事件载荷 */
  payload: {
    /** 偏离分数 (0-1) */
    deviationScore?: number;
    /** 失败节点 ID */
    failedNodeId?: string;
    /** 失败原因 */
    failureReason?: string;
    /** 缺失产物 ID */
    missingArtifactId?: string;
    /** 自愈状态 */
    healingStatus?: string;
    /** 其他上下文 */
    [key: string]: unknown;
  };
}

/**
 * RuntimeEventResult — onRuntimeEvent 扩展的返回值
 */
export interface RuntimeEventResult {
  /** 是否已处理 */
  handled: boolean;
  /** 执行的动作（扩展灵活性：预定义常用动作，也接受自定义字符串） */
  action: string;
  /** 应用的热修补（如果有） */
  patch?: DAGPatch;
  /** 未处理的原因 */
  reason?: string;
}

/**
 * MemoryBusLogEntry — MemoryBus JSONL 追踪条目
 *
 * DynamicReflexEngine 每次成功执行 hotPatch 后，
 * 必须调用 MemoryBus.appendLog() 写入此条目，确保谱系完整。
 */
export interface MemoryBusLogEntry {
  sessionId: string;
  executionId: string;
  intervention: string;
  reason: string;
  timestamp: number;
  affectedNodes: string[];
  patchDetails: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Section 9: v2 扩展 - 生命周期拦截上下文类型
// ═══════════════════════════════════════════════════════════════

/**
 * PrePlanContext — onPrePlan 扩展上下文
 *
 * DAG Generator 运行前，包含原始输入和系统资源引用。
 */
export interface PrePlanContext {
  sessionId: string;
  executionId: string;
  userInput: string;
  tags: string[];
  sessionContext?: Record<string, unknown>;
  /** KnowledgeGraph 引用（可选注入） */
  knowledgeGraph?: {
    searchEntities: (query: any) => any[];
    getNeighborhood: (entityId: string, depth?: number) => { entities: any[]; relations: any[] };
    findPath: (fromId: string, toId: string) => any | null;
  };
  /** ArtifactRegistry 引用（可选注入） */
  artifactRegistry?: {
    search?: (query: any) => any[];
    listByDomain?: (domainId: string) => any[];
  };
}

/**
 * PrePlanResult — onPrePlan 扩展的返回值
 */
export interface PrePlanResult {
  /**
   * 增强后的上下文注入内容
   * 可以传 string[]（简单 hint 列表）或 Record<string, unknown>（结构化上下文）
   */
  enrichedContext?: string[] | Record<string, unknown>;
  /** 战略拆解的里程碑列表 */
  milestones?: Milestone[];
}

/**
 * PostPlanContext — onPostPlan 扩展上下文
 *
 * DAG 生成后、正式执行前，包含生成的 DAG 和里程碑信息。
 */
export interface PostPlanContext {
  sessionId: string;
  executionId: string;
  userInput: string;
  tags: string[];
  /** 生成的执行 DAG */
  dag: ExecutionDAG;
  /** 战略拆解的里程碑（如果有） */
  milestones?: Milestone[];
}

/**
 * PostPlanResult — onPostPlan 扩展的返回值
 */
export interface PostPlanResult {
  /** 是否拒绝此 DAG（打回重构） */
  rejected?: boolean;
  /** 拒绝原因 */
  rejectionReasons?: string[];
  /** 模拟报告 */
  simulationReport?: SimulationReport;
  /** 对 DAG 的增强建议 */
  enrichedPlan?: Partial<ExecutionDAG> & { additionalInstructions?: string[] };
}

/**
 * RuntimeEventContext — onRuntimeEvent 扩展上下文
 *
 * 运行时 MemoryBus 事件触发，包含事件详情和运行时引用。
 */
export interface RuntimeEventContext {
  sessionId: string;
  executionId: string;
  /** 原始 MemoryBus 偏离事件 */
  event: DeviationEvent;
}

// ═══════════════════════════════════════════════════════════════
// Section 10: v2 扩展 - 插件扩展接口与控制器
// ═══════════════════════════════════════════════════════════════

/**
 * IPlanningExtension — 计划扩展生命周期接口
 *
 * 所有 v2 认知引擎（及 v1 能力适配器）都必须实现此接口。
 * 通过 MetaPlanner v2 的 registerExtension() 注册。
 */
export interface IPlanningExtension {
  /** 扩展名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小越先执行，默认 100） */
  priority?: number;

  /**
   * onPrePlan — DAG Generator 运行前触发
   * 用于上下文增强、战略拆解。
   */
  onPrePlan?(context: PrePlanContext): Promise<PrePlanResult>;

  /**
   * onPostPlan — 静态图生成后触发
   * 用于前瞻模拟演练。
   */
  onPostPlan?(plan: PostPlanContext): Promise<PostPlanResult>;

  /**
   * onRuntimeEvent — 运行时 MemoryBus 事件触发
   * 用于动态反射重规划。
   */
  onRuntimeEvent?(event: RuntimeEventContext, controller: IRuntimeController): Promise<RuntimeEventResult>;
}

/**
 * IRuntimeController — 运行时影子控制句柄
 *
 * 提供给 onRuntimeEvent 扩展的有限控制接口，
 * 限制扩展只能通过此句柄影响运行时，不能直接操作内核。
 */
export interface IRuntimeController {
  /**
   * pause — 挂起 DAG 执行
   * 在执行热修补前暂停调度器。
   */
  pause(): void;

  /**
   * patchDAG — 应用 DAG 热修补
   * 对后续未执行的节点进行拓扑修正。
   */
  patchDAG(patch: DAGPatch): Promise<boolean>;

  /**
   * resume — 恢复 DAG 执行
   * 热修补完成后恢复调度器。
   */
  resume(): void;

  /**
   * getDeviationCount — 获取当前 session 的偏离计数
   */
  getDeviationCount(sessionId: string): number;
}

// ═══════════════════════════════════════════════════════════════
// Section 11: v2 扩展 - MemoryBus 事件接口
// ═══════════════════════════════════════════════════════════════

/**
 * MemoryBusEvent — MemoryBus 本地事件
 *
 * 进程内 MemoryBus 发射的本地状态变更事件。
 */
export interface MemoryBusEvent {
  type: string;
  sessionId: string;
  executionId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * ExtendedMemoryBus — 扩展后的 MemoryBus 接口
 *
 * 在原有 remember/recall 基础上增加了事件订阅、发射和 JSONL 追踪能力。
 */
export interface ExtendedMemoryBus {
  /** 记忆写入 */
  remember(params: {
    content: string;
    source: string;
    sourceId: string;
    tags: string[];
    importance: number;
  }): Promise<void>;

  /** 记忆检索 */
  recall(params: { text: string; topK: number }): Promise<string[]>;

  /** 订阅本地事件 */
  on(eventType: string, handler: (event: MemoryBusEvent) => void): () => void;

  /** 发射本地事件 */
  emit(event: MemoryBusEvent): void;

  /** 追加 JSONL 追踪日志 */
  appendLog(entry: MemoryBusLogEntry): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// Section 12: v2 配置 & 偏差守卫类型
// ═══════════════════════════════════════════════════════════════

/**
 * MetaPlannerV2Config — MetaPlanner v2 扩展配置
 */
export interface MetaPlannerV2Config {
  /**
   * 防无限规划死循环守卫：
   * 单次 Session 连续触发重规划的最大次数
   */
  maxDeviationCount: number;

  /**
   * 前瞻模拟拒绝阈值：
   * overallRiskScore 超过此值触发 DAG 打回重构
   */
  simulationRejectionThreshold: number;

  /**
   * 战略拆解是否启用
   */
  enableStrategicDeconstructor: boolean;

  /**
   * 前瞻模拟是否启用
   */
  enableLookAheadSimulator: boolean;

  /**
   * 动态反射引擎是否启用
   */
  enableDynamicReflexEngine: boolean;

  /**
   * JSONL 追踪日志路径
   */
  traceLogPath: string;
}

/**
 * DEFAULT_META_PLANNER_V2_CONFIG — v2 扩展默认配置
 */
export const DEFAULT_META_PLANNER_V2_CONFIG: MetaPlannerV2Config = {
  maxDeviationCount: 3,
  simulationRejectionThreshold: 0.7,
  enableStrategicDeconstructor: true,
  enableLookAheadSimulator: true,
  enableDynamicReflexEngine: true,
  traceLogPath: './data/planning/traces/',
};

/**
 * DeviationRecord — 单次偏差事件的完整记录
 */
export interface DeviationRecord {
  /** Session ID */
  sessionId: string;
  /** 事件唯一 ID */
  eventId: string;
  /** 偏差事件类型 */
  type: string;
  /** 偏差描述 */
  description: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否触发了重规划 */
  triggeredReplan?: boolean;
  /** 关联的修补 ID（如果有） */
  patchId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * DeviationGuardConfig — 偏差守卫配置
 */
export interface DeviationGuardConfig {
  /** 单次 Session 最大允许偏差次数 */
  maxDeviationsPerSession: number;
  /** JSONL 追踪日志路径 */
  traceLogPath: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 13: Pipeline Stage 1 — Intent Analysis (意图分析)
// ═══════════════════════════════════════════════════════════════════════

/**
 * SemanticTag — A parsed intent tag with confidence scoring
 *
 * Each tag carries a score indicating how confidently it was matched,
 * a category for downstream filtering, and its provenance.
 */
export interface SemanticTag {
  /** Tag value (e.g. "ai_ml", "web_dev", "build", "low_complexity") */
  tag: string;
  /** Match confidence 0–1 */
  score: number;
  /** Functional category */
  category: 'domain' | 'action' | 'complexity' | 'constraint';
  /** Where this tag was derived from */
  source: 'regex' | 'kg' | 'llm';
}

/**
 * IntentAnalysisResult — Stage 1 output
 *
 * Intercepts raw user intent, invokes extractTags(), cross-references
 * with KnowledgeGraph to infer the target state matrix (S_target).
 * Aborts if confidenceScore < 0.3.
 */
export interface IntentAnalysisResult {
  /** Unique intent analysis ID */
  intentId: string;
  /** The raw user input string */
  rawInput: string;
  /** Parsed semantic tags (from regex + KG + LLM) */
  tags: SemanticTag[];
  /** Inferred target state matrix (S_target) for knowledge alignment */
  targetStateMatrix: Record<string, unknown>;
  /** Explicit environmental constraints parsed from input */
  explicitConstraints: {
    workspacePath?: string;
    windowHandle?: number;
    pinLockRequired?: boolean;
    [key: string]: unknown;
  };
  /** Implicit constraints inferred from context */
  implicitConstraints: string[];
  /** Overall confidence score 0–1. Abort if < 0.3 */
  confidenceScore: number;
  /** If aborted, the reason */
  abortReason?: string;
  /** Timestamp of analysis completion */
  analyzedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 14: Pipeline Stage 2 — Experience Retrieval (经验检索)
// ═══════════════════════════════════════════════════════════════════════

/**
 * VectorMatch — A single vector store match result
 */
export interface VectorMatch {
  /** Record ID from the experience store */
  recordId: string;
  /** Cosine similarity score 0–1 */
  similarity: number;
  /** Key takeaway from this historical execution */
  keyInsight: string;
}

/**
 * ExperienceQueryResult — Stage 2 output
 *
 * Queries both PlanExperienceStore (structural layout matches) AND
 * VectorStore (cosine similarity on vectorized input). Returns both
 * Positive Samples (successful DAGs) AND Negative Samples (cases that
 * generated STATE_DEVIATION or failed micro-self-healing).
 */
export interface ExperienceQueryResult {
  /** Positive (successful) execution records */
  positiveSamples: PlanExecutionRecord[];
  /** Negative (failed/deviated) execution records */
  negativeSamples: PlanExecutionRecord[];
  /** Vector similarity matches with insights */
  vectorMatches: VectorMatch[];
  /** Total candidate records considered */
  totalCandidates: number;
  /** Query timestamp */
  queriedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 15: Pipeline Stage 3 — Candidate Plan Generation (候选生成)
// ═══════════════════════════════════════════════════════════════════════

/**
 * RiskProfile — Summary risk characteristics of a candidate plan
 */
export interface RiskProfile {
  /** Total node count in the plan DAG */
  nodeCount: number;
  /** Number of nodes on the critical path */
  criticalPathLength: number;
  /** Number of external tool/hook dependencies */
  externalDependencies: number;
  /** Number of environmental safety checkpoints inserted */
  securityCheckpoints: number;
  /** Number of Florence-2 UI vision alignment nodes */
  visionAlignmentNodes: number;
  /** Number of Frida/MinHook dynamic instrumentation hooks */
  fridaHooksCount: number;
}

/**
 * CandidatePlanProfile — One of three strategic profiles
 *
 * Generated by Stage 3 LLM structured output. Exactly three profiles
 * are produced: aggressive, defensive, and fallback.
 */
export interface CandidatePlanProfile {
  /** Unique profile identifier */
  profileId: string;
  /** Strategic orientation */
  strategy: 'aggressive' | 'defensive' | 'fallback';
  /** The proposed DAG topology for this profile */
  dag: ExecutionDAG;
  /** Strategic rationale for this profile */
  rationale: string;
  /** Projected execution latency in ms */
  estimatedLatencyMs: number;
  /** Risk characteristics summary */
  riskProfile: RiskProfile;
  /** Additional metadata extracted during generation */
  metadata: Record<string, unknown>;
}

/**
 * ICandidatePlansOutput — Stage 3 LLM structured output
 *
 * Uses strict JSON Schema / Structured Outputs to force the model
 * to synthesize exactly three distinct strategic profiles leveraging
 * contrastive attention within a single context window.
 */
export interface ICandidatePlansOutput {
  /** Plan request identifier */
  planRequestId: string;
  /** Exactly three candidate profiles (aggressive, defensive, fallback) */
  candidates: [CandidatePlanProfile, CandidatePlanProfile, CandidatePlanProfile];
  /** Generation metadata */
  generationMetadata: {
    /** Model identifier used for generation */
    modelUsed: string;
    /** Token consumption */
    tokensUsed: number;
    /** Wall-clock generation time */
    generationTimeMs: number;
  };
  /** Zod/local validation result */
  validationPassed: boolean;
  /** Validation errors if validation failed */
  validationErrors?: string[];
  /** Whether fallback was triggered due to validation/truncation failure */
  fallbackTemplateUsed?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 16: Pipeline Stage 4 — Plan Simulation / DES (离散事件模拟)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ShadowContext — A pure in-memory clone of MemoryBus state
 *
 * Completely isolated, side-effect-free, used for stochastic DES.
 */
export interface ShadowContext {
  /** Unique context ID */
  contextId: string;
  /** Source session ID */
  sourceSessionId: string;
  /** Clone timestamp */
  clonedAt: number;
  /** Cloned MemoryBus Local Map Cache state */
  stateSnapshot: Map<string, unknown>;
  /** Currently held resource locks in this shadow */
  resourceLocks: Set<string>;
  /** Whether this context has been modified */
  isDirty: boolean;
}

/**
 * ResourceContention — Record of simulated resource contention
 */
export interface ResourceContention {
  /** Resource identifier that was contended */
  resourceId: string;
  /** Simulated wait time in ms */
  waitTimeMs: number;
}

/**
 * DESNodeResult — Single node simulation result from DES
 *
 * Each node is stepped through along a virtual time axis. A stochastic
 * probability check is rolled using the volatility matrix seeded by
 * Stage 2's negative samples and file-system locking heatmaps.
 */
export interface DESNodeResult {
  /** Node ID in the DAG */
  nodeId: string;
  /** Whether this node simulation passed */
  passed: boolean;
  /** Simulated latency in ms */
  simulatedLatencyMs: number;
  /** Number of micro-retries attempted (0–3) */
  retryCount: number;
  /** If failed, the reason after exhausting retries */
  failureReason?: string;
  /** Downstream node IDs that failed due to cascade from this node */
  cascadeFailures: string[];
  /** Resource contention events during this node's execution */
  resourceContention: ResourceContention[];
}

/**
 * SimulatedExceptionTrace — A simulated exception trace entry
 */
export interface SimulatedExceptionTrace {
  /** Node where exception occurred */
  nodeId: string;
  /** Exception type */
  exceptionType: string;
  /** Exception message */
  message: string;
  /** Timestamp of simulated exception */
  timestamp: number;
}

/**
 * ResourceBottleneck — Simulated resource bottleneck summary
 */
export interface ResourceBottleneck {
  /** Resource identifier */
  resourceId: string;
  /** Number of contention events on this resource */
  contentionCount: number;
  /** Average wait time in ms */
  avgWaitTimeMs: number;
}

/**
 * IShadowSimulationReport — Full DES simulation output for one profile
 *
 * Constructed by stepping through each candidate DAG topology along a
 * virtual time axis, rolling stochastic probability checks, simulating
 * Self-Healing Runtime buffers, and propagating cascade failures.
 */
export interface IShadowSimulationReport {
  /** Simulation identifier */
  simulationId: string;
  /** Associated profile ID */
  profileId: string;
  /** Strategic profile being simulated */
  strategy: 'aggressive' | 'defensive' | 'fallback';
  /** Simulation start timestamp */
  startedAt: number;
  /** Simulation completion timestamp */
  completedAt: number;
  /** Total simulated wall-clock latency in ms */
  totalSimulatedLatencyMs: number;
  /** Probability of survival 0–1 */
  survivalProbability: number;
  /** Per-node simulation results */
  nodeResults: DESNodeResult[];
  /** Number of nodes that passed */
  passedNodes: number;
  /** Number of nodes that failed */
  failedNodes: number;
  /** Total cascade failure count */
  cascadeFailureCount: number;
  /** Resource bottlenecks identified during simulation */
  resourceBottlenecks: ResourceBottleneck[];
  /** Simulated exception traces */
  simulatedExceptionTraces: SimulatedExceptionTrace[];
  /** Overall assessment */
  overallAssessment: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL';
}

// ═══════════════════════════════════════════════════════════════════════
// Section 17: Pipeline Stage 5 — Plan Evaluation / MCDA (多准则决策)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ProfileScore — MCDA dimension scores for a single profile
 *
 * Each dimension is scored 0–1 and weighted according to the current
 * risk appetite configuration.
 */
export interface ProfileScore {
  /** Stability score 0–1 */
  stability: number;
  /** Latency efficiency score 0–1 */
  latency: number;
  /** Security score 0–1 */
  security: number;
  /** Intent alignment score 0–1 */
  alignment: number;
  /** Self-healing capability score 0–1 */
  healing: number;
  /** Knowledge leverage score 0–1 */
  knowledge: number;
  /** Weighted composite score 0–1 */
  composite: number;
}

/**
 * WeightConfiguration — MCDA weights that must sum to 1.0
 */
export interface WeightConfiguration {
  /** Weight for stability dimension */
  stability: number;
  /** Weight for latency dimension */
  latency: number;
  /** Weight for security dimension */
  security: number;
  /** Weight for intent alignment dimension */
  alignment: number;
  /** Weight for self-healing dimension */
  healing: number;
  /** Weight for knowledge leverage dimension */
  knowledge: number;
}

/**
 * ScoreBreakdownEntry — Single dimension score breakdown
 */
export interface ScoreBreakdownEntry {
  /** Profile name being scored */
  profile: string;
  /** Dimension being evaluated */
  dimension: string;
  /** Raw (unweighted) score 0–1 */
  rawScore: number;
  /** Weighted score that contributed to composite */
  weightedScore: number;
}

/**
 * IEvaluationScorecard — Multi-Criteria Decision Analysis scorecard
 *
 * Implements a weighted linear combination scoring model:
 *   Score = Σ(w_i · S_i)
 *   where weights normalize to 1.0 and S_i are the dimension scores.
 *
 * Applies risk appetite regulation based on deviationCount.
 */
export interface IEvaluationScorecard {
  /** Evaluation identifier */
  evaluationId: string;
  /** Evaluation timestamp */
  evaluatedAt: number;
  /** Scores for all three profiles */
  profiles: {
    aggressive: ProfileScore;
    defensive: ProfileScore;
    fallback: ProfileScore;
  };
  /** The weight configuration used for this evaluation */
  weightConfiguration: WeightConfiguration;
  /** Winning profile strategy */
  winner: 'aggressive' | 'defensive' | 'fallback';
  /** Winner's composite score */
  winnerScore: number;
  /** Full score breakdown for auditability */
  scoreBreakdown: ScoreBreakdownEntry[];
  /** Optional metadata for topology recommendations and other extras */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 18: Pipeline Stage 6 — Decision Trace (决策追踪)
// ═══════════════════════════════════════════════════════════════════════

/**
 * CandidateElimination — Record of why a candidate was eliminated
 */
export interface CandidateElimination {
  /** Profile that was eliminated */
  profile: string;
  /** Human-readable elimination rationale */
  reason: string;
  /** The composite score that led to elimination */
  score: number;
}

/**
 * WinnerSelection — Record of the winning selection rationale
 */
export interface WinnerSelection {
  /** Winning profile strategy */
  profile: string;
  /** Detailed rationale for why this profile was chosen */
  rationale: string;
  /** The risk-adjusted weights used in the final evaluation */
  riskAdjustedWeights: Record<string, number>;
}

/**
 * DecisionTrace — Stage 6 output
 *
 * Serializes the precise rationale for candidate elimination and
 * winning selection into a structured semantic block.
 *
 * Synchronously written to MemoryBus Local Map Cache AND appended
 * to the persistent JSONL file for lineage auditing.
 */
export interface DecisionTrace {
  /** Trace identifier */
  traceId: string;
  /** Session ID */
  sessionId: string;
  /** Execution ID */
  executionId: string;
  /** Evaluation timestamp */
  evaluatedAt: number;
  /** Elimination records for non-winning candidates */
  candidateEliminations: CandidateElimination[];
  /** The winning selection rationale */
  winnerSelection: WinnerSelection;
  /** Deviation count at decision time */
  deviationCount: number;
  /** Risk appetite mode active during this evaluation */
  riskAppetite: 'efficiency' | 'balanced' | 'stability';
  /** Whether the trace was successfully written to disk */
  writtenToDisk: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 19: Pipeline Stage 7 — Best Plan Selection & Activation (计划激活)
// ═══════════════════════════════════════════════════════════════════════

/**
 * PlanActivationResult — Stage 7 output
 *
 * Final gatekeeper. Registers the winner DAG's required physical
 * resource tokens inside ArtifactRegistry to prevent workspace collisions,
 * then returns the finalized Winner DAG topology.
 */
export interface PlanActivationResult {
  /** The activated (winning) plan profile */
  activatedPlan: CandidatePlanProfile;
  /** The complete decision trace from Stage 6 */
  decisionTrace: DecisionTrace;
  /** ArtifactRegistry resource tokens acquired to prevent collisions */
  resourceTokens: string[];
  /** Whether plan is ready for downstream ExecutionOrchestrator */
  readyForExecution: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 20: Pipeline Orchestration Types (管道编排类型)
// ═══════════════════════════════════════════════════════════════════════

/** Stage numbers for the 7-stage pipeline */
export type PipelineStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Stage status values */
export type StageStatus = 'completed' | 'failed' | 'skipped';

/**
 * PipelineStageResult — Output of any single pipeline stage
 *
 * Union-discriminated by stage number for type safety.
 * Each stage produces a specific output type.
 */
export interface PipelineStageResult {
  /** Pipeline stage number 1–7 */
  stage: PipelineStageNumber;
  /** Execution status */
  status: StageStatus;
  /** Wall-clock duration for this stage in ms */
  durationMs: number;
  /** Stage output — discriminated by stage number */
  output:
    | IntentAnalysisResult       // Stage 1
    | ExperienceQueryResult      // Stage 2
    | ICandidatePlansOutput      // Stage 3
    | IShadowSimulationReport[]  // Stage 4 (one per profile)
    | IEvaluationScorecard       // Stage 5
    | DecisionTrace              // Stage 6
    | PlanActivationResult;      // Stage 7
  /** Error message if failed */
  error?: string;
}

/**
 * PipelineTrace — Complete 7-stage execution trace
 *
 * Captures the full lifecycle of a planning pipeline invocation
 * for auditability, debugging, and observability.
 */
export interface PipelineTrace {
  /** Unique pipeline invocation ID */
  pipelineId: string;
  /** Session ID */
  sessionId: string;
  /** Execution ID */
  executionId: string;
  /** Pipeline start timestamp */
  startedAt: number;
  /** Pipeline completion timestamp */
  completedAt: number;
  /** Exactly 7 stage results in order */
  stages: [
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
    PipelineStageResult,
  ];
  /** Whether the pipeline was aborted */
  aborted: boolean;
  /** Reason for abort (if aborted) */
  abortReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 21: DES Config — 离散事件模拟配置
// ═══════════════════════════════════════════════════════════════════════

/**
 * DESConfig — Configuration for the Discrete Event Simulation engine
 */
export interface DESConfig {
  /** Maximum micro-retries per node (default 3) */
  maxRetriesPerNode: number;
  /** Volatility matrix amplification factor for stochastic checks */
  volatilityAmplification: number;
  /** Time step granularity in ms for virtual clock advancement */
  timeStepMs: number;
  /** Whether to simulate file-system locking heatmaps */
  enableLockHeatmapSimulation: boolean;
  /** Resource contention probability multiplier */
  contentionMultiplier: number;
}

/** Default DES configuration */
export const DEFAULT_DES_CONFIG: DESConfig = {
  maxRetriesPerNode: 3,
  volatilityAmplification: 1.0,
  timeStepMs: 10,
  enableLockHeatmapSimulation: true,
  contentionMultiplier: 1.0,
};

// ═══════════════════════════════════════════════════════════════════════
// Section 22: MCDA Config — 多准则决策配置
// ═══════════════════════════════════════════════════════════════════════

/**
 * RiskAppetiteProfile — Weight configuration per risk appetite mode
 */
export interface RiskAppetiteProfile {
  /** Weights for efficiency-oriented mode (deviationCount === 0) */
  efficiency: WeightConfiguration;
  /** Balanced default weights */
  balanced: WeightConfiguration;
  /** Weights for stability-oriented mode (deviationCount > 0) */
  stability: WeightConfiguration;
}

/** Default MCDA weight configurations for each risk appetite */
export const DEFAULT_RISK_APPETITE_PROFILE: RiskAppetiteProfile = {
  efficiency: {
    stability: 0.10,
    latency: 0.30,
    security: 0.10,
    alignment: 0.20,
    healing: 0.10,
    knowledge: 0.20,
  },
  balanced: {
    stability: 0.20,
    latency: 0.20,
    security: 0.15,
    alignment: 0.15,
    healing: 0.15,
    knowledge: 0.15,
  },
  stability: {
    stability: 0.30,
    latency: 0.05,
    security: 0.25,
    alignment: 0.15,
    healing: 0.15,
    knowledge: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Section 23: Pipeline Abort Thresholds & Stage Names
// ═══════════════════════════════════════════════════════════════════════

/** Thresholds that trigger pipeline abort */
export const PIPELINE_ABORT_THRESHOLDS = {
  /** Stage 1: minimum confidence to proceed */
  intentConfidenceMin: 0.3,
  /** Stage 3: minimum survival probability to consider a plan viable */
  survivalProbabilityMin: 0.2,
  /** Stage 4: minimum survival probability across all profiles */
  simulationSurvivalMin: 0.15,
  /** Stage 5: minimum winner score to proceed to activation */
  winnerScoreMin: 0.3,
} as const;

/** Human-readable names for pipeline stages */
export const PIPELINE_STAGE_NAMES: Record<PipelineStageNumber, string> = {
  1: 'Intent Analysis',
  2: 'Experience Retrieval',
  3: 'Candidate Plan Generation',
  4: 'Plan Simulation (DES)',
  5: 'Plan Evaluation (MCDA)',
  6: 'Decision Trace',
  7: 'Best Plan Selection & Activation',
};

// ═══════════════════════════════════════════════════════════════════════
// Section 24: Topology Explorer — 拓扑探索与变体比较
// ═══════════════════════════════════════════════════════════════════════

/**
 * VariantSimulationResult — DES result for a single topological permutation
 */
export interface VariantSimulationResult {
  /** Topological ordering description */
  ordering: string;
  /** The DAG with nodes in this ordering */
  dag: ExecutionDAG;
  /** Simulated survival probability 0-1 */
  survivalProbability: number;
  /** Simulated total latency in ms */
  totalSimulatedLatencyMs: number;
  /** Passed node count */
  passedNodes: number;
  /** Failed node count */
  failedNodes: number;
  /** Composite score: survival × 0.6 + (1 − latency/maxLatency) × 0.4 */
  compositeScore: number;
}

/**
 * TopologyExplorationReport — Full report from zero-token topology exploration
 */
export interface TopologyExplorationReport {
  originalDAG: ExecutionDAG;
  totalVariantsGenerated: number;
  totalVariantsSimulated: number;
  variantsSimulated: VariantSimulationResult[];
  bestVariant: VariantSimulationResult;
  originalScore: number;
  bestScore: number;
  improvement: number;
  selectedDAG: ExecutionDAG;
  explorationTimeMs: number;
  wasOptimized: boolean;
}

/**
 * TopologySignature — A hashable representation of a DAG's topological ordering.
 * Two DAGs with identical node roles executed in different orders will have
 * different topologySignatures.
 */
export interface TopologySignature {
  /** Canonical string: "domain:role1→domain:role2→domain:role3" */
  signature: string;
  /** The ordered sequence of (domain, role) pairs */
  nodeSequence: Array<{ domain: string; role: string }>;
}

/**
 * TopologyVariantRecord — Historical success/failure stats for a specific
 * DAG topological ordering.
 */
export interface TopologyVariantRecord {
  /** The topology signature this record tracks */
  signature: TopologySignature;
  /** Number of times this ordering was attempted */
  totalAttempts: number;
  /** Number of successful executions */
  successes: number;
  /** Number of failed executions */
  failures: number;
  /** Success rate 0-1 */
  successRate: number;
  /** Average execution duration in ms */
  avgDurationMs: number;
  /** Average token consumption */
  avgTokensUsed: number;
  /** Last attempted timestamp */
  lastAttemptedAt: number;
  /** Source record IDs for traceability */
  sourceRecordIds: string[];
}

/**
 * TopologyComparisonResult — Result of comparing topological variants
 * to determine the optimal execution order for a given set of node roles.
 */
export interface TopologyComparisonResult {
  /** All known variants for this node set */
  variants: TopologyVariantRecord[];
  /** Best variant by success rate */
  bestVariant: TopologyVariantRecord | null;
  /** Worst variant by success rate */
  worstVariant: TopologyVariantRecord | null;
  /** How many variants were compared */
  totalVariants: number;
  /** The recommended ordering (nodeRoles in recommended order) */
  recommendedOrdering: string[];
  /** Confidence in the recommendation 0-1 */
  confidence: number;
  /** Whether the recommendation is statistically significant */
  isSignificant: boolean;
}

/**
 * DEFAULT_TOPOLOGY_COMPARISON_CONFIG — Default thresholds for topology comparison
 */
export const DEFAULT_TOPOLOGY_COMPARISON_CONFIG = {
  /** Minimum total attempts across all variants to consider comparison significant */
  minTotalAttempts: 5,
  /** Minimum success difference between best and worst to recommend reorder */
  minSuccessGap: 0.3,
  /** Minimum successes the best variant must have */
  minBestSuccesses: 3,
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Section 25: Autonomous Planning Engine — v8 自我改进回路
// ═══════════════════════════════════════════════════════════════════════

/**
 * ExecutionGapAnalysis — Comparison of predicted vs actual execution outcomes.
 *
 * The self-improvement loop compares what Stages 4-5 predicted against
 * what actually happened during execution. Gaps > 20% drive learning actions.
 */
export interface ExecutionGapAnalysis {
  /** Predicted survival probability from DES Stage 4 */
  predictedSurvival: number;
  /** Actual survival from real execution */
  actualSurvival: number;
  /** Predicted total latency from DES Stage 4 */
  predictedLatency: number;
  /** Actual wall-clock duration from execution */
  actualLatency: number;
  /** Predicted MCDA composite score from Stage 5 */
  predictedScore: number;
  /** Actual PlanEvaluator score from post-execution evaluation */
  actualScore: number;
  /** Per-dimension gap breakdown */
  dimGaps: Array<{
    dimension: string;
    predicted: number;
    actual: number;
    delta: number;
  }>;
  /** Dimensions where gap exceeded the significance threshold */
  significantGaps: string[];
  /** When the gap analysis was performed */
  analyzedAt: number;
}

/**
 * LearningAction — A concrete action derived from gap analysis.
 *
 * Each significant gap generates one or more learning actions that
 * adapt the planning system for better future predictions.
 */
export interface LearningAction {
  /** Type of learning action */
  type: 'adjust_weight' | 'update_template_quality' | 'amplify_volatility'
      | 'deprioritize_strategy' | 'prune_template' | 'boost_template';
  /** The target of the action (dimension name, template ID, etc.) */
  target: string;
  /** Value before the adjustment */
  before: number;
  /** Value after the adjustment */
  after: number;
  /** Human-readable reason this action was taken */
  reason: string;
  /** When the action was applied */
  appliedAt: number;
}

/**
 * ImprovementTrajectory — Score progression over multiple executions.
 *
 * Tracks whether the system is actually improving over time.
 * If the trend is 'declining', the system may need intervention.
 */
export interface ImprovementTrajectory {
  /** Total number of executions tracked */
  totalExecutions: number;
  /** Per-execution score timeline (oldest first) */
  avgScoreTimeline: number[];
  /** Number of learning actions taken */
  learningActionsTaken: number;
  /** Number of template evolution cycles completed */
  templatesEvolved: number;
  /** Number of weight auto-tuning cycles completed */
  weightsAutoTuned: number;
  /** Overall trend direction */
  trend: 'improving' | 'stable' | 'declining';
}

/**
 * AutonomousExecutionResult — Full result from the autonomous planning loop.
 *
 * Returned by PlanningIntelligenceEngine.executeAndLearn().
 * Contains both the execution output and the improvement metadata.
 */
export interface AutonomousExecutionResult {
  /** The executed DAG */
  dag: any;
  /** The execution output */
  result: any;
  /** The full pipeline trace from the planning phase */
  pipelineTrace: any;
  /** The persistent execution record */
  executionRecord: any;
  /** Gap analysis comparing prediction vs reality */
  gapAnalysis: ExecutionGapAnalysis;
  /** Learning actions derived from gaps */
  learningActions: LearningAction[];
  /** Improvement metrics vs previous execution */
  improvement: {
    scoreVsPrevious: number;
    dimensionDeltas: Record<string, number>;
    templateQualityChange: number;
    weightAdjustments: Record<string, number>;
    learningApplied: boolean;
  };
}

/**
 * TemplateEvolutionReport — Result of a template evolution cycle.
 */
export interface TemplateEvolutionReport {
  /** Templates that were pruned (removed) */
  prunedTemplates: string[];
  /** Templates whose quality was boosted */
  boostedTemplates: Array<{ templateId: string; oldQuality: number; newQuality: number }>;
  /** Template pairs that were merged */
  mergedTemplates: Array<{ target: string; source: string }>;
  /** Total templates before evolution */
  beforeCount: number;
  /** Total templates after evolution */
  afterCount: number;
}

/**
 * PlanningIntelligenceConfig — Configuration for the autonomous planning engine
 */
export interface PlanningIntelligenceConfig {
  /** Gap threshold (0-1) above which a gap is considered significant */
  significanceThreshold: number;
  /** Number of executions between auto-evolve cycles */
  evolveInterval: number;
  /** Number of recent records to use for weight auto-tuning */
  weightTuningWindow: number;
  /** Maximum weight adjustment per cycle (to prevent oscillation) */
  maxWeightAdjustment: number;
  /** Minimum template quality score before it gets pruned */
  templateQualityMin: number;
  /** Whether to enable learning actions */
  enableLearning: boolean;
  /** Whether to run periodic template evolution */
  enableTemplateEvolution: boolean;
  /** Whether to auto-tune MCDA weights */
  enableWeightAutoTuning: boolean;
}

/** Default config for the planning intelligence engine */
export const DEFAULT_PLANNING_INTELLIGENCE_CONFIG: PlanningIntelligenceConfig = {
  significanceThreshold: 0.20,    // 20% gap is significant
  evolveInterval: 10,              // evolve templates every 10 executions
  weightTuningWindow: 20,          // use last 20 records for weight tuning
  maxWeightAdjustment: 0.05,       // adjust weights by max 0.05 per cycle
  templateQualityMin: 0.30,        // prune templates below 0.30 quality
  enableLearning: true,
  enableTemplateEvolution: true,
  enableWeightAutoTuning: true,
};
