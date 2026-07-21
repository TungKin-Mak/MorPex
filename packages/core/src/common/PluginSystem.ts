/**
 * PluginSystem — 插件注册、生命周期、依赖管理
 *
 * 管理插件的完整生命周期：register → initialize → start → running → stop
 *
 * 设计约束：
 *   - 启动顺序按依赖拓扑排序
 *   - 禁止循环依赖
 *   - 插件间禁止直接 import（只能通过 EventBus 通信）
 *   - 最后实现（先固化 Kernel Contract，再定义插件生命周期）
 */

import type { MorPexPlugin, PluginContext, EventBus } from './types.js';
import type { ExecutionIdentity } from './ExecutionIdentity.js';
import { topologicalSort as tsort } from '../utils/toposort.js';

/** 插件状态 */
type PluginStatus = 'registered' | 'initialized' | 'running' | 'stopped' | 'error';

/** 插件注册记录 */
interface PluginRecord {
  plugin: MorPexPlugin;
  status: PluginStatus;
  registeredAt: number;
  error?: string;
}

/**
 * PluginSystem — 插件系统
 *
 * 职责：
 *   - 插件注册与查询
 *   - 依赖拓扑排序与验证
 *   - 生命周期管理（initialize → start → stop）
 *   - 循环依赖检测
 */
export class PluginSystem {
  private plugins: Map<string, PluginRecord> = new Map();
  private eventBus: EventBus;
  private executionIdentity: ExecutionIdentity;
  private config: Record<string, unknown> = {};
  /** 防重入锁定标志 */
  private _starting = false;
  private _stopping = false;

  constructor(eventBus: EventBus, executionIdentity: ExecutionIdentity) {
    this.eventBus = eventBus;
    this.executionIdentity = executionIdentity;
  }

  /**
   * 注册一个插件
   *
   * @param plugin - 实现 MorPexPlugin 接口的插件实例
   * @throws 如果插件名已存在或依赖未注册
   */
  register(plugin: MorPexPlugin): void {
    // 检查名称冲突
    if (this.plugins.has(plugin.name)) {
      throw new Error(`[PluginSystem] 插件 "${plugin.name}" 已注册`);
    }

    // 检查依赖是否已注册
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `[PluginSystem] 插件 "${plugin.name}" 依赖 "${dep}" 未注册。请先注册依赖插件。`
          );
        }
      }
    }

    this.plugins.set(plugin.name, {
      plugin,
      status: 'registered',
      registeredAt: Date.now(),
    });

    console.log(`[PluginSystem] 已注册插件: ${plugin.name}@${plugin.version}`);
  }

  /**
   * 获取已注册的插件
   */
  get(name: string): MorPexPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /**
   * 获取所有已注册的插件
   */
  getAll(): MorPexPlugin[] {
    return [...this.plugins.values()].map(r => r.plugin);
  }

  /**
   * 启动所有插件（按依赖拓扑排序）
   *
   * 启动流程：
   *   1. 拓扑排序（按依赖关系）
   *   2. 依次调用 initialize()
   *   3. 依次调用 start()
   *
   * 防重入：使用 _starting 标志防止并发调用导致双重初始化。
   */
  async startAll(): Promise<void> {
    if (this._starting) {
      console.warn('[PluginSystem] startAll() 正在执行中，跳过重复调用');
      return;
    }
    this._starting = true;
    try {
      const sorted = this.topologicalSort();

      // 1. 初始化所有插件
      console.log('[PluginSystem] 开始初始化插件...');
      for (const plugin of sorted) {
        await this.initializePlugin(plugin);
      }

      // 2. 启动所有插件
      console.log('[PluginSystem] 开始启动插件...');
      for (const plugin of sorted) {
        await this.startPlugin(plugin);
      }

      console.log(`[PluginSystem] 所有 ${sorted.length} 个插件已启动`);
    } finally {
      this._starting = false;
    }
  }

  /**
   * 停止所有插件（逆序）
   *
   * 防重入：使用 _stopping 标志防止并发调用。
   */
  async stopAll(): Promise<void> {
    if (this._stopping) {
      console.warn('[PluginSystem] stopAll() 正在执行中，跳过重复调用');
      return;
    }
    this._stopping = true;
    try {
      const sorted = this.topologicalSort();

      // 逆序停止
      for (const plugin of sorted.reverse()) {
        await this.stopPlugin(plugin);
      }

      console.log('[PluginSystem] 所有插件已停止');
    } finally {
      this._stopping = false;
    }
  }

  /**
   * 检查依赖是否满足
   */
  checkDependencies(name: string): boolean {
    const record = this.plugins.get(name);
    if (!record) return false;

    const deps = record.plugin.dependencies;
    if (!deps || deps.length === 0) return true;

    return deps.every(dep => {
      const depRecord = this.plugins.get(dep);
      return depRecord && depRecord.status !== 'error';
    });
  }

  /**
   * 获取所有插件状态
   */
  getStatus(): Array<{ name: string; status: string; version: string; error?: string }> {
    return [...this.plugins.values()].map(r => ({
      name: r.plugin.name,
      status: r.status,
      version: r.plugin.version,
      error: r.error,
    }));
  }

  /**
   * 获取插件数量
   */
  get count(): number {
    return this.plugins.size;
  }

  /**
   * 初始化单个插件
   */
  private async initializePlugin(plugin: MorPexPlugin): Promise<void> {
    const record = this.plugins.get(plugin.name)!;

    try {
      const context: PluginContext = {
        eventBus: this.eventBus,
        executionIdentity: this.executionIdentity,
        config: this.config,
      };

      await plugin.initialize(context);
      record.status = 'initialized';
      console.log(`[PluginSystem] 已初始化: ${plugin.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      console.error(`[PluginSystem] 初始化失败: ${plugin.name}:`, err.message);
      throw err;
    }
  }

  /**
   * 启动单个插件
   */
  private async startPlugin(plugin: MorPexPlugin): Promise<void> {
    const record = this.plugins.get(plugin.name)!;

    try {
      await plugin.start();
      record.status = 'running';
      console.log(`[PluginSystem] 已启动: ${plugin.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      console.error(`[PluginSystem] 启动失败: ${plugin.name}:`, err.message);
      throw err;
    }
  }

  /**
   * 停止单个插件
   */
  private async stopPlugin(plugin: MorPexPlugin): Promise<void> {
    const record = this.plugins.get(plugin.name)!;

    try {
      await plugin.stop();
      record.status = 'stopped';
      console.log(`[PluginSystem] 已停止: ${plugin.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      console.error(`[PluginSystem] 停止失败: ${plugin.name}:`, err.message);
    }
  }

  /**
   * 拓扑排序（按依赖关系）
   *
   * 复用 packages/core/utils/toposort.ts 统一实现。
   * 系统内所有拓扑排序必须强制复用该工具函数。
   *
   * @returns 按依赖顺序排列的插件列表
   * @throws 如果存在循环依赖
   */
  private topologicalSort(): MorPexPlugin[] {
    const plugins = [...this.plugins.values()].map(r => r.plugin);
    const sorted = tsort(plugins, p => p.dependencies ?? [], p => p.name);
    if (sorted.length < plugins.length) {
      throw new Error('[PluginSystem] 检测到循环依赖，无法排序');
    }
    return sorted;
  }
}
