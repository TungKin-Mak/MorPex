/**
 * infrastructure/common/__tests__/eventContract.test.ts — 事件契约层测试
 *
 * 覆盖：
 *   1. defineContract / buildContractMap：契约表构造（不含原型污染）
 *   2. assertEventContract：类型是否已在契约表中声明
 *   3. validateEventPayload：未注册→通过（渐进式）；注册且合规→通过；注册且违规→错误数组
 *   4. 校验器自身抛错 → 归为错误数组（绝不影响主流程）
 *   5. enumEventTypes：收集 EventType 枚举全量
 *   6. reconcileKnownEvents：声明/枚举/实际发射三源对账，识别双轨漂移
 *
 * import 用 `.js` 后缀；全部内存数据，不触碰存储。
 */

import { describe, it, expect } from 'vitest';
import {
  defineContract,
  buildContractMap,
  assertEventContract,
  validateEventPayload,
  enumEventTypes,
  reconcileKnownEvents,
} from '../eventContract.js';
import { EventType } from '../../protocol/events/EventType.js';

describe('defineContract / buildContractMap', () => {
  const gateContract = defineContract({
    type: 'gate.query.completed',
    description: '一次 Ontology Gate 查询完成',
    producer: 'gate',
    consumers: ['evolution'],
    validatePayload: (p) => {
      const payload = p as { queryId?: unknown; ok?: unknown };
      const errors: string[] = [];
      if (typeof payload?.queryId !== 'string') errors.push('queryId 必须是 string');
      return errors;
    },
  });

  it('构造契约表并保留 type/description/producer/consumers', () => {
    const map = buildContractMap(gateContract);
    expect(assertEventContract('gate.query.completed', map)).toBe(true);
    const c = map['gate.query.completed'];
    expect(c.producer).toBe('gate');
    expect(c.consumers).toEqual(['evolution']);
    expect(c.description).toContain('Gate');
  });

  it('普通对象 map：不污染原型（无 __proto__ 键）', () => {
    const map = buildContractMap(gateContract);
    expect(Object.prototype.hasOwnProperty.call(map, '__proto__')).toBe(false);
  });
});

describe('validateEventPayload', () => {
  const contract = defineContract({
    type: 'execution.completed',
    description: '执行完成',
    producer: 'UEE',
    consumers: ['evaluation'],
    validatePayload: (p) => {
      const payload = p as { executionId?: unknown };
      return typeof payload?.executionId === 'string' ? [] : ['executionId 缺失'];
    },
  });
  const map = buildContractMap(contract);

  it('未注册契约 → 直接通过（渐进式，不强制一步到位）', () => {
    expect(validateEventPayload('anything.not.declared', { x: 1 }, map)).toEqual({ ok: true, errors: [] });
  });

  it('注册且载荷合规 → 通过', () => {
    expect(validateEventPayload('execution.completed', { executionId: 'exe_1' }, map)).toMatchObject({ ok: true, errors: [] });
  });

  it('注册且载荷违规 → 返回错误数组', () => {
    const res = validateEventPayload('execution.completed', { nope: true }, map);
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('executionId 缺失');
  });

  it('校验器自身抛错 → 归为错误数组（不穿透影响 emit 主流程）', () => {
    const bad = defineContract({
      type: 'bad.contract',
      description: '将抛错的校验器',
      producer: 'test',
      consumers: [],
      validatePayload: () => { throw new Error('validator boom'); },
    });
    const res = validateEventPayload('bad.contract', {}, buildContractMap(bad));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('validator boom');
  });
});

describe('enumEventTypes / reconcileKnownEvents', () => {
  it('enumEventTypes 与 EventType 枚举成员一致', () => {
    const names = new Set(enumEventTypes());
    expect(names.size).toBeGreaterThan(100);
    expect(names.has(EventType.EXECUTION_STARTED)).toBe(true);
    expect(names.has(EventType.USER_MESSAGE)).toBe(true);
  });

  it('对账：识别「已发射但无处登记」的双轨漂移事件', () => {
    const map = buildContractMap(
      defineContract({
        type: 'gate.query.miss',
        description: '知识缺失信号',
        producer: 'gate',
        consumers: ['evolution'],
        validatePayload: () => [],
      }),
    );
    const report = reconcileKnownEvents(map, new Map([
      ['gate.query.miss', 3],  // 已声明 → 属 declared
      ['execution.started', 5], // 在 EventType 枚举 → 属 enumTypes
      ['context.assembly.telemetry', 2], // 既不在契约表也不在枚举 → 双轨漂移信号
    ]));
    expect(report.declared).toContain('gate.query.miss');
    expect(report.enumTypes).toContain('execution.started');
    expect(report.emitted.find((e) => e.type === 'execution.started')?.count).toBe(5);
    expect(report.unregistered.map((e) => e.type)).toContain('context.assembly.telemetry');
    expect(report.unassertedEnums).toContain('execution.started');
    expect(report.unassertedEnums).not.toContain('gate.query.miss');
  });
});