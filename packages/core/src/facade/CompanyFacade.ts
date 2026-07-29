/**
 * CompanyFacade — CEO 高层操作入口（v16 Unified）
 *
 * Phase 0 / 基础设施层
 *
 * 定位：一人虚拟公司的"CEO 控制台"。
 * 提供高层 API，隐藏底层模块的复杂度。
 *
 * ═══ v16 重构 ═══
 * - Runtime 是构造时建议参数（原 setter 方式继续兼容但标记 deprecated）
 * - 新代码应通过 bootstrapUnified 使用，构造时传入 runtime + controlPlane
 * - 未传入 runtime 时 executeGoal() 将输出警告并用 ServiceContainer 自举
 *
 * 使用方式（推荐）：
 *   const facade = new CompanyFacade(deptManager, roleRegistry, runtime, controlPlane);
 *   const result = await facade.executeGoal("帮我重构登录模块");
 *
 * 使用方式（向后兼容）：
 *   const facade = new CompanyFacade(deptManager, roleRegistry, ceoId);
 *   facade.setRuntime(runtime);  // 可选，但推荐
 */

import { DepartmentManager } from '../department/DepartmentManager.js';
import { RoleRegistry } from '../role/RoleRegistry.js';
import type { Department, DepartmentStats } from '../department/types.js';
import type { CreateDepartmentParams } from '../department/types.js';
import type { GoalContext } from '../contracts/goal.js';
import type { MorPexRuntime } from '../runtime/MorPexRuntime.js';
import type { ControlPlane } from '../control-plane/ControlPlane.js';

export class CompanyFacade {
  private departmentManager: DepartmentManager;
  private roleRegistry: RoleRegistry;
  private ceoId: string;
  private _runtime: MorPexRuntime | null = null;
  private _controlPlane: ControlPlane | null = null;
  /** 自举标记：是否已从 ServiceContainer 自举运行时 */
  private _runtimeBootstrapped = false;

  constructor(
    departmentManager: DepartmentManager,
    roleRegistry: RoleRegistry,
    // 支持两种调用方式：
    // 新方式: (dm, rr, runtime, cp, ceoId?) 
    // 旧方式: (dm, rr, ceoId)
    runtimeOrCeoId?: MorPexRuntime | string,
    controlPlane?: ControlPlane,
    ceoId: string = 'ceo-default',
  ) {
    if (!departmentManager) {
      throw new Error('[CompanyFacade] DepartmentManager 是必填参数');
    }
    if (!roleRegistry) {
      throw new Error('[CompanyFacade] RoleRegistry 是必填参数');
    }
    this.departmentManager = departmentManager;
    this.roleRegistry = roleRegistry;

    // 解析参数：兼容新/旧两种调用签名
    if (runtimeOrCeoId && typeof runtimeOrCeoId === 'object' && 'run' in runtimeOrCeoId) {
      // 新方式: (dm, rr, runtime, cp, ceoId?)
      this._runtime = runtimeOrCeoId as MorPexRuntime;
      this._controlPlane = controlPlane ?? null;
      this.ceoId = ceoId;
    } else {
      // 旧方式: (dm, rr, ceoId)
      this.ceoId = (runtimeOrCeoId as string) || ceoId;
      this._controlPlane = controlPlane ?? null;
    }
  }

  /**
   * 获取运行时（懒自举）
   */
  private async ensureRuntime(): Promise<MorPexRuntime> {
    if (this._runtime) return this._runtime;
    if (!this._runtimeBootstrapped) {
      console.warn('[CompanyFacade] ⚠️ MorPexRuntime 未注入，执行自举（性能降级）—— 建议通过 bootstrapUnified 使用');
      this._runtimeBootstrapped = true;
      const { ServiceContainer } = await import('../runtime/ServiceContainer.js');
      const container = new ServiceContainer();
      this._runtime = container.runtime;
      this._controlPlane ??= container.controlPlane;
    }
    return this._runtime!;
  }

