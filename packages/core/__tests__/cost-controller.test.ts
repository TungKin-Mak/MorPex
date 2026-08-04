/**
 * ⑤ CostController 全链路计费测试
 *
 * 覆盖：
 *   1. recordTokens / getTokenUsage / getTotalCost（token 累计 + 单价折算 + 时长成本合并）
 *   2. init 监听 execution.gate.token_usage → 自动累计（global + gate:<domain> 分账）
 *   3. 预算/建议动作（既有行为回归）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostController } from '../src/governance/CostController.js';
import { EventBus } from '../src/infrastructure/common/EventBus.js';

describe('CostController — token 计费', () => {
  beforeEach(() => {
    CostController.resetInstance();
  });

  it('recordTokens 累计 + getTokenUsage 读取', () => {
    const cc = CostController.getInstance();
    cc.recordTokens('global', 1500);
    cc.recordTokens('global', 2500);
    cc.recordTokens('gate:software', 800);

    expect(cc.getTokenUsage('global').tokens).toBe(4000);
    expect(cc.getTokenUsage('gate:software').tokens).toBe(800);
    // 未配置单价 → 金额 0（只累计 token 数）
    expect(cc.getTokenUsage('global').cost).toBe(0);
  });

  it('setTokenPrice 单价折算（美元/千 token）', () => {
    const cc = CostController.getInstance();
    cc.setTokenPrice('global', 0.5); // $0.5 / 1k tokens
    cc.recordTokens('global', 3000);
    expect(cc.getTokenUsage('global').cost).toBe(1.5);
  });

  it('getTotalCost = 时长成本 + token 折算', () => {
    const cc = CostController.getInstance();
    cc.recordCost('global', 0.2); // 时长虚拟成本
    cc.setTokenPrice('global', 1);
    cc.recordTokens('global', 500);
    expect(cc.getTotalCost('global')).toBeCloseTo(0.2 + 0.5, 5);
  });

  it('负数/0 token 不累计', () => {
    const cc = CostController.getInstance();
    cc.recordTokens('global', 0);
    cc.recordTokens('global', -5);
    cc.recordTokens('global', 100);
    expect(cc.getTokenUsage('global').tokens).toBe(100);
  });

  it('init 监听 execution.gate.token_usage → global + gate:<domain> 自动分账', () => {
    const cc = CostController.getInstance();
    const bus = new EventBus();
    cc.init(bus);

    bus.emit({
      id: 'e1', type: 'execution.gate.token_usage', timestamp: Date.now(),
      executionId: 'x', source: 'gate',
      payload: { tokens: 1234, domain: 'software' },
    });
    bus.emit({
      id: 'e2', type: 'execution.gate.token_usage', timestamp: Date.now(),
      executionId: 'y', source: 'orchestrator',
      payload: { tokens: 666 },
    });

    expect(cc.getTokenUsage('global').tokens).toBe(1900);
    expect(cc.getTokenUsage('gate:software').tokens).toBe(1234);
  });

  it('预算/建议动作（既有行为回归）', () => {
    const cc = CostController.getInstance();
    cc.setBudget('global', 100);
    expect(cc.suggestAction('global')).toBe('OK');
    cc.recordCost('global', 80);
    expect(cc.suggestAction('global')).toContain('WARNING');
    cc.recordCost('global', 20);
    expect(cc.suggestAction('global')).toContain('CRITICAL');
  });
});
