/**
 * eventContract — 事件契约层（参考 deepseek-harness "Event Map + @mode 契约"）
 *
 * 定位：在既有 EventBus（fire-and-forget、type 为宽松 string）之上，提供一层
 * **可选的、渐进式**的事件契约描述。已注册契约的事件在开发模式下校验载荷；
 * 未注册的事件照常放行（向后兼容，不强制一步到位）。
 *
 * 复用既有资产（不重复造轮子）：
 *   - `EventType` 枚举（infrastructure/protocol/events/EventType.ts，105 成员）
 *     作为「标准事件全集」的对账来源之一；
 *   - `EventBus.getMetrics().eventsByType` 作为「运行时实际已发射类型」的对账来源。
 *   本模块只新增「契约声明 + 校验 + 对账」三个能力。
 *
 * 设计约束（AGENTS.md）：
 *   - 禁止裸 any → payload 一律以 unknown 进入，校验器自行收窄；
 *   - 记录器/校验器异常绝不影响主流程（EventBus 侧 console.warn，不 throw）；
 *   - import 使用 `.js` 后缀。
 *
 * @packageDocumentation
 */

import { getAllEventTypes } from '../../infrastructure/protocol/events/EventType.js';

// ── 契约类型 ──

/**
 * 单个事件的契约声明。
 * `validatePayload(payload: unknown): string[]` 返回错误信息数组；空数组 = 通过。
 */
export interface EventContract {
  /** 事件语义说明 */
  description: string;
  /** 生产者（模块/层，用于可观测与对账，如 'UnifiedExecutionEngine' | 'gate'） */
  producer: string;
  /** 消费者（模块/层列表） */
  consumers: string[];
  /** 是否投射到前端 SSE（缺省由 EventBus 默认策略决定） */
  projected?: boolean;
  /** 载荷校验器：传入 payload，返回错误信息数组（空 = 通过）。禁止裸 any。 */
  validatePayload: (payload: unknown) => string[];
}

/** 事件契约表：按事件名字符串索引 */
export type EventContractMap = Readonly<Record<string, EventContract>>;

// ── 契约构造工具 ──

/**
 * defineContract — 定义单个事件契约（含 type 字段）。
 *
 * 用法：
 *   const contract = defineContract({
 *     type: 'gate.query.completed',
 *     description: '一次 Ontology Gate 查询完成',
 *     producer: 'gate',
 *     consumers: ['evolution'],
 *     validatePayload: (p) => {
 *       const payload = p as GateQueryCompletedPayload; // unknown → 收窄
 *       const errors: string[] = [];
 *       if (typeof payload.queryId !== 'string') errors.push('queryId 必须是 string');
 *       return errors;
 *     },
 *   });
 */
export function defineContract(input: EventContract & { type: string }): EventContract & { type: string } {
  return input;
}

/**
 * buildContractMap — 由多个契约构造契约表（普通对象，避免原型污染）。
 */
export function buildContractMap(...defs: Array<EventContract & { type: string }>): EventContractMap {
  const map: Record<string, EventContract> = {};
  for (const d of defs) {
    map[d.type] = {
      description: d.description,
      producer: d.producer,
      consumers: d.consumers,
      ...(d.projected !== undefined ? { projected: d.projected } : {}),
      validatePayload: d.validatePayload,
    };
  }
  return map;
}

// ── 校验 / 对账 ──

/**
 * assertEventContract — 事件类型是否已在契约表中声明。
 */
export function assertEventContract(type: string, contracts: EventContractMap): boolean {
  return Object.prototype.hasOwnProperty.call(contracts, type);
}

/**
 * validateEventPayload — 校验载荷。未注册契约 → 直接通过（渐进式）。
 *
 * @returns { ok, errors } — errors 为错误信息数组，ok = errors 为空。
 */
export function validateEventPayload(
  type: string,
  payload: unknown,
  contracts: EventContractMap,
): { ok: boolean; errors: string[] } {
  const contract = contracts[type];
  if (!contract) return { ok: true, errors: [] };
  let errors: string[];
  try {
    errors = contract.validatePayload(payload);
  } catch (err) {
    errors = [`契约校验器自身抛错: ${err instanceof Error ? err.message : String(err)}`];
  }
  return { ok: errors.length === 0, errors };
}

/**
 * enumEventTypes — 从 `EventType` 枚举收集全部标准事件类型名（对账来源之一）。
 */
export function enumEventTypes(): string[] {
  return getAllEventTypes().map((t) => String(t));
}

/**
 * ReconcileReport — 事件对账结果：契约表 ∩ EventType 枚举 ∩ 运行时实际发射。
 */
export interface ReconcileReport {
  /** 已在契约表声明的事件 */
  declared: string[];
  /** EventType 枚举中的标准事件 */
  enumTypes: string[];
  /** 运行时实际发射过的事件（含发射计数） */
  emitted: Array<{ type: string; count: number }>;
  /** 已发射但既不在契约表也不在 EventType 枚举的事件（双轨漂移信号） */
  unregistered: Array<{ type: string; count: number }>;
  /** 在 EventType 枚举但从未在契约表声明的标准事件（建议补契约） */
  unassertedEnums: string[];
}

/**
 * reconcileKnownEvents — 事件对账：回答「哪些事件我声明了 / 标准里有哪些 / 实际发了哪些 /
 * 哪些实际发了但无处登记」。供授权审计与逐步迁移使用。
 *
 * @param contracts    当前契约表
 * @param emittedTypes  运行时实际发射类型（来自 EventBus.getMetrics().eventsByType）
 */
export function reconcileKnownEvents(
  contracts: EventContractMap,
  emittedTypes: Iterable<[string, number]>,
): ReconcileReport {
  const declared = Object.keys(contracts).sort();
  const enumSet = new Set(enumEventTypes());
  const enumTypes = [...enumSet].sort();

  const emitted: Array<{ type: string; count: number }> = [];
  const unregistered: Array<{ type: string; count: number }> = [];
  for (const [type, count] of emittedTypes) {
    emitted.push({ type, count });
    if (!Object.prototype.hasOwnProperty.call(contracts, type) && !enumSet.has(type)) {
      unregistered.push({ type, count });
    }
  }
  emitted.sort((a, b) => b.count - a.count);
  unregistered.sort((a, b) => b.count - a.count);

  const unassertedEnums = [...enumSet]
    .filter((t) => !Object.prototype.hasOwnProperty.call(contracts, t))
    .sort();

  return { declared, enumTypes, emitted, unregistered, unassertedEnums };
}