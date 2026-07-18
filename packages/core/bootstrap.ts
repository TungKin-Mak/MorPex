/**
 * MorPexCore Bootstrap — 端到端集成引导
 *
 * 使用方式：
 *   import { bootstrapMorPexCore } from './morpex-core/bootstrap.js';
 *   const kernel = await bootstrapMorPexCore(runtime);
 *
 * 架构（v3.0 微内核）：
 *   Kernel.start()
 *     ├── EventBus + EventStore + EngineSubscriber（事件溯源）
 *     ├── ExecutionMirror（执行轨迹）
 *     ├── ExecutionGateway + PiAdapter（Agent 运行时）
 *     └── PluginSystem（插件）
 */

import { MorPexKernel } from './src/common/Kernel.js';
import type { KernelConfig as _KernelConfig } from './src/common/Kernel.js';
import { setAgentFactory, AgentFactory } from './src/services/AgentFactory.js';

/** AgentRuntime 接口（来自 @earendil-works/pi-agent-core） */
interface AgentRuntime {
  bus?: { on: (event: string, handler: (payload: any) => void) => () => void };
  run: (input: any) => Promise<{ text?: string; toolCalls?: Array<{ name: string }> }>;
  abort: () => Promise<void>;
}

export interface BootstrapConfig extends _KernelConfig {}

/**
 * 在现有 AgentRuntime 上启动 MorPexCore
 */
export async function bootstrapMorPexCore(
  runtime: AgentRuntime,
  config?: BootstrapConfig,
): Promise<MorPexKernel> {
  // 1. 初始化 AgentFactory 单例（三段 Agent 体系入口）
  setAgentFactory(new AgentFactory());

  // 2. 创建并配置内核
  const kernel = new MorPexKernel(config);
  kernel.registerPiRuntime(runtime);

  // 3. 启动内核（EventBus → Mirror → Gateway → Plugins）
  await kernel.start();

  console.log('[MorPexCore] ✅ 已集成');
  console.log(`  ├─ Gateway: ${kernel.gateway.getAdapterNames().join(', ')}`);
  console.log(`  ├─ Mirror: ${kernel.mirror.isRunning() ? '运行中' : '已停止'}`);
  console.log(`  └─ 存储: ${config?.mirrorBasePath ?? './data/mirror'}`);
  return kernel;
}
