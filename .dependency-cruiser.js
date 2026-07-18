/**
 * dependency-cruiser configuration for MorPex
 *
 * Enforces architectural boundaries:
 *   - contracts  → no dependencies on core, adapters, or pi packages
 *   - core       → only depends on contracts (not pi packages directly)
 *   - adapters   → depends on contracts + corresponding pi package
 *   - studio     → depends on core, memory (but not pi packages directly)
 */

export default {
  forbidden: [
    /* ── contracts layer: zero dependencies ── */
    {
      name: 'contracts-no-core-deps',
      comment: 'Contracts package must not depend on core or pi packages',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '(packages/core|packages/adapters|@earendil-works/pi-)' },
    },

    /* ── core: no direct pi dependencies (except isolation layer) ── */
    {
      name: 'core-no-direct-pi-deps',
      comment: 'Core must not directly import from @earendil-works/pi-*. Use contracts + adapters instead.',
      severity: 'error',
      from: {
        path: '^packages/core/',
        pathNot: [
          'packages/core/src/adapters/',
          '\.test\.ts$',
        ],
      },
      to: {
        path: '@earendil-works/',
      },
    },

    /* ── adapters: only allowed deps ── */
    {
      name: 'adapter-deps-boundary',
      comment: 'Adapters must not import from Core (only contracts + pi packages)',
      severity: 'error',
      from: { path: '^packages/adapters/' },
      to: {
        path: 'packages/core/',
      },
    },

    /* ── core: no studio deps ── */
    {
      name: 'core-no-studio-deps',
      comment: 'Core must not depend on studio packages',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: 'packages/studio/' },
    },

    /* ── contracts: no adapters deps ── */
    {
      name: 'contracts-no-adapter-deps',
      comment: 'Contracts must not depend on adapter implementations',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: 'packages/adapters/' },
    },

    /* ── No circular dependencies between packages ── */
    {
      name: 'no-circular-packages',
      comment: 'Package-level circular dependencies are forbidden',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
    // Exclude legacy UI dist assets (not TypeScript sources)
    exclude: {
      path: '(node_modules|dist/assets)',
    },
  },
};
