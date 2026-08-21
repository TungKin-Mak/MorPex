/**
 * ShellConnector — v11 Shell Connector
 *
 * Provides safe, validated shell command execution.
 * Commands are restricted by an allowlist for security.
 *
 * 安全执行（升级：接入 secureExec 防御性模式）：
 *   - `spawn(shell:false)` 逐参数传递，不经 shell 字符串拼接——天然防 shell 注入；
 *   - `scrubEnv` 凭据清洗：KEY/SECRET/TOKEN/PASSWORD 类环境变量不透传子进程；
 *   - 正交结果：exitCode / timedOut / signal 作为独立字段上报，禁止折叠进单一 success；
 *   - execScript 脚本落私有临时目录（0700 + 随机名 + 独占写入 0600），执行后清理。
 *
 * @packageDocumentation
 */

import { BaseConnector } from './BaseConnector.js';
import type { ActionRequest, ActionResult, ConnectorCapability } from './types.js';
import { runCommand, makePrivateTempDir, randomPrivateFilePath, writeExclusive, cleanupTempDir } from './secureExec.js';

const CAPABILITIES: ConnectorCapability[] = [
  {
    name: 'shell.exec',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
    destructive: true,
    requiresApproval: true,
  },
  {
    name: 'shell.execScript',
    description: 'Execute a script file',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        interpreter: { type: 'string' },
        cwd: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['script'],
    },
    destructive: true,
    requiresApproval: true,
  },
];

/** Default command allowlist (commands that can be executed) */
const DEFAULT_ALLOWLIST = [
  'ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'date',
  'wc', 'sort', 'uniq', 'grep', 'find', 'which',
  'npm', 'npx', 'node', 'tsx', 'python', 'python3',
  'git', 'docker', 'curl', 'wget',
];

/**
 * parseCommandLine — 把命令行字符串安全地切分为 argv 数组（不经 shell）
 *
 * 支持单双引号与反斜杠转义；产出后的 token 直接交给 spawn(shell:false)，
 * 绝不重新拼接为字符串——这是防注入的关键一步。
 */
function parseCommandLine(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const ch of cmd) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null; // 引号闭合
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  if (quote !== null) tokens.push(current); // 容错：未闭合引号按字面输出，不外泄
  return tokens;
}

/**
 * ShellConnector — Safe shell command execution
 *
 * Commands are validated against an allowlist.
 * All executions have a configurable timeout.
 */
export class ShellConnector extends BaseConnector {
  private allowlist: Set<string>;
  private maxTimeout: number;

  constructor(
    allowlist?: string[],
    maxTimeout?: number
  ) {
    super('shell', 'Shell Connector', '1.0.0', CAPABILITIES);
    this.allowlist = new Set(allowlist ?? DEFAULT_ALLOWLIST);
    this.maxTimeout = maxTimeout ?? 30_000;
  }

  async validate(request: ActionRequest): Promise<boolean> {
    const baseValid = await super.validate(request);
    if (!baseValid) return false;

    if (request.action === 'shell.exec') {
      const command = request.params.command as string;
      // Extract the base command (first token)
      const baseCommand = parseCommandLine(command)[0]?.split('/').pop() ?? '';
      if (!this.allowlist.has(baseCommand)) {
        return false;
      }
    }

    return true;
  }

  /**
   * execute — 执行 action 并提升正交结果因子到顶层
   *
   * 覆盖基类 execute：把 ExecOutcome 的 exitCode/timedOut/signal/ok
   * 叠加到顶层 ActionResult（正交，禁止折叠）。success 只作为便捷布尔，
   * 真相源始终在 exitCode/timedOut/signal 三个独立字段。
   */
  async execute(request: ActionRequest): Promise<ActionResult> {
    const base = await super.execute(request);
    if (typeof base.data !== 'object' || base.data === null) return base;
    const d = base.data as { ok?: boolean; exitCode?: number; timedOut?: boolean; signal?: string; stdout?: string; stderr?: string };
    const outcome: ActionResult = {
      ...base,
      success: d.ok !== false,
      exitCode: d.exitCode,
      ...(d.timedOut !== undefined ? { timedOut: d.timedOut } : {}),
      ...(d.signal !== undefined ? { signal: d.signal } : {}),
      ok: d.ok,
    };
    return outcome;
  }

  protected async executeAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'shell.exec': {
        const command = String(params.command ?? '');
        const timeout = Math.min(Number(params.timeout ?? 30_000), this.maxTimeout);
        const parsed = parseCommandLine(command);
        const [cmd, ...args] = parsed;
        if (!cmd) {
          throw new Error('shell.exec: 命令为空');
        }
        // runCommand 内部默认 scrubEnv —— 透传 process.env 即触发凭据清洗
        return await runCommand({
          command: cmd,
          args,
          cwd: params.cwd as string | undefined,
          timeoutMs: timeout,
          env: process.env,
        });
      }

      case 'shell.execScript': {
        const script = String(params.script ?? '');
        const interpreter = String(params.interpreter ?? 'node');
        const args = (params.args as string[] | undefined) ?? [];
        const cwd = params.cwd as string | undefined;
        const timeout = Math.min(Number(params.timeout ?? 30_000), this.maxTimeout);

        // 脚本落私有临时目录（0700 + 随机名 + 独占写入 0600），绝不内联拼 shell 字符串
        const dir = await makePrivateTempDir('morpex-script-');
        try {
          const scriptPath = randomPrivateFilePath(dir, 'script');
          await writeExclusive(scriptPath, script);
          return await runCommand({
            command: interpreter,
            args: [scriptPath, ...args],
            cwd,
            timeoutMs: timeout,
            env: process.env,
          });
        } finally {
          // dispose 到静默：无论成败都清理私有临时目录
          await cleanupTempDir(dir);
        }
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }
}