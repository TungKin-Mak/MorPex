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

export { ManagementHub } from './ManagementHub.js';
export type { ParsedCommand, HubStatusReport } from './ManagementHub.js';
