/**
 * MorPexCore — 核心接口定义
 *
 * 这是整个 MorPexCore 的类型基础。
 * Event Schema 最先冻结，之后所有 planes/ 插件的开发都基于它展开。
 *
 * ═══ MorPex v8 Phase 1 ═══
 * 事件协议已标准化为 protocol/events/ 模块。
 * 新代码应优先使用以下协议类型：
 *   import { EventType } from '../protocol/events/EventType.js';
 *   import type { BaseEvent } from '../protocol/events/BaseEvent.js';
 * 本文件保持向后兼容，将在后续版本逐步迁移。
 * ═══════════════════════════
 *
 * 设计约束：
 *   - 所有事件必须携带 executionId
 *   - 事件类型命名空间：{domain}.{action}
 *   - Mirror 是 observer，不是 controller
 */

// MorPex v8 事件协议见 ../protocol/events/ （不破坏现有引用）

// ── MorPexEvent — 标准化事件（最先冻结） ──

/**
 * 标准化事件结构
 *
 * @deprecated MorPex v8 起推荐使用 protocol/events/BaseEvent.ts 中的 BaseEvent 接口。
 * BaseEvent 提供相同的结构，但 type 字段支持 EventType 枚举约束。
 * 本接口保持向后兼容，将在后续版本逐步迁移。
 */
export interface MorPexEvent {
  id: string;            // evt_{YYYYMMDD}_{shortUUID}
  type: string;          // {domain}.{action} 如 runtime.tool.called
  timestamp: number;     // Date.now()
  executionId: string;   // 关联的执行 ID
  source: string;        // 事件来源（pi, gateway, kernel, ...）
  payload: any;          // 事件数据
}

// 新代码请直接使用 protocol/events/ 中的类型:
//   import type { BaseEvent } from '../protocol/events/BaseEvent.js';
//   import { EventType } from '../protocol/events/EventType.js';

// ── ExecutionIdentity — 全链路身份 ──

/** 全链路执行身份 */
export interface ExecutionIdentity {
  executionId: string;           // exe_{YYYYMMDD}_{shortUUID}
  traceId: string;               // trc_{YYYYMMDD}_{shortUUID} 全链路追踪
  sessionId: string;             // ses_{YYYYMMDD}_{shortUUID} pi session
  parentExecutionId?: string;    // 父执行 ID（DAG 递归）
  createdAt: number;             // 创建时间戳
}

// ── ExecutionRequest — 执行请求 ──

/** 标准化执行请求 */
export interface ExecutionRequest {
  executionId: string;
  agentRole: string;
  input: unknown;
  context: ExecutionContext;
  constraints?: Constraints;
}

// ── ExecutionResult — 执行结果 ──

/** 标准化执行结果 */
export interface ExecutionResult {
  executionId: string;
  status: 'success' | 'failed' | 'aborted';
  output: any;
  artifacts: string[];
  duration: number;
}

// ── ExecutionContext — 执行上下文 ──

/** 执行上下文 */
export interface ExecutionContext {
  sessionId: string;
  traceId: string;
  parentExecutionId?: string;
  metadata?: Record<string, unknown>;
}

// ── Constraints — 执行约束 ──

/** 执行约束 */
export interface Constraints {
  timeout?: number;
  maxRetries?: number;
  allowedTools?: string[];
}

// ── RuntimeHealth — 运行时健康状态 ──

/** 运行时健康状态 */
export interface RuntimeHealth {
  alive: boolean;
  latency: number;
  version: string;
  details?: Record<string, unknown>;
}

// ── KernelStatus — Kernel 状态 ──

/** Kernel 生命周期状态 */
export interface KernelStatus {
  phase: 'init' | 'starting' | 'running' | 'stopping' | 'stopped';
  uptime: number;
  pluginCount: number;
  activeExecutions: number;
}

// ── AgentRuntimeAdapter — Runtime 适配器接口 ──

/** AgentRuntime 适配器接口 */
export interface AgentRuntimeAdapter {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  abort(executionId: string): Promise<void>;
  subscribe(handler: (event: MorPexEvent) => void): () => void;
  health(): RuntimeHealth;
}

// ── Mirror 数据类型 ──

