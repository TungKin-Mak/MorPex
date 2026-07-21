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
  private _history: any[] = [];
  private _context: any = {};
  constructor(_opts?: any) {}

  getStateLabel() { return '空闲'; }

  start(_taskId: string, _goal: string) {
    this._taskId = _taskId;
    this._goal = _goal;
    this.state = 'PLANNING';
    this.fire('agent_start');
  }

  feed(_event: string, _data?: any) {
    if (this.state === 'IDLE' && _event !== 'start') return false;
    switch (_event) {
      case 'turn_start': this.state = 'RUNNING'; this.fire('turn_start'); break;
      case 'tool_execution_start': this.state = 'WAITING_TOOL'; this.fire('tool_execution_start'); break;
      case 'tool_execution_end': this.state = 'RUNNING'; this.fire('tool_execution_end'); break;
      case 'turn_end': this.state = 'VERIFYING'; this.fire('turn_end'); break;
      case 'agent_end': this.state = 'COMPLETED'; this.fire('agent_end'); break;
      case 'user_input': this.state = 'WAITING_USER'; if (this.onWaitingUser) this.onWaitingUser(); break;
      case 'error': this.state = 'FAILED'; if (this.onFail) this.onFail(); break;
      default: return false;
    }
    this._history.push({ from: '', to: this.state, event: _event, timestamp: Date.now() });
    return true;
  }

  get isRunning() { return this.state === 'RUNNING'; }
  get isTerminal() { return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(this.state); }
  
  cancel() { this.state = 'CANCELLED'; if (this.onCancel) this.onCancel(); this.fire('cancelled'); }
  sendUserInput(_input: string) { this.state = 'RUNNING'; }
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
