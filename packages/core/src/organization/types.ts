/**
 * Organization Types — 组织上下文类型定义
 *
 * Phase 0 / 组织层
 * 为 Memory/Knowledge/Artifact 操作提供部门感知上下文
 */

import type { DepartmentId } from '../department/types.js';

/**
 * OrganizationScope — 组织作用域
 *
 * 定义数据访问的范围：
 * - 'department': 仅在当前部门内操作（隔离读写）
 * - 'global': CEO 全局只读视图
 */
export type OrganizationScope = 'department' | 'global';

/**
 * OrganizationContext — 组织上下文
 *
 * 为 Memory/Knowledge/Artifact 操作提供部门感知上下文。
 * 每次数据操作前先设置 context，存储层通过 departmentId 分区实现数据隔离。
 */
export interface OrganizationContext {
  /** 当前操作所在的部门 ID */
  departmentId?: DepartmentId;
  /** 当前操作的作用域 */
  scope: OrganizationScope;
  /** 执行操作的身份（agentId） */
  identity: string;
}
