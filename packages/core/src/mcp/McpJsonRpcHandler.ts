/**
 * McpJsonRpcHandler — MCP 子进程 JSON-RPC 处理器基类
 *
 * 子进程继承此类，实现各方法的处理逻辑。
 * 自动处理：stdin 读取 → JSON 解析 → 路由分发 → JSON-RPC 响应 → stdout 写出
 *
 * stdout 严格只输出 JSON-RPC 响应，任何其他输出被丢弃。
 * stderr 输出会由父进程重定向到审计日志文件。
 *
 * 用法（子进程入口）：
 *   class MyHandler extends McpJsonRpcHandler {
 *     protected routes = {
 *       'myMethod': (params) => this.handleMyMethod(params),
 *     };
 *     handleMyMethod(params: any) { ... }
 *   }
 *
 *   if (require.main === module) {
 *     const handler = new MyHandler();
 *     handler.run();
 *   }
 */

import * as readline from 'node:readline';

/** JSON-RPC 2.0 请求 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 成功响应 */
interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

/** JSON-RPC 2.0 错误响应 */
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** 路由方法签名 */
type RouteHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

// ── 标准 JSON-RPC 错误码 ──

export const RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const;

/**
 * McpJsonRpcHandler — 子进程 JSON-RPC 处理器基类
 *
 * 职责：
 *   - 从 stdin 逐行读取 JSON-RPC 请求
 *   - 路由到对应处理方法
 *   - 返回 JSON-RPC 响应到 stdout
 *   - 自动错误捕获和格式化
 *   - 支持 ping 内置方法
 */
export abstract class McpJsonRpcHandler {
  /** 子类在此注册方法路由 */
  protected abstract routes: Record<string, RouteHandler>;

  /**
   * run — 启动 stdio 事件循环
   *
   * 使用 readline 逐行读取 stdin，防止缓冲区分裂。
   * 每行作为一个独立的 JSON-RPC 请求处理。
   */
  run(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleLine(trimmed);
    });

    rl.on('close', () => {
      process.exit(0);
    });

    // 父进程通过 SIGTERM 优雅退出
    process.on('SIGTERM', () => {
      this.onShutdown();
      rl.close();
    });
  }

  /**
   * onShutdown — 子类可覆盖此方法实现清理逻辑
   */
  protected onShutdown(): void {
    // 默认无操作
  }

  // ── 内部 ──

  private handleLine(line: string): void {
    let request: JsonRpcRequest;

    try {
      const parsed = JSON.parse(line);

      // 验证 JSON-RPC 2.0 格式
      if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
        this.sendError(null, RPC_ERRORS.INVALID_REQUEST);
        return;
      }

      request = parsed as JsonRpcRequest;
    } catch {
      this.sendError(null, RPC_ERRORS.PARSE_ERROR);
      return;
    }

    // 处理 ping（内置方法）
    if (request.method === 'ping') {
      this.sendResult(request.id, { pong: true, timestamp: Date.now() });
      return;
    }

    // 路由到处理方法
    const handler = this.routes[request.method];
    if (!handler) {
      this.sendError(request.id, RPC_ERRORS.METHOD_NOT_FOUND);
      return;
    }

    // 执行并响应
    try {
      const result = handler(request.params ?? {});
      if (result instanceof Promise) {
        result
          .then((value) => this.sendResult(request.id, value))
          .catch((err: Error) => this.sendError(request.id, {
            code: RPC_ERRORS.INTERNAL_ERROR.code,
            message: err.message,
            data: err.stack,
          }));
      } else {
        this.sendResult(request.id, result);
      }
    } catch (err: any) {
      this.sendError(request.id, {
        code: RPC_ERRORS.INTERNAL_ERROR.code,
        message: err.message,
        data: err.stack,
      });
    }
  }

  private sendResult(id: string | number, result: unknown): void {
    const response: JsonRpcSuccess = {
      jsonrpc: '2.0',
      id,
      result,
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendError(id: string | number | null, error: { code: number; message: string; data?: unknown }): void {
    const response: JsonRpcError = {
      jsonrpc: '2.0',
      id,
      error,
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}
