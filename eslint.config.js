/**
 * ESLint Config for MorPex
 *
 * Enforces dependency boundaries between packages.
 * Key rule: core/ must not import pi packages directly.
 */

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
  },
  {
    files: ['packages/core/src/**/*.ts'],
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
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@morpex/core',
            message: 'Contracts must not import from Core.',
          },
          {
            name: '@earendil-works/pi-ai',
            message: 'Contracts must not import Pi packages.',
          },
          {
            name: '@earendil-works/pi-agent-core',
            message: 'Contracts must not import Pi packages.',
          },
        ],
      }],
    },
  },
  {
    files: ['packages/adapters/mock-runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@earendil-works/*'],
            message: 'Mock adapter must not depend on Pi packages.',
          },
        ],
      }],
    },
  },
  {
    files: ['packages/adapters/pi-*/**/*.ts'],
    rules: {
      'no-restricted-imports': ['off'],
    },
  },
];
