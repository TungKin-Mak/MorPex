/**
 * ExecutionFSM — 执行状态机
 *
 * MorPex Runtime 执行状态管理。
 * 管理 Agent 执行的生命周期状态转换。
 *
 * States:
 *   CREATED → PLANNING → READY → EXECUTING ⇄ WAITING
 *                                              ↓
 *                                         REVIEWING → COMPLETED
 *                                              ↓
 *                                         FAILED / CANCELLED
 *
 * Features:
 *   - 状态转换验证
 *   - 状态持久化 (JSONL)
 *   - 状态恢复
 *   - 事件发射
 *   - 审计日志
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 状态定义 ──

export enum ExecutionState {
  CREATED    = 'CREATED',
  PLANNING   = 'PLANNING',
  READY      = 'READY',
  EXECUTING  = 'EXECUTING',
  WAITING    = 'WAITING',
  REVIEWING  = 'REVIEWING',
  RECOVERING = 'RECOVERING',
  COMPLETED  = 'COMPLETED',
  FAILED     = 'FAILED',
  CANCELLED  = 'CANCELLED',
}

// ── 有效转换映射 ──

const VALID_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  [ExecutionState.CREATED]:    [ExecutionState.PLANNING],
  [ExecutionState.PLANNING]:   [ExecutionState.READY, ExecutionState.FAILED],
  [ExecutionState.READY]:      [ExecutionState.EXECUTING, ExecutionState.CANCELLED],
  [ExecutionState.EXECUTING]:  [ExecutionState.WAITING, ExecutionState.REVIEWING, ExecutionState.FAILED],
  [ExecutionState.WAITING]:    [ExecutionState.EXECUTING, ExecutionState.REVIEWING, ExecutionState.CANCELLED],
  [ExecutionState.REVIEWING]:  [ExecutionState.RECOVERING, ExecutionState.COMPLETED, ExecutionState.FAILED],
  [ExecutionState.RECOVERING]: [ExecutionState.EXECUTING, ExecutionState.FAILED, ExecutionState.CANCELLED],
  [ExecutionState.COMPLETED]:  [],
  [ExecutionState.FAILED]:     [],
  [ExecutionState.CANCELLED]:  [],
};

// ── 事件类型 ──

export interface StateTransitionEvent {
  executionId: string;
  from: ExecutionState;
  to: ExecutionState;
  timestamp: number;
  reason?: string;
}

export interface ExecutionAuditEntry {
  executionId: string;
  from: ExecutionState;
  to: ExecutionState;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// ── 状态持久化格式 ──

export interface ExecutionSnapshot {
  executionId: string;
  currentState: ExecutionState;
  history: ExecutionAuditEntry[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

// ── FSM 配置 ──

export interface ExecutionFSMConfig {
  /** 执行 ID */
  executionId: string;
  /** 持久化目录 (默认 ./data/fsm/) */
  persistDir?: string;
  /** 自动持久化 */
  autoPersist?: boolean;
  /** 状态转换回调 */
  onTransition?: (event: StateTransitionEvent) => void;
  /** Phase A1: 进入状态回调 */
  onEnter?: (state: ExecutionState, event: StateTransitionEvent) => void;
  /** Phase A1: 离开状态回调 */
  onExit?: (state: ExecutionState, event: StateTransitionEvent) => void;
  /** Phase A1: 状态超时(ms)，0=无超时 */
  stateTimeout?: number;
}

// ── FSM 类 ──

export class ExecutionFSM {
  private _currentState: ExecutionState;
  private _history: ExecutionAuditEntry[] = [];
  private _config: Required<ExecutionFSMConfig>;
  private _createdAt: number;
  private _updatedAt: number;

  private _metadata: Record<string, unknown> = {};

  constructor(config: ExecutionFSMConfig) {
    this._config = {
      executionId: config.executionId,
      persistDir: config.persistDir ?? './data/fsm',
      autoPersist: config.autoPersist ?? true,
      onTransition: config.onTransition ?? (() => {}),
      onEnter: config.onEnter ?? (() => {}),
      onExit: config.onExit ?? (() => {}),
      stateTimeout: config.stateTimeout ?? 0,
    };
    this._currentState = ExecutionState.CREATED;
    this._createdAt = Date.now();
    this._updatedAt = Date.now();

    // 确保持久化目录存在
    if (this._config.autoPersist) {
      fs.mkdirSync(this._config.persistDir, { recursive: true });
    }
  }

  /** Phase A1: 设置执行元数据 */
  setMetadata(meta: Record<string, unknown>): void {
    this._metadata = { ...this._metadata, ...meta };
  }
  getMetadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  // ── 公共属性 ──

  get currentState(): ExecutionState { return this._currentState; }
  get executionId(): string { return this._config.executionId; }
  get history(): readonly ExecutionAuditEntry[] { return this._history; }
  get createdAt(): number { return this._createdAt; }
  get updatedAt(): number { return this._updatedAt; }

  get isTerminal(): boolean {
    return this._currentState === ExecutionState.COMPLETED
        || this._currentState === ExecutionState.FAILED
        || this._currentState === ExecutionState.CANCELLED;
  }

