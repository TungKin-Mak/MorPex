/**
 * Department Types — 部门核心类型定义
 *
 * Phase 0 / 组织层
 * 虚拟部门 = 一人公司中的"工作流即部门"抽象
 */

export type DepartmentId = string;

/** 部门类型：template = 固定模板部门（编程部/电商部），project = 动态项目部 */
export type DepartmentType = 'template' | 'project';

/** 部门状态 */
export type DepartmentStatus = 'active' | 'inactive' | 'archived';

/**
 * Department — 部门实体
 */
export interface Department {
  id: DepartmentId;
  /** 部门名称（如"编程部"、"电商部"、"项目X"） */
  name: string;
  type: DepartmentType;
  status: DepartmentStatus;
  /** 模板名称（如 'programming', 'ecommerce'），仅 template 类型有 */
  templateName?: string;
  /** 部门描述 */
  description?: string;
  /** 部门 Lead Agent ID */
  leadAgentId?: string;
  /** 部门群聊 ID */
  groupChatId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * CreateDepartmentParams — 创建部门参数
 */
export interface CreateDepartmentParams {
  name: string;
  type: DepartmentType;
  templateName?: string;
  description?: string;
  /** 创建者 CEO ID */
  ceoId: string;
}

/**
 * DepartmentStats — 部门统计
 */
export interface DepartmentStats {
  totalDepartments: number;
  activeDepartments: number;
  byType: Record<DepartmentType, number>;
}
