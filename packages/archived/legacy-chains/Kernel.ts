/**
 * MorPexKernel — MorPexCore 生命周期管理
 *
 * 系统唯一入口，负责初始化所有核心组件并协调生命周期。
 *
 * 启动流程：
 *   Kernel.start()
 *     ├── 创建 EventBus
 *     ├── 创建 ExecutionIdentity
 *     ├── 创建 ExecutionGateway
 *     ├── 注册 PiAdapter 到 Gateway
 *     ├── 创建 JSONLStorage
 *     ├── 创建 ExecutionMirror → mirror.start()
 *     ├── 创建 PluginSystem
 *     ├── 注册所有插件 → PluginSystem.startAll()
 *     └── 标记 phase = 'running'
 *
 * 设计约束：
 *   - Kernel 不做业务逻辑（只做初始化、生命周期、状态管理）
 *   - 所有组件通过 EventBus 通信
 */

import type {
  MorPexPlugin,
  KernelStatus,
  EventBus as EventBusInterface,
  ExecutionIdentity as ExecutionIdentityType,
} from './types.js';
import type { KernelConfig as BaseKernelConfig } from './types.js';
import { EventBus } from './EventBus.js';
import { ExecutionIdentity } from './ExecutionIdentity.js';
import { PluginSystem } from './PluginSystem.js';
import { ExecutionGateway } from '../gateway/ExecutionGateway.js';
import { PiAdapter } from '../gateway/adapters/PiAdapter.js';
// ★ NEW: Contract-based adapter routing
import { ContractGateway } from '../gateway/ContractGateway.js';
import { PiAdapterBridge } from '../gateway/PiAdapterBridge.js';
import { ExecutionMirror } from '../mirror/ExecutionMirror.js';
import { JSONLStorage } from '../mirror/storage/JSONLStorage.js';
import { EventStore } from '../event/EventStore.js';
import { EngineSubscriber } from '../engine/engine-subscriber.js';

/**
 * MorPexKernel — MorPexCore 内核
 *
 * 统一管理所有核心组件的生命周期。
 * 使用 Strangler Architecture 模式，不修改现有代码。
 */
/** Kernel 配置（含可选的 piRuntime） */
export interface KernelConfig extends BaseKernelConfig {
  piRuntime?: any;
  /** Optional contract-based AgentRuntimePort adapter (for migration to new architecture) */
  agentRuntimePort?: import('@morpex/contracts/agent-runtime').AgentRuntimePort;
}

export class MorPexKernel {
  private _eventBus: EventBus;
  private _executionIdentity: ExecutionIdentity;
  private _pluginSystem: PluginSystem;
  private _gateway: ExecutionGateway;
  private _mirror: ExecutionMirror;
  private _storage: JSONLStorage;
  private _piAdapter: PiAdapter | null = null;
  // ★ NEW: Contract-based gateway
  private _contractGateway: ContractGateway | null = null;

  /** 公开访问 PiAdapter（供 StudioServer 包装 interceptor 等扩展使用） */
  get piAdapter(): PiAdapter | null { return this._piAdapter; }

  /** ★ NEW: Contract-based gateway */
  get contractGateway(): ContractGateway | null { return this._contractGateway; }

  private _phase: KernelStatus['phase'] = 'init';
  private _startTime: number = 0;
  private _config: KernelConfig;

  constructor(config?: KernelConfig) {
    this._config = config ?? {};

    // Phase 0: 创建核心组件（不启动）
    this._eventBus = new EventBus();
    this._executionIdentity = new ExecutionIdentity();
    this._pluginSystem = new PluginSystem(this._eventBus, this._executionIdentity);
    this._storage = new JSONLStorage(config?.mirrorBasePath);
    this._mirror = new ExecutionMirror(this._storage);
    this._gateway = new ExecutionGateway(this._eventBus, this._executionIdentity);
    // ★ NEW: Initialize contract gateway
    this._contractGateway = new ContractGateway();

    // 初始化事件溯源桥接（引擎事件 → EventStore + MemoryBus）
    const eventStore = new EventStore();
    new EngineSubscriber({ eventBus: this._eventBus, eventStore });

    console.log('[Kernel] 核心组件已创建（含引擎事件溯源），等待 start()');
  }

