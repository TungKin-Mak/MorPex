/**
 * extensions/types.ts — 内核扩展类型契约（不可破坏的核心骨架）
 *
 * 定义三大内核升级模块的所有接口、配置参数、扩展生命周期事件。
 *
 * 设计约束：
 *   - 所有类型零侵入现有 WorkflowEngine.ts
 *   - 扩展通过 EventBus 生命周期钩子 + 高阶函数包装接入
 *   - 状态数据结构高度内聚在各 Manager 中
 *   - 所有接口支持一键 Disable（通过 enabled 标志）
 *
 * 三大模块：
 *   1. Artifact Lineage Graph（产物血缘关系图）
 *   2. Context Intelligence Engine（上下文智能引擎）
 *   3. Self-Healing Runtime（自愈运行时）
 */

import type { ArtifactRef } from '../domains/types.js';

// ═══════════════════════════════════════════════════════════════
// 模块一：Artifact Lineage Graph
// ═══════════════════════════════════════════════════════════════

/**
 * ArtifactNode — 产物血缘图谱中的节点
 *
 * 每个 DAG 节点产出的每个 ArtifactRef 对应一个 ArtifactNode。
 * 通过 parentIds 形成有向无环的产物演进图。
 */
export interface ArtifactNode {
  /** 产物唯一 UUID（格式：artifact_node_{shortUUID}） */
  id: string;

  /** 全局唯一 URI，格式 artifact://{domain}/{nodeId}/{filename} */
  uri: string;

  /** SHA-256 哈希（文件内容或元数据摘要） */
  hash: string;

  /** 产生此产物的 DAG 节点 ID */
  generatorNode: string;

  /** 依赖的上游产物 ID 列表（血缘上游） */
  parentIds: string[];

  /** 产物类型（source_code, ResearchReport, config 等） */
  type: string;

  /** 产物名称 */
  name: string;

  /** 所属领域 */
  domain: string;

  /** 内容格式（markdown, json, text, binary） */
  schema: string;

  /** 产物大小（字节），-1 表示未知 */
  size: number;

  /** 版本号 */
  version: number;

  /** 创建时间戳（Unix 毫秒） */
  timestamp: number;

  /** 所属执行 ID */
  executionId: string;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * LineageEdge — 血缘图中的边
 *
 * 表示产物之间的派生关系：fromNode → toNode
 */
export interface LineageEdge {
  /** 源节点 ID（上游产物） */
  from: string;

  /** 目标节点 ID（下游产物） */
  to: string;

  /** 关系类型 */
  relation: 'derived_from' | 'depends_on' | 'version_of';

  /** 建立时间 */
  timestamp: number;
}

/**
 * LineageGraph — 有向无环产物血缘图
 *
 * 支持高效的反向追溯（从下游产物找到所有上游依赖）
 * 和正向传播（从上游产物找到所有下游影响）。
 */
export interface LineageGraph {
  /** 所有产物节点，key = ArtifactNode.id */
  nodes: Map<string, ArtifactNode>;

  /** 所有边 */
  edges: LineageEdge[];

  /** URI → ArtifactNode.id 快速索引 */
  uriIndex: Map<string, string>;

  /** 执行 ID → ArtifactNode.id[] 索引 */
  executionIndex: Map<string, string[]>;
}

/**
 * LineageQuery — 血缘查询条件
 */
export interface LineageQuery {
  /** 起始节点 URI */
  startUri: string;

  /** 遍历方向 */
  direction: 'upstream' | 'downstream' | 'both';

  /** 最大深度（默认 Infinity = 全图遍历） */
  maxDepth?: number;

  /** 按关系类型过滤 */
  relationFilter?: LineageEdge['relation'][];
}

/**
 * LineageQueryResult — 血缘查询结果
 */
export interface LineageQueryResult {
  /** 起始节点 */
  root: ArtifactNode;

  /** 追溯到的所有节点 */
  nodes: ArtifactNode[];

  /** 遍历过的边 */
  edges: LineageEdge[];

  /** 总深度 */
  maxDepthReached: number;
}

/**
 * LineageTrackerConfig — 血缘追踪器配置
 */
export interface LineageTrackerConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;

  /** 最大图谱节点数（超过则触发 LRU 淘汰） */
  maxNodes: number;

  /** 是否计算 SHA-256 哈希（默认 true，关闭可提升性能） */
  computeHash: boolean;

  /** 哈希计算超时（毫秒），默认 5000 */
  hashTimeoutMs: number;

  /** 是否持久化图谱到磁盘 */
  persistToDisk: boolean;

  /** 持久化路径 */
  persistencePath: string;
}

// ═══════════════════════════════════════════════════════════════
// 模块二：Context Intelligence Engine
// ═══════════════════════════════════════════════════════════════

/**
 * ContextPrunerConfig — 上下文剪枝器配置
 */
