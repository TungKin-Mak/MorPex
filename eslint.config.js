/**
 * ESLint Config for MorPex
 *
 * Enforces dependency boundaries between packages.
 * Key rule: core/ must not import pi packages directly.
 */
import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  eslint.configs.recommended,
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/data/**', '**/logs/**', '**/*.cjs', '**/*.js', '**/*.mjs', '**/portable/**', '**/src-tauri/target/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Don't use project service to avoid type-checking (TS handles this)
        projectService: false,
      },
      globals: {
        // Node.js built-in globals (also covered by env:node)
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // ES2022 / Web API globals
        crypto: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        // Test globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        lt: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Relaxed rules for codebase compatibility
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-vars': 'off',
      // TypeScript handles these better than ESLint's no-undef
      'no-undef': 'off',
      // Allow empty catch blocks (common in TS)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Cosmetic: allow escape chars in regex etc.
      'no-useless-escape': 'off',
      // Test files use switch fallthrough intentionally
      'no-fallthrough': 'off',
      // Some tests use console.log for diagnostics
      'no-console': 'off',
    },
  },
  {
    // 核心非适配器层：禁止直接导入 pi 包
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/infrastructure/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@earendil-works/pi-ai',
            message: 'Core must not import pi-ai directly. Use contracts and adapters layer.',
          },
          {
            name: '@earendil-works/pi-agent-core',
            message: 'Core must not import pi-agent-core directly. Use contracts and adapters layer.',
          },
          {
            name: '@earendil-works/pi-coding-agent',
            message: 'Core must not import pi-coding-agent directly. Use contracts and adapters layer.',
          },
        ],
        patterns: [
          {
            group: ['@earendil-works/*'],
            message: 'Core must not import any @earendil-works package directly. Use adapters/ layer.',
          },
        ],
      }],
    },
  },
  {
    // 适配器层：允许导入 pi 包（这是唯一允许的地方）
    files: ['packages/core/src/infrastructure/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@morpex/core', message: 'Contracts must not import from Core.' },
          { name: '@earendil-works/pi-ai', message: 'Contracts must not import Pi packages.' },
          { name: '@earendil-works/pi-agent-core', message: 'Contracts must not import Pi packages.' },
        ],
      }],
    },
  },
];
