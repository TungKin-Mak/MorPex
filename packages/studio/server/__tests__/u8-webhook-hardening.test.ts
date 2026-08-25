/**
 * u8-webhook-hardening.test.ts — P0-1 webhook 加固三件套测试
 * ① HookDedup 单元（记录/判重/TTL 清理）② 固定窗口限流器 ③ 路由级：body 上限 + 去重幂等
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudioServer } from '../StudioServer.js';
import { HookDedup, createFixedWindowLimiter, HOOK_GOAL_MAX_CHARS } from '../hook-hardening.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let server: StudioServer;
let baseUrl: string;
let tmpDataDir: string;
const SECRET = 'u8-hardening-secret';

beforeAll(async () => {
  process.env.MEMORY_ENGINE = 'mock';
  process.env.MORPEX_HOOK_SECRET = SECRET;
  process.env.MORPEX_HOOK_RATE_LIMIT = '100'; // 路由级测试放宽限流，避免与专测互相干扰
  // 数据目录隔离：不污染真实 data/（去重表落在临时目录）
  tmpDataDir = mkdtempSync(join(tmpdir(), 'u8-data-'));
  process.env.MORPEX_DATA_DIR = tmpDataDir;
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;
}, 300000);

afterAll(async () => {
  delete process.env.MORPEX_HOOK_SECRET;
  delete process.env.MORPEX_HOOK_RATE_LIMIT;
  delete process.env.MORPEX_DATA_DIR;
  await server?.stop();
  try { rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* Windows 句柄滞后 */ }
});

describe('HookDedup 单元', () => {
  it('record→isKnown；TTL 外的旧记录加载时被清理', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u8-'));
    const file = join(dir, 'hooks-dedup.json');
    // 预置一个 8 天前的旧记录
    const stale = { 'old-evt': { at: Date.now() - 8 * 86_400_000 } };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify(stale));

    const d = new HookDedup(file, 7);
    expect(d.isKnown('old-evt')).toBe(false); // 旧记录被清理
    d.record('new-evt');
    expect(d.isKnown('new-evt')).toBe(true);
    expect(existsSync(file)).toBe(true);
    const persisted = JSON.parse(readFileSync(file, 'utf-8'));
    expect(persisted['new-evt']).toBeDefined(); // 原子落盘
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('固定窗口限流器', () => {
  it('窗口内放行 N 次后拒绝', () => {
    const allow = createFixedWindowLimiter(3);
    expect(allow('k')).toBe(true);
    expect(allow('k')).toBe(true);
    expect(allow('k')).toBe(true);
    expect(allow('k')).toBe(false); // 第 4 次 → 拒
  });
});

describe('路由级加固（真实 HTTP）', () => {
  it(`goal 超长（>${HOOK_GOAL_MAX_CHARS}）→ 413`, async () => {
    const r = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': SECRET },
      body: JSON.stringify({ goal: 'x'.repeat(HOOK_GOAL_MAX_CHARS + 1) }),
    });
    expect(r.status).toBe(413);
  });

  it('event-id 去重短路：已记录的 id 直接 200 dedup:true（不委派，秒回）', async () => {
    // 预种子去重表（server 懒初始化时读取）——不真触发执行链
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(tmpDataDir, { recursive: true });
    writeFileSync(join(tmpDataDir, 'hooks-dedup.json'), JSON.stringify({ 'evt-pre': { at: Date.now() } }));
    const r = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': SECRET, 'x-morpex-event-id': 'evt-pre' },
      body: JSON.stringify({ goal: '不应被执行的目标', eventId: 'evt-pre' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { dedup?: boolean };
    expect(body.dedup).toBe(true);
  }, 15000);

  it('未见过的新 event-id 不误判为重复（缺 goal 走 400，响应无 dedup 标记）', async () => {
    const r = await fetch(`${baseUrl}/api/hooks/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-morpex-secret': SECRET, 'x-morpex-event-id': 'evt-fresh' },
      body: JSON.stringify({ eventId: 'evt-fresh' }), // 无 goal → 400（在去重记账之前拦截）
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { dedup?: boolean };
    expect(body.dedup).toBeUndefined(); // 新 id 不应被判重
  });
});
