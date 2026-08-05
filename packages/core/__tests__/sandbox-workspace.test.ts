/**
 * 沙箱工作目录测试（会话 12：防 step-agent 工具写仓库根）
 *
 * 背景：step-agent 的 file/shell 工具此前以 process.cwd()（仓库根）为基准，
 * 实测污染（开发设计规划/XC8P9530_main.c）。修复：注入 workspaceDir 后——
 *   - FileOperationPrimitive：破坏性操作（write/mkdir/copy/move/delete）用相对路径时落到 workspaceDir
 *   - ShellExecutionPrimitive：cwd 缺省时指向 workspaceDir
 *   - StepAgentExecutor：自动创建 data/agent-workspace/<nodeId>/ 沙箱并注入
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileOperationPrimitive } from '../src/infrastructure/tools/primitives/FileOperationPrimitive.js';
import { ShellExecutionPrimitive } from '../src/infrastructure/tools/primitives/ShellExecutionPrimitive.js';

describe('FileOperationPrimitive — 沙箱工作目录（会话 12）', () => {
  it('write 用相对路径 → 落到 workspaceDir（不写仓库根）', async () => {
    const sandbox = path.join(os.tmpdir(), 'morpex-sandbox-test');
    let receivedPath = '';
    // 注入 mock connector 捕获实际路径（绕过真实 fs）
    FileOperationPrimitive.setConnectorExecutor(async (_action: string, params: Record<string, unknown>) => {
      receivedPath = String(params.path);
      return { success: true, data: { path: params.path } };
    });

    const p = new FileOperationPrimitive();
    const gatePkg = {
      executionId: 'e', riskTier: 'tier-1', queryCallCount: 1,
      retrievedIds: [], referenceCheck: { valid: true, missing: [], knownCount: 0 }, issuedAt: Date.now(),
    };
    const res = await p.execute(
      { operation: 'write', path: 'hello.py', content: 'x' },
      { departmentId: 'software', gateContext: gatePkg, workspaceDir: sandbox },
    );
    expect(res.success).toBe(true);
    expect(receivedPath).toBe(path.join(sandbox, 'hello.py')); // 相对路径 → 沙箱内
    expect(receivedPath).not.toContain('Morpex'); // 不在仓库根
  });

  it('绝对路径不强制改写到沙箱（保持用户显式指定）', async () => {
    const sandbox = path.join(os.tmpdir(), 'morpex-sandbox-test2');
    let receivedPath = '';
    FileOperationPrimitive.setConnectorExecutor(async (_action: string, params: Record<string, unknown>) => {
      receivedPath = String(params.path);
      return { success: true, data: {} };
    });
    const p = new FileOperationPrimitive();
    const gatePkg = { executionId: 'e', riskTier: 'tier-1', queryCallCount: 1, retrievedIds: [], referenceCheck: { valid: true, missing: [], knownCount: 0 }, issuedAt: Date.now() };
    await p.execute(
      { operation: 'write', path: '/tmp/abs.txt', content: 'x' },
      { departmentId: 'software', gateContext: gatePkg, workspaceDir: sandbox },
    );
    expect(receivedPath).toBe('/tmp/abs.txt'); // 绝对路径保持
  });
});

describe('ShellExecutionPrimitive — 沙箱 cwd 缺省（会话 12）', () => {
  it('cwd 缺省 → 指向 workspaceDir', async () => {
    const sandbox = path.join(os.tmpdir(), 'morpex-sandbox-sh');
    let receivedCwd: string | undefined = undefined;
    ShellExecutionPrimitive.setShellExecutor(async (p) => {
      receivedCwd = p.cwd;
      return { success: true, data: { cmd: p.command } };
    });
    ShellExecutionPrimitive.setAllowedCommands(['echo']);
    const p = new ShellExecutionPrimitive();
    await p.execute(
      { command: 'echo hi' },
      { departmentId: 'software', workspaceDir: sandbox },
    );
    expect(receivedCwd).toBe(sandbox);
  });

  it('显式 cwd 优先于沙箱（不覆盖用户指定）', async () => {
    let receivedCwd: string | undefined = undefined;
    ShellExecutionPrimitive.setShellExecutor(async (p) => {
      receivedCwd = p.cwd;
      return { success: true, data: {} };
    });
    ShellExecutionPrimitive.setAllowedCommands(['echo']);
    const p = new ShellExecutionPrimitive();
    await p.execute(
      { command: 'echo hi', cwd: '/my/dir' },
      { departmentId: 'software', workspaceDir: os.tmpdir() },
    );
    expect(receivedCwd).toBe('/my/dir');
  });
});
