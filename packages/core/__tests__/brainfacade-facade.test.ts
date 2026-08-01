/**
 * brainfacade-facade.test.ts — S20 BrainFacade 完整重包验证
 *
 * 覆盖：activateMemory（记忆激活门面）与 planGoal（规划门面）的转发、
 * 未注入时优雅降级、getStats.systems 聚合状态。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { BrainFacade, type MemoryActivationEngineLike, type DeliveryPlannerLike } from '../src/cognition/BrainFacade.js';

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

  it('planGoal 转发到 DeliveryPlanner', async () => {
    const brain = makeBrain();
    const planner: DeliveryPlannerLike = {
      createPlan: async (req) => {
        expect(req.goal).toBe('部署到 AWS');
        return { id: 'plan_brain_1', tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], ontologyRefs: ['obj_9'] };
      },
    };
    brain.setDeliveryPlanner(planner);
    const plan = await brain.planGoal('部署到 AWS', { departmentId: 'dept_1' });
    expect(plan?.planId).toBe('plan_brain_1');
    expect(plan?.taskCount).toBe(3);
    expect(plan?.ontologyRefs).toEqual(['obj_9']);
  });

  it('planGoal 失败 → null（非阻断）', async () => {
    const brain = makeBrain();
    brain.setDeliveryPlanner({ createPlan: async () => { throw new Error('planner down'); } });
    expect(await brain.planGoal('x')).toBeNull();
  });

  it('未注入 planner → planGoal 返回 null', async () => {
    const brain = makeBrain();
    expect(await brain.planGoal('x')).toBeNull();
  });

  it('getStats.systems 反映聚合状态', () => {
    const brain = makeBrain();
    brain.setMemoryActivationEngine({ activate: () => ({ memories: [], contextBias: '', activationScore: 0 }) });
    brain.setDeliveryPlanner({ createPlan: async () => ({ id: 'p', tasks: [] }) });
    const stats = brain.getStats();
    expect(stats.systems.memoryActivation).toBe(true);
    expect(stats.systems.deliveryPlanner).toBe(true);
    expect(stats.systems.personalBrain).toBe(false);
  });
});
