/**
 * infrastructure/common/__tests__/secureExec.test.ts — 安全子进程执行工具测试
 *
 * 覆盖（防御性模式三件套）：
 *   1. scrubEnv：过滤含 KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL 的 env（大小写不敏感）
 *   2. runCommand：
 *      - 成功执行 → exitCode=0、ok=true、stdout 采集
 *      - 非零退出 → ok=false 且 exitCode 独立保留
 *      - 超时 → timedOut=true + ok=false 正交上报（即便子进程吞掉信号后 exit 0）
 *      - 永不 reject（spawn 未知命令 / 超时均以 ExecOutcome 返回）
 *   3. 私有临时路径：makePrivateTempDir 权限 0700 / randomPrivateFilePath 随机 / writeExclusive 独占（二次写 EEXIST）
 *
 * 全部使用系统最小命令（node / process.execPath），不触碰仓库 data/ 目录。
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  scrubEnv,
  runCommand,
  makePrivateTempDir,
  randomPrivateFilePath,
  writeExclusive,
  cleanupTempDir,
} from '../secureExec.js';

describe('scrubEnv', () => {
  it('过滤含凭据特征的 key（大小写不敏感），保留普通 key', () => {
    const input = {
      DEEPSEEK_API_KEY: 'sk-secret',
      GITHUB_TOKEN: 'ghp_xxx',
      MY_Password: 'pwd',
      NODE_ENV: 'test',
      PATH: '/usr/bin',
    };
    const out = scrubEnv(input) ?? {};
    expect(out.NODE_ENV).toBe('test');
    expect(out.PATH).toBe('/usr/bin');
    expect('DEEPSEEK_API_KEY' in out).toBe(false);
    expect('GITHUB_TOKEN' in out).toBe(false);
    expect('MY_Password' in out).toBe(false);
  });

  it('undefined / 空对象安全处理', () => {
    expect(scrubEnv(undefined)).toBeUndefined();
    expect(scrubEnv({})).toEqual({});
  });
});

describe('runCommand — 成功路径', () => {
  it('正常退出 → ok=true 且 exitCode=0，stdout 完整采集', async () => {
    const res = await runCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("hello-secure")'] });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBeUndefined();
    expect(res.stdout).toContain('hello-secure');
  });
});

describe('runCommand — 非零退出', () => {
  it('process.exit(7) → ok=false 且 exitCode=7 独立保留', async () => {
    const res = await runCommand({ command: process.execPath, args: ['-e', 'process.exit(7)'] });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(7);
  });
});

describe('runCommand — 超时正交上报（关键契约）', () => {
  it('睡眠超过 timeoutMs → timedOut=true、ok=false（即便进程随后被 signal 终止）', async () => {
    const res = await runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100,
    });
    expect(res.timedOut).toBe(true);
    expect(res.ok).toBe(false);
    // 正交：timeout 之后 close 事件仍被等待（dispose 到静默），没有孤儿 promise
  }, 5000);
});

describe('runCommand — 永不 reject', () => {
  it('未知命令 → 以 ExecOutcome 返回（ok=false），不抛异常', async () => {
    const res = await runCommand({ command: 'morpex_no_such_cmd_xxx_987', timeoutMs: 2000 });
    expect(res.ok).toBe(false);
    expect(typeof res.stderr).toBe('string');
  });
});

describe('私有临时路径', () => {
  // Windows 上 chmod 基本是 no-op（stat.mode 恒为 0o666），权限位断言仅在 POSIX 有效
  const isPosix = process.platform !== 'win32';

  it('makePrivateTempDir → 目录存在；POSIX 下权限 0700', async () => {
    const dir = await makePrivateTempDir('morpex-test-');
    try {
      const s = await stat(dir);
      expect(s.isDirectory()).toBe(true);
      if (isPosix) {
        expect(s.mode & 0o777).toBe(0o700);
      }
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it('randomPrivateFilePath → 不同调用产生不同随机名且落于指定目录', async () => {
    const dir = await makePrivateTempDir('morpex-test-');
    try {
      const a = randomPrivateFilePath(dir, 'spill');
      const b = randomPrivateFilePath(dir, 'spill');
      expect(a).not.toBe(b);
      // 路径目录与输入一致：Windows 与 POSIX 分隔符不同，用 path 规范化后比对
      expect(path.dirname(a).replace(/\\/g, '/')).toBe(dir.replace(/\\/g, '/'));
      expect(path.basename(a)).toMatch(/^spill_[0-9a-f]{16}$/);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it('writeExclusive → 独占创建 + 已存在时拒绝（防覆盖竞态）；POSIX 下权限 0600', async () => {
    const dir = await makePrivateTempDir('morpex-test-');
    try {
      const f = randomPrivateFilePath(dir, 'tmp');
      await writeExclusive(f, 'payload');
      const s = await stat(f);
      if (isPosix) {
        expect(s.mode & 0o777).toBe(0o600);
      }
      // 已存在 → wx（O_EXCL）拒绝，模拟 symlink/并发抢占
      await expect(writeExclusive(f, 'overwrite')).rejects.toThrow(); // EEXIST
    } finally {
      await cleanupTempDir(dir);
    }
  });
});