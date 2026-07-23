/**
 * ThinkingLevel — 模型推理深度控制
 */

import { PiBridge } from './pi-bridge/index.js';

const { clampThinkingLevel, getSupportedThinkingLevels } = PiBridge;

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const THINKING_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最大',
};

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

// Model cache
const _cache = new Map<string, Record<string, unknown>>();

function getCached(provider: string, modelId: string): Record<string, unknown> {
  const key = `${provider}:${modelId}`;
  if (!_cache.has(key)) {
    try {
      const { resolveModel } = require('./model-resolver.js') as {
        resolveModel: (p: string, m: string) => Record<string, unknown>;
      };
      _cache.set(key, resolveModel(provider, modelId));
    } catch {
      _cache.set(key, {});
    }
  }
  return _cache.get(key)!;
}

export const thinkingLevelControl = {
  getSupportedLevels(modelId: string, provider = 'deepseek'): ThinkingLevel[] {
    try {
      const model = getCached(provider, modelId);
      const fn = getSupportedThinkingLevels as (m: Record<string, unknown>) => string[];
      const levels = fn(model);
      return levels.filter((l: string) => l !== 'off') as ThinkingLevel[];
    } catch {
      return THINKING_LEVELS;
    }
  },

  clampLevel(modelId: string, level: ThinkingLevel, provider = 'deepseek'): ThinkingLevel {
    try {
      const model = getCached(provider, modelId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (clampThinkingLevel as any)(model, level) as ThinkingLevel;
    } catch {
      return level;
    }
  },

  parseThinkingLevel(value: string, defaultLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL): ThinkingLevel {
    const lower = value.toLowerCase().trim() as ThinkingLevel;
    return THINKING_LEVELS.includes(lower) ? lower : defaultLevel;
  },

  clearCache(): void { _cache.clear(); },
};
