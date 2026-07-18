/**
 * MorPex v2.3 — 聊天与执行 API 测试
 *
 * 测试聊天和执行端点。
 *
 * 运行:
 *   cd packages/studio/ui && npx playwright test e2e/cli-tool-workflow.spec.ts
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

test.describe('聊天 API', () => {
  test('POST /api/chat/agent-send 应接受消息', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/chat/agent-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', zone: 'chat' }),
    });
    expect([200, 202]).toContain(resp.status);
  });

  test('GET /api/chat/agent-status 应返回状态', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/chat/agent-status`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });
});

test.describe('执行引擎', () => {
  test('POST /api/execute 应接受任务', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentRole: 'assistant', input: 'test' }),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('status');
  });

  test('GET /api/artifacts 应返回产物', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/artifacts`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });
});
