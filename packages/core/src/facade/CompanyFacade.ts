/**
 * CompanyFacade — CEO 高层操作入口（v16 Unified）
 *
 * ═══ 硬管道 ═══
 * - Runtime 与 ControlPlane 构造时强制（NODE_ENV=production 旧签名抛错）
 * - executeGoal: ControlPlane.checkAll() + RunOptions 透传
 * - sendTask: 委托 executeGoal（不跳过门禁）
 */

import { DepartmentManager } from '../governance/control-plane/DepartmentManager.js';
import { RoleRegistry } from '../governance/control-plane/RoleRegistry.js';
import type { Department, DepartmentStats } from '../governance/control-plane/department-types.js';
import type { CreateDepartmentParams } from '../governance/control-plane/department-types.js';
import type { GoalContext } from '../infrastructure/protocol/contracts/goal.js';
import type { MorPexRuntime, RunOptions } from '../execution/runtime/MorPexRuntime.js';
import type { ControlPlane } from '../governance/control-plane/ControlPlane.js';

export interface ExecuteGoalOptions {
  simulationHardFail?: boolean;
  ontologyHardFail?: boolean;
  awaitApproval?: boolean;
  approvalTimeoutMs?: number;
  departmentName?: string;
  departmentId?: string;
  createIfMissing?: boolean;
  mode?: 'auto' | 'mission' | 'dag' | 'fabric';
  /** 预估成本（用于资源检查） */
  estimatedCost?: number;
  [key: string]: unknown;
}

/**
 * DeliveryPlannerLike — 非 Mission 路径接入的规划层弱耦合接口（L3 更广接入）
 *
 * 仅消费 DeliveryPlanner.createPlan 的最小形状，避免 CompanyFacade 强依赖 planner 包。
 */