  /**
   * 启动 Kernel
   *
   * 完整启动流程：
   *   1. 初始化存储层
   *   2. 创建并注册 PiAdapter
   *   3. 启动 Mirror（开始记录事件）
   *   4. 注册预配置的插件
   *   5. 启动所有插件
   *   6. 标记为 running
   */
  async start(): Promise<void> {
    if (this._phase !== 'init') {
      throw new Error(`[Kernel] 无法启动：当前状态为 "${this._phase}"，仅允许从 "init" 启动`);
    }

    this._phase = 'starting';
    this._startTime = Date.now();
    console.log('[Kernel] 正在启动...');

    try {
      // 1. 初始化存储
      console.log('[Kernel] 初始化存储层...');
      await this._storage.initialize();

      // 2. 注册 PiAdapter（包装 AgentRuntime）
      //    注意：PiAdapter 需要外部传入 AgentRuntime 实例
      //    如果没有传入，Gateway 仍可工作但 PiAdapter 不可用
      if (this._config.piRuntime) {
        console.log('[Kernel] 注册 PiAdapter...');
        this._piAdapter = new PiAdapter(
          this._config.piRuntime,
          this._eventBus,
          { runtimeName: 'pi', version: '1.8.0' },
          this._executionIdentity,
        );
        this._gateway.registerAdapter('pi', this._piAdapter, true);

        // ★ NEW: Also register contract-based bridge
        const bridge = new PiAdapterBridge(this._piAdapter);
        this._contractGateway!.register('pi-bridge', bridge);
        this._contractGateway!.setDefaultAdapter('pi-bridge');
        console.log('[Kernel] 注册 ContractGateway PiAdapterBridge...');
      } else if (!this._piAdapter) {
        console.log('[Kernel] 信息: PiAdapter 将通过 registerPiRuntime() 延迟注册');
      } else {
        console.log('[Kernel] PiAdapter 已通过 registerPiRuntime() 注册');
      }

      // ★ NEW: Register agent runtime port if provided
      if (this._config.agentRuntimePort) {
        console.log('[Kernel] 注册 ContractGateway AgentRuntimePort...');
        this._contractGateway!.register('agent', this._config.agentRuntimePort);
        this._contractGateway!.setDefaultAdapter('agent');
      }

      // 3. 启动 Mirror
      console.log('[Kernel] 启动 ExecutionMirror...');
      this._mirror.start((type, handler) => this._eventBus.on(type, handler));

      // 4. 注册预配置的插件（已在 registerPlugin 中注册的不重复注册）
      const configPlugins = this._config.plugins ?? [];
      for (const plugin of configPlugins) {
        // 避免重复注册
        if (!this._pluginSystem.get(plugin.name)) {
          this._pluginSystem.register(plugin);
        }
      }

      // 5. 启动所有已注册的插件（包括 registerPlugin 预先注册的）
      const totalPlugins = this._pluginSystem.count;
      if (totalPlugins > 0) {
        console.log(`[Kernel] 启动 ${totalPlugins} 个插件...`);
        await this._pluginSystem.startAll();
      }

      // 6. 标记为 running
      this._phase = 'running';
      console.log(`[Kernel] 启动完成，耗时 ${Date.now() - this._startTime}ms`);
      console.log(`[Kernel] 状态: running | 插件数: ${this._pluginSystem.count} | 镜像: 运行中`);

      // 发射 Kernel 启动事件
      this._eventBus.emit({
        id: this._executionIdentity.createEventId(),
        type: 'kernel.started',
        timestamp: Date.now(),
        executionId: 'kernel',
        source: 'kernel',
        payload: {
          uptime: Date.now() - this._startTime,
          pluginCount: this._pluginSystem.count,
        },
      });

    } catch (err) {
      this._phase = 'stopped';
      console.error('[Kernel] 启动失败:', err);
      throw err;
    }
  }

