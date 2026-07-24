/**
 * OrganizationContextLite — 精简版组织上下文
 *
 * Phase 0 / 组织层
 *
 * 替代原有的复杂 Organization Governance / Domain Cluster 模块。
 * 只提供：
 *   1. 当前操作所在的部门（departmentId）
 *   2. 数据访问范围（scope: department | global）
 *   3. 身份标识（identity）
 *
 * 设计约束：
 *   - 单例模式（全局唯一上下文）
 *   - 使用类似 EventBus.setCurrentDomain 的模式
 *   - 所有 Memory/Knowledge/Artifact 操作前先设置 context
 *
 * 使用方式：
 *   const ctx = OrganizationContextLite.getInstance();
 *   ctx.enterDepartment('dept_xxx', 'agent-yyy');
 *   // ... 数据操作自动隔离到 dept_xxx
 *   ctx.enterGlobal('ceo');
 *   // ... 全局只读视图
 */

import type { DepartmentId } from '../department/types.js';
import type { OrganizationContext, OrganizationScope } from './types.js';

export class OrganizationContextLite {
  private static instance: OrganizationContextLite;
  private currentContext: OrganizationContext = {
    scope: 'global',
    identity: 'system',
  };

  private constructor() {
    // 单例模式
  }

  /**
   * getInstance — 获取全局单例
   */
  static getInstance(): OrganizationContextLite {
    if (!OrganizationContextLite.instance) {
      OrganizationContextLite.instance = new OrganizationContextLite();
    }
    return OrganizationContextLite.instance;
  }

  /**
   * enterDepartment — 进入部门上下文
   *
   * 调用后，所有数据操作将限制在该部门内。
   *
   * @param departmentId - 目标部门 ID
   * @param identity - 操作者身份
   */
  enterDepartment(departmentId: DepartmentId, identity: string): void {
    this.currentContext = {
      departmentId,
      scope: 'department',
      identity,
    };
  }

  /**
   * enterGlobal — 进入全局上下文
   *
   * 调用后，数据操作为 CEO 全局只读视图。
   *
   * @param identity - 操作者身份（默认 'ceo'）
   */
  enterGlobal(identity: string = 'ceo'): void {
    this.currentContext = {
      departmentId: undefined,
      scope: 'global',
      identity,
    };
  }

  /**
   * getCurrent — 获取当前上下文（返回副本）
   */
  getCurrent(): OrganizationContext {
    return { ...this.currentContext };
  }

  /**
   * isWithinDepartment — 是否在部门上下文中
   */
  isWithinDepartment(): boolean {
    return this.currentContext.scope === 'department' && !!this.currentContext.departmentId;
  }

  /**
   * getDepartmentPartitionKey — 获取数据分区键
   *
   * 用于存储层隔离。
   * 返回格式：'dept:{departmentId}' 或 'global'
   */
  getDepartmentPartitionKey(): string {
    if (this.currentContext.scope === 'global' || !this.currentContext.departmentId) {
      return 'global';
    }
    return `dept:${this.currentContext.departmentId}`;
  }

  /**
   * reset — 重置为全局上下文
   */
  reset(): void {
    this.currentContext = {
      scope: 'global',
      identity: 'system',
    };
  }
}
