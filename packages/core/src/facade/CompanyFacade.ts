/**
 * CompanyFacade — CEO 高层操作入口
 *
 * Phase 0 / 基础设施层
 *
 * 定位：一人虚拟公司的"CEO 控制台"。
 * 提供高层 API，隐藏底层模块的复杂度。
 *
 * 设计原则：
 *   - Facade = 简化 + 编排，不替代
 *   - 底层仍然通过 57 个现有 API 端点执行（保持兼容）
 *   - CEO 通过 @部门名 路由任务
 *
 * 使用方式：
 *   const facade = new CompanyFacade(deptManager, roleRegistry);
 *   const dept = await facade.createDepartment('编程部');
 *   const result = await facade.sendTask('编程部', '帮我重构登录模块');
 */

import { DepartmentManager } from '../department/DepartmentManager.js';
import { RoleRegistry } from '../role/RoleRegistry.js';
import type { Department, DepartmentStats } from '../department/types.js';
import type { CreateDepartmentParams } from '../department/types.js';

export class CompanyFacade {
  private departmentManager: DepartmentManager;
  private roleRegistry: RoleRegistry;
  private ceoId: string;
  /** BrainFacade 引用（可选）用于跨部门搜索 */
  /** BrainFacade 引用（可选）用于跨部门搜索 */
  private brainFacade?: { recall: (q: string, ctx: { departmentId?: string; source: 'task_completed' | 'task_failed' | 'manual' | 'reflection' }) => Promise<Array<{ content: string; relevance: number }>> };

  constructor(
    departmentManager: DepartmentManager,
    roleRegistry: RoleRegistry,
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
    this.ceoId = ceoId;
  }

