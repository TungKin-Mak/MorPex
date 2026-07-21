/**
 * PM2 Ecosystem — MorPex v2.0 全栈进程管理
 *
 * 架构:
 *   morpex-embed    (Embedding Server, Python BGE-M3, 端口 3100)
 *   morpex-backend  (StudioServer + MorPexCore, 端口 8080)
 *   morpex-ui       (Vite 前端开发服务器, 端口 3000)
 *
 * zvec 安全:
 *   - ZVecOpen 自动检测 crash residue（30/30 SIGKILL 测试通过）
 *   - kill_timeout 给足时间让 zvec 安全落盘
 *   - 三级降级：Open → Create → Backup+重建
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
    // ── Embedding Server (Python BGE-M3) ──
    {
      name: 'morpex-embed',
      script: 'tools-python/embedding-server.py',
      interpreter: isWin ? 'python' : 'python3',
      interpreterArgs: '-u',
      args: '--model-path data/models/bge-m3 --mode http --port 3100',
      cwd: __dirname + '/..',
      env: { PYTHONUNBUFFERED: '1' },
      autorestart: true,
      max_restarts: 3,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/embed-error.log',
      out_file: './logs/embed-out.log',
      merge_logs: true,
      kill_timeout: 15000,
      wait_ready: true,
      listen_timeout: 30000,
    },

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
