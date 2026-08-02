/**
 * planner-non-mission.test.ts — 规划统一收敛（用户主导：mode 移除 + 前置规划清理后）
 *
 * 验证：CompanyFacade.executeGoal 无任何前置 DeliveryPlanner 依赖（T4/T6 已删死注入），
 * 规划统一由 MissionRuntime 生命周期内部承担；executeGoal 返回 plan=undefined。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DepartmentManager } from '../src/governance/control-plane/DepartmentManager.js';
import { RoleRegistry } from '../src/governance/control-plane/RoleRegistry.js';
import { CompanyFacade } from '../src/facade/CompanyFacade.js';
import { ControlPlane } from '../src/governance/control-plane/ControlPlane.js';

function makeFacade(): CompanyFacade {
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
  return new CompanyFacade(deptMgr, roleReg, stubRuntime, new ControlPlane());
}

describe('CompanyFacade — 规划统一收敛（前置规划已移除）', () => {
  it('executeGoal 无前置 DeliveryPlanner 依赖（规划由 MissionRuntime 承担）', async () => {
    const facade = makeFacade();
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeUndefined(); // 规划结果由 MissionRuntime 内部管理
  });

  it('未注入任何规划器时 plan 为 undefined（不报错）', async () => {
    const facade = makeFacade();
    await facade.createDepartment('编程部');
    const result = await facade.executeGoal('写爬虫', { departmentName: '编程部' });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeUndefined();
  });
});
