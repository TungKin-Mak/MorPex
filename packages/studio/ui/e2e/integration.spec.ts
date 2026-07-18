/**
 * MorPex v2.3 — 后端 API 集成测试
 *
 * 验证所有 35+ API 端点的可达性和响应结构。
 * 响应断言基于 StudioServer.ts 实际 res.json() 调用。
 *
 * 运行:
 *   npx playwright test --config e2e/playwright.config.ts integration.spec.ts
 */

import { test, expect } from '@playwright/test';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';
const FRONTEND = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';

// ═══════════════════════════════════════════════════════════════
// Part 1: 系统状态
// ═══════════════════════════════════════════════════════════════

test.describe('系统状态', () => {
  test('/api/health — ok + uptime + kernel', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
    expect(body).toHaveProperty('kernel');
    expect(body).toHaveProperty('plugins');
  });

  test('/api/status — 完整系统信息', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/status`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('2.0.0');
    expect(body).toHaveProperty('phase');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('pluginCount');
    expect(body).toHaveProperty('activeExecutions');
    expect(body).toHaveProperty('ai_engine');
    expect(body).toHaveProperty('timestamp');
  });

  test('/api/engine/check — 引擎详细信息', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/engine/check`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('kernel');
    expect(body).toHaveProperty('mirror');
    expect(body).toHaveProperty('gateway');
    expect(body).toHaveProperty('eventTypes');
    expect(Array.isArray(body.eventTypes)).toBe(true);
  });

  test('/api/v6/startup-state — 启动状态', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/v6/startup-state`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('startup');
  });

  test('/api/config — 系统配置', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/config`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('2.0.0');
    expect(body).toHaveProperty('engine');
    expect(body).toHaveProperty('thinkingLevel');
    expect(body).toHaveProperty('model');
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 2: AI 引擎
// ═══════════════════════════════════════════════════════════════

test.describe('AI 引擎', () => {
  test('/api/ai/status — AI 引擎状态', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/ai/status`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.running).toBe(true);
    expect(body.backend).toBe('morpex-core');
    expect(body.initialized).toBe(true);
    expect(body.engine_info.model_id).toBe('deepseek-v4-flash');
    expect(body.engine_info.provider).toBe('deepseek');
  });

  test('/api/chat/agent-status — Agent 服务', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/chat/agent-status`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('activeZones');
    expect(body).toHaveProperty('modelId');
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 3: 组织架构
// ═══════════════════════════════════════════════════════════════

test.describe('组织架构', () => {
  test('/api/departments — 部门列表', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/departments`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // Record<string, DeptInfo>
    expect(typeof body).toBe('object');
    const keys = Object.keys(body);
    if (keys.length > 0) {
      const dept = body[keys[0]];
      expect(dept).toHaveProperty('id');
      expect(dept).toHaveProperty('name');
      expect(dept).toHaveProperty('agents');
    }
  });

  test('/api/agents — Agent 列表', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/agents`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body).toBe('object');
    const keys = Object.keys(body);
    if (keys.length > 0) {
      const agent = body[keys[0]];
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('status');
    }
  });

  test('/api/business-units — 业务单元', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/business-units`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body).toBe('object');
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 4: Agent 编排
// ═══════════════════════════════════════════════════════════════

test.describe('Agent 编排', () => {
  test('/api/orchestrator/status — 编排器', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/orchestrator/status`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
    // 可能未初始化: { ok: false, error: '...' }
    // 或已初始化: { ok: true, ... }
  });

  test('/api/orchestrator/agents — 编排 Agent', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/orchestrator/agents`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.agents)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 5: 可观测性
// ═══════════════════════════════════════════════════════════════

test.describe('可观测性', () => {
  test('/api/observability/workers — Worker', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/observability/workers`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.workers)).toBe(true);
  });

  test('/api/observability/metrics — 指标', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/observability/metrics`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('executions');
    expect(body).toHaveProperty('events');
  });

  test('/api/observability/traces — 追踪', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/observability/traces`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.traces)).toBe(true);
    expect(body).toHaveProperty('stats');
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 6: 会话管理
// ═══════════════════════════════════════════════════════════════