  /**
   * createDepartment — 创建部门
   *
   * 高层接口：自动处理部门创建 + CEO 角色分配 + 事件通知。
   * Phase 1 将自动创建 LeadAgent + 群聊。
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

    // 1. 创建部门
    const dept = await this.departmentManager.createDepartment(params);

    // 2. 自动注册 CEO 角色
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
   * sendTask — 向部门发送任务
   *
   * 通过 @部门名 路由任务。
   * 实际执行由 LeadAgentOrchestrator 处理（Phase 1 实现）。
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

    // Phase 1: 接入 LeadAgentOrchestrator 真实执行
    // Phase 0: 返回路由信息

    return {
      ok: true,
      message: `✅ 任务已路由到 "${dept.name}"（ID: ${dept.id}），等待 LeadAgent 调度执行`,
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
   * executeGoal — v13: 全流程自主执行目标
   *
   * 从目标到执行的一站式入口:
   *   1. 智能路由到最匹配部门或自动创建
   *   2. BrainFacade 处理（反思 + 学习）
   *   3. 路由到部门执行
   *   4. 生成 CEO 报告
   *   5. 返回完整结果
   *
   * 这是 "一人公司" 的核心入口：输入一个目标，系统自主完成全链路。
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
    departmentId?: string;
    departmentName?: string;
    reflection?: unknown;
    execution?: { ok: boolean; message: string };
    report: string;
    error?: string;
  }> {
    console.log(`[CompanyFacade] 🎯 executeGoal: ${goal.substring(0, 80)}`);
    const startTime = Date.now();

    try {
      // 1. 智能路由部门
      let dept = options?.departmentName
        ? this.departmentManager.findByName(options.departmentName)
        : this.departmentManager.listDepartments('active')[0];

      if (!dept && (options?.createIfMissing ?? true)) {
        const name = `auto_${goal.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').substring(0, 10) || 'dept'}`;
        dept = await this.createDepartment(name, { description: goal.substring(0, 100) });
        console.log(`[CompanyFacade] 🏢 自动创建部门: ${dept.name} (${dept.id})`);
      }

      if (!dept) {
        return { ok: false, report: '没有可用部门，且未自动创建', error: '无部门' };
      }

      // 2. BrainFacade 处理
      let reflection = null;
      const bf = this.brainFacade as { processTask?: (task: string, ctx: any) => Promise<any>; recall?: (q: string, ctx: any) => Promise<any[]> } | undefined;

      if (bf) {
        try {
          if (typeof bf.processTask === 'function') {
            const brainResult = await bf.processTask(goal, {
              departmentId: dept.id,
              taskId: `goal_${Date.now()}`,
            });
            reflection = brainResult.reflection;
          } else if (bf.recall && typeof bf.recall === 'function') {
            const memories = await bf.recall(goal, { departmentId: dept.id, source: 'reflection' });
            reflection = { memories: memories.slice(0, 5) };
          }
        } catch {
          // 反思失败不影响主流程
        }
      }

      // 3. 路由任务到部门
      const execution = await this.sendTask(dept.name, goal);

      // 4. 生成 CEO 报告
      const duration = Date.now() - startTime;
      const reportLines: string[] = [
        '='.repeat(50),
        `📋 CEO 执行报告 | ${new Date().toLocaleTimeString('zh-CN')}`,
        '='.repeat(50),
        `🎯 目标: ${goal.substring(0, 120)}`,
        `🏢 部门: ${dept.name} (${dept.id})`,
        `⏱ 耗时: ${duration}ms`,
      ];

      if (reflection) {
        const insights = (reflection as any).insights;
        if (insights && Array.isArray(insights) && insights.length > 0) {
          reportLines.push(`🧠 反思洞察: ${insights.length} 条`);
          for (const ins of insights.slice(0, 3)) {
            reportLines.push(`   • ${ins.message}`);
          }
        }
      }

      reportLines.push(`⚡ 执行状态: ${execution.ok ? '✅ 已路由' : '❌ ' + execution.message}`);

      if (reflection) {
        const suggestions = (reflection as any).suggestions;
        if (suggestions && Array.isArray(suggestions) && suggestions.length > 0) {
          reportLines.push('💡 建议:');
          for (const s of suggestions.slice(0, 2)) {
            reportLines.push(`   • ${s}`);
          }
        }
      }

      reportLines.push('='.repeat(50));

      return {
        ok: execution.ok,
        departmentId: dept.id,
        departmentName: dept.name,
        reflection,
        execution,
        report: reportLines.join('\n'),
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      return {
        ok: false,
        report: `❌ 执行失败: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }

  /**
   * generateDailyReport — v13: 生成每日 CEO 运营报告
   *
   * 聚合所有部门的状态、活跃度、洞察，生成可读报告。
   * 依赖 BrainFacade.generateCEOReport()（如果已注入）。
   *
   * @returns 格式化的报告字符串
   */
  async generateDailyReport(): Promise<string> {
    const lines: string[] = [];
    const now = new Date();

    lines.push('='.repeat(50));
    lines.push(`📊 CEO 每日运营报告 | ${now.toLocaleDateString('zh-CN')} ${now.toLocaleTimeString('zh-CN')}`);
    lines.push('='.repeat(50));

    // 部门概览
    const departments = this.departmentManager.listDepartments();
    lines.push(`\n📁 部门概览: ${departments.length} 个`);
    for (const dept of departments) {
      const status = dept.status === 'active' ? '✅' : '⏸️';
      lines.push(`  ${status} ${dept.name} (${dept.type})`);
    }

    // 大脑报告
    const bf = this.brainFacade as { generateCEOReport?: (dm: any) => Promise<any> } | undefined;
    if (bf && typeof bf.generateCEOReport === 'function') {
      try {
        const report = await bf.generateCEOReport(this.departmentManager);
        lines.push(`\n🧠 大脑洞察:`);
        if (report.patterns.length > 0) {
          lines.push(`  发现 ${report.patterns.length} 个模式`);
          for (const p of report.patterns.slice(0, 3)) lines.push(`    • ${p}`);
        }
        if (report.recommendations.length > 0) {
          lines.push(`  建议:`);
          for (const r of report.recommendations.slice(0, 3)) lines.push(`    • ${r}`);
        }
      } catch {
        lines.push('\n⚠️ 大脑报告暂时不可用');
      }
    }

    lines.push('\n' + '='.repeat(50));
    return lines.join('\n');
  }

  /**
   * searchAcrossDepartments — 跨部门知识搜索
   * CEO 视角的统一搜索入口
   */
  async searchAcrossDepartments(
    query: string,
    options?: { limit?: number; departmentFilter?: string[] },
  ): Promise<Array<{ content: string; departmentName?: string; relevance: number }>> {
    const results: Array<{ content: string; departmentName?: string; relevance: number }> = [];

    if (this.brainFacade) {
      // 按部门逐一搜索
      const depts = options?.departmentFilter
        ? this.departmentManager.listDepartments().filter(d => options.departmentFilter!.includes(d.name))
        : this.departmentManager.listDepartments('active');

      for (const dept of depts) {
        const memories = await this.brainFacade.recall(query, { departmentId: dept.id, source: 'manual' });
        for (const m of memories.slice(0, options?.limit ?? 5)) {
          results.push({ content: m.content, departmentName: dept.name, relevance: m.relevance });
        }
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, options?.limit ?? 20);
  }

  /**
   * setBrainFacade — 注入 BrainFacade 引用
   */
  setBrainFacade(bf: { recall: (q: string, ctx: { departmentId?: string; source: 'task_completed' | 'task_failed' | 'manual' | 'reflection' }) => Promise<Array<{ content: string; relevance: number }>> }): void {
    this.brainFacade = bf;
  }

  setCEO(ceoId: string): void {
    this.ceoId = ceoId;
  }
}
