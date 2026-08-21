/**
 * ModelRegistryAdapter — isolates pi-ai model discovery functions.
 *
 * Wraps pi-ai's getModels / getProviders / getModel.
 * Uses type-safe provider validation.
 */

import { getModels, getProviders } from '@earendil-works/pi-ai/compat';
import { resolveDefaultModel, DEFAULT_MODEL } from './pi-bridge/index.js';
import { loadMorpexConfig, getEnabledExtraLlms } from './pi-bridge/yamlConfig.js';

/** Model info in MorPex format */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  supportsReasoning: boolean;
}

/** Provider info */
export interface ProviderInfo {
  name: string;
  models: ModelInfo[];
}

/**
 * getExtraModelInfos — 从 config（llm_* 附加模型块）构建 ModelInfo 列表
 *
 * compat 静态目录（getModels/getProviders）不含运行时 createProvider 注册的自定义
 * provider——附加网关模型（如本地 MiniCPM5）从这里读 config 构建，供发现/列表/查找可见。
 * 与 PiBridge 运行时注册保持同一 config 来源。
 */
function getExtraModelInfos(): ModelInfo[] {
  // 过滤条件与 PiBridge / model-resolver 共用 isExtraLlmUsable（yamlConfig），防止三处漂移
  return getEnabledExtraLlms(loadMorpexConfig()).map((g) => ({
    id: g.model as string,
    name: g.model as string,
    provider: g.provider as string,
    api: 'openai-completions',
    contextWindow: g.contextWindow ?? 128000,
    maxTokens: g.maxTokens ?? 32000,
    supportsReasoning: g.reasoning ?? false,
  }));
}

/** compat 静态目录模型映射（getModels 不返回运行时 createProvider 注册的自定义 provider） */
function listCompatModels(provider: string): ModelInfo[] {
  try {
    const models = getModels(provider as unknown as Parameters<typeof getModels>[0]) as unknown as Array<{
      id: string; name: string; provider: { id: string } | string;
      api: string; contextWindow: number; maxTokens: number; reasoning: boolean;
    }>;
    return models.map(m => ({
      id: m.id,
      name: m.name,
      provider: typeof m.provider === 'string' ? m.provider : m.provider.id,
      api: m.api,
      contextWindow: Number(m.contextWindow),
      maxTokens: Number(m.maxTokens),
      supportsReasoning: Boolean(m.reasoning),
    }));
  } catch {
    return [];
  }
}

export const piModelRegistry = {
  /** List all known providers */
  listProviders(): string[] {
    const compat: string[] = (() => {
      try {
        return getProviders() as unknown as string[];
      } catch {
        return [];
      }
    })();
    const extra = getExtraModelInfos().map((m) => m.provider);
    return Array.from(new Set([...compat, ...extra]));
  },

  /** List models for a provider */
  listModels(provider: string): ModelInfo[] {
    // 附加网关模型优先（compat 静态目录不含运行时注册的自定义 provider）
    const extra = getExtraModelInfos().filter((m) => m.provider === provider);
    if (extra.length > 0) return extra;
    return listCompatModels(provider);
  },

  /** List all providers with their models */
  listAllProviders(): ProviderInfo[] {
    return this.listProviders().map(name => ({
      name,
      models: this.listModels(name),
    }));
  },

  /** Find a model by ID across all providers */
  findModel(modelId: string): ModelInfo | undefined {
    for (const provider of this.listProviders()) {
      const models = this.listModels(provider);
      const found = models.find(m => m.id === modelId);
      if (found) return found;
    }
    return undefined;
  },

  /** Get default model（会话 11：从 config 解析 provider/model，不再硬编码） */
  getDefaultModel(): ModelInfo {
    const resolved = resolveDefaultModel(); // 'provider/model'（config 驱动；缺失兜底 DEFAULT_MODEL）
    const idx = resolved.indexOf('/');
    const provider = idx === -1 ? DEFAULT_MODEL.split('/')[0] : resolved.substring(0, idx);
    const modelId = idx === -1 ? DEFAULT_MODEL.split('/')[1] : resolved.substring(idx + 1);
    return this.findModel(modelId) ?? {
      id: modelId,
      name: modelId,
      provider,
      api: 'openai-completions',
      contextWindow: 200_000,
      maxTokens: 128_000,
      supportsReasoning: true,
    };
  },

  // Backward-compat aliases
  getProviders: () => {
    const compat: string[] = (() => {
      try { return getProviders() as unknown as string[]; } catch { return []; }
    })();
    const extra = getExtraModelInfos().map((m) => m.provider);
    return Array.from(new Set([...compat, ...extra]));
  },
  getModels: (provider: string) => {
    // 附加网关模型优先（compat 静态目录不含运行时注册的自定义 provider）
    const extra = getExtraModelInfos().filter((m) => m.provider === provider);
    if (extra.length > 0) return extra;
    return listCompatModels(provider);
  },
};
