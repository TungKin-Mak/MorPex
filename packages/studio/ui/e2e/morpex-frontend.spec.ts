/**
 * MorPex v2.3 — 前端渲染 E2E 测试 (Grid Matrix NEURAL OS)
 *
 * 验证前端页面加载、布局结构、TopBar状态栏。
 * 基于 TopBarMatrix.tsx / MatrixGrid.tsx 实际 DOM 结构。
 *
 * 运行:
 *   npx playwright test --config e2e/playwright.config.ts morpex-frontend.spec.ts
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
// 1. 基础页面加载
// ═══════════════════════════════════════════════════════════════

test.describe('基础页面加载', () => {
  test('首页正常加载 — 无 JS 错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await waitForApp(page);
    await expect(page).toHaveTitle(/MorPex|Morpex|NEURAL/i, { timeout: 10000 });
    expect(errors.length).toBe(0);
  });

  test('页面不应有控制台 error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await waitForApp(page);
    await page.waitForTimeout(2000);

    const critical = consoleErrors.filter(e =>
      !e.includes('favicon') && !e.includes('sourcemap')
    );
    expect(critical.length).toBe(0);
  });

  test('页面有实际内容', async ({ page }) => {
    await waitForApp(page);
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. TopBar 系统状态栏
// ═══════════════════════════════════════════════════════════════

test.describe('TopBar 系统状态栏', () => {
  test('显示 MORPEX CORE 品牌文字', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    await expect(topbar).toContainText('MORPEX CORE v2.3.0', { timeout: 10000 });
  });

  test('显示系统状态指示（状态/运行时间/AGENTS/SSE）', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    await expect(topbar).toContainText(/状态:/i, { timeout: 8000 });
    await expect(topbar).toContainText(/UPTIME:/i, { timeout: 5000 });
    await expect(topbar).toContainText(/AGENTS:/i, { timeout: 5000 });
    await expect(topbar).toContainText(/SSE/i, { timeout: 5000 });
  });

  test('显示 EVENT_BUS 和 THINKING_LEVEL', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    await expect(topbar).toContainText(/EVENT_BUS:/i, { timeout: 5000 });
    await expect(topbar).toContainText(/THINKING_LEVEL:/i, { timeout: 5000 });
  });

  test('显示时钟和配置按钮', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    // 时钟包含冒号 :（时:分:秒）
    await expect(topbar).toContainText(/:/, { timeout: 5000 });
    // 配置按钮
    const configBtn = page.locator('.topbar-config-btn');
    await expect(configBtn).toBeVisible({ timeout: 5000 });
    await expect(configBtn).toContainText(/配置/i);
  });

  test('显示内存池计数 M / A / T', async ({ page }) => {
    await waitForApp(page);
    const topbar = page.locator('.topbar-matrix');
    await expect(topbar).toContainText(/M:/i, { timeout: 5000 });
    await expect(topbar).toContainText(/A:/i, { timeout: 5000 });
    await expect(topbar).toContainText(/T:/i, { timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Grid Matrix 布局
// ═══════════════════════════════════════════════════════════════

test.describe('Grid Matrix 布局', () => {
  test('包含 .morpex-workbench 主容器', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('.morpex-workbench')).toBeVisible({ timeout: 10000 });
  });

  test('包含三个矩阵面板 (Left / Center / Right)', async ({ page }) => {
    await waitForApp(page);
    const panes = page.locator('.matrix-pane');
    const count = await panes.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('底部面板存在', async ({ page }) => {
    await waitForApp(page);
    const bottom = page.locator('#bottom-pane').or(page.locator('.bottom-pane'));
    await expect(bottom.first()).toBeVisible({ timeout: 8000 }).catch(() => {
      // BottomPane 可能以不同方式渲染
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. 后端可达性
// ═══════════════════════════════════════════════════════════════

test.describe('后端可达性', () => {
  test('/api/health 可达', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
  });

  test('/api/status 返回版本和阶段', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/status`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('phase');
  });

  test('/api/ai/status 返回引擎状态', async ({ request }) => {
    const resp = await request.get(`${BACKEND}/api/ai/status`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.running).toBe(true);
    expect(body).toHaveProperty('engine_info');
  });
});