export interface DeliveryPlannerLike {
  createPlan(req: {
    goal: string;
    mode?: string;
    departmentId?: string;
    context?: Record<string, unknown>;
  }): Promise<{ id: string; tasks?: unknown[]; ontologyRefs?: string[] }>;
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
      // 新签名 — 强制
      this.runtime = runtimeOrCeoId as MorPexRuntime;
      if (!controlPlane) throw new Error('[CompanyFacade] ControlPlane 是必填参数');
      this.controlPlane = controlPlane;
      this.ceoId = ceoId;
    } else {
      // 旧签名 — 生产环境抛错，开发环境警告 + 懒自举
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[CompanyFacade] 生产环境禁止旧 3 参数构造签名。请使用 bootstrapUnified()');
      }
      console.warn('[CompanyFacade] ⚠️ 使用旧 3 参数构造签名（仅开发/测试允许），建议改为新 5 参数签名');
      this.ceoId = (runtimeOrCeoId as string) || ceoId;
    }
  }

  /**
   * ensureBootstrapped — 惰性自举（仅旧构造签名需要）
   * 注意：不 await container.ready 会导致 EventStore 竞态
   */
  private async ensureBootstrapped(): Promise<void> {
    if (this._bootstrapped) return;
    this._bootstrapped = true;
    if (!this.runtime) {
      const { ServiceContainer } = await import('../execution/runtime/ServiceContainer.js');
      const c = new ServiceContainer();
      await c.ready; // ⬅️ 关键修复：等待 EventStore 就绪
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

  private brainFacade: any = null;

  /** L3 非 Mission 路径：DeliveryPlanner（auto/dag/fabric 模式先规划再执行，失败不阻断） */
  private deliveryPlanner: DeliveryPlannerLike | null = null;

  /** 注入规划层（bootstrap 装配调用；Mission 路径走 MissionRuntime.setPlanner，此处覆盖非 Mission 路径） */
  setDeliveryPlanner(planner: DeliveryPlannerLike): void {
    this.deliveryPlanner = planner;
  }

  /**
   * sendTask — 委托 executeGoal（不跳过 ControlPlane 门禁）
   */
  async sendTask(departmentName: string, task: string): Promise<{ ok: boolean; message: string; departmentId?: string }> {
    const result = await this.executeGoal(task, { departmentName });
    return {
      ok: result.ok,
      message: result.ok ? `✅ 任务已路由到部门「${departmentName}」` : `❌ 失败: ${result.error || '未知错误'}`,
      departmentId: result.executionId ?? result.goalContext?.goalId,
    };
  }

  getDepartmentStatus(departmentName: string): Department | undefined { return this.departmentManager.findByName(departmentName); }
  listDepartments(): Department[] { return this.departmentManager.listDepartments('active'); }
  getStats(): { departments: DepartmentStats } { return { departments: this.departmentManager.getStats() }; }

  async executeGoal(goal: string, options: ExecuteGoalOptions = {}): Promise<{
    ok: boolean; goalContext?: GoalContext; executionId?: string; result?: unknown;
    report: string; error?: string; missionId?: string; teamId?: string;
    /** L3 非 Mission 路径：规划层生成的计划信息（未介入/失败时 undefined） */
    plan?: { planId?: string; taskCount?: number; ontologyRefs?: string[] };
  }> {
    await this.ensureBootstrapped();
    console.log(`[CompanyFacade] 🎯 executeGoal: ${goal.substring(0, 80)}`);
    const startTime = Date.now();

    // ── 0. 部门存在性校验（先于审批门禁：不存在则不进入审批） ──
    if (options.departmentName) {
      const dept = this.departmentManager.findByName(options.departmentName);
      if (!dept) {
        return { ok: false, report: `❌ 部门 "${options.departmentName}" 不存在`, error: `部门 "${options.departmentName}" 不存在` };
      }
    }

    // ── 1. ControlPlane 全量门禁（含 options 透传） ──
    const gate = await this.controlPlane.checkAll(goal, {
      actor: this.ceoId,
      domain: options.departmentName,
      estimatedCost: options.estimatedCost ?? 100,
    });
    if (!gate.approved) {
      return { ok: false, report: `❌ ControlPlane 拒绝: ${gate.rejection || '无原因'}`, error: gate.rejection };
    }
    console.log(`  ├─ ControlPlane: 通过 (goal=${gate.goal.approved}, policy=${gate.policy?.allowed ?? true}, resource=${gate.resource?.available ?? true})`);

    // ── 2. 构造 RunOptions（透传 mode + 所有选项） ──
    const deptId = options.departmentName ? this.departmentManager.findByName(options.departmentName)?.id : undefined;
    const runOpts: RunOptions = {
      mode: options.mode, // ⬅️ 透传用户指定的 mode
      simulationHardFail: options.simulationHardFail ?? true,
      ontologyHardFail: options.ontologyHardFail ?? false,
      awaitApproval: options.awaitApproval ?? false,
      approvalTimeoutMs: options.approvalTimeoutMs,
      departmentId: options.departmentId ?? deptId,
    };

    // ── 2.5 L3 非 Mission 路径：DeliveryPlanner 规划（增强；失败不阻断执行） ──
    // Mission 路径的规划由 MissionRuntime(DeliveryPlannerAdapter) 承担；此处覆盖 auto/dag/fabric。
    let planInfo: { planId?: string; taskCount?: number; ontologyRefs?: string[] } | undefined;
    if (this.deliveryPlanner && runOpts.mode !== 'mission') {
      try {
        const plan = await this.deliveryPlanner.createPlan({
          goal,
          mode: runOpts.mode,
          departmentId: runOpts.departmentId,
        });
        planInfo = { planId: plan.id, taskCount: plan.tasks?.length ?? 0, ontologyRefs: plan.ontologyRefs };
        (runOpts as { planId?: string }).planId = plan.id;
        console.log(`[CompanyFacade] 📋 规划层介入（${runOpts.mode ?? 'auto'}）: plan=${plan.id} tasks=${planInfo.taskCount}`);
      } catch (err) {
        console.warn(`[CompanyFacade] ⚠️ 规划层未介入（非阻断）: ${(err as Error).message}`);
      }
    }

    // ── 3. 执行 Runtime 管线 ──
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
      // L4 全功能实现：任务完成后喂给 Brain 学习闭环（持久化经验 + 提模式）
      if (this.brainFacade?.learn) {
        try {
          await this.brainFacade.learn({
            taskId: result.context?.executionId ?? `exec_${Date.now()}`,
            goal: goal,
            result: result.ok ? 'success' : 'failure',
            output: result.ok ? (result.executionResult as any)?.output ?? undefined : undefined,
            error: result.ok ? undefined : (result.errors?.[0] ?? undefined),
            duration: Date.now() - startTime,
            departmentId: runOpts.departmentId,
            capabilities: ((result.context?.capabilities as { name?: string }[] | undefined) ?? []).map((c) => c.name ?? String(c)),
          });
        } catch {
          // Brain 学习失败不阻断主流程
        }
      }
      return { ok: result.ok, goalContext: result.context?.goal, executionId: result.context?.executionId, result: result.executionResult, report: lines.join('\n'), error: result.errors[0], missionId: result.context?.mission?.missionId, teamId: result.context?.team?.id, plan: planInfo };
    } catch (err) {
      return { ok: false, report: `❌ Runtime 执行失败: ${(err as Error).message}`, error: (err as Error).message };
    }
  }

  async generateDailyReport(): Promise<string> {
    const now = new Date();
    const lines = ['='.repeat(50), `📊 每日运营报告 | ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`, '='.repeat(50)];
    for (const dept of this.departmentManager.listDepartments()) {
      lines.push(`  ${dept.status === 'active' ? '✅' : '⏸️'} ${dept.name} (${dept.type})`);
    }
    lines.push('\n' + '='.repeat(50));
    return lines.join('\n');
  }

  async searchAcrossDepartments(_q: string, _o?: { limit?: number; departmentFilter?: string[] }): Promise<Array<{ content: string; departmentName?: string; relevance: number }>> { return []; }

  /** @deprecated 仅在旧 bootstrap 兼容路径使用 — 生产环境抛错 */
  setRuntime(r: MorPexRuntime): void {
    if (process.env.NODE_ENV === 'production') throw new Error('[CompanyFacade] 生产环境禁止 setRuntime，请使用构造注入');
    this.runtime = r;
  }
  setControlPlane(cp: ControlPlane): void {
    if (process.env.NODE_ENV === 'production') throw new Error('[CompanyFacade] 生产环境禁止 setControlPlane，请使用构造注入');
    this.controlPlane = cp;
  }
  setBrainFacade(brain: any): void { this.brainFacade = brain; }
  setGoalIntelligenceFacade(_: any): void {}
  setFeedbackService(_: any): void {}
  setOntology(_o: any, _g: any, _p: any): void {}
  setCEO(id: string): void { this.ceoId = id; }
}
