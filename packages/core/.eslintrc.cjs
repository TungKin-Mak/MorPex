/**
 * ESLint config — MorPex Architecture Boundary Rules
 *
 * Enforces strict layering:
 *   - Only adapters/ may import @earendil-works/* (pi packages)
 *   - Only adapters/memory/ may import packages/memory directly
 *   - L2-L4 code must have zero direct external package imports
 *
 * Usage:
 *   npx eslint src/ --config .eslintrc.cjs
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  env: { node: true, es2023: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },

  // ── Default: DENY @earendil-works/* everywhere ──
  rules: {
    'no-restricted-imports': ['error', {
      paths: [],
      patterns: [
        {
          group: ['@earendil-works/*'],
          message: '[ARCH-BOUNDARY] @earendil-works/* 禁止在 adapters/ 外引用。请通过 adapters/ 桥接层访问。',
        },
        {
          group: ['memory/src*', '**/memory/src*'],
          message: '[ARCH-BOUNDARY] packages/memory 禁止在 adapters/memory/ 外直接引用。请通过 src/adapters/memory/index.js 桥接层访问。',
        },
      ],
    }],
  },

  overrides: [
    // ── adapters/: ALLOW @earendil-works/* (唯一入口) ──
    {
      files: ['src/adapters/**'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    // ── Test files: lenient ──
    {
      files: ['**/__tests__/**', '**/*.test.ts', '**/*.spec.ts'],
      rules: {
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
