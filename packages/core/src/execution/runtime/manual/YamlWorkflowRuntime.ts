/**
 * YamlWorkflowRuntime — 部门手册通用解释器（四件套之"解释器"）
 *
 * 职责（领域无关——任意部门的 manual.yaml 均由此驱动）：
 *   1. 把手册 steps 翻译为 ExecutionDAG（depends_on → deps）
 *   2. 复用 DAGRuntime 作为执行底座（nodeHandler 注入步骤执行逻辑）
 *   3. 实现 DAGRuntime 不具备的【回跳语义】：
 *        on_failure: backjump:X → 重置 X 及其全部下游节点，以失败上下文重跑子图
 *        硬上限 maxBackjumps（默认 3）防死循环（Bounded Autonomy）
 *   4. ask 人审门：执行前经 UserAskService 阻塞等待用户回答
 *
 * 步骤执行分派（nodeHandler）：
 *   action === 'llm'          → stepExecutor.executeStep（step-agent 工具循环；未注入则显式失败）
 *   action === '<primitive>'  → DomainPrimitiveRegistry.execute（领域原语或 MCP 桥接动作，

 *                                MCP 工具由注册方桥接进 Registry，本层协议无关）
 *
 * 变量替换：${inputs.x} / ${steps.<id>.outputs.<name>} → 执行期上下文解析。
 *
 * @packageDocumentation
 */

import type { ExecutionDAG, DAGNode } from '../dag/types.js';
import { DAGRuntime } from '../dag/DAGRuntime.js';
import { DomainPrimitiveRegistry } from '../../../infrastructure/tools/DomainPrimitiveRegistry.js';
import type { EventBus } from '../../../infrastructure/common/EventBus.js';
import type {
  WorkflowManual,
  ManualStep,
} from './YamlManualLoader.js';
import { parseFailurePolicy } from './YamlManualLoader.js';

// ── 类型 ──

/** step-agent 执行器窄接口（避免直接依赖 StepAgentExecutor 内部类型） */
export interface ManualStepExecutorLike {
  executeStep(
    node: { id: string; name: string; description: string; agentType: string },
    upstreamResults: Map<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<{ success: boolean; output?: unknown; error?: string }>;
}

/** ask_user 工具形态（与 UserAskService.createAskUserTool 返回一致） */
export interface ManualAskToolLike {
  execute(params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
}

export interface YamlWorkflowRuntimeOptions {
  /** 手册（已由 YamlManualLoader 校验） */
  manual: WorkflowManual;
  eventBus?: EventBus;
  /** llm 步骤的 step-agent 执行器 */
  stepExecutor?: ManualStepExecutorLike;
  /** ask_user 工具（未注入时 ask 步骤按无门处理并 WARN） */
  askTool?: ManualAskToolLike;
  /** 回跳硬上限（默认 3，Bounded Autonomy） */
  maxBackjumps?: number;
  departmentId?: string;
}

export interface ManualRunResult {
  success: boolean;
  manualName: string;
  outputs: Map<string, Map<string, unknown>>; // stepId -> outputName -> value
  backjumps: number;
  skippedSteps: string[];
  error?: string;
  duration: number;
}

// ── 运行时 ──

export class YamlWorkflowRuntime {
  readonly name = 'YamlWorkflowRuntime';
  private readonly manual: WorkflowManual;
  private readonly opts: Required<Pick<YamlWorkflowRuntimeOptions, 'maxBackjumps'>> &
    YamlWorkflowRuntimeOptions;

  constructor(opts: YamlWorkflowRuntimeOptions) {
    this.manual = opts.manual;
    this.opts = { maxBackjumps: 3, ...opts };
  }

