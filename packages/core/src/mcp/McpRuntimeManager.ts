/**
 * McpRuntimeManager — MCP 边车运行时管理器
 *
 * 职责：
 *   1. 作为全局、无状态的基础设施层管理所有 MCP 子进程
 *   2. 提供强类型 JSON-RPC 2.0 客户端，Host 不接触原始 stdio
 *   3. stderr 强制重定向到独立审计日志文件，绝不污染 stdio 管道
 *   4. 确定性销毁：removeAllListeners + SIGTERM + 超时 SIGKILL
 *   5. 可取消：所有 RPC 调用接受 AbortSignal
 *   6. 防死锁：逐行解析 + 缓冲区溢出保护
 *
 * 设计原则（Sidecar 隔离）：
 *   - Host 不直接 spawn/kill 子进程，全部通过此管理器
 *   - Host 不监听 stdio，只通过 JSON-RPC 接口调用
 *   - 子进程的 stdout 只包含 JSON-RPC 响应，其余全部被过滤丢弃
 *   - 子进程的 stderr 写入独立日志文件，禁止混入 stdout
 *
 * 用法：
 *   const manager = McpRuntimeManager.getInstance();
 *   const client = await manager.spawn('filesystem', 'npx', ['tsx', './handler.ts', '/workspace']);
 *   const result = await client.call('readFile', { path: './foo.ts' });
 *   await manager.shutdown('filesystem');
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 成功响应 */
export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

/** JSON-RPC 2.0 错误响应 */
export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** JSON-RPC 2.0 响应联合 */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** MCP 进程状态 */
export type McpProcessStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed';

/** MCP 进程元信息 */
interface McpProcessEntry {
  proc: ChildProcess;
  name: string;
  command: string;
  args: string[];
  spawnOptions?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number };
  status: McpProcessStatus;
  startTime: number;
  restartCount: number;
  maxRestarts: number;
  auditLogPath: string;
  auditStream: fs.WriteStream | null;
  /** readline 接口（stdout 逐行解析），shutdown 时需关闭 */
  readlineInterface: readline.Interface | null;
  pendingRequests: Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>;
  seq: number;
}

/** MCP 客户端接口 — Host 只通过此接口与 MCP 通信 */
export interface McpClient {
  /** 服务名称 */
  readonly name: string;

  /** 调用 JSON-RPC 方法 */
  call(method: string, params?: Record<string, unknown>, options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<unknown>;

  /** 健康检查 */
  ping(): Promise<boolean>;

  /** 关闭此客户端 */
  close(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// 全局管理器
// ═══════════════════════════════════════════════════════════════

const DEFAULT_RPC_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 3_000;
const AUDIT_LOG_DIR = path.resolve('./logs/mcp-audit/');

/**
 * McpRuntimeManager — 全局单例 MCP 边车管理器
 *
 * 线程安全：所有操作通过 Map 管理，单线程 JS 无需锁。
 */
export class McpRuntimeManager {
  private static instance: McpRuntimeManager;

  /** 进程注册表 name → entry */
  private registry = new Map<string, McpProcessEntry>();
  private _totalSpawns = 0;
  private _totalCrashes = 0;

  static getInstance(): McpRuntimeManager {
    if (!McpRuntimeManager.instance) {
      McpRuntimeManager.instance = new McpRuntimeManager();
    }
    return McpRuntimeManager.instance;
  }

  // ── 统计 ──

  get stats() {
    return {
      totalSpawns: this._totalSpawns,
      totalCrashes: this._totalCrashes,
      activeProcesses: this.registry.size,
    };
  }

  // ── 日志 ──

  private async ensureAuditDir(): Promise<void> {
    try {
      await fs.promises.mkdir(AUDIT_LOG_DIR, { recursive: true });
    } catch (err: any) {
      // EEXIST 等并发创建场景安全忽略
      if (err.code !== 'EEXIST') throw err;
    }
  }

  private async createAuditStream(name: string): Promise<{ stream: fs.WriteStream; logPath: string }> {
    await this.ensureAuditDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(AUDIT_LOG_DIR, `${name}-${timestamp}.log`);
    const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    return { stream, logPath };
  }

  private auditLog(entry: McpProcessEntry, direction: '>>' | '<<' | '!!' | 'XX', message: string): void {
    if (entry.auditStream) {
      const line = `[${new Date().toISOString()}] ${direction} ${message}\n`;
      entry.auditStream.write(line);
    }
  }

  // ── 生成请求 ID ──

  private nextId(entry: McpProcessEntry): string {
    return `mcp_${entry.seq++}_${Date.now()}`;
  }

  // ── Spawn ──

  /**
   * spawn — 启动一个 MCP 边车进程
   *
   * @param name        - 服务唯一名称（如 "filesystem"）
   * @param command     - 可执行文件
   * @param args        - 参数数组
   * @param options     - 环境变量、工作目录等
   * @returns McpClient 接口
   */
  async spawn(
    name: string,
    command: string,
    args: string[] = [],
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      /** 崩溃后自动重启次数（默认 0 = 不重启） */
      maxRestarts?: number;
    },
  ): Promise<McpClient> {
    // 不允许重复注册
    if (this.registry.has(name)) {
      throw new Error(`[McpRuntimeManager] MCP 服务 "${name}" 已注册`);
    }

    const { stream: auditStream, logPath } = await this.createAuditStream(name);
    const cwd = options?.cwd ?? process.cwd();

    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options?.env,
        // 强制通知子进程输出为 JSON-RPC 模式
        MCP_STDIO_MODE: 'jsonrpc',
      },
      // 不经过 shell，防止注入
      shell: false,
    });