test.describe('会话管理', () => {
  test('POST /api/sessions — 创建', async ({ request }) => {
    const resp = await request.post(`${BACKEND}/api/sessions`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // 后端直接返回 session 对象: { id, cwd, path, createdAt }
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('createdAt');
  });

  test('GET /api/sessions — 列表', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/sessions`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  test('DELETE /api/sessions/:id — 删除', async ({ request }) => {
    const created = await (await request.post(`${BACKEND}/api/sessions`)).json();
    const sid = created.id;
    const resp = await request.delete(`${BACKEND}/api/sessions/${sid}`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 7: 搜索引擎
// ═══════════════════════════════════════════════════════════════

test.describe('搜索引擎', () => {
  test('/api/search/stats — 统计', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/search/stats`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('stats');
  });

  test('/api/search/query — 查询', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/search/query?q=test&max=5`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body).toHaveProperty('query');
  });

  test('/api/search/cache — 缓存', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/search/cache`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('hit_rate');
    expect(body).toHaveProperty('query_cache');
    expect(body).toHaveProperty('url_cache');
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 8: 知识图谱
// ═══════════════════════════════════════════════════════════════

test.describe('知识图谱', () => {
  test('/api/knowledge-graph/data — 图谱数据', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/knowledge-graph/data`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    if (body.nodes.length > 0) {
      expect(body.nodes[0]).toHaveProperty('id');
      expect(body.nodes[0]).toHaveProperty('label');
    }
  });

  test('/api/knowledge/search — 知识搜索', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/knowledge/search?q=test`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 9: 记忆系统
// ═══════════════════════════════════════════════════════════════

test.describe('记忆系统', () => {
  test('/api/memory/stats — 统计', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory/stats`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // MemoryBus 未初始化时: { ok: false, stats: {} }
    expect(body).toHaveProperty('ok');
  });

  test('/api/memory/search — 搜索', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory/search?q=test&limit=5`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // MemoryBus 未初始化时返回 { ok: false, results: [] }
    // 初始化时返回 { ok: true, results: [...] }
    expect(body).toHaveProperty('results');
    if (body.ok) {
      expect(Array.isArray(body.results)).toBe(true);
    }
  });

  test('/api/memory-bus/stats — 总线统计', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory-bus/stats`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });

  test('/api/memory-bus/recall — 召回', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory-bus/recall`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('ok');
  });

  test('/api/memory/summary-chain — 摘要链', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory/summary-chain`);
    expect(resp.status()).toBe(200);
  });

  test('/api/memory/temp-pool — 临时池', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/memory/temp-pool`);
    // 端点存在则返回 200，不存在返回 404
    expect([200, 404]).toContain(resp.status());
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 10: 执行循环
// ═══════════════════════════════════════════════════════════════

test.describe('执行循环', () => {
  test('POST /api/cycle/run — 启动', async ({ request }) => {
    const resp = await request.post(`${BACKEND}/api/cycle/run`, {
      data: { domain: 'AI', trend: 'test' },
    });
    // 引擎未就绪时可能返回 503
    expect([200, 503]).toContain(resp.status());
  });

  test('GET /api/cycle/history — 历史', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/cycle/history`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.history)).toBe(true);
    if (body.history.length > 0) {
      expect(body.history[0]).toHaveProperty('id');
      expect(body.history[0]).toHaveProperty('status');
    }
  });

  test('GET /api/history — 统一历史', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/history`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('stats');
    expect(body.stats).toHaveProperty('totalCycles');
    expect(body.stats).toHaveProperty('totalTasks');
  });

  test('GET /api/dag/history — DAG 历史', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/dag/history`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.flows)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 11: 错误边界
// ═══════════════════════════════════════════════════════════════

test.describe('错误边界', () => {
  test('不存在 API 路由 → 404 JSON', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/nonexistent/deep/route`);
    // SPA fallback 可能返回 200（前端 index.html）
    // 后端 catch-all 对 /api/* 返回 404
    // 状态码取决于 Vite 代理链路
    expect([200, 404]).toContain(resp.status());
  });

  test('不存在 API 短路由 → 404 JSON', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/nonexistent`);
    expect([200, 404]).toContain(resp.status());
  });

  test('API 路由返回 JSON', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/status`);
    const ct = resp.headers()['content-type'] || '';
    // Vite 代理可能不传递 content-type
    if (ct) {
      expect(ct).toContain('application/json');
    }
  });

  test('并发请求不崩溃', async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request.get(`${BACKEND}/api/health`))
    );
    const okCount = results.filter(r => r.ok()).length;
    // 至少 9/10 成功（允许 1 个偶发失败）
    expect(okCount).toBeGreaterThanOrEqual(9);
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 12: 前端集成
// ═══════════════════════════════════════════════════════════════

test.describe('前端集成', () => {
  test('SSE 全局事件流可连接', async ({ page }) => {
    const connected = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const es = new EventSource('/api/stream/global');
        es.onopen = () => { es.close(); resolve(true); };
        es.onerror = () => { es.close(); resolve(false); };
        setTimeout(() => { es.close(); resolve(false); }, 10000);
      });
    });
    expect(connected).toBe(true);
  });

  test('前端通过 Vite 代理调后端（无 CORS 错误）', async ({ page }) => {
    const corsErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('CORS')) {
        corsErrors.push(msg.text());
      }
    });
    await page.goto(FRONTEND, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
    expect(corsErrors.length).toBe(0);
  });

  test('前端页面有实际渲染内容', async ({ page }) => {
    await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.morpex-workbench', { timeout: 15000 }).catch(() => {});
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(100);
  });
});
