/**
 * Observation — 统一遥测数据模型
 *
 * 替代 TraceEvent + Span + Heartbeat 三个分裂模型。
 * 所有运行时数据（调用链、事件、状态变更、指标、心跳）统一为 Observation。
 */

// ═══════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════

export type ObservationType = 'SPAN' | 'EVENT' | 'STATE' | 'METRIC' | 'HEARTBEAT';

export interface ObservationSource {
  module: string;
  layer: string;
  version: string;
  instance?: string;
}

export interface Observation {
  id: string;
  traceId: string;
  executionId: string;
  taskId: string;
  parentId?: string;

  type: ObservationType;
  source: ObservationSource;
  operation: string;
  timestamp: number;
  duration?: number;
  status: 'started' | 'success' | 'failed';

  payload?: unknown;
  metadata?: {
    agentId?: string;
    nodeId?: string;
    tool?: string;
    fsmState?: string;
    fromState?: string;
    toState?: string;
    [key: string]: unknown;
  };
}

// ═══════════════════════════════════════════════════════════════
// ExecutionContext — 贯穿所有调用链
// ═══════════════════════════════════════════════════════════════

export interface ExecutionContext {
  traceId: string;
  executionId: string;
  taskId: string;
  parentSpanId?: string;
  metadata?: {
    tenant?: string;
    agent?: string;
    workflow?: string;
  };
}

let ctxCounter = 0;
function ctxId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++ctxCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createExecutionContext(params?: {
  executionId?: string;
  taskId?: string;
  parentSpanId?: string;
}): ExecutionContext {
  return {
    traceId: ctxId('trace'),
    executionId: params?.executionId || ctxId('exec'),
    taskId: params?.taskId || ctxId('task'),
    parentSpanId: params?.parentSpanId,
  };
}

export function forkContext(parent: ExecutionContext, spanId: string): ExecutionContext {
  return {
    traceId: parent.traceId,
    executionId: parent.executionId,
    taskId: parent.taskId,
    parentSpanId: spanId,
    metadata: parent.metadata,
  };
}

// ═══════════════════════════════════════════════════════════════
// Runtime State Machine
// ═══════════════════════════════════════════════════════════════

/** Internal runtime state (source of truth) */
export enum RuntimeModuleState {
  REGISTERED = 'REGISTERED',
  AVAILABLE  = 'AVAILABLE',
  ACTIVE     = 'ACTIVE',
  DEGRADED   = 'DEGRADED',
  FAILED     = 'FAILED',
  DORMANT    = 'DORMANT',
}

/** Display status shown in frontend */
export type DisplayStatus = 'online' | 'degraded' | 'offline' | 'unknown';

export function mapToDisplay(state: RuntimeModuleState): DisplayStatus {
  switch (state) {
    case RuntimeModuleState.AVAILABLE:  return 'online';
    case RuntimeModuleState.ACTIVE:     return 'online';
    case RuntimeModuleState.DEGRADED:   return 'degraded';
    case RuntimeModuleState.FAILED:     return 'degraded';
    case RuntimeModuleState.DORMANT:    return 'offline';
    case RuntimeModuleState.REGISTERED: return 'unknown';
    default:                            return 'unknown';
  }
}

export interface ModuleState {
  name: string;
  layer: string;
  runtimeState: RuntimeModuleState;
  displayStatus: DisplayStatus;
  callCount: number;
  successCount: number;
  errorCount: number;
  lastCalledAt: number | null;
  lastHeartbeatAt: number | null;
  registeredAt: number;
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// ModuleStateManager — 状态投影引擎
// ═══════════════════════════════════════════════════════════════

class ModuleStateManager {
  private modules = new Map<string, ModuleState>();
  private listeners: Array<(name: string, state: ModuleState) => void> = [];

  onStateChange(fn: (name: string, state: ModuleState) => void): void {
    this.listeners.push(fn);
  }

