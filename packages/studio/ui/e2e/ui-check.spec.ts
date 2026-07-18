import { test, expect } from "@playwright/test";
const F = process.env.FRONTEND_URL || "http://127.0.0.1:3000";

test("UI 状态快照", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(F, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector("#root", { timeout: 10000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: "e2e/screenshots/ui-state.png", fullPage: true });

  const checks: Record<string, string> = {
    "#root": "根容器",
    "#chat-panel": "聊天面板",
    "#ch-input": "聊天输入框",
    "#ch-send": "发送按钮",
    "#ch-session-trigger": "会话触发按钮",
    "#ch-new-btn": "新建会话按钮",
    "#chat-messages": "消息容器",
    ".ch-welcome": "欢迎信息",
  };

  for (const [sel, name] of Object.entries(checks)) {
    const el = page.locator(sel).first();
    const visible = await el.isVisible().catch(() => false);
    console.log(`  ${visible ? '✅' : '❌'} ${name} (${sel}): ${visible ? '可见' : '不可见'}`);
  }

  const chatPanel = page.locator("#chat-panel");
  const chatClosed = await chatPanel.getAttribute("class");
  console.log(`  聊天面板 class: ${chatClosed}`);

  const chatBtn = page.locator("#tb-chat-btn");
  if (await chatBtn.isVisible().catch(() => false)) {
    console.log("  ✅ tb-chat-btn 可见");
    await chatBtn.click();
    await page.waitForTimeout(1500);
    const panelClass = await chatPanel.getAttribute("class");
    console.log(`  点击后聊天面板 class: ${panelClass}`);
    const inputVisible = await page.locator("#ch-input").isVisible().catch(() => false);
    console.log(`  输入框可见: ${inputVisible}`);
  } else {
    console.log("  ❌ tb-chat-btn 不可见");
  }

  if (errors.length > 0) {
    console.log("\n  Console errors:");
    for (const e of errors.slice(0, 20)) console.log(`    ${e}`);
  }
});
