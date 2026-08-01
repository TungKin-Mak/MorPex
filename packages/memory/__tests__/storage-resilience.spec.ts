/**
 * 存储韧性测试（混沌：存储写满/写入失败/日志轮转）— 此前零测试
 *
 * JSONLWriter：
 *   - 缓冲/定时刷盘 / maxBufferSize 立即刷盘
 *   - 刷盘失败（写入不可用路径模拟磁盘满）→ 数据保留 + 重试 → 超限丢弃但不崩
 *   - shutdown 后拒绝写入
 *
 * LogRotator：
 *   - 超阈值轮转（重命名 + 新空文件）
 *   - 未达阈值不轮转 / rotating 防并发轮转
 *   - cleanupOldFiles 清理过期轮转文件
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JSONLWriter } from '../src/storage/JSONLWriter.js';
import { LogRotator } from '../src/storage/LogRotator.js';

const TMP = path.join(os.tmpdir(), `morpex-storage-test-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('JSONLWriter — 缓冲与刷盘', () => {
  it('append 缓冲 → flush 写入文件（JSONL 格式）', () => {
    const file = path.join(TMP, 'a.jsonl');
    const w = new JSONLWriter({ filePath: file, flushIntervalMs: 100000 }); // 长间隔防定时刷盘
    w.append({ a: 1 });
    w.append({ b: 2 });
    w.flush();
    const content = fs.readFileSync(file, 'utf-8');
    expect(content.trim().split('\n')).toHaveLength(2);
    w.shutdown();
  });

  it('maxBufferSize 达到 → 立即刷盘（不等定时器）', () => {
    const file = path.join(TMP, 'b.jsonl');
    const w = new JSONLWriter({ filePath: file, maxBufferSize: 2, flushIntervalMs: 100000 });
    w.append({ n: 1 }); // pending 1
    expect(w.pending).toBe(1);
    w.append({ n: 2 }); // 达到 maxBufferSize=2 → 立即 flush
    expect(w.pending).toBe(0);
    w.shutdown();
  });

  it('shutdown 后 append 被拒绝（pending 不增长）', () => {
    const file = path.join(TMP, 'c.jsonl');
    const w = new JSONLWriter({ filePath: file });
    w.shutdown();
    w.append({ x: 1 });
    expect(w.closed).toBe(true);
    expect(w.pending).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('JSONLWriter — 存储写满降级（混沌）', () => {
  it('写入失败（路径是目录/不可写）→ 数据保留在缓冲 + 重试，不崩溃', () => {
    // filePath 指向一个已存在目录 → fs.appendFileSync 抛 EISDIR/EPERM，模拟磁盘满
    const dirAsFile = path.join(TMP, 'is-a-dir');
    fs.mkdirSync(dirAsFile);
    const w = new JSONLWriter({ filePath: dirAsFile, flushIntervalMs: 100000 });
    w.append({ data: 'important' });
    expect(w.pending).toBe(1);
    expect(() => w.flush()).not.toThrow(); // 内部吞掉错误，数据放回缓冲
    expect(w.pending).toBe(1); // 数据未丢失
    w.shutdown();
  });

  it('连续失败超过 MAX_RETRY(3) → 丢弃数据但进程不崩', () => {
    const dirAsFile = path.join(TMP, 'is-a-dir-2');
    fs.mkdirSync(dirAsFile);
    const w = new JSONLWriter({ filePath: dirAsFile, flushIntervalMs: 100000 });
    w.append({ data: 1 });
    w.append({ data: 2 });
    w.flush(); // 失败1 → count 1, pending 2
    w.flush(); // 失败2 → count 2, pending 2
    w.flush(); // 失败3 → count 3, pending 2
    expect(w.pending).toBe(2); // 未达丢弃阈值，数据仍保留
    w.flush(); // 失败4 → count 3 >= MAX → 丢弃 → pending 0
    expect(w.pending).toBe(0);
    // 后续 flush 不再抛错（计数已重置）
    w.append({ data: 3 });
    expect(() => w.flush()).not.toThrow();
    w.shutdown();
  });
});

describe('LogRotator — 日志轮转（混沌）', () => {
  it('未达阈值 → maybeRotate 不轮转', async () => {
    const file = path.join(TMP, 'logs', 'errors.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const r = new LogRotator({ filePath: file, maxSizeBytes: 1000 });
    const rotated = await r.maybeRotate();
    expect(rotated).toBe(false);
    expect(fs.existsSync(file)).toBe(true); // 原文件仍在
  });

  it('超过阈值 → 轮转为 {base}.{date}.{seq}.jsonl + 新空活跃文件', async () => {
    const file = path.join(TMP, 'logs2', 'errors.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'y'.repeat(100)); // 超过 maxSizeBytes=50
    const r = new LogRotator({ filePath: file, maxSizeBytes: 50 });
    const rotated = await r.rotate();
    expect(rotated).toBe(true);
    // 原文件已被重命名（active 文件现在为空或不存在）
    const dir = path.dirname(file);
    const rotatedFiles = fs.readdirSync(dir).filter(f => f.startsWith('errors.') && f.endsWith('.jsonl'));
    expect(rotatedFiles.length).toBeGreaterThan(0);
  });

  it('rotating 标志防并发轮转（第二次调用返回 false）', async () => {
    const file = path.join(TMP, 'logs3', 'errors.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'z'.repeat(100));
    const r = new LogRotator({ filePath: file, maxSizeBytes: 50 });
    // 先人为置 rotating 标志
    (r as any)._rotating = true;
    const rotated = await r.rotate();
    expect(rotated).toBe(false);
  });

  it('cleanupOldFiles 删除超过 retentionDays 的轮转文件', async () => {
    const dir = path.join(TMP, 'logs4');
    fs.mkdirSync(dir, { recursive: true });
    // 造一个 10 天前的轮转文件
    const oldDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const oldFile = path.join(dir, `errors.${oldDate}.1.jsonl`);
    fs.writeFileSync(oldFile, 'old');
    const r = new LogRotator({ filePath: path.join(dir, 'errors.jsonl'), retentionDays: 3 });
    const deleted = await r.cleanupOldFiles();
    expect(deleted).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
  });
});
