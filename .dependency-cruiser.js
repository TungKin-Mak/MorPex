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

    /* ── ontology layer: allowed dependencies ── */
    {
      name: 'ontology-allowed-deps',
      comment: 'ontology/ may depend on metadata, events, tools, prompts; not on planner or execution',
      severity: 'error',
      from: { path: 'packages/core/src/ontology/' },
      to: { pathNot: ['packages/core/src/ontology/', 'packages/core/src/metadata/', 'packages/core/src/events/', 'packages/core/src/tools/', 'packages/core/src/prompts/', 'packages/core/src/protocol/', 'node_modules'] },
    },

    /* ── planner must not import SystemMetadataGraph directly ── */
    {
      name: 'planner-no-metadatagraph',
      comment: 'Planner must not directly import SystemMetadataGraph. Use OntologyService instead.',
      severity: 'error',
      from: { path: 'packages/core/src/planner/' },
      to: { path: 'packages/core/src/metadata/SystemMetadataGraph' },
    },

    /* ── evaluation may depend on ontology ── */
    // ⚠️ 2026-08-05 修复：白名单路径为重构前旧目录（ontology//metadata//protocol/ 不存在）。
    // 8 层布局下 ontology/artifact 归 L2 knowledge/，事件类型归 L8 infrastructure/protocol/——
    // L6 evaluation 读 L2 知识做合规评分 + 发标准审计事件，与架构文档/代码注释意图一致（非规避）。
    {
      name: 'eval-ontology-allowed',
      comment: 'evaluation/ may depend on L2 knowledge (ontology/artifact) + infrastructure/protocol for compliance scoring & audit events',
      severity: 'error',
      from: { path: 'packages/core/src/evaluation/' },
      to: { pathNot: ['packages/core/src/evaluation/', 'packages/core/src/knowledge/', 'packages/core/src/infrastructure/protocol/', 'node_modules'] },
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
