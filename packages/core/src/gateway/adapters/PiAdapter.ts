/**
 * PiAdapter — pi AgentRuntime → AgentRuntimeAdapter 适配器
 *
 * 将现有 AgentRuntime（src/core/runtime.ts）包装为标准的 AgentRuntimeAdapter。
 *
 * 包装对象：AgentRuntime（src/core/runtime.ts）
 * 不包装：Orchestrator、MentionRouter、FSMAgentRuntime
 *
 * 内部逻辑：
 *   execute(request)
 *     ├── ExecutionRequest.input → pi AgentRuntime 的 AgentRequest.input
 *     ├── 调用 this.runtime.run(agentRequest)
 *     ├── 监听 runtime 事件 → MirrorEventMapper.map() → EventBus.emit()
 *     └── 返回标准化 ExecutionResult
 */

import type {
  AgentRuntimeAdapter,
  ExecutionRequest,
  ExecutionResult,
  RuntimeHealth,
  MorPexEvent,
  EventHandler,
} from '../../common/types.js';
import { EventBus } from '../../common/EventBus.js';
import { ExecutionIdentity } from '../../common/ExecutionIdentity.js';
import type { PiAdapterConfig } from '../../common/types.js';

// 使用 any 类型避免对 pi 包的编译时依赖
type PiAgentRuntime = any;
type PiAgentRequest = any;
type PiAgentResponse = any;

/**
 * PiAdapter — pi AgentRuntime 适配器
 *
 * 将现有的 AgentRuntime（来自 src/core/runtime.ts）包装为
 * 标准的 AgentRuntimeAdapter 接口，使 MorPexCore 可以通过
 * ExecutionGateway 统一调用。
 */
export class PiAdapter implements AgentRuntimeAdapter {
  private runtime: PiAgentRuntime;
  private eventBus: EventBus;
  private identity: ExecutionIdentity;
  private runtimeName: string;
  private version: string;
  private subscribers: Set<EventHandler> = new Set();
  private unsubFromRuntime: (() => void) | null = null;
  private startTime: number;
  private currentExecutionId: string = 'unknown';

  constructor(
    runtime: PiAgentRuntime,
    eventBus: EventBus,
    config: PiAdapterConfig = {},
    identity?: ExecutionIdentity,
  ) {
    this.runtime = runtime;
    this.eventBus = eventBus;
    this.identity = identity ?? new ExecutionIdentity();
    this.runtimeName = config.runtimeName ?? 'pi';
    this.version = config.version ?? '1.8.0';
    this.startTime = Date.now();

    // 桥接 pi 运行时事件 → MorPexCore EventBus
    this.bridgeRuntimeEvents();
  }

  /**
   * 桥接 pi Runtime 事件到 EventBus
   *
   * AgentRuntime 通过 EventBus 发射事件（tool.started, agent.start 等），
   * 我们监听这些事件并转换为标准 MorPexEvent 重新发射。
   *
   * 每个事件类型的注册使用 try-catch 包裹，避免单个类型注册失败
   * 导致整个桥接中断。
   */
  private bridgeRuntimeEvents(): void {
    if (!this.runtime.bus || typeof this.runtime.bus.on !== 'function') {
      console.warn('[PiAdapter] pi 运行时没有事件总线，事件桥接已跳过');
      return;
    }

    const piBus = this.runtime.bus;

    // 监听 pi 运行时的各类事件
    const piEvents = [
      'tool.started', 'tool.completed', 'tool.failed',
      'agent.start', 'agent.end', 'agent.error',
      'plan.created', 'dag.created',
      'task.started', 'task.completed',
    ];

    const handlers: Array<() => void> = [];

    for (const eventType of piEvents) {
      try {
        const unsub = piBus.on(eventType, (payload: any) => {
          try {
            const morpexEvent = this.mapPiEvent(eventType, payload);
            // 通知本地订阅者
            for (const handler of this.subscribers) {
              try {
                handler(morpexEvent);
              } catch (err) {
                console.error(`[PiAdapter] subscriber 错误:`, err);
              }
            }
            // 发射到 MorPexCore EventBus
            this.eventBus.emit(morpexEvent);
          } catch (err) {
            console.error(`[PiAdapter] 处理 pi 事件时出错 (${eventType}):`, err);
          }
        });
        handlers.push(unsub);
      } catch (err) {
        console.warn(`[PiAdapter] 无法注册 pi 事件监听器 (${eventType}):`, err);
      }
    }

    this.unsubFromRuntime = () => {
      for (const unsub of handlers) unsub();
    };
  }

