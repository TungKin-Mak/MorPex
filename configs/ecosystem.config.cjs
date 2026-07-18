/**
 * PM2 Ecosystem — Morpex 生产部署配置
 *
 * 架构:
 *   storage-daemon (独立进程, 托管 zvec C++ Addon)
 *   └── morpex-backend (AI Agent 进程, 通过 IPC 访问 zvec)
 *       └── vite (前端 UI 服务)
 *
 * 启动:
 *   pm2 start ecosystem.config.cjs
 *
 * 查看状态:
 *   pm2 status
 *
 * 日志:
 *   pm2 logs morpex-store
 *   pm2 logs morpex-backend
 */

module.exports = {
  apps: [
    {
      name: 'morpex-store',
      script: 'src/memory/storage-daemon.ts',
      interpreter: 'npx',
      interpreterArgs: 'tsx',
      cwd: __dirname,
      env: {
        MORPEX_ZVEC_DB: './data/zvec',
        NODE_ENV: 'production',
      },
      // 致命崩溃时自动重启
      autorestart: true,
      // 最多重启 10 次，每次间隔 5s
      max_restarts: 10,
      restart_delay: 5000,
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/storage-daemon-error.log',
      out_file: './logs/storage-daemon-out.log',
      merge_logs: true,
      // 优雅关闭：给 10s 让 zvec 安全落盘释放 LOCK
      kill_timeout: 10000,
    },
    {
      name: 'morpex-backend',
      script: 'src/main.ts',
      interpreter: 'npx',
      interpreterArgs: 'tsx',
      cwd: __dirname,
      env: {
        MORPEX_DAEMON_MODE: 'true',
        NODE_ENV: 'production',
      },
      // 等存储守护进程就绪后再启动
      wait_ready: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      merge_logs: true,
      kill_timeout: 5000,
    },
    {
      name: 'morpex-ui',
      script: 'studio/ui/node_modules/.bin/vite',
      args: '--port 3000',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/ui-error.log',
      out_file: './logs/ui-out.log',
      kill_timeout: 5000,
    },
  ],
};
