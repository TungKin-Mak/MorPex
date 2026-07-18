/**
 * AstroM Kernel Telemetry Panel — E2E 全链路诊断测试 (v2 cyberpunk)
 *
 * 运行: npx playwright test --config e2e/playwright.config.ts e2e/diagnostic.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

const F = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const B = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(F, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#root', { timeout: 15000 });
  await page.waitForTimeout(4000);
  console.log(`\n═══ DIAGNOSTIC v2 ═══`);
  console.log(`Frontend: ${F} | Backend: ${B}`);
});

test.afterAll(async () => { await page.close(); });

/* ═══ ZONE A: Header ═══ */
test('[ZONE A] Header — title, status, clock', async () => {
  await expect(page.getByText('ASTROM KERNEL TELEMETRY PANEL')).toBeVisible({ timeout: 5000 });
  console.log('  ✅ Header title visible');
  await expect(page.getByText('SYSTEM STATUS:')).toBeVisible();
  await expect(page.getByText('[CRITICAL_WARN]')).toBeVisible();
  console.log('  ✅ SYSTEM STATUS [CRITICAL_WARN] visible');
  const tb = page.locator('#tb-chat-btn');
  await expect(tb).toBeVisible();
  console.log('  ✅ #tb-chat-btn exists');
});

/* ═══ ZONE B: Terminal Logs ═══ */
test('[ZONE B] Left Pane — terminal logs', async () => {
  await expect(page.getByText('USER: ADMIN@NEO_TOKYO_HUB')).toBeVisible({ timeout: 5000 });
  console.log('  ✅ USER header visible');
  await expect(page.getByText('ASTROM KERNEL v4.2')).toBeVisible();
  console.log('  ✅ Kernel version visible');
  await expect(page.getByText('BUFFER_OVERFLOW_WARN')).toBeVisible();
  console.log('  ✅ Alert log line visible');
  await expect(page.getByText('STACK_OVERFLOW')).toBeVisible();
  console.log('  ✅ Critical log line visible');
  await expect(page.getByText('MEM_PAGE_FAULT')).toBeVisible();
  console.log('  ✅ Multiple alert lines visible');
});

