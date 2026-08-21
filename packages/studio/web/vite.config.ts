import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5473',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  base: './',
});
