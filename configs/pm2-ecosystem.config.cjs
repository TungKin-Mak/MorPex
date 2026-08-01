/**
 * PM2 Ecosystem — MorPex v2.0 全栈进程管理
 *
 * 架构:
 *   morpex-backend  (StudioServer + MorPexCore, 端口 8080)
 *   morpex-ui       (Vite 前端开发服务器, 端口 3000)
 *
 * 记忆引擎（cognee :8001）由 scripts/start-cognee.sh 独立管理，不入 PM2。
 *
 * 使用:
 *   pm2 start configs/pm2-ecosystem.config.cjs      # 首次启动全部
 *   ─────────────────────────────────────────────
 *   pm2 restart all                                 # 🔄 重启全部（改代码后执行）
 *   pm2 restart morpex-backend                      # 🔄 只重启后端
 *   pm2 restart morpex-ui                           # 🔄 只重启前端
 *   ─────────────────────────────────────────────
 *   pm2 status                                      # 查看状态
 *   pm2 logs                                        # 查看所有日志
 *   pm2 logs morpex-backend                         # 只看后端日志
 *   pm2 stop all                                    # 停止全部
 *   pm2 delete all                                  # 删除全部
 *   pm2 flush                                       # 清空日志
 */

const isWin = process.platform === 'win32';

module.exports = {
  apps: [
    // ── StudioServer 后端 (node --import tsx/esm) ──
    {
      name: 'morpex-backend',
      script: 'packages/studio/server/index.ts',
      interpreter: 'node',
      interpreterArgs: '--import tsx/esm',
      cwd: __dirname + '/..',
      env: {
        PORT: '8080',
        MIRROR_PATH: './data/mirror',
        FRONTEND_DIST: './packages/studio/ui/dist',
        NODE_ENV: 'production',
        MORPEX_DB_PATH: './data/morpex-events.db',
        MORPEX_EVENT_LOG_PATH: './data/events/event-store.jsonl',
        FORCE_COLOR: '1',
      },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      merge_logs: true,
      kill_timeout: 10000,
      // 等待端口就绪
      wait_ready: true,
      listen_timeout: 20000,
    },

    // ── Vite 前端 ──
    {
      name: 'morpex-ui',
      script: 'node_modules/vite/bin/vite.js',
      args: '--port 3000 --host',
      cwd: __dirname + '/../packages/studio/ui',
      interpreter: 'node',
      env: { NODE_ENV: 'development' },
      autorestart: true,
      max_restarts: 5,
      restart_delay: 2000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/ui-error.log',
      out_file: './logs/ui-out.log',
      merge_logs: true,
      kill_timeout: 3000,
    },
  ],
};