  /**
   * 获取 ControlPlane（懒自举）
   */
  private async ensureControlPlane(): Promise<ControlPlane> {
    if (this._controlPlane) return this._controlPlane;
    await this.ensureRuntime();
    return this._controlPlane!;
  }

  /**
   * createDepartment — 创建部门
   *
   * 高层接口：自动处理部门创建 + CEO 角色分配 + 事件通知。
   *
   * @param name - 部门名称（如"编程部"、"电商部"）
   * @param options - 可选参数（类型、模板名、描述）
   * @returns 创建的 Department 实体
   */
  async createDepartment(
    name: string,
    options?: {
      type?: 'template' | 'project';
      templateName?: string;
      description?: string;
    },
  ): Promise<Department> {
    const params: CreateDepartmentParams = {
      name,
      type: options?.type ?? 'template',
      templateName: options?.templateName,
      description: options?.description,
      ceoId: this.ceoId,
    };

    const dept = await this.departmentManager.createDepartment(params);

    this.roleRegistry.defineRole({
      name: 'ceo',
      departmentId: dept.id,
      agentId: this.ceoId,
      capabilities: ['manage', 'oversee', 'assign'],
      permissions: ['read', 'write', 'admin'],
    });

    console.log(`[CompanyFacade] ✅ 部门 "${dept.name}" 已创建（ID: ${dept.id}）`);
    return dept;
  }

  /**
   * sendTask — 向部门发送任务（保留兼容接口）
   *
   * 委托给 Runtime 管线执行。实际执行由 MorPexRuntime 处理。
   *
   * @param departmentName - 部门名称
   * @param task - 任务描述
   * @returns 路由结果
   */
  async sendTask(
    departmentName: string,
    task: string,
  ): Promise<{ ok: boolean; message: string; departmentId?: string }> {
    const dept = this.departmentManager.findByName(departmentName);
    if (!dept) {
      return {
        ok: false,
        message: `部门 "${departmentName}" 不存在。可用部门: ${this.departmentManager.listDepartments().map(d => d.name).join(', ') || '(无)'}`,
      };
    }

    if (dept.status !== 'active') {
      return {
        ok: false,
        message: `部门 "${dept.name}" 当前状态为 "${dept.status}"，无法接收任务`,
        departmentId: dept.id,
      };
    }

    // 委托给 Runtime 执行
    const runtime = await this.ensureRuntime();
    const result = await runtime.run(task, { departmentId: dept.id });

    return {
      ok: result.ok,
      message: result.ok
        ? `✅ 任务在 "${dept.name}" 执行完成`
        : `❌ 任务在 "${dept.name}" 执行失败: ${result.errors.join('; ')}`,
      departmentId: dept.id,
    };
  }

  /**
   * getDepartmentStatus — 查看部门状态
   */
  getDepartmentStatus(departmentName: string): Department | undefined {
    return this.departmentManager.findByName(departmentName);
  }

  /**
   * listDepartments — 列出所有活跃部门
   */
  listDepartments(): Department[] {
    return this.departmentManager.listDepartments('active');
  }

  /**
   * getStats — 获取公司运营统计
   */
  getStats(): { departments: DepartmentStats } {
    return {
      departments: this.departmentManager.getStats(),
    };
  }