  apply(obs: Observation): ModuleState {
    const name = obs.source.module;
    let state = this.modules.get(name);

    if (!state) {
      state = {
        name,
        layer: obs.source.layer,
        runtimeState: RuntimeModuleState.REGISTERED,
        displayStatus: 'unknown',
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        lastCalledAt: null,
        lastHeartbeatAt: null,
        registeredAt: Date.now(),
        source: obs.type,
      };
      this.modules.set(name, state);
    }

    switch (obs.type) {
      case 'HEARTBEAT':
        state.lastHeartbeatAt = obs.timestamp;
        state.source = 'HEARTBEAT';
        if (state.runtimeState === RuntimeModuleState.REGISTERED) {
          state.runtimeState = RuntimeModuleState.AVAILABLE;
        }
        break;

      case 'SPAN':
      case 'EVENT':
      case 'STATE':
        state.callCount++;
        state.lastCalledAt = obs.timestamp;
        if (state.source === 'HEARTBEAT') state.source = obs.type;

        if (obs.status === 'success') {
          state.successCount++;
          state.runtimeState = RuntimeModuleState.ACTIVE;
        } else if (obs.status === 'failed') {
          state.errorCount++;
          state.runtimeState = state.errorCount > state.successCount
            ? RuntimeModuleState.FAILED
            : RuntimeModuleState.DEGRADED;
        }
        break;
    }

    state.displayStatus = mapToDisplay(state.runtimeState);

    for (const fn of this.listeners) {
      try { fn(name, state); } catch { /* ignore */ }
    }

    return state;
  }

  get(name: string): ModuleState | undefined { return this.modules.get(name); }
  getAll(): ModuleState[] { return [...this.modules.values()]; }

  getExercised(): Set<string> {
    const set = new Set<string>();
    for (const [n, s] of this.modules) {
      // Only SPAN/EVENT/STATE calls count as exercised — HEARTBEAT alone is not enough
      if (s.runtimeState === RuntimeModuleState.ACTIVE ||
          s.runtimeState === RuntimeModuleState.DEGRADED ||
          s.runtimeState === RuntimeModuleState.FAILED) {
        set.add(n);
      }
    }
    return set;
  }

  clear(): void { this.modules.clear(); }
}

// ═══════════════════════════════════════════════════════════════
// ObservationCollector — 统一采集入口
// ═══════════════════════════════════════════════════════════════

class ObservationCollectorImpl {
  private observations: Observation[] = [];
  private stateManager = new ModuleStateManager();
  private maxObservations = 50000;

  registerModule(name: string, layer: string, _required?: boolean): void {
    if (!this.stateManager.get(name)) {
      this.collect({
        id: `reg_${name}_${Date.now()}`,
        traceId: 'system',
        executionId: 'init',
        taskId: 'bootstrap',
        type: 'HEARTBEAT',
        source: { module: name, layer, version: '9.2.0' },
        operation: 'register',
        timestamp: Date.now(),
        status: 'success',
      });
    }
  }

  collect(obs: Observation): void {
    this.observations.push(obs);
    if (this.observations.length > this.maxObservations) {
      this.observations = this.observations.slice(-this.maxObservations);
    }
    this.stateManager.apply(obs);
  }

  onStateChange(fn: (name: string, state: ModuleState) => void): void {
    this.stateManager.onStateChange(fn);
  }

  getObservations(limit = 1000): Observation[] { return this.observations.slice(-limit); }
  getObservationsByTask(taskId: string): Observation[] { return this.observations.filter(o => o.taskId === taskId); }
  getObservationsByTrace(traceId: string): Observation[] { return this.observations.filter(o => o.traceId === traceId); }
  getModuleStates(): ModuleState[] { return this.stateManager.getAll(); }
  getModuleState(name: string): ModuleState | undefined { return this.stateManager.get(name); }
  getExercisedModules(): Set<string> { return this.stateManager.getExercised(); }

  getSpanTree(taskId: string): Observation[] {
    return this.observations
      .filter(o => o.taskId === taskId && o.type === 'SPAN')
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getTopology(): Array<{ from: string; to: string; count: number }> {
    const edges = new Map<string, number>();
    for (const obs of this.observations) {
      if (obs.parentId) {
        const parent = this.observations.find(o => o.id === obs.parentId);
        if (parent) {
          const key = `${parent.source.module}→${obs.source.module}`;
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
    }
    return [...edges.entries()]
      .map(([k, c]) => { const [f, t] = k.split('→'); return { from: f, to: t, count: c }; })
      .sort((a, b) => b.count - a.count);
  }

  getStats(): {
    totalObservations: number;
    totalModules: number;
    exercisedModules: number;
    failedModules: number;
  } {
    const states = this.stateManager.getAll();
    return {
      totalObservations: this.observations.length,
      totalModules: states.length,
      exercisedModules: states.filter(s => s.runtimeState !== RuntimeModuleState.REGISTERED).length,
      failedModules: states.filter(s => s.runtimeState === RuntimeModuleState.FAILED).length,
    };
  }

  clear(): void {
    this.observations = [];
  }

  reset(): void {
    this.observations = [];
    this.stateManager.clear();
  }
}

export const ObservationCollector = new ObservationCollectorImpl();