/** 执行轨迹 */
export interface ExecutionTrace {
  executionId: string;
  runtime: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  duration?: number;
  agentRole: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

/** 上下文快照类型 */
export type SnapshotType = 'before' | 'after' | 'error';

/** 上下文快照 */
export interface ContextSnapshot {
  executionId: string;
  snapshotType: SnapshotType;
  systemPrompt?: string;
  taskInput: unknown;
  toolResults: Array<{ tool: string; input: unknown; output: unknown }>;
  timestamp: number;
}

/** 会话上下文 (原 workflow/types.ts, 已合并至此) */
export interface SessionContext {
  sessionId: string;
  executionId: string;
  input: string;
  artifacts: Record<string, ArtifactRef[]>;
  memory: string[];
  metadata?: Record<string, unknown>;
}

/**
 * ArtifactRef — 跨领域产物引用 (原 domains/types.ts, 已上浮至此)
 *
 * 领域间产物交换使用 URI 引用，而非直接传输内容。
 * 格式: artifact://{domain}/{artifactType}/{artifactId}
 */
export interface ArtifactRef {
  uri: string;
  type: string;
  name: string;
  domain?: string;
}

/**
 * PiAdapterConfig — Pi 适配器配置 (原 gateway/adapters/types.ts, 已合并至此)
 */
export interface PiAdapterConfig {
  /** 运行时标识名（默认 "pi"） */
  runtimeName?: string;
  /** 版本号 */
  version?: string;
}

/** Pi 原生事件类型（来自 AgentRuntime） */
export interface PiRuntimeEvent {
  type: string;
  payload: any;
  timestamp?: number;
}

/** 镜像统计 */
export interface MirrorStats {
  totalExecutions: number;
  totalEvents: number;
  totalSnapshots: number;
  storageSizeBytes: number;
  errorCount: number;
}

// ── MirrorRecord — 镜像存储记录 ──

/** 镜像存储记录（联合类型） */
export type MirrorRecord =
  | { type: 'execution'; data: ExecutionTrace }
  | { type: 'event'; data: MorPexEvent }
  | { type: 'snapshot'; data: ContextSnapshot };

// ── MirrorStorage — 存储接口 ──

/** Mirror 存储后端接口 */
export interface MirrorStorage {
  append(record: MirrorRecord): Promise<void>;
  query(executionId: string): Promise<MirrorRecord[]>;
  getStats(): MirrorStats;
}

// ── EventHandler — 事件处理器 ──

/** 事件处理器类型 */
export type EventHandler = (event: MorPexEvent) => void;

// ── Plugin 接口（最后冻结） ──

/** 插件接口 */
export interface MorPexPlugin {
  name: string;
  version: string;
  dependencies?: string[];
  initialize(context: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** 插件上下文 */
export interface PluginContext {
  eventBus: EventBus;
  executionIdentity: {
    create(options?: { sessionId?: string; parentExecutionId?: string }): ExecutionIdentity;
    createExecutionId(): string;
    createTraceId(): string;
    createSessionId(): string;
    createEventId(): string;
    createArtifactId(): string;
    link(parentId: string, childId: string): void;
    getChain(childId: string): string[];
    parse(id: string): { type: string; date: string; random: string } | null;
  };
  config: Record<string, unknown>;
}

// ── EventBus 接口（供 PluginContext 使用） ──

/** EventBus 接口（提供给插件的视图） */
export interface EventBus {
  emit(event: MorPexEvent): void;
  on(type: string, handler: EventHandler): () => void;
  once(type: string, handler: EventHandler): void;
  off(type: string, handler: EventHandler): void;
  getHistory(type?: string): MorPexEvent[];
  clear(): void;
  listenerCount(type?: string): number;
}

// ── KernelConfig — Kernel 配置 ──

/** Kernel 配置 */
export interface KernelConfig {
  plugins?: MorPexPlugin[];
  mirrorBasePath?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Contracts Bridge — re-export stable contracts for new code
//
// These types come from @morpex/contracts (zero Pi dependency).
// During migration, legacy code continues to use the types above;
// new code and migrated modules should use these contract types.
// ═══════════════════════════════════════════════════════════════════

export type {
  InferencePort,
  GenerateRequest,
  GenerateOptions,
  InferenceMessage,
  InferenceEvent,
  TokenUsage,
  ExecutionContext as ContractsExecutionContext,
} from '@morpex/contracts/inference';

export type {
  AgentRuntimePort,
  AgentRunRequest,
  AgentRuntimeEvent,
  RuntimeCheckpoint,
} from '@morpex/contracts/agent-runtime';

export type {
  ToolDefinition as ContractsToolDefinition,
  ToolCall as ContractsToolCall,
  ToolResult as ContractsToolResult,
  ToolExecutor as ContractsToolExecutor,
} from '@morpex/contracts/tool';

export type {
  RuntimeError as ContractsRuntimeError,
  ErrorCategory,
  classifyError,
} from '@morpex/contracts/errors';

export type {
  InferenceCapabilities,
  AgentRuntimeCapabilities,
  NO_CAPABILITIES,
} from '@morpex/contracts/capabilities';

export type {
  MorPexRuntimeEvent as ContractsRuntimeEvent,
} from '@morpex/contracts/runtime-events';

export type {
  ToolDefinition,
} from '@morpex/contracts/tool';
