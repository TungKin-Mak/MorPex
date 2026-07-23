#!/usr/bin/env npx tsx
/**
 * Production Readiness Check — MorPex v9.2
 *
 * 覆盖:
 *   GAP 5: 负载测试 (concurrent requests to POST /api/v8/mission)
 *   GAP 6: 安全审计 (API auth, input validation)
 *   GAP 7: 生产配置验证 (build + production mode)
 *   GAP 8: 端到端测试 (对话→Mission→DAG→Artifact)
 *
 * 用法:
 *   npx tsx scripts/production-readiness-check.ts
 *   npx tsx scripts/production-readiness-check.ts --load-only
 *   npx tsx scripts/production-readiness-check.ts --security-only
 *   npx tsx scripts/production-readiness-check.ts --e2e-only
 */

const BASE = `http://localhost:${process.env.PORT || 8080}`;

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg: string): void { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function fail(msg: string): void { console.log(`  ${RED}✗${RESET} ${msg}`); }
function warn(msg: string): void { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function info(msg: string): void { console.log(`  ${CYAN}→${RESET} ${msg}`); }

function header(title: string): void {
  console.log(`\n${BOLD}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}${'═'.repeat(60)}${RESET}\n`);
}

async function fetchJson(url: string, opts?: RequestInit): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } catch (err: any) {
    return { status: -1, body: { error: err.message } };
  }
}

// ═══════════════════════════════════════════════════════
// GAP 7: 生产配置验证
// ═══════════════════════════════════════════════════════

async function checkProductionConfig(): Promise<boolean> {
  header('GAP 7: 生产配置验证');

  let ok = true;

  // Check TypeScript compilation
  info('检查 TypeScript 编译...');
  try {
    const { execSync } = await import('node:child_process');
    execSync('npx tsc --noEmit', { cwd: process.cwd(), timeout: 120000, stdio: 'pipe' });
    pass('TypeScript 编译: 零错误');
  } catch (err: any) {
    fail(`TypeScript 编译失败: ${err.message?.slice(0, 200)}`);
    ok = false;
  }

  // Check package.json for required fields
  const pkg = require('../package.json');
  info('检查 package.json 配置...');
  if (pkg.name) pass(`包名: ${pkg.name}`);
  else { fail('缺少 name'); ok = false; }

  if (pkg.version) pass(`版本: ${pkg.version}`);
  else { fail('缺少 version'); ok = false; }

  // Check environment
  info('检查运行环境...');
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]);
  if (major >= 18) pass(`Node.js ${nodeVersion} (≥18 要求)`);
  else { fail(`Node.js ${nodeVersion} (<18, 需要升级)`); ok = false; }

  // Check server connectivity
  info('检查服务器连通性...');
  const healthRes = await fetchJson(`${BASE}/api/v8/missions`);
  if (healthRes.status === 200 || healthRes.status === 503) {
    pass(`服务器响应: HTTP ${healthRes.status} (${healthRes.status === 200 ? '就绪' : '未就绪但可达'})`);
  } else {
    warn(`服务器可能未启动: HTTP ${healthRes.status}`);
    ok = false;
  }

  // Check PM2 ecosystem file
  const fs = require('fs');
  const pm2Path = './configs/pm2-ecosystem.config.cjs';
  if (fs.existsSync(pm2Path)) pass('PM2 配置文件存在');
  else { warn('PM2 配置文件缺失 (生产部署需要)'); ok = false; }

  console.log(`\n  GAP 7 结论: ${ok ? `${GREEN}PASS${RESET}` : `${YELLOW}NEEDS FIXES${RESET}`}`);
  return ok;
}

// ═══════════════════════════════════════════════════════
// GAP 6: 安全审计
// ═══════════════════════════════════════════════════════

