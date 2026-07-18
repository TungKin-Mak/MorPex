/**
 * ExecutionOrchestrator — Control Plane 编排器（v2.4）
 *
 * 职责：串联 Router → Dispatcher，建立决定性数据流管道。
 * Router 只分析，Dispatcher 只执行，编排器负责调度。
 *
 * 冲突 3 修复：消除双 DAG 执行路径，统一通过编排器串联。
 */

import { CrossDomainRouter } from '../../../router/CrossDomainRouter.js';
import { DomainDispatcher } from '../../../router/DomainDispatcher.js';
import type { DAGNode } from '../../../domains/types.js';
import type { SessionContext } from '../../../common/types.js';

// ═══════════════════════════════════════════════════════════════
// ExecutionDAG — 标准化 DAG 产出物
// ═══════════════════════════════════════════════════════════════

/** ExecutionDAG — Router 产出的标准化 DAG 对象 */
export interface ExecutionDAG {
  /** DAG 节点列表（拓扑排序后） */
  nodes: DAGNode[];
  /** 是否多领域 */
  isMultiDomain: boolean;
  /** 涉及的领域 ID 列表 */
  involvedDomains: string[];
  /** 领域依赖关系 */
  domainDependencies: Array<{ domain: string; dependsOn: string[] }>;
  /** 全局意图 */
  globalIntent: string;
  /** LLM 推理过程 */
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════
// ExecutionOrchestrator
// ═══════════════════════════════════════════════════════════════

/**
 * ExecutionOrchestrator — Control Plane 编排器
 *
 * 建立"分析 → 路由 → 执行"的标准化管道：
 *   1. Router.dispatch()  — LLM 分析输入，产出 DAG
 *   2. Dispatcher.executeDAG() — 执行 DAG
 *
 * @example
 * ```typescript
 * const orchestrator = new ExecutionOrchestrator(router, dispatcher);
 * const result = await orchestrator.orchestrate('帮我设计硬件并写推广计划');
 * console.log(result.dag.nodes, result.result);
 * ```
 */
export class ExecutionOrchestrator {
  constructor(
    private router: CrossDomainRouter,
    private dispatcher: DomainDispatcher,
  ) {}

  /**
   * orchestrate — 完整编排流程（v2.5: SessionContext 贯穿全管道）
   *
   * Step 1: Router LLM 分析用户输入，产出 ExecutionDAG
   * Step 2: Dispatcher 按拓扑顺序执行 DAG 节点，传递 SessionContext
   *
   * @param userInput - 用户原始输入
   * @param sessionCtx - 会话上下文（artifacts/memory/sessionId 贯穿所有领域）
   * @returns DAG 结构 + 执行结果
   */
  async orchestrate(
    userInput: string,
    sessionCtx?: SessionContext,
  ): Promise<{
    dag: ExecutionDAG;
    result: any;
  }> {
    // Step 1: LLM 分析 — Router 只做语义路由
    const dag = await this.router.dispatch(userInput);

    // Step 2: DAG 执行 — Dispatcher 接收完整 SessionContext
    const ctx = sessionCtx ?? {
      sessionId: `sess_${Date.now()}`,
      executionId: `exec_${Date.now()}`,
      input: userInput,
      artifacts: {},
      memory: [],
    };
    const result = await this.dispatcher.executeDAG(dag.nodes, ctx);

    return { dag, result };
  }
}
