/**
 * McpProcessGuard — MCP 看门狗与进程护卫
 *
 * 为每个通过 spawn 启动的 MCP 子进程包裹一层守护逻辑，
 * 实现毫秒级健康巡检、僵死检测、自动强杀与原位重启。
 *
 * 核心机制：
 *   1. Ping/Pong 心跳：定时向子进程发送 ping，超时未响应判定僵死
 *   2. Stdio 死锁检测：监控 stdin/stdout 管道，超时无活动判定死锁
 *   3. 崩溃自愈：检测到 exit/error 后自动强杀残留并原位拉起干净进程
 *   4. 熔断保护：连续重启超过上限后标记为 dead，防止无限重启风暴
 *   5. 状态暴露：实时提供 McpGuardState 供上层监控面板消费
 *
 * 集成方式（非侵入式）：
 *   不修改 McpRuntimeManager 的任何代码。通过组合模式，
 *   提供 guardSpawn() 替代直接调用 manager.spawn()。
 *
 *   const guard = new McpProcessGuard(manager, config);
 *   const client = await guard.guardSpawn('filesystem', 'npx', ['tsx', './handler.ts']);
 *   // client 与普通 McpClient 接口完全兼容
 *
 * 设计约束：
 *   - 零侵入 McpRuntimeManager.ts
 *   - 所有巡检异步非阻塞
 *   - 支持一键 Disable
 */

import * as crypto from 'node:crypto';
import type {
  ExtensionDefinition,
  ExtensionContext,
  ExtensionStatus,
  McpGuardConfig,
  McpGuardState,
} from './types.js';
import { DEFAULT_EXTENSIONS_CONFIG } from './types.js';
import type { McpClient, McpRuntimeManager } from '../mcp/McpRuntimeManager.js';

// ═══════════════════════════════════════════════════════════════
// 内部类型
// ═══════════════════════════════════════════════════════════════

interface GuardedEntry {
  name: string;
  client: McpClient;
  state: McpGuardState;
  pingTimer: NodeJS.Timeout | null;
  deadlockTimer: NodeJS.Timeout | null;
  restartCooldownUntil: number;
  /** 用于 stdio 死锁检测的最后活动时间 */
  lastActivity: number;
  /** 重启中标记，防止并发重启 */
  restarting: boolean;
}

/** spawn 参数快照，用于原位重启 */
interface SpawnSnapshot {
  name: string;
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxRestarts?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// McpProcessGuard
// ═══════════════════════════════════════════════════════════════

export class McpProcessGuard implements ExtensionDefinition {
  public readonly name = 'McpProcessGuard';
  public readonly version = '1.0.0';
  public readonly dependencies: string[] = [];

  private _enabled: boolean;
  private _config: McpGuardConfig;
  private _manager: McpRuntimeManager;
  private _context: ExtensionContext | null = null;
  private _unsubscribers: Array<() => void> = [];
  private _phase: ExtensionStatus['phase'] = 'uninitialized';
  private _startedAt: number | undefined;
  private _lastError: string | undefined;

  /** 守护注册表：name → GuardedEntry */
  private _guardRegistry = new Map<string, GuardedEntry>();

  /** spawn 快照：name → SpawnSnapshot（用于原位重启） */
  private _spawnSnapshots = new Map<string, SpawnSnapshot>();

  /** 全局巡检定时器 */
  private _globalProbeTimer: NodeJS.Timeout | null = null;

  constructor(
    manager: McpRuntimeManager,
    config?: Partial<McpGuardConfig>,
  ) {
    this._manager = manager;
    this._config = { ...DEFAULT_EXTENSIONS_CONFIG.mcpGuard!, ...config };
    this._enabled = this._config.enabled;
  }

