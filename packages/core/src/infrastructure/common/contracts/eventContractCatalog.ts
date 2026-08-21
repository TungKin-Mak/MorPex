/**
 * eventContractCatalog — 事件契约目录（Event Map · 参考 deepseek-harness）
 *
 * 定位：`eventContract.ts` 机制已存在（defineContract/buildContractMap/reconcile），
 * 但生产代码无人注册契约——本目录把"空机制"填充为真实的跨层 Event Map。
 *
 * 覆盖范围：L1-L8 跨层协议事件（docs/AICOS_CORE_ARCHITECTURE.md §10）+ EventType 枚举
 * + 运行时高频事件（ontology.*、execution.*、context.*）。质量优先于数量：
 * 每个契约带 producer/consumers/validatePayload/projected，emit 路径在开发模式 WARN 校验。
 *
 * 设计约束：
 *   - 禁裸 any：payload 一律 unknown 进入，isRecord + 字段收窄；
 *   - 校验器绝不 throw（EventBus emit 主路径只 WARN 不阻断）；
 *   - 未覆盖的事件渐进式放行（不强制一步到位）；
 *   - import 使用 `.js` 后缀。
 *
 * @packageDocumentation
 */

import { defineContract, buildContractMap } from '../eventContract.js';
import type { EventContract, EventContractMap, ReconcileReport } from '../eventContract.js';
import type { EventBus } from '../EventBus.js';
import { EventType } from '../../protocol/events/EventType.js';

// ── 载荷收窄助手（禁 any，统一从 unknown 收窄）──

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 校验必填 string 字段；缺失/非 string 返回错误信息，否则 null */
function reqStr(payload: Record<string, unknown>, key: string): string | null {
  return typeof payload[key] === 'string' ? null : `${key} 缺失或非 string`;
}

/** 校验必填 string[] 字段 */
function reqStrArray(payload: Record<string, unknown>, key: string): string | null {
  return Array.isArray(payload[key]) && payload[key]!.every((v) => typeof v === 'string')
    ? null
    : `${key} 缺失或非 string[]`;
}

/** 收集一组可选错误（null 过滤） */
function errorsOf(...checks: Array<string | null>): string[] {
  return checks.filter((c): c is string => c !== null);
}

// ── 契约构造（按架构层分组）──

/**
 * 核心事件契约定义。类型名尽量与 EventType 枚举一致；协议层事件（如 evolution.*）
 * 以 docs/AICOS_CORE_ARCHITECTURE.md §10 为准，使用字符串字面量。
 */
