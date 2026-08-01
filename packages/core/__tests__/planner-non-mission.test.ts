/**
 * planner-non-mission.test.ts — L3 DeliveryPlanner 非 Mission 路径接入
 *
 * 验证：CompanyFacade.executeGoal 在 auto/dag/fabric（非 mission）模式下调用规划层生成计划，
 * 且规划失败不阻断执行（增强而非硬依赖）；mission 模式跳过（由 MissionRuntime 承担）。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/common/EventBus.js';
import { DepartmentManager } from '../src/department/DepartmentManager.js';
import { RoleRegistry } from '../src/role/RoleRegistry.js';
import { CompanyFacade, type DeliveryPlannerLike } from '../src/facade/CompanyFacade.js';
import { ControlPlane } from '../src/control-plane/ControlPlane.js';

function makeFacade(planner: DeliveryPlannerLike | null): CompanyFacade {
  const bus = new EventBus();
  const deptMgr = new DepartmentManager(bus);
  const roleReg = new RoleRegistry(bus);
  const stubRuntime = {
    run: async (goal: string, _opts?: unknown) => ({
      ok: true,
      context: {
        executionId: 'exec_plan',
        goal: { raw: goal },
        mission: { missionId: 'mission_plan' },
        team: { id: 'team_plan', name: '规划团队' },
        capabilities: [] as { name?: string }[],
      },
      artifacts: [],
      errors: [],
      executionResult: { output: 'ok' },
    }),
  } as any;
  const facade = new CompanyFacade(deptMgr, roleReg, stubRuntime, new ControlPlane());
  if (planner) facade.setDeliveryPlanner(planner);
  return facade;
}

describe('CompanyFacade — L3 非 Mission 路径规划接入', () => {
  it('auto 模式：规划层介入并返回 plan.planId', async () => {
    const facade = makeFacade({
      createPlan: async (req) => {
        expect(req.goal).toContain('写爬虫');
        expect(req.mode).toBeUndefined(); // auto
        return { id: 'plan_nonmission_1', tasks: [{ id: 't1' }, { id: 't2' }], ontologyRefs: ['obj_1'] };
      },
    });
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
    expect(result.plan?.planId).toBe('plan_nonmission_1');
    expect(result.plan?.taskCount).toBe(2);
    expect(result.plan?.ontologyRefs).toEqual(['obj_1']);
  });

  it('规划失败不阻断执行（增强而非硬依赖）', async () => {
    const facade = makeFacade({
      createPlan: async () => { throw new Error('planner 暂不可用'); },
    });
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true); // 执行照常
    expect(result.plan).toBeUndefined();
  });

  it('mission 模式跳过规划（由 MissionRuntime 承担）', async () => {
    let plannerCalled = false;
    const facade = makeFacade({
      createPlan: async () => { plannerCalled = true; return { id: 'plan_x', tasks: [] }; },
    });
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部', mode: 'mission' });
    expect(result.ok).toBe(true);
    expect(plannerCalled).toBe(false);
    expect(result.plan).toBeUndefined();
  });

  it('未注入 planner 时 plan 为 undefined（不报错）', async () => {
    const facade = makeFacade(null);
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeUndefined();
  });
});
