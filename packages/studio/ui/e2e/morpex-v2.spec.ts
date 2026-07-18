/**
 * MorPex v2.0 - E2E tests
 */
import { test, expect } from "@playwright/test";
const B = process.env.BACKEND_URL || "http://127.0.0.1:8080";
const F = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
async function w(px) {
  await px.goto(F, { waitUntil: "domcontentloaded", timeout: 15000 });
  await px.waitForSelector("#root", { timeout: 10000 }).catch(() => {});
  await px.waitForTimeout(3000);
}


// API: 系统状态
test.describe("API: 系统状态", () => {
  test("/api/health", async ({ request }) => {
    const r = await request.get(B + "/api/health");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("ok");
    expect(b).toHaveProperty("uptime");
    expect(b).toHaveProperty("kernel");
    expect(b).toHaveProperty("plugins");
  });
  test("/api/status", async ({ request }) => {
    const r = await request.get(B + "/api/status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("ok");
    expect(b).toHaveProperty("version");
    expect(b).toHaveProperty("phase");
    expect(b).toHaveProperty("uptime");
    expect(b).toHaveProperty("pluginCount");
    expect(b).toHaveProperty("activeExecutions");
    expect(b).toHaveProperty("ai_engine");
    expect(b).toHaveProperty("timestamp");
    expect(b.version).toBe("2.0.0");
    expect(b.ai_engine).toBe(true);
  });
  test("/api/ai/status", async ({ request }) => {
    const r = await request.get(B + "/api/ai/status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("ok");
    expect(b).toHaveProperty("running");
    expect(b).toHaveProperty("backend");
    expect(b).toHaveProperty("initialized");
    expect(b).toHaveProperty("engine_info");
    expect(b.initialized).toBe(true);
  });
  test("/api/engine/check", async ({ request }) => {
    const r = await request.get(B + "/api/engine/check");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("kernel");
    expect(b).toHaveProperty("mirror");
    expect(b).toHaveProperty("gateway");
    expect(b).toHaveProperty("eventTypes");
    expect(Array.isArray(b.eventTypes)).toBe(true);
  });
  test("/api/config", async ({ request }) => {
    const r = await request.get(B + "/api/config");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("version");
    expect(b).toHaveProperty("engine");
    expect(b).toHaveProperty("thinkingLevel");
    expect(b).toHaveProperty("model");
    expect(b.engine).toBe("morpex-core");
  });
});


// API: 编排与 Agent
test.describe("API: 编排与 Agent", () => {
  test("/api/orchestrator/status", async ({ request }) => {
    const r = await request.get(B + "/api/orchestrator/status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("ok");
    expect(b).toHaveProperty("workers");
    expect(b).toHaveProperty("activeAssignments");
  });
  test("/api/orchestrator/agents", async ({ request }) => {
    const r = await request.get(B + "/api/orchestrator/agents");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("agents");
  });
  test("/api/agents", async ({ request }) => {
    const r = await request.get(B + "/api/agents");
    expect(r.status()).toBe(200);
    const b = await r.json();
    for (const [id, a] of Object.entries(b)) { expect(a).toHaveProperty("id"); expect(a).toHaveProperty("name"); break; }
  });
  test("/api/departments", async ({ request }) => {
    const r = await request.get(B + "/api/departments");
    expect(r.status()).toBe(200);
    const b = await r.json();
    for (const [id, d] of Object.entries(b)) { expect(d).toHaveProperty("id"); expect(d).toHaveProperty("name"); break; }
  });
  test("/api/observability/workers", async ({ request }) => {
    const r = await request.get(B + "/api/observability/workers");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("workers");
  });
});


// API: 会话管理
let sid;
test.describe("API: 会话管理", () => {
  test("POST /api/sessions", async ({ request }) => {
    const r = await request.post(B + "/api/sessions");
    expect(r.status()).toBe(200);
    const b = await r.json();
    // 响应格式: { session: { id, createdAt, ... } }
    const session = b.session || b;
    expect(session).toHaveProperty("id");
    expect(session).toHaveProperty("createdAt");
    sid = session.id;
  });
  test("GET /api/sessions", async ({ request }) => {
    const r = await request.get(B + "/api/sessions");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("sessions");
    expect(b).toHaveProperty("total");
  });
  test("DELETE /api/sessions/:id", async ({ request }) => {
    if (!sid) return;
    const r = await request.delete(B + "/api/sessions/" + sid);
    expect(r.status()).toBe(200);
  });
});


// API: 记忆系统
test.describe("API: 记忆系统", () => {
  test("/api/memory/stats", async ({ request }) => {
    const r = await request.get(B + "/api/memory/stats");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("stats");
  });
  test("/api/memory/search", async ({ request }) => {
    const r = await request.get(B + "/api/memory/search?q=test&limit=5");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("results");
  });
});


// API: 知识图谱
test.describe("API: 知识图谱", () => {
  test("/api/knowledge-graph/data", async ({ request }) => {
    const r = await request.get(B + "/api/knowledge-graph/data");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b).toHaveProperty("nodes");
    expect(b).toHaveProperty("edges");
  });
});


// API: 搜索
test.describe("API: 搜索", () => {
  test("/api/search/stats", async ({ request }) => {
    const r = await request.get(B + "/api/search/stats");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("stats");
  });
  test("/api/search/query", async ({ request }) => {
    const r = await request.get(B + "/api/search/query?q=MorPex&max=3");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("results");
  });
});


// API: 可观测性
test.describe("API: 可观测性", () => {
  test("/api/observability/metrics", async ({ request }) => {
    const r = await request.get(B + "/api/observability/metrics");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("agents");
    expect(b).toHaveProperty("executions");
    expect(b).toHaveProperty("events");
  });
  test("/api/observability/traces", async ({ request }) => {
    const r = await request.get(B + "/api/observability/traces");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("traces");
  });
});


// API: Agent Chat
test.describe("API: Agent Chat", () => {
  test("/api/chat/agent-status", async ({ request }) => {
    const r = await request.get(B + "/api/chat/agent-status");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("activeZones");
    expect(b).toHaveProperty("modelId");
  });
});


// API: 创业循环
test.describe("API: 创业循环", () => {
  test("/api/cycle/history", async ({ request }) => {
    const r = await request.get(B + "/api/cycle/history");
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b).toHaveProperty("history");
  });
});


// API: 错误边界
test.describe("API: 错误边界", () => {
  test("404 on unknown route", async ({ request }) => {
    const r = await request.get(B + "/api/nonexistent-route-test");
    expect(r.status()).toBe(404);
    const b = await r.json();
    expect(b).toHaveProperty("error");
  });
});


// UI: 页面加载
test.describe("UI: 页面加载", () => {
  test("首页无 JS 错误", async ({ page }) => {
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await w(page);
    const rootHtml = await page.locator("#root").innerHTML();
    expect(rootHtml.length).toBeGreaterThan(100);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(errors.length).toBe(0);
  });
  test("控制台无 error 日志", async ({ page }) => {
    const consoleErrors = [];
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    await w(page);
    await page.waitForTimeout(2000);
    // 打印所有 console error 以便调试
    if (consoleErrors.length > 0) {
      console.log("[playwright] console errors:", JSON.stringify(consoleErrors, null, 2));
    }
    const knownNoise = [
      "favicon", "404", "ECONNRESET", "ECONNREFUSED",
      "http proxy", "sourcemap", "Sourcemap", "WebSocket",
      "ERR_", "Failed to load", "net::", "vite", "HMR",
      "WebSocket connection", "ws://",
      "CORS", "fonts.googleapis", "fonts.gstatic",
      "x-test-source", "preflight"
    ];
    const critical = consoleErrors.filter(e =>
      !knownNoise.some(n => e.toLowerCase().includes(n.toLowerCase()))
    );
    expect(critical.length).toBe(0);
  });
});


// 性能: 响应时间
test.describe("性能: 响应时间", () => {
  test("健康检查 < 5000ms", async ({ request }) => {
    const start = Date.now();
    const r = await request.get(B + "/api/health");
    expect(r.ok()).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(5000);
  });
  test("系统状态 < 3000ms", async ({ request }) => {
    const start = Date.now();
    const r = await request.get(B + "/api/status");
    expect(r.ok()).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
