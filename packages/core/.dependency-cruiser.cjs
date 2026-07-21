/**
 * Dependency cruiser config — MorPex Architecture Boundary Validation
 *
 * Enforces:
 *   - Only adapters/ may import @earendil-works/* (pi packages)
 *   - Only adapters/memory/ may import memory package directly
 *   - L2-L4 modules must have zero direct external package imports
 *   - No circular dependencies in business logic layers
 *
 * Usage:
 *   npx depcruise --config .dependency-cruiser.cjs src/
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Rule 1: Pi packages only in adapters/ ──
    {
      name: 'no-pi-in-business-logic',
      comment: 'Only adapters/ may import @earendil-works/* packages',
      severity: 'error',
      from: { path: '^src/(?!adapters/)' },
      to: {
        path: [
          'node_modules/@earendil-works',
        ],
        dependencyTypes: ['npm'],
      },
    },

    // ── Rule 2: Memory package only in adapters/memory/ ──
    {
      name: 'no-memory-in-business-logic',
      comment: 'Only adapters/memory/ may import packages/memory directly',
      severity: 'error',
      from: { path: '^src/(?!adapters/memory/)' },
      to: {
        path: [
          'packages/memory',
          'memory/src',
        ],
        dependencyTypes: ['local'],
      },
    },

    // ── Rule 3: No circular dependencies ──
    {
      name: 'no-circular',
      comment: 'Circular dependencies are not allowed',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // ── Rule 4: L5 Gateway must not be imported by lower layers ──
    {
      name: 'no-l5-from-lower',
      comment: 'L5 Gateway (Studio) must not be imported by lower layers',
      severity: 'error',
      from: { path: '^src/(extensions|planes|domains|router|services|tools|permission|memory|mirror|common|gateway|event|compaction|projection|negotiation|industry|prompts|utils|mcp)/' },
      to: { path: ['packages/studio'] },
    },

    // ── Rule 5: Adaptes must not import business logic ──
    {
      name: 'no-business-in-adapters',
      comment: 'Adapter layer must not import business logic or infrastructure',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: ['^src/(extensions|planes|domains|router|services|tools|permission|mirror|common|gateway|event|compaction|projection|negotiation|industry|prompts|utils|mcp)/'] },
    },

    // ── Rule 6: Commons must have minimal dependencies ──
    {
      name: 'no-heavy-in-common',
      comment: 'Common modules should only depend on utilities and config',
      severity: 'warn',
      from: { path: '^src/common/' },
      to: { path: ['^src/(extensions|planes|domains|router|services|tools|permission|mirror|event|compaction|projection|negotiation|industry|prompts|mcp)/'] },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    exclude: {
      path: [
        '__tests__',
        'node_modules',
        '\\.test\\.ts$',
        '\\.spec\\.ts$',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
        theme: {
          graph: { splines: 'ortho' },
          modules: [
            { criteria: { source: '^src/adapters/' }, attributes: { shape: 'box', style: 'filled', fillcolor: '#e1f5e1' } },
            { criteria: { source: '^src/extensions/' }, attributes: { shape: 'box', style: 'filled', fillcolor: '#fff3cd' } },
            { criteria: { source: '^src/planes/' }, attributes: { shape: 'box', style: 'filled', fillcolor: '#d1ecf1' } },
            { criteria: { source: '^src/common/' }, attributes: { shape: 'box', style: 'filled', fillcolor: '#f8d7da' } },
          ],
        },
      },
    },
  },
};
