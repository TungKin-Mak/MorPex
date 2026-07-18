/**
 * MorPex v2.3 — 跨领域与知识图谱 API 测试
 *
 * 测试跨领域和知识端点。
 *
 * 运行:
 *   cd packages/studio/ui && npx playwright test e2e/cli-workflow.spec.ts
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

test.describe('跨领域', () => {
  test('GET /api/domains 应返回领域列表', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/domains`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });

  test('GET /api/domains/events 应返回事件类型', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/domains/events`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });
});

test.describe('知识图谱', () => {
  test('GET /api/knowledge-graph/data 应返回图数据', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/knowledge-graph/data`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
  });
});
