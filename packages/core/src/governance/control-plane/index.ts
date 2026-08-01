/**
 * control-plane — AI System Controller（理想架构第 1 层）
 *
 * 已取代旧版 control-plane（已废弃）；intent 解析已迁至 goal-intelligence/intent，编排已迁至 control-plane/orchestrator
 */
export { ControlPlane } from './ControlPlane.js';
export { GoalController } from './GoalController.js';
export { PolicyController } from './PolicyController.js';
export { ResourceController } from './ResourceController.js';
export { AgentController } from './AgentController.js';
export { EvolutionController } from './EvolutionController.js';

// ── 部门（L1：原 department/ 归位）──
export { DepartmentManager } from './DepartmentManager.js';
export { DepartmentContext } from './DepartmentContext.js';
export type { Department, DepartmentId, DepartmentType, DepartmentStatus, CreateDepartmentParams, DepartmentStats } from './department-types.js';

// ── 角色（L1：原 role/ 归位）──
export { RoleRegistry } from './RoleRegistry.js';
export type { Role, RoleId, RoleName, RoleAssignment } from './types.js';
