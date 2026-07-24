/**
 * organization — 组织上下文模块统一入口
 *
 * Phase 0 / 组织层
 * 精简版组织上下文，替代 Domain Cluster 等复杂模块
 */

export { OrganizationContextLite } from './OrganizationContextLite.js';
export { ManagementHub } from './ManagementHub.js';

export type {
  OrganizationContext,
  OrganizationScope,
} from './types.js';

export type {
  ParsedCommand,
  HubStatusReport,
} from './ManagementHub.js';