export interface ContextPrunerConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;

  /** 触发大对象卸载的体积阈值（字节），默认 10240 (10KB) */
  offloadThresholdBytes: number;

  /** 大对象卸载目录 */
  offloadDir: string;

  /** 剪枝后保留的最大上下文 token 估算值 */
  maxTokensBudget: number;

  /** 是否启用拓扑剪枝（基于血缘图剔除无关产物） */
  enableTopologicalPruning: boolean;

  /** 拓扑剪枝时保留的最大上游深度 */
  maxUpstreamDepth: number;

  /** 摘要指针模板 */
  artifactPointerTemplate: string;

  /** 是否在剪枝后添加血缘摘要 */
  includeLineageSummary: boolean;
}

/**
 * ContextSegment — 上下文中的一个片段
 *
 * 上下文被建模为多个 ContextSegment 的有序列表，
 * 每个 segment 代表一个逻辑单元（系统提示、历史消息、产物引用等）。
 */
export interface ContextSegment {
  /** 片段唯一标识 */
  id: string;

  /** 片段类型 */
  type: 'system_prompt' | 'user_message' | 'assistant_message' | 'tool_result' | 'artifact_ref' | 'lineage_summary' | 'memory' | 'raw';

  /** 片段内容（文本） */
  content: string;

  /** 估算 token 数 */
  estimatedTokens: number;

  /** 关联的产物 URI（若为 artifact_ref 类型） */
  artifactUri?: string;

  /** 关联的 DAG 节点 ID（用于拓扑剪枝） */
  nodeId?: string;

  /** 时间戳 */
  timestamp: number;

  /** 是否可被剪枝（默认 true） */
  prunable: boolean;

  /** 重要性分数（0-10，越高越不可被剪枝） */
  importance: number;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * PruningDecision — 单个片段的剪枝决策
 */
export interface PruningDecision {
  /** 片段 ID */
  segmentId: string;

  /** 是否保留 */
  keep: boolean;

  /** 决策原因 */
  reason: 'topology_dependent' | 'topology_independent' | 'high_importance' | 'system_prompt' | 'recent_message' | 'offloaded' | 'budget_exceeded' | 'explicitly_protected';

  /** 如果 offloaded，指向卸载文件的路径 */
  offloadPath?: string;

  /** 替换后的内容（如摘要指针） */
  replacementContent?: string;
}

/**
 * PruningResult — 剪枝执行结果
 */
export interface PruningResult {
  /** 剪枝前总 token 估算 */
  tokensBefore: number;

  /** 剪枝后总 token 估算 */
  tokensAfter: number;

  /** 剪枝率 (0-1) */
  pruningRatio: number;

  /** 每个片段的决策 */
  decisions: PruningDecision[];

  /** 剪枝后的上下文片段列表 */
  prunedSegments: ContextSegment[];

  /** 被卸载的大对象列表 */
  offloadedArtifacts: Array<{ uri: string; filePath: string; sizeBytes: number }>;

  /** 血缘摘要（若 includeLineageSummary 为 true） */
  lineageSummary?: string;

  /** 剪枝耗时（毫秒） */
  durationMs: number;
}

/**
 * ContextSnapshot — 剪枝前的上下文快照（用于审计和回滚）
 */
export interface ContextSnapshot {
  /** 快照 ID */
  id: string;

  /** 关联的执行 ID */
  executionId: string;

  /** 关联的 DAG 节点 ID */
  nodeId: string;

  /** 快照时的完整上下文 */
  segments: ContextSegment[];

  /** 快照时间 */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 模块三：Self-Healing Runtime（Phase 3 预留）
// ═══════════════════════════════════════════════════════════════

/**
 * McpGuardConfig — MCP 看门狗配置
 */
export interface McpGuardConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;

  /** 健康巡检间隔（毫秒），默认 5000 */
  pingIntervalMs: number;

  /** Ping 超时（毫秒），默认 3000 */
  pingTimeoutMs: number;

  /** 连续失败多少次触发强杀重启 */
  maxConsecutiveFailures: number;

  /** 重启冷却时间（毫秒），防止无限重启 */
  restartCooldownMs: number;

  /** 最大重启次数（超过后标记为不可恢复） */
  maxRestarts: number;

  /** 是否启用 stdio 死锁检测 */
  enableDeadlockDetection: boolean;

  /** stdio 死锁判定超时（毫秒），默认 30_000 */
  deadlockTimeoutMs: number;
}

/**
 * McpGuardState — MCP 守护进程状态
 */
export interface McpGuardState {
  /** MCP 服务名称 */
  name: string;

  /** 当前状态 */
  status: 'healthy' | 'degraded' | 'unhealthy' | 'restarting' | 'dead';

  /** 已重启次数 */
  restartCount: number;

  /** 连续健康检查失败次数 */
  consecutiveFailures: number;

