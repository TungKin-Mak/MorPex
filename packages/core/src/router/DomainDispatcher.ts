/**
 * DomainDispatcher — 跨领域 DAG 执行调度器
 *
 * 接收 CrossDomainRouter 生成的 DAG，
 * 逐节点分发到对应 DomainCluster 执行。
 * 支持依赖管理、并行执行、结果汇总。
 *
 * L3 事务隔离：在每批并行执行前检测 artifact 写入冲突，
 * 如有冲突通过 NegotiationEngine 协商串行化。
 *
 * v2.4 迁移：推荐通过 {@link CrossDomainRouter.dispatch} 统一路由后自动调度。
 * 直接调用 executeDAG 时确保 DAG 已由 CrossDomainRouter 的 LLM 分析生成。
 *
 * 执行流程：
 *   1. 接收 DAG 节点列表
 *   2. 拓扑排序 + 依赖检查
 *   3. 按就绪状态逐批执行节点（含冲突检测）
 *   4. 收集执行结果
 *   5. 返回汇总的执行结果
 */

import type { DAGNode } from '../domains/types.js';
import type { SessionContext } from '../common/types.js';
import type { ArtifactRef } from '../domains/types.js';
import { DomainClusterManager } from '../domains/DomainClusterManager.js';
import { AsyncResourceLocker } from '../utils/AsyncResourceLocker.js';
import type { AgentHarness } from '@earendil-works/pi-agent-core';

// ★ v3.0 OpenSpace Fusion import
import type { ToolQualityManager } from '../extensions/planning/ToolQualityManager.js';

/** 节点执行结果 */
export interface NodeResult {
  taskId: string;
  domain: string;
  status: 'completed' | 'failed';
  output?: unknown;
  error?: string;
  duration: number;
  artifacts?: Array<{ type: string; name: string; uri: string }>;
}

/** 整体执行结果 */
export interface DAGExecutionResult {
  success: boolean;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  results: NodeResult[];
  duration: number;
  error?: string;
}

/**
 * DomainDispatcher — 跨领域 DAG 执行调度器
 */
export class DomainDispatcher {
  private clusterManager: DomainClusterManager;

  /** 节点执行前的回调 */
  onNodeStart: ((node: DAGNode) => void) | null = null;
  /** 节点执行完成回调 */
  onNodeComplete: ((result: NodeResult) => void) | null = null;
  /** 节点执行失败回调 */
  onNodeFail: ((node: DAGNode, error: string) => void) | null = null;
  /** 整个 DAG 完成回调 */
  onComplete: ((result: DAGExecutionResult) => void) | null = null;
  /** 节点需要用户输入时的回调 — 返回 true 表示需要等待用户回复 */
  onNodeAwaitingInput: ((node: DAGNode, result: NodeResult) => boolean | Promise<boolean>) | null = null;

  /** ★ v3.2: 获取 AgentHarness 的回调（由 SessionManager 注入） */
  onGetHarness: ((domainId: string, taskId: string, goal: string) => Promise<AgentHarness>) | null = null;
  /** ★ v3.2: 释放 AgentHarness 的回调（由 SessionManager 注入） */
  onReleaseHarness: ((taskId: string) => Promise<void>) | null = null;
  /** 暂停状态：被 user reply 重新唤醒的节点上下文 */
  private _resumeContext?: { execId: string; reply: string } | null = null;

  /** 设置恢复上下文（外部调用，用户回复后触发） */
  setResumeContext(ctx: { execId: string; reply: string }): void {
    this._resumeContext = ctx;
  }

  /** 清除恢复上下文 */
  clearResumeContext(): void {
    this._resumeContext = null;
  }
  /** 协商引擎（跨领域冲突时触发 InterrogationTicket） */
  /** 协商引擎（跨领域冲突时触发 InterrogationTicket） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private negotiationEngine?: any;
  /** 仲裁处理器（协商升级时裁决） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private arbitrationHandler?: any;
  /** L1: per-resource async mutex (批次冲突节点串行化执行) */
  private _locker?: AsyncResourceLocker;

