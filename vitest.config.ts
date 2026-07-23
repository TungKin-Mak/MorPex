/**
 * MorPex Root Vitest Configuration
 *
 * Runs server-side tests across all packages.
 * UI tests are in packages/studio/ui/vitest.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use 'node' environment for server-side tests
    environment: 'node',
    // Global test timeout: 30 seconds
    testTimeout: 30000,
    // Hook timeout: 15 seconds
    hookTimeout: 15000,
    // Include patterns for test files
    include: [
      'packages/core/**/__tests__/**/*.test.ts',
      'packages/studio/server/**/__tests__/**/*.test.ts',
      'packages/memory/**/*.spec.ts',
      'tests/**/*.test.ts',
    ],
    // Exclude UI tests and node_modules
    exclude: [
      'packages/studio/ui/**',
      'node_modules/**',
      '**/dist/**',
    ],
    // Force exit after test completion
    forceExit: true,
    // TypeScript configuration — Vitest 4: poolOptions moved to top-level
    pool: 'forks',
    singleFork: true,
  },
  // Resolve aliases matching tsconfig paths
  resolve: {
    alias: {
      '@morpex/contracts': '/packages/contracts/index.ts',
      '@morpex/core': '/packages/core/index.ts',
      '@morpex/memory': '/packages/memory/src/index.ts',
    },
  },
});
