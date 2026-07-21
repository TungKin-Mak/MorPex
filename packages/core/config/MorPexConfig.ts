/**
 * MorPexConfig v9 — 全局配置中心 + Zod Schema 校验
 *
 * 统一管理所有配置参数，支持：
 *   - Zod runtime schema 校验（类型安全 + 默认值 + 边界检测）
 *   - 环境变量覆盖（MORPEX_* 前缀）
 *   - 动态热更新 + change listener
 *   - 向后兼容旧版访问器
 *
 * 使用方式：
 *   import { config } from '../config/MorPexConfig.js';
 *   if (config.distributed.enabled) { ... }
 *   config.update({ marketplace: { enabled: true } });
 *   const unsubscribe = config.onChange((newCfg, oldCfg) => { ... });
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// Zod Schema — 每个子配置独立定义以便复用
// ═══════════════════════════════════════════════════════════════

const PersistenceSchema = z.object({
  /** SQLite 数据库文件路径 */
  dbPath: z.string().default('./data/morpex-events.db'),
  /** 是否启用 WAL 模式 */
  walMode: z.boolean().default(true),
  /** 内存中最大事件缓存数 */
  maxInMemoryEvents: z.number().int().min(1000).default(100000),
  /** 每次批量刷写的事件数 */
  batchFlushSize: z.number().int().min(1).max(1000).default(100),
  /** 每上下文最大快照数 */
  contextMaxSnapshots: z.number().int().min(5).default(50),
  /** 每产物最大版本数 */
  artifactMaxVersions: z.number().int().min(3).default(20),
});

const AgentSchema = z.object({
  /** Agent 默认 TTL (ms) */
  defaultTTLMs: z.number().int().positive().default(300_000),
  /** Agent 最大并发任务数 */
  maxConcurrentTasks: z.number().int().min(1).max(50).default(5),
  /** 协商超时 (ms) */
  negotiationTimeoutMs: z.number().int().positive().default(30_000),
  /** 协作超时 (ms) */
  collaborationTimeoutMs: z.number().int().positive().default(120_000),
  /** 信任衰减率 (0-1, 每次失败任务衰减量) */
  trustDecayRate: z.number().min(0).max(1).default(0.01),
  /** 自动优化间隔 (ms, 0 = 禁用) */
  autoOptimizeIntervalMs: z.number().int().min(0).default(3_600_000),
});

const ContextSchema = z.object({
  /** 是否启用版本快照 */
  enableVersioning: z.boolean().default(true),
  /** 是否启用增强流水线 */
  enableEnrichment: z.boolean().default(true),
  /** 最大上下文片段数 */
  maxFragments: z.number().int().min(1).max(500).default(50),
  /** 每片段采集超时 (ms) */
  fragmentTimeoutMs: z.number().int().positive().default(5_000),
  /** Schema 版本号 */
  schemaVersion: z.string().default('1.0'),
});

const ArtifactSchema = z.object({
  /** 是否启用自动验证 */
  enableAutoVerify: z.boolean().default(true),
  /** 产物最大内容大小 (bytes, 默认 10MB) */
  maxContentSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
  /** 暂存区 TTL (ms) */
  stagingTTLMs: z.number().int().positive().default(300_000),
  /** 允许的产物类型列表 */
  allowedTypes: z.array(z.string()).default([
    'code', 'document', 'config', 'schema', 'report',
    'image', 'video_script', 'structured_data', 'plan', 'other',
  ]),
});

const DistributedSchema = z.object({
  /** 是否启用分布式模式 */
  enabled: z.boolean().default(false),
  /** 传输模式 */
  transportMode: z.enum(['ws', 'grpc', 'memory']).default('memory'),
  /** 心跳间隔 (ms) */
  heartbeatIntervalMs: z.number().int().positive().default(10_000),
  /** 心跳超时 (ms, 超过此时间未收到心跳视为离线) */
  heartbeatTimeoutMs: z.number().int().positive().default(30_000),
  /** 最大重连尝试次数 */
  maxReconnectAttempts: z.number().int().min(0).default(5),
  /** 本机节点 ID */
  nodeId: z.string().min(1).default('node-1'),
  /** 绑定地址 */
  bindAddress: z.string().default('localhost'),
  /** 绑定端口 */
  bindPort: z.number().int().min(1024).max(65535).default(9527),
});

