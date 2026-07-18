/**
 * FSMEngine — 运行时状态机
 *
 * 轻量级状态跟踪引擎。所有状态迁移通过 _check_next_action(event) 动态推导，
 * 无硬编码 TRANSITIONS 表。状态变更通过 EventBus.emit('fsm.transition') 外排事件。
 *
 * 状态流: IDLE → PLANNING → RUNNING → WAITING_TOOL/WAITING_USER → VERIFYING → COMPLETED/FAILED
 */

export type FSMState = 'IDLE' | 'PLANNING' | 'RUNNING' | 'WAITING_TOOL' | 'WAITING_USER' | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'SUSPENDED' | 'CANCELLED';

const LABELS: Record<string, string> = {
  IDLE: '空闲', PLANNING: '规划', RUNNING: '执行中',
  WAITING_TOOL: '等待工具', WAITING_USER: '等待用户',
  VERIFYING: '验证中', COMPLETED: '已完成',
  FAILED: '失败', SUSPENDED: '已挂起', CANCELLED: '已取消',
};

interface TransitionEvent {
  type: string;
  taskId?: string;
  from: string;
  to: string;
  data?: Record<string, unknown>;
}

export class FSMEngine {
  state: FSMState = 'IDLE';
  isSuspended = false;
  isTerminal = false;
  isRunning = false;

  // 回调 hooks
  onTransition?: (event: TransitionEvent) => void;
  onWaitingUser?: () => void;
  onCancel?: () => void;
  onFail?: () => void;
  onMessageDelta?: (delta: string) => void;

  private _context: any = {};
  private _suspendedTasks = new Map<string, any>();
  private _history: TransitionEvent[] = [];
  private _eventBus: any = null;
  private _tracker: any = null;
  private _taskTimeout: number;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _taskId = '';

  constructor(config?: { taskTimeout?: number }) {
    this._taskTimeout = config?.taskTimeout ?? 0;
  }

  private emitTransition(from: string, to: string, data?: Record<string, unknown>): void {
    const ev: TransitionEvent = {
      type: 'agent_start',
      from,
      to,
      taskId: this._taskId,
      data,
    };
    this._history.push(ev);
    this.onTransition?.(ev);
    if (this._eventBus?.emit) {
      this._eventBus.emit({ type: `fsm.transition`, payload: ev });
    }
  }

  private clearTimeoutTimer(): void {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }

  getStateLabel(): string {
    return LABELS[this.state] ?? this.state;
  }

  getContext(): any {
    return this._context;
  }

  setEventBus(bus: any): void {
    this._eventBus = bus;
  }

  start(taskId: string, goal: string): void {
    this._taskId = taskId;
    this.state = 'PLANNING';
    this.isRunning = false;
    this.isTerminal = false;
    this.isSuspended = false;
    this._context = { taskId, goal };

    this.emitTransition('IDLE', 'PLANNING', { taskId, goal });

    // 任务超时
    if (this._taskTimeout > 0) {
      this.clearTimeoutTimer();
      this._timeoutTimer = setTimeout(() => {
        this.state = 'FAILED';
        this.isTerminal = true;
        this.isRunning = false;
        this._context = { ...this._context, error: 'task timeout' };
        this.onFail?.();
      }, this._taskTimeout);
    }
  }

  feed(event: string, data?: any): boolean {
    if (this.state === 'IDLE' && event !== 'turn_start') {
      return false; // IDLE无视非法事件
    }

    switch (event) {
      case 'turn_start':
        this.emitTransition(this.state, 'RUNNING');
        this.state = 'RUNNING';
        this.isRunning = true;
        break;
      case 'tool_execution_start':
        this.emitTransition(this.state, 'WAITING_TOOL');
        this.state = 'WAITING_TOOL';
        break;
      case 'tool_execution_end':
        this.emitTransition(this.state, 'RUNNING');
        this.state = 'RUNNING';
        break;
      case 'turn_end':
        this.emitTransition(this.state, 'VERIFYING');
        this.state = 'VERIFYING';
        break;
      case 'agent_end':
        this.emitTransition(this.state, 'COMPLETED');
        this.state = 'COMPLETED';
        this.isRunning = false;
        this.isTerminal = true;
        this.clearTimeoutTimer();
        break;
      case 'error':
        this.emitTransition(this.state, 'FAILED', { error: data?.error });
        this.state = 'FAILED';
        this.isRunning = false;
        this.isTerminal = true;
        this._context = { ...this._context, error: data?.error ?? 'unknown' };
        this.clearTimeoutTimer();
        this.onFail?.();
        break;
      case 'user_input':
        this.state = 'WAITING_USER';
        this.isRunning = false;
        this.onWaitingUser?.();
        break;
      case 'resume':
        this.state = 'RUNNING';
        this.isSuspended = false;
        this.isRunning = true;
        break;
    }
    return true;
  }

  emitDelta(delta: string): void {
    this.onMessageDelta?.(delta);
  }

  sendUserInput(input: string): void {
    this._context = { ...this._context, lastInput: input };
    this.state = 'RUNNING';
    this.isRunning = true;
  }

  suspend(taskId: string, sessionId: string, replyId: string, toolCalls: any[]): void {
    this.state = 'SUSPENDED';
    this.isSuspended = true;
    this.isRunning = false;
    this._suspendedTasks.set(taskId, { taskId, sessionId, replyId, pendingToolCalls: toolCalls });
  }

  resume(_taskId: string, _confirmResults: any): void {
    this.state = 'RUNNING';
    this.isSuspended = false;
    this.isRunning = true;
  }

  getSuspendedTask(taskId: string): any {
    return this._suspendedTasks.get(taskId);
  }

  getHistory(): TransitionEvent[] {
    return [...this._history];
  }

  cancel(): void {
    this.emitTransition(this.state, 'CANCELLED');
    this.state = 'CANCELLED';
    this.isRunning = false;
    this.isTerminal = true;
    this.clearTimeoutTimer();
    this.onCancel?.();
  }

  reset(): void {
    this.clearTimeoutTimer();
    this.state = 'IDLE';
    this.isSuspended = false;
    this.isTerminal = false;
    this.isRunning = false;
    this._context = {};
  }
}
