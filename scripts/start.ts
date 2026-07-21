#!/usr/bin/env npx tsx
/**
 * start.ts — MorPex 开发服务器启动器
 *
 * 统一入口，替代之前依赖的脚本。
 * 所有启动命令委托到这里。
 *
 * 用法:
 *   npx tsx scripts/start.ts               # 默认启动后端
 *   npx tsx scripts/start.ts --no-embed     # 不启动 embedding server
 *   npx tsx scripts/start.ts --prod         # 生产模式（需先 studio:build）
 *   npx tsx scripts/start.ts --status       # 查看 PM2 状态
 *   npx tsx scripts/start.ts stop           # 停止 PM2 进程
 *
 * 环境变量:
 *   PORT        — HTTP 端口（默认 8080）
 *   MIRROR_PATH — Mirror 存储路径（默认 ./data/mirror）
 */

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const isStop = args.includes('stop');
const isStatus = args.includes('--status');
const isProd = args.includes('--prod');
const noEmbed = args.includes('--no-embed');

async function main(): Promise<void> {
  // ── stop: PM2 stop ──
  if (isStop) {
    console.log('[start] 停止所有 PM2 进程...');
    execSync('pm2 stop all', { stdio: 'inherit' });
    return;
  }

  // ── status: PM2 status ──
  if (isStatus) {
    execSync('pm2 status', { stdio: 'inherit' });
    return;
  }

  // ── prod: 生产模式（PM2 + 预先构建的前端）──
  if (isProd) {
    console.log('[start] 生产模式启动...');
    const cmd = noEmbed
      ? 'pm2 start configs/pm2-ecosystem.config.cjs --only morpex-backend,morpex-ui'
      : 'pm2 start configs/pm2-ecosystem.config.cjs';
    execSync(cmd, { stdio: 'inherit' });
    return;
  }

  // ── 开发模式: 直接用 tsx 启动 StudioServer ──
  const embedArgs: string[] = [];
  if (noEmbed) embedArgs.push('--no-embed');

  console.log('[start] 开发模式: 启动 StudioServer...');
  console.log(`  PORT=${process.env.PORT || '8080'}`);
  console.log(`  MIRROR_PATH=${process.env.MIRROR_PATH || './data/mirror'}`);

  // 直接 import 并启动 StudioServer
  const { StudioServer } = await import('../packages/studio/server/StudioServer.js');

  const PORT = parseInt(process.env.PORT || '8080', 10);
  const MIRROR_PATH = process.env.MIRROR_PATH || './data/mirror';
  const FRONTEND_DIST = process.env.FRONTEND_DIST || './packages/studio/ui/dist';

  const studio = new StudioServer({
    port: PORT,
    mirrorBasePath: MIRROR_PATH,
    frontendDist: FRONTEND_DIST,
  });

  process.on('SIGINT', async () => {
    console.log('\n[start] 收到 SIGINT');
    await studio.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[start] 收到 SIGTERM');
    await studio.stop();
    process.exit(0);
  });

  try {
    await studio.start();
    console.log(`[start] 🚀 Studio 服务器运行在 http://localhost:${PORT}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[start] ❌ 启动失败:', message);
    process.exit(1);
  }
}

main();
