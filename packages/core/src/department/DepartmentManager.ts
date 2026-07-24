/**
 * DepartmentManager — 部门管理器
 *
 * Phase 0 / 组织层核心
 * 职责：
 *   1. 创建/删除/更新部门（工作流=部门）
 *   2. 按名称或 ID 查询部门
 *   3. 发射部门生命周期事件（department.created/updated/deleted）
 *   4. 提供部门统计
 *
 * 设计约束：
 *   - 构造时注入 EventBus，所有变更通过事件广播
 *   - 部门 ID 格式：dept_{timestamp}_{random}
 *   - 部门数据目前存储于内存，后续可迁移到 SQLite
 */

import { EventBus } from '../common/EventBus.js';
import type {
  Department,
  DepartmentId,
  DepartmentStatus,
  CreateDepartmentParams,
  DepartmentStats,
} from './types.js';

export class DepartmentManager {
  private departments: Map<DepartmentId, Department> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    if (!eventBus) {
      throw new Error('[DepartmentManager] EventBus 是必填参数');
    }
    this.eventBus = eventBus;
  }

  /**
   * createDepartment — 创建部门
   *
   * 1. 生成部门 ID
   * 2. 创建部门实体
   * 3. 存储到内存 Map
   * 4. 发射 department.created 事件
   *
   * @returns 创建的 Department 实体
   */
  async createDepartment(params: CreateDepartmentParams): Promise<Department> {
    const id: DepartmentId = `dept_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const dept: Department = {
      id,
      name: params.name,
      type: params.type,
      status: 'active',
      templateName: params.templateName,
      description: params.description,
      createdAt: now,
      updatedAt: now,
    };

    this.departments.set(id, dept);

    this.eventBus.emit({
      id: `evt_${now}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'department.created',
      timestamp: now,
      executionId: 'kernel',
      source: 'department',
      payload: { department: dept, ceoId: params.ceoId },
    });

    return dept;
  }

  /**
   * getDepartment — 按 ID 获取部门
   */
  getDepartment(id: DepartmentId): Department | undefined {
    return this.departments.get(id);
  }

  /**
   * findByName — 按名称查找部门
   */
  findByName(name: string): Department | undefined {
    return [...this.departments.values()].find(
      d => d.name.toLowerCase() === name.toLowerCase(),
    );
  }

  /**
   * listDepartments — 列出部门（可选按状态过滤）
   */
  listDepartments(status?: DepartmentStatus): Department[] {
    const all = [...this.departments.values()];
    return status ? all.filter(d => d.status === status) : all;
  }

  /**
   * updateDepartment — 更新部门信息
   *
   * @returns 更新后的 Department，如果部门不存在返回 undefined
   */
  async updateDepartment(
    id: DepartmentId,
    updates: Partial<Pick<Department, 'name' | 'status' | 'description' | 'leadAgentId' | 'groupChatId' | 'metadata'>>,
  ): Promise<Department | undefined> {
    const dept = this.departments.get(id);
    if (!dept) return undefined;

    const updated: Department = { ...dept, ...updates, updatedAt: Date.now() };
    this.departments.set(id, updated);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'department.updated',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'department',
      payload: { departmentId: id, changes: Object.keys(updates) },
    });

    return updated;
  }

  /**
   * deleteDepartment — 删除部门
   *
   * @returns true 如果部门存在并删除，false 如果部门不存在
   */
  async deleteDepartment(id: DepartmentId): Promise<boolean> {
    const existed = this.departments.has(id);
    if (!existed) return false;

    this.departments.delete(id);

    this.eventBus.emit({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'department.deleted',
      timestamp: Date.now(),
      executionId: 'kernel',
      source: 'department',
      payload: { departmentId: id },
    });

    return true;
  }

  /**
   * getStats — 获取部门统计
   */
  getStats(): DepartmentStats {
    const departments = [...this.departments.values()];

    const byType: Record<string, number> = { template: 0, project: 0 };
    for (const d of departments) {
      byType[d.type] = (byType[d.type] || 0) + 1;
    }

    return {
      totalDepartments: departments.length,
      activeDepartments: departments.filter(d => d.status === 'active').length,
      byType: byType as DepartmentStats['byType'],
    };
  }
}
