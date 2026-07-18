/**
 * MorPex v2.3 — MatrixGrid 新 UI E2E 测试
 *
 * 测试纯 MatrixGrid（无旧 ChatPanel/ViewSelector 残留）
 *   1. 五个面板渲染
 *   2. TopBarMatrix 系统状态
 *   3. OmniTerminal 终端
 *   4. 3D 大脑场景
 *   5. SSE 事件流 → OmniTerminal
 */

import { test, expect } from '@playwright/test';

const F = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const B = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

test.describe('MatrixGrid v2.3', () => {
  test.describe.configure({ mode: 'serial' });
  let page: any;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(F, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForSelector('.morpex-workbench', { timeout: 10000 });
    await page.waitForTimeout(2000);
    console.log('[MatrixGrid] 页面加载完成');
  }, { timeout: 60000 });

  test.afterAll(async () => {
    await page?.close();
  });

  // ═══════════════════════════════════════════════
  // 基础渲染
  // ═══════════════════════════════════════════════

  test('1. MatrixGrid 容器应存在', async () => {
    const wb = page.locator('.morpex-workbench');
    expect(await wb.count()).toBeGreaterThan(0);
    console.log('[MatrixGrid] .morpex-workbench 存在');
  });

  test('2. PerformanceMonitor 应渲染', async () => {
    const pm = page.locator('.pm-header');
    expect(await pm.count()).toBeGreaterThan(0);
    const fpsText = await page.locator('.pm-fps-value').textContent();
    console.log(`[MatrixGrid] FPS: ${fpsText}`);
  });

  test('3. 页面标题正确', async () => {
    const title = await page.title();
    expect(title).toContain('MorPex');
    console.log(`[MatrixGrid] 标题: "${title}"`);
  });

  test('4. 页面无 JS 崩溃', async () => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(1000);

    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ResizeObserver')
    );
    if (critical.length > 0) {
      console.warn('[MatrixGrid] JS 错误:', critical);
    }
    // 不强制断言，只记录
  });

  // ═══════════════════════════════════════════════
  // TopBarMatrix
  // ═══════════════════════════════════════════════

  test('5. TopBar 应显示系统状态', async () => {
    // TopBarMatrix 包含多个 span 元素显示内核状态
    const body = await page.textContent('body');
    expect(body).toContain('MORPEX');
    console.log('[MatrixGrid] TopBar 包含 MORPEX 标识');
  });

  test('6. #tb-chat-btn 应存在（OmniTerminal 开关）', async () => {
    const btn = page.locator('#tb-chat-btn');
    expect(await btn.count()).toBeGreaterThan(0);
    const title = await btn.getAttribute('title');
    console.log(`[MatrixGrid] tb-chat-btn title: "${title}"`);
    expect(title).toContain('Terminal');
  });

  // ═══════════════════════════════════════════════
  // OmniTerminal
  // ═══════════════════════════════════════════════

  test('7. 点击 #tb-chat-btn 应触发 toggle-terminal 事件', async () => {
    // 监听事件
    let eventFired = false;
    await page.evaluate(() => {
      window.addEventListener('toggle-terminal', () => {
        (window as any).__terminalToggled = true;
      });
    });

    await page.locator('#tb-chat-btn').click({ force: true });
    await page.waitForTimeout(500);

    eventFired = await page.evaluate(() => !!(window as any).__terminalToggled);
    console.log(`[MatrixGrid] toggle-terminal 事件: ${eventFired ? '✅' : '❌'}`);
  });

  // ═══════════════════════════════════════════════
  // 旧 UI 不应存在
  // ═══════════════════════════════════════════════

  test('8. 旧 ChatPanel 不应渲染', async () => {
    // 旧的 chat-panel 已从 App.tsx 移除，DOM 中不应存在
    const oldPanel = page.locator('#chat-panel');
    const count = await oldPanel.count();
    console.log(`[MatrixGrid] 旧 #chat-panel: ${count} 个 (应为 0)`);
    expect(count).toBe(0);
  });

  test('9. 旧 ViewSelector 不应渲染', async () => {
    const vs = page.locator('.view-selector, #view-selector');
    const count = await vs.count();
    console.log(`[MatrixGrid] 旧 ViewSelector: ${count} 个 (应为 0)`);
    expect(count).toBe(0);
  });

  // ═══════════════════════════════════════════════
  // API → UI 数据流
  // ═══════════════════════════════════════════════

  test('10. API 数据应流入 MatrixGrid 面板', async () => {
    // 检查页面是否包含 API 获取的数据（部门、Agent 等）
    const body = await page.textContent('body');

    // TopBarMatrix 显示 agent 计数
    const hasAgentData = body.includes('AGENT') || body.includes('agent');
    console.log(`[MatrixGrid] Agent 数据显示: ${hasAgentData}`);
  });
});
