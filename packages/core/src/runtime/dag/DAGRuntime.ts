/**
 * DAGRuntime — DAG 运行时主引擎
 *
 * 将 MetaPlanner 产生的 ExecutionDAG 转换为真实执行。
 *
 * 流程:
 *   1. 接收 ExecutionDAG → 构建 TaskGraph
 *   2. 循环: 解析依赖 → 调度 → 执行 → 直到完成或失败
 *   3. 返回 DAGResult
 */
import type { ExecutionDAG } from '../../planes/runtime-kernel/dag/types.js';
import { TaskGraph } from './TaskGraph.js';
import { DependencyResolver } from './DependencyResolver.js';
import { Scheduler, type SchedulerConfig } from './Scheduler.js';
import { ParallelExecutor } from './ParallelExecutor.js';
import { TaskNode } from './TaskNode.js';
import type { EventBus } from '../../common/EventBus.js';

export interface DAGResult {
  success: boolean;
  dagId: string;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  duration: number;
  nodeResults: Map<string, unknown>;
  errors: Array<{ nodeId: string; error: string }>;
  executionTrace: ExecutionTraceEntry[];
}

export interface ExecutionTraceEntry {
  nodeId: string;
  nodeName: string;
  action: 'start' | 'complete' | 'fail' | 'skip' | 'retry';
  timestamp: number;
  detail?: string;
}

export interface DAGRuntimeConfig extends SchedulerConfig {
  /** 失败时是否继续执行其他节点 */
  continueOnFailure?: boolean;
  /** Phase H: EventBus 用于发射 workflow 事件 */
  eventBus?: EventBus;
}

export class DAGRuntime {
  private config: DAGRuntimeConfig & { maxParallel: number; enablePriority: boolean; continueOnFailure: boolean };
  private executor = new ParallelExecutor();
  private trace: ExecutionTraceEntry[] = [];

  constructor(config?: DAGRuntimeConfig) {
    this.config = {
      maxParallel: config?.maxParallel ?? 4,
      enablePriority: config?.enablePriority ?? true,
      continueOnFailure: config?.continueOnFailure ?? true,
      eventBus: config?.eventBus,
    };
  }

  get executionTrace(): readonly ExecutionTraceEntry[] {
    return [...this.trace];
  }

