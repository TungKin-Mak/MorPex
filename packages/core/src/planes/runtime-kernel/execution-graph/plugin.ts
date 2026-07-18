/**
 * Execution Graph Plugin — 执行图追踪插件
 *
 * 监听 EventBus 的 runtime.* 和 dag.* 事件，
 * 自动构建实际执行图（含重试、失败、人工干预）。
 *
 * 事件协议：
 *   - 监听: 'dag.built'                  ← DAG 构建
 *   - 监听: 'dag.node.status_changed'    ← DAG 节点状态变更
 *   - 监听: 'dag.node.completed'         ← DAG 节点完成
 *   - 监听: 'dag.node.failed'            ← DAG 节点失败
 *   - 监听: 'dag.completed'              ← DAG 完成
 *   - 监听: 'runtime.fsm.*'              ← FSM 状态转换
 *   - 广播: 'graph.node.created'         → 节点创建
 *   - 广播: 'graph.node.status_changed'  → 节点状态变更
 *   - 广播: 'graph.edge.created'         → 边创建
 *   - 广播: 'graph.completed'            → 执行图完成
 *   - 广播: 'graph.stats'                → 统计信息
 */

import type {
  MorPexPlugin,
  PluginContext,
  EventBus,
  MorPexEvent,
} from '../../../common/types.js';
import { ExecutionGraphEngine } from './ExecutionGraph.js';
import type { ExecGraphPluginConfig } from './types.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<ExecGraphPluginConfig> = {
  maxRetainedGraphs: 100,
  recordDetailedData: true,
};

/**
 * ExecGraphPlugin — 执行图追踪插件
 *
 * 自动监听运行时事件，为每次执行构建 Execution Graph。
 */
export class ExecGraphPlugin implements MorPexPlugin {
  name = 'exec-graph-plugin';
  version = '0.1.0';
  dependencies = ['dag-plugin'];

  private engine!: ExecutionGraphEngine;
  private eventBus!: EventBus;
  private identity!: { createEventId(): string };
  private config!: Required<ExecGraphPluginConfig>;
  private unsubscribers: Array<() => void> = [];
  private initialized = false;

  /** 当前追踪的 executionId → dagId 映射 */
  private currentDAGs: Map<string, string> = new Map();

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.identity = context.executionIdentity;

    const userConfig = (context.config?.execGraph ?? {}) as ExecGraphPluginConfig;
    this.config = {
      maxRetainedGraphs: userConfig.maxRetainedGraphs ?? DEFAULT_CONFIG.maxRetainedGraphs,
      recordDetailedData: userConfig.recordDetailedData ?? DEFAULT_CONFIG.recordDetailedData,
    };

    this.engine = new ExecutionGraphEngine({
      maxRetainedGraphs: this.config.maxRetainedGraphs,
    });

    // 设置引擎回调 → EventBus
    this.engine.onNodeCreated = (executionId, node) => {
      this.emitEvent('graph.node.created', { executionId, node });
    };

    this.engine.onNodeStatusChanged = (executionId, nodeId, status, prevStatus) => {
      this.emitEvent('graph.node.status_changed', { executionId, nodeId, status, prevStatus });
    };

    this.engine.onEdgeCreated = (executionId, edge) => {
      this.emitEvent('graph.edge.created', { executionId, edge });
    };

    this.engine.onGraphCompleted = (executionId, graph) => {
      this.emitEvent('graph.completed', { executionId, graph });
    };

    this.initialized = true;
    console.log('[ExecGraphPlugin] 已初始化');
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('[ExecGraphPlugin] 请在 start() 前调用 initialize()');
    }

    // 监听 DAG 构建事件 → 开始追踪
    this.unsubscribers.push(
      this.eventBus.on('dag.built', (event: MorPexEvent) => {
        const payload = event.payload as any;
        const planId = payload?.planId;
        const goal = payload?.goal;
        const executionId = `exec_${planId ?? event.executionId}`;

        if (planId) {
          this.currentDAGs.set(executionId, planId);
          this.engine.startExecution(executionId, planId, goal ?? '');
        }
      }),
    );

    // 监听 DAG 完成事件
    this.unsubscribers.push(
      this.eventBus.on('dag.completed', (event: MorPexEvent) => {
        const executionId = `exec_${event.payload?.planId ?? event.executionId}`;
        this.engine.completeExecution(executionId, true);
        this.currentDAGs.delete(executionId);
      }),
    );

    // 监听 DAG 节点状态变更
    this.unsubscribers.push(
      this.eventBus.on('dag.node.status_changed', (event: MorPexEvent) => {
        const payload = event.payload as any;
        const { nodeId, status, prevStatus } = payload ?? {};
        const executionId = `exec_${event.executionId}`;

        if (!nodeId || !status) return;

        if (status === 'running' && prevStatus === 'pending') {
          // 首次执行 → 创建执行节点
          this.engine.createNode(executionId, {
            dagNodeId: nodeId,
            name: payload.node?.name ?? nodeId,
            attempt: 0,
          });
        }

        // 映射 DAG 状态 → Exec Graph 状态
        const execStatus = this.mapDAGStatus(status);
        if (execStatus) {
          // 查找对应执行节点
          const graph = this.engine.getGraph(executionId);
          if (graph) {
            const execNodes = graph.nodes.filter(n => n.dagNodeId === nodeId);
            const latestNode = execNodes[execNodes.length - 1];
            if (latestNode) {
              this.engine.updateNodeStatus(executionId, latestNode.id, execStatus);
            }
          }
        }
      }),
    );

    // 监听 DAG 节点失败 → 记录重试
    this.unsubscribers.push(
      this.eventBus.on('dag.node.failed', (event: MorPexEvent) => {
        const payload = event.payload as any;
        const { nodeId, error } = payload ?? {};
        const executionId = `exec_${event.executionId}`;

        if (!nodeId) return;

        const graph = this.engine.getGraph(executionId);
        if (!graph) return;

        // 计算重试次数
        const instances = this.engine.getNodeInstances(executionId, nodeId);
        const attempt = instances.length;

        // 记录重试
        this.engine.recordRetry(
          executionId,
          nodeId,
          payload.node?.name ?? nodeId,
          attempt,
          error ?? 'unknown',
        );
      }),
    );

    // 监听统计查询
    this.unsubscribers.push(
      this.eventBus.on('graph.get_stats', () => {
        this.emitEvent('graph.stats', { stats: this.engine.getStats() });
      }),
    );

    console.log('[ExecGraphPlugin] 已启动，正在监听 dag.* 事件');
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.engine.clear();
    console.log('[ExecGraphPlugin] 已停止');
  }

  /**
   * 映射 DAG 节点状态 → Execution Graph 状态
   */
  private mapDAGStatus(dagStatus: string): string | null {
    const map: Record<string, string> = {
      'pending': 'pending',
      'running': 'running',
      'success': 'completed',
      'failed': 'failed',
      'skipped': 'skipped',
      'rerouting': 'paused',
    };
    return map[dagStatus] ?? null;
  }

  /** 获取引擎实例 */
  getEngine(): ExecutionGraphEngine {
    return this.engine;
  }

  private emitEvent(type: string, payload: any): void {
    const event: MorPexEvent = {
      id: this.identity.createEventId(),
      type,
      timestamp: Date.now(),
      executionId: 'exec-graph-plugin',
      source: 'exec-graph-plugin',
      payload,
    };
    this.eventBus.emit(event);
  }
}
