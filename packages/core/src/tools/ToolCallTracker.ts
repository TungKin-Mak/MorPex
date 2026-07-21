/**
 * ToolCallTracker — 工具调用生命周期状态追踪（合并版）
 *
 * 基于 AgentScope ToolCallState 设计，提供双重追踪方式：
 *   1. EventBus 驱动（自动）：订阅 runtime.tool.* 事件自动追踪
 *   2. 手动 API（精确）：供 PermissionEngine 等模块直接调用
 *
 * 状态机（与 AgentScope 兼容）:
 * ```
 * PENDING ──(deny/beforeToolCall)──► FINISHED (blocked)
 *   ├──(ask)──────► ASKING ──(user deny)──► FINISHED (rejected)
 *   │                  └──(user approve)──► ALLOWED
 *   └──(allow)──────► ALLOWED
 *                        ├──(local exec)──► SUBMITTED ──(result)──► FINISHED (completed/failed)
 *                        └──(direct exec)──► RUNNING ──► FINISHED
 * ```
 *
 * 集成方式:
 *   PermissionEngine → ToolCallTracker.setAsking() / setAllowed() / setBlocked()
 *   EventBus 事件    → 自动追踪 (通过 start() 订阅)
 *   AgentHarness     → ToolCallTracker.track() 记录新调用
 *
 * @category L3 Business Plane
 */

import type { EventBus, MorPexEvent } from '../common/types.js';

// ── 状态定义 ──

export type ToolCallState =
  | 'PENDING'
  | 'ASKING'
  | 'ALLOWED'
  | 'SUBMITTED'
  | 'RUNNING'
  | 'FINISHED';

export interface ToolCallRecord {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 当前状态 */
  state: ToolCallState;
  /** 关联的 Agent */
  agentId: string;
  /** 领域 */
  domain: string;
  /** 执行 ID */
  executionId: string;
  /** 创建时间 */
  createdAt: number;
  /** 状态变更时间 */
  updatedAt: number;
  /** 结束原因（仅 FINISHED 时有值） */
  finishReason?: 'completed' | 'failed' | 'blocked' | 'rejected' | 'timeout';
  /** 结束详情 */
  error?: string;
  /** 权限决策 */
  permissionDecision?: 'allow' | 'block' | 'ask';
  /** 状态变更时间线 */
  history: Array<{ state: ToolCallState; timestamp: number; reason?: string }>;
  /** 执行结果 */
  result?: unknown;
}

// ── ToolCallTracker ──

export class ToolCallTracker {
  private records: Map<string, ToolCallRecord> = new Map();
  private maxRecords: number;
  private unsubscribers: Array<() => void> = [];
  private eventBus: EventBus | null = null;

  constructor(maxRecords: number = 1000, eventBus?: EventBus) {
    this.maxRecords = maxRecords;
    if (eventBus) {
      this.eventBus = eventBus;
    }
  }