  /**
   * run — 完整闭环：建图 → 执行 → 失败按 on_failure 回跳/跳过/中止 → 汇总
   */
  async run(inputs: Record<string, unknown> = {}): Promise<ManualRunResult> {
    const start = Date.now();
    const stepOutputs = new Map<string, Map<string, unknown>>(); // stepId -> outputName -> value
    const skipped: string[] = [];
    let backjumps = 0;

    // 步骤失败信息（回跳时注入下游上下文）
    const failureNotes = new Map<string, string>();

    // 全量 DAG（首次执行）
    const fullDag = this.buildDag();

    // 主循环：每次 runDag 只跑"待执行子图"
    let pendingIds = new Set(fullDag.nodes.map(n => n.id));
    let lastError: string | undefined;

    outer: while (pendingIds.size > 0) {
      const subDag = this.subDag(fullDag, pendingIds);
      const runtime = new DAGRuntime({
        eventBus: this.opts.eventBus,
        continueOnFailure: true,
        nodeHandler: (node, ctx) => {
          const upstream = ((ctx as Record<string, unknown>)?.upstreamResults ?? new Map()) as Map<string, unknown>;
          return this.executeNode(node.id, upstream, inputs, stepOutputs, failureNotes);
        },
      });
      const result = await runtime.run(subDag, {
        goal: this.manual.description ?? this.manual.name,
        departmentId: this.opts.departmentId,
        stepOutputs: Object.fromEntries(stepOutputs),
      });

      // 收集本轮成功产出 + 失败节点
      const failedNow: Array<{ id: string; error: string }> = [];
      for (const node of subDag.nodes) {
        const dn = result.nodeResults.get(node.id);
        if (dn !== undefined) {
          this.recordOutputs(node.id, dn, stepOutputs);
        }
      }
      for (const n of subDag.nodes) {
        const err = this.findFailure(result, n.id);
        if (err) failedNow.push({ id: n.id, error: err });
      }

      if (failedNow.length === 0) break; // 全部成功

      // 按 on_failure 处理第一个失败节点（同批多失败逐轮消化）
      failedNow.sort((a, b) => this.topoIndex(a.id) - this.topoIndex(b.id));
      const failed = failedNow[0]!;
      const step = this.stepById(failed.id)!;
      const policy = parseFailurePolicy(failed.id, step.on_failure);

      switch (policy.kind) {
        case 'skip': {
          skipped.push(failed.id);
          pendingIds.delete(failed.id);
          // 下游不再依赖它的产物（置空占位），继续跑
          this.markOutputsPlaceholder(failed.id, stepOutputs);
          continue outer;
        }
        case 'abort': {
          lastError = `步骤 ${failed.id} 失败（on_failure: abort）: ${failed.error}`;
          break outer;
        }
        case 'retry': {
          // retry(n) 语义由 DAGRuntime 节点级 maxRetries 承担；此处仅再入队一次兜底
          pendingIds = new Set([failed.id]);
          continue outer;
        }
        case 'backjump': {
          if (backjumps >= this.opts.maxBackjumps) {
            lastError = `回跳次数超上限（${this.opts.maxBackjumps}）——步骤 ${failed.id} 失败: ${failed.error}`;
            break outer;
          }
          backjumps++;
          failureNotes.set(policy.target, `第${backjumps}次回跳自 ${failed.id}: ${failed.error}`);
          // 重置目标及其全部下游（在 pending 集合内），上游成功产物保留复用
          const resetSet = this.closureDownstream(policy.target, pendingIds);
          for (const id of resetSet) {
            stepOutputs.delete(id);
            failureNotes.delete(id); // 清掉被重置节点的旧失败注记
          }
          pendingIds = resetSet;
          continue outer;
        }
        default: {
          lastError = `步骤 ${failed.id} 失败: ${failed.error}`;
          break outer;
        }
      }
    }

    const success = lastError === undefined && [...pendingIds].every(id => stepOutputs.has(id));
    return {
      success,
      manualName: this.manual.name,
      outputs: stepOutputs,
      backjumps,
      skippedSteps: skipped,
      error: lastError,
      duration: Date.now() - start,
    };
  }

  // ── 内部：节点执行（nodeHandler 回调）──

