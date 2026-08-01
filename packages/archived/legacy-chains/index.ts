/**
 * department — 部门模块统一入口
 *
 * Phase 0 / 组织层
 * 虚拟部门基础设施：部门管理 + 上下文分区
 */

export { DepartmentManager } from './DepartmentManager.js';
export { DepartmentContext } from './DepartmentContext.js';
export { LeadAgentOrchestrator } from './LeadAgentOrchestrator.js';
export { DepartmentMemoryAdapter } from './DepartmentMemoryAdapter.js';

export type {
  Department,
  DepartmentId,
  DepartmentType,
  DepartmentStatus,
  CreateDepartmentParams,
  DepartmentStats,
} from './types.js';

export type {
  LeadAgent,
  TaskAssignment,
  OrchestrationResult,
  LeadAgentStats,
} from './LeadAgentOrchestrator.js';