const MarketplaceSchema = z.object({
  /** 是否启用 Agent 市场 */
  enabled: z.boolean().default(false),
  /** 市场发现服务 URL */
  discoveryUrl: z.string().default(''),
  /** 投标超时 (ms) */
  bidTimeoutMs: z.number().int().positive().default(30_000),
  /** 每 Agent 最大列表数 */
  maxListingsPerAgent: z.number().int().min(1).default(10),
  /** 信任阈值 (低于此值的第三方 Agent 需要人工审批) */
  trustThreshold: z.number().min(0).max(1).default(0.3),
});

// ═══════════════════════════════════════════════════════════════
// 主 Schema
// ═══════════════════════════════════════════════════════════════

export const MorPexConfigSchema = z.object({
  // ── Legacy (v4.0-v8.9) ──
  idleTimeoutMs: z.number().int().positive().default(600_000),
  modelProvider: z.string().default('deepseek'),
  modelId: z.string().default('deepseek-v4-flash'),
  quotaInitialConsumption: z.number().int().positive().default(1000),
  workerTimeoutMs: z.number().int().positive().default(120_000),
  workerMaxMemoryMB: z.number().int().positive().default(512),
  eventLogPath: z.string().default('./data/events/event-store.jsonl'),
  eventBusMaxHistory: z.number().int().positive().default(1000),
  taskTimeout: z.number().int().positive().default(300_000),
  fsmModelProvider: z.string().default('deepseek'),
  fsmModelId: z.string().default('deepseek-v4-flash'),
  domainTokenLimit: z.number().int().positive().default(2_000_000),
  memoryImportance: z.number().int().min(0).max(10).default(3),
  persistenceErrorThreshold: z.number().int().positive().default(100),

  // ── v9 Sectional Configs (defaults computed via schema.parse to ensure field-level defaults apply) ──
  persistence: PersistenceSchema.default(PersistenceSchema.parse({})),
  agent: AgentSchema.default(AgentSchema.parse({})),
  context: ContextSchema.default(ContextSchema.parse({})),
  artifact: ArtifactSchema.default(ArtifactSchema.parse({})),
  distributed: DistributedSchema.default(DistributedSchema.parse({})),
  marketplace: MarketplaceSchema.default(MarketplaceSchema.parse({})),
});

export type MorPexConfig = z.infer<typeof MorPexConfigSchema>;

// ═══════════════════════════════════════════════════════════════
// 环境变量覆盖（MORPEX_* 前缀）
// ═══════════════════════════════════════════════════════════════

function envOverrides(): Partial<Record<string, unknown>> {
  const env = process.env;
  const overrides: Record<string, unknown> = {};

  // ── Legacy env vars ──
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

  // ── v9 env vars (sectional) ──
  if (env.MORPEX_DB_PATH) {
    overrides.persistence = { ...((overrides.persistence as object) ?? {}), dbPath: env.MORPEX_DB_PATH };
  }
  if (env.MORPEX_AGENT_DEFAULT_TTL_MS) {
    overrides.agent = { ...((overrides.agent as object) ?? {}), defaultTTLMs: parseInt(env.MORPEX_AGENT_DEFAULT_TTL_MS, 10) };
  }
  if (env.MORPEX_AGENT_MAX_CONCURRENT) {
    overrides.agent = { ...((overrides.agent as object) ?? {}), maxConcurrentTasks: parseInt(env.MORPEX_AGENT_MAX_CONCURRENT, 10) };
  }
  if (env.MORPEX_NEGOTIATION_TIMEOUT_MS) {
    overrides.agent = { ...((overrides.agent as object) ?? {}), negotiationTimeoutMs: parseInt(env.MORPEX_NEGOTIATION_TIMEOUT_MS, 10) };
  }
  if (env.MORPEX_DISTRIBUTED_ENABLED) {
    overrides.distributed = { ...((overrides.distributed as object) ?? {}), enabled: env.MORPEX_DISTRIBUTED_ENABLED === '1' || env.MORPEX_DISTRIBUTED_ENABLED === 'true' };
  }
  if (env.MORPEX_NODE_ID) {
    overrides.distributed = { ...((overrides.distributed as object) ?? {}), nodeId: env.MORPEX_NODE_ID };
  }
  if (env.MORPEX_MARKETPLACE_ENABLED) {
    overrides.marketplace = { ...((overrides.marketplace as object) ?? {}), enabled: env.MORPEX_MARKETPLACE_ENABLED === '1' || env.MORPEX_MARKETPLACE_ENABLED === 'true' };
  }
  if (env.MORPEX_BID_TIMEOUT_MS) {
    overrides.marketplace = { ...((overrides.marketplace as object) ?? {}), bidTimeoutMs: parseInt(env.MORPEX_BID_TIMEOUT_MS, 10) };
  }
  if (env.MORPEX_CONTEXT_MAX_FRAGMENTS) {
    overrides.context = { ...((overrides.context as object) ?? {}), maxFragments: parseInt(env.MORPEX_CONTEXT_MAX_FRAGMENTS, 10) };
  }
  if (env.MORPEX_CONTEXT_FRAGMENT_TIMEOUT_MS) {
    overrides.context = { ...((overrides.context as object) ?? {}), fragmentTimeoutMs: parseInt(env.MORPEX_CONTEXT_FRAGMENT_TIMEOUT_MS, 10) };
  }
  if (env.MORPEX_ARTIFACT_AUTO_VERIFY) {
    overrides.artifact = { ...((overrides.artifact as object) ?? {}), enableAutoVerify: env.MORPEX_ARTIFACT_AUTO_VERIFY === '1' || env.MORPEX_ARTIFACT_AUTO_VERIFY === 'true' };
  }
  if (env.MORPEX_ARTIFACT_MAX_SIZE) {
    overrides.artifact = { ...((overrides.artifact as object) ?? {}), maxContentSizeBytes: parseInt(env.MORPEX_ARTIFACT_MAX_SIZE, 10) };
  }

  return overrides;
}