  private async executeNode(
    nodeId: string,
    upstream: Map<string, unknown>,
    workflowInputs: Record<string, unknown>,
    stepOutputs: Map<string, Map<string, unknown>>,
    failureNotes: Map<string, string>,
  ): Promise<unknown> {
    const step = this.stepById(nodeId);
    if (!step) throw new Error(`[YamlWorkflowRuntime] 手册中不存在步骤: ${nodeId}`);

    // ── ask 人审门（先问后做；用户未答则阻塞，超时按 timeout 策略）──
    if (step.ask) {
      const liveForAsk = new Map(stepOutputs);
      for (const [depId, out] of upstream) {
        liveForAsk.set(depId, this.toBag(out, this.stepById(depId)?.outputs ?? []));
      }
      await this.runAskGate(step, liveForAsk, failureNotes);
    }

    // ── 输入解析：${inputs.x} / ${steps.<id>.outputs.<name>} ──
    // 跨步引用优先取本运行内上游新鲜产出（upstream），回跳轮次再落 stepOutputs 历史
    const liveOutputs = new Map(stepOutputs);
    for (const [depId, out] of upstream) {
      liveOutputs.set(depId, this.toBag(out, this.stepById(depId)?.outputs ?? []));
    }
    const resolved = this.resolveInputs(step.inputs ?? {}, workflowInputs, liveOutputs);

    // ── 分派 ──
    if (step.action === 'llm') {
      if (!this.opts.stepExecutor) {
        throw new Error(`[YamlWorkflowRuntime] 步骤 ${nodeId} 为 llm 动作但未注入 stepExecutor`);
      }
      const description = this.renderTemplate(step.description, resolved, failureNotes.get(nodeId));
      const r = await this.opts.stepExecutor.executeStep(
        { id: nodeId, name: nodeId, description, agentType: 'general' },
        new Map(Object.entries(resolved)),
        { departmentId: this.opts.departmentId },
      );
      if (!r.success) throw new Error(r.error ?? `llm 步骤 ${nodeId} 失败`);
      return r.output;
    }

    // 原语/MCP 桥接动作：DomainPrimitiveRegistry 统一入口
    if (!DomainPrimitiveRegistry.isRegistered(step.action)) {
      throw new Error(`[YamlWorkflowRuntime] 未注册的动作 "${step.action}"（步骤 ${nodeId}）——请确认原语或 MCP 桥接已注册`);
    }
    const result = await DomainPrimitiveRegistry.execute(step.action, resolved, {
      departmentId: this.opts.departmentId,
    });
    if (!result.success) throw new Error(result.error ?? `原语 ${step.action} 执行失败`);
    return result.data;
  }

  /** ask 门：模板渲染后调 askTool 阻塞等待；reject 策略下超时/失败抛错走 on_failure */
  private async runAskGate(
    step: ManualStep,
    stepOutputs: Map<string, Map<string, unknown>>,
    failureNotes: Map<string, string>,
  ): Promise<void> {
    const ask = step.ask!;
    if (!this.opts.askTool) {
      console.warn(`[YamlWorkflowRuntime] ⚠️ 步骤 ${step.id} 配置了 ask 但未注入 askTool——跳过人审门（不阻断）`);
      return;
    }
    const prompt = this.renderTemplate(ask.prompt, this.resolveInputs({}, {}, stepOutputs), failureNotes.get(step.id))
      .replace(/\{\{missing_points\}\}/g, failureNotes.get('analyze') ?? '')
      .replace(/\{\{candidates\}\}/g, String(stepOutputs.get('select_chip')?.get('chip') ?? '见知识库'));
    console.log(`[YamlWorkflowRuntime] ❓ 人审门 [${step.id}] 等待用户回答: ${prompt.slice(0, 120)}`);
    const r = await this.opts.askTool.execute({ question: prompt });
    const answer = r.content?.map(c => c.text).join('\n') ?? '';
    if (/ask_user 超时/.test(answer) && ask.timeout === 'reject') {
      throw new Error(`[YamlWorkflowRuntime] 人审门超时（步骤 ${step.id}）→ 走 on_failure`);
    }
    // 用户回答注入后续模板可用上下文（{{user_answer}}）
    failureNotes.set(`${step.id}:answer`, answer);
  }

  // ── 内部：变量解析 ──

  /** 解析 ${inputs.x} / ${steps.<id>.outputs.<name>} 表达式 */
  private resolveInputs(
    spec: Record<string, string>,
    workflowInputs: Record<string, unknown>,
    stepOutputs: Map<string, Map<string, unknown>>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, expr] of Object.entries(spec)) {
      out[k] = this.resolveExpr(String(expr), workflowInputs, stepOutputs);
    }
    return out;
  }

  private resolveExpr(
    expr: string,
    workflowInputs: Record<string, unknown>,
    stepOutputs: Map<string, Map<string, unknown>>,
  ): unknown {
    const m = expr.match(/^\$\{inputs\.([\w-]+)\}$/);
    if (m) return workflowInputs[m[1]!];
    const s = expr.match(/^\$\{steps\.([\w-]+)\.outputs\.([\w-]+)\}$/);
    if (s) {
      const [, stepId, name] = s as [string, string, string];
      return stepOutputs.get(stepId)?.get(name);
    }
    // 非表达式 → 字面量
    return expr;
  }