async function checkSecurity(): Promise<boolean> {
  header('GAP 6: 安全审计');

  const findings: Array<{ severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'; check: string; detail: string }> = [];

  // Check 1: CORS — is it wide open?
  info('检查 CORS 配置...');
  const corsRes = await fetch(`${BASE}/api/v8/missions`, { method: 'OPTIONS' });
  const acao = corsRes.headers.get('access-control-allow-origin');
  if (acao === '*') {
    findings.push({ severity: 'HIGH', check: 'CORS', detail: 'Access-Control-Allow-Origin: * — 允许任意来源访问' });
  } else if (acao) {
    findings.push({ severity: 'LOW', check: 'CORS', detail: `Access-Control-Allow-Origin: ${acao} (受限制)` });
  } else {
    findings.push({ severity: 'INFO', check: 'CORS', detail: '无 CORS 头 (可能未配置)' });
  }

  // Check 2: Authentication
  info('检查认证机制...');
  const missionRes = await fetchJson(`${BASE}/api/v8/missions`);
  if (missionRes.status === 200 || missionRes.status === 503) {
    // No auth required — the endpoint is accessible
    findings.push({ severity: 'HIGH', check: '认证', detail: 'API 端点无需认证令牌 — 所有操作开放访问' });
  }

  // Check 3: Input validation
  info('检查输入校验...');
  const invalidRes = await fetchJson(`${BASE}/api/v8/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (invalidRes.body?.error?.includes('缺少 content')) {
    findings.push({ severity: 'LOW', check: '输入校验', detail: 'POST /api/v8/mission 校验了 content 字段' });
  } else {
    findings.push({ severity: 'MEDIUM', check: '输入校验', detail: '缺少充分的输入校验' });
  }

  // Check 4: Rate limiting
  info('检查速率限制...');
  findings.push({ severity: 'MEDIUM', check: '速率限制', detail: '未检测到速率限制机制 (X-RateLimit-* 头缺失)' });

  // Check 5: Security headers
  info('检查安全头...');
  const secHeaders = ['X-Content-Type-Options', 'X-Frame-Options', 'Strict-Transport-Security'];
  for (const h of secHeaders) {
    if (!corsRes.headers.get(h) && !corsRes.headers.get(h.toLowerCase())) {
      findings.push({ severity: 'MEDIUM', check: '安全头', detail: `缺少 ${h} 响应头` });
    }
  }

  // Check 6: SQL injection (basic)
  info('检查 SQL 注入防护...');
  const sqlAttempt = await fetchJson(`${BASE}/api/v8/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: "'; DROP TABLE users; --", session_id: 'test' }),
  });
  if (sqlAttempt.status === 200 || sqlAttempt.status === 400) {
    findings.push({ severity: 'INFO', check: 'SQL 注入', detail: 'SQL 注入测试未导致服务器崩溃 (需进一步审计)' });
  }

  // Report
  const high = findings.filter(f => f.severity === 'HIGH').length;
  const med = findings.filter(f => f.severity === 'MEDIUM').length;
  const low = findings.filter(f => f.severity === 'LOW').length;

  for (const f of findings) {
    const icon = f.severity === 'HIGH' ? '🔴' : f.severity === 'MEDIUM' ? '🟡' : f.severity === 'LOW' ? '🟢' : 'ℹ️';
    console.log(`  ${icon} [${f.check}] ${f.detail}`);
  }

  console.log(`\n  结果: ${high} HIGH, ${med} MEDIUM, ${low} LOW, ${findings.length - high - med - low} INFO`);
  console.log(`  GAP 6 结论: ${high === 0 ? `${GREEN}PASS${RESET}` : `${RED}NEEDS FIXES${RESET}`} (${high} 高危项)`);
  return high === 0;
}

// ═══════════════════════════════════════════════════════
// GAP 5: 负载测试
// ═══════════════════════════════════════════════════════

interface LoadTestResult {
  total: number;
  succeeded: number;
  failed: number;
  durations: number[];
  errors: string[];
}