  // ── ExtensionDefinition 实现 ──

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) this.stopAllGuards().catch(() => {});
  }

  async initialize(context: ExtensionContext): Promise<void> {
    this._context = context;
    this._phase = 'initialized';
    context.logger.info('McpProcessGuard 已初始化', {
      pingIntervalMs: this._config.pingIntervalMs,
      maxRestarts: this._config.maxRestarts,
      deadlockDetection: this._config.enableDeadlockDetection,
    });
  }

  async start(): Promise<void> {
    if (!this._context) throw new Error('McpProcessGuard 未初始化');

    this._phase = 'running';
    this._startedAt = Date.now();

    // 启动全局健康巡检
    this._globalProbeTimer = setInterval(() => {
      this.probeAllGuards().catch(err => {
        this._context?.logger.warn('全局巡检异常', { error: err.message });
      });
    }, this._config.pingIntervalMs);

    this._context.logger.info('McpProcessGuard 已启动');
  }

  async stop(): Promise<void> {
    this._phase = 'stopped';

    // 停止全局巡检
    if (this._globalProbeTimer) {
      clearInterval(this._globalProbeTimer);
      this._globalProbeTimer = null;
    }

    // 停止所有守护进程
    await this.stopAllGuards();

    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch { /* suppress */ }
    }
    this._unsubscribers = [];

    this._context?.logger.info('McpProcessGuard 已停止');
  }

  getStatus(): ExtensionStatus {
    return {
      name: this.name,
      enabled: this._enabled,
      phase: this._phase,
      startedAt: this._startedAt,
      uptime: this._startedAt ? Date.now() - this._startedAt : undefined,
      lastError: this._lastError,
      metrics: {
        guardedProcesses: this._guardRegistry.size,
        totalSpawns: this._manager.stats.totalSpawns,
        totalCrashes: this._manager.stats.totalCrashes,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 核心 API：guardSpawn — 替代 manager.spawn()
  // ═══════════════════════════════════════════════════════════

  /**
   * guardSpawn — 启动一个受守护的 MCP 边车进程
   *
   * 与 McpRuntimeManager.spawn() 签名完全兼容，
   * 返回的 McpClient 接口与普通 spawn 一致，对调用方透明。
   *
   * 额外行为：
   *   - 自动启动 Ping/Pong 心跳巡检
   *   - 自动启动 stdio 死锁检测
   *   - 崩溃后自动原位重启
   *
   * @returns McpClient（增强版，含守护逻辑）
   */
  async guardSpawn(
    name: string,
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      maxRestarts?: number;
    },
  ): Promise<McpClient> {
    if (!this._enabled) {
      // 禁用时直接透传到原生 spawn
      return this._manager.spawn(name, command, args, options);
    }

    // 保存 spawn 快照（用于重启）
    this._spawnSnapshots.set(name, { name, command, args, options });

    // 调用原生 spawn
    const rawClient = await this._manager.spawn(name, command, args, options);

    // 创建守护条目
    const entry: GuardedEntry = {
      name,
      client: rawClient,
      state: {
        name,
        status: 'healthy',
        restartCount: 0,
        consecutiveFailures: 0,
        lastPingAt: Date.now(),
        lastPongAt: Date.now(),
        avgLatencyMs: 0,
        pid: undefined,
        startTime: Date.now(),
      },
      pingTimer: null,
      deadlockTimer: null,
      restartCooldownUntil: 0,
      lastActivity: Date.now(),
      restarting: false,
    };

    this._guardRegistry.set(name, entry);

    // 启动针对该进程的 Ping 定时器
    this.startPingProbe(name);

    // 启动 stdio 死锁检测
    if (this._config.enableDeadlockDetection) {
      this.startDeadlockDetection(name);
    }

    this._context?.logger.info(`守护 MCP 进程: ${name}`, { command, args });

    // 返回包装后的客户端（拦截 close 以清理守护状态）
    return this.wrapClient(name, rawClient);
  }

  /**
   * guardShutdown — 安全关闭受守护的进程
   */
  async guardShutdown(name: string): Promise<void> {
    const entry = this._guardRegistry.get(name);
    if (entry) {
      this.stopGuardProbes(name);
      this._guardRegistry.delete(name);
    }
    this._spawnSnapshots.delete(name);

    try {
      await this._manager.shutdown(name);
    } catch (err: any) {
      this._context?.logger.warn(`关闭 MCP 进程失败: ${name}`, { error: err.message });
    }
  }

  /**
   * getGuardState — 获取指定进程的守护状态
   */
  getGuardState(name: string): McpGuardState | undefined {
    return this._guardRegistry.get(name)?.state;
  }

  /**
   * getAllGuardStates — 获取所有进程的守护状态
   */
  getAllGuardStates(): McpGuardState[] {
    return [...this._guardRegistry.values()].map(e => ({ ...e.state }));
  }

  // ═══════════════════════════════════════════════════════════
  // 健康巡检
  // ═══════════════════════════════════════════════════════════

  /**
   * startPingProbe — 启动针对单个进程的 Ping 定时器
   */
  private startPingProbe(name: string): void {
    const entry = this._guardRegistry.get(name);
    if (!entry) return;

    if (entry.pingTimer) {
      clearInterval(entry.pingTimer);
    }

    entry.pingTimer = setInterval(() => {
      this.pingGuard(name).catch(() => {});
    }, this._config.pingIntervalMs);

    // 不阻塞事件循环（Node.js ≥ 20 默认 unref，但显式设置更安全）
    if (entry.pingTimer && typeof entry.pingTimer.unref === 'function') {
      entry.pingTimer.unref();
    }
  }

  /**
   * pingGuard — 对单个进程执行 Ping 健康检查
   */
  private async pingGuard(name: string): Promise<void> {
    const entry = this._guardRegistry.get(name);
    if (!entry || entry.restarting) return;

    const startTime = Date.now();
    entry.state.lastPingAt = startTime;

    try {
      const pingPromise = entry.client.ping();

      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(
          () => reject(new Error('Ping 超时')),
          this._config.pingTimeoutMs,
        ),
      );

      const healthy = await Promise.race([pingPromise, timeoutPromise]);

      const latency = Date.now() - startTime;
      this.recordPong(name, healthy, latency);
    } catch {
      this.recordPong(name, false, Date.now() - startTime);
    }
  }

  /**
   * recordPong — 记录 Ping 结果并触发相应动作
   */
  private recordPong(name: string, healthy: boolean, latencyMs: number): void {
    const entry = this._guardRegistry.get(name);
    if (!entry) return;

    if (healthy) {
      entry.state.lastPongAt = Date.now();
      entry.state.consecutiveFailures = 0;
      entry.state.status = 'healthy';

      // 平滑平均延迟（指数移动平均）
      entry.state.avgLatencyMs =
        entry.state.avgLatencyMs === 0
          ? latencyMs
          : entry.state.avgLatencyMs * 0.7 + latencyMs * 0.3;

      // 更新最后活动时间（用于死锁检测）
      entry.lastActivity = Date.now();
    } else {
      entry.state.consecutiveFailures++;

      if (entry.state.consecutiveFailures >= this._config.maxConsecutiveFailures) {
        entry.state.status = 'unhealthy';
        this._context?.logger.warn(`MCP 进程不健康: ${name}`, {
          consecutiveFailures: entry.state.consecutiveFailures,
        });

        // 触发自愈重启
        this.triggerRestart(name).catch(err => {
          this._context?.logger.error(`自愈重启失败: ${name}`, { error: err.message });
        });
      } else {
        entry.state.status = 'degraded';
      }
    }
  }

  /**
   * probeAllGuards — 全局巡检所有守护进程
   */
  private async probeAllGuards(): Promise<void> {
    const names = [...this._guardRegistry.keys()];
    await Promise.allSettled(names.map(name => this.pingGuard(name)));
  }

  // ═══════════════════════════════════════════════════════════
  // Stdio 死锁检测
  // ═══════════════════════════════════════════════════════════

  /**
   * startDeadlockDetection — 启动 stdio 死锁检测
   *
   * 监控 lastActivity 时间戳。若超过 deadlockTimeoutMs 无活动，
   * 判定为 stdio 死锁，触发重启。
   */
  private startDeadlockDetection(name: string): void {
    const entry = this._guardRegistry.get(name);
    if (!entry) return;

    if (entry.deadlockTimer) {
      clearInterval(entry.deadlockTimer);
    }

    entry.deadlockTimer = setInterval(() => {
      const idleTime = Date.now() - entry.lastActivity;
      if (idleTime >= this._config.deadlockTimeoutMs && !entry.restarting) {
        this._context?.logger.error(`检测到 stdio 死锁: ${name}`, {
          idleTimeMs: idleTime,
          threshold: this._config.deadlockTimeoutMs,
        });
        entry.state.status = 'unhealthy';

        this.triggerRestart(name).catch(err => {
          this._context?.logger.error(`死锁重启失败: ${name}`, { error: err.message });
        });
      }
    }, this._config.deadlockTimeoutMs / 2);

    if (entry.deadlockTimer && typeof entry.deadlockTimer.unref === 'function') {
      entry.deadlockTimer.unref();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 自愈重启
  // ═══════════════════════════════════════════════════════════

  /**
   * triggerRestart — 触发进程自愈重启
   *
   * 执行流程：
   *   1. 检查冷却时间（防止无限重启风暴）
   *   2. 检查重启次数上限
   *   3. 强制杀死旧进程（SIGKILL）
   *   4. 清理旧守护状态
   *   5. 原位拉起新进程
   *   6. 恢复守护巡检
   */
  private async triggerRestart(name: string): Promise<void> {
    const entry = this._guardRegistry.get(name);
    if (!entry || entry.restarting) return;

    // 冷却检查
    if (Date.now() < entry.restartCooldownUntil) {
      this._context?.logger.debug(`重启冷却中: ${name}`, {
        cooldownRemaining: entry.restartCooldownUntil - Date.now(),
      });
      return;
    }

    // 上限检查
    if (entry.state.restartCount >= this._config.maxRestarts) {
      entry.state.status = 'dead';
      this._context?.logger.error(`MCP 进程已达最大重启次数: ${name}`, {
        restartCount: entry.state.restartCount,
        maxRestarts: this._config.maxRestarts,
      });

      // 发射不可恢复事件
      this._context?.eventBus.emit({
        id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        type: 'mcp.guard.dead',
        timestamp: Date.now(),
        executionId: 'kernel',
        source: 'mcp-process-guard',
        payload: {
          name,
          restartCount: entry.state.restartCount,
          reason: 'max_restarts_exceeded',
        },
      });
      return;
    }

    // 标记重启中
    entry.restarting = true;
    entry.state.status = 'restarting';
    entry.state.restartCount++;

    this._context?.logger.warn(`正在重启 MCP 进程: ${name} (第 ${entry.state.restartCount} 次)`);

    try {
      // 1. 停止旧守护巡检
      this.stopGuardProbes(name);

      // 2. 强制关闭旧进程
      try {
        await this._manager.shutdown(name);
      } catch {
        // 进程可能已经退出，忽略
      }

      // 3. 冷却计时
      entry.restartCooldownUntil = Date.now() + this._config.restartCooldownMs;

      // 4. 取 spawn 快照，原位拉起
      const snapshot = this._spawnSnapshots.get(name);
      if (!snapshot) {
        throw new Error(`缺少 spawn 快照: ${name}`);
      }

      const newClient = await this._manager.spawn(
        snapshot.name,
        snapshot.command,
        snapshot.args,
        snapshot.options,
      );

      // 5. 更新守护条目
      entry.client = newClient;
      entry.state.status = 'healthy';
      entry.state.consecutiveFailures = 0;
      entry.state.lastPingAt = Date.now();
      entry.state.lastPongAt = Date.now();
      entry.state.startTime = Date.now();
      entry.lastActivity = Date.now();

      // 6. 恢复巡检
      this.startPingProbe(name);
      if (this._config.enableDeadlockDetection) {
        this.startDeadlockDetection(name);
      }

      this._context?.logger.info(`MCP 进程重启成功: ${name}`);

      // 发射恢复事件
      this._context?.eventBus.emit({
        id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        type: 'mcp.guard.recovered',
        timestamp: Date.now(),
        executionId: 'kernel',
        source: 'mcp-process-guard',
        payload: {
          name,
          restartCount: entry.state.restartCount,
        },
      });
    } catch (err: any) {
      this._lastError = err.message;
      entry.state.status = 'unhealthy';
      this._context?.logger.error(`MCP 进程重启失败: ${name}`, { error: err.message });

      // 递归重试（如果未达上限）
      if (entry.state.restartCount < this._config.maxRestarts) {
        // 延迟后递归重试
        setTimeout(() => {
          entry.restarting = false;
          this.triggerRestart(name).catch(() => {});
        }, this._config.restartCooldownMs);
      } else {
        entry.state.status = 'dead';
      }
    } finally {
      entry.restarting = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 客户端包装与清理
  // ═══════════════════════════════════════════════════════════

  /**
   * wrapClient — 包装 McpClient，拦截 close/call 以跟踪活动
   */
  private wrapClient(name: string, rawClient: McpClient): McpClient {
    const guard = this;

    return {
      get name(): string {
        return rawClient.name;
      },

      async call(
        method: string,
        params?: Record<string, unknown>,
        options?: { timeoutMs?: number; signal?: AbortSignal },
      ): Promise<unknown> {
        // 更新活动时间
        const entry = guard._guardRegistry.get(name);
        if (entry) entry.lastActivity = Date.now();

        return rawClient.call(method, params, options);
      },

      async ping(): Promise<boolean> {
        const entry = guard._guardRegistry.get(name);
        if (entry) entry.lastActivity = Date.now();

        return rawClient.ping();
      },

      async close(): Promise<void> {
        await guard.guardShutdown(name);
      },
    };
  }

  /**
   * stopGuardProbes — 停止单个进程的所有巡检定时器
   */
  private stopGuardProbes(name: string): void {
    const entry = this._guardRegistry.get(name);
    if (!entry) return;

    if (entry.pingTimer) {
      clearInterval(entry.pingTimer);
      entry.pingTimer = null;
    }
    if (entry.deadlockTimer) {
      clearInterval(entry.deadlockTimer);
      entry.deadlockTimer = null;
    }
  }

  /**
   * stopAllGuards — 停止所有守护进程
   */
  private async stopAllGuards(): Promise<void> {
    const names = [...this._guardRegistry.keys()];

    for (const name of names) {
      this.stopGuardProbes(name);
      this._guardRegistry.delete(name);
    }

    // 关闭所有底层 MCP 进程
    await Promise.allSettled(
      names.map(name =>
        this._manager.shutdown(name).catch(() => {})
      ),
    );

    this._spawnSnapshots.clear();
  }
}