  /** ★ v3.0 Optional ToolQualityManager for per-node quality tracking */
  private _toolQualityManager: ToolQualityManager | null = null;

  /** ★ v3.0 Set the ToolQualityManager for recording per-node execution quality. */
  setToolQualityManager(tqm: ToolQualityManager | null): void {
    this._toolQualityManager = tqm;
  }

  /** 最大并行执行节点数 */
  private maxParallel: number;

  constructor(
    clusterManager: DomainClusterManager,
    maxParallel?: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    negotiationEngine?: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    arbitrationHandler?: any,
    locker?: AsyncResourceLocker,
  ) {
    this.clusterManager = clusterManager;
    this.maxParallel = maxParallel ?? 3;
    this.negotiationEngine = negotiationEngine;
    this.arbitrationHandler = arbitrationHandler;
    this._locker = locker;
  }

  /**
   * executeDAG — 执行完整的 DAG（v2.5: SessionContext 贯穿）
   *
   * @param dag - DAG 节点列表
   * @param sessionCtx - 会话上下文（贯穿所有领域，携带 artifacts + memory）
   * @returns 执行结果
   */
  async executeDAG(dag: DAGNode[], sessionCtx?: SessionContext): Promise<DAGExecutionResult> {
    const startTime = Date.now();
    const results: NodeResult[] = [];
    const nodeMap = new Map(dag.map(n => [n.taskId, { ...n }]));

    if (dag.length === 0) {
      return {
        success: true,
        totalNodes: 0,
        completedNodes: 0,
        failedNodes: 0,
        results: [],
        duration: 0,
      };
    }

    console.log(`[DomainDispatcher] 🚀 开始执行 DAG (${dag.length} 个节点)`);

    // 主循环：持续执行直到所有节点完成或失败
    while (this.hasPendingNodes(nodeMap)) {
      // 获取当前批次可执行的节点（所有依赖已完成的节点）
      const readyNodes = this.getReadyNodes(nodeMap);

      if (readyNodes.length === 0) {
        // 有 pending 节点但没有可执行的 → 存在阻塞依赖
        const blocked = this.getBlockedNodes(nodeMap);
        const error = `DAG 执行阻塞: ${blocked.map(n => n.taskId).join(', ')} 的依赖无法满足`;
        console.error(`[DomainDispatcher] ❌ ${error}`);

        // 标记阻塞节点为失败
        for (const node of blocked) {
          node.status = 'failed';
          results.push({
            taskId: node.taskId,
            domain: node.domain,
            status: 'failed',
            error: '依赖阻塞',
            duration: 0,
          });
          this.onNodeFail?.(node, '依赖阻塞');
        }
        break;
      }

      // 限制并行数量
      const batch = readyNodes.slice(0, this.maxParallel);

      // ★ P0 优化: 精确冲突检测 — 仅串行化冲突节点, 非冲突节点保持并行
      const conflictResolution = await this.resolveBatchConflicts(batch);
      let executeBatch = batch;
      if (conflictResolution.serialized && conflictResolution.conflictGroups.length > 0) {
        // 收集所有冲突节点 ID
        const conflictNodeIds = new Set(
          conflictResolution.conflictGroups.flatMap(g => g.nodes.map(n => n.taskId))
        );
        // 非冲突节点保持并行
        executeBatch = batch.filter(n => !conflictNodeIds.has(n.taskId));
        // 每个冲突组只取第一个节点执行，其余留到下一轮
        for (const group of conflictResolution.conflictGroups) {
          if (group.nodes.length > 0) {
            executeBatch.push(group.nodes[0]);
          }
        }
        console.log(`[DomainDispatcher] ➡️ 精确调度: ${executeBatch.length}/${batch.length} 节点执行, ${batch.length - executeBatch.length} 个冲突节点延迟到下一轮`);
      }

      // 并行执行当前批次
      // 同领域节点串行（AgentHarness 单实例），不同领域可并行
      const batchResults = await Promise.all(
        executeBatch.map(async (node) => {
          const upstreamArtifacts = this.collectUpstreamArtifacts(node, nodeMap, results);
          const nodeCtx: SessionContext = {
            ...(sessionCtx ?? { sessionId: `sess_${Date.now()}`, executionId: `exec_${Date.now()}`, input: '', artifacts: {}, memory: [] }),
            artifacts: { ...(sessionCtx?.artifacts ?? {}), ...upstreamArtifacts },
          };
          // 按领域加锁：同领域节点串行执行，避免 AgentHarness is busy
          if (this._locker) {
            return this._locker.withLock(`domain:${node.domain}`, () => this.executeNode(node, nodeCtx));
          }
          return this.executeNode(node, nodeCtx);
        }),
      );

      // 收集结果（支持暂停：节点询问用户时阻塞后续节点）
      let paused = false;
      for (const result of batchResults) {
        results.push(result);

        if (result.status === 'completed') {
          const node = nodeMap.get(result.taskId);
          if (node) {
            // 询问用户输入？
            if (await this.onNodeAwaitingInput?.(node, result)) {
              // 节点需要用户回答：标记为 completed 让 DAG 依赖链正常，
              // 但设标志让循环退出，后续节点等待下次执行
              node.status = 'completed';
              node.result = result.output;
              paused = true;
            } else {
              node.status = 'completed';
              node.result = result.output;
            }
          }
          this.onNodeComplete?.(result);
        } else {
          const node = nodeMap.get(result.taskId);
          if (node) {
            node.status = 'failed';
            node.error = result.error;
          }
          this.onNodeFail?.(nodeMap.get(result.taskId)!, result.error ?? '未知错误');
        }
      }

      // 如果有节点暂停等待用户输入，退出循环，后续节点等用户回复后重新执行
      if (paused) {
        console.log(`[DomainDispatcher] ⏸️ 用户输入需要，暂停 DAG 执行`);
        break;
      }

      // 如果所有剩余节点都是 failed 状态，提前终止
      if (this.allRemainingBlocked(nodeMap)) {
        break;
      }
    }

    const duration = Date.now() - startTime;
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;

    const finalResult: DAGExecutionResult = {
      success: failed === 0,
      totalNodes: dag.length,
      completedNodes: completed,
      failedNodes: failed,
      results,
      duration,
    };

    this.onComplete?.(finalResult);
    console.log(`[DomainDispatcher] ✅ DAG 执行完成: ${completed}/${dag.length} 成功, ${duration}ms`);

    return finalResult;
  }

