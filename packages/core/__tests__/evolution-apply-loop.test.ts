/**
 * 进化提案落地通道测试（会话 16e · 3-3 半自动应用闭环）
 *
 * 覆盖：
 *   1. PromptStrategyRegistry：版本化 setHint / 回滚 removeHint / all()
 *   2. EvolutionApplyLoop：evolution.experience.mined 事件 → 提案 → 沙箱 → （有 Gate 凭证）半自动应用
 *   3. 无 Gate 凭证提供者 → 提案停留 pending_approval（人工审批通道）
 *   4. 闭环：应用策略 → 注册表 hint 生效（装配可读）→ 可回滚
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { PromptStrategyRegistry } from '../src/evolution/PromptStrategyRegistry.js';
import { EvolutionApplyLoop } from '../src/evolution/EvolutionApplyLoop.js';
import { EvolutionSandbox } from '../src/evolution/EvolutionSandbox.js';
import type { KnowledgeContextPackage } from '../src/gate/context.js';

function validGateContext(): KnowledgeContextPackage {
  return {
    executionId: 'exec_evo',
    riskTier: 'tier-1',
    queryCallCount: 2,
    retrievedIds: ['obj_1'],
    referenceCheck: { valid: true, missing: [], knownCount: 1 },
    issuedAt: Date.now(),
  };
}

/** 构造一个 learning event 事件（与 ExperienceMiner 发射同构） */
function mineEvent(types: string[]): unknown {
  return {
    type: 'evolution.experience.mined',
    payload: { goal: '生成报告', result: 'failure', events: types.map(t => ({ type: t, capability: 'Backend Development', detail: 'x' })) },
  };
}

describe('PromptStrategyRegistry — 版本化策略库', () => {
  it('setHint 递增版本 + getHint 读取', () => {
    const reg = new PromptStrategyRegistry();
    expect(reg.getHint('empty-param')).toBeNull();
    reg.setHint('empty-param', '提示 A');
    reg.setHint('empty-param', '提示 B');
    expect(reg.getHint('empty-param')).toBe('提示 B');
    expect(reg.all()[0].version).toBe(2);
  });

  it('removeHint 回滚返回旧值', () => {
    const reg = new PromptStrategyRegistry();
    const set = reg.setHint('safety-block', '提示 X');
    expect(set.old).toBeNull();
    const removed = reg.removeHint('safety-block');
    expect(removed).toBe('提示 X');
    expect(reg.count()).toBe(0);
  });
});

describe('EvolutionApplyLoop — 半自动应用闭环', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('有 Gate 凭证提供者 → 学习事件 → 提案 → 沙箱 → 应用 → 策略入库', async () => {
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, {
      gateContextProvider: async () => validGateContext(),
      sandboxCheck: async () => true,
      cooldownMs: 0, // 测试关闭防抖
    });
    loop.init(bus);

    bus.emit(mineEvent(['empty-param']) as never);

    // 事件处理是异步的——等一拍
    await new Promise(r => setTimeout(r, 50));

    expect(reg.getHint('empty-param')).toContain('工具');
    expect(loop.getAppliedCount()).toBe(1);
    const applied = sandbox.listChanges().find(c => c.status === 'applied');
    expect(applied).toBeDefined();
    expect(applied!.summary).toContain('empty-param');
  });

  it('无 Gate 凭证提供者 → 提案停留 pending_approval（人工审批通道）', async () => {
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, { cooldownMs: 0, sandboxCheck: async () => true });
    loop.init(bus);

    bus.emit(mineEvent(['safety-block']) as never);
    await new Promise(r => setTimeout(r, 50));

    expect(reg.getHint('safety-block')).toBeNull(); // 未应用
    expect(loop.listPending().length).toBe(1); // 停留 pending
  });

  it('闭环：应用 → 策略影响装配（hint 可读）→ 回滚恢复', async () => {
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, {
      gateContextProvider: async () => validGateContext(),
      cooldownMs: 0,
      sandboxCheck: async () => true,
    });
    loop.init(bus);

    bus.emit(mineEvent(['high-retry']) as never);
    await new Promise(r => setTimeout(r, 50));
    expect(reg.getHint('high-retry')).toContain('参数');

    // 回滚：EvolutionSandbox.rollback（携带 revert 动作 → 注册表 removeHint）
    const applied = sandbox.listChanges().find(c => c.status === 'applied')!;
    const rolled = await sandbox.rollback(applied.id);
    expect(rolled!.status).toBe('rolled_back');
    expect(reg.getHint('high-retry')).toBeNull(); // 回滚后策略移除
  });

  it('沙箱未过 → 提案 rejected 不应用', async () => {
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, {
      gateContextProvider: async () => validGateContext(),
      sandboxCheck: async () => false, // 沙箱校验失败
      cooldownMs: 0,
    });
    loop.init(bus);

    bus.emit(mineEvent(['empty-param']) as never);
    await new Promise(r => setTimeout(r, 50));

    expect(reg.getHint('empty-param')).toBeNull();
    expect(sandbox.listChanges().some(c => c.status === 'rejected')).toBe(true);
  });

  it('防抖：同类事件冷却期内不重复提案', async () => {
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, {
      gateContextProvider: async () => validGateContext(),
      cooldownMs: 60000, // 1 分钟冷却
      sandboxCheck: async () => true,
    });
    loop.init(bus);

    bus.emit(mineEvent(['empty-param']) as never);
    await new Promise(r => setTimeout(r, 30));
    bus.emit(mineEvent(['empty-param']) as never);
    await new Promise(r => setTimeout(r, 30));

    expect(sandbox.listChanges().filter(c => c.status === 'applied')).toHaveLength(1);
  });
});

describe('EvolutionApplyLoop — 人工审批通道（E1）', () => {
  it('无 Gate 凭证提供者 → approve 不应用（返回 undefined）；reject 生效', async () => {
    const bus = new EventBus();
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, { cooldownMs: 0, sandboxCheck: async () => true });
    loop.init(bus);
    bus.emit(mineEvent(['empty-param']) as never);
    await new Promise(r => setTimeout(r, 50));

    const pending = loop.listPending();
    expect(pending.length).toBe(1);
    // 无 gateContextProvider → approve 不应用
    const applied = await loop.approve(pending[0].id);
    expect(applied).toBeUndefined();
    // reject 生效
    const rejected = await loop.reject(pending[0].id, '人工拒绝');
    expect(rejected!.status).toBe('rejected');
    expect(loop.listPending()).toHaveLength(0);
  });

  it('approve：手动提案（绕过 loop 自动应用）→ 用 loop.approve 应用（策略入库）', async () => {
    const bus = new EventBus();
    const sandbox = new EvolutionSandbox();
    const reg = new PromptStrategyRegistry();
    const loop = new EvolutionApplyLoop(sandbox, reg, {
      gateContextProvider: async () => validGateContext(),
      cooldownMs: 0, sandboxCheck: async () => true,
    });
    // 直接经 sandbox 提案（不带 apply/revert 动作 → 仅标记 applied；此处验证 approve 通道）
    const rec = await sandbox.proposeChange({ summary: '手动策略提案' });
    expect(rec.status).toBe('pending_approval');
    const applied = await loop.approve(rec.id);
    expect(applied!.status).toBe('applied');
  });
});
