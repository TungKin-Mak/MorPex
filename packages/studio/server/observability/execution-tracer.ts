/**
 * ExecutionTracer — 运行时追踪中心（Phase 2）
 *
 * 为每个用户任务创建追踪上下文，通过 DAG/FSM/Agent/Tool 传播。
 * 所有追踪通过 RuntimeInvoker.call() 路由，自动标记模块为 exercised。
 */

import { RuntimeInvoker } from './runtime-invoker.js';

// ═══════════════════════════════════════════════════
// 本地 span 类型（脱胎于旧 TraceSpan，现独立于 observation.ts）
// ═══════════════════════════════════════════════════

export interface TaskSpan {
  id: string;
  traceId: string;
  executionId: string;
  taskId: string;
  parentId: string | null;
  module: { name: string; type?: string; version?: string };
  operation: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'success' | 'error';
}

let idCounter = 0;
function genId(): string {
  return `span_${Date.now()}_${++idCounter}`;
}

// ═══════════════════════════════════════════════════
// 内存内任务上下文（每个任务一个）
// ═══════════════════════════════════════════════════

interface TaskCtx {
  traceId: string;
  executionId: string;
  taskId: string;
  parentSpanId?: string;
  _spans: TaskSpan[];
  _current: TaskSpan | null;
  fork(mod: string, op: string, input?: unknown): TaskSpan;
  end(output?: unknown): void;
  getSpans(): TaskSpan[];
}

function createTaskCtx(params: { taskId: string; executionId?: string }): TaskCtx {
  const tid = `trace_${Date.now()}_${++idCounter}`;
  const ctx: TaskCtx = {
    traceId: tid,
    executionId: params.executionId || tid,
    taskId: params.taskId,
    _spans: [],
    _current: null,
    fork(mod, op, input) {
      const span: TaskSpan = {
        id: genId(),
        traceId: ctx.traceId,
        executionId: ctx.executionId,
        taskId: ctx.taskId,
        parentId: ctx._current?.id ?? null,
        module: { name: mod, version: '9.2.0' },
        operation: op,
        startTime: Date.now(),
        status: 'running',
      };
      ctx._spans.push(span);
      ctx._current = span;
      return span;
    },
    end() {
      if (ctx._current) {
        ctx._current.endTime = Date.now();
        ctx._current.status = 'success';
        ctx._current = ctx._spans.find(s => s.id === ctx._current?.parentId) ?? null;
      }
    },
    getSpans() {
      return [...ctx._spans];
    },
  };
  return ctx;
}

// ═══════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════

export interface TracerConfig {
  autoFlush?: boolean;
  maxSpansPerTask?: number;
  debug?: boolean;
}

// ═══════════════════════════════════════════════════
// ExecutionTracer
// ═══════════════════════════════════════════════════

export class ExecutionTracer {
  private activeTasks = new Map<string, TaskCtx>();
  private completedSpans: TaskSpan[] = [];
  private config: Required<TracerConfig>;

  constructor(config?: TracerConfig) {
    this.config = {
      autoFlush: config?.autoFlush ?? true,
      maxSpansPerTask: config?.maxSpansPerTask ?? 500,
      debug: config?.debug ?? false,
    };
  }

  startTask(params: { taskId: string; executionId?: string; input?: unknown }): TaskCtx {
    const ctx = createTaskCtx({ taskId: params.taskId, executionId: params.executionId });
    this.activeTasks.set(params.taskId, ctx);
    if (this.config.debug) console.log(`[ExecutionTracer] startTask: ${params.taskId}`);
    return ctx;
  }

  endTask(taskId: string, _output?: unknown, _error?: Error): TaskSpan[] {
    const ctx = this.activeTasks.get(taskId);
    if (!ctx) return [];
    const spans = ctx.getSpans();
    if (spans.length > this.config.maxSpansPerTask) {
      const excess = spans.length - this.config.maxSpansPerTask;
      this.completedSpans.push(...spans.slice(excess));
    } else {
      this.completedSpans.push(...spans);
    }
    this.activeTasks.delete(taskId);
    if (this.config.autoFlush) this.flushSpans(spans, taskId);
    return spans;
  }

  getContext(taskId: string): TaskCtx | undefined {
    return this.activeTasks.get(taskId);
  }

  async traceNode(
    taskId: string,
    node: { taskId: string; domain: string; goal: string },
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    const ctx = this.getContext(taskId);
    return RuntimeInvoker.call(
      'domain-dispatcher', `executeNode:${node.domain}`,
      fn, ctx ?? null,
      { nodeId: node.taskId, domain: node.domain, goal: node.goal },
    );
  }

  traceFSMTransition(taskId: string, fsmName: string, from: string, to: string, trigger: string): void {
    RuntimeInvoker.fsmTransition(fsmName, from, to, taskId);
  }

  async traceAgentAssignment(taskId: string, agentId: string, fn: () => Promise<unknown>): Promise<unknown> {
    const ctx = this.getContext(taskId);
    return RuntimeInvoker.call(
      'agent-scheduler', `assign:${agentId}`,
      fn, ctx ?? null,
      { agentId }, 'agent',
    );
  }

  async traceToolCall(taskId: string, toolName: string, fn: () => Promise<unknown>): Promise<unknown> {
    const ctx = this.getContext(taskId);
    return RuntimeInvoker.call(
      'sandbox-manager', `tool:${toolName}`,
      fn, ctx ?? null,
      { toolName }, 'tool',
    );
  }

  getStats(): { totalSpans: number; modulesCalled: string[]; spanTree: TaskSpan[] } {
    const modulesCalled = [...new Set(this.completedSpans.map(s => s.module.name))];
    return {
      totalSpans: this.completedSpans.length,
      modulesCalled,
      spanTree: this.completedSpans,
    };
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  private flushSpans(spans: TaskSpan[], taskId: string): void {
    if (this.config.debug && spans.length > 0) {
      const modules = new Set(spans.map(s => s.module.name));
      console.log(`[ExecutionTracer] ✅ ${taskId}: ${spans.length} spans, ${modules.size} modules`);
    }
  }
}

export function createExecutionTracer(config?: TracerConfig): ExecutionTracer {
  return new ExecutionTracer(config);
}
