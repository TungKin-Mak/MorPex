/**
 * BaseModule — 模块基类（可选继承，零依赖）
 *
 * 继承此类的模块获得:
 *   1. name/layer 元数据
 *   2. onTrace 回调（由外部 ModuleInvoker 注入）
 *   3. execute() 生命周期钩子
 *
 * 使用方式:
 *   class Planner extends BaseModule<PlannerInput, Plan> {
 *     name = 'planner';
 *     layer = 'control-plane';
 *
 *     async run(ctx: unknown, input: PlannerInput): Promise<Plan> {
 *       return createPlan(input);
 *     }
 *   }
 *
 *   // StudioServer 中:
 *   const planner = new Planner();
 *   ModuleInvoker.instrument(planner);  // 注入追踪
 *   const plan = await planner.execute(traceCtx, input);
 */

export type TraceCallback = (event: {
  phase: 'start' | 'end' | 'error';
  module: string;
  layer: string;
  operation: string;
  input?: unknown;
  output?: unknown;
  error?: Error;
  latencyMs?: number;
}) => void;

export abstract class BaseModule<TInput = unknown, TOutput = unknown> {
  abstract readonly name: string;
  abstract readonly layer: string;

  private _traceCallback: TraceCallback | null = null;

  /** 注入追踪回调（由 ModuleInvoker.instrument 调用） */
  _setTraceCallback(cb: TraceCallback): void {
    this._traceCallback = cb;
  }

  /**
   * execute — 生命周期入口
   *
   * 子类通常不需要重写此方法。重写 run() 即可。
   * StudioServer 中通过 ModuleInvoker.wrap 包装后自动获得追踪。
   */
  async execute(ctx: unknown, input: TInput): Promise<TOutput> {
    const t0 = Date.now();

    // 通知追踪回调（如果已注入）
    this._traceCallback?.({
      phase: 'start',
      module: this.name,
      layer: this.layer,
      operation: 'execute',
      input,
    });

    try {
      const result = await this.run(ctx, input);
      const latency = Date.now() - t0;

      this._traceCallback?.({
        phase: 'end',
        module: this.name,
        layer: this.layer,
        operation: 'execute',
        input,
        output: result,
        latencyMs: latency,
      });

      return result;
    } catch (err: unknown) {
      this._traceCallback?.({
        phase: 'error',
        module: this.name,
        layer: this.layer,
        operation: 'execute',
        input,
        error: err as Error,
        latencyMs: Date.now() - t0,
      });
      throw err;
    }
  }

  /**
   * run — 子类实现此方法
   */
  protected abstract run(ctx: unknown, input: TInput): Promise<TOutput>;
}
