/**
 * MorPex ESLint Configuration
 *
 * Enforces dependency boundary rules:
 *   - contracts/  : no Pi imports, no core imports
 *   - core/src/   : no Pi imports (except src/adapters/)
 *   - adapters/   : no core imports
 *
 * Install ESLint + typescript-eslint to activate:
 *   npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'data/',
    '*.js',
    '*.cjs',
    '*.mjs',
  ],
  overrides: [
    // ═══════════════════════════════════════════════════════════════
    // packages/contracts — zero external dependencies
    // ═══════════════════════════════════════════════════════════════
    {
      files: ['packages/contracts/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@earendil-works/*'],
                message:
                  'Contracts must not depend on Pi packages. ' +
                  'Contracts are the zero-dependency stable abstraction layer.',
              },
              {
                group: ['packages/core/*', '../core/*', '../../core/*'],
                message:
                  'Contracts must not depend on Core. ' +
                  'Core depends on Contracts, not the other way around.',
              },
              {
                group: ['packages/adapters/*', '../adapters/*', '../../adapters/*'],
                message:
                  'Contracts must not depend on Adapters. ' +
                  'Adapters implement Contracts; they are siblings, not parents.',
              },
            ],
          },
        ],
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // packages/core/src — no direct Pi imports (except adapters/)
    // ═══════════════════════════════════════════════════════════════
    {
      files: ['packages/core/src/**/*.ts'],
      excludedFiles: ['packages/core/src/adapters/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@earendil-works/*'],
                message:
                  'Core must not import Pi packages directly. ' +
                  'Use packages/core/src/adapters/ as the bridge layer.',
              },
            ],
          },
        ],
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // packages/adapters — no core imports
    // ═══════════════════════════════════════════════════════════════
    {
      files: ['packages/adapters/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['packages/core/*', '../core/*', '../../core/*'],
                message:
                  'Adapters must not depend on Core. ' +
                  'Adapters implement Contracts and wrap Pi packages; Core depends on Adapters through Contracts.',
              },
            ],
          },
        ],
      },
    },
  ],
};
