/**
 * 编排组件会话治理 API 测试（Session 化治理读取端点）
 *
 * 覆盖：
 *   1. GET /api/agent-sessions：列表（全部 + ?component= 过滤 + 非法 component 400）
 *   2. GET /api/agent-sessions/entries?path=：读取会话条目（归一化）
 *   3. entries 缺 path → 400
 *
 * 只测 HTTP 读取层，不触发 execute/LLM（bootstrap 后仅 GET 静态读接口）。
 * 测试用 os.tmpdir() 临时会话（真实 JsonlSessionRepo 落盘），服务端 store 按 path 打开任意会话。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StudioServer } from '../StudioServer.js';
import { AgentSessionStore } from '../../../core/src/execution/orchestration/AgentSessionStore.js';

let server: StudioServer;
let baseUrl: string;
let testSessionPath = '';

beforeAll(async () => {
  process.env.MEMORY_ENGINE = 'mock';
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;

  // 用临时目录建一个真实会话（含 custom + message 条目），供 entries 路由读取
  const tmpRoot = path.join(os.tmpdir(), `morpex-agent-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const store = new AgentSessionStore(tmpRoot);
  const handle = await store.createSession({ component: 'step-agent', id: 'api_step', goal: '测试目标' });
  await store.appendCustom(handle.session, 'step-result', { nodeId: 'n1', success: true, outputPreview: 'ok' });
  await (handle.session as { appendMessage(m: unknown): Promise<string> }).appendMessage({ role: 'user', content: '执行步骤' });
  testSessionPath = handle.path;
}, 300000);

afterAll(async () => {
  await server?.stop();
  delete process.env.MEMORY_ENGINE;
  if (testSessionPath) {
    try { fs.rmSync(path.dirname(path.dirname(testSessionPath)), { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}, 15000);

async function getJson(p: string) {
  const res = await fetch(`${baseUrl}${p}`);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('GET /api/agent-sessions — 编排组件会话列表', () => {
  it('返回 ok + sessions 数组（含组件过滤）', async () => {
    const { status, body } = await getJson('/api/agent-sessions');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('?component=step-agent 过滤正常返回', async () => {
    const { status, body } = await getJson('/api/agent-sessions?component=step-agent');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('非法 component → 400', async () => {
    const { status } = await getJson('/api/agent-sessions?component=hacker');
    expect(status).toBe(400);
  });
});

describe('GET /api/agent-sessions/entries — 会话条目读取', () => {
  it('按 path 读取真实会话条目（归一化：custom + message）', async () => {
    const { status, body } = await getJson(`/api/agent-sessions/entries?path=${encodeURIComponent(testSessionPath)}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.path).toBe(testSessionPath);
    const entries = body.entries as Array<Record<string, unknown>>;
    expect(Array.isArray(entries)).toBe(true);

    const types = entries.map(e => e.type);
    expect(types).toContain('custom');
    expect(types).toContain('message');
    const custom = entries.find(e => e.type === 'custom') as { customType?: string; data?: { nodeId?: string } };
    expect(custom?.customType).toBe('step-result');
    expect(custom?.data?.nodeId).toBe('n1');
  });

  it('缺 path → 400', async () => {
    const { status } = await getJson('/api/agent-sessions/entries');
    expect(status).toBe(400);
  });

  it('不存在的 path → ok + 空数组（容错不 500）', async () => {
    const { status, body } = await getJson('/api/agent-sessions/entries?path=/nonexistent/nope.jsonl');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entries).toEqual([]);
  });
});
