/**
 * brainfacade-facade.test.ts — S20 BrainFacade 完整重包验证
 *
 * 覆盖：activateMemory（记忆激活门面）的转发、未注入时优雅降级、getStats.systems 聚合状态。
 * （planGoal/DeliveryPlanner 注入已随技术债清理 T2 删除——2026-08-03）
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { BrainFacade, type MemoryActivationEngineLike } from '../src/cognition/BrainFacade.js';

function makeBrain(): BrainFacade {
  return new BrainFacade(new EventBus());
}

describe('BrainFacade 完整重包（S20）', () => {
  it('activateMemory 转发到 MemoryActivationEngine', () => {
    const brain = makeBrain();
    const engine: MemoryActivationEngineLike = {
      activate: (ctx, topK = 5) => ({
        memories: [{ id: 'm1', content: 'Use Express for REST' }],
        contextBias: 'Found 1 relevant memory.',
        activationScore: 0.8,
      }),
    };
    brain.setMemoryActivationEngine(engine);
    const r = brain.activateMemory({ goal: 'Build API', executionStatus: 'running' }, 3);
    expect(r.memories).toHaveLength(1);
    expect(r.activationScore).toBe(0.8);
  });

  it('未注入激活引擎 → 返回空结果（优雅降级）', () => {
    const brain = makeBrain();
    const r = brain.activateMemory({ goal: 'x' });
    expect(r.memories).toEqual([]);
    expect(r.activationScore).toBe(0);
  });

  it('getStats.systems 反映聚合状态', () => {
    const brain = makeBrain();
    brain.setMemoryActivationEngine({ activate: () => ({ memories: [], contextBias: '', activationScore: 0 }) });
    const stats = brain.getStats();
    expect(stats.systems.memoryActivation).toBe(true);
    expect(stats.systems).not.toHaveProperty('deliveryPlanner'); // 已随 T2 清理移除
    expect(stats.systems.personalBrain).toBe(false);
  });
});
