/**
 * ThinkingLevelAdapter — isolates pi-ai thinking-level control functions.
 *
 * Wraps clampThinkingLevel / getSupportedThinkingLevels.
 * Uses ModelResolver for type-safe model resolution (no `as any`).
 */

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-ai';
import { resolveModel } from './model-resolver.js';

export type { ThinkingLevel };

export const THINKING_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '最高',
};

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

// Model cache keyed by "provider:modelId"
const _modelCache = new Map<string, ReturnType<typeof resolveModel>>();

function getCachedModel(provider: string, modelId: string) {
  const key = `${provider}:${modelId}`;
  if (!_modelCache.has(key)) {
    _modelCache.set(key, resolveModel(provider, modelId));
  }
  return _modelCache.get(key)!;
}

export const thinkingLevelControl = {
  getSupportedLevels(modelId: string, provider?: string): ThinkingLevel[] {
    try {
      const model = getCachedModel(provider ?? 'deepseek', modelId);
      return getSupportedThinkingLevels(model).filter(l => l !== 'off') as ThinkingLevel[];
    } catch {
      return THINKING_LEVELS;
    }
  },

  clampLevel(modelId: string, level: ThinkingLevel, provider?: string): ThinkingLevel {
    try {
      const model = getCachedModel(provider ?? 'deepseek', modelId);
      return clampThinkingLevel(model, level) as ThinkingLevel;
    } catch {
      return level;
    }
  },

  parseThinkingLevel(value: string, defaultLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL): ThinkingLevel {
    const lower = value.toLowerCase().trim() as ThinkingLevel;
    return THINKING_LEVELS.includes(lower) ? lower : defaultLevel;
  },

  clearCache(): void {
    _modelCache.clear();
  },
};
