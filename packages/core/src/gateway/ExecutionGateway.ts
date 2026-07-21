/**
 * ExecutionGateway — 统一执行网关
 *
 * 职责：
 *   - 管理多个运行时适配器（PiAdapter 等）
 *   - 根据 agentRole 路由到对应 adapter
 *   - 确保 executionId 已设置
 *   - 调用 adapter.execute() 并标准化返回结果
 *   - 通过 EventBus 广播 runtime.* 事件
 *
 * 设计约束：
 *   - Gateway 不缓存状态（薄桥转发）
 *   - 所有事件通过 EventBus 广播
 *   - 所有事件 ID 必须通过 ExecutionIdentity.createEventId() 生成（全链路 Trace ID 传播）
 */

import type {
  AgentRuntimeAdapter,
  ExecutionRequest,
  ExecutionResult,
  RuntimeHealth,
  MorPexEvent,
} from '../common/types.js';
import { EventBus } from '../common/EventBus.js';
import { ExecutionIdentity } from '../common/ExecutionIdentity.js';

// ★ v3.0 OpenSpace Fusion import
// ExecutionRecordingEngine deleted — using EventStore instead

/** 适配器注册表项 */
interface AdapterEntry {
  name: string;
  adapter: AgentRuntimeAdapter;
  registeredAt: number;
}

/**
 * ExecutionGateway — 统一执行网关
 */
export class ExecutionGateway {
  private adapters: Map<string, AdapterEntry> = new Map();
  private eventBus: EventBus;
  private identity: ExecutionIdentity;
  private defaultAdapterName: string | null = null;

  /** ★ v3.0 Optional ExecutionRecordingEngine for full execution recording */
  private _recordingEngine: any = null;  // was ExecutionRecordingEngine (module deleted)

  constructor(eventBus: EventBus, identity?: ExecutionIdentity) {
    this.eventBus = eventBus;
    this.identity = identity ?? new ExecutionIdentity();
  }

  /**
   * 注册运行时适配器
   *
   * @param name - 适配器名称（如 "pi", "pi-v2"）
   * @param adapter - 适配器实例
   * @param setAsDefault - 是否设为默认适配器
   */
  registerAdapter(name: string, adapter: AgentRuntimeAdapter, setAsDefault: boolean = false): void {
    this.adapters.set(name, {
      name,
      adapter,
      registeredAt: Date.now(),
    });

    if (setAsDefault || this.adapters.size === 1) {
      this.defaultAdapterName = name;
    }

    this.eventBus.emit({
      id: this.identity.createEventId(),
      type: 'gateway.adapter.registered',
      timestamp: Date.now(),
      executionId: 'gateway',
      source: 'gateway',
      payload: { name, adapterCount: this.adapters.size },
    });
  }

  /**
   * 移除适配器
   */
  unregisterAdapter(name: string): boolean {
    const existed = this.adapters.delete(name);
    if (existed && this.defaultAdapterName === name) {
      // 如果移除的是默认适配器，重新设置
      this.defaultAdapterName = this.adapters.size > 0
        ? this.adapters.keys().next().value!
        : null;
    }
    return existed;
  }

  /**
   * ★ v3.0 Set the ExecutionRecordingEngine for recording execution traces.
   */
  setRecordingEngine(engine: any): void {
    this._recordingEngine = engine;
  }

  /**
   * 获取已注册的适配器名称列表
   */
  getAdapterNames(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * 执行 Agent 推理
   *
   * 根据 agentRole 查找对应 adapter，转发请求。
   * 如果未找到匹配 adapter，使用默认适配器。
   *
   * @param agentRole - Agent 角色名，用于路由到对应 adapter
   * @param request - 标准化执行请求
   */
  async execute(agentRole: string, request: ExecutionRequest): Promise<ExecutionResult> {
    // 查找适配器：先精确匹配 agentRole，再匹配默认
    const entry = this.adapters.get(agentRole)
      ?? (this.defaultAdapterName ? this.adapters.get(this.defaultAdapterName) : undefined);

    if (!entry) {
      throw new Error(`[Gateway] 未找到适配器: agentRole="${agentRole}", 已注册: ${this.getAdapterNames().join(', ') || '无'}`);
    }

    // 确保 executionId 已设置 — 使用 ExecutionIdentity
    if (!request.executionId) {
      request.executionId = this.identity.createExecutionId();
    }

    // 广播执行开始事件
    this.emitRuntimeEvent('runtime.execution.started', {
      executionId: request.executionId,
      agentRole,
      adapterName: entry.name,
      input: request.input,
    });

    // ★ v3.0: Start execution recording
    let recordingId: string | null = null;
    if (this._recordingEngine) {
      recordingId = this._recordingEngine.startRecording(request.context.sessionId ?? request.executionId, request.executionId);
    }

    try {
      const result = await entry.adapter.execute(request);

      // ★ v3.0: Stop recording on success
      if (this._recordingEngine && recordingId) {
        await this._recordingEngine.stopRecording(recordingId).catch((err: any) =>
          console.error('[Gateway] 录制停止失败:', err)
        );
      }

      // 广播执行完成事件
      this.emitRuntimeEvent('runtime.execution.completed', {
        executionId: request.executionId,
        agentRole,
        adapterName: entry.name,
        status: result.status,
        duration: result.duration,
      });

      return result;
    } catch (err: any) {
      // ★ v3.0: Stop recording on failure
      if (this._recordingEngine && recordingId) {
        await this._recordingEngine.stopRecording(recordingId).catch((err2: any) =>
          console.error('[Gateway] 录制停止失败:', err2)
        );
      }

      // 广播执行失败事件
      this.emitRuntimeEvent('runtime.execution.failed', {
        executionId: request.executionId,
        agentRole,
        adapterName: entry.name,
        error: err.message,
      });

      return {
        executionId: request.executionId,
        status: 'failed',
        output: null,
        artifacts: [],
        duration: 0,
      };
    }
  }

  /**
   * 中止执行
   */
  async abort(executionId: string): Promise<void> {
    // 向所有适配器广播中止
    const promises: Promise<void>[] = [];
    for (const [, entry] of this.adapters) {
      promises.push(entry.adapter.abort(executionId).catch(err => {
        console.error(`[Gateway] abort 错误 (adapter=${entry.name}):`, err);
      }));
    }
    await Promise.all(promises);

    this.emitRuntimeEvent('runtime.execution.aborted', { executionId });
  }

  /**
   * 获取所有适配器的健康状态
   */
  health(): Record<string, RuntimeHealth> {
    const result: Record<string, RuntimeHealth> = {};
    for (const [name, entry] of this.adapters) {
      try {
        result[name] = entry.adapter.health();
      } catch (err) {
        result[name] = {
          alive: false,
          latency: 0,
          version: 'unknown',
          details: { error: String(err) },
        };
      }
    }
    return result;
  }

  /**
   * 获取默认适配器名称
   */
  getDefaultAdapter(): string | null {
    return this.defaultAdapterName;
  }

  /**
   * 发射运行时事件到 EventBus
   *
   * 全链路 Trace ID 传播：使用 this.identity.createEventId() 生成标准 Trace ID
   */
  private emitRuntimeEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: payload.executionId ?? 'gateway',
      source: 'gateway',
      payload,
    };
    this.eventBus.emit(event);
  }
}
