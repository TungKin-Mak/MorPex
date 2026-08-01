/**
 * ExtensionRegistry — 内核扩展注册中心
 *
 * 职责：
 *   1. 扩展注册与版本校验
 *   2. 依赖拓扑排序（复用全局 toposort 工具）
 *   3. 生命周期管理（initialize → start → stop）
 *   4. 循环依赖检测
 *   5. 一键 Disable 所有扩展
 *
 * 设计约束：
 *   - 零侵入现有引擎代码
 *   - 扩展间禁止直接 import（通过 registry.get() 查询）
 *   - 启动顺序按依赖拓扑排序
 *   - 线程安全（单线程 JS，无锁设计）
 *
 * 用法：
 *   const registry = new ExtensionRegistryImpl(eventBus, config);
 *   registry.register(new LineageTracker(config.lineageTracker));
 *   registry.register(new ContextPruner(config.contextPruner, lineageTracker));
 *   await registry.startAll();
 */

import { topologicalSort } from '../utils/toposort.js';
import type {
  ExtensionDefinition,
  ExtensionRegistry,
  ExtensionContext,
  ExtensionStatus,
  ExtensionLogger,
  KernelExtensionsConfig,
} from './types.js';
import { DEFAULT_EXTENSIONS_CONFIG } from './types.js';

// ═══════════════════════════════════════════════════════════════
// 扩展注册记录
// ═══════════════════════════════════════════════════════════════

interface ExtensionRecord {
  extension: ExtensionDefinition;
  status: 'registered' | 'initialized' | 'running' | 'stopped' | 'error';
  registeredAt: number;
  startedAt?: number;
  error?: string;
  metrics: Record<string, number | string>;
}

// ═══════════════════════════════════════════════════════════════
// 默认日志实现
// ═══════════════════════════════════════════════════════════════

class ConsoleLogger implements ExtensionLogger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = `[${prefix}]`;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`${this.prefix} ${message}`, meta ? JSON.stringify(meta) : '');
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`${this.prefix} ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`${this.prefix} ${message}`, meta ? JSON.stringify(meta) : '');
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`${this.prefix} ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ExtensionRegistryImpl
// ═══════════════════════════════════════════════════════════════

export class ExtensionRegistryImpl implements ExtensionRegistry {
  private extensions: Map<string, ExtensionRecord> = new Map();
  private config: KernelExtensionsConfig;
  private eventBus: ExtensionContext['eventBus'];
  private _logger: ConsoleLogger;
  private _starting = false;
  private _stopping = false;

