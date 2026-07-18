/**
 * DAG Plugin — DAG 执行引擎插件
 *
 * 将 DAGEngine 包装为 MorPexPlugin。
 * 通过 EventBus 接收 Plan，构建 DAG，调度执行。
 *
 * 数据流：
 *   EventBus: 'plan.generated'
 *     │
 *     ▼
 *   DAGPlugin.handlePlan()
 *     ├── buildFromTasks() → 构建 DAG
 *     ├── validate() → 验证 DAG
 *     ├── 按拓扑排序调度执行
 *     └── 广播 dag.* 事件
 *
 * 事件协议：
 *   - 监听: 'plan.generated'             ← Planner Plugin
 *   - 监听: 'dag.execute'                ← 外部执行请求
 *   - 监听: 'dag.abort'                  ← 中止执行
 *   - 广播: 'dag.built'                  → DAG 构建完成
 *   - 广播: 'dag.node.status_changed'    → 节点状态变更
 *   - 广播: 'dag.node.completed'         → 节点执行完成
 *   - 广播: 'dag.node.failed'            → 节点执行失败
 *   - 广播: 'dag.completed'              → DAG 全部完成
 *   - 广播: 'dag.mutation'               → DAG 变更
 *   - 广播: 'dag.validation_result'      → 验证结果
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { DAGEngine } from './DAGEngine.js';
import type { DAGPluginConfig, DAGNode } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<DAGPluginConfig> = {
  engine: {},
};

/**
 * DAGPlugin — DAG 执行引擎插件
 */
export class DAGPlugin implements MorPexPlugin {
  name = 'dag-plugin';
  version = '0.1.0';
  dependencies: string[] = [];

  private engine!: DAGEngine;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<DAGPluginConfig>;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;
  private currentExecutionId: string | null = null;

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.dag ?? {}) as DAGPluginConfig;
    this.config = {
      engine: { ...DEFAULT_CONFIG.engine, ...(userConfig.engine ?? {}) },
    };

    // 创建 DAG 引擎
    this.engine = new DAGEngine(this.config.engine);

    // 设置引擎回调 → EventBus
    this.engine.onMutation = (mutation) => {
      this.emitEvent('dag.mutation', mutation);
    };

    this.engine.onNodeStatusChange = (nodeId, status, prevStatus) => {
      this.emitEvent('dag.node.status_changed', { nodeId, status, prevStatus });

      if (status === 'success') {
        this.emitEvent('dag.node.completed', {
          nodeId,
          node: this.engine.getNode(nodeId),
        });
      }
    };

    this.engine.onError = (nodeId, error) => {
      this.emitEvent('dag.node.failed', { nodeId, error });
    };

    this.initialized = true;
    console.log('[DAGPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[DAGPlugin] 请在 start() 前调用 initialize()');
    }

    // DAGPlugin 不再监听 plan.generated（WorkflowPlanner 已删除）
    // DAG 由 ExecutionOrchestrator 通过 CrossDomainRouter + DomainDispatcher 驱动

    // 监听外部执行请求
    this.unsubscribers.push(
      this.eventBus.on('dag.execute', (event: MorPexEvent) => {
        const executionId = event.executionId;
        if (executionId) {
          this.executeDAG(executionId).catch(err => {
            console.error('[DAGPlugin] executeDAG 错误:', err);
          });
        }
      }),
    );

    // 监听中止请求
    this.unsubscribers.push(
      this.eventBus.on('dag.abort', () => {
        this.currentExecutionId = null;
        this.engine.reset();
        this.emitEvent('dag.aborted', {});
      }),
    );

    console.log('[DAGPlugin] 已启动，正在监听 plan.generated');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.engine.clear();
    console.log('[DAGPlugin] 已停止');
  }

  // buildFromPlan 已删除（WorkflowPlanner 已移除）
  // DAG 构建由 ExecutionOrchestrator 通过 CrossDomainRouter 驱动

  /**
   * 执行 DAG（拓扑顺序调度）
   */
  async executeDAG(executionId: string): Promise<void> {
    this.currentExecutionId = executionId;
    console.log(`[DAGPlugin] 开始执行 DAG (${executionId})`);

    while (!this.engine.isComplete() && this.currentExecutionId === executionId) {
      const batch = this.engine.getNextBatch();

      if (batch.length === 0) {
        // 没有就绪节点但未完成 → 等待或存在死锁
        const status = this.engine.getStatus();
        if (!status.isComplete) {
          console.warn('[DAGPlugin] 无就绪节点但 DAG 未完成，可能死锁');
          this.emitEvent('dag.deadlock_detected', {});
        }
        break;
      }

      // 并行执行批次
      const promises = batch.map(node => this.executeNode(node));
      await Promise.all(promises);
    }

    if (this.engine.isComplete()) {
      console.log('[DAGPlugin] DAG 全部完成');
      this.emitEvent('dag.completed', {
        executionId,
        status: this.engine.getStatus(),
      });
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(node: DAGNode): Promise<void> {
    this.engine.startNode(node.id);
    console.log(`[DAGPlugin] 执行节点: ${node.name} (${node.id})`);

    try {
      // 发射节点执行请求 → 由外部处理（如 FSM Plugin）
      this.emitEvent('dag.node.execute', {
        nodeId: node.id,
        node,
        executionId: this.currentExecutionId,
      });

      // 简单模式：直接标记成功（实际由外部系统处理并回调）
      // 这里模拟成功，外部可以通过 dag.node.complete/dag.node.fail 回调
      this.engine.completeNode(node.id, { status: 'dispatched' });

    } catch (err: any) {
      this.engine.failNode(node.id, err.message);
    }
  }

  /** 获取引擎实例 */
  getEngine(): DAGEngine {
    return this.engine;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: this.currentExecutionId ?? 'dag-plugin',
      source: 'dag-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
