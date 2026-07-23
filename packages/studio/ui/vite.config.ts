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
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
      },
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
    watch: {
      // 排除 data/ 目录（避免 zvec LOCK 文件在 Windows 上导致 EBUSY）
      ignored: (path: string) => path.includes('\\data\\') || path.includes('/data/'),
    },
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
      // Observability WebSocket (v9.1)
      '/api/observability/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
