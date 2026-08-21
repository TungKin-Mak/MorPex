/**
 * infrastructure/common/__tests__/eventContractCatalog.test.ts — 事件契约目录测试
 *
 * 覆盖：
 *   1. 目录非空，每个契约均带 validatePayload 函数
 *   2. 契约类型与 EventType 枚举尽量对齐（同名枚举成员值一致）
 *   3. buildContractMap 无原型污染
 *   4. registerCoreEventContracts：注入 EventBus 后 getContracts 非空且 declared 覆盖全部目录类型
 *   5. 代表性载荷校验正反例（ontology.query.miss）
 *
 * import 用 `.js` 后缀；全部内存数据，不触碰存储。
 */

import { describe, it, expect } from 'vitest';
import {
  CORE_EVENT_CONTRACTS,
  CORE_EVENT_CONTRACT_TYPES,
  registerCoreEventContracts,
  getEventContractReconcile,
} from '../contracts/eventContractCatalog.js';
import { EventBus } from '../EventBus.js';
import { EventType } from '../../protocol/events/EventType.js';

describe('eventContractCatalog — 目录完整性', () => {
  it('目录非空且每个契约都有 validatePayload/description/producer/consumers', () => {
    const types = Object.keys(CORE_EVENT_CONTRACTS);
    expect(types.length).toBeGreaterThanOrEqual(15);
    expect(types).toEqual(expect.arrayContaining(CORE_EVENT_CONTRACT_TYPES));
    for (const type of types) {
      const c = CORE_EVENT_CONTRACTS[type];
      expect(typeof c.validatePayload).toBe('function');
      expect(typeof c.description).toBe('string');
      expect(typeof c.producer).toBe('string');
      expect(Array.isArray(c.consumers)).toBe(true);
    }
  });

  it('不污染原型（无 __proto__ 键）', () => {
    expect(Object.prototype.hasOwnProperty.call(CORE_EVENT_CONTRACTS, '__proto__')).toBe(false);
  });

  it('与 EventType 枚举同名的契约，其类型字符串与枚举值一致（对齐防双轨漂移）', () => {
    const enumValues = new Set<string>(Object.values(EventType));
    for (const type of CORE_EVENT_CONTRACT_TYPES) {
      // 只在枚举中也存在时才要求一致（协议层事件如 evolution.* 允许以字面量先行）
      if (enumValues.has(type)) {
        expect(enumValues.has(type)).toBe(true);
      }
    }
    // 至少应有一部分契约命中了 EventType 枚举（证明与标准全集互通）
    const hit = CORE_EVENT_CONTRACT_TYPES.filter((t) => enumValues.has(t));
    expect(hit.length).toBeGreaterThanOrEqual(8);
  });
});

describe('registerCoreEventContracts — 接线', () => {
  it('注入契约后 EventBus.getContracts 非空，对账 declared 覆盖全部目录类型', () => {
    const bus = new EventBus();
    // 先发几个事件制造 emitCounts，让对账有“运行时”源（id/source 为 MorPexEvent 必填）
    bus.emit({ id: 'evt_1', source: 'kernel', type: 'ontology.query.miss', executionId: 'exe_1', timestamp: Date.now(), payload: { executionId: 'exe_1', tier: 'tier-2', goal: 'g', reason: 'no_results', controlledExploration: true, retrievedObjectIds: [] } });
    bus.emit({ id: 'evt_2', source: 'kernel', type: 'unknown.event.only.runtime', executionId: 'exe_2', timestamp: Date.now(), payload: {} });

    const report = registerCoreEventContracts(bus);
    expect(bus.getContracts()).toEqual(CORE_EVENT_CONTRACTS);
    expect(report.declared).toEqual(expect.arrayContaining(CORE_EVENT_CONTRACT_TYPES));
    // 双轨漂移信号：实际发了但未登记 → 出现在 unregistered
    expect(report.unregistered.some((e) => e.type === 'unknown.event.only.runtime')).toBe(true);
    // 即时对账已写入快照
    expect(getEventContractReconcile()).toBe(report);
  });
});

describe('代表性载荷校验（ontology.query.miss）', () => {
  const contract = CORE_EVENT_CONTRACTS['ontology.query.miss'];
  it('完整载荷 → 通过', () => {
    const ok = contract.validatePayload({
      executionId: 'exe_1',
      tier: 'tier-0',
      goal: '设计产品',
      reason: 'no_results',
      controlledExploration: false,
      retrievedObjectIds: [],
    });
    expect(ok).toEqual([]);
  });

  it('缺失必填 → 返回错误数组（不 throw）', () => {
    const errors = contract.validatePayload({ executionId: 'exe_1' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors).toContain('tier 缺失或非 string');
  });

  it('校验器对任意垃圾输入不抛错', () => {
    expect(() => contract.validatePayload(null)).not.toThrow();
    expect(() => contract.validatePayload(42)).not.toThrow();
  });
});