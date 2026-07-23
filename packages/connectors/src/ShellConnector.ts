/**
 * ShellConnector — v11 Shell Connector
 *
 * Provides safe, validated shell command execution.
 * Commands are restricted by an allowlist for security.
 *
 * Capabilities:
 *   - shell.exec: Execute a shell command
 *   - shell.execScript: Execute a script file
 *
 * @packageDocumentation
 */

import { BaseConnector } from './BaseConnector.js';
import type { ConnectorCapability } from './types.js';

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
 * ShellConnector — Safe shell command execution
 *
 * Commands are validated against an allowlist.
 * All executions have a configurable timeout.
 */
export class ShellConnector extends BaseConnector {
  private allowlist: Set<string>;
  private maxTimeout: number;
  private execFn: typeof import('node:child_process').exec | null = null;

  constructor(
    allowlist?: string[],
    maxTimeout?: number
  ) {
    super('shell', 'Shell Connector', '1.0.0', CAPABILITIES);
    this.allowlist = new Set(allowlist ?? DEFAULT_ALLOWLIST);
    this.maxTimeout = maxTimeout ?? 30_000;
  }

  async initialize(): Promise<void> {
    const cp = await import('node:child_process');
    this.execFn = cp.exec;
    this.initialized = true;
  }

  async validate(request: import('./types.js').ActionRequest): Promise<boolean> {
    const baseValid = await super.validate(request);
    if (!baseValid) return false;

    if (request.action === 'shell.exec') {
      const command = request.params.command as string;
      // Extract the base command (first word)
      const baseCommand = command.split(/\s+/)[0]?.split('/').pop() ?? '';
      if (!this.allowlist.has(baseCommand)) {
        return false;
      }
    }

    return true;
  }

  protected async executeAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    const { promisify } = await import('node:util');
    const execPromise = promisify(this.execFn ?? (await import('node:child_process')).exec);

    switch (action) {
      case 'shell.exec': {
        const command = params.command as string;
        const cwd = params.cwd as string | undefined;
        const timeout = Math.min(
          params.timeout as number ?? 30_000,
          this.maxTimeout
        );

        const { stdout, stderr } = await execPromise(command, {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
        });

        return {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: 0,
        };
      }

      case 'shell.execScript': {
        const script = params.script as string;
        const interpreter = params.interpreter as string ?? 'bash';
        const args = params.args as string[] ?? [];
        const cwd = params.cwd as string | undefined;
        const timeout = Math.min(
          params.timeout as number ?? 30_000,
          this.maxTimeout
        );

        const scriptArgs = [script, ...args].join(' ');
        const { stdout, stderr } = await execPromise(
          `${interpreter} ${scriptArgs}`,
          { cwd, timeout, maxBuffer: 1024 * 1024 }
        );

        return {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: 0,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }
}
