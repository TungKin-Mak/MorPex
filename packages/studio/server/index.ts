/**
 * Studio Server — 入口文件
 *
 * 启动 MorPexCore Kernel + StudioServer 桥接层
 *
 * 使用方式：
 *   npx tsx packages/studio/server/index.ts
 *
 * 环境变量：
 *   PORT        — HTTP 端口（默认 8080）
 *   MIRROR_PATH — Mirror 存储路径（默认 ./data/mirror）
 */

import { StudioServer } from './StudioServer.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const MIRROR_PATH = process.env.MIRROR_PATH || './data/mirror';
const FRONTEND_DIST = process.env.FRONTEND_DIST || './packages/studio/ui/dist';

async function main() {
  const studio = new StudioServer({
    port: PORT,
    mirrorBasePath: MIRROR_PATH,
    frontendDist: FRONTEND_DIST,
  });

  // 捕获停止信号
  process.on('SIGINT', async () => {
    console.log('\n[Studio] 收到 SIGINT');
    await studio.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Studio] 收到 SIGTERM');
    await studio.stop();
    process.exit(0);
  });

  try {
    await studio.start();
    console.log(`[Studio] 🚀 Studio 服务器运行在 http://localhost:${PORT}`);
    console.log(`[Studio]   前端构建: ${FRONTEND_DIST}`);
  } catch (err) {
    console.error('[Studio] ❌ 启动失败:', err);
    process.exit(1);
  }
}

main();
