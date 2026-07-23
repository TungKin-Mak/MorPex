/**
 * RuntimeInvoker — 统一模块调用拦截器
 *
 * 解决不继承 ObservableModule 的模块的遥测问题。
 * 所有模块调用经过此拦截器，自动获得 SPAN 追踪。
 *
 * 使用：
 *   const result = await Invoker.call('planner', 'createPlan',
 *     () => planner.createPlan(input), ctx, input, 'control-plane');
 */

import {
  ObservationCollector,
  createExecutionContext,
  forkContext,
  type ExecutionContext,
  type Observation,
} from './observation.js';

export class RuntimeInvoker {
  /**
   * call — 统一调用入口，自动遥测
   *
   * @returns 返回 fn() 的结果（若 options.returnSpan 为 true，则返回 { result, spanId }）
   */
  static async call<T>(
    moduleName: string,
    operation: string,
    fn: () => Promise<T> | T,
    ctx?: ExecutionContext | null,
    input?: unknown,
    layer?: string,
    options?: { returnSpan?: boolean },
  ): Promise<T> {
    const context = ctx ?? createExecutionContext({ taskId: moduleName });
    const spanId = `inv_${moduleName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // SPAN start
    ObservationCollector.collect({
      id: spanId,
      traceId: context.traceId,
      executionId: context.executionId,
      taskId: context.taskId,
      parentId: context.parentSpanId,
      type: 'SPAN',
      source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
      operation,
      timestamp: Date.now(),
      status: 'started',
      payload: input,
    });

    const t0 = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - t0;

      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
        operation,
        timestamp: Date.now(),
        duration,
        status: 'success',
        payload: result,
      });

      if (options?.returnSpan) {
        return { result, spanId, ctx: context } as unknown as T;
      }
      return result;
    } catch (err: unknown) {
      const duration = Date.now() - t0;

      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
        operation,
        timestamp: Date.now(),
        duration,
        status: 'failed',
        payload: { error: (err as Error).message },
      });

      throw err;
    }
  }

  /**
   * callWithSpan — 与 call() 相同，但返回 { result, spanId }
   * 用于 exercise-all.ts 的 forkContext 调用链追踪。
   */
  static async callWithSpan<T>(
    moduleName: string,
    operation: string,
    fn: () => Promise<T> | T,
    ctx?: ExecutionContext | null,
    input?: unknown,
    layer?: string,
  ): Promise<{ result: T; spanId: string }> {
    const context = ctx ?? createExecutionContext({ taskId: moduleName });
    const spanId = `inv_${moduleName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // SPAN start
    ObservationCollector.collect({
      id: spanId,
      traceId: context.traceId,
      executionId: context.executionId,
      taskId: context.taskId,
      parentId: context.parentSpanId,
      type: 'SPAN',
      source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
      operation,
      timestamp: Date.now(),
      status: 'started',
      payload: input,
    });

    const t0 = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - t0;

      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
        operation,
        timestamp: Date.now(),
        duration,
        status: 'success',
        payload: result,
      });

      return { result, spanId };
    } catch (err: unknown) {
      const duration = Date.now() - t0;

      ObservationCollector.collect({
        id: `${spanId}_end`,
        traceId: context.traceId,
        executionId: context.executionId,
        taskId: context.taskId,
        parentId: spanId,
        type: 'SPAN',
        source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
        operation,
        timestamp: Date.now(),
        duration,
        status: 'failed',
        payload: { error: (err as Error).message },
      });

      throw err;
    }
  }

  /**
   * heartbeat — 注册模块心跳（初始化时调用）
   */
  static heartbeat(moduleName: string, layer: string): void {
    ObservationCollector.registerModule(moduleName, layer, true);
    ObservationCollector.collect({
      id: `hb_${moduleName}_${Date.now()}`,
      traceId: 'system',
      executionId: 'init',
      taskId: 'bootstrap',
      type: 'HEARTBEAT',
      source: { module: moduleName, layer, version: '9.2.0' },
      operation: 'init',
      timestamp: Date.now(),
      status: 'success',
    });
  }

  /**
   * fsmTransition — 记录 FSM 状态转换
   */
  static fsmTransition(
    moduleName: string,
    fromState: string,
    toState: string,
    taskId: string,
    layer?: string,
  ): void {
    ObservationCollector.collect({
      id: `fsm_${moduleName}_${Date.now()}`,
      traceId: taskId,
      executionId: taskId,
      taskId,
      type: 'STATE',
      source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
      operation: `transition:${fromState}→${toState}`,
      timestamp: Date.now(),
      status: 'success',
      metadata: { fromState, toState, fsmState: toState },
    });
  }

  /**
   * metric — 记录指标
   */
  static metric(
    moduleName: string,
    metricName: string,
    value: number,
    layer?: string,
  ): void {
    ObservationCollector.collect({
      id: `metric_${moduleName}_${Date.now()}`,
      traceId: 'system',
      executionId: 'metrics',
      taskId: 'system',
      type: 'METRIC',
      source: { module: moduleName, layer: layer || 'runtime', version: '9.2.0' },
      operation: metricName,
      timestamp: Date.now(),
      status: 'success',
      payload: { value },
    });
  }
}
