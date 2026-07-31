// @ts-nocheck
/**
 * ExecutionOrchestrator — Control Plane 编排器（v2.4 → v3.1）
 *
 * Phase 1+7 增强：支持新旧两条执行路径
 * - 旧路径: Router → Dispatcher（保留兼容性）
 * - 新路径: → DAG Runtime（新增，Phase 1）
 *
 * Router 只分析，不执行。通过 ExecutionOrchestrator 串联执行引擎。
 */

import { CrossDomainRouter } from '../../../router/CrossDomainRouter.js';
import { DomainDispatcher } from '../../../router/DomainDispatcher.js';
import { DAGRuntime } from '../../../runtime/dag/DAGRuntime.js';
import type { DAGNode } from '../../../domains/types.js';
import type { SessionContext } from '../../../common/types.js';

// ═══════════════════════════════════════════════════════════════
// ExecutionDAG — 标准化 DAG 产出物
// ═══════════════════════════════════════════════════════════════

export interface ExecutionDAG {
  nodes: DAGNode[];
  isMultiDomain: boolean;
  involvedDomains: string[];
  domainDependencies: Array<{ domain: string; dependsOn: string[] }>;
  globalIntent: string;
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════
// ExecutionOrchestrator
// ═══════════════════════════════════════════════════════════════

/**
 * ExecutionOrchestrator — Control Plane 编排器
 *
 * 支持两条执行路径：
 * - orcherate(): 旧路径 Router → Dispatcher
 * - orcherateWithRuntime(): 新路径 → DAGRuntime（推荐）
 */
export class ExecutionOrchestrator {
  constructor(
    private router: CrossDomainRouter,
    private dispatcher: DomainDispatcher,
    private dagRuntime?: DAGRuntime,
  ) {}

  /** 设置 DAG Runtime（可在构造后注入） */
  setDAGRuntime(runtime: DAGRuntime): void { this.dagRuntime = runtime; }

  /** 旧路径：Router → Dispatcher */
  async orchestrate(
    userInput: string,
    sessionCtx?: SessionContext,
  ): Promise<{ dag: ExecutionDAG; result: any }> {
    const dag = await this.router.dispatch(userInput);
    const ctx = sessionCtx ?? {
      sessionId: `sess_${Date.now()}`, executionId: `exec_${Date.now()}`,
      input: userInput, artifacts: {}, memory: [],
    };
    const result = await this.dispatcher.executeDAG(dag.nodes, ctx);
    return { dag, result };
  }

  /**
   * 新路径：Router → DAG Runtime（Phase 1）
   * 将 Router 产出的 ExecutionDAG 转换为 DAGRuntime 可执行的格式
   */
  async orchestrateWithRuntime(
    userInput: string,
    sessionCtx?: SessionContext,
  ): Promise<{ dag: ExecutionDAG; result: any; trace: any[] }> {
    if (!this.dagRuntime) {
      throw new Error('[ExecutionOrchestrator] DAG Runtime not configured — call setDAGRuntime() first');
    }

    const planDag = await this.router.dispatch(userInput);

    // 转换 Router ExecutionDAG → DAGRuntime ExecutionDAG 格式
    const runtimeDag = {
      id: `dag_${Date.now()}`,
      nodes: planDag.nodes.map((n, i) => ({
        id: n.id || `n${i}`,
        name: n.description || n.id,
        agentType: n.agentType || 'default',
        description: n.description || '',
        deps: (n as any).dependencies || [],
        status: 'pending' as const,
        priority: (n as any).priority || 0,
        retryCount: 0,
        maxRetries: 1,
      })),
      edges: [],
      status: { totalNodes: planDag.nodes.length, totalEdges: 0, mutations: 0, isCyclic: false, canRollback: true, isComplete: false },
      createdAt: Date.now(),
    };

    const ctx = sessionCtx ?? {
      sessionId: `sess_${Date.now()}`, executionId: `exec_${Date.now()}`,
      input: userInput, artifacts: {}, memory: [],
    };

    const result = await this.dagRuntime.run(runtimeDag, ctx);
    return { dag: planDag, result: result.nodeResults, trace: result.executionTrace };
  }
}
