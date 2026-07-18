/**
 * MorPex v2.3 — 记忆系统 E2E 测试
 *
 * 测试记忆系统的核心 API 端点。
 *
 * 运行:
 *   cd packages/studio/ui && npx playwright test e2e/memory-tasks.spec.ts
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

test.describe('记忆统计', () => {
  test('GET /api/memory/stats 应返回统计', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/stats`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('totalEntries');
    expect(typeof body.totalEntries).toBe('number');
  });

  test('GET /api/memory-bus/stats 应返回总线统计', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory-bus/stats`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });
});

test.describe('记忆搜索', () => {
  test('GET /api/memory/search 应返回结果', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/search?q=EventBus&limit=5`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
  });

  test('空搜索词应正常响应', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/search?q=&limit=10`);
    expect(resp.status).toBe(200);
  });
});

test.describe('记忆写入与反馈', () => {
  test('POST /api/memory/feedback 应接受反馈', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memoryId: 'test', rating: 1 }),
    });
    expect(resp.status).toBe(200);
  });

  test('POST /api/memory/compact 应触发压缩', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status).toBe(200);
  });
});

test.describe('记忆摘要与临时池', () => {
  test('GET /api/memory/summary-chain 应返回摘要链', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/summary-chain`);
    expect(resp.status).toBe(200);
  });

  test('GET /api/memory/temp-pool 应返回临时池', async () => {
    const resp = await fetch(`${BACKEND_URL}/api/memory/temp-pool`);
    expect(resp.status).toBe(200);
  });
});