  /**
   * 运行一个 ExecutionDAG
   */
  async run(dag: ExecutionDAG, context: unknown): Promise<DAGResult> {
    const startTime = Date.now();
    this.trace = [];

    // 1. 构建 TaskGraph
    const graph = TaskGraph.fromExecutionDAG(dag);
    const resolver = new DependencyResolver(graph);
    const scheduler = new Scheduler({
      maxParallel: this.config.maxParallel,
      enablePriority: this.config.enablePriority,
    });

    // 2. 检查循环依赖
    if (resolver.hasCycle()) {
      return this.buildResult(graph, false, startTime, 'Cyclic dependency detected');
    }

    // 3. 执行循环
    let iteration = 0;
    const maxIterations = graph.nodes.length * 2; // 防止死循环

    while (!graph.isComplete() && iteration < maxIterations) {
      iteration++;

      // 3a. 调度下一批节点
      const batch = scheduler.schedule(graph);
      if (batch.length === 0) {
        // 没有可调度节点但未完成 → 阻塞或失败
        const failedNodes = graph.getFailedNodes();
        if (failedNodes.length > 0 && !this.config.continueOnFailure) {
          // Phase A2: 失败传播 — 标记所有下游节点为 skipped
          for (const fn of failedNodes) {
            for (const node of graph.nodes) {
              if (node.status === 'pending' && node.deps.includes(fn.id)) {
                node.status = 'skipped';
                node.error = `Skipped: dependency ${fn.id} failed`;
                this.trace.push({ nodeId: node.id, nodeName: node.name, action: 'skip', timestamp: Date.now(), detail: node.error });
              }
            }
          }
          break;
        }
        // 所有剩余节点都阻塞 → 无法继续
        const blocked = graph.nodes.filter(n => n.status === 'pending');
        if (blocked.length > 0 && graph.getRunningNodes().length === 0) {
          // Phase A2: 标记无法执行的阻塞节点
          for (const b of blocked) {
            const hasFailedDep = b.deps.some(depId => {
              const dep = graph.getNode(depId);
              return dep && (dep.status === 'failed' || dep.status === 'skipped');
            });
            if (hasFailedDep) {
              b.status = 'skipped';
              b.error = 'Skipped: dependency failed';
              this.trace.push({ nodeId: b.id, nodeName: b.name, action: 'skip', timestamp: Date.now(), detail: b.error });
            }
          }
          break;
        }
        await this.sleep(10); // 等待运行中节点
        continue;
      }

      // 3b. 记录执行开始 + 发射 workflow 事件
      for (const node of batch) {
        this.trace.push({
          nodeId: node.id,
          nodeName: node.name,
          action: 'start',
          timestamp: Date.now(),
        });
        this.config.eventBus?.emit({
          id: `wf-${node.id}-${Date.now()}`,
          type: 'workflow.step_started',
          timestamp: Date.now(),
          executionId: graph.id,
          source: 'dag-runtime',
          payload: { nodeId: node.id, nodeName: node.name },
        });
      }

      // 3c. 执行批处理
      const results = await this.executor.executeAll(batch, context);

      // 3d. 记录结果 + 发射 workflow 事件
      for (const [nodeId, result] of results) {
        const node = graph.getNode(nodeId);
        const action = result.success ? 'complete' : 'fail';
        this.trace.push({
          nodeId,
          nodeName: node?.name ?? nodeId,
          action,
          timestamp: Date.now(),
          detail: result.error,
        });
        // Emit workflow event
        const eventType = result.success ? 'workflow.step_completed' : 'workflow.step_failed';
        this.config.eventBus?.emit({
          id: `wf-${nodeId}-${Date.now()}`,
          type: eventType,
          timestamp: Date.now(),
          executionId: graph.id,
          source: 'dag-runtime',
          payload: { nodeId, nodeName: node?.name ?? nodeId, success: result.success, error: result.error },
        });

        // 失败处理
        if (!result.success && node && node.canRetry && this.config.continueOnFailure) {
          this.trace.push({
            nodeId,
            nodeName: node.name,
            action: 'retry',
            timestamp: Date.now(),
            detail: `Attempt ${node.attempts}/${node.maxRetries + 1}`,
          });
        }
      }

      // 3e. 失败快速中止（如果配置了）
      if (!this.config.continueOnFailure && graph.getFailedNodes().length > 0) {
        break;
      }
    }

    // Emit workflow.completed or workflow.failed
    const finalResult = this.buildResult(graph, true, startTime);
    const wfEventType = finalResult.success ? 'workflow.completed' : 'workflow.failed';
    this.config.eventBus?.emit({
      id: `wf-${graph.id}-final`,
      type: wfEventType,
      timestamp: Date.now(),
      executionId: graph.id,
      source: 'dag-runtime',
      payload: { dagId: graph.id, success: finalResult.success, completedNodes: finalResult.completedNodes, failedNodes: finalResult.failedNodes },
    });
    return finalResult;
  }

  /**
   * 重置执行跟踪
   */
  resetTrace(): void {
    this.trace = [];
  }

  private buildResult(
    graph: TaskGraph,
    completed: boolean,
    startTime: number,
    fatalError?: string
  ): DAGResult {
    const nodes = graph.nodes;
    const completedNodes = nodes.filter(n => n.status === 'success').length;
    const failedNodes = nodes.filter(n => n.status === 'failed').length;
    const skippedNodes = nodes.filter(n => n.status === 'skipped').length;

    const nodeResults = new Map<string, unknown>();
    const errors: Array<{ nodeId: string; error: string }> = [];

    for (const node of nodes) {
      if (node.result?.output !== undefined) {
        nodeResults.set(node.id, node.result.output);
      }
      if (node.error) {
        errors.push({ nodeId: node.id, error: node.error });
      }
    }

    return {
      success: graph.isSuccess() && !fatalError,
      dagId: graph.id,
      totalNodes: nodes.length,
      completedNodes,
      failedNodes,
      skippedNodes,
      duration: Date.now() - startTime,
      nodeResults,
      errors,
      executionTrace: [...this.trace],
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