// ═══════════════════════════════════════════════════════════════
// Configuration Change Listener
// ═══════════════════════════════════════════════════════════════

export type ConfigChangeListener = (newConfig: MorPexConfig, oldConfig: MorPexConfig) => void;

// ═══════════════════════════════════════════════════════════════
// Config Manager
// ═══════════════════════════════════════════════════════════════

class MorPexConfigManager {
  private values: MorPexConfig;
  private listeners: Set<ConfigChangeListener> = new Set();

  constructor() {
    this.values = this.buildConfig();
  }

  /**
   * buildConfig — 合并默认值 + 环境变量覆盖，通过 Zod parse 校验
   */
  private buildConfig(): MorPexConfig {
    const raw = envOverrides();
    const merged: Record<string, unknown> = {};

    // 扁平键直接赋值，嵌套对象合并到对应 key
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // 嵌套对象（如 persistence, agent）— 后续在 deepMerge 中处理
        merged[key] = value;
      } else {
        merged[key] = value;
      }
    }

    // Zod parse 会自动应用所有 default() 值
    return MorPexConfigSchema.parse(merged);
  }

  // ═══════════════════════════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════════════════════════

  /** 获取当前配置的只读快照 */
  get(): Readonly<MorPexConfig> {
    return this.values;
  }

  /**
   * update — 部分更新配置（深合并），触发 change listener
   *
   * @param partial - 要更新的字段
   */
  update(partial: Partial<MorPexConfig>): void {
    const oldValues = { ...this.values };

    // 深合并
    const merged: Record<string, unknown> = { ...this.values };
    for (const [key, value] of Object.entries(partial)) {
      if (
        typeof value === 'object' && value !== null && !Array.isArray(value) &&
        typeof merged[key] === 'object' && merged[key] !== null && !Array.isArray(merged[key])
      ) {
        // 嵌套对象合并（如 update({ persistence: { dbPath: '...' } }) 不丢失其他 persistence 字段）
        merged[key] = { ...(merged[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        merged[key] = value;
      }
    }

    this.values = MorPexConfigSchema.parse(merged);

    // 通知监听器
    for (const listener of this.listeners) {
      try { listener(this.values, oldValues); } catch (err) {
        console.warn('[MorPexConfig] Listener error:', err);
      }
    }
  }

  /**
   * onChange — 注册配置变更监听器
   *
   * @param listener - (newConfig, oldConfig) => void
   * @returns unsubscribe 函数
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 重置为 环境变量 + 默认值 */
  reset(): void {
    this.values = this.buildConfig();
  }

  /**
   * validate — 校验并返回完整配置（不修改当前状态）
   * 用于测试或输入校验
   */
  validate(partial: Record<string, unknown>): MorPexConfig {
    return MorPexConfigSchema.parse(partial);
  }

  /** 导出为格式化的 JSON 字符串 */
  toJSON(): string {
    return JSON.stringify(this.values, null, 2);
  }

  // ═══════════════════════════════════════════════════════════════
  // 向后兼容访问器（旧代码通过 config.xxx 直接访问）
  // ═══════════════════════════════════════════════════════════════

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

  // ── v9 sectional accessors ──
  get persistence() { return this.values.persistence; }
  get agent() { return this.values.agent; }
  get context() { return this.values.context; }
  get artifact() { return this.values.artifact; }
  get distributed() { return this.values.distributed; }
  get marketplace() { return this.values.marketplace; }
}

/** 全局单例配置实例 */
export const config = new MorPexConfigManager();
