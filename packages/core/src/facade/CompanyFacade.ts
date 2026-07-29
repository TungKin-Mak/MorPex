/**
 * CompanyFacade — CEO 高层操作入口（v16 Unified）
 *
 * ═══ v16 重构 ═══
 * - Runtime 与 ControlPlane 为构造时强制参数（旧签名向后兼容）
 * - executeGoal 使用 ExecuteGoalOptions 透传 RunOptions
 * - 必经 ControlPlane.checkAll() 全量门禁
 */

import { DepartmentManager } from '../department/DepartmentManager.js';
import { RoleRegistry } from '../role/RoleRegistry.js';
import type { Department, DepartmentStats } from '../department/types.js';
import type { CreateDepartmentParams } from '../department/types.js';
import type { GoalContext } from '../contracts/goal.js';
import type { MorPexRuntime, RunOptions } from '../runtime/MorPexRuntime.js';
import type { ControlPlane } from '../control-plane/ControlPlane.js';

export interface ExecuteGoalOptions {
  simulationHardFail?: boolean;
  ontologyHardFail?: boolean;
  awaitApproval?: boolean;
  approvalTimeoutMs?: number;
  departmentName?: string;
  departmentId?: string;
  createIfMissing?: boolean;
  mode?: 'auto' | 'mission' | 'dag' | 'fabric';
  [key: string]: unknown;
}

export class CompanyFacade {
  private departmentManager: DepartmentManager;
  private roleRegistry: RoleRegistry;
  private runtime!: MorPexRuntime;
  private controlPlane!: ControlPlane;
  private ceoId: string;
  private _bootstrapped = false;

  constructor(
    departmentManager: DepartmentManager,
    roleRegistry: RoleRegistry,
    runtimeOrCeoId: MorPexRuntime | string,
    controlPlane?: ControlPlane,
    ceoId: string = 'ceo-default',
  ) {
    if (!departmentManager) throw new Error('[CompanyFacade] DepartmentManager 是必填参数');
    if (!roleRegistry) throw new Error('[CompanyFacade] RoleRegistry 是必填参数');
    this.departmentManager = departmentManager;
    this.roleRegistry = roleRegistry;

    if (typeof runtimeOrCeoId === 'object' && runtimeOrCeoId !== null) {
      this.runtime = runtimeOrCeoId as MorPexRuntime;
      if (!controlPlane) throw new Error('[CompanyFacade] ControlPlane 是必填参数');
      this.controlPlane = controlPlane;
      this.ceoId = ceoId;
    } else {
      console.warn('[CompanyFacade] ⚠️ 使用旧构造签名（3参数），建议改为新签名（5参数）');
      this.ceoId = (runtimeOrCeoId as string) || ceoId;
    }
  }

  private async ensureBootstrapped(): Promise<void> {
    if (this._bootstrapped) return;
    this._bootstrapped = true;
    if (!this.runtime) {
      const { ServiceContainer } = await import('../runtime/ServiceContainer.js');
      const c = new ServiceContainer();
      this.runtime = c.runtime;
      this.controlPlane = c.controlPlane;
    }
  }

  async createDepartment(name: string, options?: { type?: 'template' | 'project'; templateName?: string; description?: string }): Promise<Department> {
    const params: CreateDepartmentParams = { name, type: options?.type ?? 'template', templateName: options?.templateName, description: options?.description, ceoId: this.ceoId };
    const dept = await this.departmentManager.createDepartment(params);
    this.roleRegistry.defineRole({ name: 'ceo', departmentId: dept.id, agentId: this.ceoId, capabilities: ['manage', 'oversee', 'assign'], permissions: ['read', 'write', 'admin'] });
    console.log(`[CompanyFacade] ✅ 部门 "${dept.name}" 已创建（ID: ${dept.id}）`);
    return dept;
  }

  async sendTask(departmentName: string, task: string): Promise<{ ok: boolean; message: string; departmentId?: string }> {
    await this.ensureBootstrapped();
    const dept = this.departmentManager.findByName(departmentName);
    if (!dept) return { ok: false, message: `部门 "${departmentName}" 不存在` };
    if (dept.status !== 'active') return { ok: false, message: `部门 "${dept.name}" 状态为 "${dept.status}"`, departmentId: dept.id };
    const result = await this.runtime.run(task, { departmentId: dept.id });
    return { ok: result.ok, message: result.ok ? `✅ 任务完成` : `❌ 失败: ${result.errors.join('; ')}`, departmentId: dept.id };
  }

