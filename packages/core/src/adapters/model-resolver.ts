/**
 * ModelResolver — Type-safe wrapper around pi-ai's getModel().
 *
 * Eliminates `as any` casts by validating provider strings against
 * the KnownProvider union at the adapter boundary.
 *
 * ═══════════════════════════════════════════════════════════════════
 * Why this exists:
 *   pi-ai's getModel<TProvider extends KnownProvider, TModelId>(...)
 *   requires compile-time-known provider literals. Our config provides
 *   runtime strings. This wrapper validates and bridges the gap.
 * ═══════════════════════════════════════════════════════════════════
 */

import { getModel, getProviders } from '@earendil-works/pi-ai';
import type { Model, Api, KnownProvider } from '@earendil-works/pi-ai';

// Cache the valid provider list (stable at runtime)
let _knownProviders: Set<string> | null = null;

function getKnownProviderSet(): Set<string> {
  if (!_knownProviders) {
    _knownProviders = new Set(getProviders());
  }
  return _knownProviders;
}

/**
 * Validate that a string is a KnownProvider.
 * Returns the string cast as KnownProvider if valid, or null.
 */
export function isKnownProvider(value: string): value is KnownProvider {
  return getKnownProviderSet().has(value);
}

/**
 * Type-safe model resolver.
 *
 * Accepts runtime strings, validates against the known provider set,
 * and returns a Model instance. Falls back to a safe default if
 * the provider is unknown.
 *
 * @param provider - Provider name from config (e.g. "deepseek")
 * @param modelId - Model ID from config (e.g. "deepseek-v4-flash")
 * @returns Model instance
 * @throws Error if neither the requested provider nor the fallback work
 */
export function resolveModel(provider: string, modelId: string): Model<Api> {
  // Try the requested provider first
  if (isKnownProvider(provider)) {
    try {
      // pi-ai's getModel has strict generic constraints requiring
      // compile-time-known model IDs from a generated MODELS map.
      // At the adapter boundary we bridge runtime strings to these types.
      // The `as never` cast is the minimum-safe escape hatch — the runtime
      // will throw if the model ID is invalid for the provider.
      return getModel(provider, modelId as never) as Model<Api>;
    } catch {
      // Fall through to default
    }
  }

  // Fallback: try known defaults in order
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
    `[ModelResolver] Cannot resolve model: provider="${provider}" modelId="${modelId}". ` +
    `Available providers: ${[...getKnownProviderSet()].join(', ')}`
  );
}

/** Clear the provider cache (for testing or config reload) */
export function clearProviderCache(): void {
  _knownProviders = null;
}
