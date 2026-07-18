import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./ts/__tests__/setup.ts'],
    include: ['./ts/__tests__/**/*.test.{ts,tsx}'],
    css: false,
  },
  // Disable oxc, use esbuild for JSX parsing
  oxc: false,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
    tsconfigRaw: {
      compilerOptions: {
        jsx: 'react-jsx',
        target: 'es2020',
        module: 'esnext',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './ts'),
    },
  },
});