  /**
   * 将 pi 原生事件映射为标准化 MorPexEvent
   * 使用 currentExecutionId 确保关联到正确的执行 ID
   */
  private mapPiEvent(piType: string, payload: any): MorPexEvent {
    const typeMap: Record<string, string> = {
      'tool.started': 'runtime.tool.called',
      'tool.completed': 'runtime.tool.finished',
      'tool.failed': 'runtime.tool.failed',
      'agent.start': 'runtime.agent.started',
      'agent.end': 'runtime.agent.completed',
      'agent.error': 'runtime.agent.failed',
      'plan.created': 'runtime.plan.generated',
      'dag.created': 'runtime.dag.created',
      'task.started': 'runtime.task.started',
      'task.completed': 'runtime.task.completed',
    };

    return {
      id: this.identity.createEventId(),
      type: typeMap[piType] ?? 'runtime.unknown',
      timestamp: payload?.timestamp ?? Date.now(),
      executionId: this.currentExecutionId,
      source: this.runtimeName,
      payload,
    };
  }

  /**
   * 执行 Agent 推理
   *
   * 将标准化 ExecutionRequest 转换为 pi AgentRuntime 的 AgentRequest，
   * 调用 runtime.run()，然后标准化返回结果。
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 设置当前 executionId，使桥接事件能关联到正确的执行
    this.currentExecutionId = request.executionId;

    try {
      // 构建 pi AgentRequest
      const piRequest: PiAgentRequest = {
        id: request.executionId,
        input: typeof request.input === 'string'
          ? request.input
          : JSON.stringify(request.input),
        sessionId: request.context.sessionId,
      };

      // 调用 pi 运行时
      const piResponse: PiAgentResponse = await this.runtime.run(piRequest);

      const duration = Date.now() - startTime;

      return {
        executionId: request.executionId,
        status: 'success',
        output: piResponse.text ?? piResponse,
        artifacts: (piResponse.toolCalls ?? []).map((tc: any) => tc.name ?? ''),
        duration,
      };
    } catch (err: unknown) {
      const duration = Date.now() - startTime;

      // 发射失败事件 — 使用标准化 Event ID
      this.eventBus.emit({
        id: this.identity.createEventId(),
        type: 'runtime.agent.failed',
        timestamp: Date.now(),
        executionId: request.executionId,
        source: this.runtimeName,
        payload: { error: (err as Error).message },
      });

      return {
        executionId: request.executionId,
        status: 'failed',
        output: null,
        artifacts: [],
        duration,
      };
    }
  }

  /**
   * 中止执行
   *
   * 支持 executionId 过滤:
   *   - '*' 表示中止当前适配器的所有执行
   *   - 特定 ID 只在 PiAdapter 自身维护了执行映射时生效
   *   - 默认行为: 调用 runtime.abort() 中止当前运行
   */
  async abort(executionId: string): Promise<void> {
    try {
      if (typeof this.runtime.abort === 'function') {
        // 只有当 executionId 匹配当前执行 或 是全局中止('*') 时才触发
        if (executionId === '*' || executionId === this.currentExecutionId) {
          await this.runtime.abort();
        }
      }
    } catch (err) {
      console.error(`[PiAdapter] abort 错误 (${executionId}):`, err);
    }
  }

  /**
   * 订阅标准化事件
   * @returns 取消订阅函数
   */
  subscribe(handler: EventHandler): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  /**
   * 健康检查
   */
  health(): RuntimeHealth {
    return {
      alive: true,
      latency: Date.now() - this.startTime,
      version: this.version,
      details: {
        runtimeName: this.runtimeName,
        uptime: Date.now() - this.startTime,
        subscriberCount: this.subscribers.size,
      },
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.unsubFromRuntime) {
      this.unsubFromRuntime();
      this.unsubFromRuntime = null;
    }
    this.subscribers.clear();
  }
}
