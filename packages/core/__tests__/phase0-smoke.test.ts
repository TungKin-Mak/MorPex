/**
 * Phase 0: 组织层冒烟测试
 *
 * 验证 DepartmentManager + RoleRegistry + CompanyFacade
 * 能正常创建、查询、执行基本操作。
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/infrastructure/common/EventBus.js';
import { DepartmentManager } from '../src/governance/control-plane/DepartmentManager.js';
import { DepartmentContext } from '../src/governance/control-plane/DepartmentContext.js';
import { RoleRegistry } from '../src/governance/control-plane/RoleRegistry.js';
import { CompanyFacade } from '../src/facade/CompanyFacade.js';
import { ControlPlane } from '../src/governance/control-plane/ControlPlane.js';

function setup() {
  const bus = new EventBus();
  const deptMgr = new DepartmentManager(bus);
  const roleReg = new RoleRegistry(bus);
  // stub runtime：冒烟测试只验证「任务路由到部门」，不执行完整生产管线（避免 LLM/ontologie 超时）
  // executeGoal 仅消费 run() 的 RunResult 形状；路由断言由 executeGoal 的部门校验 + runOpts.departmentId 保证
  const stubRuntime = {
    run: async (goal: string) => ({
      ok: true,
      context: {
        executionId: 'exec_smoke',
        goal: { raw: goal },
        mission: { missionId: 'mission_smoke' },
        team: { id: 'team_smoke', name: '冒烟团队' },
        capabilities: [] as { name?: string }[],
      },
      artifacts: [],
      errors: [],
      executionResult: { output: 'ok' },
    }),
  } as any;
  // 真实 ControlPlane（execute_goal/MEDIUM 已策略化自动批准，见 S20 修复）
  const facade = new CompanyFacade(deptMgr, roleReg, stubRuntime, new ControlPlane());
  return { bus, deptMgr, roleReg, facade };
}

describe('Phase 0: 组织层', () => {
  describe('DepartmentManager', () => {
    it('应能创建模板部门', async () => {
      const { deptMgr } = setup();
      const dept = await deptMgr.createDepartment({
        name: '编程部',
        type: 'template',
        templateName: 'programming',
        ceoId: 'ceo-1',
      });
      expect(dept.name).toBe('编程部');
      expect(dept.type).toBe('template');
      expect(dept.templateName).toBe('programming');
      expect(dept.status).toBe('active');
      expect(dept.id).toMatch(/^dept_/);
    });

    it('应能创建项目部门', async () => {
      const { deptMgr } = setup();
      const dept = await deptMgr.createDepartment({
        name: '项目Alpha',
        type: 'project',
        description: 'A项目专用部门',
        ceoId: 'ceo-1',
      });
      expect(dept.name).toBe('项目Alpha');
      expect(dept.type).toBe('project');
      expect(dept.description).toBe('A项目专用部门');
    });

    it('应按名称查找部门', async () => {
      const { deptMgr } = setup();
      await deptMgr.createDepartment({ name: '电商部', type: 'template', ceoId: 'ceo-1' });
      const found = deptMgr.findByName('电商部');
      expect(found).toBeDefined();
      expect(found!.name).toBe('电商部');
    });

    it('应能列出所有部门', async () => {
      const { deptMgr } = setup();
      await deptMgr.createDepartment({ name: '电商部', type: 'template', ceoId: 'ceo-1' });
      await deptMgr.createDepartment({ name: '视频部', type: 'template', ceoId: 'ceo-1' });
      expect(deptMgr.listDepartments()).toHaveLength(2);
    });

    it('应能更新部门状态', async () => {
      const { deptMgr } = setup();
      const dept = await deptMgr.createDepartment({ name: '测试部', type: 'project', ceoId: 'ceo-1' });
      await deptMgr.updateDepartment(dept.id, { status: 'inactive' });
      const updated = deptMgr.getDepartment(dept.id);
      expect(updated!.status).toBe('inactive');
    });

    it('应能删除部门', async () => {
      const { deptMgr } = setup();
      const dept = await deptMgr.createDepartment({ name: '临时部', type: 'project', ceoId: 'ceo-1' });
      const deleted = await deptMgr.deleteDepartment(dept.id);
      expect(deleted).toBe(true);
      expect(deptMgr.getDepartment(dept.id)).toBeUndefined();
    });

    it('应能通过 updateDepartment 设置 Lead Agent', async () => {
      const { deptMgr } = setup();
      const dept = await deptMgr.createDepartment({ name: '研发部', type: 'template', ceoId: 'ceo-1' });
      await deptMgr.updateDepartment(dept.id, { leadAgentId: 'agent-lead-1' });
      expect(deptMgr.getDepartment(dept.id)!.leadAgentId).toBe('agent-lead-1');
    });

    it('应返回正确统计', async () => {
      const { deptMgr } = setup();
      await deptMgr.createDepartment({ name: '电商部', type: 'template', ceoId: 'ceo-1' });
      await deptMgr.createDepartment({ name: '视频部', type: 'template', ceoId: 'ceo-1' });
      await deptMgr.createDepartment({ name: '项目X', type: 'project', ceoId: 'ceo-1' });
      const stats = deptMgr.getStats();
      expect(stats.totalDepartments).toBe(3);
      expect(stats.activeDepartments).toBe(3);
      expect(stats.byType.template).toBe(2);
      expect(stats.byType.project).toBe(1);
    });
  });

  describe('DepartmentContext', () => {
    it('应生成正确 partition key', () => {
      expect(DepartmentContext.partitionKey('dept_123')).toBe('dept:dept_123');
      expect(DepartmentContext.partitionKey()).toBe('global');
      expect(DepartmentContext.isGlobal()).toBe(true);
      expect(DepartmentContext.isGlobal('dept_123')).toBe(false);
    });

    it('应正确处理 legacy 数据', () => {
      const key = DepartmentContext.compositeKey('artifact_001');
      expect(key).toBe('artifact_001'); // legacy 不加前缀
      const deptKey = DepartmentContext.compositeKey('artifact_001', 'dept_123');
      expect(deptKey).toBe('dept_123:artifact_001');
    });
  });

  describe('RoleRegistry', () => {
    it('应能定义角色', () => {
      const { roleReg } = setup();
      const role = roleReg.defineRole({
        name: 'lead_agent',
        departmentId: 'dept_123',
        capabilities: ['code', 'review'],
        permissions: ['read', 'write'],
      });
      expect(role.name).toBe('lead_agent');
      expect(role.id).toMatch(/^role_/);
    });

    it('应能分配和查询角色', () => {
      const { roleReg } = setup();
      const role = roleReg.defineRole({
        name: 'worker', departmentId: 'dept_123',
        capabilities: ['code'], permissions: ['read', 'write'],
      });
      roleReg.assignRole('agent-1', role.id, 'dept_123', 'ceo-1');
      const assignment = roleReg.getAssignment('agent-1', 'dept_123');
      expect(assignment).toBeDefined();
      expect(assignment!.roleId).toBe(role.id);
    });
  });

  describe('CompanyFacade', () => {
    it('应通过 Facade 创建部门', async () => {
      const { facade } = setup();
      const dept = await facade.createDepartment('电商部', { type: 'template', templateName: 'ecommerce' });
      expect(dept).toBeDefined();
      expect(dept.name).toBe('电商部');
      expect(dept.id).toMatch(/^dept_/);
    });

    it('应路由任务到部门', async () => {
      const { facade } = setup();
      await facade.createDepartment('编程部');
      const result = await facade.sendTask('编程部', '写爬虫');
      expect(result.ok).toBe(true);
      expect(result.message).toContain('编程部');
    });

    it('应拒绝空任务', async () => {
      const { facade } = setup();
      const result = await facade.sendTask('编程部', '  ');
      expect(result.ok).toBe(false);
    });

    it('应拒绝不存在的部门', async () => {
      const { facade } = setup();
      // 任务串需含明确任务动词（裸名词会被意图分流判为闲聊直答，绕过部门校验——校准后已知行为）
      const result = await facade.sendTask('不存在的部', '写一份任务进度报告');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('不存在');
    });
  });
});
