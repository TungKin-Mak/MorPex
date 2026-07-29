/**
 * Ecommerce WorkflowProvider — 电商工作流插件
 *
 * 实现 WorkflowProvider 接口，注册到 WorkflowRegistry。
 * 支持 Amazon 商品上架、图片上传、价格更新等工作流。
 */
import type { WorkflowProvider, WorkflowAction } from '../../core/src/workflow/WorkflowProvider.js';
import { createListing, uploadImage, updatePrice } from './actions/amazon.js';
import { AmazonPolicyChecker } from './validators/amazon-policy.js';

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
    return keywords.some(k => lower.includes(k));
  },
};

export const xjmcuWorkflowProvider: WorkflowProvider = {
  name: 'xjmcu',
  version: '1.0.0',
  description: '矽杰微 MCU 固件开发工作流：代码生成→编译→烧录→仿真',
  getActions: () => [
    {
      name: 'xjmcu.generate',
      description: '生成 MCU 固件代码',
      execute: async (params) => {
        console.log('[Workflow:XJMCU] MOCK: generate firmware code');
        return { success: true, data: { files: ['main.c', 'config.h'], language: 'C' } };
      },
    },
    {
      name: 'xjmcu.compile',
      description: '编译 MCU 固件',
      execute: async (params) => {
        console.log('[Workflow:XJMCU] MOCK: compile firmware');
        return { success: true, data: { binary: 'firmware.hex', size: '12KB' } };
      },
    },
    {
      name: 'xjmcu.flash',
      description: '烧录固件到 MCU',
      execute: async (params) => {
        console.log('[Workflow:XJMCU] MOCK: flash firmware');
        return { success: true, data: { address: '0x08000000', status: 'written' } };
      },
    },
  ],
  getArtifactTypes: () => ['source_code', 'compiled_binary', 'hex_file'],
  getValidators: () => [],
  matchGoal: (goal: string) => {
    const lower = goal.toLowerCase();
    return lower.includes('mcu') || lower.includes('固件') || lower.includes('firmware') || lower.includes('矽杰');
  },
};
