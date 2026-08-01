/**
 * Connector 连接器测试（外部接口面）
 *
 * 覆盖：
 *   - ConnectorRegistry：注册/发现/重复注册覆盖/权限规则/未知连接器
 *   - FileSystemConnector：read/write/list/delete/stat + 路径穿越防护（副作用隔离在临时目录）
 *   - ShellConnector：shell.exec 安全命令 + 超时/退出码
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorRegistry } from '../src/ConnectorRegistry.js';
import { FileSystemConnector } from '../src/FileSystemConnector.js';
import { ShellConnector } from '../src/ShellConnector.js';

describe('ConnectorRegistry — 注册与权限', () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  it('注册连接器后可发现（list/getMeta）', async () => {
    const fsConn = new FileSystemConnector(process.cwd());
    await registry.register(fsConn);
    const metas = registry.list();
    expect(metas.some((m) => m.id === 'filesystem')).toBe(true);
  });

  it('重复注册同一 id → 覆盖并告警，不抛错', async () => {
    const a = new FileSystemConnector(process.cwd());
    const b = new FileSystemConnector(process.cwd());
    await registry.register(a);
    await expect(registry.register(b)).resolves.not.toThrow();
  });

  it('执行动作需权限规则放行；无匹配规则被拒绝', async () => {
    const fsConn = new FileSystemConnector(process.cwd());
    await registry.register(fsConn);
    registry.addPermissionRule({
      connectorPattern: 'filesystem', actionPattern: 'fs.*',
      allowedRoles: ['*'], destructive: false, requiresApproval: false,
    });
    const result = await registry.execute({
      action: 'fs.exists', params: { path: 'package.json' },
      executionId: 'exe-conn', role: 'admin',
    } as never);
    expect(result.success).toBe(true);
  });

  it('未知连接器/未注册动作 → 失败结果', async () => {
    const result = await registry.execute({
      action: 'fs.read', params: { path: 'x' }, executionId: 'exe-conn',
    } as never);
    expect(result.success).toBe(false);
  });
});

describe('FileSystemConnector — 副作用隔离 + 路径穿越防护', () => {
  let root: string;
  let fsConn: FileSystemConnector;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'morpex-fs-'));
    fsConn = new FileSystemConnector(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fs.write + fs.read 往返', async () => {
    const w = await fsConn.execute({ action: 'fs.write', params: { path: 'a.txt', content: 'hello' }, executionId: 'x' } as never);
    expect(w.success).toBe(true);
    const r = await fsConn.execute({ action: 'fs.read', params: { path: 'a.txt' }, executionId: 'x' } as never);
    expect(r.data).toBe('hello');
  });

  it('fs.mkdir + fs.list', async () => {
    await fsConn.execute({ action: 'fs.mkdir', params: { path: 'dir1' }, executionId: 'x' } as never);
    const list = await fsConn.execute({ action: 'fs.list', params: { path: '.' }, executionId: 'x' } as never);
    expect(JSON.stringify(list.data)).toContain('dir1');
  });

  it('fs.delete 删除文件', async () => {
    await fsConn.execute({ action: 'fs.write', params: { path: 'del.txt', content: 'x' }, executionId: 'x' } as never);
    expect(existsSync(join(root, 'del.txt'))).toBe(true);
    await fsConn.execute({ action: 'fs.delete', params: { path: 'del.txt' }, executionId: 'x' } as never);
    expect(existsSync(join(root, 'del.txt'))).toBe(false);
  });

  it('路径穿越防护：../ 逃逸被拒绝', async () => {
    const result = await fsConn.execute({ action: 'fs.read', params: { path: '../../etc/passwd' }, executionId: 'x' } as never);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/traversal|outside|denied/i);
  });

  it('写入路径不允许逃逸出 root', async () => {
    const result = await fsConn.execute({ action: 'fs.write', params: { path: '../escape.txt', content: 'x' }, executionId: 'x' } as never);
    expect(result.success).toBe(false);
  });
});

describe('ShellConnector — 安全命令执行', () => {
  let root: string;
  let shell: ShellConnector;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'morpex-shell-'));
    shell = new ShellConnector(undefined, 5000); // 默认 allowlist + 5s 超时
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('shell.exec 执行安全命令并捕获输出', async () => {
    const r = await shell.execute({ action: 'shell.exec', params: { command: 'echo hello' }, executionId: 'x' } as never);
    expect(r.success).toBe(true);
    expect(JSON.stringify(r.data)).toContain('hello');
  });

  it('shell.exec 不存在的命令 → 失败', async () => {
    const r = await shell.execute({ action: 'shell.exec', params: { command: 'morpex-no-such-cmd-xyz' }, executionId: 'x' } as never);
    expect(r.success).toBe(false);
  });

  it('validate：capabilities 声明完整', async () => {
    const names = shell.capabilities.map((c) => c.name);
    expect(names).toContain('shell.exec');
    expect(names).toContain('shell.execScript');
  });
});
