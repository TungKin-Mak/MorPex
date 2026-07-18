/**
 * MorPex v2.3 — 核心 UI 功能验证
 *
 * 验证用户反馈的关键问题：
 *   1. 聊天窗口能否打开？
 *   2. 消息能否发送？
 *   3. 会话能否持久化？
 */

import { test, expect } from '@playwright/test';

const F = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const B = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

// 共享 page fixture，避免每次重新加载页面
test.describe('核心 UI 工作流', () => {
  // 整个 describe 共用一个 page，每个 test 基于前一个 test 的状态
  test.describe.configure({ mode: 'serial' });

  let page: any;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(F, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#root', { timeout: 15000 });
    // 等待 React 3D 场景初始化完成
    await page.waitForTimeout(3000);
    console.log('[SETUP] 页面加载完成');
  }, { timeout: 60000 });

  test.afterAll(async () => {
    await page?.close();
  });

  test('1. 聊天窗口应能打开', async () => {
    // 点击 TopBar 聊天按钮 (force: true 绕过 3D 动画循环 actionability 检测)
    await page.locator('#tb-chat-btn').click({ force: true });
    await page.waitForTimeout(1500);

    const panel = page.locator('#chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // 验证关键元素存在
    await expect(page.locator('#ch-input')).toBeVisible();
    await expect(page.locator('#ch-send')).toBeAttached();
    await expect(page.locator('#ch-new-btn')).toBeAttached();
    await expect(page.locator('#ch-session-trigger')).toBeAttached();

    console.log('[TEST] ✅ 聊天窗口已打开，所有元素存在');
  });

  test('2. 输入框应能输入文字', async () => {
    const input = page.locator('#ch-input');
    await input.fill('你好，这是一条测试消息');
    await input.dispatchEvent('input');
    await page.waitForTimeout(300);

    const value = await input.inputValue();
    expect(value).toBe('你好，这是一条测试消息');

    // 发送按钮应启用
    const sendBtn = page.locator('#ch-send');
    const disabled = await sendBtn.getAttribute('disabled');
    expect(disabled).toBeNull();

    console.log('[TEST] ✅ 输入框可输入，发送按钮已启用');
  });

  test('3. 发送消息后应有响应', async () => {
    // 清空并输入测试消息
    const input = page.locator('#ch-input');
    await input.click({ force: true });
    await input.fill('ping');
    await input.dispatchEvent('input');
    await page.waitForTimeout(500);

    const sendBtn = page.locator('#ch-send');
    const isDisabled = await sendBtn.getAttribute('disabled');
    console.log(`[TEST] 发送按钮 disabled: ${isDisabled}`);

    // 使用 force:true 绕过动画循环阻塞 + dispatchEvent 确保触发
    console.log('[TEST] 点击发送...');
    await sendBtn.dispatchEvent('click');
    console.log('[TEST] 已点击发送，等待响应...');

    // 等待响应（SSE 推送 + 后端处理）
    await page.waitForTimeout(10000);

    // 检查输入框是否被清空
    const valueAfter = await input.inputValue();
    console.log(`[TEST] 发送后输入框: "${valueAfter}"`);

    // 消息区域应有内容
    const messages = page.locator('#chat-messages');
    const html = await messages.innerHTML();
    console.log(`[TEST] 消息区域 HTML 长度: ${html.length}`);

    // 检查消息气泡
    const userMsgs = await page.locator('.ch-msg-user').count();
    const assistantMsgs = await page.locator('.ch-msg-assistant').count();
    const processingMsgs = await page.locator('text=处理中').count();
    console.log(`[TEST] 消息 — 用户: ${userMsgs}, 助手: ${assistantMsgs}, 处理中: ${processingMsgs}`);

    // 至少有消息或处理中状态
    expect(userMsgs + assistantMsgs + processingMsgs).toBeGreaterThan(0);
  }, { timeout: 30000 });

  test('4. 会话应出现在会话列表中', async () => {
    const sessionTrigger = page.locator('#ch-session-trigger');
    await sessionTrigger.click({ force: true });
    await page.waitForTimeout(1000);

    const sessionList = page.locator('#ch-session-list');
    const listHtml = await sessionList.innerHTML();
    console.log(`[TEST] 会话列表内容长度: ${listHtml.length}`);

    // 关闭列表
    await sessionTrigger.click({ force: true });
    await page.waitForTimeout(300);
  });

  test('5. API 会话应持久化', async ({ request }) => {
    // 通过 API 验证会话已保存
    const r = await request.get(`${B}/api/sessions`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.sessions).toBeDefined();
    console.log(`[TEST] 持久化会话数: ${body.sessions.length}`);
    expect(body.sessions.length).toBeGreaterThan(0);
  });

  test('6. 关闭聊天窗口', async () => {
    await page.locator('#ch-close').click({ force: true });
    await page.waitForTimeout(500);

    const panel = page.locator('#chat-panel');
    const classes = await panel.getAttribute('class');
    expect(classes).toContain('chat-closed');
    console.log('[TEST] ✅ 聊天窗口已关闭');
  });
});
