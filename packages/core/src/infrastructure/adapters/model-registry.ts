/**
 * ModelRegistryAdapter — isolates pi-ai model discovery functions.
 *
 * Wraps pi-ai's getModels / getProviders / getModel.
 * Uses type-safe provider validation.
 */

import { getModels, getProviders } from '@earendil-works/pi-ai/compat';

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
      return ['deepseek', 'openai'];
    }
  },

  /** List models for a provider */
  listModels(provider: string): ModelInfo[] {
    try {
      const models = getModels(provider as never) as unknown as Array<{
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

  /** Get default model */
  getDefaultModel(): ModelInfo {
    return this.findModel('deepseek-v4-flash') ?? {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      provider: 'deepseek',
      api: 'openai-completions',
      contextWindow: 128_000,
      maxTokens: 16_384,
      supportsReasoning: true,
    };
  },

  // Backward-compat aliases
  getProviders: () => {
    try { return getProviders() as unknown as string[]; } catch { return ['deepseek', 'openai']; }
  },
  getModels: (provider: string) => {
    try {
      const models = getModels(provider as never) as unknown as Array<{
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