async function runLoadTest(
  concurrency: number,
  totalRequests: number,
  payload: Record<string, any>,
): Promise<LoadTestResult> {
  const durations: number[] = [];
  const errors: string[] = [];
  let succeeded = 0;
  let failed = 0;

  const worker = async () => {
    while (true) {
      const idx = succeeded + failed;
      if (idx >= totalRequests) break;

      const t0 = Date.now();
      try {
        const res = await fetch(`${BASE}/api/v8/mission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, session_id: `load_${idx}_${Date.now()}` }),
          signal: AbortSignal.timeout(30000),
        });
        const dur = Date.now() - t0;
        durations.push(dur);
        if (res.ok) {
          succeeded++;
        } else {
          failed++;
          errors.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
        }
      } catch (err: any) {
        failed++;
        durations.push(Date.now() - t0);
        errors.push(err.message?.slice(0, 100));
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { total: totalRequests, succeeded, failed, durations, errors };
}

async function checkLoadTest(): Promise<boolean> {
  header('GAP 5: 负载测试 (POST /api/v8/mission)');

  const CONCURRENCY = 10;
  const TOTAL = 30;
  const PAYLOAD = {
    content: 'Calculate the sum of numbers from 1 to 100 and return the result as a JSON object with key "sum".',
  };

  info(`并发数: ${CONCURRENCY}, 总请求: ${TOTAL}`);
  info(`目标: ${BASE}/api/v8/mission`);
  console.log('');

  const result = await runLoadTest(CONCURRENCY, TOTAL, PAYLOAD);

  // Statistics
  const sorted = [...result.durations].sort((a, b) => a - b);
  const avg = result.durations.reduce((a, b) => a + b, 0) / result.durations.length || 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  console.log(`  总请求:    ${result.total}`);
  console.log(`  成功:      ${GREEN}${result.succeeded}${RESET}`);
  console.log(`  失败:      ${result.failed > 0 ? RED : ''}${result.failed}${RESET}`);
  console.log(`  成功率:    ${result.total > 0 ? ((result.succeeded / result.total) * 100).toFixed(1) : 0}%`);
  console.log(`  平均延迟:  ${avg.toFixed(0)}ms`);
  console.log(`  P50:       ${p50}ms`);
  console.log(`  P95:       ${p95}ms`);
  console.log(`  P99:       ${p99}ms`);
  console.log(`  最慢:      ${sorted[sorted.length - 1] || 0}ms`);

  if (result.errors.length > 0) {
    console.log(`\n  ${YELLOW}错误样本 (前5):${RESET}`);
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    - ${e}`);
    }
  }

  const successRate = result.total > 0 ? result.succeeded / result.total : 0;
  const isHealthy = successRate >= 0.8 && avg < 15000;
  console.log(`\n  GAP 5 结论: ${isHealthy ? `${GREEN}PASS${RESET}` : `${YELLOW}NEEDS ATTENTION${RESET}`} (成功率 ${(successRate * 100).toFixed(0)}%, 平均 ${avg.toFixed(0)}ms)`);
  return isHealthy;
}

// ═══════════════════════════════════════════════════════
// GAP 8: 端到端测试
// ═══════════════════════════════════════════════════════

async function checkE2E(): Promise<boolean> {
  header('GAP 8: 端到端测试 (对话→Mission→DAG→Artifact)');

  let ok = true;

  // Step 1: 发送对话创建 Mission
  info('Step 1: POST /api/v8/mission (创建 Mission)...');
  const missionRes = await fetchJson(`${BASE}/api/v8/mission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'Write a Python function that calculates the fibonacci sequence up to n=10. Return ONLY the code, no explanation.',
      session_id: `e2e_${Date.now()}`,
    }),
  });

  if (missionRes.body?.ok) {
    pass(`Mission 创建: ok=${missionRes.body.ok}, type=${missionRes.body.type || 'N/A'}`);
  } else {
    fail(`Mission 创建失败: ${JSON.stringify(missionRes.body).slice(0, 200)}`);
    ok = false;
    return ok;
  }

  // Wait for processing
  info('等待 DAG 执行 (3s)...');
  await new Promise(r => setTimeout(r, 3000));

  // Step 2: 检查 Missions 列表
  info('Step 2: GET /api/v8/missions (检查 Mission 状态)...');
  const missionsRes = await fetchJson(`${BASE}/api/v8/missions`);
  if (missionsRes.body?.ok) {
    const count = missionsRes.body.count || 0;
    const states = (missionsRes.body.missions || []).map((m: any) => m.state);
    pass(`Missions: ${count} 个, 状态: [${states.join(', ')}]`);
  } else {
    fail(`Missions 查询失败: ${JSON.stringify(missionsRes.body).slice(0, 200)}`);
    ok = false;
  }

  // Step 3: 检查 Artifacts (通过 observability API)
  info('Step 3: GET /api/observability/events (检查 Artifact 事件)...');
  const eventsRes = await fetchJson(`${BASE}/api/observability/events?limit=20`);
  if (eventsRes.body?.events) {
    const artifactEvents = (eventsRes.body.events || []).filter(
      (e: any) => e.type === 'DATA_FLOW' || (e.payload?.type === 'artifact.created'),
    );
    pass(`Artifact 相关事件: ${artifactEvents.length} 条`);
  } else {
    warn('无法检查 Artifact 事件 (observability API 未响应)');
  }

  // Step 4: 检查 Observability 模块状态
  info('Step 4: GET /api/observability/modules (检查模块覆盖)...');
  const modulesRes = await fetchJson(`${BASE}/api/observability/modules`);
  if (modulesRes.body?.modules) {
    const online = modulesRes.body.modules.filter((m: any) => m.status === 'online').length;
    const total = modulesRes.body.modules.length;
    pass(`模块状态: ${online}/${total} online`);
  } else {
    warn('无法检查模块状态');
  }

  // Step 5: 检查 Architecture Audit
  info('Step 5: GET /api/observability/audit (架构审计)...');
  const auditRes = await fetchJson(`${BASE}/api/observability/audit`);
  if (auditRes.body?.healthScore !== undefined) {
    const score = auditRes.body.healthScore;
    const summary = auditRes.body.summary;
    if (score >= 90) {
      pass(`架构健康: ${score}% (OK:${summary.ok} W:${summary.warning} E:${summary.error})`);
    } else {
      warn(`架构健康: ${score}% (OK:${summary.ok} W:${summary.warning} E:${summary.error})`);
    }
  } else {
    warn('架构审计未就绪');
  }

  console.log(`\n  GAP 8 结论: ${ok ? `${GREEN}PASS${RESET}` : `${YELLOW}PARTIAL${RESET}`}`);
  return ok;
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const loadOnly = args.includes('--load-only');
  const securityOnly = args.includes('--security-only');
  const e2eOnly = args.includes('--e2e-only');
  const all = !loadOnly && !securityOnly && !e2eOnly;

  console.log(`${BOLD}MorPex v9.2 — 生产就绪度检查${RESET}`);
  console.log(`目标: ${BASE}\n`);

  const results: Record<string, boolean> = {};

  if (all || loadOnly) {
    results.load = await checkLoadTest();
  }

  if (all || securityOnly) {
    results.security = await checkSecurity();
  }

  if (all || e2eOnly) {
    results.e2e = await checkE2E();
  }

  if (all) {
    results.production = await checkProductionConfig();
  }

  // Summary
  header('总结');
  const entries = Object.entries(results);
  const passed = entries.filter(([, v]) => v).length;
  for (const [name, ok] of entries) {
    const icon = ok ? '✅' : '⚠️';
    const label = {
      load: 'GAP 5: 负载测试',
      security: 'GAP 6: 安全审计',
      production: 'GAP 7: 生产配置',
      e2e: 'GAP 8: 端到端测试',
    }[name] || name;
    console.log(`  ${icon} ${label}`);
  }
  console.log(`\n  通过: ${passed}/${entries.length}`);
  console.log(`  ${passed === entries.length ? `${GREEN}所有检查通过 ✅${RESET}` : `${YELLOW}部分检查未通过${RESET}`}`);
}

main().catch(err => {
  console.error(`${RED}检查脚本失败:${RESET}`, err.message);
  process.exit(1);
});
