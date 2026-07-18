/**
 * MorPex v2.3 — 用户操作工作流 E2E 测试
 *
 * 模拟真实用户操作：打开应用、查看状态、聊天交互。
 * 基于 App.tsx / TopBarMatrix.tsx / MatrixGrid.tsx 实际 DOM。
 *
 * 运行:
 *   npx playwright test --config e2e/playwright.config.ts user-workflow.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

async function waitForApp(page: Page) {
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.morpex-workbench', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

// ═══════════════════════════════════════════════════════════════
// 操作流 1: 用户打开应用
// ═══════════════════════════════════════════════════════════════

test.describe('操作流 1: 用户打开应用', () => {
  test('1.1 页面完整加载无 JS 严重错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        // 仅记录不失败
      }
    });
    await waitForApp(page);
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(100);
    expect(errors.length).toBe(0);
  });

  test('1.2 TopBar 显示 MORPEX CORE', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('.topbar-matrix')).toContainText('MORPEX CORE', { timeout: 10000 });
  });

  test('1.3 状态指示器显示系统阶段', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    await expect(topbar).toContainText(/\[.*\]/, { timeout: 8000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 操作流 2: 前后端数据流
// ═══════════════════════════════════════════════════════════════

test.describe('操作流 2: 前后端数据流', () => {
  test('2.1 系统状态 → AI 引擎 → Agent 列表', async ({ request }) => {
    const s = await (await request.get(`${BACKEND}/api/status`)).json();
    expect(s.ok).toBe(true);
    expect(s).toHaveProperty('phase');

    const ai = await (await request.get(`${BACKEND}/api/ai/status`)).json();
    expect(ai.running).toBe(true);

    const agents = await (await request.get(`${BACKEND}/api/agents`)).json();
    expect(typeof agents).toBe('object');
  });

  test('2.2 创建会话 → 查询 → 删除', async ({ request }) => {
    const created = await (await request.post(`${BACKEND}/api/sessions`)).json();
    expect(created).toHaveProperty('id');
    const sid = created.id;

    const list = await (await request.get(`${BACKEND}/api/sessions`)).json();
    expect(Array.isArray(list.sessions)).toBe(true);

    const deleted = await (await request.delete(`${BACKEND}/api/sessions/${sid}`)).json();
    expect(deleted.ok).toBe(true);
  });

  test('2.3 搜索引擎全链路', async ({ request }) => {
    const stats = await (await request.get(`${BACKEND}/api/search/stats`)).json();
    expect(stats.ok).toBe(true);

    const query = await (await request.get(`${BACKEND}/api/search/query?q=test&max=3`)).json();
    expect(Array.isArray(query.results)).toBe(true);

    const cache = await (await request.get(`${BACKEND}/api/search/cache`)).json();
    expect(cache.ok).toBe(true);
  });

  test('2.4 可观测性全链路', async ({ request }) => {
    const w = await (await request.get(`${BACKEND}/api/observability/workers`)).json();
    expect(w.ok).toBe(true);
    expect(Array.isArray(w.workers)).toBe(true);

    const m = await (await request.get(`${BACKEND}/api/observability/metrics`)).json();
    expect(m.ok).toBe(true);
    expect(m).toHaveProperty('executions');

    const t = await (await request.get(`${BACKEND}/api/observability/traces`)).json();
    expect(t.ok).toBe(true);
    expect(Array.isArray(t.traces)).toBe(true);
  });

  test('2.5 配置读取与写入', async ({ request }) => {
    const get = await (await request.get(`${BACKEND}/api/config`)).json();
    expect(get.ok).toBe(true);
    expect(get).toHaveProperty('version');

    const put = await (await request.put(`${BACKEND}/api/config`, { data: { test: 1 } })).json();
    expect(put.ok).toBe(true);
  });

  test('2.6 知识图谱', async ({ request }) => {
    const kg = await (await request.get(`${BACKEND}/api/knowledge-graph/data`)).json();
    expect(Array.isArray(kg.nodes)).toBe(true);
    expect(Array.isArray(kg.edges)).toBe(true);
  });

  test('2.7 编排器状态', async ({ request }) => {
    const o = await (await request.get(`${BACKEND}/api/orchestrator/status`)).json();
    expect(o).toHaveProperty('ok');

    const oa = await (await request.get(`${BACKEND}/api/orchestrator/agents`)).json();
    expect(Array.isArray(oa.agents)).toBe(true);
  });

  test('2.8 图形历史', async ({ request }) => {
    const dh = await (await request.get(`${BACKEND}/api/dag/history`)).json();
    expect(dh.ok).toBe(true);
    expect(Array.isArray(dh.flows)).toBe(true);

    const ch = await (await request.get(`${BACKEND}/api/cycle/history`)).json();
    expect(ch.ok).toBe(true);
    expect(Array.isArray(ch.history)).toBe(true);
  });

  test('2.9 记忆系统', async ({ request }) => {
    const ms = await (await request.get(`${BACKEND}/api/memory/stats`)).json();
    expect(ms).toHaveProperty('ok');

    const mq = await (await request.get(`${BACKEND}/api/memory/search?q=test`)).json();
    expect(mq).toHaveProperty('results');
    if (mq.ok) {
      expect(Array.isArray(mq.results)).toBe(true);
    }

    const mb = await (await request.get(`${BACKEND}/api/memory-bus/stats`)).json();
    expect(mb).toHaveProperty('ok');
  });
});

// ═══════════════════════════════════════════════════════════════
// 操作流 3: 错误边界
// ═══════════════════════════════════════════════════════════════

test.describe('操作流 3: 错误边界', () => {
  test('3.1 不存在 API 返回 404 JSON', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/nonexistent`);
    expect(resp.status()).toBe(404);
    const ct = resp.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });

  test('3.2 恶意路径不泄露密钥', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/../../../etc/passwd`);
    const body = await resp.text();
    expect(body).not.toContain('DEEPSEEK_API_KEY');
  });

  test('3.3 健康检查始终 200', async ({ request }) => {
    for (let i = 0; i < 3; i++) {
      const resp = await request.get(`${BACKEND}/api/health`);
      expect(resp.status()).toBe(200);
    }
  });
});
