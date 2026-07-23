/**
 * ObservableModule — 自动遥测的模块基类
 *
 * 继承此类的模块，execute() 自动产生:
 *   SPAN start → collector.collect()
 *   SPAN end   → collector.collect()
 *
 * 无需手动写任何 trace 代码。
 */

import {
  ObservationCollector,
  type ExecutionContext,
  type Observation,
  createExecutionContext,
  forkContext,
} from './observation.js';

export abstract class ObservableModule<TInput = unknown, TOutput = unknown> {
  abstract readonly name: string;
  abstract readonly layer: string;

  private _registered = false;

  /** 注册模块到 Collector */
  register(): void {
    if (this._registered) return;
    ObservationCollector.registerModule(this.name, this.layer, true);
    ObservationCollector.collect({
      id: `heartbeat_${this.name}_${Date.now()}`,
      traceId: 'system',
      executionId: 'init',
      taskId: 'bootstrap',
      type: 'HEARTBEAT',
      source: { module: this.name, layer: this.layer, version: '9.2.0' },
      operation: 'register',
      timestamp: Date.now(),
      status: 'success',
    });
    this._registered = true;
  }

  /** 自动遥测的 execute */
  async execute(ctx: ExecutionContext | null, input: TInput): Promise<TOutput> {
    this.register();
    const context = ctx ?? createExecutionContext({ taskId: this.name });
    const spanId = `span_${this.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // SPAN start
    const span: Observation = {
      id: spanId,
      traceId: context.traceId,
      executionId: context.executionId,
      taskId: context.taskId,
      parentId: context.parentSpanId,
      type: 'SPAN',
      source: { module: this.name, layer: this.layer, version: '9.2.0' },
      operation: 'execute',
      timestamp: Date.now(),
      status: 'started',
      payload: input,
    };
    ObservationCollector.collect(span);

    const childCtx = forkContext(context, spanId);
    const t0 = Date.now();

    try {
      const result = await this.run(childCtx, input);
      const duration = Date.now() - t0;

      // SPAN end (success)
      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: this.name, layer: this.layer, version: '9.2.0' },
        operation: 'execute',
        timestamp: Date.now(),
        duration,
        status: 'success',
        payload: result,
      });

      return result;
    } catch (err: unknown) {
      const duration = Date.now() - t0;

      // SPAN end (failed)
      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: this.name, layer: this.layer, version: '9.2.0' },
        operation: 'execute',
        timestamp: Date.now(),
        duration,
        status: 'failed',
        payload: { error: (err as Error).message },
      });

      throw err;
    }
  }

  /** 子类实现此方法 */
  protected abstract run(ctx: ExecutionContext, input: TInput): Promise<TOutput>;
}
