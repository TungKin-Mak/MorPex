/**
 * ModelResolver — Type-safe wrapper around pi-ai's getModel().
 *
 * Used by PiAIAdapter to resolve model strings without `as any` casts.
 */

import { getModel, getProviders } from '@earendil-works/pi-ai';
import type { Model, Api, KnownProvider } from '@earendil-works/pi-ai';

let _knownProviders: Set<string> | null = null;

function getKnownProviderSet(): Set<string> {
  if (!_knownProviders) {
    _knownProviders = new Set(getProviders());
  }
  return _knownProviders;
}

function isKnownProvider(value: string): value is KnownProvider {
  return getKnownProviderSet().has(value);
}

/**
 * Type-safe model resolver.
 *
 * Validates provider string against KnownProvider union.
 * Falls back to known defaults if the requested provider is invalid.
 */
export function resolveModel(provider: string, modelId: string): Model<Api> {
  if (isKnownProvider(provider)) {
    try {
      return getModel(provider, modelId as never) as Model<Api>;
    } catch {
      // Fall through to defaults
    }
  }

  // Fallback chain
  const fallbacks: Array<[KnownProvider, string]> = [
    ['deepseek', 'deepseek-v4-flash'],
    ['openai', 'gpt-4o-mini'],
  ];

  for (const [fbProvider, fbModelId] of fallbacks) {
    try {
      return getModel(fbProvider, fbModelId as never) as Model<Api>;
    } catch {
      continue;
    }
  }

  throw new Error(
    `[PiAIAdapter] Cannot resolve model: provider="${provider}" modelId="${modelId}". ` +
    `Available providers: ${[...getKnownProviderSet()].join(', ')}`
  );
}

export function clearProviderCache(): void {
  _knownProviders = null;
}
