/**
 * Organization Types — 组织上下文类型定义
 *
 * Phase 0 / 组织层
 * v15: +DynamicTeam 动态团队编排类型
 *
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

// ═══════════════════════════════════════════════════════════════
// v15: Dynamic Team Orchestration
// ═══════════════════════════════════════════════════════════════

/**
 * DynamicTeam — 动态团队的完整生命周期对象
 * v15: 根据目标能力需求动态创建，支持并行多团队协作
 */
export interface DynamicTeam {
  id: string;
  goalId: string;
  name: string;
  members: TeamMember[];
  departments: string[];
  dependencies: DependencyGraph;
  lifecycle: 'CREATED' | 'ACTIVE' | 'MERGING' | 'DISBANDED';
  createdAt: number;
}

/**
 * TeamMember — 团队成员定义
 */
export interface TeamMember {
  agentId: string;
  role: string;
  departmentId: string;
  capabilities: string[];
  status: 'ASSIGNED' | 'ACTIVE' | 'BLOCKED' | 'COMPLETED';
}

/**
 * DependencyGraph — 团队间依赖关系图
 */
export interface DependencyGraph {
  edges: Array<{ from: string; to: string; type: 'blocking' | 'data_flow' | 'review' }>;
  nodes: string[];
}

/**
 * TeamSpec — 团队构建规格说明
 */
export interface TeamSpec {
  requiredCapabilities: string[];
  preferredDepartment?: string;
  minSize?: number;
  maxSize?: number;
}
