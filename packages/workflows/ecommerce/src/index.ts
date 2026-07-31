/**
 * Ecommerce Workflow — 电商插件（理想架构第 9 层）
 *
 * 领域逻辑完全隔离在 packages/workflows/ecommerce/。
 */
export { CreateListingAction, UploadImageAction, UpdatePriceAction } from './actions/amazon-primitives.js';
export { bootstrapEcommerceWorkflow } from './bootstrap.js';