  getDepartmentStatus(departmentName: string): Department | undefined { return this.departmentManager.findByName(departmentName); }
  listDepartments(): Department[] { return this.departmentManager.listDepartments('active'); }
  getStats(): { departments: DepartmentStats } { return { departments: this.departmentManager.getStats() }; }

  async executeGoal(goal: string, options: ExecuteGoalOptions = {}): Promise<{
    ok: boolean; goalContext?: GoalContext; executionId?: string; result?: unknown;
    report: string; error?: string; missionId?: string; teamId?: string;
  }> {
    await this.ensureBootstrapped();
    console.log(`[CompanyFacade] 🎯 executeGoal: ${goal.substring(0, 80)}`);
    const startTime = Date.now();

    const gate = await this.controlPlane.checkAll(goal);
    if (!gate.approved) {
      return { ok: false, report: `❌ ControlPlane 拒绝: ${gate.rejection || '无原因'}`, error: gate.rejection };
    }
    console.log(`  ├─ ControlPlane: 通过 (goal=${gate.goal.approved}, policy=${gate.policy?.allowed ?? true}, resource=${gate.resource?.available ?? true})`);

    const deptId = options.departmentName ? this.departmentManager.findByName(options.departmentName)?.id : undefined;
    const runOpts: RunOptions = {
      simulationHardFail: options.simulationHardFail ?? true,
      ontologyHardFail: options.ontologyHardFail ?? false,
      awaitApproval: options.awaitApproval ?? false,
      approvalTimeoutMs: options.approvalTimeoutMs,
      departmentId: options.departmentId ?? deptId,
    };

    try {
      const result = await this.runtime.run(goal, runOpts);
      const duration = Date.now() - startTime;
      const lines = [
        '='.repeat(50),
        `📋 CEO 执行报告 | ${new Date().toLocaleTimeString('zh-CN')}`,
        '='.repeat(50),
        `🎯 目标: ${goal.substring(0, 120)}`,
        `📋 Mission: ${result.context?.mission?.missionId || 'N/A'}`,
        `👥 团队: ${result.context?.team?.name || 'N/A'}`,
        `📦 产物: ${result.artifacts?.length || 0} 个`,
        `⏱ 耗时: ${duration}ms`,
        `📊 结果: ${result.ok ? '✅ 成功' : '❌ 失败'}`,
      ];
      if (result.errors.length > 0) {
        lines.push('❌ 错误:');
        result.errors.forEach(e => lines.push(`   • ${e}`));
      }
      lines.push('='.repeat(50));
      return { ok: result.ok, goalContext: result.context?.goal, executionId: result.context?.executionId, result: result.executionResult, report: lines.join('\n'), error: result.errors[0], missionId: result.context?.mission?.missionId, teamId: result.context?.team?.id };
    } catch (err) {
      return { ok: false, report: `❌ Runtime 执行失败: ${(err as Error).message}`, error: (err as Error).message };
    }
  }

  async generateDailyReport(): Promise<string> {
    const now = new Date();
    const lines = ['='.repeat(50), `📊 CEO 每日运营报告 | ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`, '='.repeat(50)];
    const departments = this.departmentManager.listDepartments();
    lines.push(`\n📁 部门概览: ${departments.length} 个`);
    for (const dept of departments) lines.push(`  ${dept.status === 'active' ? '✅' : '⏸️'} ${dept.name} (${dept.type})`);
    lines.push('\n' + '='.repeat(50));
    return lines.join('\n');
  }

  async searchAcrossDepartments(_query: string, _options?: { limit?: number; departmentFilter?: string[] }): Promise<Array<{ content: string; departmentName?: string; relevance: number }>> { return []; }

  /** @deprecated 仅旧 bootstrap 使用 */
  setRuntime(r: MorPexRuntime): void { this.runtime = r; }
  /** @deprecated 仅旧 bootstrap 使用 */
  setControlPlane(cp: ControlPlane): void { this.controlPlane = cp; }
  /** @deprecated 仅旧 bootstrap 使用 */
  setBrainFacade(_: any): void {}
  /** @deprecated 仅旧 bootstrap 使用 */
  setGoalIntelligenceFacade(_: any): void {}
  /** @deprecated 仅旧 bootstrap 使用 */
  setFeedbackService(_: any): void {}
  /** @deprecated 仅旧 bootstrap 使用 */
  setOntology(_o: any, _g: any, _p: any): void {}
  setCEO(id: string): void { this.ceoId = id; }
}
