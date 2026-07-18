import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      'lucide-react',
    ],
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    open: true,
    proxy: {
      // 所有 /api/* 请求代理到 StudioServer（后端）
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // SSE 流
      '/api/stream': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
