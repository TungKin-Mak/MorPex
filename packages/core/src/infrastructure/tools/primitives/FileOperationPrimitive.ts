/**
 * FileOperationPrimitive — 文件操作原语
 *
 * 通用的文件系统操作，通过 ConnectorRegistry 执行。
 * 不包含任何领域逻辑——纯粹的基础能力。
 *
 * 支持的操���：
 *   - read: 读取文件内容
 *   - write: 写入文件内容
 *   - delete: 删除文件
 *   - list: 列出目录文件
 *   - exists: 检查文件/目录是否存在
 *   - mkdir: 创建目录
 *   - copy: 复制文件
 *   - move: 移动文件
 *   - stat: 文件状态信息
 *
 * @packageDocumentation
 */

import type { ActionPrimitive, ActionResult, FileOperationRequest } from './types.js';
import { PrimitiveGate } from './gateBinding.js';
import type { KnowledgeContextPackage } from '../../../gate/context.js';

/** 只读文件操作（无需 Gate 凭证，缺凭证仅 WARN；其余为破坏性操作，必须持有凭证） */
const READONLY_FILE_OPS = new Set(['read', 'list', 'exists', 'stat']);

// ── FileOperationPrimitive ──

export class FileOperationPrimitive implements ActionPrimitive {
  name = 'file_operation';
  description = '通用的文件系统操作（读取、写入、复制、移动、删除、列出目录等）';
  inputSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'write', 'delete', 'list', 'exists', 'mkdir', 'copy', 'move', 'stat'],
        description: '文件操作类型',
      },
      path: { type: 'string', description: '文件或目录路径' },
      content: { type: 'string', description: '写入内容（write 操作必填）' },
      destination: { type: 'string', description: '目标路径（copy/move 操作必填）' },
    },
    required: ['operation', 'path'],
  };

  /** 已注入的 ConnectorRegistry 引用 */
  private static connectorExec: ((action: string, params: Record<string, unknown>) => Promise<ActionResult>) | null = null;

  /**
   * setConnectorExecutor — 注入 ConnectorRegistry 的执行函数
   * 由 bootstrap 初始化时调用
   */
  static setConnectorExecutor(
    exec: (action: string, params: Record<string, unknown>) => Promise<ActionResult>
  ): void {
    FileOperationPrimitive.connectorExec = exec;
  }

  canHandle(task: string): number {
    const lower = task.toLowerCase();
    if (/文件|读取|写入|保存|创建目录|复制|移动|删除|file|read|write|save|mkdir|copy|move|delete|fs|filesystem/.test(lower)) {
      return 0.95;
    }
    if (/产物|输出|结果|artifact|output|result|生成.*文件/.test(lower)) {
      return 0.7;
    }
    return 0;
  }

  async execute(
    params: Record<string, unknown>,
    context?: { departmentId?: string; userId?: string; gateContext?: KnowledgeContextPackage; workspaceDir?: string }
  ): Promise<ActionResult> {
    const deptId = context?.departmentId || 'global';
    const operation = params.operation as FileOperationRequest['operation'];
    const path = params.path as string;
    const content = params.content as string | undefined;
    const destination = params.destination as string | undefined;

    if (!path) {
      return { success: false, error: 'FileOperationPrimitive: path 参数不能为空' };
    }

    // ═══ 会话 12：沙箱工作目录——破坏性操作（write/mkdir/copy/move/delete）用相对/无前缀路径时
    //    落到 workspaceDir，防写仓库根（实测污染：开发设计规划/XC8P9530_main.c）═══
    const workspace = context?.workspaceDir;
    const isWriteOp = !READONLY_FILE_OPS.has(operation);
    const safePath = (isWriteOp && workspace && !path.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(path))
      ? require('node:path').join(workspace, path)
      : path;

    // Wave 4：Gate 绑定 — 破坏性操作（write/delete/move/copy/mkdir）必须持有 KnowledgeContextPackage
    if (READONLY_FILE_OPS.has(operation)) {
      PrimitiveGate.gateReadonly(`FileOperationPrimitive ${operation} ${safePath}`, context?.gateContext);
    } else {
      PrimitiveGate.gateDestructive(`FileOperationPrimitive ${operation} ${safePath}`, context?.gateContext);
    }

    if (!FileOperationPrimitive.connectorExec) {
      return { success: false, error: 'FileOperationPrimitive: ConnectorRegistry 未注入，请在 bootstrap 中调用 setConnectorExecutor()' };
    }

    try {
      const result = await FileOperationPrimitive.connectorExec('fs.' + operation, {
        path: safePath,
        content,
        destination,
        departmentId: deptId,
      });

      console.log(`[FileOperationPrimitive] 📁 ${operation} ${safePath} (部门: ${deptId}) → ${result.success ? '✅' : '❌'}`);
      return result;
    } catch (err) {
      return { success: false, error: `FileOperationPrimitive: ${operation} 失败: ${(err as Error).message}` };
    }
  }
}