const contracts: Array<EventContract & { type: string }> = [
  // ══════════ L1 Governance ══════════
  defineContract({
    type: 'governance.goal.authorized',
    description: '治理层授权一个目标（AuthorizedGoal 产出）',
    producer: 'ControlPlane',
    consumers: ['cognition/planning', 'execution'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'governance.approval.required',
    description: '请求人工审批（高风险操作必经）',
    producer: 'ApprovalGate',
    consumers: ['human-override', 'execution'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.APPROVAL_GRANTED,
    description: '审批通过',
    producer: 'ApprovalGate',
    consumers: ['execution'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.APPROVAL_DENIED,
    description: '审批拒绝',
    producer: 'ApprovalGate',
    consumers: ['execution', 'evolution'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),

  // ══════════ L3 Ontology Gate ══════════
  defineContract({
    type: 'ontology.query.performed',
    description: '一次 Ontology Gate 查询执行完成',
    producer: 'gate/ForcedQueryGuard',
    consumers: ['evaluation', 'evolution'],
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(
        reqStr(record, 'executionId'),
        Array.isArray(record.toolCalls) ? null : 'toolCalls 缺失或非数组',
        reqStrArray(record, 'retrievedObjectIds'),
      );
    },
  }),
  defineContract({
    type: 'ontology.query.miss',
    description: '知识缺失（QueryMiss is Signal）— 驱动 Feedback/Evolution',
    producer: 'gate',
    consumers: ['evolution/KnowledgeGapListener', 'feedback'],
    projected: true,
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(
        reqStr(record, 'executionId'),
        reqStr(record, 'tier'),
        reqStr(record, 'goal'),
        reqStr(record, 'reason'),
        typeof record.controlledExploration === 'boolean' ? null : 'controlledExploration 缺失或非 boolean',
      );
    },
  }),
  defineContract({
    type: 'ontology.reference.validation_failed',
    description: '引用校验失败（Gate 引用硬校验）',
    producer: 'gate',
    consumers: ['gate/rules', 'evolution'],
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(reqStr(record, 'executionId'), reqStrArray(record, 'missingIds'));
    },
  }),

  // ══════════ L4 Cognition & Planning ══════════
  defineContract({
    type: 'cognition.plan.created',
    description: 'L4 产出 PlanContract（携带 ontologyRefs[]）',
    producer: 'cognition/planning',
    consumers: ['execution', 'evaluation'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.CONTEXT_ASSEMBLED,
    description: 'RAG-lazy 上下文装配完成（ContextAssemblyEngine）',
    producer: 'knowledge/context/ContextAssemblyEngine',
    consumers: ['execution/harness', 'gate'],
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(
        reqStr(record, 'executionId'),
        typeof record.contextId === 'string' ? null : 'contextId 缺失或非 string',
      );
    },
  }),

  // ══════════ L5 Execution ══════════
  defineContract({
    type: EventType.EXECUTION_STARTED,
    description: '一次执行开始',
    producer: 'UnifiedExecutionEngine',
    consumers: ['observability', 'monitoring'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.EXECUTION_COMPLETED,
    description: '一次执行完成',
    producer: 'UnifiedExecutionEngine',
    consumers: ['evaluation', 'observability'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.EXECUTION_FAILED,
    description: '一次执行失败（Bounded Autonomy 终止/错误）',
    producer: 'UnifiedExecutionEngine',
    consumers: ['evolution/FailureAnalyzer', 'observability'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'execution.budget.exceeded',
    description: '执行预算超限（maxIterations/maxCostTokens 触顶终止）',
    producer: 'runtime/budget/BudgetManager',
    consumers: ['evolution', 'evaluation'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.ARTIFACT_CREATED,
    description: '产物创建（Artifact First）',
    producer: 'execution/MorPexRuntime',
    consumers: ['evaluation', 'governance', 'observability'],
    projected: true,
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(
        reqStr(record, 'executionId'),
        reqStr(record, 'artifactId'),
      );
    },
  }),
  defineContract({
    type: 'tool.called',
    description: '工具/原语调用开始',
    producer: 'ToolRegistry/DomainPrimitiveRegistry',
    consumers: ['execution/fabric', 'observability'],
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'tool.failed',
    description: '工具/原语调用失败',
    producer: 'ToolRegistry/DomainPrimitiveRegistry',
    consumers: ['evolution/FailureAnalyzer', 'observability'],
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),

  // ══════════ L6 Evaluation ══════════
  defineContract({
    type: 'evaluation.profile.scored',
    description: 'L6 产出 Performance Profile（5 维评分）',
    producer: 'evaluation/EvaluationEngine',
    consumers: ['governance', 'evolution', 'observability'],
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'evaluation.low_score',
    description: '低分事件（L7 演化只消费事件、禁止被 L4 直接触发）',
    producer: 'evaluation/EvaluationEngine',
    consumers: ['evolution/ActiveEvolutionTrigger'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'evaluation.verification.completed',
    description: 'L6 审计：产物验证完成',
    producer: 'evaluation',
    consumers: ['governance/audit', 'observability'],
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),

  // ══════════ L7 Evolution ══════════
  defineContract({
    type: 'evolution.proposal.created',
    description: '演化提案创建（QueryMiss/Failure/低分驱动）',
    producer: 'evolution',
    consumers: ['governance/approval', 'evolution/sandbox'],
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'evolution.proposal.promoted',
    description: '演化提案晋升（沙箱试跑+审批通过，版本化落地）',
    producer: 'evolution',
    consumers: ['gate', 'knowledge'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: 'evolution.rollback',
    description: '演化版本回滚（Verifiable Evolution 可回退）',
    producer: 'evolution',
    consumers: ['governance', 'execution'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),

  // ══════════ L8 / System / Workflow ══════════
  defineContract({
    type: EventType.SYSTEM_STARTED,
    description: '系统启动（bootstrapUnified 完成）',
    producer: 'bootstrap',
    consumers: ['observability', 'health'],
    validatePayload: () => [],
  }),
  defineContract({
    type: EventType.SYSTEM_ERROR,
    description: '系统级错误（需要治理层关注）',
    producer: 'infrastructure',
    consumers: ['governance/alert', 'observability'],
    projected: true,
    validatePayload: (p) => {
      const record = isRecord(p) ? p : {};
      return errorsOf(
        typeof record.error === 'string' ? null : 'error 缺失或非 string',
      );
    },
  }),
  defineContract({
    type: EventType.WORKFLOW_STEP_STARTED,
    description: '工作流步骤开始（前端实时任务卡片）',
    producer: 'DAGRuntime',
    consumers: ['studio/web', 'observability'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
  defineContract({
    type: EventType.WORKFLOW_STEP_COMPLETED,
    description: '工作流步骤完成',
    producer: 'DAGRuntime',
    consumers: ['studio/web', 'observability'],
    projected: true,
    validatePayload: (p) => errorsOf(reqStr(isRecord(p) ? p : {}, 'executionId')),
  }),
];

// ── 导出目录 ──

/** 核心事件契约表（key = 事件类型字符串） */
export const CORE_EVENT_CONTRACTS: EventContractMap = buildContractMap(...contracts);

/** 已覆盖的契约类型列表（有序） */
export const CORE_EVENT_CONTRACT_TYPES: string[] = contracts.map((c) => c.type);

// ── 接线 + 对账快照 ──

/** 最近一次对账报告（供 observability 查询；模块级单例，镜像 getSharedDeblackboxRecorder 模式） */
let lastReconcile: ReconcileReport | null = null;

/**
 * registerCoreEventContracts — 把核心契约表注入 EventBus 并执行一次即时对账。
 *
 * 幂等：重复调用仅覆盖契约表并刷新对账快照。在 bootstrapUnified 中 EventBus 就绪后调用。
 *
 * @returns 本次对账报告（空契约/双轨漂移信号）
 */
export function registerCoreEventContracts(bus: EventBus): ReconcileReport {
  bus.setContracts(CORE_EVENT_CONTRACTS);
  const report = bus.reconcileEvents();
  lastReconcile = report;
  console.log(
    `[eventContractCatalog] ✅ 已注册 ${contracts.length} 个事件契约；对账: declared=${report.declared.length}, ` +
    `emitted=${report.emitted.length}, unregistered=${report.unregistered.length}, ` +
    `unassertedEnums=${report.unassertedEnums.length}`,
  );
  return report;
}

/** 取最近一次对账报告（未注册过契约则 null） */
export function getEventContractReconcile(): ReconcileReport | null {
  return lastReconcile;
}

