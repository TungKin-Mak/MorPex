/**
 * ModelRegistryAdapter — isolates pi-ai model discovery functions.
 *
 * Wraps pi-ai's getModels / getProviders / getModel.
 * Uses type-safe provider validation (no `as any`).
 */

import { getModels, getProviders } from '@earendil-works/pi-ai';
import type { KnownProvider } from '@earendil-works/pi-ai';
import { resolveModel, isKnownProvider } from './model-resolver.js';

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
      return getProviders();
    } catch {
      return ['deepseek', 'openai'];
    }
  },

  /** List models for a provider */
  listModels(provider: string): ModelInfo[] {
    if (!isKnownProvider(provider)) {
      return [];
    }
    try {
      const models = getModels(provider);
      return models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        api: m.api,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        supportsReasoning: m.reasoning,
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

  /**
   * Resolve a model by provider+modelId strings.
   * Delegates to the type-safe ModelResolver.
   */
  resolveModel,

  // Backward-compat aliases (used by ModelRegistry.ts)
  getProviders: () => {
    try { return getProviders(); } catch { return ['deepseek', 'openai']; }
  },
  getModels: (provider: string) => {
    if (!isKnownProvider(provider)) return [];
    try {
      return getModels(provider).map(m => ({
        id: m.id, name: m.name, provider: m.provider, api: m.api,
        contextWindow: m.contextWindow, maxTokens: m.maxTokens,
        supportsReasoning: m.reasoning,
      }));
    } catch { return []; }
  },
};
