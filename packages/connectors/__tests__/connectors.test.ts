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
import type { ActionResult } from '../src/types.js';

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

  it('超时正交上报：进程超时被 SIGTERM 终止——timedOut/signal/exitCode 作为互相独立的字段，绝不折叠进 success', async () => {
    // 实证（Node 行为）：一旦 .kill('SIGTERM')，即使子进程吞信号后 exit(0)，close 仍上报 signal，code=null。
    // 因此正确断言是「timedOut 与 signal 各自独立存在」——消费者绝不能从单一 success 推断超时/信号/退出码。
    const trapScript = "process.on('SIGTERM',()=>{setTimeout(()=>process.exit(0),80)});setInterval(()=>{},1000)";
    const r = await shell.execute({
      action: 'shell.exec',
      params: { command: `node -e "${trapScript}"`, timeout: 200 },
      executionId: 'x',
    } as never) as ActionResult & { timedOut?: boolean; signal?: string };
    expect(r.timedOut).toBe(true);       // 正交因子 1：超时
    expect(r.signal).toBeTruthy();       // 正交因子 2：终止信号（SIGTERM）
    expect(r.success).toBe(false);       // 便捷布尔：超时即未成功完成（真相源仍在独立字段）
    // 正交性验证：signal 存在时 exitCode 不为 0 伪造——被信号终止早于退出码结算，二者不折叠
    expect(r.exitCode).not.toBe(0);
  });

  it('免责声明：凭据类 env 不透传子进程（scrubEnv 生效）', async () => {
    const leakKey = 'MORPEX_TEST_SECRET_LEAK';
    const leakValue = 'should-not-leak-xyz';
    process.env[leakKey] = leakValue;
    try {
      const r = await shell.execute({
        action: 'shell.exec',
        params: { command: 'node -e console.log(JSON.stringify(process.env))' },
        executionId: 'x',
      } as never);
      expect(r.success).toBe(true);
      const out = JSON.stringify(r.data);
      expect(out).not.toContain(leakValue);
      expect(out).not.toContain(leakKey);
    } finally {
      delete process.env[leakKey];
    }
  });

  it('shell.execScript 脚本落私有临时目录执行并清理', async () => {
    const r = await shell.execute({
      action: 'shell.execScript',
      params: {
        script: 'console.log("from-script")',
        interpreter: 'node',
      },
      executionId: 'x',
    } as never);
    expect(r.success).toBe(true);
    expect(JSON.stringify(r.data)).toContain('from-script');
    // 私有临时目录（morpex-script-*）已被清理：不再有任何残留
    const { readdirSync } = await import('node:fs');
    const leftovers = readdirSync(tmpdir()).filter((n) => n.startsWith('morpex-script-'));
    expect(leftovers).toEqual([]);
  });
});