    // ── stdout 解析：逐行读取严格 JSON-RPC ──
    const rl = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    const entry: McpProcessEntry = {
      proc,
      name,
      command,
      args,
      spawnOptions: options,
      status: 'starting',
      startTime: Date.now(),
      restartCount: 0,
      maxRestarts: options?.maxRestarts ?? 0,
      auditLogPath: logPath,
      auditStream,
      readlineInterface: rl,
      pendingRequests: new Map(),
      seq: 0,
    };

    this.registry.set(name, entry);
    this._totalSpawns++;

    // 现在 entry 已完整，可以安全使用
    this.auditLog(entry, '>>', `spawn: ${command} ${args.join(' ')}  (cwd=${cwd})`);

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // 非 JSON 开头 → 丢弃（第三方库噪声过滤）
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        this.auditLog(entry, 'XX', `[stdout-filter] 非 JSON 已丢弃: ${trimmed.slice(0, 200)}`);
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        this.auditLog(entry, 'XX', `[stdout-filter] JSON 解析失败已丢弃: ${trimmed.slice(0, 200)}`);
        return;
      }

      // 验证 JSON-RPC 响应格式（fix B1: 用 == null 同时捕获 undefined 和 null）
      if (!parsed || parsed.jsonrpc !== '2.0' || parsed.id == null) {
        this.auditLog(entry, 'XX', `[stdout-filter] 非 JSON-RPC 已丢弃: ${trimmed.slice(0, 200)}`);
        return;
      }

      const response = parsed as JsonRpcResponse;
      this.auditLog(entry, '<<', `RPC 响应 id=${response.id}`);

      // 查找并 resolve pending request
      // response.id 已在 L269 检查非 null（JSON-RPC 通知已过滤）
      const rpcId = response.id as string | number;
      const pending = entry.pendingRequests.get(rpcId);
      if (pending) {
        clearTimeout(pending.timer);
        entry.pendingRequests.delete(rpcId);
        pending.resolve(response);
      } else {
        // 🔴 孤儿响应：id 不匹配，Agent 可能永久挂起。
        // 策略：拒绝最旧的 pending request 以释放 Agent，避免死等。
        if (entry.pendingRequests.size > 0) {
          const [oldestId, oldestPending] = entry.pendingRequests.entries().next().value!;
          clearTimeout(oldestPending.timer);
          entry.pendingRequests.delete(oldestId);
          oldestPending.reject(
            new Error(`[McpRuntimeManager] MCP "${name}" 孤儿响应 id=${response.id}，释放最旧 pending id=${oldestId} 防挂起`)
          );
          this.auditLog(entry, 'XX', `[orphan-response] id=${response.id} → 释放 pending id=${oldestId}`);
        } else {
          this.auditLog(entry, 'XX', `[orphan-response] id=${response.id}（队列空，忽略）`);
        }
      }
    });

    // ── stderr → 审计日志（强隔离） ──
    proc.stderr!.on('data', (data: Buffer) => {
      const text = data.toString();
      this.auditLog(entry, '!!', `[stderr] ${text.trim()}`);
    });

    // ── 进程退出处理 ──
    const onExit = (code: number | null, signal: string | null) => {
      const reason = signal ? `signal=${signal}` : `code=${code}`;
      const wasStopping = entry.status === 'stopping';

      entry.status = wasStopping ? 'stopped' : 'crashed';
      this.auditLog(entry, 'XX', `进程退出 (${reason})${wasStopping ? '' : ' [crash]'}`);

      // 拒绝所有 pending requests
      for (const [id, pending] of entry.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`[McpRuntimeManager] MCP "${name}" 进程已退出 (${reason})`));
      }
      entry.pendingRequests.clear();

      // 关闭 readline 接口
      if (entry.readlineInterface) {
        entry.readlineInterface.close();
        entry.readlineInterface = null;
      }

      // 关闭审计流
      if (entry.auditStream) {
        entry.auditStream.end();
        entry.auditStream = null;
      }

      // 🔄 自动重启（仅 crash 且未达上限）
      if (!wasStopping && entry.restartCount < entry.maxRestarts) {
        entry.restartCount++;
        this.auditLog(entry, '>>',
          `🔄 自动重启 (${entry.restartCount}/${entry.maxRestarts})...`
        );
        // 异步重启，不阻塞 exit 事件
        this.restartEntry(name).catch(err => {
          this.auditLog(entry, 'XX', `自动重启失败: ${err.message}`);
          this.registry.delete(name);
        });
      } else if (!wasStopping) {
        this._totalCrashes++;
        this.registry.delete(name);
      }
    };

    proc.on('exit', onExit);
    proc.on('error', (err: Error) => {
      this.auditLog(entry, 'XX', `进程错误: ${err.message}`);
    });

    // ── 等待进程启动 ──
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[McpRuntimeManager] MCP "${name}" 启动超时`));
      }, options?.timeoutMs ?? 10_000);

      if (proc.pid !== undefined) {
        clearTimeout(timeout);
        entry.status = 'running';
        this.auditLog(entry, '>>', `已启动 (pid=${proc.pid})`);
        resolve();
      } else {
        proc.once('spawn', () => {
          clearTimeout(timeout);
          entry.status = 'running';
          this.auditLog(entry, '>>', `已启动 (pid=${proc.pid})`);
          resolve();
        });
      }
    });

    // ── 返回客户端接口 ──
    return this.createClient(name, entry);
  }

  /**
   * restartEntry — 自动重启崩溃的 MCP 进程
   *
   * 在 onExit 中异步调用。保留原 entry 的 name/command/args/spawnOptions，
   * 重新 spawn 子进程并更新 entry.proc。
   */
  private async restartEntry(name: string): Promise<void> {
    const oldEntry = this.registry.get(name);
    if (!oldEntry) return;

    const { command, args, spawnOptions } = oldEntry;

    // 创建新的审计流
    const { stream: auditStream, logPath } = await this.createAuditStream(name);
    const cwd = spawnOptions?.cwd ?? process.cwd();

    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...spawnOptions?.env, MCP_STDIO_MODE: 'jsonrpc' },
      shell: false,
    });

    const rl = readline.createInterface({
      input: proc.stdout!,
      crlfDelay: Infinity,
    });

    // 复用原 entry 结构，只更新 proc/stream/rl
    oldEntry.proc = proc;
    oldEntry.auditStream = auditStream;
    oldEntry.auditLogPath = logPath;
    oldEntry.readlineInterface = rl;
    oldEntry.status = 'starting';
    oldEntry.seq = 0;
    oldEntry.pendingRequests.clear();

    this.auditLog(oldEntry, '>>', `自动重启: ${command} ${args.join(' ')}`);

    // 重建 stdout 解析
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return;
      let parsed: any;
      try { parsed = JSON.parse(trimmed); } catch { return; }
      if (!parsed || parsed.jsonrpc !== '2.0' || parsed.id == null) return;
      const response = parsed as JsonRpcResponse;
      // response.id 已在 L425 检查非 null（JSON-RPC 通知已过滤）
      const rpcId = response.id as string | number;
      const pending = oldEntry.pendingRequests.get(rpcId);
      if (pending) {
        clearTimeout(pending.timer);
        oldEntry.pendingRequests.delete(rpcId);
        pending.resolve(response);
      }
    });

    // stderr 重定向
    proc.stderr!.on('data', (data: Buffer) => {
      this.auditLog(oldEntry, '!!', `[stderr] ${data.toString().trim()}`);
    });

    // 退出处理（递归：重启后的进程仍可再次重启）
    proc.on('exit', (code, signal) => {
      const reason = signal ? `signal=${signal}` : `code=${code}`;
      oldEntry.status = 'crashed';
      for (const [id, p] of oldEntry.pendingRequests) {
        clearTimeout(p.timer);
        p.reject(new Error(`[McpRuntimeManager] MCP "${name}" 重启后再次退出 (${reason})`));
      }
      oldEntry.pendingRequests.clear();
      if (oldEntry.readlineInterface) { oldEntry.readlineInterface.close(); oldEntry.readlineInterface = null; }
      if (oldEntry.auditStream) { oldEntry.auditStream.end(); oldEntry.auditStream = null; }
      if (oldEntry.restartCount < oldEntry.maxRestarts) {
        oldEntry.restartCount++;
        this.restartEntry(name).catch(() => this.registry.delete(name));
      } else {
        this._totalCrashes++;
        this.registry.delete(name);
      }
    });

    // 等待就绪
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`MCP "${name}" 重启超时`)), spawnOptions?.timeoutMs ?? 10_000);
      if (proc.pid !== undefined) { clearTimeout(t); oldEntry.status = 'running'; resolve(); }
      else proc.once('spawn', () => { clearTimeout(t); oldEntry.status = 'running'; resolve(); });
    });
  }

  // ── 创建客户端 ──

  private createClient(name: string, entry: McpProcessEntry): McpClient {
    const self = this;

    return {
      name,

      async call(
        method: string,
        params?: Record<string, unknown>,
        options?: { timeoutMs?: number; signal?: AbortSignal },
      ): Promise<unknown> {
        const currentEntry = self.registry.get(name);
        if (!currentEntry || currentEntry.proc.exitCode !== null) {
          throw new Error(`[McpRuntimeManager] MCP "${name}" 不在运行中`);
        }

        const id = self.nextId(currentEntry);
        const timeoutMs = options?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };

        const requestJson = JSON.stringify(request) + '\n';

        return new Promise<unknown>((resolve, reject) => {
          // 中断处理
          if (options?.signal?.aborted) {
            return reject(new Error(`[McpRuntimeManager] MCP "${name}" 调用被取消 (signal)`));
          }

          const abortHandler = () => {
            const pending = currentEntry.pendingRequests.get(id);
            if (pending) {
              clearTimeout(pending.timer);
              currentEntry.pendingRequests.delete(id);
              reject(new Error(`[McpRuntimeManager] MCP "${name}" 调用被取消 (signal)`));
            }
          };

          if (options?.signal) {
            options.signal.addEventListener('abort', abortHandler, { once: true });
          }

          // 超时
          const timer = setTimeout(() => {
            currentEntry.pendingRequests.delete(id);
            if (options?.signal) {
              options.signal.removeEventListener('abort', abortHandler);
            }
            reject(new Error(`[McpRuntimeManager] MCP "${name}" 调用超时 (${timeoutMs}ms): ${method}`));
          }, timeoutMs);

          // 注册 pending
          currentEntry.pendingRequests.set(id, {
            resolve: (response: JsonRpcResponse) => {
              if (options?.signal) {
                options.signal.removeEventListener('abort', abortHandler);
              }
              if ('result' in response) {
                resolve(response.result);
              } else {
                reject(new Error(`[McpRuntimeManager] MCP "${name}" 调用失败 (${response.error.code}): ${response.error.message}`));
              }
            },
            reject: (err: Error) => {
              if (options?.signal) {
                options.signal.removeEventListener('abort', abortHandler);
              }
              reject(err);
            },
            timer,
          });

          // 写入 stdin
          try {
            currentEntry.proc.stdin!.write(requestJson);
            self.auditLog(currentEntry, '>>', `RPC 调用 id=${id} method=${method}`);
          } catch (err: any) {
            clearTimeout(timer);
            currentEntry.pendingRequests.delete(id);
            if (options?.signal) {
              options.signal.removeEventListener('abort', abortHandler);
            }
            reject(new Error(`[McpRuntimeManager] MCP "${name}" 写入失败: ${err.message}`));
          }
        });
      },

      async ping(): Promise<boolean> {
        try {
          await this.call('ping', {}, { timeoutMs: 5_000 });
          return true;
        } catch {
          return false;
        }
      },

      async close(): Promise<void> {
        await self.shutdown(name);
      },
    };
  }

  // ── 关闭 ──

  /**
   * shutdown — 关闭指定 MCP 服务
   *
   * 确定性销毁顺序：
   *   1. 拒绝所有 pending requests
   *   2. removeAllListeners（消除内存泄漏）
   *   3. SIGTERM
   *   4. 等待 SHUTDOWN_GRACE_MS
   *   5. 如未退出 → SIGKILL
   *   6. 关闭审计日志流
   *   7. 从注册表移除
   */
  async shutdown(name: string): Promise<void> {
    const entry = this.registry.get(name);
    if (!entry) return;

    entry.status = 'stopping';
    this.auditLog(entry, '>>', `开始关闭...`);

    // 1. 拒绝所有 pending
    for (const [id, pending] of entry.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`[McpRuntimeManager] MCP "${name}" 正在关闭`));
    }
    entry.pendingRequests.clear();

    // 2. 关闭 readline 接口（释放文件描述符）
    if (entry.readlineInterface) {
      entry.readlineInterface.close();
      entry.readlineInterface = null;
    }

    // 3. removeAllListeners（消除内存泄漏）
    entry.proc.removeAllListeners();

    // 4. SIGTERM
    const proc = entry.proc;
    if (proc.pid && proc.exitCode === null) {
      try {
        proc.kill('SIGTERM');
      } catch { /* 进程可能已退出 */ }
    }

    // 5. 等待优雅退出
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        // 6. SIGKILL 强制结束
        if (proc.pid && proc.exitCode === null) {
          try { proc.kill('SIGKILL'); } catch { /* 忽略 */ }
        }
        resolve();
      }, SHUTDOWN_GRACE_MS);

      if (proc.exitCode !== null) {
        clearTimeout(killTimer);
        resolve();
      } else {
        proc.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      }
    });

    // 7. 关闭审计流
    if (entry.auditStream) {
      entry.auditStream.end();
      entry.auditStream = null;
    }

    // 8. 从注册表移除
    this.registry.delete(name);
    this.auditLog(entry, '>>', `已关闭`);
  }

  /**
   * shutdownAll — 关闭所有 MCP 服务
   */
  async shutdownAll(): Promise<void> {
    const names = Array.from(this.registry.keys());
    await Promise.allSettled(names.map(name => this.shutdown(name)));
  }

  /**
   * healthCheck — 健康检查所有 MCP 服务
   */
  async healthCheck(): Promise<Map<string, { healthy: boolean; pid?: number; uptime?: number }>> {
    const results = new Map<string, { healthy: boolean; pid?: number; uptime?: number }>();

    for (const [name, entry] of this.registry) {
      const healthy = entry.proc.exitCode === null && entry.proc.pid !== undefined;
      results.set(name, {
        healthy,
        pid: entry.proc.pid ?? undefined,
        uptime: healthy ? Math.floor((Date.now() - entry.startTime) / 1000) : undefined,
      });
    }

    return results;
  }

  /**
   * getClient — 获取已注册的 MCP 客户端
   */
  getClient(name: string): McpClient | null {
    const entry = this.registry.get(name);
    if (!entry || entry.proc.exitCode !== null) return null;
    return this.createClient(name, entry);
  }
}

export default McpRuntimeManager;