  /**
   * 停止 Kernel
   *
   * 逆序停止：插件 → Mirror → Gateway
   */
  async stop(): Promise<void> {
    if (this._phase !== 'running') {
      console.warn(`[Kernel] 当前状态 "${this._phase}"，无需停止`);
      return;
    }

    this._phase = 'stopping';
    console.log('[Kernel] 正在停止...');

    try {
      // 1. 停止所有插件
      if (this._pluginSystem.count > 0) {
        console.log('[Kernel] 停止插件...');
        await this._pluginSystem.stopAll();
      }

      // 2. 停止 Mirror
      console.log('[Kernel] 停止 ExecutionMirror...');
      this._mirror.stop();

      // 3. 清理 PiAdapter
      if (this._piAdapter) {
        this._piAdapter.dispose();
        this._piAdapter = null;
      }

      // 4. 关闭存储
      console.log('[Kernel] 关闭存储...');
      await this._storage.close();

      this._phase = 'stopped';
      console.log('[Kernel] 已停止');

    } catch (err) {
      this._phase = 'stopped';
      console.error('[Kernel] 停止时发生错误:', err);
      // 即使发生错误也确保 EventBus 被清理
      throw err;
    } finally {
      // 确保 EventBus 监听器总被清理，防止监听器泄漏
      this._eventBus.clear();
    }
  }

  /**
   * 注册 pi AgentRuntime（延迟注册）
   *
   * 如果构造时未提供 AgentRuntime，可在启动后注册。
   *
   * @param runtime - AgentRuntime 实例
   */
  registerPiRuntime(runtime: any): void {
    if (this._piAdapter) {
      console.warn('[Kernel] PiAdapter 已注册，正在覆盖...');
      this._piAdapter.dispose();
    }

    this._piAdapter = new PiAdapter(
      runtime,
      this._eventBus,
      { runtimeName: 'pi', version: '1.8.0' },
      this._executionIdentity,
    );
    this._gateway.registerAdapter('pi', this._piAdapter, true);

    // ★ NEW: Also update contract gateway
    const bridge = new PiAdapterBridge(this._piAdapter);
    this._contractGateway!.register('pi-bridge', bridge);
    this._contractGateway!.setDefaultAdapter('pi-bridge');

    console.log('[Kernel] PiRuntime 已注册');
  }

  /**
   * 注册插件
   */
  registerPlugin(plugin: MorPexPlugin): void {
    if (this._phase === 'running') {
      // 运行时注册需要立即初始化并启动
      this._pluginSystem.register(plugin);
      this._pluginSystem.startAll().catch(err => {
        console.error(`[Kernel] 运行时注册插件失败:`, err);
      });
    } else {
      this._pluginSystem.register(plugin);
    }
  }

  get eventBus(): EventBus {
    return this._eventBus;
  }

  get executionIdentity(): ExecutionIdentity {
    return this._executionIdentity;
  }

  get pluginSystem(): PluginSystem {
    return this._pluginSystem;
  }

  get gateway(): ExecutionGateway {
    return this._gateway;
  }

  get mirror(): ExecutionMirror {
    return this._mirror;
  }

  get storage(): JSONLStorage {
    return this._storage;
  }

  /**
   * 获取当前状态
   */
  /**
   * getHealthEndpoint — 健康检查端点（v13 governance）
   * 返回内核及各模块健康状态
   */
  getHealthEndpoint(): { status: string; version: string; uptime: number; modules: Array<{ name: string; status: string }> } {
    const status = this.getStatus();
    const ebMetrics = this._eventBus.getMetrics ? this._eventBus.getMetrics() : null;
    return {
      status: status.phase,
      version: 'v13.0.0',
      uptime: status.uptime,
      modules: [
        { name: 'event-bus', status: ebMetrics && (ebMetrics.errorCount / Math.max(1, ebMetrics.totalEvents)) > 0.1 ? 'degraded' : 'healthy' },
        { name: 'plugin-system', status: this._pluginSystem.count > 0 ? 'healthy' : 'degraded' },
        { name: 'gateway', status: 'healthy' },
        { name: 'mirror', status: 'healthy' },
      ],
    };
  }

  getStatus(): KernelStatus {
    return {
      phase: this._phase,
      uptime: this._phase === 'running' ? Date.now() - this._startTime : 0,
      pluginCount: this._pluginSystem.count,
      activeExecutions: 0, // Phase 0 暂不追踪活跃执行数
    };
  }
}
