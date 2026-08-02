/**
 * planner-non-mission.test.ts — 规划统一收敛（用户主导：mode 移除后规划由 MissionRuntime 统一承担）
 *
 * 验证：CompanyFacade.executeGoal 不再做前置 DeliveryPlanner 规划（前置规划已移除），
 * 规划统一由 MissionRuntime 生命周期内部承担（MissionRuntime.createPlan）；executeGoal 返回 plan=undefined。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DepartmentManager } from '../src/governance/control-plane/DepartmentManager.js';
import { RoleRegistry } from '../src/governance/control-plane/RoleRegistry.js';
import { CompanyFacade, type DeliveryPlannerLike } from '../src/facade/CompanyFacade.js';
import { ControlPlane } from '../src/governance/control-plane/ControlPlane.js';

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

describe('CompanyFacade — 规划统一收敛（前置规划已移除）', () => {
  it('executeGoal 不再调用 DeliveryPlanner（规划统一由 MissionRuntime 承担）', async () => {
    let plannerCalled = false;
    const facade = makeFacade({
      createPlan: async () => { plannerCalled = true; return { id: 'plan_x', tasks: [] }; },
    });
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
    expect(plannerCalled).toBe(false); // 前置规划已移除
    expect(result.plan).toBeUndefined(); // 规划结果由 MissionRuntime 内部管理
  });

  it('规划失败不阻断执行（规划由 Mission 生命周期内部承担，Facade 无规划依赖）', async () => {
    const facade = makeFacade({
      createPlan: async () => { throw new Error('planner 暂不可用'); },
    });
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
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