  /** 上次健康检查时间 */
  lastPingAt: number;

  /** 上次成功响应时间 */
  lastPongAt: number;

  /** 平均响应延迟（毫秒） */
  avgLatencyMs: number;

  /** 进程 PID */
  pid?: number;

  /** 进程启动时间 */
  startTime: number;
}

/**
 * CheckpointConfig — 检查点管理器配置
 */
export interface CheckpointConfig {
  /** 是否启用（默认 true） */
  enabled: boolean;

  /** 内存快照最大保留数 */
  maxSnapshots: number;

  /** 是否持久化快照到磁盘 */
  persistToDisk: boolean;

  /** 持久化路径 */
  persistencePath: string;

  /** 是否启用自动快照（每个 DAG 节点前） */
  autoCheckpoint: boolean;
}

/**
 * Checkpoint — 状态检查点
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string;

  /** 执行 ID */
  executionId: string;

  /** 工作流 ID */
  workflowId: string;

  /** 快照时的 DAG 节点索引 */
  nodeIndex: number;

  /** 快照时的 DAG 节点 ID */
  nodeId: string;

  /** 不可变的 WorkflowState 深度克隆 */
  state: unknown;

  /** 血缘图谱快照（序列化） */
  lineageSnapshot?: string;

  /** 创建时间 */
  timestamp: number;

  /** 检查点类型 */
  type: 'auto' | 'manual' | 'error_boundary';
}

/**
 * RollbackResult — 回滚执行结果
 */
export interface RollbackResult {
  /** 是否回滚成功 */
  success: boolean;

  /** 回滚到的检查点 ID */
  checkpointId: string;

  /** 新重试策略 */
  retryStrategy: RetryStrategy;

  /** 额外注入的上下文 */
  injectedContext?: string;
}

/**
 * RetryStrategy — 重试策略
 */
export interface RetryStrategy {
  /** 降级的系统提示词（可选） */
  degradedPrompt?: string;

  /** 切换的备用模型端点 */
  fallbackModel?: string;

  /** 重试时的温度参数 */
  temperature?: number;

  /** 最大重试次数 */
  maxRetries: number;

  /** 当前重试计数 */
  attempt: number;
}

// ═══════════════════════════════════════════════════════════════
// 引擎生命周期事件（扩展钩子）
// ═══════════════════════════════════════════════════════════════

/**
 * EngineLifecycleHook — 引擎生命周期钩子类型枚举
 */
export type EngineLifecycleHook =
  | 'beforeNodeExecute'
  | 'afterNodeExecute'
  | 'beforeStateMerge'
  | 'afterStateMerge'
  | 'beforeLLMCall'
  | 'afterLLMCall'
  | 'onFatalError'
  | 'onCheckpoint'
  | 'onRollback';

/**
 * BeforeNodeExecutePayload — beforeNodeExecute 钩子载荷
 */
export interface BeforeNodeExecutePayload {
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  nodeIndex: number;
  state: unknown;
  timestamp: number;
}

/**
 * AfterNodeExecutePayload — afterNodeExecute 钩子载荷
 */
export interface AfterNodeExecutePayload {
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  success: boolean;
  artifactRefs: ArtifactRef[];
  durationMs: number;
  error?: string;
  timestamp: number;
}

/**
 * BeforeLLMCallPayload — beforeLLMCall 钩子载荷
 */
export interface BeforeLLMCallPayload {
  executionId: string;
  nodeId: string;
  domainId: string;
  task: string;
  tools: string[];
  systemPrompt?: string;
  /** 原始上下文片段（ContextPruner 会修改此数组） */
  contextSegments: ContextSegment[];
  /** 血缘图谱引用（ContextPruner 用于拓扑剪枝） */
  lineageGraph?: LineageGraph;
  timestamp: number;
}

/**
 * AfterLLMCallPayload — afterLLMCall 钩子载荷
 */
export interface AfterLLMCallPayload {
  executionId: string;
  nodeId: string;
  domainId: string;
  success: boolean;
  content: string;
  toolCalls: unknown[];
  artifactRefs: ArtifactRef[];
  durationMs: number;
  error?: string;
  timestamp: number;
}

/**
 * OnFatalErrorPayload — onFatalError 钩子载荷
 */
export interface OnFatalErrorPayload {
  executionId: string;
  workflowId: string;
  nodeId: string;
  error: Error;
  state: unknown;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 扩展定义接口
// ═══════════════════════════════════════════════════════════════

/**
 * ExtensionDefinition — 内核扩展模块接口
 *
 * 所有三大模块（LineageTracker、ContextPruner、McpProcessGuard、CheckpointManager）
 * 都必须实现此接口。通过 ExtensionRegistry 注册。
 */
export interface ExtensionDefinition {
  /** 扩展唯一名称 */
  name: string;

