/**
 * ModelRegistryAdapter — isolates pi-ai model discovery functions.
 *
 * Wraps pi-ai's getModels / getProviders / getModel.
 * Uses type-safe provider validation.
 */

import { getModels, getProviders } from '@earendil-works/pi-ai/compat';
import { resolveDefaultModel, DEFAULT_MODEL } from './pi-bridge/index.js';

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

export const piModelRegistry = {
  /** List all known providers */
  listProviders(): string[] {
    try {
      return getProviders() as unknown as string[];
    } catch {
      return [resolveDefaultModel().split('/')[0] || 'opencode', 'openai'];
    }
  },

  /** List models for a provider */
  listModels(provider: string): ModelInfo[] {
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
    try { return getProviders() as unknown as string[]; } catch { return [resolveDefaultModel().split('/')[0] || 'opencode', 'openai']; }
  },
  getModels: (provider: string) => {
    try {
      const models = getModels(provider as unknown as Parameters<typeof getModels>[0]) as unknown as Array<{
        id: string; name: string; provider: { id: string } | string;
        api: string; contextWindow: number; maxTokens: number; reasoning: boolean;
      }>;
      return models.map(m => ({
        id: m.id, name: m.name,
        provider: typeof m.provider === 'string' ? m.provider : m.provider.id,
        api: m.api,
        contextWindow: Number(m.contextWindow), maxTokens: Number(m.maxTokens),
        supportsReasoning: Boolean(m.reasoning),
      }));
    } catch { return []; }
  },
};
