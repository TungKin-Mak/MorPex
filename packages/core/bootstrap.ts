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
import { RuntimeKernelIntegrator } from './src/runtime/RuntimeKernelIntegrator.js';
import { ArtifactPlugin } from './src/planes/knowledge-plane/artifacts/plugin.js';
import { KnowledgeGraphPlugin } from './src/planes/knowledge-plane/knowledge/plugin.js';
import { MemoryActivationEngine } from './src/memory/MemoryActivationEngine.js';

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

  // 3. 注册知识层插件（Phase 3/7）
  kernel.registerPlugin(new ArtifactPlugin());
  kernel.registerPlugin(new KnowledgeGraphPlugin());

  // 4. 启动内核（EventBus → Mirror → Gateway → Plugins）
  await kernel.start();

  // 5. 挂载 Runtime Kernel v2（ExecutionFSM + DAG + Checkpoint/Recovery）
  const runtimeIntegrator = new RuntimeKernelIntegrator({ maxParallel: 4 });
  runtimeIntegrator.mountToKernel(kernel);

  // 6. Phase 13: MemoryActivationEngine (保留实例供后续使用)
  // Gateway 不再直接持有 MemoryEngine 引用；通过 EventBus 通信
  const memoryEngine = new MemoryActivationEngine();
  console.log('  ├─ Memory: ActivationEngine initialized (Phase 13)');

  console.log('[MorPexCore] ✅ 已集成');
  console.log(`  ├─ Gateway: ${kernel.gateway.getAdapterNames().join(', ')}`);
  console.log(`  ├─ Mirror: ${kernel.mirror.isRunning() ? '运行中' : '已停止'}`);
  console.log(`  ├─ Runtime: FSM + DAG + Checkpoint/Recovery`);
  console.log(`  ├─ Memory: ActivationEngine active (Phase 13)`);
  console.log(`  └─ 存储: ${config?.mirrorBasePath ?? './data/mirror'}`);
  return kernel;
}
