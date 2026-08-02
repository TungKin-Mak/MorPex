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
      'packages/connectors/**/__tests__/**/*.test.ts',
      'packages/workflows/**/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    // ═══ S20 清理 ═══
    // 排除脚本式测试（v11 遗留：无 vitest 结构，main()/process.exit 直跑）。
    // 这类文件用 `npx tsx <file>` 手动运行；vitest 不收集，避免
    // 「No test suite found」/ worker 挂起（S18/S20 已重写 memory-activation、
    // critical-cognitive-pipeline 为规范 vitest，其余脚本式在此排除）。
    exclude: [
      'packages/studio/ui/**',
      'node_modules/**',
      '**/dist/**',
      // ── packages/core/__tests__ 脚本式（精确清单）──
      'packages/core/__tests__/artifact-lifecycle.test.ts',
      'packages/core/__tests__/artifact-plane.test.ts',
      'packages/core/__tests__/architecture-integration.test.ts',
      'packages/core/__tests__/config-validation.test.ts',
      'packages/core/__tests__/context-assembly.test.ts',
      'packages/core/__tests__/critical-llm-mock.test.ts',
      'packages/core/__tests__/critical-memory-knowledge.test.ts',
      'packages/core/__tests__/critical-sandbox-security.test.ts',
      'packages/core/__tests__/cross-agent-learning.test.ts',
      'packages/core/__tests__/fsm-lifecycle.test.ts',
      'packages/core/__tests__/learning-loop.test.ts',
      'packages/core/__tests__/phase2-optimization.test.ts',
      'packages/core/__tests__/phase3-security.test.ts',
      'packages/core/__tests__/phase4-observability.test.ts',
      'packages/core/__tests__/production-llm-mock.test.ts',
      'packages/core/__tests__/production-memory.test.ts',
      'packages/core/__tests__/production-pipeline.test.ts',
      'packages/core/__tests__/production-sandbox.test.ts',
      'packages/core/__tests__/recovery-lifecycle.test.ts',
      'packages/core/__tests__/resilience.test.ts',
      'packages/core/__tests__/security-prompt-injection.test.ts',
      'packages/core/__tests__/stage1-persistence.test.ts',
      'packages/core/__tests__/unified-eventstore.test.ts',
      // ── tests/ 脚本式（子目录 + 顶层；CI 用 tsx 跑 tests/e2e/v15-full-cycle，保留）──
      'tests/architecture/**/*.test.ts',
      'tests/chaos/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/scenarios/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/scenario/**/*.test.ts',
      'tests/failure/**/*.test.ts',
      'tests/performance/**/*.test.ts',
    ],
    // Force exit after test completion
    forceExit: true,
    // TypeScript configuration — Vitest 4: poolOptions moved to top-level
    pool: 'forks',
    singleFork: true,
    // ═══ P2: 覆盖率采集（@vitest/coverage-v8）═══
    coverage: {
      provider: 'v8',
      // 只统计业务源码，排除测试/装配/桶文件
      include: [
        'packages/core/src/**/*.ts',
        'packages/studio/server/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/bootstrap*.ts',
        'packages/core/src/infrastructure/common/types.ts',
        'packages/studio/server/data/**',
        'packages/studio/server/event-mesh/**',
      ],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: 'data/test-report/coverage',
      // 阈值锁定已达成基线（语句 32.85 / 分支 26.25 / 函数 30.7 / 行 34.54，S31 再推一档后），
      // 略低防轻微波动误红，重大回退仍会被拦
      thresholds: {
        statements: 31,
        branches: 25,
        functions: 29,
        lines: 33,
      },
    },
  },
  // Resolve aliases matching tsconfig paths
  // ═══ S20 修复：补全子路径 alias（原只配根，@morpex/contracts/* 等解析失败）═══
  resolve: {
    alias: [
      { find: /^@morpex\/connectors\/(.+)$/, replacement: '/packages/connectors/src/$1' },
      { find: /^@morpex\/connectors$/, replacement: '/packages/connectors/src/index.ts' },
      { find: /^@morpex\/contracts\/(.+)$/, replacement: '/packages/contracts/$1' },
      { find: /^@morpex\/contracts$/, replacement: '/packages/contracts/index.ts' },
      { find: /^@morpex\/core\/(.+)$/, replacement: '/packages/core/$1' },
      { find: /^@morpex\/core$/, replacement: '/packages/core/index.ts' },
      { find: /^@morpex\/memory\/(.+)$/, replacement: '/packages/memory/src/$1' },
      { find: /^@morpex\/memory$/, replacement: '/packages/memory/src/index.ts' },
      { find: /^@morpex\/workflow-sdk$/, replacement: '/packages/workflow-sdk/src/index.ts' },
      { find: /^@morpex\/workflow-sdk\/(.+)$/, replacement: '/packages/workflow-sdk/src/$1' },
    ],
  },
});
