/**
 * tools — 动态工具层
 *
 * v13 新增:
 *   ToolRegistry — 工具注册中心（静态类）
 *   ToolFactory — 动态工具生成工厂
 *   primitives/ — 领域原语
 */

export { ToolRegistry } from './ToolRegistry.js';
export type { ToolSchema, RegisteredTool } from './ToolRegistry.js';

export { ToolFactory } from './ToolFactory.js';
export type { ToolGenContext } from './ToolFactory.js';

// ── Primitives ──
export { AmazonListingAction, MarketResearchAction } from './primitives/index.js';
export type { ActionPrimitive, ActionResult, ListingData, ListingResult } from './primitives/index.js';
export type { ResearchRequest, ResearchResult } from './primitives/index.js';