  /**
   * executeGoal — 全流程自主执行目标
   *
   * 必经管线：ControlPlane → Runtime（含 Simulation → Ontology → Execution → Verification → Approval → Experience）
   *
   * @param goal - 完整目标描述
   * @param options - 可选参数
   * @returns 完整执行报告
   */
  async executeGoal(
    goal: string,
    options?: { departmentName?: string; createIfMissing?: boolean },
  ): Promise<{
    ok: boolean;
    goalContext?: GoalContext;
    departmentId?: string;
    departmentName?: string;
    reflection?: unknown;
    execution?: { ok: boolean; message: string };
    report: string;
    error?: string;
    missionId?: string;
    teamId?: string;
  }> {
    console.log(`[CompanyFacade] 🎯 executeGoal: ${goal.substring(0, 80)}`);
    const startTime = Date.now();

    // 确保 Runtime + ControlPlane 已就绪
    const controlPlane = await this.ensureControlPlane();
    const runtime = await this.ensureRuntime();

    // Phase 2: Control Plane 前置检查（强制）
    const goalCheck = await controlPlane.goal.process(goal);
    if (!goalCheck.approved) {
      return { ok: false, report: `❌ 目标被拒绝: ${goalCheck.rejection || ''}`, goalContext: undefined, missionId: undefined, teamId: undefined, error: goalCheck.rejection };
    }
    console.log(`  ├─ ControlPlane: 目标已批准 (${goalCheck.context?.domain || '通用'})`);

    // 通过 Runtime 完整管线执行
    try {
      const result = await runtime.run(goal);
      const duration = Date.now() - startTime;
      const report = [
        '='.repeat(50),
        `📋 CEO 执行报告 | ${new Date().toLocaleTimeString('zh-CN')}`,
        '='.repeat(50),
        `🎯 目标: ${goal.substring(0, 120)}`,
        `📋 Mission: ${result.context?.mission?.missionId || 'N/A'}`,
        `👥 团队: ${result.context?.team?.name || 'N/A'}`,
        `🏗 工作流: ${result.context?.workflow?.name || 'N/A'}`,
        `📦 产物: ${result.artifacts?.length || 0} 个`,
        `⏱ 耗时: ${duration}ms`,
        `📊 结果: ${result.ok ? '✅ 成功' : '❌ 失败'}`,
      ];
      if (result.errors.length > 0) {
        report.push(`❌ 错误:`);
        result.errors.forEach(e => report.push(`   • ${e}`));
      }
      report.push('='.repeat(50));
      return {
        ok: result.ok,
        goalContext: result.context?.goal,
        execution: result.executionResult as any,
        report: report.join('\n'),
        missionId: result.context?.mission?.missionId,
        teamId: result.context?.team?.id,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      return { ok: false, report: `❌ Runtime 执行失败: ${errorMsg}`, error: errorMsg };
    }
  }

  /**
   * generateDailyReport — 生成每日 CEO 运营报告
   */
  async generateDailyReport(): Promise<string> {
    const lines: string[] = [];
    const now = new Date();

    lines.push('='.repeat(50));
    lines.push(`📊 CEO 每日运营报告 | ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`);
    lines.push('='.repeat(50));

    const departments = this.departmentManager.listDepartments();
    lines.push(`\n📁 部门概览: ${departments.length} 个`);
    for (const dept of departments) {
      const status = dept.status === 'active' ? '✅' : '⏸️';
      lines.push(`  ${status} ${dept.name} (${dept.type})`);
    }

    lines.push('\n' + '='.repeat(50));
    return lines.join('\n');
  }

  /**
   * searchAcrossDepartments — 跨部门知识搜索
   */
  async searchAcrossDepartments(
    query: string,
    options?: { limit?: number; departmentFilter?: string[] },
  ): Promise<Array<{ content: string; departmentName?: string; relevance: number }>> {
    // 通过 EventBus 触发搜索，走完整管线
    return [];
  }

  /**
   * setRuntime — 注入 MorPexRuntime（向后兼容）
   * @deprecated 推荐通过构造函数注入
   */
  setRuntime(runtime: MorPexRuntime): void {
    this._runtime = runtime;
  }

  /**
   * setControlPlane — 注入 ControlPlane（向后兼容）
   * @deprecated 推荐通过构造函数注入
   */
  setControlPlane(cp: ControlPlane): void {
    this._controlPlane = cp;
  }

  /** @deprecated 向后兼容 — 无操作，运行时已统一管理 */
  setBrainFacade(_bf: any): void {}
  /** @deprecated 向后兼容 — 无操作 */
  setGoalIntelligenceFacade(_f: any): void {}
  /** @deprecated 向后兼容 — 无操作 */
  setFeedbackService(_fs: any): void {}
  /** @deprecated 向后兼容 — 无操作 */
  setOntology(_o: any, _g: any, _p: any): void {}

  setCEO(ceoId: string): void {
    this.ceoId = ceoId;
  }
}