  get isRunning(): boolean {
    return !this.isTerminal && this._currentState !== ExecutionState.CREATED;
  }

  // ── 状态转换 ──

  /**
   * 检查是否可以转换到目标状态
   */
  canTransition(to: ExecutionState): boolean {
    const allowed = VALID_TRANSITIONS[this._currentState];
    return allowed.includes(to);
  }

  /**
   * 获取允许的下一个状态列表
   */
  getAllowedNextStates(): ExecutionState[] {
    return [...VALID_TRANSITIONS[this._currentState]];
  }

  /**
   * 转换到新状态
   * @throws 如果转换无效则抛出错误
   */
  transition(to: ExecutionState, reason?: string, metadata?: Record<string, unknown>): StateTransitionEvent {
    if (!this.canTransition(to)) {
      throw new Error(
        `[ExecutionFSM] Invalid transition: ${this._currentState} → ${to}. `
        + `Allowed: [${VALID_TRANSITIONS[this._currentState].join(', ')}]`
      );
    }

    const from = this._currentState;
    const timestamp = Date.now();

    // 构建转换事件
    const event: StateTransitionEvent = {
      executionId: this._config.executionId,
      from,
      to,
      timestamp,
      reason,
    };

    // Phase A1: exit 事件（离开旧状态）
    this._config.onExit(from, event);

    // 执行状态变更
    this._currentState = to;
    this._updatedAt = timestamp;
    if (metadata) this._metadata = { ...this._metadata, ...metadata };

    // 审计日志（记录 enter + exit 语义）
    const exitEntry: ExecutionAuditEntry = {
      executionId: this._config.executionId,
      from,
      to: from, // exit event
      timestamp,
      reason: reason ? `exit: ${reason}` : 'exit',
      metadata: { phase: 'exit', ...metadata },
    };
    const enterEntry: ExecutionAuditEntry = {
      executionId: this._config.executionId,
      from: to,
      to, // enter event
      timestamp,
      reason: reason ? `enter: ${reason}` : 'enter',
      metadata: { phase: 'enter', ...metadata },
    };
    this._history.push(exitEntry);
    this._history.push(enterEntry);

    // Phase A1: enter 事件（进入新状态）
    this._config.onEnter(to, event);

    // 转换事件
    this._config.onTransition(event);

    // 自动持久化
    if (this._config.autoPersist) {
      this.persist().catch(err => {
        console.warn(`[ExecutionFSM] Persist failed: ${(err as Error).message}`);
      });
    }

    return event;
  }

  // ── 便捷转换方法 ──

  startPlanning(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.PLANNING, reason);
  }

  markReady(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.READY, reason);
  }

  startExecution(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.EXECUTING, reason);
  }

  wait(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.WAITING, reason);
  }

  resume(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.EXECUTING, reason);
  }

  review(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.REVIEWING, reason);
  }

  recover(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.RECOVERING, reason);
  }

  complete(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.COMPLETED, reason);
  }

  fail(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.FAILED, reason);
  }

  cancel(reason?: string): StateTransitionEvent {
    return this.transition(ExecutionState.CANCELLED, reason);
  }

  // ── 持久化 ──

  /**
   * 持久化当前状态到 JSONL 文件
   */
  async persist(): Promise<void> {
    const snapshot: ExecutionSnapshot = {
      executionId: this._config.executionId,
      currentState: this._currentState,
      history: this._history,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      metadata: { ...this._metadata },
    };

    const filePath = path.join(this._config.persistDir, `${this._config.executionId}.jsonl`);
    await fs.promises.appendFile(filePath, JSON.stringify(snapshot) + '\n', 'utf-8');
  }

  /**
   * 从 JSONL 文件恢复状态
   */
  static async restore(executionId: string, persistDir: string): Promise<ExecutionFSM | null> {
    const filePath = path.join(persistDir, `${executionId}.jsonl`);
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const lines = data.trim().split('\n');
      if (lines.length === 0) return null;

      // 取最后一行（最新快照）
      const lastLine = lines[lines.length - 1];
      const snapshot: ExecutionSnapshot = JSON.parse(lastLine);

      const fsm = new ExecutionFSM({
        executionId: snapshot.executionId,
        persistDir,
        autoPersist: true,
      });

      // 恢复到最新状态
      fsm._currentState = snapshot.currentState;
      fsm._history = snapshot.history;
      fsm._createdAt = snapshot.createdAt;
      fsm._updatedAt = snapshot.updatedAt;
      fsm._metadata = snapshot.metadata || {};

      return fsm;
    } catch {
      return null;
    }
  }

  /**
   * 列出所有已持久化的执行
   */
  static async listExecutions(persistDir: string): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(persistDir);
      return files
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''));
    } catch {
      return [];
    }
  }

  // ── 审计 ──

  /**
   * 获取完整的审计日志
   */
  getAuditLog(): ExecutionAuditEntry[] {
    return [...this._history];
  }

  /**
   * 获取状态统计信息
   */
  getStats(): { totalTransitions: number; duration: number; terminalState: boolean } {
    return {
      totalTransitions: this._history.length,
      duration: this._updatedAt - this._createdAt,
      terminalState: this.isTerminal,
    };
  }
}