  /**
   * executeNode — 执行单个 DAG 节点（v2.5: SessionContext 注入）
   *
   * 将任务 + 完整上下文分发到对应的 DomainCluster。
   * SessionContext 包含上游节点的产物引用和跨领域记忆。
   */
  async executeNode(node: DAGNode, sessionCtx: SessionContext): Promise<NodeResult> {
    const startTime = Date.now();
    this.onNodeStart?.(node);

    console.log(`[DomainDispatcher] ▶️ 执行节点: ${node.taskId} (${node.domain})`);

    if (!this.clusterManager.hasDomain(node.domain)) {
      return {
        taskId: node.taskId, domain: node.domain, status: 'failed',
        error: `领域 ${node.domain} 未注册`, duration: 0,
      };
    }

    let harness: AgentHarness | null = null;
    try {
      // ★ v3.2: 通过回调获取 harness（由 SessionManager 创建）
      if (this.onGetHarness) {
        harness = await this.onGetHarness(node.domain, node.taskId, node.goal);
      }
      if (!harness) {
        throw new Error('无法获取 AgentHarness');
      }

      // 设置当前 taskId（供 cluster.onUserInputNeeded 使用）
      const cluster = this.clusterManager.getCluster(node.domain);
      if (cluster) cluster._currentTaskId = node.taskId;

      // 执行任务 — 传递 harness + SessionContext
      const result = await this.clusterManager.execute(node.domain, node.goal, harness, sessionCtx);

      const duration = Date.now() - startTime;
      console.log(`[DomainDispatcher] ✅ 节点完成: ${node.taskId} (${duration}ms)`);

      // 提取下游可用的产物引用
      const artifacts: ArtifactRef[] = (result as any)?.artifactRefs
        ?? (result as any)?.artifacts
        ?? [];

      // ★ v3.0: Record successful tool call
      if (this._toolQualityManager) {
        this._toolQualityManager.recordToolCall(node.taskId, node.domain, true, duration);
      }

      return {
        taskId: node.taskId, domain: node.domain, status: 'completed',
        output: result, duration,
        artifacts: artifacts.map((a: { type?: string; name?: string; uri?: string }) => ({ type: a.type ?? 'unknown', name: a.name ?? node.taskId, uri: a.uri ?? `artifact://${node.domain}/output/${node.taskId}` })),
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[DomainDispatcher] ❌ 节点失败: ${node.taskId} (${err.message})`);

      // 检查是否为跨领域冲突 — 触发 NegotiationEngine
      const isConflict = err.message?.includes('artifact_conflict')
        || err.message?.includes('conflict')
        || err.message?.includes('locked');

      if (isConflict && this.negotiationEngine) {
        try {
          const ticket = this.negotiationEngine.createTicket({
            domainA: node.domain,
            domainB: node.deps?.[0] || 'unknown',
            taskId: node.taskId,
            issue: err.message,
          });
          console.log(`[DomainDispatcher] 🤝 创建协商工单: ${ticket.ticketId}`);

          if (ticket.status === 'ESCALATED' && this.arbitrationHandler) {
            await this.arbitrationHandler.autoResolve(ticket.ticketId, {
              decision: 'reroute',
              reason: '自动裁决：重试或跳过冲突节点',
              targetDomain: node.domain,
            });
          }
        } catch (negErr) {
          console.error(`[DomainDispatcher] 协商失败: ${negErr.message}`);
        }
      }

      if (this._toolQualityManager) {
        this._toolQualityManager.recordToolCall(node.taskId, node.domain, false, duration);
      }

      return {
        taskId: node.taskId,
        domain: node.domain,
        status: 'failed',
        error: err.message,
        duration,
      };
    } finally {
      // ★ v3.2: 释放 harness
      if (harness && this.onReleaseHarness) {
        await this.onReleaseHarness(node.taskId).catch(() => {});
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * hasPendingNodes — 检查是否还有未完成的节点
   */
  private hasPendingNodes(nodeMap: Map<string, DAGNode>): boolean {
    for (const node of nodeMap.values()) {
      if (node.status === 'pending') return true;
    }
    return false;
  }

  /**
   * getReadyNodes — 获取当前可执行的节点
   *
   * 一个节点可执行的条件：
   *   1. 状态为 pending
   *   2. 所有依赖节点都已完成
   */
  private getReadyNodes(nodeMap: Map<string, DAGNode>): DAGNode[] {
    const ready: DAGNode[] = [];

    for (const node of nodeMap.values()) {
      if (node.status !== 'pending') continue;

      // 检查所有依赖是否已完成
      const allDepsCompleted = node.deps.every(depId => {
        const depNode = nodeMap.get(depId);
        return depNode && depNode.status === 'completed';
      });

      if (allDepsCompleted) {
        ready.push(node);
      }
    }

    return ready;
  }

  /**
   * getBlockedNodes — 获取被阻塞的节点
   */
  private getBlockedNodes(nodeMap: Map<string, DAGNode>): DAGNode[] {
    const blocked: DAGNode[] = [];

    for (const node of nodeMap.values()) {
      if (node.status !== 'pending') continue;

      const hasFailedDep = node.deps.some(depId => {
        const depNode = nodeMap.get(depId);
        return depNode && depNode.status === 'failed';
      });

      if (hasFailedDep) {
        blocked.push(node);
      }
    }

    return blocked;
  }

  /**
   * collectUpstreamArtifacts — 收集节点所有上游依赖的产物
   *
   * 节点 B 依赖节点 A → B 应当能访问 A 产出的所有 ArtifactRef。
   * 此方法从已完成的结果中提取上游产物，注入到下游节点的 SessionContext。
   */
  private collectUpstreamArtifacts(
    node: DAGNode,
    _nodeMap: Map<string, DAGNode>,
    completedResults: NodeResult[],
  ): Record<string, ArtifactRef[]> {
    const artifacts: Record<string, ArtifactRef[]> = {};

    for (const depId of node.deps) {
      const depResult = completedResults.find(r => r.taskId === depId && r.status === 'completed');
      if (depResult?.artifacts && depResult.artifacts.length > 0) {
        artifacts[depId] = depResult.artifacts as ArtifactRef[];
      }
    }

    return artifacts;
  }

  /**
   * allRemainingBlocked — 检查所有剩余节点是否都被阻塞
   */
  private allRemainingBlocked(nodeMap: Map<string, DAGNode>): boolean {
    const pending = [...nodeMap.values()].filter(n => n.status === 'pending');
    if (pending.length === 0) return true;

    return pending.every(n => {
      return n.deps.some(depId => {
        const depNode = nodeMap.get(depId);
        return depNode && depNode.status === 'failed';
      });
    });
  }
  /** ★ P0 优化: 按 artifact key 分组 — 从 batch 中提取冲突组 */
  private groupByArtifactKey(batch: DAGNode[]): Map<string, DAGNode[]> {
    const artifactMap = new Map<string, DAGNode[]>();
    for (const node of batch) {
      const uris = node.goal.match(/artifact:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+/g) ?? [];
      const artifactKey = uris.length > 0 ? uris.join('|') : `task:${node.taskId}`;
      if (!artifactMap.has(artifactKey)) {
        artifactMap.set(artifactKey, []);
      }
      artifactMap.get(artifactKey)!.push(node);
    }
    return artifactMap;
  }

  /** ★ P0 优化: 精确冲突检测 — 仅对有冲突的节点组串行化 */
  private async resolveBatchConflicts(
    batch: DAGNode[],
  ): Promise<{ serialized: boolean; conflict?: string; conflictGroups: Array<{ artifactKey: string; nodes: DAGNode[] }> }> {
    const emptyResult = { serialized: false, conflictGroups: [] as Array<{ artifactKey: string; nodes: DAGNode[] }> };
    if (batch.length < 2) return emptyResult;

    // 1. 按 artifact key 分组
    const artifactMap = this.groupByArtifactKey(batch);

    // 2. 找出冲突组（≥2 节点共享同一 key）
    const conflictGroups: Array<{ artifactKey: string; nodes: DAGNode[] }> = [];
    const conflictKeys: string[] = [];
    for (const [key, nodes] of artifactMap) {
      if (nodes.length >= 2) {
        conflictGroups.push({ artifactKey: key, nodes });
        conflictKeys.push(`Artifact "${key}" 被 ${nodes.map(n => n.taskId).join(', ')} 同时写入`);
      }
    }

    if (conflictGroups.length === 0) return emptyResult;

    console.warn(`[DomainDispatcher] ⚠️ 检测到 ${conflictGroups.length} 个冲突组: ${conflictKeys.join('; ')}`);

    // 3. 尝试协商（仅针对冲突组）
    if (this.negotiationEngine) {
      for (const group of conflictGroups) {
        try {
          const ticket = this.negotiationEngine.createTicket({
            domainA: group.nodes[0].domain,
            domainB: group.nodes.length > 1 ? group.nodes[1].domain : group.nodes[0].domain,
            taskId: group.nodes[0].taskId,
            issue: `Artifact "${group.artifactKey}" 被 ${group.nodes.map(n => n.taskId).join(', ')} 同时写入`,
          });
          if (ticket.status === 'ESCALATED' && this.arbitrationHandler) {
            await this.arbitrationHandler.autoResolve(ticket.ticketId, {
              decision: 'serialize',
              reason: `Artifact "${group.artifactKey}" 冲突，自动串行化`,
              targetDomain: 'all',
            });
          }
        } catch (err) {
          console.warn(`[DomainDispatcher] 冲突组协商失败: ${err.message}`);
        }
      }
    }

    console.log(`[DomainDispatcher] 🔒 精确串行化: ${conflictGroups.length} 个冲突组受到影响, 其余节点保持并行`);
    return { serialized: true, conflict: conflictKeys.join('; '), conflictGroups };
  }
}
