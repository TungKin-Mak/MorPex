/**
 * SSE 真实推送 + /api/execute 闭环 E2E（L4 接口面）— 此前仅验证端点存在，无真实事件流断言
 *
 * 覆盖：
 *   - /api/stream/global：建立连接收到 connected 首帧 + 后续真实事件推送
 *   - POST /api/execute 触发 UnifiedExecutionEngine → EventBus 广播 projected 事件
 *     → SSE 客户端实时收到 execution.engine.started（闭环：HTTP 执行 → 事件流透传）
 *
 * ⚠️ 竞态防护：必须**先读到 connected 帧**（服务端 onProjected 已订阅）再触发 execute，
 *    否则 started 事件可能在订阅建立前被发出而丢失。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudioServer } from '../StudioServer.js';

let server: StudioServer;
let baseUrl: string;

beforeAll(async () => {
  process.env.MEMORY_ENGINE = 'mock';
  server = new StudioServer({ port: 0, sessionsRoot: undefined });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.getPort()}`;
}, 180000);

afterAll(async () => {
  await server?.stop();
  delete process.env.MEMORY_ENGINE;
}, 60000);

interface SseSession {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  frames: string[];
}

/** 建立 SSE 连接并读到 connected 帧（确保服务端 onProjected 已订阅），返回会话 */
async function openSseAndWaitConnected(timeoutMs = 10000): Promise<SseSession> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/stream/global`, { signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')?.toLowerCase()).toContain('text/event-stream');

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const session: SseSession = { controller, reader, decoder, buffer: '', frames: [] };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    session.buffer += decoder.decode(value, { stream: true });
    session.frames.push(...session.buffer.split('\n\n').filter(f => f.trim()));
    if (session.buffer.includes('connected')) return session;
  }
  throw new Error('SSE 未在超时内收到 connected 首帧');
}

/** 从已建立会话继续读流直到命中目标事件类型 */
async function readUntilType(session: SseSession, targetType: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await session.reader.read();
    if (done) return false;
    session.buffer += session.decoder.decode(value, { stream: true });
    while (session.buffer.includes('\n\n')) {
      const idx = session.buffer.indexOf('\n\n');
      const frame = session.buffer.slice(0, idx).trim();
      session.buffer = session.buffer.slice(idx + 2);
      if (!frame) continue;
      session.frames.push(frame);
      const dataMatch = frame.match(/^data: (.+)$/m);
      if (!dataMatch) continue;
      try {
        const parsed = JSON.parse(dataMatch[1]);
        if (parsed.type === targetType) return true;
      } catch { /* heartbeat/comment 帧忽略 */ }
    }
  }
  return false;
}

async function closeSession(s: SseSession): Promise<void> {
  try { await s.reader.cancel(); } catch { /* ignore */ }
  s.controller.abort();
}

describe('SSE 真实推送（/api/stream/global）', () => {
  it('建立连接收到 connected 首帧', async () => {
    const s = await openSseAndWaitConnected();
    await closeSession(s);
  }, 15000);
});

describe('SSE + /api/execute 闭环', () => {
  it('POST /api/execute → SSE 实时收到 execution.engine.started 事件', async () => {
    // 1. 建立 SSE 连接并确保订阅就绪（读到 connected）
    const s = await openSseAndWaitConnected();

    // 2. 触发执行（不 await：started 事件在 engine.execute 开头同步发射，
    //    此时执行可能持续数秒（多 Agent 编排多轮 LLM），SSE 应实时先收到）
    const execPromise = fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '写一个 todo 应用的代码实现' }),
    });

    // 3. SSE 应命中 started 事件（闭环：HTTP 执行 → 事件流透传）
    try {
      const hit = await readUntilType(s, 'execution.engine.started', 30000);
      expect(hit).toBe(true);
      expect(s.frames.some(f => f.includes('execution.engine.started'))).toBe(true);

      // 4. 等待执行完成，校验响应契约
      const execRes = await execPromise;
      expect(execRes.status).toBe(200);
      const execBody = await execRes.json();
      expect(execBody.executionId).toBeTruthy();
    } finally {
      await closeSession(s);
    }
  }, 180000);
});