  constructor(
    eventBus: ExtensionContext['eventBus'],
    config?: Partial<KernelExtensionsConfig>,
  ) {
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_EXTENSIONS_CONFIG, ...config };
    this._logger = new ConsoleLogger('ExtensionRegistry');
  }

  // ── 注册 ──

  /**
   * register — 注册一个扩展
   *
   * @throws 如果扩展名重复或依赖缺失
   */
  register(extension: ExtensionDefinition): void {
    if (this.extensions.has(extension.name)) {
      throw new Error(
        `[ExtensionRegistry] 扩展 "${extension.name}" 已注册，不允许重复`,
      );
    }

    // 校验依赖
    if (extension.dependencies) {
      for (const dep of extension.dependencies) {
        if (!this.extensions.has(dep)) {
          throw new Error(
            `[ExtensionRegistry] 扩展 "${extension.name}" 依赖 "${dep}"，但 "${dep}" 未注册。请先注册依赖扩展。`,
          );
        }
      }
    }

    this.extensions.set(extension.name, {
      extension,
      status: 'registered',
      registeredAt: Date.now(),
      metrics: {},
    });

    this._logger.info(`已注册扩展: ${extension.name}@${extension.version}`);
  }

  /**
   * get — 获取已注册的扩展
   */
  get<T extends ExtensionDefinition>(name: string): T | undefined {
    const record = this.extensions.get(name);
    return record?.extension as T | undefined;
  }

  /**
   * getAll — 获取所有已注册的扩展
   */
  getAll(): ExtensionDefinition[] {
    return [...this.extensions.values()].map(r => r.extension);
  }

  /**
   * get count — 获取已注册扩展数量
   */
  get count(): number {
    return this.extensions.size;
  }

  // ── 生命周期 ──

  /**
   * startAll — 启动所有扩展
   *
   * 执行流程：
   *   1. 按依赖拓扑排序
   *   2. 依次调用 initialize()
   *   3. 依次调用 start()
   *   4. 发射 kernel.extensions.started 事件
   *
   * 如果 globallyEnabled = false，跳过所有扩展。
   * 单个扩展的 enabled = false 也会跳过。
   */
  async startAll(): Promise<void> {
    if (!this.config.globallyEnabled) {
      this._logger.info('全局扩展已禁用（globallyEnabled=false），跳过启动');
      return;
    }

    if (this._starting) {
      this._logger.warn('startAll() 正在执行中，跳过重复调用');
      return;
    }

    this._starting = true;
    try {
      const sorted = this.topologicalSortExtensions();

      const enabledExtensions = sorted.filter(e => e.extension.enabled);
      if (enabledExtensions.length === 0) {
        this._logger.info('没有启用的扩展需要启动');
        return;
      }

      this._logger.info(`开始初始化 ${enabledExtensions.length} 个扩展...`);

      // Phase 1: 初始化
      for (const record of enabledExtensions) {
        await this.initializeExtension(record);
      }

      // Phase 2: 启动
      this._logger.info('开始启动扩展...');
      for (const record of enabledExtensions) {
        await this.startExtension(record);
      }

      this._logger.info(`所有 ${enabledExtensions.length} 个扩展已启动`);

      this.eventBus.emit({
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'kernel.extensions.started',
        timestamp: Date.now(),
        executionId: 'kernel',
        source: 'extension-registry',
        payload: {
          extensionNames: enabledExtensions.map(r => r.extension.name),
          count: enabledExtensions.length,
        },
      });
    } finally {
      this._starting = false;
    }
  }

  /**
   * stopAll — 停止所有扩展（逆序）
   */
  async stopAll(): Promise<void> {
    if (this._stopping) {
      this._logger.warn('stopAll() 正在执行中，跳过重复调用');
      return;
    }

    this._stopping = true;
    try {
      const sorted = this.topologicalSortExtensions();
      const runningExtensions = sorted.filter(
        r => r.status === 'running' || r.status === 'initialized',
      );

      if (runningExtensions.length === 0) {
        this._logger.info('没有运行中的扩展需要停止');
        return;
      }

      // 逆序停止
      for (const record of runningExtensions.reverse()) {
        await this.stopExtension(record);
      }

      this._logger.info('所有扩展已停止');
    } finally {
      this._stopping = false;
    }
  }

  // ── 状态查询 ──

  /**
   * getStatus — 获取所有扩展状态
   */
  getStatus(): Array<{ name: string; enabled: boolean; status: string }> {
    return [...this.extensions.values()].map(r => ({
      name: r.extension.name,
      enabled: r.extension.enabled,
      status: r.status,
    }));
  }

  /**
   * isGloballyEnabled — 全局扩展开关是否开启
   */
  isGloballyEnabled(): boolean {
    return this.config.globallyEnabled;
  }

  /**
   * updateConfig — 运行时更新配置
   */
  updateConfig(partial: Partial<KernelExtensionsConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ═══════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════

  /**
   * topologicalSortExtensions — 按依赖拓扑排序扩展
   *
   * 复用全局 toposort 工具，遵循 DRY 原则。
   */
  private topologicalSortExtensions(): ExtensionRecord[] {
    const records = [...this.extensions.values()];
    const sorted = topologicalSort(
      records,
      r => r.extension.dependencies ?? [],
      r => r.extension.name,
    );

    if (sorted.length < records.length) {
      this._logger.error('检测到循环依赖，部分扩展无法排序');
      throw new Error('[ExtensionRegistry] 扩展依赖图中存在循环依赖');
    }

    return sorted;
  }

  /**
   * createContext — 为扩展创建上下文
   */
  private createContext(extension: ExtensionDefinition): ExtensionContext {
    return {
      eventBus: this.eventBus,
      config: this.config as unknown as Record<string, unknown>,
      registry: this,
      logger: new ConsoleLogger(extension.name),
    };
  }

  /**
   * initializeExtension — 初始化单个扩展
   */
  private async initializeExtension(record: ExtensionRecord): Promise<void> {
    try {
      const ctx = this.createContext(record.extension);
      await record.extension.initialize(ctx);
      record.status = 'initialized';
      this._logger.debug(`已初始化: ${record.extension.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      this._logger.error(`初始化失败: ${record.extension.name}`, { error: err.message });
      throw err;
    }
  }

  /**
   * startExtension — 启动单个扩展
   */
  private async startExtension(record: ExtensionRecord): Promise<void> {
    try {
      await record.extension.start();
      record.status = 'running';
      record.startedAt = Date.now();
      this._logger.debug(`已启动: ${record.extension.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      this._logger.error(`启动失败: ${record.extension.name}`, { error: err.message });
      throw err;
    }
  }

  /**
   * stopExtension — 停止单个扩展
   */
  private async stopExtension(record: ExtensionRecord): Promise<void> {
    try {
      await record.extension.stop();
      record.status = 'stopped';
      this._logger.debug(`已停止: ${record.extension.name}`);
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      this._logger.error(`停止失败: ${record.extension.name}`, { error: err.message });
      // 停止失败不抛出，确保其他扩展仍能被停止
    }
  }
}
