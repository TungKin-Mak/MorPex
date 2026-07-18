/**
 * PM2 Ecosystem — 全栈 TS 集群配置
 *
 * 用途:
 *   pm2 start ecosystem.config.ts       ← 一键启动全栈
 *   pm2 stop ecosystem.config.ts        ← 一键停止
 *   pm2 logs                             ← 看日志
 *   pm2 monit                            ← 实时监控 CPU/内存
 *
 * Agent 也可通过 PM2 编程化 API 在代码中控制集群：
 *   import pm2 from 'pm2';
 *   pm2.connect(() => pm2.start(require('./ecosystem.config'), ...));
 */

export default {
  apps: [
    {
      name: 'morpex-be',
      script: 'src/main.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      cwd: './',
      env: {
        PORT: '8080',
        HOST: '0.0.0.0',
      },
      // 自动重启策略
      max_restarts: 5,
      restart_delay: 2000,
      min_uptime: '10s',
      // 日志
      error_file: './logs/be-error.log',
      out_file: './logs/be-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'morpex-fe',
      script: 'node_modules/vite/bin/vite.js',
      cwd: './studio/ui',
      env: {
        PORT: '5173',
      },
      max_restarts: 5,
      restart_delay: 2000,
      error_file: './logs/fe-error.log',
      out_file: './logs/fe-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
