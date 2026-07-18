/**
 * ModelRegistry — pi-ai 模型运行时发现
 *
 * 封装 pi-ai 的 getModels + getProviders + getModel，
 * 提供 MorPexCore 统一的模型查询和发现能力。
 *
 * 所有 pi-ai 直接依赖集中在 ModelRegistryAdapter 中，
 * 更换 pi-ai 版本时仅需修改适配层。
 */

import { piModelRegistry } from '../adapters/model-registry.js';
import type { ModelInfo, ProviderInfo } from '../adapters/model-registry.js';

export type { ModelInfo, ProviderInfo };

/**
 * 获取所有可用提供商
 */
export function listProviders(): string[] {
  return piModelRegistry.getProviders();
}

/**
 * 获取指定提供商的所有模型
 */
export function listModels(provider: string): ModelInfo[] {
  return piModelRegistry.getModels(provider);
}

/**
 * 获取所有提供商及其模型
 */
export function listAllProviders(): ProviderInfo[] {
  const providers = listProviders();
  return providers.map(name => ({
    name,
    models: listModels(name),
  }));
}

/**
 * 按模型 ID 查找模型信息
 */
export function findModel(modelId: string): ModelInfo | undefined {
  return piModelRegistry.findModel(modelId);
}

/**
 * 获取默认模型（当前使用 deepseek-v4-flash）
 */
export function getDefaultModel(): ModelInfo {
  return piModelRegistry.getDefaultModel();
}