  /** 描述模板渲染：${...} 与 {{key}} 占位替换（宽松——缺值保留占位原文供 LLM 判断） */
  private renderTemplate(tpl: string, vars: Record<string, unknown>, extra?: string): string {
    let text = tpl.replace(/\$\{([\w.-]+)\}/g, (_, path: string) => {
      const v = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], vars);
      return v === undefined ? `\${${path}}` : String(v);
    });
    if (extra) text += `\n\n【上次尝试失败参考】${extra}`;
    return text;
  }

  // ── 内部：图构造与操作 ──

  /** 手册 → ExecutionDAG（deps 即 depends_on） */
  private buildDag(): ExecutionDAG {
    const nodes: DAGNode[] = this.manual.steps.map(s => ({
      id: s.id,
      name: s.id,
      agentType: s.action === 'llm' ? 'general' : 'primitive',
      description: s.description,
      deps: [...(s.depends_on ?? [])],
      status: 'pending',
      priority: 0,
      retryCount: 0,
      maxRetries: this.parseRetries(s),
    }));
    const edges = this.manual.steps.flatMap(s =>
      (s.depends_on ?? []).map(d => ({ from: d, to: s.id, weight: 1 })),
    );
    return {
      id: `manual_${this.manual.name}_v${this.manual.version}_${Date.now()}`,
      nodes,
      edges,
      status: { totalNodes: nodes.length, totalEdges: edges.length, mutations: 0, isCyclic: false, canRollback: false, isComplete: false },
      createdAt: Date.now(),
    };
  }

  private parseRetries(s: ManualStep): number {
    const p = parseFailurePolicy(s.id, s.on_failure);
    return p.kind === 'retry' ? p.times : 0;
  }

  /** 从全量 DAG 取子图（只含 ids 及其内部边）——用于回跳重跑 */
  private subDag(full: ExecutionDAG, ids: Set<string>): ExecutionDAG {
    return {
      ...full,
      id: `${full.id}_sub_${Date.now()}`,
      nodes: full.nodes.filter(n => ids.has(n.id)).map(n => ({ ...n, status: 'pending' as const })),
      edges: full.edges.filter(e => ids.has(e.from) && ids.has(e.to)),
    };
  }

  /** 目标 + 其全部下游（限制在 pending 集合内）——回跳重置范围 */
  private closureDownstream(targetId: string, within: Set<string>): Set<string> {
    const out = new Set<string>([targetId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of this.manual.steps) {
        if (!within.has(s.id) || out.has(s.id)) continue;
        if ((s.depends_on ?? []).some(d => out.has(d))) {
          out.add(s.id);
          grew = true;
        }
      }
    }
    return out;
  }

  private stepById(id: string): ManualStep | undefined {
    return this.manual.steps.find(s => s.id === id);
  }

  private topoIndex(id: string): number {
    return this.manual.steps.findIndex(s => s.id === id);
  }

  /** 原始产出 → outputName→value 包（recordOutputs/markOutputsPlaceholder 共用） */
  private toBag(raw: unknown, names: string[]): Map<string, unknown> {
    const bag = new Map<string, unknown>();
    if (raw !== null && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) bag.set(k, v);
    }
    if (names.length > 0) {
      const obj = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      for (const n of names) bag.set(n, obj && n in obj ? obj[n] : raw);
    } else {
      bag.set('output', raw);
    }
    return bag;
  }

  /** 把步骤产出到 outputNames 映射（单产物挂全部声明名；对象产物按下字段展开） */
  private recordOutputs(stepId: string, raw: unknown, sink: Map<string, Map<string, unknown>>): void {
    sink.set(stepId, this.toBag(raw, this.stepById(stepId)?.outputs ?? []));
  }

  /** skip 后给下游一个空占位，防引用悬空 */
  private markOutputsPlaceholder(stepId: string, sink: Map<string, Map<string, unknown>>): void {
    const step = this.stepById(stepId);
    const bag = new Map<string, unknown>();
    for (const n of step?.outputs ?? []) bag.set(n, null);
    bag.set('output', null);
    sink.set(stepId, bag);
  }

  /** 从 DAGResult 中找指定节点失败原因（errors 或 trace） */
  private findFailure(result: { errors: Array<{ nodeId: string; error: string }> }, nodeId: string): string | undefined {
    return result.errors.find(e => e.nodeId === nodeId)?.error;
  }
}