  /**
   * start — 启动追踪（订阅 EventBus 事件）
   */
  start(): void {
    if (!this.eventBus) return;

    this.unsubscribers.push(
      this.eventBus.on('runtime.tool.called', (event: MorPexEvent) => {
        const p = event.payload as any;
        if (!p?.toolCallId) return;
        this.track({
          toolCallId: p.toolCallId,
          toolName: p.toolName ?? 'unknown',
          args: p.args ?? {},
          agentId: p.agentName ?? p.agentId ?? 'unknown',
          domain: p.domainId ?? 'default',
          executionId: event.executionId,
        });
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.tool.execution_start', (event: MorPexEvent) => {
        const p = event.payload as any;
        if (!p?.toolCallId) return;
        this.setState(p.toolCallId, 'SUBMITTED');
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.tool.execution_end', (event: MorPexEvent) => {
        const p = event.payload as any;
        if (!p?.toolCallId) return;
        this.setCompleted(p.toolCallId, p.result);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.tool.finished', (event: MorPexEvent) => {
        const p = event.payload as any;
        if (!p?.toolCallId) return;
        if (p.isError) {
          this.setFailed(p.toolCallId, p.error ?? '工具执行失败');
        } else {
          this.setCompleted(p.toolCallId, p.result);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.tool.failed', (event: MorPexEvent) => {
        const p = event.payload as any;
        if (!p?.toolCallId) return;
        this.setFailed(p.toolCallId, p.error ?? '工具调用失败');
      }),
    );
  }

  /**
   * stop — 停止追踪，取消事件订阅
   */
  stop(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  /**
   * track — 记录一个新 ToolCall（PENDING 状态）
   */
  track(info: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    agentId: string;
    domain: string;
    executionId: string;
  }): ToolCallRecord {
    const now = Date.now();
    const existing = this.records.get(info.toolCallId);
    if (existing) {
      Object.assign(existing, info, { updatedAt: now });
      existing.history.push({ state: existing.state, timestamp: now });
      return existing;
    }
    const record: ToolCallRecord = {
      toolCallId: info.toolCallId,
      toolName: info.toolName,
      args: info.args,
      state: 'PENDING',
      agentId: info.agentId,
      domain: info.domain,
      executionId: info.executionId,
      createdAt: now,
      updatedAt: now,
      history: [{ state: 'PENDING', timestamp: now }],
    };
    this.records.set(info.toolCallId, record);
    this.evict();
    return record;
  }

  /**
   * setAsking — 标记为等待人工确认
   */
  setAsking(toolCallId: string, reason?: string): ToolCallRecord | undefined {
    return this.setState(toolCallId, 'ASKING', reason);
  }

  /**
   * setAllowed — 标记为允许执行
   */
  setAllowed(toolCallId: string): ToolCallRecord | undefined {
    const r = this.setState(toolCallId, 'ALLOWED');
    if (r) r.permissionDecision = 'allow';
    return r;
  }

  /**
   * setBlocked — 标记为被阻止
   */
  setBlocked(toolCallId: string, reason: string): ToolCallRecord | undefined {
    const r = this.setState(toolCallId, 'FINISHED', reason);
    if (r) { r.finishReason = 'blocked'; r.permissionDecision = 'block'; }
    return r;
  }

  /**
   * setSubmitted — 标记为已提交执行
   */
  setSubmitted(toolCallId: string): ToolCallRecord | undefined {
    return this.setState(toolCallId, 'SUBMITTED');
  }

  /**
   * setCompleted — 标记为完成
   */
  setCompleted(toolCallId: string, result?: unknown): ToolCallRecord | undefined {
    const r = this.setState(toolCallId, 'FINISHED');
    if (r) { r.finishReason = 'completed'; r.result = result; }
    return r;
  }

  /**
   * setFailed — 标记为失败
   */
  setFailed(toolCallId: string, error: string): ToolCallRecord | undefined {
    const r = this.setState(toolCallId, 'FINISHED', error);
    if (r) r.finishReason = 'failed';
    return r;
  }

  /**
   * setRejected — 标记为用户拒绝
   */
  setRejected(toolCallId: string): ToolCallRecord | undefined {
    const r = this.setState(toolCallId, 'FINISHED', 'rejected');
    if (r) { r.finishReason = 'rejected'; r.permissionDecision = 'block'; }
    return r;
  }

  // ── 查询方法 ──

  get(toolCallId: string): ToolCallRecord | undefined {
    return this.records.get(toolCallId);
  }

  getState(toolCallId: string): ToolCallState | undefined {
    return this.records.get(toolCallId)?.state;
  }

  getAll(): ToolCallRecord[] {
    return Array.from(this.records.values());
  }

  getByState(state: ToolCallState): ToolCallRecord[] {
    return this.getAll().filter(r => r.state === state);
  }

  getPendingAsks(): ToolCallRecord[] {
    return this.getByState('ASKING');
  }

  getStats() {
    const all = this.getAll();
    return {
      total: all.length,
      pending: all.filter(r => r.state === 'PENDING').length,
      asking: all.filter(r => r.state === 'ASKING').length,
      allowed: all.filter(r => r.state === 'ALLOWED').length,
      submitted: all.filter(r => r.state === 'SUBMITTED').length,
      running: all.filter(r => r.state === 'RUNNING').length,
      finished: all.filter(r => r.state === 'FINISHED').length,
      completed: all.filter(r => r.finishReason === 'completed').length,
      failed: all.filter(r => r.finishReason === 'failed').length,
      blocked: all.filter(r => r.finishReason === 'blocked').length,
      rejected: all.filter(r => r.finishReason === 'rejected').length,
    };
  }

  /** clear — 清空所有记录 */
  clear(): void {
    this.records.clear();
  }

  /** export — 导出全量记录快照 */
  export(): ToolCallRecord[] {
    return this.getAll();
  }

  // ── 内部方法 ──

  private setState(toolCallId: string, state: ToolCallState, reason?: string): ToolCallRecord | undefined {
    const record = this.records.get(toolCallId);
    if (!record) return undefined;
    record.state = state;
    record.updatedAt = Date.now();
    record.history.push({ state, timestamp: Date.now(), reason });
    if (reason) record.error = reason;
    return record;
  }

  private evict(): void {
    if (this.records.size <= this.maxRecords) return;
    const entries = Array.from(this.records.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of entries.slice(0, entries.length - this.maxRecords)) {
      this.records.delete(id);
    }
  }
}

/**
 * createToolCallTracker — ToolCallTracker 工厂函数
 */
export function createToolCallTracker(eventBus?: EventBus): ToolCallTracker {
  return new ToolCallTracker(1000, eventBus);
}
