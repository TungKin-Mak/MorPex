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
import type { ExecutionDAG } from './types.js';
import { TaskGraph } from './TaskGraph.js';
import { DependencyResolver } from './DependencyResolver.js';
import { Scheduler, type SchedulerConfig } from './Scheduler.js';
import { ParallelExecutor } from './ParallelExecutor.js';
import { TaskNode } from './TaskNode.js';
import type { EventBus } from '../../../infrastructure/common/EventBus.js';
import { clip } from '../../orchestration/error-compactor.js';

/** U2+U3：step.completed 事件载荷中结果预览的上限（字节级字符数；完整产物应走 ArtifactRegistry，此为断点续跑的兼容载荷） */
const RESULT_CLIP = 64 * 1024;

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
  /** U2+U3 运行控制终态标记 */
  paused?: boolean;
  cancelled?: boolean;
  endedBy?: 'completed' | 'paused' | 'cancelled' | 'failed';
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
  /** 默认节点执行器：为没有自定义 handler 的节点注入执行逻辑 */
  nodeHandler?: (node: TaskNode, context: unknown) => Promise<unknown>;
  /** U2+U3 运行控制：每轮迭代顶部查询（missionId 已解析后传入） */
  shouldPause?: (missionId: string) => boolean;
  shouldCancel?: (missionId: string) => boolean;
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
      // ⬅️ 会话 3 修复：此前构造器丢弃 nodeHandler → 节点无 handler 直接成功（output=null），
      //    DAG 执行“空转”的真正根因（ServiceContainer 传入的 ExecutionFabric/step-agent 执行器从未生效）。
      nodeHandler: config?.nodeHandler,
      // U2+U3 运行控制钩子（构造器白名单必须显式拷贝，否则静默丢失）
      shouldPause: config?.shouldPause,
      shouldCancel: config?.shouldCancel,
    };
  }

  get executionTrace(): readonly ExecutionTraceEntry[] {
    return [...this.trace];
  }

  /** P-A：从执行上下文中提取任务级关联键（DAGExecutorAdapter 传入 missionId/goal）。 */
  private ctxMeta(context: unknown): { missionId?: string; goal?: string } {
    const c = (context ?? {}) as Record<string, unknown>;
    return {
      missionId: typeof c.missionId === 'string' && c.missionId ? c.missionId : undefined,
      goal: typeof c.goal === 'string' && c.goal.trim() ? c.goal.trim() : undefined,
    };
  }

  /**
   * 运行一个 ExecutionDAG
   */
  async run(dag: ExecutionDAG, context: unknown): Promise<DAGResult> {
    const startTime = Date.now();
    this.trace = [];

    // 1. 构建 TaskGraph
    const graph = TaskGraph.fromExecutionDAG(dag);
    // ═══ 会话 17i.17：发射 DAG 结构（nodes+deps → edges），前端据此渲染真实 DAG 节点图 ═══
    this.config.eventBus?.emit({
      id: `evt_dag_${Date.now()}`,
      type: 'execution.dag',
      timestamp: Date.now(),
      executionId: graph.id,
      source: 'dag-runtime',
      payload: {
        ...this.ctxMeta(context),
        dagId: graph.id,
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          deps: [...n.deps],
          // U2+U3：断点续跑重建需要这些字段（缺失会导致冷恢复节点动作描述/重试配置降级）
          agentType: n.agentType,
          description: n.description,
          maxRetries: n.maxRetries,
        })),
        edges: graph.nodes.flatMap((n) => n.deps.map((d) => ({ from: d, to: n.id }))),
      },
    });
    // ⬅️ 应用默认节点执行器（为没有自定义 handler 的节点注入 Fabric/Agent 调用）
    const defaultHandler = this.config.nodeHandler;
    if (defaultHandler) {
      for (const node of graph.nodes) {
        node.setHandler((n, ctx) => {
          // ═══ P1（会话 3 多 Agent 框架）：上游成果传递 ═══
          // 每个节点执行前，从 graph 收集其依赖节点的 output，注入 handler context，
          // 使 step-agent 能看到上游 step 的成果（跨节点交流的基础）。
          const upstream = new Map<string, unknown>();
          for (const depId of n.deps) {
            const dep = graph.getNode(depId);
            if (dep?.result?.output !== undefined) upstream.set(depId, dep.result.output);
          }
          const baseCtx = (ctx !== null && typeof ctx === 'object')
            ? { ...(ctx as Record<string, unknown>) }
            : {};
          return defaultHandler(n, { ...baseCtx, upstreamResults: upstream } as unknown);
        });
      }
    }
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

      // ═══ U2+U3 运行控制：每轮迭代顶部检查（取消优先于暂停；运行中节点不硬杀，
      // 一人规模下步骤级粒度足够——见方案文档 §二约束）═══
      const ctrlId = this.ctxMeta(context).missionId ?? graph.id;
      if (this.config.shouldCancel?.(ctrlId)) {
        for (const node of graph.nodes) {
          if (node.status === 'pending' || node.status === 'ready') {
            node.status = 'skipped';
            node.error = 'Cancelled by user';
            this.trace.push({ nodeId: node.id, nodeName: node.name, action: 'skip', timestamp: Date.now(), detail: node.error });
            this.config.eventBus?.emit({ id: `wf-${node.id}-cancel-${Date.now()}`, type: 'workflow.step_skipped', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), nodeId: node.id, nodeName: node.name, error: node.error } });
          }
        }
        this.config.eventBus?.emit({ id: `wf-${graph.id}-cancelled`, type: 'workflow.cancelled', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), dagId: graph.id } });
        const cancelledResult = this.buildResult(graph, false, startTime, 'cancelled by user');
        cancelledResult.cancelled = true;
        cancelledResult.endedBy = 'cancelled';
        return cancelledResult;
      }
      if (this.config.shouldPause?.(ctrlId)) {
        this.config.eventBus?.emit({ id: `wf-${graph.id}-paused`, type: 'workflow.paused', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), dagId: graph.id } });
        const pausedResult = this.buildResult(graph, true, startTime);
        pausedResult.paused = true;
        pausedResult.endedBy = 'paused';
        return pausedResult;
      }

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
                // U2+U3：跳过也落事件源（此前只有 trace 内存记录）
                this.config.eventBus?.emit({ id: `wf-${node.id}-skip-${Date.now()}`, type: 'workflow.step_skipped', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), nodeId: node.id, nodeName: node.name, error: node.error } });
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
              // U2+U3：阻塞节点跳过同样落事件源
              this.config.eventBus?.emit({ id: `wf-${b.id}-skip-${Date.now()}`, type: 'workflow.step_skipped', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), nodeId: b.id, nodeName: b.name, error: b.error } });
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
          payload: { ...this.ctxMeta(context), nodeId: node.id, nodeName: node.name },
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
        // U2+U3：completed 载荷携带截断结果（断点续跑时下游可消费；上限见 RESULT_CLIP）
        const outputPreview = result.success ? clip(result.output, RESULT_CLIP) : undefined;
        this.config.eventBus?.emit({
          id: `wf-${nodeId}-${Date.now()}`,
          type: eventType,
          timestamp: Date.now(),
          executionId: graph.id,
          source: 'dag-runtime',
          payload: { ...this.ctxMeta(context), nodeId, nodeName: node?.name ?? nodeId, success: result.success, error: result.error, output: outputPreview, truncated: typeof result.output === 'string' && (result.output as string).length > RESULT_CLIP },
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
          // U2+U3：重试也落事件源（attempts 供重放侧回显）
          this.config.eventBus?.emit({ id: `wf-${nodeId}-retry-${Date.now()}`, type: 'workflow.step_retry', timestamp: Date.now(), executionId: graph.id, source: 'dag-runtime', payload: { ...this.ctxMeta(context), nodeId, nodeName: node.name, attempts: node.attempts, maxRetries: node.maxRetries } });
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
      payload: { ...this.ctxMeta(context), dagId: graph.id, success: finalResult.success, completedNodes: finalResult.completedNodes, failedNodes: finalResult.failedNodes },
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
