/**
 * organization — 组织上下文模块统一入口
 *
 * Phase 0 / 组织层 — v15: 新增动态团队编排
 *
 * 包含：
 *   - OrganizationContextLite: 组织上下文
 *   - ManagementHub: CEO 管理群
 *   - DynamicTeamOrchestrator: 动态多团队编排（v15）
 *   - TeamBuilder / AgentAllocator / DependencyCoordinator: 团队构建工具
 */

export { OrganizationContextLite } from './OrganizationContextLite.js';
export { ManagementHub } from './ManagementHub.js';
export { DynamicTeamOrchestrator } from './DynamicTeamOrchestrator.js';
export type { AgentPoolProvider } from './DynamicTeamOrchestrator.js';
export { TeamBuilder } from './TeamBuilder.js';
export { AgentAllocator } from './AgentAllocator.js';
export { DependencyCoordinator } from './DependencyCoordinator.js';
export type { OrganizationContext, OrganizationScope } from './types.js';
export type { DynamicTeam, TeamMember, DependencyGraph, TeamSpec } from './types.js';
export type { ParsedCommand, HubStatusReport } from './ManagementHub.js';
