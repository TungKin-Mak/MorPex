/**
 * ShellExecutionPrimitive — Shell 命令执行原语
 *
 * 通用的 shell 命令执行操作，通过 ConnectorRegistry 的 ShellConnector 执行。
 * 不包含任何领域逻辑——纯粹的基础设施能力。
 *
 * 安全约束：
 *   - 命令允许列表（仅允许预配置的命令）
 *   - 超时保护
 *   - 命令内容日志审计
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult, ShellExecutionRequest } from './types.js';
import { PrimitiveGate } from './gateBinding.js';
import type { KnowledgeContextPackage } from '../../../gate/context.js';

/** 只读 shell 命令（无需 Gate 凭证，缺凭证仅 WARN；其余命令视为副作用操作，必须持有凭证） */
const READONLY_SHELL_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'which']);

// ── ShellExecutionPrimitive ──

export class ShellExecutionPrimitive implements ActionPrimitive {
  name = 'shell_execution';
  description = '执行 shell 命令（通过 ConnectorRegistry ShellConnector）。支持超时、目录切换、命令白名单检查。';
  inputSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      args: { type: 'array', items: { type: 'string' }, description: '命令参数' },
      cwd: { type: 'string', description: '工作目录（可选）' },
      timeout: { type: 'number', description: '超时毫秒（默认 30000）' },
    },
    required: ['command'],
  };

  /** 已注入的 ConnectorRegistry Shell 执行器 */
  private static shellExec: ((params: {
    command: string;
    args?: string[];
    cwd?: string;
    timeout?: number;
    deptId: string;
  }) => Promise<ActionResult>) | null = null;

  /** 默认命令白名单 */
  private static allowedCommands: string[] = [
    'ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'which',
    'gcc', 'make', 'cmake', 'python3', 'node', 'tsc', 'npx',
    'git', 'docker', 'pip', 'npm',
  ];

  /**
   * setShellExecutor — 注入 Shell 执行器
   */
  static setShellExecutor(
    exec: (params: {
      command: string;
      args?: string[];
      cwd?: string;
      timeout?: number;
      deptId: string;
    }) => Promise<ActionResult>
  ): void {
    ShellExecutionPrimitive.shellExec = exec;
  }

  /**
   * setAllowedCommands — 设置允许的命令列表
   */
  static setAllowedCommands(commands: string[]): void {
    ShellExecutionPrimitive.allowedCommands = commands;
  }

  canHandle(task: string): number {
    const lower = task.toLowerCase();
    if (/编译|构建|运行|执行|命令行|终端|shell|terminal|build|compile|run|execute|command|make|gcc|git/.test(lower)) {
      return 0.9;
    }
    if (/打包|部署|测试|install|deploy|test|build|release/.test(lower)) {
      return 0.7;
    }
    return 0;
  }

  async execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; gateContext?: KnowledgeContextPackage }
  ): Promise<ActionResult> {
    const deptId = context?.departmentId || 'global';
    const command = params.command as string;
    const args = params.args as string[] | undefined;
    const cwd = params.cwd as string | undefined;
    const timeout = (params.timeout as number) || 30000;

    if (!command?.trim()) {
      return { success: false, error: 'ShellExecutionPrimitive: command 不能为空' };
    }

    // 安全检查：命令必须在允许列表中
    const baseCmd = command.split(/\s+/)[0];
    if (!ShellExecutionPrimitive.allowedCommands.includes(baseCmd)) {
      return {
        success: false,
        error: `ShellExecutionPrimitive: 命令 "${baseCmd}" 不在允许列表中。允许的命令: ${ShellExecutionPrimitive.allowedCommands.join(', ')}`,
      };
    }

    // Wave 4：Gate 绑定 — 只读命令放行（WARN），构建/部署/写类命令必须持有 KnowledgeContextPackage
    if (READONLY_SHELL_COMMANDS.has(baseCmd)) {
      PrimitiveGate.gateReadonly(`ShellExecutionPrimitive ${baseCmd}`, context?.gateContext);
    } else {
      PrimitiveGate.gateDestructive(`ShellExecutionPrimitive ${baseCmd}`, context?.gateContext);
    }

    if (!ShellExecutionPrimitive.shellExec) {
      return { success: false, error: 'ShellExecutionPrimitive: Shell 执行器未注入' };
    }

    try {
      const result = await ShellExecutionPrimitive.shellExec({
        command,
        args,
        cwd,
        timeout,
        deptId,
      });

      console.log(`[ShellExecutionPrimitive] 💻 ${command} (部门: ${deptId}) → ${result.success ? '✅' : '❌'}`);
      return result;
    } catch (err) {
      return { success: false, error: `ShellExecutionPrimitive: 执行失败: ${(err as Error).message}` };
    }
  }
}
