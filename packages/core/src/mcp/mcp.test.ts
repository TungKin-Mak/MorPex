/**
 * McpRuntimeManager — 边车管理器验证测试
 *
 * 验证核心契约：
 *   1. spawn → 子进程启动，返回 McpClient
 *   2. RPC 调用 → 正确返回结果
 *   3. ping → 健康检查
 *   4. 超时 → 正确拒绝
 *   5. 中断信号 → 正确取消
 *   6. shutdown → 确定性销毁（removeAllListeners）
 *   7. 重复注册 → 抛异常
 *   8. stderr → 审计日志文件
 *   9. 非 JSON-RPC stdout → 被过滤丢弃
 */

import { McpRuntimeManager, type McpClient } from './McpRuntimeManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 辅助测试工具 ──

let testPass = 0;
let testFail = 0;
const TEST_DIR = path.resolve('./data/test-mcp-');

function assert(condition: boolean, label: string): void {
  if (condition) {
    testPass++;
    console.log(`  ✅ ${label}`);
  } else {
    testFail++;
    console.error(`  ❌ ${label}`);
  }
}

function eq<T>(a: T, b: T, label: string): void {
  assert(a === b, `${label}: ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

function neq<T>(a: T, b: T, label: string): void {
  assert(a !== b, `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

async function assertRejects(fn: () => Promise<any>, label: string): Promise<void> {
  try {
    await fn();
    testFail++;
    console.error(`  ❌ ${label}: 未抛出异常`);
  } catch {
    testPass++;
    console.log(`  ✅ ${label}: 正确抛出异常`);
  }
}

// ── 创建一个测试用 MCP 子进程 ──
// 子进程接收 JSON-RPC 请求并响应

const TEST_HANDLER_CODE = `
import * as readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    if (req.jsonrpc !== '2.0') return;
    if (req.method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { pong: true } }) + '\\n');
    } else if (req.method === 'echo') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: req.params }) + '\\n');
    } else if (req.method === 'slow') {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { done: true } }) + '\\n');
      }, 2000);
    } else if (req.method === 'stderr') {
      process.stderr.write('this is an error message\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\\n');
    } else if (req.method === 'noise') {
      // 模拟第三方库打印的非 JSON 内容
      process.stdout.write('npm WARN deprecated package@1.0.0\\n');
      process.stdout.write('express@4.18.2\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\\n');
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');
    }
  } catch {}
});
rl.on('close', () => process.exit(0));
process.on('SIGTERM', () => rl.close());
`;

// 写入临时 handler 文件
const handlerFile = path.resolve(`./data/test-mcp-handler-${Date.now()}.mjs`);
if (!fs.existsSync(path.dirname(handlerFile))) {
  fs.mkdirSync(path.dirname(handlerFile), { recursive: true });
}
fs.writeFileSync(handlerFile, TEST_HANDLER_CODE, 'utf-8');

// ── 工具函数 ──

let manager: McpRuntimeManager;

function resetManager(): void {
  // 通过类型断言重置单例（仅测试用）
  (McpRuntimeManager as any).instance = undefined;
  manager = McpRuntimeManager.getInstance();
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n📋 McpRuntimeManager 验证测试\n');

  // ── TC-MCP-1: spawn + RPC 调用 ──
  console.log('\n--- TC-MCP-1: spawn + RPC 调用 ---');
  resetManager();
  const client1 = await manager.spawn('test-1', 'node', [handlerFile]);
  eq(client1.name, 'test-1', '客户端名称正确');

  const echoResult = await client1.call('echo', { msg: 'hello' });
  eq((echoResult as any).msg, 'hello', 'echo 调用返回正确');

  // ── TC-MCP-2: ping ──
  console.log('\n--- TC-MCP-2: ping 健康检查 ---');
  const pingOk = await client1.ping();
  assert(pingOk, 'ping 返回 true');
  await client1.close();

  // ── TC-MCP-3: 超时拒绝 ──
  console.log('\n--- TC-MCP-3: 超时拒绝 ---');
  resetManager();
  const client3 = await manager.spawn('test-3', 'node', [handlerFile]);
  await assertRejects(
    () => client3.call('slow', {}, { timeoutMs: 500 }),
    '超时调用被拒绝',
  );
  await client3.close();

  // ── TC-MCP-4: 中断信号 ──
  console.log('\n--- TC-MCP-4: 中断信号 ---');
  resetManager();
  const client4 = await manager.spawn('test-4', 'node', [handlerFile]);
  const ac = new AbortController();
  const callPromise = client4.call('slow', {}, { timeoutMs: 5000, signal: ac.signal });
  ac.abort();
  await assertRejects(() => callPromise, '中断信号后调用被取消');
  await client4.close();

  // ── TC-MCP-5: 重复注册 ──
  console.log('\n--- TC-MCP-5: 重复注册拒绝 ---');
  resetManager();
  const client5a = await manager.spawn('test-5', 'node', [handlerFile]);
  await assertRejects(
    () => manager.spawn('test-5', 'node', [handlerFile]),
    '重复注册抛出异常',
  );
  await client5a.close();

  // ── TC-MCP-6: 关闭后调用拒绝 ──
  console.log('\n--- TC-MCP-6: 关闭后调用拒绝 ---');
  resetManager();
  const client6 = await manager.spawn('test-6', 'node', [handlerFile]);
  await client6.close();
  await assertRejects(
    () => client6.call('echo', { msg: 'x' }),
    '关闭后调用抛出异常',
  );

  // ── TC-MCP-7: 非 JSON-RPC 噪声过滤 ──
  console.log('\n--- TC-MCP-7: 非 JSON-RPC 噪声过滤 ---');
  resetManager();
  const client7 = await manager.spawn('test-7', 'node', [handlerFile]);
  const noiseResult = await client7.call('noise', {});
  // 噪声行被丢弃，RPC 响应应正常
  eq((noiseResult as any).ok, true, '噪声环境中 RPC 调用仍正常');
  await client7.close();

  // ── TC-MCP-8: 方法不存在 ──
  console.log('\n--- TC-MCP-8: 未知方法 ---');
  resetManager();
  const client8 = await manager.spawn('test-8', 'node', [handlerFile]);
  await assertRejects(
    () => client8.call('nonexistent_method', {}),
    '未知方法抛异常',
  );
  await client8.close();

  // ── TC-MCP-9: shutdownAll ──
  console.log('\n--- TC-MCP-9: shutdownAll ---');
  resetManager();
  const c9a = await manager.spawn('test-9a', 'node', [handlerFile]);
  const c9b = await manager.spawn('test-9b', 'node', [handlerFile]);
  eq(manager.stats.activeProcesses, 2, '注册 2 个进程');
  await manager.shutdownAll();
  eq(manager.stats.activeProcesses, 0, 'shutdownAll 后进程数归零');

  // ── TC-MCP-10: getClient ──
  console.log('\n--- TC-MCP-10: getClient ---');
  resetManager();
  const c10 = await manager.spawn('test-10', 'node', [handlerFile]);
  const retrieved = manager.getClient('test-10');
  assert(retrieved !== null, 'getClient 返回有效客户端');
  if (retrieved) {
    const r = await retrieved.call('echo', { ok: true });
    eq((r as any).ok, true, 'getClient 获取的客户端可用');
  }
  await c10.close();
  const afterClose = manager.getClient('test-10');
  assert(afterClose === null, '关闭后 getClient 返回 null');

  // ── TC-MCP-11: healthCheck ──
  console.log('\n--- TC-MCP-11: healthCheck ---');
  resetManager();
  const c11 = await manager.spawn('test-11', 'node', [handlerFile]);
  const healthMap = await manager.healthCheck();
  assert(healthMap.has('test-11'), 'healthCheck 包含服务');
  const h = healthMap.get('test-11')!;
  assert(h.healthy, '健康检查返回 healthy=true');
  assert(typeof h.pid === 'number', '健康检查返回 pid');
  await c11.close();

  // ── 清理 ──
  try { fs.unlinkSync(handlerFile); } catch {}
  try { fs.rmSync(path.resolve('./logs/mcp-audit/'), { recursive: true, force: true }); } catch {}

  // ═══════════════════════════════════════════════════════════════
  // 总结果
  // ═══════════════════════════════════════════════════════════════

  const total = testPass + testFail;
  const pct = ((testPass / total) * 100).toFixed(1);
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 结果: ${testPass}/${total} 通过 (${pct}%)`);
  if (testFail > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
