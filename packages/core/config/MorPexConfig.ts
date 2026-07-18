/**
 * MorPexConfig — 全局配置中心
 *
 * 集中管理所有硬编码值，统一通过环境变量 + 默认值注入。
 * 
 * 设计原则：
 *   1. 所有模块只能通过此配置读取阈值/路径/模型名等参数
 *   2. 环境变量优先，其次是配置文件注入，最后是代码默认值
 *   3. 配置变更通过 MorPexConfig.update() 运行时注入
 *
 * 用法：
 *   import { config } from '../config/MorPexConfig.js';
 *   console.log(config.idleTimeoutMs);
 *
 * @VALIDATE-TODO 来源 (已迁移至 engine/ + mcp/ 模块):
 *   - AgentFactory L84-85: modelProvider, modelId
 *   - AgentFactory L102: quotaInitialConsumption
 *   - ToolExecutionProxy L26-27: workerTimeoutMs, workerMaxMemoryMB
 *   - EventStore L66: eventLogPath
 *   - EventBus L14: eventBusMaxHistory

 *   - DomainCluster L57: domainTokenLimit
 *   - MemoryHooks L51: memoryImportance
 *   - EventStoreSubscriber L53/L69: errorCounterEnabled
 */

export interface MorPexConfigValues {
  // ═══════════════════════════════════════════════
  // WorkflowRegistry
  // ═══════════════════════════════════════════════
  /** 领域空闲超时（毫秒），默认 10 分钟 */
  idleTimeoutMs: number;

  // ═══════════════════════════════════════════════
  // AgentFactory
  // ═══════════════════════════════════════════════
  /** Agent 默认模型提供商 */
  modelProvider: string;
  /** Agent 默认模型 ID */
  modelId: string;
  /** 每次 spawn 消耗的配额量 */
  quotaInitialConsumption: number;

  // ═══════════════════════════════════════════════
  // ToolExecutionProxy (Worker)
  // ═══════════════════════════════════════════════
  /** Worker 超时（毫秒），默认 120s */
  workerTimeoutMs: number;
  /** Worker 内存上限（MB），默认 512MB */
  workerMaxMemoryMB: number;

  // ═══════════════════════════════════════════════
  // EventStore
  // ═══════════════════════════════════════════════
  /** 事件日志路径 */
  eventLogPath: string;

  // ═══════════════════════════════════════════════
  // EventBus
  // ═══════════════════════════════════════════════
  /** 事件历史最大保留条数 */
  eventBusMaxHistory: number;

  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  // FSMEngine
  // ═══════════════════════════════════════════════
  /** 任务超时（毫秒），默认 300s */
  taskTimeout: number;
  /** FSM 引擎默认模型提供商 */
  fsmModelProvider: string;
  /** FSM 引擎默认模型 ID */
  fsmModelId: string;

  // ═══════════════════════════════════════════════
  // DomainCluster
  // ═══════════════════════════════════════════════
  /** 领域默认配额上限 */
  domainTokenLimit: number;

  // ═══════════════════════════════════════════════
  // MemoryHooks
  // ═══════════════════════════════════════════════
  /** 记忆默认重要性 */
  memoryImportance: number;

  // ═══════════════════════════════════════════════
  // EventStoreSubscriber
  // ═══════════════════════════════════════════════
  /** 持久化错误计数上限 */
  persistenceErrorThreshold: number;
}

/** 默认配置值 */
const DEFAULT_CONFIG: MorPexConfigValues = {
  // WorkflowRegistry
  idleTimeoutMs: 10 * 60 * 1000,

  // AgentFactory
  modelProvider: 'deepseek',
  modelId: 'deepseek-v4-flash',
  quotaInitialConsumption: 1000,

  // ToolExecutionProxy
  workerTimeoutMs: 120_000,
  workerMaxMemoryMB: 512,

  // EventStore
  eventLogPath: './data/events/event-store.jsonl',

  // EventBus
  eventBusMaxHistory: 1000,

  // FSMEngine
  taskTimeout: 300_000,
  fsmModelProvider: 'deepseek',
  fsmModelId: 'deepseek-v4-flash',

  // DomainCluster
  domainTokenLimit: 2_000_000,

  // MemoryHooks
  memoryImportance: 3,

  // EventStoreSubscriber
  persistenceErrorThreshold: 100,
};

