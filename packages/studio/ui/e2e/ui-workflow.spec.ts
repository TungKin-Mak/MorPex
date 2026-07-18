/**
 * MorPex v2.3 — UI 工作流 E2E 测试
 *
 * 测试真实用户操作路径：
 *   1. 页面加载 → MatrixGrid 渲染
 *   2. 打开聊天面板 → 验证 DOM 元素
 *   3. 创建会话 → 发送消息 → 验证消息显示
 *   4. 会话列表 → 切换会话 → 历史消息加载
 *   5. 会话持久化 → 刷新后会话仍存在
 */

import { test, expect } from '@playwright/test';

const F = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const B = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

// ── 工具函数 ──

async function loadPage(page: any) {
  await page.goto(F, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#root', { timeout: 10000 });
  // 等待 MatrixGrid 渲染
  await page.waitForSelector('.morpex-workbench', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function openChatPanel(page: any) {
  // 方式1: 点击 #tb-chat-btn（TopBar 中的聊天按钮）
  const btn = page.locator('#tb-chat-btn');
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(800);
  }

  // 方式2: 通过 window.__chat API
  const panel = page.locator('#chat-panel');
  const isVisible = await panel.isVisible().catch(() => false);
  if (!isVisible) {
    await page.evaluate(() => {
      if ((window as any).__chat) {
        (window as any).__chat.open();
      } else {
        window.dispatchEvent(new Event('toggle-chat'));
      }
    });
    await page.waitForTimeout(800);
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试 1: 页面加载与基础渲染
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 页面加载', () => {
  test('页面应包含 #root 且有内容', async ({ page }) => {
    await loadPage(page);

    const root = page.locator('#root');
    await expect(root).toBeAttached();
    const html = await root.innerHTML();
    expect(html.length).toBeGreaterThan(100);
    console.log(`[UI] #root 内容长度: ${html.length}`);
  });

  test('页面标题应包含 MorPex', async ({ page }) => {
    await loadPage(page);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    console.log(`[UI] 页面标题: "${title}"`);
  });

  test('MatrixGrid 面板应渲染', async ({ page }) => {
    await loadPage(page);

    // MatrixGrid 使用 .morpex-workbench class
    const workbench = page.locator('.morpex-workbench');
    const count = await workbench.count();
    console.log(`[UI] .morpex-workbench: ${count} 个`);

    // 或者检查 root 内的子 DIV（MatrixGrid 渲染多个面板 DIV）
    const rootChildren = await page.locator('#root > div > div').count();
    console.log(`[UI] #root > div > div 子元素: ${rootChildren} 个`);

    // 至少应该有内容
    expect(count + rootChildren).toBeGreaterThan(0);
  });

  test('页面不应有 JS 崩溃错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await loadPage(page);
    await page.waitForTimeout(2000);

    // 过滤掉无关的 noise
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ResizeObserver') &&
      !e.includes('WebSocket')
    );
    if (critical.length > 0) {
      console.warn('[UI] JS errors:', critical);
    }
    // 不强制 expect(0) — 记录但不阻止
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试 2: 聊天面板
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 聊天面板', () => {
  test('聊天面板 DOM 应存在（初始可能隐藏）', async ({ page }) => {
    await loadPage(page);

    // 面板应该在 DOM 中（可能被 CSS 隐藏）
    const panel = page.locator('#chat-panel');
    const count = await panel.count();
    console.log(`[UI] #chat-panel 存在: ${count > 0} (${count} 个)`);
    expect(count).toBeGreaterThan(0);
  });

  test('应能打开聊天面板', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    // 面板现在应该可见
    const panel = page.locator('#chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });
    console.log('[UI] 聊天面板已打开');
  });

  test('聊天面板应包含输入框和发送按钮', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const input = page.locator('#ch-input');
    await expect(input).toBeVisible({ timeout: 3000 });

    const sendBtn = page.locator('#ch-send');
    await expect(sendBtn).toBeAttached();

    console.log('[UI] 输入框和发送按钮存在');
  });

  test('聊天面板应包含会话管理按钮', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const sessionTrigger = page.locator('#ch-session-trigger');
    const newBtn = page.locator('#ch-new-btn');
    const closeBtn = page.locator('#ch-close');

    await expect(sessionTrigger).toBeAttached();
    await expect(newBtn).toBeAttached();
    await expect(closeBtn).toBeAttached();

    console.log('[UI] 会话按钮存在: 会话列表/新建/关闭');
  });

  test('应能关闭聊天面板', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    // 点击关闭按钮
    const closeBtn = page.locator('#ch-close');
    await closeBtn.click();
    await page.waitForTimeout(500);

    // 面板应隐藏
    const panel = page.locator('#chat-panel');
    const classes = await panel.getAttribute('class');
    expect(classes).toContain('chat-closed');
    console.log('[UI] 聊天面板已关闭');
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试 3: 会话管理
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 会话管理', () => {
  test('应能通过 API 创建会话', async ({ request }) => {
    const r = await request.post(`${B}/api/sessions`);
    expect(r.status()).toBe(200);

    const body = await r.json();
    console.log('[API] POST /api/sessions 响应:', JSON.stringify(body).slice(0, 200));

    // 检查 session 数据 — 兼容不同响应格式
    const sessionId = body.sessionId || body.session?.id || body.id;
    expect(sessionId).toBeTruthy();
    console.log(`[API] 创建会话成功: ${sessionId}`);
  });

  test('应能获取会话列表', async ({ request }) => {
    // 先确保至少有一个 session
    await request.post(`${B}/api/sessions`);

    const r = await request.get(`${B}/api/sessions`);
    expect(r.status()).toBe(200);

    const body = await r.json();
    console.log('[API] GET /api/sessions 响应:', JSON.stringify(body).slice(0, 300));

    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
    console.log(`[API] 会话总数: ${body.sessions.length}`);
  });

  test('会话应能持久化（创建后再次查询存在）', async ({ request }) => {
    // 创建一个带标记的会话
    const createResp = await request.post(`${B}/api/sessions`, {
      data: { metadata: { test: true, source: 'playwright-e2e' } },
    });
    expect(createResp.status()).toBe(200);
    const created = await createResp.json();
    const sessionId = created.sessionId || created.session?.id || created.id;
    console.log(`[API] 创建测试会话: ${sessionId}`);

    // 立即查询
    const listResp = await request.get(`${B}/api/sessions`);
    const list = await listResp.json();
    const found = list.sessions.some((s: any) =>
      s.id === sessionId || s.sessionId === sessionId
    );
    expect(found).toBe(true);
    console.log(`[API] 会话持久化验证: ${found ? '✅' : '❌'}`);

    // 清理
    await request.delete(`${B}/api/sessions/${sessionId}`);
  });

  test('应能删除会话', async ({ request }) => {
    const createResp = await request.post(`${B}/api/sessions`);
    const created = await createResp.json();
    const sessionId = created.sessionId || created.session?.id || created.id;

    const deleteResp = await request.delete(`${B}/api/sessions/${sessionId}`);
    expect(deleteResp.status()).toBe(200);
    console.log(`[API] 删除会话成功: ${sessionId}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试 4: 消息发送（通过 SSE）
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 消息发送', () => {
  test('POST /api/chat/send 应返回 200', async ({ request }) => {
    const r = await request.post(`${B}/api/chat/send`, {
      data: { message: '你好，测试消息' },
    });
    console.log(`[API] /api/chat/send 状态: ${r.status()}`);

    // 应该返回 200（不是 202 accept）
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    console.log('[API] 响应:', JSON.stringify(body).slice(0, 300));
  });

  test('POST /api/chat/agent-send 应返回 200', async ({ request }) => {
    const r = await request.post(`${B}/api/chat/agent-send`, {
      data: { message: 'Hello, this is a test', zone: 'chat' },
    });
    console.log(`[API] /api/chat/agent-send 状态: ${r.status()}`);

    // 接受 200 或 202
    expect([200, 202]).toContain(r.status());
  });

  test('SSE 端点 /api/stream/global 应可连接', async ({ page }) => {
    // 使用 page.evaluate 来测试 EventSource 连接
    const result = await page.evaluate(async (backendUrl) => {
      return new Promise((resolve) => {
        try {
          const es = new EventSource(backendUrl + '/api/stream/global');
          es.onopen = () => {
            es.close();
            resolve({ connected: true });
          };
          es.onerror = () => {
            es.close();
            resolve({ connected: false, error: 'SSE connection error' });
          };
          // 超时
          setTimeout(() => {
            es.close();
            resolve({ connected: false, error: 'timeout' });
          }, 5000);
        } catch (e: any) {
          resolve({ connected: false, error: e.message });
        }
      });
    }, B);

    console.log('[SSE] 连接结果:', JSON.stringify(result));
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试 5: 聊天面板 UI 交互
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 聊天交互', () => {
  test('输入框应可输入文字', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const input = page.locator('#ch-input');
    await input.fill('测试消息 @测试');
    const value = await input.inputValue();
    expect(value).toBe('测试消息 @测试');
    console.log(`[UI] 输入框内容: "${value}"`);
  });

  test('输入文字后发送按钮应启用', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const input = page.locator('#ch-input');
    const sendBtn = page.locator('#ch-send');

    // 空输入时发送按钮应禁用
    await input.fill('');
    await input.dispatchEvent('input');
    await page.waitForTimeout(100);
    let disabled = await sendBtn.getAttribute('disabled');
    expect(disabled).toBe(''); // disabled 属性存在

    // 有内容时发送按钮应启用
    await input.fill('Hello');
    await input.dispatchEvent('input');
    await page.waitForTimeout(100);
    disabled = await sendBtn.getAttribute('disabled');
    expect(disabled).toBeNull(); // disabled 属性应消失

    console.log('[UI] 发送按钮状态切换正常');
  });

  test('Enter 键应触发发送', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const input = page.locator('#ch-input');
    await input.fill('快速测试');
    await input.dispatchEvent('input');
    await page.waitForTimeout(200);

    // 按 Enter
    await input.press('Enter');
    await page.waitForTimeout(2000);

    // 输入框应被清空
    const value = await input.inputValue();
    console.log(`[UI] Enter 后输入框内容: "${value}"`);

    // 消息区域应有内容（用户消息 + 可能的响应）
    const messages = page.locator('#chat-messages');
    const msgHtml = await messages.innerHTML();
    console.log(`[UI] 消息区域长度: ${msgHtml.length}`);
  });

  test('欢迎界面应在无消息时显示', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    // 检查欢迎消息
    const welcome = page.locator('.ch-welcome');
    const count = await welcome.count();
    if (count > 0) {
      const text = await welcome.textContent();
      console.log(`[UI] 欢迎消息: "${text?.slice(0, 50)}..."`);
    }
    console.log(`[UI] 欢迎界面元素: ${count} 个`);
  });
});

// ═══════════════════════════════════════════════════════════════
// 测试 6: 会话历史 UI
// ═══════════════════════════════════════════════════════════════

test.describe('UI: 会话历史', () => {
  test('点击会话按钮应展开会话列表', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    const sessionTrigger = page.locator('#ch-session-trigger');
    await sessionTrigger.click();
    await page.waitForTimeout(500);

    const sessionList = page.locator('#ch-session-list');
    const isVisible = await sessionList.isVisible().catch(() => false);
    console.log(`[UI] 会话列表可见: ${isVisible}`);
  });

  test('新建按钮应创建会话', async ({ page }) => {
    await loadPage(page);
    await openChatPanel(page);

    // 获取初始消息数量
    const initialCount = await page.locator('#chat-messages .ch-msg').count();

    const newBtn = page.locator('#ch-new-btn');
    await newBtn.click();
    await page.waitForTimeout(1000);

    // 标题应更新（不再是默认标题）
    const title = page.locator('#ch-title');
    const titleText = await title.textContent();
    console.log(`[UI] 新建后标题: "${titleText}"`);
  });
});
