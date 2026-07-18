import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  /* 💡 核心安全规约：涉及 zvec 底层 C++ 存储引擎物理文件锁，必须关闭并行，严防数据死锁 */
  fullyParallel: false,
  /* 针对多实例抢占锁引发的 manifest 损坏，1 个用例失败后立即熔断，防止污染数据库 */
  maxFailures: 1,
  /* 考虑到大模型执行多 Agent 拍卖、DAG 编排推理、5层记忆召回的耗时，单次测试超时设为 3 分钟 */
  timeout: 180000,
  expect: { timeout: 10000 },
  reporter: [['html', { open: 'never' }]],
  
  use: {
    baseURL: 'http://localhost:3000', // 映射你本地前端 Studio 的启动端口
    trace: 'retain-on-failure',       // 仅在失败时保留 Time-Travel 轨迹
    screenshot: 'only-on-failure',    // 失败时自动截图留证
    video: 'on-first-retry',
    launchOptions: {
      args: [
        '--use-angle=d3d11',          // 针对 Windows 环境强制调用原生 DirectX11
        '--enable-gpu-rasterization', // 激活 GPU 光栅化，确保 Three.js 3D 大脑满帧渲染
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    }
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],
});