/**
 * 读取环境变量覆盖
 */
function envOverrides(): Partial<MorPexConfigValues> {
  const env = process.env;
  const overrides: Partial<MorPexConfigValues> = {};

  if (env.MORPEX_IDLE_TIMEOUT_MS) overrides.idleTimeoutMs = parseInt(env.MORPEX_IDLE_TIMEOUT_MS, 10);
  if (env.MORPEX_MODEL_PROVIDER) overrides.modelProvider = env.MORPEX_MODEL_PROVIDER;
  if (env.MORPEX_MODEL_ID) overrides.modelId = env.MORPEX_MODEL_ID;
  if (env.MORPEX_QUOTA_INITIAL) overrides.quotaInitialConsumption = parseInt(env.MORPEX_QUOTA_INITIAL, 10);
  if (env.MORPEX_WORKER_TIMEOUT_MS) overrides.workerTimeoutMs = parseInt(env.MORPEX_WORKER_TIMEOUT_MS, 10);
  if (env.MORPEX_WORKER_MEMORY_MB) overrides.workerMaxMemoryMB = parseInt(env.MORPEX_WORKER_MEMORY_MB, 10);
  if (env.MORPEX_EVENT_LOG_PATH) overrides.eventLogPath = env.MORPEX_EVENT_LOG_PATH;
  if (env.MORPEX_EVENT_BUS_HISTORY) overrides.eventBusMaxHistory = parseInt(env.MORPEX_EVENT_BUS_HISTORY, 10);

  if (env.MORPEX_TASK_TIMEOUT_MS) overrides.taskTimeout = parseInt(env.MORPEX_TASK_TIMEOUT_MS, 10);
  if (env.MORPEX_FSM_MODEL_PROVIDER) overrides.fsmModelProvider = env.MORPEX_FSM_MODEL_PROVIDER;
  if (env.MORPEX_FSM_MODEL_ID) overrides.fsmModelId = env.MORPEX_FSM_MODEL_ID;
  if (env.MORPEX_DOMAIN_TOKEN_LIMIT) overrides.domainTokenLimit = parseInt(env.MORPEX_DOMAIN_TOKEN_LIMIT, 10);
  if (env.MORPEX_MEMORY_IMPORTANCE) overrides.memoryImportance = parseInt(env.MORPEX_MEMORY_IMPORTANCE, 10);
  if (env.MORPEX_PERSISTENCE_ERROR_THRESHOLD) overrides.persistenceErrorThreshold = parseInt(env.MORPEX_PERSISTENCE_ERROR_THRESHOLD, 10);

  return overrides;
}

class MorPexConfigManager {
  private values: MorPexConfigValues;

  constructor() {
    this.values = { ...DEFAULT_CONFIG, ...envOverrides() };
  }

  /** 获取当前配置（只读副本） */
  get(): MorPexConfigValues {
    return { ...this.values };
  }

  /** 运行时更新配置 */
  update(partial: Partial<MorPexConfigValues>): void {
    this.values = { ...this.values, ...partial };
  }

  /** 重置为默认值 */
  reset(): void {
    this.values = { ...DEFAULT_CONFIG, ...envOverrides() };
  }

  // ── 便捷访问器（避免每次 .get()） ──
  get idleTimeoutMs() { return this.values.idleTimeoutMs; }
  get modelProvider() { return this.values.modelProvider; }
  get modelId() { return this.values.modelId; }
  get quotaInitialConsumption() { return this.values.quotaInitialConsumption; }
  get workerTimeoutMs() { return this.values.workerTimeoutMs; }
  get workerMaxMemoryMB() { return this.values.workerMaxMemoryMB; }
  get eventLogPath() { return this.values.eventLogPath; }
  get eventBusMaxHistory() { return this.values.eventBusMaxHistory; }

  get taskTimeout() { return this.values.taskTimeout; }
  get fsmModelProvider() { return this.values.fsmModelProvider; }
  get fsmModelId() { return this.values.fsmModelId; }
  get domainTokenLimit() { return this.values.domainTokenLimit; }
  get memoryImportance() { return this.values.memoryImportance; }
  get persistenceErrorThreshold() { return this.values.persistenceErrorThreshold; }
}

/** 全局配置实例 */
export const config = new MorPexConfigManager();
