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
   * setCEO — 设置 CEO 身份（用于多 CEO 场景或初始化）
   */
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