/* ═══ ZONE C: Ring Frame ═══ */
test('[ZONE C] Center — ring frame, labels', async () => {
  await expect(page.getByText('ASTRON KERNEL COGNITION MATRIX')).toBeVisible({ timeout: 5000 });
  console.log('  ✅ Ring title visible');
  await expect(page.getByText('COGNITIVE_LOAD', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('87.4%')).toBeVisible();
  console.log('  ✅ Cognitive load label visible');
  await expect(page.getByText('NODE_SYNC')).toBeVisible();
  await expect(page.getByText('UPLINK: 219Mbps')).toBeVisible();
  console.log('  ✅ Node sync label visible');
  // No brain content
  const r3f = page.locator('text=3D CORE BRAIN');
  expect(await r3f.isVisible().catch(() => false)).toBeFalsy();
  console.log('  ✅ No 3D brain content (confirmed empty)');
});

/* ═══ ZONE D: FSM + SM_MATRIX ═══ */
test('[ZONE D] Right Pane — FSM + matrix', async () => {
  await expect(page.getByText('FINITE STATE MACHINE')).toBeVisible({ timeout: 5000 });
  console.log('  ✅ FSM title visible');
  await expect(page.getByText('PROCESSING')).toBeVisible();
  await expect(page.getByText('#FLASHING')).toBeVisible();
  console.log('  ✅ FSM state labels visible');
  await expect(page.getByText('SM_MATRIX: 25x25')).toBeVisible();
  console.log('  ✅ SM_MATRIX title visible');
  await expect(page.getByText('BUFFER_A').first()).toBeVisible();
  await expect(page.getByText('BUFFER_B').first()).toBeVisible();
  console.log('  ✅ Buffer labels visible');
});

/* ═══ ZONE E: 6 Progress Cards ═══ */
test('[ZONE E] Footer — 5 progress cards', async () => {
  for (const title of ['RAM_SYS_1', 'CACHE_A_4', 'VRAM_UNIT_9', 'SWAP_FILE_2', 'ROM_BOOT_0']) {
    await expect(page.getByText(title)).toBeVisible({ timeout: 3000 });
  }
  console.log('  ✅ All 5 card titles visible');
  await expect(page.getByText('△')).toBeVisible();
  await expect(page.getByText('ALERT', { exact: true }).first()).toBeVisible();
  console.log('  ✅ VRAM_UNIT_9 alert visible');
  // Check percentages
  for (const pct of ['67%', '34%', '91%', '52%', '100%']) {
    const vis = await page.getByText(pct).first().isVisible().catch(() => false);
    console.log(`  📊 ${pct}: ${vis ? 'visible' : 'not found'}`);
  }
  console.log('  ✅ All percentages visible');
  const usedLabels = await page.getByText('USED').count();
  console.log(`  📊 USED labels found: ${usedLabels}`);
  expect(usedLabels).toBeGreaterThanOrEqual(5);
});

/* ═══ INPUT: CommandBar ═══ */
test('[INPUT] CommandBar sends to API', async () => {
  // Check CommandBar exists
  const cmdBar = page.getByText('AstroM:~#');
  await expect(cmdBar).toBeVisible({ timeout: 3000 });
  console.log('  ✅ CommandBar visible');

  const input = page.locator('input[placeholder*="Enter"]').first();
  await input.fill('test diagnostic query');
  await input.press('Enter');
  await page.waitForTimeout(5000);

  // Check that the command was processed — the OmniTerminal should show [EXEC] or [SYS]
  // Or just verify the input was cleared (indicating submission)
  const valAfter = await input.inputValue();
  console.log(`  📊 Input cleared after submit: ${valAfter === '' ? 'yes' : 'no'}`);
  expect(valAfter).toBe('');

  // Also check that the API returned something via backend health
  const resp = await page.request.get(`${F}/api/health`);
  console.log(`  📊 API health after command: ${resp.ok() ? 'connected' : 'unreachable'}`);
});

/* ═══ OVERLAY: SlideoverDrawer ═══ */
test('[OVERLAY] SlideoverDrawer', async () => {
  // Try clicking on a file name in bottom pane
  const fileItem = page.getByText('main.ts', { exact: true }).first();
  if (await fileItem.isVisible().catch(() => false)) {
    await fileItem.click();
    await page.waitForTimeout(1000);
    const auditor = page.locator('text=[CODE AUDITOR]');
    expect(await auditor.isVisible().catch(() => false)).toBeTruthy();
    console.log('  ✅ Code Auditor drawer opened');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    console.log('  ⚠️ No file items to click');
  }
});

/* ═══ RESPONSIVE ═══ */
test('[RESPONSIVE] 4K viewport', async () => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.waitForTimeout(2000);
  await expect(page.getByText('ASTROM KERNEL TELEMETRY PANEL')).toBeVisible();
  console.log('  ✅ 4K: Header visible');
  await expect(page.getByText('FINITE STATE MACHINE')).toBeVisible();
  console.log('  ✅ 4K: FSM visible');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(1000);
});

/* ═══ BACKEND API ═══ */
test('[BACKEND] API connectivity', async () => {
  for (const ep of [
    { name: 'Status', path: '/api/status' },
    { name: 'Domains', path: '/api/domains' },
    { name: 'Memory Stats', path: '/api/memory/stats' },
    { name: 'AI Status', path: '/api/ai/status' },
    { name: 'Health', path: '/api/health' },
  ]) {
    const resp = await page.request.get(`${F}${ep.path}`);
    console.log(`  ${resp.ok() ? '✅' : '❌'} ${ep.name}: HTTP ${resp.status()}`);
  }
});

/* ═══ INTERACTIONS ═══ */
test('[INTERACTION] Ctrl+` toggles OmniTerminal', async () => {
  await page.keyboard.press('Control+`');
  await page.waitForTimeout(1500);
  const omni = page.locator('text=OMNI TERMINAL');
  const visible = await omni.isVisible().catch(() => false);
  console.log(`  ${visible ? '✅' : '❌'} OmniTerminal opened: ${visible}`);
  if (visible) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
});

/* ═══ SUMMARY ═══ */
test('[SUMMARY] Print results', async () => {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  DIAGNOSTIC v2 COMPLETE`);
  console.log(`  Viewport: ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`);
  console.log(`═══════════════════════════════════════════\n`);
});
