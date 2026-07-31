/**
 * FSMEngine — STUB (replaced by ExecutionFSM)
 * @deprecated Use ExecutionFSM from runtime/state-machine/
 */
export class FSMEngine {
  state = 'IDLE';
  private _taskId = '';
  private _goal = '';
  private _onDelta = '';
  private _onWaiting = false;
  private _onCancel = false;
  private _onFail = false;
  private _history: Array<{ from: string; to: string; event: string; timestamp: number }> = [];
  private _context: any = {};
  private _taskTimeout: number | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(opts?: { taskTimeout?: number }) {
    if (opts?.taskTimeout) {
      this._taskTimeout = opts.taskTimeout;
    }
  }

  getStateLabel() { return '空闲'; }

  start(_taskId: string, _goal: string) {
    this._taskId = _taskId;
    this._goal = _goal;
    const prev = this.state;
    this.state = 'PLANNING';
    this._history.push({ from: prev, to: this.state, event: 'start', timestamp: Date.now() });
    this.fire('agent_start');
    if (this._taskTimeout) {
      this._timeoutTimer = setTimeout(() => {
        if (!this.isTerminal) {
          this.state = 'FAILED';
          this._context.error = 'Task timeout';
          if (this.onFail) this.onFail();
          this.fire('timeout');
        }
      }, this._taskTimeout);
    }
  }

  feed(_event: string, _data?: any) {
    if (this.state === 'IDLE' && _event !== 'start') return false;
    const prev = this.state;
    switch (_event) {
      case 'turn_start': this.state = 'RUNNING'; this.fire('turn_start'); break;
      case 'tool_execution_start': this.state = 'WAITING_TOOL'; this.fire('tool_execution_start'); break;
      case 'tool_execution_end': this.state = 'RUNNING'; this.fire('tool_execution_end'); break;
      case 'turn_end': this.state = 'VERIFYING'; this.fire('turn_end'); break;
      case 'agent_end': this.state = 'COMPLETED'; this.fire('agent_end'); if (this._timeoutTimer) clearTimeout(this._timeoutTimer); break;
      case 'user_input': this.state = 'WAITING_USER'; if (this.onWaitingUser) this.onWaitingUser(); break;
      case 'error':
        this.state = 'FAILED';
        if (_data?.error) this._context.error = _data.error;
        if (this.onFail) this.onFail();
        if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
        break;
      default: return false;
    }
    this._history.push({ from: prev, to: this.state, event: _event, timestamp: Date.now() });
    return true;
  }

  get isRunning() { return this.state === 'RUNNING'; }
  get isTerminal() { return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(this.state); }
  
  cancel() {
    const prev = this.state;
    this.state = 'CANCELLED';
    this._history.push({ from: prev, to: this.state, event: 'cancel', timestamp: Date.now() });
    if (this.onCancel) this.onCancel();
    this.fire('cancelled');
    if (this._timeoutTimer) clearTimeout(this._timeoutTimer);
  }
  sendUserInput(_input: string) {
    const prev = this.state;
    this.state = 'RUNNING';
    this._history.push({ from: prev, to: this.state, event: 'user_input', timestamp: Date.now() });
  }
  emitDelta(d: string) { this._onDelta += d; if (this.onMessageDelta) this.onMessageDelta(d); }
  getContext() { return this._context; }
  getHistory() { return [...this._history]; }

  private fire(type: string) {
    if (this.onTransition) this.onTransition({ type, from: this.state, to: this.state, taskId: this._taskId, goal: this._goal });
  }

  onTransition?: (e: any) => void;
  onWaitingUser?: () => void;
  onCancel?: () => void;
  onFail?: () => void;
  onMessageDelta?: (d: string) => void;
}
