/**
 * Ecommerce WorkflowProvider — 电商工作流插件（旧接口兼容层）
 *
 * 理想架构第 9 层：领域逻辑完全隔离在 packages/workflows/ecommerce/。
 * 此 provider 供旧 WorkflowRegistry 发现；新路径请用 src/bootstrap.ts 注册 ActionPrimitive。
 */
import type { WorkflowProvider, WorkflowAction } from '@morpex/core';
import { createListing, uploadImage, updatePrice } from './actions/amazon.js';

const actions: WorkflowAction[] = [
  {
    name: createListing.name,
    description: createListing.description,
    execute: (params, context) => createListing.execute(params, context),
  },
  {
    name: uploadImage.name,
    description: uploadImage.description,
    execute: (params, context) => uploadImage.execute(params, context),
  },
  {
    name: updatePrice.name,
    description: updatePrice.description,
    execute: (params, context) => updatePrice.execute(params, context),
  },
];

export const ecommerceWorkflowProvider: WorkflowProvider = {
  name: 'ecommerce',
  version: '1.0.0',
  description: '电商工作流：Amazon 商品上架、图片管理、定价',
  getActions: () => actions,
  getArtifactTypes: () => ['listing', 'product_image', 'price_snapshot'],
  getValidators: () => ['amazon_policy_checker'],
  matchGoal: (goal: string) => {
    const lower = goal.toLowerCase();
    const keywords = ['amazon', '电商', '商品', '上架', 'listing', 'ecommerce', '产品', '销售', '定价', '图片'];
    return keywords.some((k) => lower.includes(k));
  },
};

export default ecommerceWorkflowProvider;