  /** 版本号 */
  version: string;

  /** 依赖的其他扩展名称列表 */
  dependencies?: string[];

  /** 是否启用（可运行时切换） */
  enabled: boolean;

  /**
   * 初始化扩展
   * @param context - 扩展上下文（提供 EventBus、配置等）
   */
  initialize(context: ExtensionContext): Promise<void>;

  /**
   * 启动扩展（注册钩子、开启监听）
   */
  start(): Promise<void>;

  /**
   * 停止扩展（取消所有钩子、关闭资源）
   */
  stop(): Promise<void>;

  /**
   * 获取扩展运行时状态
   */
  getStatus(): ExtensionStatus;
}

/**
 * ExtensionContext — 扩展上下文
 *
 * 提供给每个扩展的依赖注入容器。
 */
export interface ExtensionContext {
  /** EventBus 实例（只读接口） */
  eventBus: {
    on(type: string, handler: (event: any) => void): () => void;
    once(type: string, handler: (event: any) => void): void;
    emit(event: any): void;
    off(type: string, handler: (event: any) => void): void;
    getHistory(type?: string): any[];
  };

  /** 扩展配置 */
  config: Record<string, unknown>;

  /** 扩展注册表（用于查询其他扩展） */
  registry: ExtensionRegistry;

  /** 日志记录器 */
  logger: ExtensionLogger;
}

/**
 * ExtensionRegistry — 扩展注册表接口
 */
export interface ExtensionRegistry {
  /** 注册扩展 */
  register(extension: ExtensionDefinition): void;

  /** 获取扩展 */
  get<T extends ExtensionDefinition>(name: string): T | undefined;

  /** 获取所有已注册扩展 */
  getAll(): ExtensionDefinition[];

  /** 启动所有扩展（按依赖拓扑排序） */
  startAll(): Promise<void>;

  /** 停止所有扩展 */
  stopAll(): Promise<void>;

  /** 获取扩展数量 */
  count: number;

  /** 获取所有扩展状态 */
  getStatus(): Array<{ name: string; enabled: boolean; status: string }>;
}

/**
 * ExtensionStatus — 扩展运行时状态
 */
export interface ExtensionStatus {
  /** 扩展名称 */
  name: string;

  /** 是否启用 */
  enabled: boolean;

  /** 运行时阶段 */
  phase: 'uninitialized' | 'initialized' | 'running' | 'stopped' | 'error';

  /** 启动时间 */
  startedAt?: number;

  /** 运行时长（毫秒） */
  uptime?: number;

  /** 最后一次错误 */
  lastError?: string;

  /** 扩展特定指标 */
  metrics?: Record<string, number | string>;
}

/**
 * ExtensionLogger — 扩展日志接口
 */
export interface ExtensionLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════
// 组合配置
// ═══════════════════════════════════════════════════════════════

/**
 * KernelExtensionsConfig — 所有内核扩展的顶层配置
 */
export interface KernelExtensionsConfig {
  /** 产物血缘追踪器配置 */
  lineageTracker: LineageTrackerConfig;

  /** 上下文智能引擎配置 */
  contextPruner: ContextPrunerConfig;

  /** MCP 看门狗配置（Phase 3） */
  mcpGuard?: McpGuardConfig;

  /** 检查点管理器配置（Phase 3） */
  checkpoint?: CheckpointConfig;

  /** 全局开关：一键禁用所有扩展 */
  globallyEnabled: boolean;
}

/**
 * DEFAULT_EXTENSIONS_CONFIG — 内核扩展默认配置
 */
export const DEFAULT_EXTENSIONS_CONFIG: KernelExtensionsConfig = {
  globallyEnabled: true,

  lineageTracker: {
    enabled: true,
    maxNodes: 100_000,
    computeHash: true,
    hashTimeoutMs: 5_000,
    persistToDisk: true,
    persistencePath: './data/lineage/',
  },

  contextPruner: {
    enabled: true,
    offloadThresholdBytes: 10_240, // 10KB
    offloadDir: './data/morpex/artifacts/',
    maxTokensBudget: 100_000,
    enableTopologicalPruning: true,
    maxUpstreamDepth: 5,
    artifactPointerTemplate: '[Artifact Link: {name} ({size}) - Click to load on demand]',
    includeLineageSummary: true,
  },

  mcpGuard: {
    enabled: true,
    pingIntervalMs: 5_000,
    pingTimeoutMs: 3_000,
    maxConsecutiveFailures: 3,
    restartCooldownMs: 10_000,
    maxRestarts: 5,
    enableDeadlockDetection: true,
    deadlockTimeoutMs: 30_000,
  },

  checkpoint: {
    enabled: true,
    maxSnapshots: 20,
    persistToDisk: true,
    persistencePath: './data/checkpoints/',
    autoCheckpoint: true,
  },
};
