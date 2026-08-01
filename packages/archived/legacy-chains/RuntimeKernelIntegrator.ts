import type { MorPexKernel } from '../common/Kernel.js';
import { ExecutionFSM, ExecutionState } from './state-machine/ExecutionFSM.js';
import { DAGRuntime } from './dag/DAGRuntime.js';
import { CheckpointManager } from './checkpoint/CheckpointManager.js';
import { RecoveryManager } from './checkpoint/RecoveryManager.js';
import { ReplayEngine } from './checkpoint/ReplayEngine.js';
import type { ExecutionSnapshot } from './checkpoint/CheckpointManager.js';

export interface RuntimeKernelConfig {
  maxParallel?: number;
}

export class RuntimeKernelIntegrator {
  private dagRuntime: DAGRuntime;
  private checkpointManager: CheckpointManager;
  private recoveryManager: RecoveryManager;
  private replayEngine: ReplayEngine;

  constructor(config: RuntimeKernelConfig = {}) {
    this.dagRuntime = new DAGRuntime({ maxParallel: config.maxParallel ?? 4 });
    this.checkpointManager = new CheckpointManager();
    this.recoveryManager = new RecoveryManager();
    this.replayEngine = new ReplayEngine(this.checkpointManager);
  }

  mountToKernel(kernel: MorPexKernel): void {
    const bus = kernel.eventBus;
    bus.on('runtime.execution.created', (e: any) => { /* FSM handled externally */ });
    bus.on('runtime.execution.start', (e: any) => { /* FSM handled externally */ });
    bus.on('runtime.execution.complete', (e: any) => { /* FSM handled externally */ });
    console.log('[RuntimeKernelIntegrator] DAG/Checkpoint/Recovery mounted to EventBus');
  }

  getDAGRuntime(): DAGRuntime { return this.dagRuntime; }
  getCheckpointManager(): CheckpointManager { return this.checkpointManager; }
  getRecoveryManager(): RecoveryManager { return this.recoveryManager; }
  getReplayEngine(): ReplayEngine { return this.replayEngine; }
}
