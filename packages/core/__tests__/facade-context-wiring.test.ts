/**
 * facade-context-wiring.test.ts — 功能③ Phase 1：CompanyFacade 装配聚焦上下文接线
 *
 * 验证：
 *   - 注入 contextAssemblyEngine 后，executeGoal 门禁后调用 assemble（focusMode）
 *   - focusedSummary 传入 runOpts.assembledContext（stub runtime 可观测）
 *   - 装配失败不阻断执行（非阻断）
 *   - 未注入 engine 时行为不变（零风险）
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DepartmentManager } from '../src/governance/control-plane/DepartmentManager.js';
import { RoleRegistry } from '../src/governance/control-plane/RoleRegistry.js';
import { CompanyFacade } from '../src/facade/CompanyFacade.js';
import { ControlPlane } from '../src/governance/control-plane/ControlPlane.js';

function makeFacade(runSpy: (goal: string, opts?: any) => Promise<any>) {
  const bus = new EventBus();
  const deptMgr = new DepartmentManager(bus);
  const roleReg = new RoleRegistry(bus);
  const stubRuntime = {
    run: async (goal: string, opts?: any) => runSpy(goal, opts),
  } as any;
  return new CompanyFacade(deptMgr, roleReg, stubRuntime, new ControlPlane());
}

/** mock 装配引擎：记录调用，可配置失败 */
function mockEngine(opts?: { fail?: boolean; summary?: string }) {
  const calls: Array<Record<string, unknown>> = [];
  const engine = {
    calls,
    async assemble(input: any) {
      calls.push(input);
      if (opts?.fail) throw new Error('assemble 暂不可用');
      return { focusedSummary: opts?.summary ?? `聚焦摘要: ${input.goal ?? ''}`, contextId: 'ctx_1' };
    },
  };
  return engine as any;
}

describe('CompanyFacade — 功能③ 聚焦上下文装配接线', () => {
  it('注入 engine 后：executeGoal 调用 assemble 并把 focusedSummary 传入 runOpts.assembledContext', async () => {
    let seenOpts: any = null;
    const facade = makeFacade(async (_goal, opts) => {
      seenOpts = opts;
      return { ok: true, context: { executionId: 'e1', mission: { missionId: 'm1' }, goal: { raw: _goal } }, artifacts: [], errors: [] };
    });
    const engine = mockEngine();
    facade.setContextAssemblyEngine(engine);
    await facade.createDepartment('硬件部');
    const result = await facade.executeGoal('开发设备', { departmentName: '硬件部' });

    expect(result.ok).toBe(true);
    // assemble 被调用，且携带 goal/domain 聚焦输入
    expect(engine.calls.length).toBe(1);
    expect(engine.calls[0].goal).toContain('开发设备');
    expect(engine.calls[0].domain).toBe('硬件部');
    // focusedSummary 传入 runOpts
    expect(seenOpts?.assembledContext).toContain('聚焦摘要');
  });

  it('装配失败不阻断执行（非阻断）', async () => {
    const facade = makeFacade(async (_goal) => ({ ok: true, context: { executionId: 'e1', mission: { missionId: 'm1' } }, artifacts: [], errors: [] }));
    facade.setContextAssemblyEngine(mockEngine({ fail: true }));
    await facade.createDepartment('硬件部');
    const result = await facade.executeGoal('开发设备', { departmentName: '硬件部' });
    expect(result.ok).toBe(true); // 执行照常
  });

  it('未注入 engine 时行为不变（零风险）', async () => {
    let seenOpts: any = null;
    const facade = makeFacade(async (_goal, opts) => {
      seenOpts = opts;
      return { ok: true, context: { executionId: 'e1', mission: { missionId: 'm1' } }, artifacts: [], errors: [] };
    });
    await facade.createDepartment('硬件部');
    const result = await facade.executeGoal('开发设备', { departmentName: '硬件部' });
    expect(result.ok).toBe(true);
    expect(seenOpts?.assembledContext).toBeUndefined();
  });
});
